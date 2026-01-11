import * as vscode from 'vscode';
import { ConnectionManager } from '../managers/connectionManager';
import { ConnectionTreeProvider, ConnectionTreeItem } from '../views/connectionTreeView';
import { QueryHistoryProvider } from '../views/queryHistoryView';
import { SavedQueriesProvider, SavedQueryTreeItem } from '../views/savedQueriesView';
import { I18n } from '../utils/i18n';
import { ConnectionFormPanel } from '../webview/ConnectionFormPanel';
import { QueryResultPanel } from '../webview/QueryResultPanel';
import { TableEditorPanel } from '../webview/TableEditorPanel';
import { ERDPanel } from '../webview/ERDPanel';
import { SchemaComparePanel, TableCompareInfo } from '../webview/SchemaComparePanel';
import { MockDataPanel } from '../webview/MockDataPanel';
import { MigrationPanel } from '../webview/MigrationPanel';
import { MonitoringPanel } from '../webview/MonitoringPanel';
import { QueryTabPanel } from '../webview/QueryTabPanel';
import { TableERDInfo } from '../types/database';
import { SqlCodeLensProvider } from '../providers/sqlCodeLensProvider';
import { format } from 'sql-formatter';

/**
 * Register all commands
 */
export function registerCommands(
    context: vscode.ExtensionContext,
    connectionManager: ConnectionManager,
    connectionTreeProvider: ConnectionTreeProvider,
    queryHistoryProvider: QueryHistoryProvider,
    savedQueriesProvider: SavedQueriesProvider,
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

            // Get database name from tree item (not from connection config!)
            const databaseName = item?.databaseName || activeConnection.config.database || '';

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
                    const keyType = (typeResult.rows[0]?.value as string)?.toLowerCase() || 'string';

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
                        case 'none':
                            throw new Error(`Key "${keyName}" does not exist`);
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

    // Execute Query at Cursor (for CodeLens)
    context.subscriptions.push(
        vscode.commands.registerCommand('dbunny.executeQueryAtCursor', async (
            document: vscode.TextDocument,
            startLine: number,
            endLine: number
        ) => {
            const activeConnection = connectionManager.getActiveConnection();
            if (!activeConnection) {
                vscode.window.showWarningMessage(i18n.t('messages.noConnection'));
                return;
            }

            // Extract query from the specified lines
            const lines: string[] = [];
            for (let i = startLine; i <= endLine; i++) {
                lines.push(document.lineAt(i).text);
            }
            const query = lines.join('\n').trim();

            if (!query) {
                vscode.window.showWarningMessage(i18n.t('messages.noQuery'));
                return;
            }

            const resultPanel = QueryResultPanel.createOrShow(context.extensionUri, i18n);
            resultPanel.showLoading(query);

            try {
                const result = await connectionManager.executeQuery(query);

                await queryHistoryProvider.addQuery({
                    query,
                    connectionId: activeConnection.config.id,
                    connectionName: activeConnection.config.name,
                    executedAt: new Date(),
                    executionTime: result.executionTime,
                    rowCount: result.rowCount,
                    status: 'success'
                });

                resultPanel.updateResults(query, result);
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Unknown error';

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

                resultPanel.showError(query, message);
            }
        })
    );

    // Register SQL CodeLens provider
    const codeLensProvider = new SqlCodeLensProvider();
    context.subscriptions.push(
        vscode.languages.registerCodeLensProvider(
            [
                { language: 'sql' },
                { language: 'plpgsql' },
                { language: 'mysql' },
                { pattern: '**/*.sql' }
            ],
            codeLensProvider
        )
    );

    // Save Query Bookmark
    context.subscriptions.push(
        vscode.commands.registerCommand('dbunny.saveQueryBookmark', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showWarningMessage(i18n.t('messages.noEditor'));
                return;
            }

            const query = editor.document.getText(editor.selection.isEmpty ? undefined : editor.selection);
            if (!query.trim()) {
                vscode.window.showWarningMessage(i18n.t('messages.noQuery'));
                return;
            }

            const name = await vscode.window.showInputBox({
                prompt: i18n.t('savedQueries.enterName'),
                placeHolder: i18n.t('savedQueries.namePlaceholder')
            });

            if (!name) {return;}

            const description = await vscode.window.showInputBox({
                prompt: i18n.t('savedQueries.enterDescription'),
                placeHolder: i18n.t('savedQueries.descriptionPlaceholder')
            });

            const categories = savedQueriesProvider.getCategories();
            let category: string | undefined;

            if (categories.length > 0) {
                const selected = await vscode.window.showQuickPick(
                    [...categories, '+ ' + i18n.t('savedQueries.newCategory')],
                    { placeHolder: i18n.t('savedQueries.selectCategory') }
                );

                if (selected?.startsWith('+ ')) {
                    category = await vscode.window.showInputBox({
                        prompt: i18n.t('savedQueries.enterCategory'),
                        placeHolder: i18n.t('savedQueries.categoryPlaceholder')
                    });
                } else {
                    category = selected;
                }
            } else {
                category = await vscode.window.showInputBox({
                    prompt: i18n.t('savedQueries.enterCategory'),
                    placeHolder: i18n.t('savedQueries.categoryPlaceholder')
                });
            }

            const activeConnection = connectionManager.getActiveConnection();

            await savedQueriesProvider.saveQuery({
                name,
                query: query.trim(),
                description,
                category,
                databaseType: activeConnection?.config.type
            });

            vscode.window.showInformationMessage(i18n.t('savedQueries.saved', { name }));
        })
    );

    // Load Saved Query
    context.subscriptions.push(
        vscode.commands.registerCommand('dbunny.loadSavedQuery', async (savedQuery: { query: string; name: string }) => {
            const doc = await vscode.workspace.openTextDocument({
                language: 'sql',
                content: savedQuery.query
            });
            await vscode.window.showTextDocument(doc);
        })
    );

    // Edit Saved Query
    context.subscriptions.push(
        vscode.commands.registerCommand('dbunny.editSavedQuery', async (item: SavedQueryTreeItem) => {
            if (!item?.savedQuery) {return;}

            const savedQuery = item.savedQuery;

            const name = await vscode.window.showInputBox({
                prompt: i18n.t('savedQueries.enterName'),
                value: savedQuery.name
            });

            if (!name) {return;}

            const description = await vscode.window.showInputBox({
                prompt: i18n.t('savedQueries.enterDescription'),
                value: savedQuery.description || ''
            });

            const category = await vscode.window.showInputBox({
                prompt: i18n.t('savedQueries.enterCategory'),
                value: savedQuery.category || ''
            });

            await savedQueriesProvider.updateQuery(savedQuery.id, {
                name,
                description,
                category
            });

            vscode.window.showInformationMessage(i18n.t('savedQueries.updated', { name }));
        })
    );

    // Delete Saved Query
    context.subscriptions.push(
        vscode.commands.registerCommand('dbunny.deleteSavedQuery', async (item: SavedQueryTreeItem) => {
            if (!item?.savedQuery) {return;}

            const confirm = await vscode.window.showWarningMessage(
                i18n.t('savedQueries.deleteConfirm', { name: item.savedQuery.name }),
                { modal: true },
                i18n.t('common.delete')
            );

            if (confirm) {
                await savedQueriesProvider.deleteQuery(item.savedQuery.id);
                vscode.window.showInformationMessage(
                    i18n.t('savedQueries.deleted', { name: item.savedQuery.name })
                );
            }
        })
    );

    // Clear All Saved Queries
    context.subscriptions.push(
        vscode.commands.registerCommand('dbunny.clearSavedQueries', async () => {
            const confirm = await vscode.window.showWarningMessage(
                i18n.t('savedQueries.clearConfirm'),
                { modal: true },
                i18n.t('common.delete')
            );

            if (confirm) {
                const queries = savedQueriesProvider.getAllQueries();
                for (const query of queries) {
                    await savedQueriesProvider.deleteQuery(query.id);
                }
                vscode.window.showInformationMessage(i18n.t('savedQueries.cleared'));
            }
        })
    );

    // Format SQL
    context.subscriptions.push(
        vscode.commands.registerCommand('dbunny.formatSQL', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showWarningMessage(i18n.t('messages.noEditor'));
                return;
            }

            const document = editor.document;
            const selection = editor.selection;
            const text = selection.isEmpty
                ? document.getText()
                : document.getText(selection);

            if (!text.trim()) {
                vscode.window.showWarningMessage(i18n.t('messages.noQuery'));
                return;
            }

            try {
                const activeConnection = connectionManager.getActiveConnection();
                let language: 'sql' | 'mysql' | 'postgresql' | 'sqlite' = 'sql';

                switch (activeConnection?.config.type) {
                    case 'mysql':
                        language = 'mysql';
                        break;
                    case 'postgres':
                        language = 'postgresql';
                        break;
                    case 'sqlite':
                        language = 'sqlite';
                        break;
                }

                const formatted = format(text, {
                    language,
                    tabWidth: 2,
                    keywordCase: 'upper',
                    linesBetweenQueries: 2
                });

                await editor.edit(editBuilder => {
                    if (selection.isEmpty) {
                        const fullRange = new vscode.Range(
                            document.positionAt(0),
                            document.positionAt(document.getText().length)
                        );
                        editBuilder.replace(fullRange, formatted);
                    } else {
                        editBuilder.replace(selection, formatted);
                    }
                });

                vscode.window.showInformationMessage(i18n.t('messages.queryFormatted'));
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Unknown error';
                vscode.window.showErrorMessage(i18n.t('messages.formatFailed', { error: message }));
            }
        })
    );

    // Copy Table Schema (CREATE TABLE)
    context.subscriptions.push(
        vscode.commands.registerCommand('dbunny.copyTableSchema', async (item: ConnectionTreeItem) => {
            const activeConnection = connectionManager.getActiveConnection();
            if (!activeConnection) {
                vscode.window.showWarningMessage(i18n.t('messages.noConnection'));
                return;
            }

            const tableName = item?.label?.toString() || '';
            if (!tableName) {
                vscode.window.showWarningMessage(i18n.t('messages.noTableSelected'));
                return;
            }

            // Get database name from tree item
            const databaseName = item?.databaseName || activeConnection.config.database || '';

            try {
                let createStatement: string;

                if (activeConnection.getCreateTableStatement) {
                    createStatement = await activeConnection.getCreateTableStatement(tableName, databaseName);
                } else {
                    // Fallback: generate from schema
                    const schema = await activeConnection.getTableSchema(tableName, databaseName);
                    const columns = schema.map(col => {
                        let def = `  ${col.name} ${col.type}`;
                        if (!col.nullable) {def += ' NOT NULL';}
                        if (col.defaultValue) {def += ` DEFAULT ${col.defaultValue}`;}
                        if (col.primaryKey) {def += ' PRIMARY KEY';}
                        return def;
                    });
                    createStatement = `CREATE TABLE ${tableName} (\n${columns.join(',\n')}\n);`;
                }

                await vscode.env.clipboard.writeText(createStatement);
                vscode.window.showInformationMessage(i18n.t('messages.schemaCopied', { table: tableName }));
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Unknown error';
                vscode.window.showErrorMessage(i18n.t('messages.schemaCopyFailed', { error: message }));
            }
        })
    );

    // Explain Query (Show Execution Plan)
    context.subscriptions.push(
        vscode.commands.registerCommand('dbunny.explainQuery', async () => {
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

            const dbType = activeConnection.config.type;
            if (dbType === 'mongodb' || dbType === 'redis') {
                vscode.window.showWarningMessage(i18n.t('messages.explainNotSupported'));
                return;
            }

            try {
                let explainQuery: string;

                switch (dbType) {
                    case 'mysql':
                        explainQuery = `EXPLAIN ${query}`;
                        break;
                    case 'postgres':
                        explainQuery = `EXPLAIN ANALYZE ${query}`;
                        break;
                    case 'sqlite':
                        explainQuery = `EXPLAIN QUERY PLAN ${query}`;
                        break;
                    default:
                        explainQuery = `EXPLAIN ${query}`;
                }

                const resultPanel = QueryResultPanel.createOrShow(context.extensionUri, i18n);
                resultPanel.showLoading(explainQuery);

                const result = await activeConnection.executeQuery(explainQuery);
                resultPanel.updateResults(explainQuery, result);

                await queryHistoryProvider.addQuery({
                    query: explainQuery,
                    connectionId: activeConnection.config.id,
                    connectionName: activeConnection.config.name,
                    executedAt: new Date(),
                    executionTime: result.executionTime,
                    rowCount: result.rowCount,
                    status: 'success'
                });

            } catch (error) {
                const message = error instanceof Error ? error.message : 'Unknown error';
                vscode.window.showErrorMessage(i18n.t('messages.explainFailed', { error: message }));
            }
        })
    );

    // Set Connection Group
    context.subscriptions.push(
        vscode.commands.registerCommand('dbunny.setConnectionGroup', async (item: ConnectionTreeItem) => {
            if (!item?.connectionId) {return;}

            const groups = connectionManager.getGroups();
            const options = [
                i18n.t('groups.noGroup'),
                ...groups,
                '+ ' + i18n.t('groups.newGroup')
            ];

            const selected = await vscode.window.showQuickPick(options, {
                placeHolder: i18n.t('groups.selectGroup')
            });

            if (!selected) {return;}

            let group: string | undefined;

            if (selected === i18n.t('groups.noGroup')) {
                group = undefined;
            } else if (selected.startsWith('+ ')) {
                group = await vscode.window.showInputBox({
                    prompt: i18n.t('groups.enterGroupName'),
                    placeHolder: i18n.t('groups.groupNamePlaceholder')
                });
                if (!group) {return;}
            } else {
                group = selected;
            }

            try {
                await connectionManager.setConnectionGroup(item.connectionId, group);
                connectionTreeProvider.refresh();
                vscode.window.showInformationMessage(
                    group
                        ? i18n.t('groups.connectionMoved', { group })
                        : i18n.t('groups.connectionUngrouped')
                );
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Unknown error';
                vscode.window.showErrorMessage(i18n.t('groups.moveFailed', { error: message }));
            }
        })
    );

    // Rename Group
    context.subscriptions.push(
        vscode.commands.registerCommand('dbunny.renameGroup', async (item: ConnectionTreeItem) => {
            if (!item?.groupName) {return;}

            const newName = await vscode.window.showInputBox({
                prompt: i18n.t('groups.enterNewGroupName'),
                value: item.groupName
            });

            if (!newName || newName === item.groupName) {return;}

            try {
                await connectionManager.renameGroup(item.groupName, newName);
                connectionTreeProvider.refresh();
                vscode.window.showInformationMessage(
                    i18n.t('groups.groupRenamed', { oldName: item.groupName, newName })
                );
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Unknown error';
                vscode.window.showErrorMessage(i18n.t('groups.renameFailed', { error: message }));
            }
        })
    );

    // Delete Group
    context.subscriptions.push(
        vscode.commands.registerCommand('dbunny.deleteGroup', async (item: ConnectionTreeItem) => {
            if (!item?.groupName) {return;}

            const confirm = await vscode.window.showWarningMessage(
                i18n.t('groups.deleteConfirm', { name: item.groupName }),
                { modal: true },
                i18n.t('common.delete')
            );

            if (confirm) {
                try {
                    await connectionManager.deleteGroup(item.groupName);
                    connectionTreeProvider.refresh();
                    vscode.window.showInformationMessage(
                        i18n.t('groups.groupDeleted', { name: item.groupName })
                    );
                } catch (error) {
                    const message = error instanceof Error ? error.message : 'Unknown error';
                    vscode.window.showErrorMessage(i18n.t('groups.deleteFailed', { error: message }));
                }
            }
        })
    );

    // Show ERD Diagram
    context.subscriptions.push(
        vscode.commands.registerCommand('dbunny.showERD', async (item: ConnectionTreeItem) => {
            const activeConnection = connectionManager.getActiveConnection();
            if (!activeConnection) {
                vscode.window.showWarningMessage(i18n.t('messages.noConnection'));
                return;
            }

            const dbType = activeConnection.config.type;
            if (dbType === 'mongodb' || dbType === 'redis') {
                vscode.window.showWarningMessage(i18n.t('erd.notSupported'));
                return;
            }

            const databaseName = item?.databaseName || activeConnection.config.database || 'Database';

            const erdPanel = ERDPanel.createOrShow(context.extensionUri, i18n);
            erdPanel.showLoading();

            try {
                // Get all tables
                const tables = await activeConnection.getTables(databaseName);
                const tableInfos: TableERDInfo[] = [];

                // Get schema and foreign keys for each table
                for (const tableName of tables) {
                    const columns = await activeConnection.getTableSchema(tableName, databaseName);
                    let foreignKeys: { constraintName: string; columnName: string; referencedTable: string; referencedColumn: string }[] = [];

                    if (activeConnection.getForeignKeys) {
                        foreignKeys = await activeConnection.getForeignKeys(tableName, databaseName);
                    }

                    tableInfos.push({
                        name: tableName,
                        columns,
                        foreignKeys
                    });
                }

                erdPanel.updateERD(tableInfos, databaseName);

            } catch (error) {
                const message = error instanceof Error ? error.message : 'Unknown error';
                vscode.window.showErrorMessage(i18n.t('erd.loadFailed', { error: message }));
            }
        })
    );

    // Compare Schema
    context.subscriptions.push(
        vscode.commands.registerCommand('dbunny.compareSchema', async (item: ConnectionTreeItem) => {
            const activeConnection = connectionManager.getActiveConnection();
            if (!activeConnection) {
                vscode.window.showWarningMessage(i18n.t('messages.noConnection'));
                return;
            }

            const dbType = activeConnection.config.type;
            if (dbType === 'mongodb' || dbType === 'redis') {
                vscode.window.showWarningMessage(i18n.t('compare.notSupported'));
                return;
            }

            const sourceTable = item?.label?.toString() || '';
            if (!sourceTable) {
                vscode.window.showWarningMessage(i18n.t('messages.noTableSelected'));
                return;
            }

            // Get all tables for selection
            const databaseName = item?.databaseName || activeConnection.config.database || '';
            const tables = await activeConnection.getTables(databaseName);
            const otherTables = tables.filter(t => t !== sourceTable);

            if (otherTables.length === 0) {
                vscode.window.showWarningMessage(i18n.t('compare.noOtherTables'));
                return;
            }

            const targetTable = await vscode.window.showQuickPick(otherTables, {
                placeHolder: i18n.t('compare.selectTarget')
            });

            if (!targetTable) { return; }

            const comparePanel = SchemaComparePanel.createOrShow(context.extensionUri, i18n);
            comparePanel.showLoading();

            try {
                const sourceColumns = await activeConnection.getTableSchema(sourceTable);
                const targetColumns = await activeConnection.getTableSchema(targetTable);

                const leftTable: TableCompareInfo = { name: sourceTable, columns: sourceColumns };
                const rightTable: TableCompareInfo = { name: targetTable, columns: targetColumns };

                comparePanel.showComparison(leftTable, rightTable, databaseName, databaseName);

            } catch (error) {
                const message = error instanceof Error ? error.message : 'Unknown error';
                vscode.window.showErrorMessage(i18n.t('compare.failed', { error: message }));
            }
        })
    );

    // Generate Mock Data
    context.subscriptions.push(
        vscode.commands.registerCommand('dbunny.generateMockData', async (item: ConnectionTreeItem) => {
            const activeConnection = connectionManager.getActiveConnection();
            if (!activeConnection) {
                vscode.window.showWarningMessage(i18n.t('messages.noConnection'));
                return;
            }

            const dbType = activeConnection.config.type;
            if (dbType === 'mongodb' || dbType === 'redis') {
                vscode.window.showWarningMessage(i18n.t('mockData.notSupported'));
                return;
            }

            const tableName = item?.label?.toString() || '';
            if (!tableName) {
                vscode.window.showWarningMessage(i18n.t('messages.noTableSelected'));
                return;
            }

            try {
                const columns = await activeConnection.getTableSchema(tableName);
                const mockPanel = MockDataPanel.createOrShow(context.extensionUri, i18n);
                mockPanel.showGenerator(tableName, columns, dbType);

            } catch (error) {
                const message = error instanceof Error ? error.message : 'Unknown error';
                vscode.window.showErrorMessage(i18n.t('mockData.loadFailed', { error: message }));
            }
        })
    );

    // Show Migration Panel
    context.subscriptions.push(
        vscode.commands.registerCommand('dbunny.showMigration', async (_item: ConnectionTreeItem) => {
            const activeConnection = connectionManager.getActiveConnection();
            if (!activeConnection) {
                vscode.window.showWarningMessage(i18n.t('messages.noConnection'));
                return;
            }

            const dbType = activeConnection.config.type;
            if (dbType === 'mongodb' || dbType === 'redis') {
                vscode.window.showWarningMessage(i18n.t('migration.notSupported'));
                return;
            }

            MigrationPanel.createOrShow(
                context.extensionUri,
                i18n,
                context
            );
        })
    );

    // Show Monitoring Panel
    context.subscriptions.push(
        vscode.commands.registerCommand('dbunny.showMonitoring', async () => {
            const activeConnection = connectionManager.getActiveConnection();
            if (!activeConnection) {
                vscode.window.showWarningMessage(i18n.t('messages.noConnection'));
                return;
            }

            const dbType = activeConnection.config.type;
            if (dbType !== 'mysql' && dbType !== 'postgres') {
                vscode.window.showWarningMessage(i18n.t('monitoring.notSupported'));
                return;
            }

            MonitoringPanel.createOrShow(
                context.extensionUri,
                activeConnection,
                activeConnection.config,
                i18n
            );
        })
    );

    // Open Query Tabs (Multi-Tab Query Editor)
    context.subscriptions.push(
        vscode.commands.registerCommand('dbunny.openQueryTabs', () => {
            QueryTabPanel.createOrShow(
                context.extensionUri,
                connectionManager,
                i18n,
                queryHistoryProvider
            );
        })
    );

    // Toggle Table Favorite
    context.subscriptions.push(
        vscode.commands.registerCommand('dbunny.toggleFavorite', async (item: ConnectionTreeItem) => {
            if (!item?.connectionId || !item?.databaseName || !item?.tableName) {
                return;
            }

            try {
                const isFavorite = await connectionManager.toggleFavorite(
                    item.connectionId,
                    item.databaseName,
                    item.tableName
                );
                connectionTreeProvider.refresh();

                const message = isFavorite
                    ? i18n.t('favorites.added', { table: item.tableName })
                    : i18n.t('favorites.removed', { table: item.tableName });
                vscode.window.showInformationMessage(message);
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Unknown error';
                vscode.window.showErrorMessage(i18n.t('favorites.toggleFailed', { error: message }));
            }
        })
    );

    // Listen for connection changes to refresh tree
    connectionManager.onDidChangeConnections(() => {
        connectionTreeProvider.refresh();
    });
}
