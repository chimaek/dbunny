import Database from 'better-sqlite3';
import { DatabaseConnection, ConnectionConfig, QueryResult, ColumnInfo } from '../types/database';

/**
 * SQLite database provider
 */
export class SQLiteProvider implements DatabaseConnection {
    private db: Database.Database | null = null;

    constructor(public config: ConnectionConfig) {}

    async connect(): Promise<void> {
        try {
            const dbPath = this.config.database || ':memory:';
            this.db = new Database(dbPath, {
                readonly: false,
                fileMustExist: dbPath !== ':memory:'
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            throw new Error(`Failed to connect to SQLite: ${message}`);
        }
    }

    async disconnect(): Promise<void> {
        if (this.db) {
            this.db.close();
            this.db = null;
        }
    }

    async executeQuery(query: string): Promise<QueryResult> {
        if (!this.db) {
            throw new Error('Not connected to database');
        }

        try {
            const startTime = Date.now();
            const trimmedQuery = query.trim().toUpperCase();

            if (trimmedQuery.startsWith('SELECT') || trimmedQuery.startsWith('PRAGMA')) {
                const stmt = this.db.prepare(query);
                const rows = stmt.all() as Record<string, unknown>[];
                const executionTime = Date.now() - startTime;

                const fields = rows.length > 0
                    ? Object.keys(rows[0]).map(name => ({
                        name,
                        type: 'TEXT',
                        table: undefined
                    }))
                    : [];

                return {
                    rows,
                    fields,
                    rowCount: rows.length,
                    executionTime
                };
            } else {
                this.db.exec(query);
                const executionTime = Date.now() - startTime;

                return {
                    rows: [],
                    fields: [],
                    rowCount: 0,
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
        return [this.config.database || 'main'];
    }

    async getTables(_database: string): Promise<string[]> {
        const result = await this.executeQuery(
            `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`
        );
        return result.rows.map((row) => row.name as string);
    }

    async getTableSchema(table: string): Promise<ColumnInfo[]> {
        const safeTable = table.replace(/'/g, "''");
        const result = await this.executeQuery(`PRAGMA table_info('${safeTable}')`);
        return result.rows.map((row) => ({
            name: row.name as string,
            type: row.type as string,
            nullable: row.notnull === 0,
            primaryKey: row.pk === 1,
            defaultValue: row.dflt_value as string | undefined
        }));
    }

    isConnected(): boolean {
        return this.db !== null;
    }
}
