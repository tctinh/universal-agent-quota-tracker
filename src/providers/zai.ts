import { BaseQuotaProvider } from './base';
import { ProviderQuotaResult, AccountQuota, ModelQuota } from '../types';
import { calculateOverallHealth } from '../utils/health';

const ZAI_QUOTA_ENDPOINT = 'https://api.z.ai/api/monitor/usage/quota/limit';

interface ZaiLimit {
  type: string;
  usage: number;
  currentValue: number;
  remaining: number;
  percentage: number;
  nextResetTime?: number;
}

interface ZaiQuotaResponse {
  success?: boolean;
  data?: {
    limits?: ZaiLimit[];
  };
}

let storedApiKey: string | undefined;

export function setZaiApiKey(key: string | undefined): void {
  storedApiKey = key;
}

export class ZaiProvider extends BaseQuotaProvider {
  readonly id = 'zai';
  readonly displayName = 'Z.AI';
  readonly shortName = 'ZA';

  private getApiKey(): string | null {
    return storedApiKey
      || process.env.ZAI_API_KEY 
      || process.env.ZAI_KEY 
      || process.env.ZHIPU_API_KEY 
      || process.env.ZHIPUAI_API_KEY 
      || null;
  }

  async isConfigured(): Promise<boolean> {
    return this.getApiKey() !== null;
  }

  async fetchQuota(): Promise<ProviderQuotaResult> {
    const apiKey = this.getApiKey();

    if (!apiKey) {
      return this.createNotConfiguredResult("Set API key in settings (universalQuota.providers.zai.apiKey) or run 'Set Z.AI API Key' command");
    }

    try {
      const response = await fetch(ZAI_QUOTA_ENDPOINT, {
        method: 'GET',
        headers: {
          'Authorization': apiKey,
          'Content-Type': 'application/json',
        },
      });

      if (response.status === 401) {
        return this.createErrorResult('Invalid API key', 'Check API key');
      }

      if (!response.ok) {
        return this.createErrorResult(`API error: ${response.status}`);
      }

      const data = await response.json() as ZaiQuotaResponse;
      
      if (!data.success || !data.data?.limits) {
        return this.createErrorResult('Unexpected API response');
      }

      const models: ModelQuota[] = data.data.limits.map(limit => {
        const usedPercent = limit.percentage;
        const remainingPercent = 100 - usedPercent;
        
        let displayName: string;
        switch (limit.type) {
          case 'TOKENS_LIMIT':
            displayName = 'Tokens';
            break;
          case 'TIME_LIMIT':
            displayName = 'Requests';
            break;
          default:
            displayName = limit.type;
        }

        return {
          name: limit.type.toLowerCase(),
          displayName,
          remainingPercent: Math.round(remainingPercent),
          usedPercent: Math.round(usedPercent),
          resetTime: limit.nextResetTime ? new Date(limit.nextResetTime) : undefined,
        };
      });

      const account: AccountQuota = {
        id: 'default',
        name: 'Z.AI',
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
      return this.createErrorResult(String(error));
    }
  }
}
