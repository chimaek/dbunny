import * as vscode from 'vscode';
import { DatabaseConnection, ConnectionConfig, ConnectionTemplate, DatabaseType, QueryResult } from '../types/database';
import { createTemplate, templateToConnectionConfig, MAX_TEMPLATES } from '../utils/connectionShare';
import { MySQLProvider } from '../providers/mysqlProvider';
import { PostgresProvider } from '../providers/postgresProvider';
import { SQLiteProvider } from '../providers/sqliteProvider';
import { MongoDBProvider } from '../providers/mongoProvider';
import { RedisProvider } from '../providers/redisProvider';
import { H2Provider } from '../providers/h2Provider';
import { EncryptionService } from '../utils/encryption';

/**
 * Manages database connections using Factory Pattern
 */
export class ConnectionManager {
    private connections: Map<string, DatabaseConnection> = new Map();
    private activeConnection: DatabaseConnection | null = null;
    private encryptionService: EncryptionService;
    /** 트리뷰에서 선택된 데이터베이스 이름 (쿼리 실행 시 컨텍스트) */
    private _selectedDatabase: string | undefined;

    private readonly _onDidChangeConnection = new vscode.EventEmitter<DatabaseConnection | null>();
    readonly onDidChangeConnection = this._onDidChangeConnection.event;

    private readonly _onDidChangeConnections = new vscode.EventEmitter<void>();
    readonly onDidChangeConnections = this._onDidChangeConnections.event;

    constructor(public readonly context: vscode.ExtensionContext) {
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
        this._selectedDatabase = decryptedConfig.database;
        this._onDidChangeConnection.fire(this.activeConnection);
    }

    /**
     * Disconnect from current database
     */
    async disconnect(): Promise<void> {
        if (this.activeConnection) {
            await this.activeConnection.disconnect();
            this.activeConnection = null;
            this._selectedDatabase = undefined;
            this._onDidChangeConnection.fire(null);
        }
    }

    /**
     * Execute a query on the active connection
     */
    async executeQuery(query: string, database?: string): Promise<QueryResult> {
        if (!this.activeConnection) {
            throw new Error('No active connection');
        }
        const db = database || this._selectedDatabase;
        return await this.activeConnection.executeQuery(query, db);
    }

    /**
     * 선택된 데이터베이스 설정 (트리뷰에서 DB 선택 시)
     */
    setSelectedDatabase(database: string | undefined): void {
        this._selectedDatabase = database;
    }

    /**
     * 현재 선택된 데이터베이스 조회
     */
    getSelectedDatabase(): string | undefined {
        return this._selectedDatabase;
    }

    /**
     * Test a connection configuration
     * Throws error with details if connection fails
     */
    async testConnection(config: ConnectionConfig): Promise<boolean> {
        const connection = this.createConnection(config);
        try {
            await connection.connect();
            await connection.disconnect();
            return true;
        } catch (error) {
            // Re-throw with detailed message
            const message = error instanceof Error ? error.message : 'Unknown error';
            throw new Error(message);
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
            case 'h2':
                return new H2Provider(config);
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
        return ['mysql', 'postgres', 'sqlite', 'mongodb', 'redis', 'h2'];
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
            redis: 6379,
            h2: 5435
        };
        return ports[type];
    }

    /**
     * Get all unique groups
     */
    getGroups(): string[] {
        const groups = new Set<string>();
        for (const conn of this.connections.values()) {
            if (conn.config.group) {
                groups.add(conn.config.group);
            }
        }
        return Array.from(groups).sort();
    }

    /**
     * Get connections by group
     */
    getConnectionsByGroup(group: string | null): DatabaseConnection[] {
        return Array.from(this.connections.values()).filter(conn => {
            if (group === null) {
                return !conn.config.group;
            }
            return conn.config.group === group;
        });
    }

    /**
     * Set connection group
     */
    async setConnectionGroup(connectionId: string, group: string | undefined): Promise<void> {
        const connection = this.connections.get(connectionId);
        if (!connection) {
            throw new Error(`Connection not found: ${connectionId}`);
        }

        const updatedConfig: ConnectionConfig = {
            ...connection.config,
            group
        };

        const newConnection = this.createConnection(updatedConfig);
        this.connections.set(connectionId, newConnection);
        await this.saveConnections();
        this._onDidChangeConnections.fire();
    }

    /**
     * Rename a group
     */
    async renameGroup(oldName: string, newName: string): Promise<void> {
        for (const conn of this.connections.values()) {
            if (conn.config.group === oldName) {
                const updatedConfig: ConnectionConfig = {
                    ...conn.config,
                    group: newName
                };
                const newConnection = this.createConnection(updatedConfig);
                this.connections.set(conn.config.id, newConnection);
            }
        }
        await this.saveConnections();
        this._onDidChangeConnections.fire();
    }

    /**
     * Delete a group (moves connections to ungrouped)
     */
    async deleteGroup(groupName: string): Promise<void> {
        for (const conn of this.connections.values()) {
            if (conn.config.group === groupName) {
                const updatedConfig: ConnectionConfig = {
                    ...conn.config,
                    group: undefined
                };
                const newConnection = this.createConnection(updatedConfig);
                this.connections.set(conn.config.id, newConnection);
            }
        }
        await this.saveConnections();
        this._onDidChangeConnections.fire();
    }

    // ===== Connection Duplication =====

