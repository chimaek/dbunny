import { Client } from 'pg';
import { Client as SSHClient } from 'ssh2';
import { DatabaseConnection, ConnectionConfig, QueryResult, ColumnInfo, ForeignKeyInfo } from '../types/database';

/**
 * PostgreSQL database provider
 */
export class PostgresProvider implements DatabaseConnection {
    private client: Client | null = null;
    private sshClient: SSHClient | null = null;
    private currentDatabase: string = 'postgres';

    constructor(public config: ConnectionConfig) {}

    async connect(): Promise<void> {
        try {
            // Establish SSH tunnel if configured
            if (this.config.ssh) {
                await this.establishSSHTunnel();
            }

            // Create PostgreSQL client
            this.currentDatabase = this.config.database || 'postgres';
            this.client = new Client({
                host: this.config.host,
                port: this.config.port || 5432,
                user: this.config.username,
                password: this.config.password,
                database: this.currentDatabase,
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

    /**
     * Execute a query on a specific database
     * Creates a temporary connection if the target database differs from the current one
     */
    private async executeQueryOnDatabase(database: string, query: string): Promise<QueryResult> {
        // If same database or no specific database requested, use current connection
        if (!database || database === this.currentDatabase) {
            return this.executeQuery(query);
        }

        // Create a temporary connection to the target database
        const tempClient = new Client({
            host: this.config.host,
            port: this.config.port || 5432,
            user: this.config.username,
            password: this.config.password,
            database: database,
            connectionTimeoutMillis: 10000
        });

        try {
            await tempClient.connect();
            const startTime = Date.now();
            const result = await tempClient.query(query);
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
        } finally {
            await tempClient.end();
        }
    }

    async getDatabases(): Promise<string[]> {
        const result = await this.executeQuery(
            `SELECT datname FROM pg_database WHERE datistemplate = false`
        );
        return result.rows.map((row) => row.datname as string);
    }

    async getTables(database: string): Promise<string[]> {
        // Use pg_catalog for more reliable table listing
        // Query tables from all non-system schemas
        // Use executeQueryOnDatabase to query the correct database
        const result = await this.executeQueryOnDatabase(database, `
            SELECT c.relname as table_name
            FROM pg_catalog.pg_class c
            JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
            WHERE c.relkind = 'r'  -- 'r' = ordinary table
            AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
            AND n.nspname NOT LIKE 'pg_temp_%'
            AND n.nspname NOT LIKE 'pg_toast_temp_%'
            ORDER BY n.nspname, c.relname
        `);
        return result.rows.map((row) => row.table_name as string);
    }

    async getTableSchema(table: string, database?: string): Promise<ColumnInfo[]> {
        const safeTable = table.replace(/'/g, "''");
        // Use pg_catalog for more reliable schema query
        const result = await this.executeQueryOnDatabase(database || this.currentDatabase, `
            SELECT
                a.attname as column_name,
                pg_catalog.format_type(a.atttypid, a.atttypmod) as data_type,
                NOT a.attnotnull as is_nullable,
                pg_catalog.pg_get_expr(d.adbin, d.adrelid) as column_default,
                COALESCE(pk.is_primary, false) as is_primary
            FROM pg_catalog.pg_attribute a
            JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
            JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
            LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
            LEFT JOIN (
                SELECT
                    unnest(con.conkey) as attnum,
                    con.conrelid,
                    true as is_primary
                FROM pg_catalog.pg_constraint con
                WHERE con.contype = 'p'
            ) pk ON pk.conrelid = c.oid AND pk.attnum = a.attnum
            WHERE c.relname = '${safeTable}'
            AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
            AND a.attnum > 0
            AND NOT a.attisdropped
            ORDER BY a.attnum
        `);

        return result.rows.map((row) => ({
            name: row.column_name as string,
            type: row.data_type as string,
            nullable: row.is_nullable as boolean,
            primaryKey: row.is_primary as boolean,
            defaultValue: row.column_default as string | undefined
        }));
    }

    isConnected(): boolean {
        return this.client !== null;
    }

    async getCreateTableStatement(table: string, database?: string): Promise<string> {
        const schema = await this.getTableSchema(table, database);
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

    async getForeignKeys(table: string, database?: string): Promise<ForeignKeyInfo[]> {
        const safeTable = table.replace(/'/g, "''");

        // Use pg_catalog for more reliable foreign key detection
        // Use unnest with ordinality to properly match composite key columns
        const result = await this.executeQueryOnDatabase(database || this.currentDatabase, `
            SELECT
                con.conname as "constraintName",
                att.attname as "columnName",
                ref_class.relname as "referencedTable",
                ref_att.attname as "referencedColumn"
            FROM pg_catalog.pg_constraint con
            JOIN pg_catalog.pg_class c ON c.oid = con.conrelid
            JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
            JOIN pg_catalog.pg_class ref_class ON ref_class.oid = con.confrelid
            CROSS JOIN LATERAL unnest(con.conkey, con.confkey) WITH ORDINALITY AS cols(conkey, confkey, ord)
            JOIN pg_catalog.pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = cols.conkey
            JOIN pg_catalog.pg_attribute ref_att ON ref_att.attrelid = con.confrelid AND ref_att.attnum = cols.confkey
            WHERE con.contype = 'f'
                AND c.relname = '${safeTable}'
                AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
        `);

        return result.rows.map(row => ({
            constraintName: row.constraintName as string,
            columnName: row.columnName as string,
            referencedTable: row.referencedTable as string,
            referencedColumn: row.referencedColumn as string
        }));
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
