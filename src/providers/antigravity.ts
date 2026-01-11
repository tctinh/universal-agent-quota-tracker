import { promises as fs } from 'node:fs';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { homedir, platform } from 'node:os';
import { BaseQuotaProvider } from './base';
import { ProviderQuotaResult, AccountQuota, ModelQuota } from '../types';
import { calculateOverallHealth } from '../utils/health';

const execAsync = promisify(exec);

const ANTIGRAVITY_CLIENT_ID = '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com';
const ANTIGRAVITY_CLIENT_SECRET = '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';
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

const ANTIGRAVITY_ENDPOINTS = [
  'https://daily-cloudcode-pa.sandbox.googleapis.com',
  'https://cloudcode-pa.googleapis.com',
];

const ANTIGRAVITY_HEADERS = {
  'User-Agent': `antigravity/1.11.5 ${platform()}/${process.arch}`,
  'X-Goog-Api-Client': 'google-cloud-sdk vscode_cloudshelleditor/0.1',
  'Client-Metadata': JSON.stringify({
    ideType: 'IDE_UNSPECIFIED',
    platform: 'PLATFORM_UNSPECIFIED',
    pluginType: 'GEMINI'
  })
};

interface OpencodeAccountV3 {
  email?: string;
  refreshToken: string;
  projectId?: string;
  managedProjectId?: string;
  addedAt: number;
  lastUsed: number;
}

interface OpencodeStorageV3 {
  version: 3;
  accounts: OpencodeAccountV3[];
  activeIndex: number;
}

interface ProxyAccount {
  email: string;
  source: 'oauth' | 'database' | 'manual';
  refreshToken?: string;
  dbPath?: string;
  apiKey?: string;
}

interface ProxyAccountStorage {
  accounts: ProxyAccount[];
  settings?: Record<string, unknown>;
  activeIndex: number;
}

interface QuotaInfo {
  remainingFraction: number | null;
  resetTime: string | null;
}

interface Tier {
  id?: string;
  quotaTier?: string;
  name?: string;
  slug?: string;
}

interface LoadCodeAssistResponse {
  cloudaicompanionProject?: string;
  currentTier?: Tier;
  paidTier?: Tier;
}

interface ProjectInfo {
  projectId: string | null;
  subscriptionTier: string | null;
}

const DEFAULT_PROJECT_ID = 'bamboo-precept-lgxtn';
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 1000;

