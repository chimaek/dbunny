import * as vscode from 'vscode';
import { ConnectionManager } from '../managers/connectionManager';
import { DatabaseConnection, ColumnInfo, ForeignKeyInfo } from '../types/database';
import { parseSQL, TableReference, SQLParseResult } from '../utils/sqlParser';

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
 * SQL Completion Provider — v2.0.0 고도화
 *
 * - 별칭(Alias) 인식: `u.` → users 테이블 컬럼 제안
 * - JOIN ON FK 기반 자동 제안
 * - 서브쿼리 컨텍스트 인식
 * - 다중 테이블 참조 시 컬럼 자동 구분
 */
export class SQLCompletionProvider implements vscode.CompletionItemProvider {
    private cachedTables: Map<string, string[]> = new Map();
    private cachedColumns: Map<string, Map<string, ColumnInfo[]>> = new Map();
    private cachedForeignKeys: Map<string, Map<string, ForeignKeyInfo[]>> = new Map();

    constructor(private connectionManager: ConnectionManager) {}

    async provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken,
        _context: vscode.CompletionContext
    ): Promise<vscode.CompletionItem[]> {
        const items: vscode.CompletionItem[] = [];

        // 전체 문서 텍스트와 커서 위치
        const fullText = document.getText();
        const cursorOffset = document.offsetAt(position);
        const lineText = document.lineAt(position).text;
        const _textBeforeCursor = lineText.substring(0, position.character);
        const wordRange = document.getWordRangeAtPosition(position);
        const currentWord = wordRange ? document.getText(wordRange).toLowerCase() : '';

        // SQL 파싱
        const parseResult = parseSQL(fullText, cursorOffset);

        // SQL 키워드 제안
        items.push(...this.getKeywordCompletions(currentWord));

        // DB 연결이 있을 때만 테이블/컬럼 제안
        const activeConnection = this.connectionManager.getActiveConnection();
        if (!activeConnection) {
            return items;
        }

        try {
            const ctx = parseResult.cursorContext;

            switch (ctx.type) {
                case 'ALIAS_DOT': {
                    // alias. → 해당 테이블의 컬럼 제안
                    const tableName = parseResult.aliasMap.get(ctx.alias.toLowerCase());
                    if (tableName) {
                        items.push(...await this.getColumnsForTable(activeConnection, tableName, ctx.alias));
                    }
                    break;
                }

                case 'FROM_TABLE':
                case 'JOIN_TABLE':
                case 'UPDATE_TABLE':
                case 'INSERT_INTO':
                    // 테이블 제안
                    items.push(...await this.getTableCompletions(activeConnection));
                    break;

                case 'JOIN_ON': {
                    // FK 기반 ON 조건 자동 제안
                    items.push(...await this.getJoinOnSuggestions(
                        activeConnection, parseResult, ctx.joinTable
                    ));
                    // 일반 컬럼도 제안
                    items.push(...await this.getAllReferencedColumns(activeConnection, parseResult));
                    break;
                }

                case 'SELECT_COLUMNS':
                case 'WHERE':
                case 'GROUP_BY':
                case 'ORDER_BY':
                case 'SET_CLAUSE': {
                    // 다중 테이블 참조 시 컬럼 자동 구분
                    if (parseResult.tables.length > 1) {
                        items.push(...await this.getMultiTableColumns(activeConnection, parseResult));
                    } else if (parseResult.tables.length === 1) {
                        items.push(...await this.getColumnsForTable(
                            activeConnection,
                            parseResult.tables[0].table,
                            parseResult.tables[0].alias
                        ));
                    }
                    // 테이블도 제안 (서브쿼리 등에서 쓸 수 있으므로)
                    items.push(...await this.getTableCompletions(activeConnection));
                    break;
                }

                default:
                    items.push(...await this.getTableCompletions(activeConnection));
                    break;
            }
        } catch (error) {
            console.error('Error getting completions:', error);
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
                item.sortText = '1' + keyword;
                return item;
            });
    }

    private async getTableCompletions(connection: DatabaseConnection): Promise<vscode.CompletionItem[]> {
        const items: vscode.CompletionItem[] = [];
        const connectionId = connection.config.id;

        if (!this.cachedTables.has(connectionId)) {
            try {
                const databases = await connection.getDatabases();
                const allTables: string[] = [];

                for (const db of databases.slice(0, 5)) {
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
            item.sortText = '0' + table;
            items.push(item);
        }

        return items;
    }

    /**
     * 특정 테이블의 컬럼 제안
     */
    private async getColumnsForTable(
        connection: DatabaseConnection,
        tableName: string,
        aliasOrTable?: string
    ): Promise<vscode.CompletionItem[]> {
        const columns = await this.fetchColumns(connection, tableName);
        const _label = aliasOrTable || tableName;

        return columns.map(col => {
            const item = new vscode.CompletionItem(col.name, vscode.CompletionItemKind.Field);
            item.detail = `${col.type} (${tableName})`;
            item.documentation = this.buildColumnDoc(col, tableName);
            item.insertText = col.name;
            item.sortText = '0' + col.name;
            return item;
        });
    }

    /**
     * 다중 테이블 참조 시 — 테이블/별칭 접두사 포함 컬럼 제안
     */
    private async getMultiTableColumns(
        connection: DatabaseConnection,
        parseResult: SQLParseResult
    ): Promise<vscode.CompletionItem[]> {
        const items: vscode.CompletionItem[] = [];

        for (const ref of parseResult.tables) {
            const columns = await this.fetchColumns(connection, ref.table);
            const prefix = ref.alias || ref.table;

            for (const col of columns) {
                // 접두사 포함 제안: u.name, p.title 등
                const prefixedItem = new vscode.CompletionItem(
                    `${prefix}.${col.name}`,
                    vscode.CompletionItemKind.Field
                );
                prefixedItem.detail = `${col.type} (${ref.table}${ref.alias ? ` AS ${ref.alias}` : ''})`;
                prefixedItem.documentation = this.buildColumnDoc(col, ref.table);
                prefixedItem.insertText = `${prefix}.${col.name}`;
                prefixedItem.sortText = '0' + prefix + '.' + col.name;
                items.push(prefixedItem);

                // 컬럼 이름만으로도 제안 (소속 테이블 표시)
                const plainItem = new vscode.CompletionItem(col.name, vscode.CompletionItemKind.Field);
                plainItem.detail = `${col.type} (${ref.table})`;
                plainItem.documentation = this.buildColumnDoc(col, ref.table);
                plainItem.insertText = col.name;
                plainItem.sortText = '0z' + col.name;
                items.push(plainItem);
            }
        }

        return items;
    }

    /**
     * 참조된 모든 테이블의 컬럼 제안 (JOIN ON 등에서 사용)
     */
    private async getAllReferencedColumns(
        connection: DatabaseConnection,
        parseResult: SQLParseResult
    ): Promise<vscode.CompletionItem[]> {
        const items: vscode.CompletionItem[] = [];

        for (const ref of parseResult.tables) {
            const columns = await this.fetchColumns(connection, ref.table);
            const prefix = ref.alias || ref.table;

            for (const col of columns) {
                const item = new vscode.CompletionItem(
                    `${prefix}.${col.name}`,
                    vscode.CompletionItemKind.Field
                );
                item.detail = `${col.type} (${ref.table})`;
                item.insertText = `${prefix}.${col.name}`;
                item.sortText = '0' + prefix + '.' + col.name;
                items.push(item);
            }
        }

        return items;
    }

    /**
     * JOIN ON 절에서 FK 기반 조건 자동 제안
     */
    private async getJoinOnSuggestions(
        connection: DatabaseConnection,
        parseResult: SQLParseResult,
        joinTable: TableReference
    ): Promise<vscode.CompletionItem[]> {
        const items: vscode.CompletionItem[] = [];

        if (!connection.getForeignKeys) {
            return items;
        }

        // JOIN 대상 테이블의 FK 조회
        const joinFKs = await this.fetchForeignKeys(connection, joinTable.table);
        const joinAlias = joinTable.alias || joinTable.table;

        // 기존 테이블들 (FROM 절)에서 참조되는 FK 찾기
        for (const fk of joinFKs) {
            const referencedRef = parseResult.tables.find(
                t => t.table.toLowerCase() === fk.referencedTable.toLowerCase()
            );
            if (referencedRef) {
                const refAlias = referencedRef.alias || referencedRef.table;
                const condition = `${joinAlias}.${fk.columnName} = ${refAlias}.${fk.referencedColumn}`;

                const item = new vscode.CompletionItem(condition, vscode.CompletionItemKind.Snippet);
                item.detail = `FK: ${fk.constraintName}`;
                item.documentation = new vscode.MarkdownString(
                    `**Foreign Key Join**\n\n` +
                    `\`${joinTable.table}.${fk.columnName}\` → \`${fk.referencedTable}.${fk.referencedColumn}\``
                );
                item.insertText = condition;
                item.sortText = '00' + condition; // FK 제안을 최우선으로
                items.push(item);
            }
        }

        // 역방향: FROM 테이블의 FK가 JOIN 테이블을 참조하는 경우
        for (const ref of parseResult.tables) {
            if (ref.table.toLowerCase() === joinTable.table.toLowerCase()) {continue;}
            const refFKs = await this.fetchForeignKeys(connection, ref.table);
            const refAlias = ref.alias || ref.table;

            for (const fk of refFKs) {
                if (fk.referencedTable.toLowerCase() === joinTable.table.toLowerCase()) {
                    const condition = `${refAlias}.${fk.columnName} = ${joinAlias}.${fk.referencedColumn}`;

                    const item = new vscode.CompletionItem(condition, vscode.CompletionItemKind.Snippet);
                    item.detail = `FK: ${fk.constraintName}`;
                    item.documentation = new vscode.MarkdownString(
                        `**Foreign Key Join**\n\n` +
                        `\`${ref.table}.${fk.columnName}\` → \`${joinTable.table}.${fk.referencedColumn}\``
                    );
                    item.insertText = condition;
                    item.sortText = '00' + condition;
                    items.push(item);
                }
            }
        }

        return items;
    }

    /**
     * 컬럼 정보 가져오기 (캐시 사용)
     */
    private async fetchColumns(connection: DatabaseConnection, tableName: string): Promise<ColumnInfo[]> {
        const connectionId = connection.config.id;

        if (!this.cachedColumns.has(connectionId)) {
            this.cachedColumns.set(connectionId, new Map());
        }

        const columnCache = this.cachedColumns.get(connectionId)!;
        const key = tableName.toLowerCase();

        if (!columnCache.has(key)) {
            try {
                const schema = await connection.getTableSchema(tableName);
                columnCache.set(key, schema);
            } catch {
                return [];
            }
        }

        return columnCache.get(key) || [];
    }

    /**
     * FK 정보 가져오기 (캐시 사용)
     */
    private async fetchForeignKeys(connection: DatabaseConnection, tableName: string): Promise<ForeignKeyInfo[]> {
        if (!connection.getForeignKeys) {
            return [];
        }

        const connectionId = connection.config.id;

        if (!this.cachedForeignKeys.has(connectionId)) {
            this.cachedForeignKeys.set(connectionId, new Map());
        }

        const fkCache = this.cachedForeignKeys.get(connectionId)!;
        const key = tableName.toLowerCase();

        if (!fkCache.has(key)) {
            try {
                const fks = await connection.getForeignKeys(tableName);
                fkCache.set(key, fks);
            } catch {
                return [];
            }
        }

        return fkCache.get(key) || [];
    }

    /**
     * 컬럼 문서화 문자열 생성
     */
    private buildColumnDoc(col: ColumnInfo, tableName: string): vscode.MarkdownString {
        const lines = [`**${tableName}.${col.name}**`, '', `Type: \`${col.type}\``];
        if (col.primaryKey) {lines.push('Primary Key');}
        if (!col.nullable) {lines.push('NOT NULL');}
        if (col.defaultValue !== undefined) {lines.push(`Default: \`${col.defaultValue}\``);}
        return new vscode.MarkdownString(lines.join('\n'));
    }

    /**
     * Clear cached data
     */
    clearCache(): void {
        this.cachedTables.clear();
        this.cachedColumns.clear();
        this.cachedForeignKeys.clear();
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
