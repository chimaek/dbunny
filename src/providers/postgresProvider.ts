import { Client } from 'pg';
import { Client as SSHClient } from 'ssh2';
import { DatabaseConnection, ConnectionConfig, QueryResult, ColumnInfo } from '../types/database';

/**
 * PostgreSQL database provider
 */
export class PostgresProvider implements DatabaseConnection {
    private client: Client | null = null;
    private sshClient: SSHClient | null = null;

    constructor(public config: ConnectionConfig) {}

    async connect(): Promise<void> {
        try {
            // Establish SSH tunnel if configured
            if (this.config.ssh) {
                await this.establishSSHTunnel();
            }

            // Create PostgreSQL client
            this.client = new Client({
                host: this.config.host,
                port: this.config.port || 5432,
                user: this.config.username,
                password: this.config.password,
                database: this.config.database || 'postgres',
                connectionTimeoutMillis: 10000
            });

            await this.client.connect();
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            throw new Error(`Failed to connect to PostgreSQL: ${message}`);
        }
    }

    async disconnect(): Promise<void> {
        if (this.client) {
            await this.client.end();
            this.client = null;
        }
        if (this.sshClient) {
            this.sshClient.end();
            this.sshClient = null;
        }
    }

    async executeQuery(query: string): Promise<QueryResult> {
        if (!this.client) {
            throw new Error('Not connected to database');
        }

        try {
            const startTime = Date.now();
            const result = await this.client.query(query);
            const executionTime = Date.now() - startTime;

            return {
                rows: result.rows,
                fields: result.fields.map(f => ({
                    name: f.name,
                    type: String(f.dataTypeID),
                    table: f.tableID ? String(f.tableID) : undefined
                })),
                rowCount: result.rowCount || 0,
                executionTime
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            throw new Error(`Query execution failed: ${message}`);
        }
    }

    async getDatabases(): Promise<string[]> {
        const result = await this.executeQuery(
            `SELECT datname FROM pg_database WHERE datistemplate = false`
        );
        return result.rows.map((row) => row.datname as string);
    }

    async getTables(_database: string): Promise<string[]> {
        // Note: In PostgreSQL, we query from the current database's schema
        const result = await this.executeQuery(`
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public'
            AND table_type = 'BASE TABLE'
        `);
        return result.rows.map((row) => row.table_name as string);
    }

    async getTableSchema(table: string): Promise<ColumnInfo[]> {
        const safeTable = table.replace(/'/g, "''");
        const result = await this.executeQuery(`
            SELECT
                c.column_name,
                c.data_type,
                c.is_nullable,
                c.column_default,
                CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END as is_primary
            FROM information_schema.columns c
            LEFT JOIN (
                SELECT ku.column_name
                FROM information_schema.table_constraints tc
                JOIN information_schema.key_column_usage ku
                    ON tc.constraint_name = ku.constraint_name
                WHERE tc.constraint_type = 'PRIMARY KEY'
                    AND tc.table_name = '${safeTable}'
            ) pk ON c.column_name = pk.column_name
            WHERE c.table_name = '${safeTable}'
            AND c.table_schema = 'public'
        `);

        return result.rows.map((row) => ({
            name: row.column_name as string,
            type: row.data_type as string,
            nullable: row.is_nullable === 'YES',
            primaryKey: row.is_primary as boolean,
            defaultValue: row.column_default as string | undefined
        }));
    }

    isConnected(): boolean {
        return this.client !== null;
    }

    async getCreateTableStatement(table: string): Promise<string> {
        const schema = await this.getTableSchema(table);
        const safeTable = table.replace(/"/g, '""');

        const columns = schema.map(col => {
            let def = `    "${col.name}" ${col.type.toUpperCase()}`;
            if (!col.nullable) {
                def += ' NOT NULL';
            }
            if (col.defaultValue) {
                def += ` DEFAULT ${col.defaultValue}`;
            }
            return def;
        });

        const primaryKeys = schema.filter(col => col.primaryKey).map(col => `"${col.name}"`);
        if (primaryKeys.length > 0) {
            columns.push(`    PRIMARY KEY (${primaryKeys.join(', ')})`);
        }

        return `CREATE TABLE "${safeTable}" (\n${columns.join(',\n')}\n);`;
    }

    private async establishSSHTunnel(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.sshClient = new SSHClient();

            this.sshClient.on('ready', () => {
                this.sshClient!.forwardOut(
                    '127.0.0.1',
                    0,
                    this.config.host,
                    this.config.port || 5432,
                    (err) => {
                        if (err) {
                            reject(new Error(`SSH tunnel failed: ${err.message}`));
                            return;
                        }
                        resolve();
                    }
                );
            });

            this.sshClient.on('error', (err) => {
                reject(new Error(`SSH connection failed: ${err.message}`));
            });

            const sshConfig = this.config.ssh!;
            this.sshClient.connect({
                host: sshConfig.host,
                port: sshConfig.port || 22,
                username: sshConfig.username,
                password: sshConfig.password,
                privateKey: sshConfig.privateKey
            });
        });
    }
}
