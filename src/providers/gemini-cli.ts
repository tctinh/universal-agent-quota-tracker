import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { BaseQuotaProvider } from './base';
import { ProviderQuotaResult, AccountQuota, ModelQuota } from '../types';
import { calculateOverallHealth } from '../utils/health';

const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GEMINI_CODE_ASSIST_ENDPOINT = 'https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist';
const GEMINI_QUOTA_ENDPOINT = 'https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota';

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

// Gemini CLI OAuth credentials (extracted from gemini-cli)
const GEMINI_CLIENT_ID = '539823621889-cfr6vts0pu7g8e1aq8k3trqsqmq7qs9n.apps.googleusercontent.com';
const GEMINI_CLIENT_SECRET = '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';

interface GeminiOAuthCreds {
  access_token: string;
  refresh_token: string;
  expiry_date: number;  // Unix ms
  client_id?: string;
  client_secret?: string;
}

interface QuotaBucket {
  modelId: string;
  remainingFraction: number;
  resetTime?: string;
}

interface LoadCodeAssistResponse {
  cloudaicompanionProject?: string;
}

interface RetrieveQuotaResponse {
  buckets?: QuotaBucket[];
}

export class GeminiCliProvider extends BaseQuotaProvider {
  readonly id = 'gemini-cli';
  readonly displayName = 'Gemini CLI';
  readonly shortName = 'GC';

  private getCredentialPath(): string {
    return join(homedir(), '.gemini', 'oauth_creds.json');
  }

  private async getCredentials(): Promise<GeminiOAuthCreds | null> {
    try {
      const content = await fs.readFile(this.getCredentialPath(), 'utf-8');
      return JSON.parse(content) as GeminiOAuthCreds;
    } catch {
      return null;
    }
  }

  async isConfigured(): Promise<boolean> {
    // Check env vars first
    if (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) {
      return true;
    }
    const creds = await this.getCredentials();
    return creds !== null;
  }

  async fetchQuota(): Promise<ProviderQuotaResult> {
    // Check for API key mode (no quota data available)
    if (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) {
      const account: AccountQuota = {
        id: 'api-key',
        name: 'API Key Mode',
        models: [{
          name: 'api-key',
          displayName: 'API Key (no quota data)',
          remainingPercent: 100,
          usedPercent: 0,
        }],
        overallHealth: 'unknown',
      };

      return {
        provider: this.id,
        displayName: this.displayName,
        shortName: this.shortName,
        status: 'ok',
        accounts: [account],
        hint: 'API key mode - quota data unavailable',
        lastUpdated: new Date(),
      };
    }

    const creds = await this.getCredentials();
    if (!creds) {
      return this.createNotConfiguredResult("Run 'gemini' to authenticate");
    }

    try {
      // Refresh token if expired or missing expiry_date
      let accessToken = creds.access_token;
      if (!creds.expiry_date || Date.now() >= creds.expiry_date) {
        const newToken = await this.refreshToken(creds);
        if (!newToken) {
          return this.createAuthExpiredResult("Run 'gemini' to re-authenticate");
        }
        accessToken = newToken;
      }

      // Helper to execute with a single retry on auth failure
      const executeWithRetry = async () => {
        try {
          const projectId = await this.getProjectId(accessToken);
          if (!projectId) {
            throw new Error('Failed to get project ID');
          }

          return await this.getQuota(accessToken, projectId);
        } catch (error) {
          if (error instanceof AuthError) {
            // Attempt one refresh and retry
            const newToken = await this.refreshToken(creds);
            if (newToken) {
              accessToken = newToken;
              const projectId = await this.getProjectId(accessToken);
              if (!projectId) {
                throw new Error('Failed to get project ID after retry');
              }
              return await this.getQuota(accessToken, projectId);
            }
            throw new AuthError('Auth expired and refresh failed');
          }
          throw error;
        }
      };

      const quotas = await executeWithRetry();
      const models = this.parseQuotaBuckets(quotas);

      const account: AccountQuota = {
        id: 'default',
        name: 'Gemini CLI',
        models,
        overallHealth: calculateOverallHealth(models),
      };

      return {
        provider: this.id,
        displayName: this.displayName,
        shortName: this.shortName,
        status: 'ok',
        accounts: [account],
        lastUpdated: new Date(),
      };
    } catch (error) {
      if (error instanceof AuthError) {
        return this.createAuthExpiredResult("Run 'gemini' to re-authenticate");
      }
      return this.createErrorResult(String(error));
    }
  }

  private async refreshToken(creds: GeminiOAuthCreds): Promise<string | null> {
    try {
      const clientId = creds.client_id || GEMINI_CLIENT_ID;
      const clientSecret = creds.client_secret || GEMINI_CLIENT_SECRET;

      const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: creds.refresh_token,
          client_id: clientId,
          client_secret: clientSecret,
        }),
      });

      if (!response.ok) return null;

      const data = await response.json() as { access_token: string; expires_in: number };
      
      // Update cached credentials
      const updatedCreds: GeminiOAuthCreds = {
        ...creds,
        access_token: data.access_token,
        expiry_date: Date.now() + data.expires_in * 1000,
      };
      await fs.writeFile(this.getCredentialPath(), JSON.stringify(updatedCreds, null, 2));

      return data.access_token;
    } catch {
      return null;
    }
  }

  private async getProjectId(accessToken: string): Promise<string | null> {
    const response = await fetch(GEMINI_CODE_ASSIST_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        metadata: {
          ideType: 'IDE_UNSPECIFIED',
          platform: 'PLATFORM_UNSPECIFIED',
          pluginType: 'GEMINI',
        },
      }),
    });

    if (response.status === 401 || response.status === 403) {
      throw new AuthError('Authentication failed');
    }

    if (!response.ok) return null;

    const data = await response.json() as LoadCodeAssistResponse;
    return data.cloudaicompanionProject || null;
  }

  private async getQuota(accessToken: string, projectId: string): Promise<QuotaBucket[]> {
    const response = await fetch(GEMINI_QUOTA_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ project: projectId }),
    });

    if (response.status === 401 || response.status === 403) {
      throw new AuthError('Authentication failed');
    }

    if (!response.ok) return [];

    const data = await response.json() as RetrieveQuotaResponse;
    return data.buckets || [];
  }

  private parseQuotaBuckets(buckets: QuotaBucket[]): ModelQuota[] {
    return buckets.map(bucket => {
      const remainingPercent = Math.round(bucket.remainingFraction * 100);
      return {
        name: bucket.modelId,
        displayName: this.formatModelName(bucket.modelId),
        remainingPercent,
        usedPercent: 100 - remainingPercent,
        resetTime: bucket.resetTime ? new Date(bucket.resetTime) : undefined,
      };
    });
  }

  private formatModelName(modelId: string): string {
    return modelId
      .replace(/-/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
  }
}
