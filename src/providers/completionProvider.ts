import * as vscode from 'vscode';
import { ConnectionManager } from '../managers/connectionManager';

/**
 * SQL keywords for autocomplete
 */
const SQL_KEYWORDS = [
    // DQL
    'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'LIKE', 'BETWEEN',
    'IS', 'NULL', 'AS', 'DISTINCT', 'ALL', 'TOP', 'LIMIT', 'OFFSET',
    'ORDER BY', 'ASC', 'DESC', 'GROUP BY', 'HAVING', 'UNION', 'INTERSECT', 'EXCEPT',
    'JOIN', 'INNER JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'FULL JOIN', 'CROSS JOIN',
    'ON', 'USING', 'NATURAL',

    // DML
    'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE',

    // DDL
    'CREATE', 'ALTER', 'DROP', 'TRUNCATE', 'TABLE', 'DATABASE', 'INDEX', 'VIEW',
    'PRIMARY KEY', 'FOREIGN KEY', 'REFERENCES', 'UNIQUE', 'CHECK', 'DEFAULT',
    'AUTO_INCREMENT', 'SERIAL', 'IDENTITY',

    // Data Types
    'INT', 'INTEGER', 'BIGINT', 'SMALLINT', 'TINYINT',
    'DECIMAL', 'NUMERIC', 'FLOAT', 'DOUBLE', 'REAL',
    'CHAR', 'VARCHAR', 'TEXT', 'NCHAR', 'NVARCHAR', 'NTEXT',
    'DATE', 'TIME', 'DATETIME', 'TIMESTAMP', 'YEAR',
    'BOOLEAN', 'BOOL', 'BIT',
    'BLOB', 'BINARY', 'VARBINARY',
    'JSON', 'JSONB', 'XML',

    // Functions
    'COUNT', 'SUM', 'AVG', 'MIN', 'MAX',
    'CONCAT', 'SUBSTRING', 'LENGTH', 'UPPER', 'LOWER', 'TRIM', 'REPLACE',
    'NOW', 'CURDATE', 'CURTIME', 'DATE_FORMAT', 'DATEDIFF',
    'COALESCE', 'NULLIF', 'IFNULL', 'NVL', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
    'CAST', 'CONVERT', 'ROUND', 'FLOOR', 'CEILING', 'ABS',

    // Transaction
    'BEGIN', 'COMMIT', 'ROLLBACK', 'SAVEPOINT', 'TRANSACTION',

    // Other
    'EXPLAIN', 'DESCRIBE', 'SHOW', 'USE', 'EXISTS', 'ANY', 'SOME'
];

/**
 * SQL Completion Provider
 */
export class SQLCompletionProvider implements vscode.CompletionItemProvider {
    private cachedTables: Map<string, string[]> = new Map();
    private cachedColumns: Map<string, Map<string, string[]>> = new Map();

    constructor(private connectionManager: ConnectionManager) {}

