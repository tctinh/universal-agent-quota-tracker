export type ProviderStatus = 'ok' | 'not_configured' | 'auth_expired' | 'error';
export type HealthStatus = 'good' | 'warning' | 'critical' | 'unknown';
export type TrendDirection = 'up' | 'down' | 'stable';

export interface ModelQuota {
  name: string;
  displayName?: string;
  remainingPercent: number;  // 0-100
  usedPercent: number;       // 0-100
  resetTime?: Date;
  trend?: TrendDirection;
}

export interface AccountQuota {
  id: string;
  name: string;
  models: ModelQuota[];
  overallHealth: HealthStatus;
  subscriptionTier?: string;  // FREE, PRO, ULTRA
  isForbidden?: boolean;      // Account has 403 Forbidden status
}

export interface ProviderQuotaResult {
  provider: string;
  displayName: string;
  shortName: string;
  status: ProviderStatus;
  accounts: AccountQuota[];
  error?: string;
  hint?: string;
  lastUpdated: Date;
}

export interface ProviderConfig {
  enabled: boolean;
}
