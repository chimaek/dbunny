import { Client, ClientConfig } from 'pg';
import { DatabaseConnection, ConnectionConfig, QueryResult, ColumnInfo, ForeignKeyInfo } from '../types/database';

/**
 * H2 Database provider
 * Connects to H2 running in server mode with PostgreSQL protocol compatibility
 *
 * H2 Connection Modes:
 *   - TCP (default): java -jar h2.jar -tcp -tcpAllowOthers -pgAllowOthers
 *   - SSL: java -jar h2.jar -tcp -tcpAllowOthers -pgAllowOthers -tcpSSL
 *
 * Database Types:
 *   - File: Persistent database stored on disk
 *   - Memory: In-memory database (data lost on server restart)
 *
 * Default ports:
 *   - TCP: 9092
 *   - PostgreSQL: 5435
 */
export class H2Provider implements DatabaseConnection {
    private client: Client | null = null;
    private currentDatabase: string = '';

    constructor(public config: ConnectionConfig) {}

    async connect(): Promise<void> {
        try {
            const h2Mode = this.config.h2Mode;

            // Build database name based on mode
            // H2 v2.x requires explicit path format: mem:name, ~/name, ./name
            let databaseName = this.config.database || 'test';

            if (h2Mode) {
                if (h2Mode.dbType === 'mem') {
                    // In-memory database: mem:dbname
                    const dbName = h2Mode.dbPath || databaseName;
                    databaseName = dbName.startsWith('mem:') ? dbName : `mem:${dbName}`;
                } else if (h2Mode.dbType === 'file') {
                    // File database: requires ~/name or ./name format
                    const dbPath = h2Mode.dbPath || databaseName;
                    if (dbPath.startsWith('~/') || dbPath.startsWith('./') || dbPath.startsWith('/') || /^[A-Za-z]:/.test(dbPath)) {
                        databaseName = dbPath;
                    } else {
                        // Default to user home directory
                        databaseName = `~/${dbPath}`;
                    }
                }
            } else {
                // Default to in-memory mode for safety
                databaseName = `mem:${databaseName}`;
            }

            this.currentDatabase = databaseName;

            // Build connection config
            const clientConfig: ClientConfig = {
                host: this.config.host || 'localhost',
                port: this.config.port || 5435,
                user: this.config.username || 'sa',
                password: this.config.password || '',
                database: this.currentDatabase,
                connectionTimeoutMillis: 10000
            };

            // Enable SSL if configured
            if (h2Mode?.protocol === 'ssl') {
                clientConfig.ssl = {
                    rejectUnauthorized: false // H2's self-signed cert
                };
            }

            this.client = new Client(clientConfig);
            await this.client.connect();
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            const protocol = this.config.h2Mode?.protocol || 'tcp';
            throw new Error(`Failed to connect to H2: ${message}. Make sure H2 is running in server mode with PG protocol enabled (${protocol.toUpperCase()}).`);
        }
    }

    async disconnect(): Promise<void> {
        if (this.client) {
            await this.client.end();
            this.client = null;
        }
    }

    async executeQuery(query: string, database?: string): Promise<QueryResult> {
        if (!this.client) {
            throw new Error('Not connected to database');
        }

        // H2 doesn't support switching databases like PostgreSQL
        // If different database is specified, warn user
        if (database && database !== this.currentDatabase) {
            console.warn('H2 does not support switching databases in the same connection');
        }

        try {
            const startTime = Date.now();
            const result = await this.client.query(query);
            const executionTime = Date.now() - startTime;

            return {
                rows: result.rows,
                fields: result.fields?.map(f => ({
                    name: f.name,
                    type: String(f.dataTypeID),
                    table: f.tableID ? String(f.tableID) : undefined
                })) || [],
                rowCount: result.rowCount || 0,
                executionTime
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            throw new Error(`Query execution failed: ${message}`);
        }
    }

    async getDatabases(): Promise<string[]> {
        // H2 shows schemas as databases in its structure
        // In PG mode, we can query information_schema
        try {
            const result = await this.executeQuery(`
                SELECT SCHEMA_NAME
                FROM INFORMATION_SCHEMA.SCHEMATA
                WHERE SCHEMA_NAME NOT IN ('INFORMATION_SCHEMA', 'PG_CATALOG')
                ORDER BY SCHEMA_NAME
            `);
            return result.rows.map(row => row.schema_name as string);
        } catch {
            // Fallback
            return [this.currentDatabase];
        }
    }

    async getTables(database: string): Promise<string[]> {
        // H2 uses INFORMATION_SCHEMA
        const result = await this.executeQuery(`
            SELECT TABLE_NAME
            FROM INFORMATION_SCHEMA.TABLES
            WHERE TABLE_SCHEMA = '${database.toUpperCase()}'
            AND TABLE_TYPE = 'TABLE'
            ORDER BY TABLE_NAME
        `);
        return result.rows.map(row => row.table_name as string);
    }

    async getTableSchema(table: string, database?: string): Promise<ColumnInfo[]> {
        const schema = (database || 'PUBLIC').toUpperCase();
        const tableName = table.toUpperCase();

        const result = await this.executeQuery(`
            SELECT
                COLUMN_NAME,
                DATA_TYPE,
                IS_NULLABLE,
                COLUMN_DEFAULT,
                CASE WHEN pk.COLUMN_NAME IS NOT NULL THEN TRUE ELSE FALSE END as IS_PRIMARY
            FROM INFORMATION_SCHEMA.COLUMNS c
            LEFT JOIN (
                SELECT COLUMN_NAME
                FROM INFORMATION_SCHEMA.INDEXES
                WHERE TABLE_SCHEMA = '${schema}'
                AND TABLE_NAME = '${tableName}'
                AND PRIMARY_KEY = TRUE
            ) pk ON c.COLUMN_NAME = pk.COLUMN_NAME
            WHERE c.TABLE_SCHEMA = '${schema}'
            AND c.TABLE_NAME = '${tableName}'
            ORDER BY c.ORDINAL_POSITION
        `);

        return result.rows.map(row => ({
            name: row.column_name as string,
            type: row.data_type as string,
            nullable: row.is_nullable === 'YES',
            primaryKey: row.is_primary === true,
            defaultValue: row.column_default as string | undefined
        }));
    }

    isConnected(): boolean {
        return this.client !== null;
    }

    async getCreateTableStatement(table: string, database?: string): Promise<string> {
        const schema = await this.getTableSchema(table, database);
        const schemaName = (database || 'PUBLIC').toUpperCase();
        const tableName = table.toUpperCase();

        const columns = schema.map(col => {
            let def = `    "${col.name}" ${col.type}`;
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

        return `CREATE TABLE "${schemaName}"."${tableName}" (\n${columns.join(',\n')}\n);`;
    }

    async getForeignKeys(table: string, database?: string): Promise<ForeignKeyInfo[]> {
        const schema = (database || 'PUBLIC').toUpperCase();
        const tableName = table.toUpperCase();

        const result = await this.executeQuery(`
            SELECT
                FK_NAME as constraint_name,
                FKCOLUMN_NAME as column_name,
                PKTABLE_NAME as referenced_table,
                PKCOLUMN_NAME as referenced_column
            FROM INFORMATION_SCHEMA.CROSS_REFERENCES
            WHERE FKTABLE_SCHEMA = '${schema}'
            AND FKTABLE_NAME = '${tableName}'
        `);

        return result.rows.map(row => ({
            constraintName: row.constraint_name as string,
            columnName: row.column_name as string,
            referencedTable: row.referenced_table as string,
            referencedColumn: row.referenced_column as string
        }));
    }
}
