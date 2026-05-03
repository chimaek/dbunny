import * as mysql from 'mysql2/promise';
import * as net from 'net';
import { Client as SSHClient } from 'ssh2';
import { DatabaseConnection, ConnectionConfig, QueryResult, ColumnInfo, ForeignKeyInfo, RoutineInfo, RoutineType } from '../types/database';

/**
 * MySQL database provider
 */
export class MySQLProvider implements DatabaseConnection {
    private connection: mysql.Connection | null = null;
    private sshClient: SSHClient | null = null;
    private sshServer: net.Server | null = null;

    constructor(public config: ConnectionConfig) {}

    async connect(): Promise<void> {
        try {
            let connectHost = this.config.host;
            let connectPort = this.config.port || 3306;

            // Establish SSH tunnel if configured
            if (this.config.ssh) {
                const tunnel = await this.establishSSHTunnel();
                connectHost = tunnel.host;
                connectPort = tunnel.port;
            }

            // Create MySQL connection
            this.connection = await mysql.createConnection({
                host: connectHost,
                port: connectPort,
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
        try {
            if (this.connection) {
                await this.connection.end();
                this.connection = null;
            }
        } catch (error) {
            console.error('Error closing MySQL connection:', error);
            this.connection = null;
        }
        try {
            if (this.sshServer) {
                this.sshServer.close();
                this.sshServer = null;
            }
            if (this.sshClient) {
                this.sshClient.end();
                this.sshClient = null;
            }
        } catch (error) {
            console.error('Error closing SSH tunnel:', error);
            this.sshServer = null;
            this.sshClient = null;
        }
    }

    async executeQuery(query: string, database?: string): Promise<QueryResult> {
        if (!this.connection) {
            throw new Error('Not connected to database');
        }

        try {
            // Switch database if specified
            if (database) {
                await this.connection.query(`USE \`${database}\``);
            }

            const startTime = Date.now();
            // Use query() instead of execute() to avoid prepared statement protocol issues
            // Some commands like SHOW, DESCRIBE are not supported in prepared statements
            const [rows, fields] = await this.connection.query(query);
            const executionTime = Date.now() - startTime;

            const resultRows = Array.isArray(rows) ? rows as Record<string, unknown>[] : [];
            const resultFields = (fields && Array.isArray(fields))
                ? fields.filter(f => f != null).map(f => ({
                    name: f.name,
                    type: String(f.type),
                    table: f.table
                }))
                : [];

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

    async getTableSchema(table: string, database?: string): Promise<ColumnInfo[]> {
        const db = database || this.config.database;
        const safeTable = table.replace(/`/g, '``');
        const result = await this.executeQuery(
            db ? `DESCRIBE \`${db}\`.\`${safeTable}\`` : `DESCRIBE \`${safeTable}\``
        );
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

    async getCreateTableStatement(table: string, database?: string): Promise<string> {
        const db = database || this.config.database;
        const safeTable = table.replace(/`/g, '``');
        const result = await this.executeQuery(
            db ? `SHOW CREATE TABLE \`${db}\`.\`${safeTable}\`` : `SHOW CREATE TABLE \`${safeTable}\``
        );
        if (result.rows.length > 0) {
            return result.rows[0]['Create Table'] as string;
        }
        throw new Error(`Could not get CREATE TABLE statement for ${table}`);
    }

    async getForeignKeys(table: string, database?: string): Promise<ForeignKeyInfo[]> {
        if (!this.connection) {
            throw new Error('Not connected to database');
        }

        const db = database || this.config.database || '';

        const [rows] = await this.connection.execute(
            `SELECT
                CONSTRAINT_NAME as constraintName,
                COLUMN_NAME as columnName,
                REFERENCED_TABLE_NAME as referencedTable,
                REFERENCED_COLUMN_NAME as referencedColumn
            FROM information_schema.KEY_COLUMN_USAGE
            WHERE TABLE_SCHEMA = ?
                AND TABLE_NAME = ?
                AND REFERENCED_TABLE_NAME IS NOT NULL`,
            [db, table]
        );

        const resultRows = Array.isArray(rows) ? rows as Record<string, unknown>[] : [];
        return resultRows.map(row => ({
            constraintName: row.constraintName as string,
            columnName: row.columnName as string,
            referencedTable: row.referencedTable as string,
            referencedColumn: row.referencedColumn as string
        }));
    }

    // ===== Routine Browser (v3.2.0) =====

    async getRoutines(database?: string): Promise<RoutineInfo[]> {
        if (!this.connection) {
            throw new Error('Not connected to database');
        }
        const db = database || this.config.database || '';
        const routines: RoutineInfo[] = [];

        // Procedures + Functions from information_schema.ROUTINES (parameterized)
        const [procRows] = await this.connection.execute(
            `SELECT ROUTINE_NAME, ROUTINE_TYPE, ROUTINE_DEFINITION, DEFINER, CREATED, LAST_ALTERED
             FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = ?`,
            [db]
        );
        for (const row of (procRows as Record<string, unknown>[])) {
            const type: RoutineType = (row['ROUTINE_TYPE'] as string) === 'FUNCTION' ? 'function' : 'procedure';
            routines.push({
                name: row['ROUTINE_NAME'] as string,
                type,
                source: (row['ROUTINE_DEFINITION'] as string) || '',
                database: db,
                definer: row['DEFINER'] as string | undefined,
                parameters: [],
            });
        }

        // Views from information_schema.VIEWS (parameterized)
        const [viewRows] = await this.connection.execute(
            `SELECT TABLE_NAME, VIEW_DEFINITION, DEFINER
             FROM information_schema.VIEWS WHERE TABLE_SCHEMA = ?`,
            [db]
        );
        for (const row of (viewRows as Record<string, unknown>[])) {
            routines.push({
                name: row['TABLE_NAME'] as string,
                type: 'view',
                source: (row['VIEW_DEFINITION'] as string) || '',
                database: db,
                definer: row['DEFINER'] as string | undefined,
                parameters: [],
            });
        }

        return routines;
    }

    async getRoutineSource(name: string, type: RoutineType, database?: string): Promise<string> {
        const db = database || this.config.database;
        const safeName = name.replace(/`/g, '``');
        let sql: string;
        switch (type) {
            case 'procedure': sql = `SHOW CREATE PROCEDURE \`${db}\`.\`${safeName}\``; break;
            case 'function': sql = `SHOW CREATE FUNCTION \`${db}\`.\`${safeName}\``; break;
            case 'view': sql = `SHOW CREATE VIEW \`${db}\`.\`${safeName}\``; break;
            case 'trigger': sql = `SHOW CREATE TRIGGER \`${db}\`.\`${safeName}\``; break;
        }
        const result = await this.executeQuery(sql);
        if (result.rows.length > 0) {
            const keyMap: Record<RoutineType, string> = {
                procedure: 'Create Procedure',
                function: 'Create Function',
                view: 'Create View',
                trigger: 'SQL Original Statement',
            };
            const key = keyMap[type];
            const row = result.rows[0] as Record<string, unknown>;
            const source = row[key] as string;
            if (source) { return source; }
            // Fallback: try any non-metadata key
            const fallbackKey = Object.keys(row).find(k =>
                k !== 'Trigger' && k !== 'sql_mode' && k !== 'character_set_client'
                && k !== 'collation_connection' && k !== 'Database Collation'
            ) || '';
            return fallbackKey ? (row[fallbackKey] as string) || '' : '';
        }
        throw new Error(`Could not get source for ${type} ${name}`);
    }

    async executeRoutine(name: string, params: Record<string, unknown>, database?: string): Promise<QueryResult> {
        if (!this.connection) {
            throw new Error('Not connected to database');
        }
        const values = Object.values(params);
        // Escape values for inline CALL statement (consistent with executeQuery's query() usage)
        const escapedValues = values.map(v => {
            if (v === null || v === undefined) { return 'NULL'; }
            if (typeof v === 'number') { return String(v); }
            return `'${String(v).replace(/'/g, "\\'").replace(/\\/g, '\\\\')}'`;
        });
        const safeName = name.replace(/`/g, '``');
        return this.executeQuery(
            `CALL \`${safeName}\`(${escapedValues.join(', ')})`,
            database
        );
    }

    async dropRoutine(name: string, type: RoutineType, database?: string): Promise<void> {
        const db = database || this.config.database;
        const safeName = name.replace(/`/g, '``');
        const dropSql: Record<RoutineType, string> = {
            procedure: `DROP PROCEDURE IF EXISTS \`${db}\`.\`${safeName}\``,
            function: `DROP FUNCTION IF EXISTS \`${db}\`.\`${safeName}\``,
            view: `DROP VIEW IF EXISTS \`${db}\`.\`${safeName}\``,
            trigger: `DROP TRIGGER IF EXISTS \`${db}\`.\`${safeName}\``,
        };
        await this.executeQuery(dropSql[type]);
    }

    async getTriggers(database?: string): Promise<RoutineInfo[]> {
        if (!this.connection) {
            throw new Error('Not connected to database');
        }
        const db = database || this.config.database || '';
        const [rows] = await this.connection.execute(
            `SELECT TRIGGER_NAME, ACTION_TIMING, EVENT_MANIPULATION, ACTION_STATEMENT, DEFINER
             FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = ?`,
            [db]
        );
        return (rows as Record<string, unknown>[]).map(row => ({
            name: row['TRIGGER_NAME'] as string,
            type: 'trigger' as RoutineType,
            source: (row['ACTION_STATEMENT'] as string) || '',
            database: db,
            definer: row['DEFINER'] as string | undefined,
            parameters: [],
        }));
    }

    async getTriggerSource(name: string, database?: string): Promise<string> {
        return this.getRoutineSource(name, 'trigger', database);
    }

    private async establishSSHTunnel(): Promise<{ host: string; port: number }> {
        return new Promise((resolve, reject) => {
            this.sshClient = new SSHClient();

            this.sshClient.on('ready', () => {
                // Create a local TCP server that forwards to the remote DB via SSH
                this.sshServer = net.createServer((sock) => {
                    this.sshClient!.forwardOut(
                        sock.remoteAddress || '127.0.0.1',
                        sock.remotePort || 0,
                        this.config.host,
                        this.config.port || 3306,
                        (err, stream) => {
                            if (err) {
                                sock.end();
                                return;
                            }
                            sock.pipe(stream).pipe(sock);
                        }
                    );
                });

                this.sshServer!.listen(0, '127.0.0.1', () => {
                    const addr = this.sshServer!.address() as net.AddressInfo;
                    resolve({ host: '127.0.0.1', port: addr.port });
                });

                this.sshServer!.on('error', (err) => {
                    reject(new Error(`SSH tunnel server failed: ${err.message}`));
                });
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