    async provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken,
        _context: vscode.CompletionContext
    ): Promise<vscode.CompletionItem[]> {
        const items: vscode.CompletionItem[] = [];
        const lineText = document.lineAt(position).text;
        const textBeforeCursor = lineText.substring(0, position.character);
        const wordRange = document.getWordRangeAtPosition(position);
        const currentWord = wordRange ? document.getText(wordRange).toLowerCase() : '';

        // Add SQL keywords
        items.push(...this.getKeywordCompletions(currentWord));

        // Add database objects if connected
        const activeConnection = this.connectionManager.getActiveConnection();
        if (activeConnection) {
            try {
                // Check context for smarter completions
                const upperText = textBeforeCursor.toUpperCase();

                if (this.isAfterFrom(upperText) || this.isAfterJoin(upperText)) {
                    // After FROM or JOIN - suggest tables
                    items.push(...await this.getTableCompletions(activeConnection));
                } else if (this.isAfterSelect(upperText) || this.isAfterWhere(upperText)) {
                    // After SELECT or WHERE - suggest columns and tables
                    items.push(...await this.getTableCompletions(activeConnection));
                    items.push(...await this.getColumnCompletions(activeConnection, textBeforeCursor));
                } else {
                    // Default - suggest tables
                    items.push(...await this.getTableCompletions(activeConnection));
                }
            } catch (error) {
                console.error('Error getting completions:', error);
            }
        }

        return items;
    }

    private getKeywordCompletions(currentWord: string): vscode.CompletionItem[] {
        return SQL_KEYWORDS
            .filter(kw => currentWord === '' || kw.toLowerCase().startsWith(currentWord))
            .map(keyword => {
                const item = new vscode.CompletionItem(keyword, vscode.CompletionItemKind.Keyword);
                item.detail = 'SQL Keyword';
                item.insertText = keyword;
                item.sortText = '1' + keyword; // Keywords come after tables/columns
                return item;
            });
    }

    private async getTableCompletions(connection: any): Promise<vscode.CompletionItem[]> {
        const items: vscode.CompletionItem[] = [];
        const connectionId = connection.config.id;

        // Use cached tables if available
        if (!this.cachedTables.has(connectionId)) {
            try {
                const databases = await connection.getDatabases();
                const allTables: string[] = [];

                for (const db of databases.slice(0, 5)) { // Limit to first 5 databases
                    try {
                        const tables = await connection.getTables(db);
                        allTables.push(...tables);
                    } catch {
                        // Skip databases we can't access
                    }
                }

                this.cachedTables.set(connectionId, [...new Set(allTables)]);
            } catch {
                return items;
            }
        }

        const tables = this.cachedTables.get(connectionId) || [];
        for (const table of tables) {
            const item = new vscode.CompletionItem(table, vscode.CompletionItemKind.Class);
            item.detail = 'Table';
            item.insertText = table;
            item.sortText = '0' + table; // Tables come first
            items.push(item);
        }

        return items;
    }

    private async getColumnCompletions(connection: any, textBeforeCursor: string): Promise<vscode.CompletionItem[]> {
        const items: vscode.CompletionItem[] = [];
        const connectionId = connection.config.id;

        // Extract table name from context
        const tableMatch = textBeforeCursor.match(/(?:FROM|JOIN|UPDATE)\s+(\w+)/i);
        if (!tableMatch) {
            return items;
        }

        const tableName = tableMatch[1];

        // Initialize column cache for this connection if needed
        if (!this.cachedColumns.has(connectionId)) {
            this.cachedColumns.set(connectionId, new Map());
        }

        const columnCache = this.cachedColumns.get(connectionId)!;

        // Get columns for this table
        if (!columnCache.has(tableName)) {
            try {
                const schema = await connection.getTableSchema(tableName);
                columnCache.set(tableName, schema.map((col: any) => col.name));
            } catch {
                return items;
            }
        }

        const columns = columnCache.get(tableName) || [];
        for (const column of columns) {
            const item = new vscode.CompletionItem(column, vscode.CompletionItemKind.Field);
            item.detail = `Column (${tableName})`;
            item.insertText = column;
            item.sortText = '0' + column;
            items.push(item);
        }

        return items;
    }

    private isAfterFrom(text: string): boolean {
        const fromIndex = text.lastIndexOf('FROM');
        if (fromIndex === -1) {return false;}
        const afterFrom = text.substring(fromIndex + 4);
        return !afterFrom.includes('WHERE') && !afterFrom.includes('JOIN') && !afterFrom.includes('ORDER');
    }

    private isAfterJoin(text: string): boolean {
        const joinIndex = Math.max(
            text.lastIndexOf('JOIN'),
            text.lastIndexOf('INNER JOIN'),
            text.lastIndexOf('LEFT JOIN'),
            text.lastIndexOf('RIGHT JOIN')
        );
        if (joinIndex === -1) {return false;}
        const afterJoin = text.substring(joinIndex);
        return !afterJoin.includes(' ON ');
    }

    private isAfterSelect(text: string): boolean {
        const selectIndex = text.lastIndexOf('SELECT');
        if (selectIndex === -1) {return false;}
        const afterSelect = text.substring(selectIndex + 6);
        return !afterSelect.includes('FROM');
    }

    private isAfterWhere(text: string): boolean {
        const whereIndex = text.lastIndexOf('WHERE');
        if (whereIndex === -1) {return false;}
        return true;
    }

    /**
     * Clear cached data
     */
    clearCache(): void {
        this.cachedTables.clear();
        this.cachedColumns.clear();
    }
}

/**
 * Register SQL completion provider
 */
export function registerCompletionProvider(
    context: vscode.ExtensionContext,
    connectionManager: ConnectionManager
): SQLCompletionProvider {
    const provider = new SQLCompletionProvider(connectionManager);

    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider(
            { language: 'sql' },
            provider,
            '.', ' ', '('
        )
    );

    // Clear cache when connection changes
    connectionManager.onDidChangeConnection(() => {
        provider.clearCache();
    });

    return provider;
}
