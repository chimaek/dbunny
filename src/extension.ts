import * as vscode from 'vscode';
import { ConnectionTreeProvider } from './views/connectionTreeView';
import { QueryHistoryProvider } from './views/queryHistoryView';
import { SavedQueriesProvider } from './views/savedQueriesView';
import { ConnectionManager } from './managers/connectionManager';
import { I18n } from './utils/i18n';
import { registerCommands } from './commands';
import { registerCompletionProvider } from './providers/completionProvider';

let connectionManagerInstance: ConnectionManager | null = null;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    console.log('DBunny extension is now active!');

    // Initialize i18n
    const i18n = I18n.getInstance(context);
    await i18n.initialize();

    // Initialize connection manager
    const connectionManager = new ConnectionManager(context);
    connectionManagerInstance = connectionManager;

    // Register tree view providers
    const connectionTreeProvider = new ConnectionTreeProvider(connectionManager, i18n);
    const queryHistoryProvider = new QueryHistoryProvider(context, i18n);
    const savedQueriesProvider = new SavedQueriesProvider(context, i18n);

    context.subscriptions.push(
        vscode.window.registerTreeDataProvider('dbunny.explorer', connectionTreeProvider),
        vscode.window.registerTreeDataProvider('dbunny.savedQueries', savedQueriesProvider),
        vscode.window.registerTreeDataProvider('dbunny.queries', queryHistoryProvider)
    );

    // Register commands
    registerCommands(context, connectionManager, connectionTreeProvider, queryHistoryProvider, savedQueriesProvider, i18n);

    // Register SQL autocomplete provider
    registerCompletionProvider(context, connectionManager);

    // Create status bar item
    const statusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        100
    );
    statusBarItem.text = '$(database) DBunny: Disconnected';
    statusBarItem.tooltip = i18n.t('status.disconnected');
    statusBarItem.command = 'dbunny.addConnection';
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    // Listen for connection changes and track disposable
    const connectionChangeDisposable = connectionManager.onDidChangeConnection((connection) => {
        if (connection) {
            statusBarItem.text = `$(database) DBunny: ${connection.config.name}`;
            statusBarItem.tooltip = i18n.t('status.connected', { name: connection.config.name });
        } else {
            statusBarItem.text = '$(database) DBunny: Disconnected';
            statusBarItem.tooltip = i18n.t('status.disconnected');
        }
        connectionTreeProvider.refresh();
    });
    context.subscriptions.push(connectionChangeDisposable);

    // Register cleanup on deactivation
    context.subscriptions.push({
        dispose: () => {
            connectionManager.dispose();
            connectionManagerInstance = null;
        }
    });

    // Show welcome message
    vscode.window.showInformationMessage(i18n.t('messages.welcome'));
}

export function deactivate(): void {
    if (connectionManagerInstance) {
        connectionManagerInstance.dispose();
        connectionManagerInstance = null;
    }
    console.log('DBunny extension is now deactivated. Goodbye!');
}
