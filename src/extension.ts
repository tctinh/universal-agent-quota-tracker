import * as vscode from 'vscode';
import { ProviderRegistry } from './providers';
import { QuotaTreeProvider } from './views/quotaTreeProvider';
import { QuotaStatusBar } from './views/statusBar';
import { RefreshManager, ApiKeyService } from './services';
import { setZaiApiKey } from './providers/zai';

let refreshManager: RefreshManager | undefined;
let apiKeyService: ApiKeyService | undefined;

export function activate(context: vscode.ExtensionContext) {
  console.log('Universal Agent Quota extension is activating');

  const registry = new ProviderRegistry();
  const treeProvider = new QuotaTreeProvider(registry);
  const statusBar = new QuotaStatusBar(registry);
  apiKeyService = new ApiKeyService(context.secrets);

  refreshManager = new RefreshManager(
    registry,
    treeProvider,
    statusBar
  );

  const treeView = vscode.window.createTreeView('universalQuotaView', {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
  });

  const refreshCommand = vscode.commands.registerCommand(
    'universalQuota.refresh',
    () => refreshManager?.refresh()
  );

  const showDetailsCommand = vscode.commands.registerCommand(
    'universalQuota.showDetails',
    () => vscode.commands.executeCommand('universalQuotaView.focus')
  );

  const configureCommand = vscode.commands.registerCommand(
    'universalQuota.configure',
    () => vscode.commands.executeCommand('workbench.action.openSettings', 'universalQuota')
  );

  const setZaiKeyCommand = vscode.commands.registerCommand(
    'universalQuota.setZaiApiKey',
    async () => {
      if (!apiKeyService) return;
      const success = await apiKeyService.promptForApiKey('zai');
      if (success) {
        await updateZaiApiKey(context);
        await refreshManager?.refresh();
      }
    }
  );

  updateZaiApiKey(context);

  refreshManager.startAutoRefresh();
  refreshManager.refresh();

  context.subscriptions.push(
    treeView,
    refreshCommand,
    showDetailsCommand,
    configureCommand,
    setZaiKeyCommand,
    statusBar,
    refreshManager,
    vscode.workspace.onDidChangeConfiguration(async e => {
      if (e.affectsConfiguration('universalQuota.providers.zai.apiKey')) {
        await updateZaiApiKey(context);
        await refreshManager?.refresh();
      }
    })
  );

  console.log('Universal Agent Quota extension activated');
}

async function updateZaiApiKey(context: vscode.ExtensionContext): Promise<void> {
  const config = vscode.workspace.getConfiguration('universalQuota');
  const settingKey = config.get<string>('providers.zai.apiKey');
  
  if (settingKey) {
    setZaiApiKey(settingKey);
  } else {
    const storedKey = await context.secrets.get('universalQuota.zai.apiKey');
    setZaiApiKey(storedKey);
  }
}

export function deactivate() {
  refreshManager?.dispose();
  console.log('Universal Agent Quota extension deactivated');
}
