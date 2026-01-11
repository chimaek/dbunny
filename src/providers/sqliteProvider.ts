import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import * as fs from 'fs';
import * as path from 'path';
import { DatabaseConnection, ConnectionConfig, QueryResult, ColumnInfo, ForeignKeyInfo } from '../types/database';

/**
 * SQLite database provider using sql.js (pure JavaScript/WebAssembly)
 */
export class SQLiteProvider implements DatabaseConnection {
    private db: SqlJsDatabase | null = null;
    private dbPath: string = ':memory:';

    constructor(public config: ConnectionConfig) {}

    async connect(): Promise<void> {
        try {
            this.dbPath = this.config.database || ':memory:';

            // Initialize sql.js
            const SQL = await initSqlJs();

            if (this.dbPath === ':memory:') {
                // Create in-memory database
                this.db = new SQL.Database();
            } else {
                // Load database from file
                const absolutePath = path.isAbsolute(this.dbPath)
                    ? this.dbPath
                    : path.resolve(this.dbPath);

                if (!fs.existsSync(absolutePath)) {
                    throw new Error(`Database file not found: ${absolutePath}`);
                }

                const buffer = fs.readFileSync(absolutePath);
                this.db = new SQL.Database(buffer);
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            throw new Error(`Failed to connect to SQLite: ${message}`);
        }
    }

    async disconnect(): Promise<void> {
        if (this.db) {
            // Save changes to file before closing (if not in-memory)
            if (this.dbPath !== ':memory:') {
                this._saveToFile();
            }
            this.db.close();
            this.db = null;
        }
    }

    private _saveToFile(): void {
        if (this.db && this.dbPath !== ':memory:') {
            try {
                const data = this.db.export();
                const buffer = Buffer.from(data);
                fs.writeFileSync(this.dbPath, buffer);
            } catch (error) {
                console.error('Failed to save SQLite database:', error);
            }
        }
    }

    async executeQuery(query: string, _database?: string): Promise<QueryResult> {
        if (!this.db) {
            throw new Error('Not connected to database');
        }

        try {
            const startTime = Date.now();
            const trimmedQuery = query.trim().toUpperCase();

            if (trimmedQuery.startsWith('SELECT') || trimmedQuery.startsWith('PRAGMA') || trimmedQuery.startsWith('WITH')) {
                const results = this.db.exec(query);
                const executionTime = Date.now() - startTime;

                if (results.length === 0) {
                    return {
                        rows: [],
                        fields: [],
                        rowCount: 0,
                        executionTime
                    };
                }

                const result = results[0];
                const fields = result.columns.map(name => ({
                    name,
                    type: 'TEXT',
                    table: undefined
                }));

                const rows = result.values.map(row => {
                    const obj: Record<string, unknown> = {};
                    result.columns.forEach((col, idx) => {
                        obj[col] = row[idx];
                    });
                    return obj;
                });

                return {
                    rows,
                    fields,
                    rowCount: rows.length,
                    executionTime
                };
            } else {
                this.db.run(query);
                const executionTime = Date.now() - startTime;

                // Save changes for write operations
                this._saveToFile();

                return {
                    rows: [],
                    fields: [],
                    rowCount: this.db.getRowsModified(),
                    executionTime
                };
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            throw new Error(`Query execution failed: ${message}`);
        }
    }

    async getDatabases(): Promise<string[]> {
        // SQLite doesn't have multiple databases
        const dbName = this.dbPath === ':memory:' ? 'memory' : path.basename(this.dbPath);
        return [dbName];
    }

    async getTables(_database: string): Promise<string[]> {
        const result = await this.executeQuery(
            `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
        );
        return result.rows.map((row) => row.name as string);
    }

    async getTableSchema(table: string): Promise<ColumnInfo[]> {
        const safeTable = table.replace(/'/g, "''");
        const result = await this.executeQuery(`PRAGMA table_info('${safeTable}')`);
        return result.rows.map((row) => ({
            name: row.name as string,
            type: (row.type as string) || 'TEXT',
            nullable: row.notnull === 0,
            primaryKey: row.pk === 1,
            defaultValue: row.dflt_value as string | undefined
        }));
    }

    isConnected(): boolean {
        return this.db !== null;
    }

    async getCreateTableStatement(table: string): Promise<string> {
        const safeTable = table.replace(/'/g, "''");
        const result = await this.executeQuery(
            `SELECT sql FROM sqlite_master WHERE type='table' AND name='${safeTable}'`
        );
        if (result.rows.length > 0 && result.rows[0].sql) {
            return result.rows[0].sql as string;
        }
        throw new Error(`Could not get CREATE TABLE statement for ${table}`);
    }

    async getForeignKeys(table: string): Promise<ForeignKeyInfo[]> {
        const safeTable = table.replace(/'/g, "''");
        const result = await this.executeQuery(`PRAGMA foreign_key_list('${safeTable}')`);

        return result.rows.map((row, index) => ({
            constraintName: `fk_${table}_${index}`,
            columnName: row.from as string,
            referencedTable: row.table as string,
            referencedColumn: row.to as string
        }));
    }
}
