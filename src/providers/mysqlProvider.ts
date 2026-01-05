import * as mysql from 'mysql2/promise';
import { Client as SSHClient } from 'ssh2';
import { DatabaseConnection, ConnectionConfig, QueryResult, ColumnInfo } from '../types/database';

/**
 * MySQL database provider
 */
export class MySQLProvider implements DatabaseConnection {
    private connection: mysql.Connection | null = null;
    private sshClient: SSHClient | null = null;

    constructor(public config: ConnectionConfig) {}

    async connect(): Promise<void> {
        try {
            // Establish SSH tunnel if configured
            if (this.config.ssh) {
                await this.establishSSHTunnel();
            }

            // Create MySQL connection
            this.connection = await mysql.createConnection({
                host: this.config.host,
                port: this.config.port || 3306,
                user: this.config.username,
                password: this.config.password,
                database: this.config.database,
                connectTimeout: 10000,
                enableKeepAlive: true,
                keepAliveInitialDelay: 10000
            });

            // Test connection
            await this.connection.ping();
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            throw new Error(`Failed to connect to MySQL: ${message}`);
        }
    }

    async disconnect(): Promise<void> {
        if (this.connection) {
            await this.connection.end();
            this.connection = null;
        }
        if (this.sshClient) {
            this.sshClient.end();
            this.sshClient = null;
        }
    }

    async executeQuery(query: string): Promise<QueryResult> {
        if (!this.connection) {
            throw new Error('Not connected to database');
        }

        try {
            const startTime = Date.now();
            const [rows, fields] = await this.connection.execute(query);
            const executionTime = Date.now() - startTime;

            const resultRows = Array.isArray(rows) ? rows as Record<string, unknown>[] : [];
            const resultFields = fields?.map(f => ({
                name: f.name,
                type: String(f.type),
                table: f.table
            })) || [];

            return {
                rows: resultRows,
                fields: resultFields,
                rowCount: resultRows.length,
                executionTime
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            throw new Error(`Query execution failed: ${message}`);
        }
    }

    async getDatabases(): Promise<string[]> {
        const result = await this.executeQuery('SHOW DATABASES');
        return result.rows.map((row) => row['Database'] as string);
    }

    async getTables(database: string): Promise<string[]> {
        const result = await this.executeQuery(`SHOW TABLES FROM \`${database}\``);
        const key = `Tables_in_${database}`;
        return result.rows.map((row) => row[key] as string);
    }

    async getTableSchema(table: string): Promise<ColumnInfo[]> {
        const result = await this.executeQuery(`DESCRIBE \`${table}\``);
        return result.rows.map((row) => ({
            name: row['Field'] as string,
            type: row['Type'] as string,
            nullable: row['Null'] === 'YES',
            primaryKey: row['Key'] === 'PRI',
            defaultValue: row['Default'] as string | undefined
        }));
    }

    isConnected(): boolean {
        return this.connection !== null;
    }

    private async establishSSHTunnel(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.sshClient = new SSHClient();

            this.sshClient.on('ready', () => {
                this.sshClient!.forwardOut(
                    '127.0.0.1',
                    0,
                    this.config.host,
                    this.config.port || 3306,
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
