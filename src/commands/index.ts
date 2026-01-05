import * as vscode from 'vscode';
import { ConnectionManager } from '../managers/connectionManager';
import { ConnectionTreeProvider, ConnectionTreeItem } from '../views/connectionTreeView';
import { QueryHistoryProvider } from '../views/queryHistoryView';
import { I18n } from '../utils/i18n';
import { ConnectionFormPanel } from '../webview/ConnectionFormPanel';
import { QueryResultPanel } from '../webview/QueryResultPanel';
import { TableEditorPanel } from '../webview/TableEditorPanel';

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
            if (!item?.connectionId) {return;}

            const connection = connectionManager.getConnection(item.connectionId);
            if (!connection) {return;}

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
            if (!item?.connectionId) {return;}

            const connection = connectionManager.getConnection(item.connectionId);
            if (!connection) {return;}

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
            if (!item?.connectionId) {return;}

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
            const activeConnection = connectionManager.getActiveConnection();
            const dbType = activeConnection?.config.type || 'sql';

            let language = 'sql';
            let content = '-- DBunny Query\n-- SELECT * FROM table_name;\n\n';

            switch (dbType) {
                case 'redis':
                    language = 'plaintext';
                    content = `# Redis Commands
# Key-Value: GET key, SET key value, DEL key
# Hash: HGET key field, HSET key field value, HGETALL key
# List: LPUSH key value, RPUSH key value, LRANGE key 0 -1
# Set: SADD key value, SMEMBERS key, SCARD key
# Sorted Set: ZADD key score value, ZRANGE key 0 -1
# Other: KEYS *, SCAN 0, TTL key, EXPIRE key seconds
# Database: SELECT 0 (switch to db 0-15)

KEYS *
`;
                    break;
                case 'mongodb':
                    language = 'javascript';
                    content = `// MongoDB Query (JSON format)
// Find: db.collection.find({ field: "value" })
// Insert: db.collection.insertOne({ field: "value" })
// Update: db.collection.updateOne({ _id: id }, { $set: { field: "value" } })
// Delete: db.collection.deleteOne({ _id: id })

db.collectionName.find({})
`;
                    break;
                case 'mysql':
                    content = '-- MySQL Query\n-- SELECT * FROM table_name;\n-- SHOW DATABASES;\n-- SHOW TABLES;\n\n';
                    break;
                case 'postgres':
                    content = '-- PostgreSQL Query\n-- SELECT * FROM table_name;\n-- \\dt (list tables)\n-- \\d table_name (describe table)\n\n';
                    break;
                case 'sqlite':
                    content = '-- SQLite Query\n-- SELECT * FROM table_name;\n-- .tables (list tables)\n-- PRAGMA table_info(table_name);\n\n';
                    break;
            }

            const doc = await vscode.workspace.openTextDocument({
                language,
                content
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

    // Edit Table Data
    context.subscriptions.push(
        vscode.commands.registerCommand('dbunny.editTableData', async (item: ConnectionTreeItem) => {
            const activeConnection = connectionManager.getActiveConnection();
            if (!activeConnection) {
                vscode.window.showWarningMessage(i18n.t('messages.noConnection'));
                return;
            }

            // Get table name from tree item
            const tableName = item?.label?.toString() || '';
            if (!tableName) {
                vscode.window.showWarningMessage(i18n.t('messages.noTableSelected'));
                return;
            }

            // Get database name from connection config
            const databaseName = activeConnection.config.database || '';

            await TableEditorPanel.createOrShow(
                context.extensionUri,
                connectionManager,
                i18n,
                tableName,
                databaseName
            );
        })
    );

    // View Key/Document Data (for NoSQL databases)
    context.subscriptions.push(
        vscode.commands.registerCommand('dbunny.viewKeyData', async (item: ConnectionTreeItem) => {
            const activeConnection = connectionManager.getActiveConnection();
            if (!activeConnection) {
                vscode.window.showWarningMessage(i18n.t('messages.noConnection'));
                return;
            }

            const keyName = item?.label?.toString() || '';
            if (!keyName) {
                vscode.window.showWarningMessage('No key selected');
                return;
            }

            const dbType = activeConnection.config.type;
            const resultPanel = QueryResultPanel.createOrShow(context.extensionUri, i18n);
            resultPanel.showLoading(keyName);

            try {
                let query = '';
                if (dbType === 'redis') {
                    // For Redis, first get the key type to use appropriate command
                    const typeResult = await activeConnection.executeQuery(`TYPE ${keyName}`);
                    const keyType = typeResult.rows[0]?.result?.toString() || 'string';

                    switch (keyType) {
                        case 'string':
                            query = `GET ${keyName}`;
                            break;
                        case 'hash':
                            query = `HGETALL ${keyName}`;
                            break;
                        case 'list':
                            query = `LRANGE ${keyName} 0 -1`;
                            break;
                        case 'set':
                            query = `SMEMBERS ${keyName}`;
                            break;
                        case 'zset':
                            query = `ZRANGE ${keyName} 0 -1 WITHSCORES`;
                            break;
                        default:
                            query = `GET ${keyName}`;
                    }
                } else if (dbType === 'mongodb') {
                    // For MongoDB, query the collection
                    query = `db.${keyName}.find({}).limit(100)`;
                }

                const result = await activeConnection.executeQuery(query);
                resultPanel.updateResults(query, result);

            } catch (error) {
                const message = error instanceof Error ? error.message : 'Unknown error';
                resultPanel.showError(keyName, message);
            }
        })
    );

    // Clear Query History
    context.subscriptions.push(
        vscode.commands.registerCommand('dbunny.clearHistory', async () => {
            const confirm = await vscode.window.showWarningMessage(
                'Clear all query history?',
                { modal: true },
                'Clear'
            );
            if (confirm === 'Clear') {
                await queryHistoryProvider.clearHistory();
                vscode.window.showInformationMessage('Query history cleared');
            }
        })
    );

    // Listen for connection changes to refresh tree
    connectionManager.onDidChangeConnections(() => {
        connectionTreeProvider.refresh();
    });
}
