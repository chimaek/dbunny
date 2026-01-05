import * as vscode from 'vscode';
import { DatabaseConnection, ConnectionConfig, DatabaseType, QueryResult } from '../types/database';
import { MySQLProvider } from '../providers/mysqlProvider';
import { PostgresProvider } from '../providers/postgresProvider';
import { SQLiteProvider } from '../providers/sqliteProvider';
import { MongoDBProvider } from '../providers/mongoProvider';
import { RedisProvider } from '../providers/redisProvider';
import { EncryptionService } from '../utils/encryption';

/**
 * Manages database connections using Factory Pattern
 */
export class ConnectionManager {
    private connections: Map<string, DatabaseConnection> = new Map();
    private activeConnection: DatabaseConnection | null = null;
    private encryptionService: EncryptionService;

    private readonly _onDidChangeConnection = new vscode.EventEmitter<DatabaseConnection | null>();
    readonly onDidChangeConnection = this._onDidChangeConnection.event;

    private readonly _onDidChangeConnections = new vscode.EventEmitter<void>();
    readonly onDidChangeConnections = this._onDidChangeConnections.event;

    constructor(private context: vscode.ExtensionContext) {
        this.encryptionService = new EncryptionService(context);
        this.loadConnections();
    }

    /**
     * Add a new connection
     */
    async addConnection(config: ConnectionConfig): Promise<void> {
        // Encrypt password before storing
        const encryptedConfig: ConnectionConfig = {
            ...config,
            password: config.password
                ? await this.encryptionService.encrypt(config.password)
                : undefined
        };

        const connection = this.createConnection(encryptedConfig);
        this.connections.set(config.id, connection);
        await this.saveConnections();
        this._onDidChangeConnections.fire();
    }

    /**
     * Update an existing connection
     */
    async updateConnection(config: ConnectionConfig): Promise<void> {
        const existing = this.connections.get(config.id);
        if (!existing) {
            throw new Error(`Connection not found: ${config.id}`);
        }

        // Disconnect if currently connected
        if (this.activeConnection?.config.id === config.id) {
            await this.disconnect();
        }

        // Encrypt password if changed
        const encryptedConfig: ConnectionConfig = {
            ...config,
            password: config.password
                ? await this.encryptionService.encrypt(config.password)
                : existing.config.password
        };

        const connection = this.createConnection(encryptedConfig);
        this.connections.set(config.id, connection);
        await this.saveConnections();
        this._onDidChangeConnections.fire();
    }

    /**
     * Delete a connection
     */
    async deleteConnection(connectionId: string): Promise<void> {
        const connection = this.connections.get(connectionId);
        if (!connection) {
            throw new Error(`Connection not found: ${connectionId}`);
        }

        // Disconnect if currently connected
        if (this.activeConnection?.config.id === connectionId) {
            await this.disconnect();
        }

        this.connections.delete(connectionId);
        await this.saveConnections();
        this._onDidChangeConnections.fire();
    }

    /**
     * Connect to a database
     */
    async connect(connectionId: string): Promise<void> {
        const connection = this.connections.get(connectionId);
        if (!connection) {
            throw new Error(`Connection not found: ${connectionId}`);
        }

        // Disconnect from current connection if any
        if (this.activeConnection) {
            await this.disconnect();
        }

        // Decrypt password before connecting
        const decryptedConfig: ConnectionConfig = {
            ...connection.config,
            password: connection.config.password
                ? await this.encryptionService.decrypt(connection.config.password)
                : undefined
        };

        // Create new connection with decrypted config
        const connectionWithDecryptedPassword = this.createConnection(decryptedConfig);
        await connectionWithDecryptedPassword.connect();

        this.activeConnection = connectionWithDecryptedPassword;
        this._onDidChangeConnection.fire(this.activeConnection);
    }

    /**
     * Disconnect from current database
     */
    async disconnect(): Promise<void> {
        if (this.activeConnection) {
            await this.activeConnection.disconnect();
            this.activeConnection = null;
            this._onDidChangeConnection.fire(null);
        }
    }

    /**
     * Execute a query on the active connection
     */
    async executeQuery(query: string): Promise<QueryResult> {
        if (!this.activeConnection) {
            throw new Error('No active connection');
        }
        return await this.activeConnection.executeQuery(query);
    }

    /**
     * Test a connection configuration
     */
    async testConnection(config: ConnectionConfig): Promise<boolean> {
        const connection = this.createConnection(config);
        try {
            await connection.connect();
            await connection.disconnect();
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Create a database connection using Factory Pattern
     */
    private createConnection(config: ConnectionConfig): DatabaseConnection {
        switch (config.type) {
            case 'mysql':
                return new MySQLProvider(config);
            case 'postgres':
                return new PostgresProvider(config);
            case 'sqlite':
                return new SQLiteProvider(config);
            case 'mongodb':
                return new MongoDBProvider(config);
            case 'redis':
                return new RedisProvider(config);
            default:
                throw new Error(`Unsupported database type: ${config.type}`);
        }
    }

    /**
     * Load saved connections from global state
     */
    private loadConnections(): void {
        const saved = this.context.globalState.get<ConnectionConfig[]>('dbunny.connections', []);
        for (const config of saved) {
            const connection = this.createConnection(config);
            this.connections.set(config.id, connection);
        }
    }

    /**
     * Save connections to global state
     */
    private async saveConnections(): Promise<void> {
        const configs = Array.from(this.connections.values()).map(conn => conn.config);
        await this.context.globalState.update('dbunny.connections', configs);
    }

    /**
     * Get all connections
     */
    getAllConnections(): DatabaseConnection[] {
        return Array.from(this.connections.values());
    }

    /**
     * Get a connection by ID
     */
    getConnection(connectionId: string): DatabaseConnection | undefined {
        return this.connections.get(connectionId);
    }

    /**
     * Get the active connection
     */
    getActiveConnection(): DatabaseConnection | null {
        return this.activeConnection;
    }

    /**
     * Check if a connection is active
     */
    isConnected(connectionId: string): boolean {
        return this.activeConnection?.config.id === connectionId;
    }

    /**
     * Generate a unique connection ID
     */
    generateConnectionId(): string {
        return this.encryptionService.generateId();
    }

    /**
     * Get supported database types
     */
    getSupportedTypes(): DatabaseType[] {
        return ['mysql', 'postgres', 'sqlite', 'mongodb', 'redis'];
    }

    /**
     * Get default port for database type
     */
    getDefaultPort(type: DatabaseType): number {
        const ports: Record<DatabaseType, number> = {
            mysql: 3306,
            postgres: 5432,
            sqlite: 0,
            mongodb: 27017,
            redis: 6379
        };
        return ports[type];
    }
}
