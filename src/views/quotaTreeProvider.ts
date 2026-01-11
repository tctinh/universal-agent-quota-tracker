import * as vscode from 'vscode';
import { ProviderRegistry } from '../providers';
import { ProviderQuotaResult, AccountQuota, ModelQuota, HealthStatus } from '../types';
import { getHealthThemeIcon, getHealthEmoji, getProviderIcon } from '../utils/health';
import { formatTimeUntil } from '../utils/time';

type TreeItemData = ProviderQuotaResult | AccountQuota | ModelQuota;

export class QuotaTreeItem extends vscode.TreeItem {
  constructor(
    public readonly data: TreeItemData,
    public readonly type: 'provider' | 'account' | 'model',
    collapsibleState: vscode.TreeItemCollapsibleState,
  ) {
    super('', collapsibleState);
    this.configure();
  }

  private configure(): void {
    switch (this.type) {
      case 'provider':
        this.configureProvider(this.data as ProviderQuotaResult);
        break;
      case 'account':
        this.configureAccount(this.data as AccountQuota);
        break;
      case 'model':
        this.configureModel(this.data as ModelQuota);
        break;
    }
  }

  private configureProvider(provider: ProviderQuotaResult): void {
    this.label = provider.displayName;
    this.contextValue = 'provider';

    switch (provider.status) {
      case 'ok':
        const accountCount = provider.accounts.length;
        const totalModels = provider.accounts.reduce((sum, acc) => sum + acc.models.length, 0);
        const worstHealth = this.getWorstHealth(provider.accounts);
        const minRemaining = Math.min(...provider.accounts.flatMap(a => a.models.map(m => m.remainingPercent)));
        
        this.iconPath = getProviderIcon(provider.provider);
        
        if (accountCount === 1) {
          this.description = `${isNaN(minRemaining) ? 0 : minRemaining}% (${totalModels} models)`;
        } else {
          this.description = `${accountCount} accounts`;
        }
        break;

      case 'not_configured':
        this.description = 'Not configured';
        this.iconPath = new vscode.ThemeIcon('circle-slash');
        this.tooltip = provider.hint;
        break;

      case 'auth_expired':
        this.description = 'Auth expired';
        this.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('problemsWarningIcon.foreground'));
        this.tooltip = provider.hint;
        break;

      case 'error':
        this.description = 'Error';
        this.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('problemsErrorIcon.foreground'));
        this.tooltip = `${provider.error}${provider.hint ? `\n${provider.hint}` : ''}`;
        break;
    }
  }

  private configureAccount(account: AccountQuota): void {
    this.label = account.name;
    this.contextValue = 'account';
    this.iconPath = getHealthThemeIcon(account.overallHealth);

    // Build description with tier and quota info
    const parts: string[] = [];
    
    // Add subscription tier badge
    if (account.subscriptionTier) {
      const tier = account.subscriptionTier.toUpperCase();
      if (tier.includes('ULTRA')) {
        parts.push('💎 ULTRA');
      } else if (tier.includes('PRO')) {
        parts.push('⭐ PRO');
      } else {
        parts.push('FREE');
      }
    }

    // Add forbidden status
    if (account.isForbidden) {
      parts.push('🔒 Forbidden');
    }

    // Show model count and worst remaining
    const modelCount = account.models.length;
    if (modelCount > 0) {
      const minRemaining = Math.min(...account.models.map(m => m.remainingPercent));
      parts.push(`${minRemaining}% (${modelCount} models)`);
    } else if (!account.isForbidden) {
      parts.push('No quota data');
    }

    this.description = parts.join(' · ');
  }

  private configureModel(model: ModelQuota): void {
    this.label = model.displayName || model.name;
    this.contextValue = 'model';

    // Visual bar
    const barWidth = 10;
    const filledCount = Math.round((model.remainingPercent / 100) * barWidth);
    const bar = '█'.repeat(filledCount) + '░'.repeat(barWidth - filledCount);

    let description = `${bar} ${model.remainingPercent}%`;
    if (model.resetTime) {
      description += ` ⏱️ ${formatTimeUntil(model.resetTime)}`;
    }
    this.description = description;

    // Health icon
    let health: HealthStatus;
    if (model.remainingPercent >= 70) health = 'good';
    else if (model.remainingPercent >= 30) health = 'warning';
    else health = 'critical';
    this.iconPath = getHealthThemeIcon(health);

    // Tooltip
    const tooltipLines = [
      `${model.displayName || model.name}`,
      `Remaining: ${model.remainingPercent}%`,
      `Used: ${model.usedPercent}%`,
    ];
    if (model.resetTime) {
      tooltipLines.push(`Resets: ${model.resetTime.toLocaleString()}`);
    }
    this.tooltip = tooltipLines.join('\n');
  }

  private getWorstHealth(accounts: AccountQuota[]): HealthStatus {
    if (accounts.length === 0) return 'unknown';
    
    const healthPriority: Record<HealthStatus, number> = {
      'critical': 3,
      'warning': 2,
      'unknown': 1,
      'good': 0,
    };
    
    let worst: HealthStatus = 'good';
    for (const account of accounts) {
      if (healthPriority[account.overallHealth] > healthPriority[worst]) {
        worst = account.overallHealth;
      }
    }
    return worst;
  }
}

export class QuotaTreeProvider implements vscode.TreeDataProvider<QuotaTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<QuotaTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private registry: ProviderRegistry) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: QuotaTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: QuotaTreeItem): Promise<QuotaTreeItem[]> {
    if (!element) {
      // Root level: return providers
      const results = this.registry.getCached();
      
      // If no cached data, return empty (will be populated after first refresh)
      if (results.length === 0) {
        return [];
      }

      return results.map(result => {
        const hasChildren = result.status === 'ok' && result.accounts.length > 0;
        return new QuotaTreeItem(
          result,
          'provider',
          hasChildren ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None
        );
      });
    }

    if (element.type === 'provider') {
      const provider = element.data as ProviderQuotaResult;
      if (provider.status !== 'ok') return [];

      if (provider.accounts.length === 1) {
        return provider.accounts[0].models.map(model =>
          new QuotaTreeItem(model, 'model', vscode.TreeItemCollapsibleState.None)
        );
      }

      return provider.accounts.map(account => {
        const hasChildren = account.models.length > 0;
        const shouldExpand = account.models.length <= 3;
        return new QuotaTreeItem(
          account,
          'account',
          hasChildren 
            ? (shouldExpand ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed)
            : vscode.TreeItemCollapsibleState.None
        );
      });
    }

    if (element.type === 'account') {
      // Account level: return models
      const account = element.data as AccountQuota;
      return account.models.map(model => 
        new QuotaTreeItem(model, 'model', vscode.TreeItemCollapsibleState.None)
      );
    }

    return [];
  }
}
