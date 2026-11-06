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
import { CredentialStore } from '../utils/credentialStore';
import { guardConnection } from '../utils/guardedConnection';

/**
 * Manages database connections using Factory Pattern
 */
export class ConnectionManager {
    private connections: Map<string, DatabaseConnection> = new Map();
    private activeConnection: DatabaseConnection | null = null;
    private encryptionService: EncryptionService;
    private credentialStore: CredentialStore;
    readonly ready: Promise<void>;
    /** 트리뷰에서 선택된 데이터베이스 이름 (쿼리 실행 시 컨텍스트) */
    private _selectedDatabase: string | undefined;

    private readonly _onDidChangeConnection = new vscode.EventEmitter<DatabaseConnection | null>();
    readonly onDidChangeConnection = this._onDidChangeConnection.event;

    private readonly _onDidChangeConnections = new vscode.EventEmitter<void>();
    readonly onDidChangeConnections = this._onDidChangeConnections.event;

    constructor(public readonly context: vscode.ExtensionContext) {
        this.encryptionService = new EncryptionService(context);
        this.credentialStore = new CredentialStore(context.secrets, this.encryptionService);
        this.ready = this.loadConnections();
    }

    /**
     * Add a new connection
     */
    async addConnection(config: ConnectionConfig): Promise<void> {
        await this.ready;
        const encryptedConfig = await this.credentialStore.save(config);

        const connection = this.createConnection(encryptedConfig);
        this.connections.set(config.id, connection);
        await this.saveConnections();
        this._onDidChangeConnections.fire();
    }

    /**
     * Update an existing connection
     */
    async updateConnection(config: ConnectionConfig): Promise<void> {
        await this.ready;
        const existing = this.connections.get(config.id);
        if (!existing) {
            throw new Error(`Connection not found: ${config.id}`);
        }

        // Disconnect if currently connected
        if (this.activeConnection?.config.id === config.id) {
            await this.disconnect();
        }

        const encryptedConfig = await this.credentialStore.save(config);

        const connection = this.createConnection(encryptedConfig);
        this.connections.set(config.id, connection);
        await this.saveConnections();
        this._onDidChangeConnections.fire();
    }

    /**
     * Delete a connection
     */
    async deleteConnection(connectionId: string): Promise<void> {
        await this.ready;
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
        await this.credentialStore.delete(connectionId);
        this._onDidChangeConnections.fire();
    }

    /**
     * Connect to a database
     */
    async connect(connectionId: string): Promise<void> {
        await this.ready;
        const connection = this.connections.get(connectionId);
        if (!connection) {
            throw new Error(`Connection not found: ${connectionId}`);
        }

        // Disconnect from current connection if any
        if (this.activeConnection) {
            await this.disconnect();
        }

        const decryptedConfig = await this.credentialStore.resolve(connection.config);

        // Create new connection with decrypted config
        const connectionWithDecryptedPassword = this.createConnection(decryptedConfig);
        try {
            await connectionWithDecryptedPassword.connect();
        } catch (error) {
            await connectionWithDecryptedPassword.disconnect();
            throw error;
        }

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
        await this.ready;
        // 편집 중 비밀번호를 비워도 SecretStorage에 보관한 기존 값으로 테스트한다.
        const stored = this.connections.get(config.id);
        if (stored) {
            const resolved = await this.credentialStore.resolve(stored.config);
            config = {
                ...config,
                password: config.password || resolved.password,
                ssh: config.ssh ? {
                    ...config.ssh,
                    password: config.ssh.password || resolved.ssh?.password,
                    privateKey: config.ssh.privateKey || resolved.ssh?.privateKey,
                    passphrase: config.ssh.passphrase || resolved.ssh?.passphrase
                } : undefined
            };
        }
        const connection = this.createConnection(config);
        try {
            await connection.connect();
            return true;
        } catch (error) {
            // Re-throw with detailed message
            const message = error instanceof Error ? error.message : 'Unknown error';
            throw new Error(message);
        } finally {
            await connection.disconnect();
        }
    }

    /**
     * Create a database connection using Factory Pattern
     */
    private createConnection(config: ConnectionConfig): DatabaseConnection {
        return guardConnection(this.createProvider(config), () => {
            const settings = vscode.workspace.getConfiguration('dbunny');
            const bounded = (name: string, fallback: number, maximum: number) => {
                const value = settings.get<number>(name, fallback);
                return Number.isFinite(value) ? Math.min(maximum, Math.max(1, Math.floor(value))) : fallback;
            };
            return {
                timeoutMs: bounded('queryTimeout', 30000, 3600000),
                maxRows: bounded('maxResults', 1000, 100000)
            };
        });
    }

    private createProvider(config: ConnectionConfig): DatabaseConnection {
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
    private async loadConnections(): Promise<void> {
        const saved = this.context.globalState.get<ConnectionConfig[]>('dbunny.connections', []);
        const migrated: ConnectionConfig[] = [];
        for (const config of saved) {
            migrated.push(await this.credentialStore.migrate(config));
        }
        // 모든 비밀값이 안전하게 저장된 뒤에만 구버전 상태를 교체한다.
        if (saved.length > 0) {
            await this.context.globalState.update('dbunny.connections', migrated);
        }
        for (const config of migrated) {
            this.connections.set(config.id, this.createConnection(config));
        }
    }

    /**
     * Save connections to global state
     */
    private async saveConnections(): Promise<void> {
        const configs = Array.from(this.connections.values()).map(conn => this.credentialStore.sanitize(conn.config));
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
        await this.ready;
        const connection = this.connections.get(connectionId);
        if (!connection) {
            throw new Error(`Connection not found: ${connectionId}`);
        }

        const newId = this.generateConnectionId();
        const duplicatedConfig = await this.credentialStore.duplicate(connection.config, newId);

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
        await this.ready;
        let count = 0;
        for (const config of configs) {
            const metadata = this.credentialStore.sanitize(config);
            const connection = this.createConnection(metadata);
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