    /**
     * 기존 연결을 복제 (암호화된 비밀번호 포함)
     */
    async duplicateConnection(connectionId: string): Promise<ConnectionConfig> {
        const connection = this.connections.get(connectionId);
        if (!connection) {
            throw new Error(`Connection not found: ${connectionId}`);
        }

        const newId = this.generateConnectionId();
        const duplicatedConfig: ConnectionConfig = {
            ...connection.config,
            id: newId,
            name: `${connection.config.name} (Copy)`,
        };

        // 암호화된 비밀번호를 직접 복사하여 재암호화 없이 저장
        const newConnection = this.createConnection(duplicatedConfig);
        this.connections.set(newId, newConnection);
        await this.saveConnections();
        this._onDidChangeConnections.fire();

        return duplicatedConfig;
    }

    // ===== Connection Import =====

    /**
     * 외부에서 가져온 연결 설정 일괄 추가 (비밀번호 없음)
     */
    async importConnections(configs: ConnectionConfig[]): Promise<number> {
        let count = 0;
        for (const config of configs) {
            const connection = this.createConnection(config);
            this.connections.set(config.id, connection);
            count++;
        }
        await this.saveConnections();
        this._onDidChangeConnections.fire();
        return count;
    }

    // ===== Connection Templates =====

    /**
     * 저장된 템플릿 목록 조회
     */
    getTemplates(): ConnectionTemplate[] {
        return this.context.globalState.get<ConnectionTemplate[]>('dbunny.templates', []);
    }

    /**
     * 연결을 템플릿으로 저장
     */
    async saveAsTemplate(connectionId: string, templateName: string, description?: string): Promise<ConnectionTemplate> {
        const connection = this.connections.get(connectionId);
        if (!connection) {
            throw new Error(`Connection not found: ${connectionId}`);
        }

        const templates = this.getTemplates();
        if (templates.length >= MAX_TEMPLATES) {
            throw new Error(`Maximum ${MAX_TEMPLATES} templates allowed`);
        }

        const template = createTemplate(
            connection.config,
            templateName,
            description,
            () => this.generateConnectionId()
        );

        templates.push(template);
        await this.context.globalState.update('dbunny.templates', templates);

        return template;
    }

    /**
     * 템플릿 삭제
     */
    async deleteTemplate(templateId: string): Promise<void> {
        const templates = this.getTemplates().filter(t => t.id !== templateId);
        await this.context.globalState.update('dbunny.templates', templates);
    }

    /**
     * 템플릿에서 새 연결 생성 (비밀번호 없이 — 폼 프리필용)
     */
    createConnectionFromTemplate(templateId: string): ConnectionConfig | undefined {
        const template = this.getTemplates().find(t => t.id === templateId);
        if (!template) { return undefined; }

        return templateToConnectionConfig(template, () => this.generateConnectionId());
    }

    // ===== Table Favorites =====

    /**
     * Get favorite tables for a connection/database
     */
    getFavorites(connectionId: string, databaseName: string): string[] {
        const favorites = this.context.globalState.get<Record<string, string[]>>('dbunny.favorites', {});
        const key = `${connectionId}:${databaseName}`;
        return favorites[key] || [];
    }

    /**
     * Add a table to favorites
     */
    async addFavorite(connectionId: string, databaseName: string, tableName: string): Promise<void> {
        const favorites = this.context.globalState.get<Record<string, string[]>>('dbunny.favorites', {});
        const key = `${connectionId}:${databaseName}`;

        if (!favorites[key]) {
            favorites[key] = [];
        }

        if (!favorites[key].includes(tableName)) {
            favorites[key].push(tableName);
            await this.context.globalState.update('dbunny.favorites', favorites);
            this._onDidChangeConnections.fire();
        }
    }

    /**
     * Remove a table from favorites
     */
    async removeFavorite(connectionId: string, databaseName: string, tableName: string): Promise<void> {
        const favorites = this.context.globalState.get<Record<string, string[]>>('dbunny.favorites', {});
        const key = `${connectionId}:${databaseName}`;

        if (favorites[key]) {
            favorites[key] = favorites[key].filter(t => t !== tableName);
            if (favorites[key].length === 0) {
                delete favorites[key];
            }
            await this.context.globalState.update('dbunny.favorites', favorites);
            this._onDidChangeConnections.fire();
        }
    }

    /**
     * Check if a table is a favorite
     */
    isFavorite(connectionId: string, databaseName: string, tableName: string): boolean {
        const favorites = this.getFavorites(connectionId, databaseName);
        return favorites.includes(tableName);
    }

    /**
     * Toggle favorite status of a table
     */
    async toggleFavorite(connectionId: string, databaseName: string, tableName: string): Promise<boolean> {
        if (this.isFavorite(connectionId, databaseName, tableName)) {
            await this.removeFavorite(connectionId, databaseName, tableName);
            return false;
        } else {
            await this.addFavorite(connectionId, databaseName, tableName);
            return true;
        }
    }

    /**
     * Dispose all resources (connections, event emitters)
     */
    dispose(): void {
        // Disconnect active connection
        if (this.activeConnection) {
            this.activeConnection.disconnect().catch(err => {
                console.error('Error disconnecting on dispose:', err);
            });
            this.activeConnection = null;
        }

        // Dispose event emitters
        this._onDidChangeConnection.dispose();
        this._onDidChangeConnections.dispose();
    }
}