/**
 * Sleep helper for retry backoff
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

interface AccountWithToken {
  email: string;
  source: string;
  accessToken: string;
}

interface QuotaResult {
  models: ModelQuota[];
  isForbidden: boolean;
}

// Model grouping configuration matching Antigravity-Manager
// API returns model names like: gemini-3-pro-high, gemini-3-flash, gemini-3-pro-image, claude-sonnet-4-5-thinking
const MODEL_GROUPS = {
  'Gemini 3 Pro': ['gemini-3-pro-high', 'gemini-3-pro'],
  'Gemini 3 Flash': ['gemini-3-flash'],
  'Gemini 3 Image': ['gemini-3-pro-image', 'gemini-3-image'],
  'Claude / GPT': ['claude-sonnet-4-5-thinking', 'claude', 'gpt'],
} as const;

export class AntigravityProvider extends BaseQuotaProvider {
  readonly id = 'antigravity';
  readonly displayName = 'Opencode Antigravity Auth';
  readonly shortName = 'AG';

  private getOpencodeStoragePath(): string {
    if (process.platform === 'win32') {
      return join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'opencode', 'antigravity-accounts.json');
    }
    const xdgConfig = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
    return join(xdgConfig, 'opencode', 'antigravity-accounts.json');
  }

  private getProxyAccountsPath(): string {
    const xdgConfig = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
    return join(xdgConfig, 'antigravity-proxy', 'accounts.json');
  }

  private getAntigravityIdeDatabasePath(): string {
    const home = homedir();
    switch (process.platform) {
      case 'darwin':
        return join(home, 'Library/Application Support/Antigravity/User/globalStorage/state.vscdb');
      case 'win32':
        return join(home, 'AppData/Roaming/Antigravity/User/globalStorage/state.vscdb');
      default:
        return join(home, '.config/Antigravity/User/globalStorage/state.vscdb');
    }
  }

  async isConfigured(): Promise<boolean> {
    const sources = await this.getAllAccountSources();
    return sources.length > 0;
  }

  private async getAllAccountSources(): Promise<AccountWithToken[]> {
    const accounts: AccountWithToken[] = [];

    const opencodeAccounts = await this.loadOpencodeAccounts();
    for (const acc of opencodeAccounts) {
      const token = await this.refreshToken(acc.refreshToken);
      if (token) {
        accounts.push({
          email: acc.email || 'opencode-account',
          source: 'opencode',
          accessToken: token,
        });
      }
    }

    const proxyAccounts = await this.loadProxyAccounts();
    for (const acc of proxyAccounts) {
      if (acc.source === 'oauth' && acc.refreshToken) {
        const token = await this.refreshToken(acc.refreshToken);
        if (token) {
          accounts.push({
            email: acc.email,
            source: 'proxy-oauth',
            accessToken: token,
          });
        }
      } else if (acc.source === 'database' && acc.dbPath) {
        const token = await this.extractTokenFromDatabase(acc.dbPath);
        if (token) {
          accounts.push({
            email: acc.email,
            source: 'proxy-db',
            accessToken: token,
          });
        }
      }
    }

    const ideToken = await this.extractTokenFromDatabase(this.getAntigravityIdeDatabasePath());
    if (ideToken) {
      const existingIde = accounts.find(a => a.source === 'antigravity-ide');
      if (!existingIde) {
        accounts.push({
          email: 'Antigravity IDE',
          source: 'antigravity-ide',
          accessToken: ideToken,
        });
      }
    }

    return accounts;
  }

  private async loadOpencodeAccounts(): Promise<OpencodeAccountV3[]> {
    try {
      const content = await fs.readFile(this.getOpencodeStoragePath(), 'utf-8');
      const storage = JSON.parse(content) as OpencodeStorageV3;
      return storage.accounts || [];
    } catch {
      return [];
    }
  }

  private async loadProxyAccounts(): Promise<ProxyAccount[]> {
    try {
      const content = await fs.readFile(this.getProxyAccountsPath(), 'utf-8');
      const storage = JSON.parse(content) as ProxyAccountStorage;
      return storage.accounts || [];
    } catch {
      return [];
    }
  }

  private async extractTokenFromDatabase(dbPath: string): Promise<string | null> {
    try {
      await fs.access(dbPath);
      
      const query = `SELECT value FROM ItemTable WHERE key = 'antigravityAuthStatus'`;
      const { stdout } = await execAsync(`sqlite3 "${dbPath}" "${query}"`, { timeout: 5000 });
      
      if (!stdout.trim()) return null;

      const authData = JSON.parse(stdout.trim());
      return authData.apiKey || null;
    } catch {
      return null;
    }
  }

  async fetchQuota(): Promise<ProviderQuotaResult> {
    try {
      const accountSources = await this.getAllAccountSources();

      if (accountSources.length === 0) {
        return this.createNotConfiguredResult("Run 'opencode auth login' or install Antigravity IDE");
      }

      const accounts: AccountQuota[] = [];

      for (const account of accountSources) {
        try {
          // First fetch project info (project ID and subscription tier)
          const projectInfo = await this.fetchProjectInfo(account.accessToken);
          const projectId = projectInfo.projectId || DEFAULT_PROJECT_ID;
          
          const quotaResult = await this.fetchModelQuotas(account.accessToken, projectId);
          accounts.push({
            id: account.email,
            name: account.email,
            models: quotaResult.models,
            overallHealth: quotaResult.isForbidden ? 'critical' : calculateOverallHealth(quotaResult.models),
            subscriptionTier: projectInfo.subscriptionTier || undefined,
            isForbidden: quotaResult.isForbidden || undefined,
          });
        } catch {
          accounts.push({
            id: account.email,
            name: account.email,
            models: [],
            overallHealth: 'unknown',
          });
        }
      }

      return {
        provider: this.id,
        displayName: this.displayName,
        shortName: this.shortName,
        status: 'ok',
        accounts,
        lastUpdated: new Date(),
      };
    } catch (error) {
      return this.createErrorResult(String(error));
    }
  }

  private async refreshToken(refreshToken: string): Promise<string | null> {
    try {
      const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: ANTIGRAVITY_CLIENT_ID,
          client_secret: ANTIGRAVITY_CLIENT_SECRET,
        }),
      });
      if (!response.ok) return null;
      const data = await response.json() as { access_token: string };
      return data.access_token;
    } catch {
      return null;
    }
  }

  /**
   * Fetch project ID and subscription tier from loadCodeAssist API
   * This matches the Antigravity-Manager reference implementation
   */
  private async fetchProjectInfo(accessToken: string): Promise<ProjectInfo> {
    const CLOUD_CODE_BASE_URL = 'https://cloudcode-pa.googleapis.com';
    
    try {
      const response = await fetch(`${CLOUD_CODE_BASE_URL}/v1internal:loadCodeAssist`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'User-Agent': 'antigravity/windows/amd64',
        },
        body: JSON.stringify({ metadata: { ideType: 'ANTIGRAVITY' } }),
      });

      if (!response.ok) {
        return { projectId: null, subscriptionTier: null };
      }

      const data = await response.json() as LoadCodeAssistResponse;
      
      // Priority: paidTier.id > currentTier.id (matches reference implementation)
      const subscriptionTier = data.paidTier?.id || data.currentTier?.id || null;
      
      return {
        projectId: data.cloudaicompanionProject || null,
        subscriptionTier,
      };
    } catch {
      return { projectId: null, subscriptionTier: null };
    }
  }

  private async fetchModelQuotas(accessToken: string, projectId: string): Promise<QuotaResult> {
    for (const endpoint of ANTIGRAVITY_ENDPOINTS) {
      // Retry logic with exponential backoff
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          const response = await fetch(`${endpoint}/v1internal:fetchAvailableModels`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
              ...ANTIGRAVITY_HEADERS,
            },
            body: JSON.stringify({ project: projectId }),
          });
          
          // Handle 403 Forbidden - don't retry, mark as forbidden
          if (response.status === 403) {
            return { models: [], isForbidden: true };
          }
          
          if (!response.ok) {
            // On non-OK response, if we have retries left, wait and retry
            if (attempt < MAX_RETRIES) {
              await sleep(INITIAL_RETRY_DELAY_MS * attempt);
              continue;
            }
            // After all retries, try next endpoint
            break;
          }

          const data = await response.json() as { models?: Record<string, { quotaInfo?: QuotaInfo }> };
          
          // Group models into 4 categories matching Antigravity-Manager
          const groups: Record<string, { remaining: number; resetTime?: Date; found: boolean }> = {
            'Gemini 3 Pro': { remaining: 100, found: false },
            'Gemini 3 Flash': { remaining: 100, found: false },
            'Gemini 3 Image': { remaining: 100, found: false },
            'Claude / GPT': { remaining: 100, found: false },
          };

          for (const [modelId, modelInfo] of Object.entries(data.models || {})) {
            const remainingFraction = modelInfo.quotaInfo?.remainingFraction ?? 1;
            const remainingPercent = Math.round(remainingFraction * 100);
            const resetTime = modelInfo.quotaInfo?.resetTime ? new Date(modelInfo.quotaInfo.resetTime) : undefined;

            // Match model to group
            let groupKey: string | null = null;
            for (const [group, patterns] of Object.entries(MODEL_GROUPS)) {
              if (patterns.some(pattern => modelId.includes(pattern))) {
                groupKey = group;
                break;
              }
            }

            if (groupKey && groups[groupKey]) {
              groups[groupKey].found = true;
              // Use the lowest remaining percentage for the group
              if (remainingPercent < groups[groupKey].remaining) {
                groups[groupKey].remaining = remainingPercent;
                groups[groupKey].resetTime = resetTime;
              }
            }
          }

          // Convert groups to ModelQuota array
          const models: ModelQuota[] = Object.entries(groups)
            .filter(([, g]) => g.found)
            .map(([name, g]) => ({
              name,
              displayName: name,
              remainingPercent: g.remaining,
              usedPercent: 100 - g.remaining,
              resetTime: g.resetTime,
            }));

          return { models, isForbidden: false };
        } catch {
          // On network error, if we have retries left, wait and retry
          if (attempt < MAX_RETRIES) {
            await sleep(INITIAL_RETRY_DELAY_MS * attempt);
            continue;
          }
          // After all retries, try next endpoint
          break;
        }
      }
    }
    return { models: [], isForbidden: false };
  }

  private formatModelName(modelId: string): string {
    return modelId
      .replace(/-/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
  }
}
