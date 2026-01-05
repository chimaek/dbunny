import * as vscode from 'vscode';
import { ConnectionManager } from '../managers/connectionManager';
import { ConnectionTreeProvider, ConnectionTreeItem } from '../views/connectionTreeView';
import { QueryHistoryProvider } from '../views/queryHistoryView';
import { I18n } from '../utils/i18n';
import { ConnectionFormPanel } from '../webview/ConnectionFormPanel';
import { QueryResultPanel } from '../webview/QueryResultPanel';

/**
 * Register all commands
 */
export function registerCommands(
    context: vscode.ExtensionContext,
    connectionManager: ConnectionManager,
    connectionTreeProvider: ConnectionTreeProvider,
    queryHistoryProvider: QueryHistoryProvider,
    i18n: I18n
): void {
    // Add Connection (Webview)
    context.subscriptions.push(
        vscode.commands.registerCommand('dbunny.addConnection', () => {
            ConnectionFormPanel.createOrShow(
                context.extensionUri,
                connectionManager,
                i18n
            );
        })
    );

    // Edit Connection (Webview)
    context.subscriptions.push(
        vscode.commands.registerCommand('dbunny.editConnection', (item: ConnectionTreeItem) => {
            if (!item?.connectionId) return;

            const connection = connectionManager.getConnection(item.connectionId);
            if (!connection) return;

            ConnectionFormPanel.createOrShow(
                context.extensionUri,
                connectionManager,
                i18n,
                connection.config
            );
        })
    );

    // Delete Connection
    context.subscriptions.push(
        vscode.commands.registerCommand('dbunny.deleteConnection', async (item: ConnectionTreeItem) => {
            if (!item?.connectionId) return;

            const connection = connectionManager.getConnection(item.connectionId);
            if (!connection) return;

            const confirm = await vscode.window.showWarningMessage(
                i18n.t('messages.deleteConfirm', { name: connection.config.name }),
                { modal: true },
                i18n.t('common.delete')
            );

            if (confirm) {
                try {
                    await connectionManager.deleteConnection(item.connectionId);
                    connectionTreeProvider.refresh();
                    vscode.window.showInformationMessage(
                        i18n.t('messages.connectionDeleted', { name: connection.config.name })
                    );
                } catch (error) {
                    const message = error instanceof Error ? error.message : 'Unknown error';
                    vscode.window.showErrorMessage(
                        i18n.t('messages.connectionDeleteFailed', { error: message })
                    );
                }
            }
        })
    );

    // Connect
    context.subscriptions.push(
        vscode.commands.registerCommand('dbunny.connect', async (item: ConnectionTreeItem) => {
            if (!item?.connectionId) return;

            try {
                await vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: i18n.t('messages.connecting'),
                        cancellable: false
                    },
                    async () => {
                        await connectionManager.connect(item.connectionId!);
                    }
                );
                connectionTreeProvider.refresh();
                vscode.window.showInformationMessage(
                    i18n.t('messages.connected', { name: item.label })
                );
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Unknown error';
                vscode.window.showErrorMessage(
                    i18n.t('messages.connectionFailed', { error: message })
                );
            }
        })
    );

    // Disconnect
    context.subscriptions.push(
        vscode.commands.registerCommand('dbunny.disconnect', async () => {
            try {
                await connectionManager.disconnect();
                connectionTreeProvider.refresh();
                vscode.window.showInformationMessage(i18n.t('messages.disconnected'));
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Unknown error';
                vscode.window.showErrorMessage(
                    i18n.t('messages.disconnectFailed', { error: message })
                );
            }
        })
    );

    // Refresh
    context.subscriptions.push(
        vscode.commands.registerCommand('dbunny.refreshConnection', () => {
            connectionTreeProvider.refresh();
        })
    );

    // Execute Query (with Webview Result)
    context.subscriptions.push(
        vscode.commands.registerCommand('dbunny.executeQuery', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showWarningMessage(i18n.t('messages.noEditor'));
                return;
            }

            const activeConnection = connectionManager.getActiveConnection();
            if (!activeConnection) {
                vscode.window.showWarningMessage(i18n.t('messages.noConnection'));
                return;
            }

            const query = editor.document.getText(editor.selection.isEmpty ? undefined : editor.selection);
            if (!query.trim()) {
                vscode.window.showWarningMessage(i18n.t('messages.noQuery'));
                return;
            }

            // Create or show result panel
            const resultPanel = QueryResultPanel.createOrShow(context.extensionUri, i18n);
            resultPanel.showLoading(query);

            try {
                const result = await connectionManager.executeQuery(query);

                // Add to history
                await queryHistoryProvider.addQuery({
                    query,
                    connectionId: activeConnection.config.id,
                    connectionName: activeConnection.config.name,
                    executedAt: new Date(),
                    executionTime: result.executionTime,
                    rowCount: result.rowCount,
                    status: 'success'
                });

                // Show results in webview
                resultPanel.updateResults(query, result);

            } catch (error) {
                const message = error instanceof Error ? error.message : 'Unknown error';

                // Add to history as error
                await queryHistoryProvider.addQuery({
                    query,
                    connectionId: activeConnection.config.id,
                    connectionName: activeConnection.config.name,
                    executedAt: new Date(),
                    executionTime: 0,
                    rowCount: 0,
                    status: 'error',
                    error: message
                });

                // Show error in webview
                resultPanel.showError(query, message);
            }
        })
    );

    // New Query
    context.subscriptions.push(
        vscode.commands.registerCommand('dbunny.newQuery', async () => {
            const doc = await vscode.workspace.openTextDocument({
                language: 'sql',
                content: '-- DBunny Query\n\n'
            });
            await vscode.window.showTextDocument(doc);
        })
    );

    // Copy Query
    context.subscriptions.push(
        vscode.commands.registerCommand('dbunny.copyQuery', async (query: string) => {
            await vscode.env.clipboard.writeText(query);
            vscode.window.showInformationMessage(i18n.t('messages.queryCopied'));
        })
    );

    // Export Data
    context.subscriptions.push(
        vscode.commands.registerCommand('dbunny.exportData', async () => {
            vscode.window.showInformationMessage('Export feature coming soon!');
        })
    );

    // Listen for connection changes to refresh tree
    connectionManager.onDidChangeConnections(() => {
        connectionTreeProvider.refresh();
    });
}
