/**
 * Database connection configuration
 */
export interface ConnectionConfig {
    id: string;
    name: string;
    type: DatabaseType;
    host: string;
    port: number;
    username: string;
    password?: string;
    database?: string;
    ssh?: SSHConfig;
    options?: Record<string, unknown>;
}

/**
 * Supported database types
 */
export type DatabaseType = 'mysql' | 'postgres' | 'sqlite' | 'mongodb' | 'redis';

/**
 * SSH tunnel configuration
 */
export interface SSHConfig {
    host: string;
    port: number;
    username: string;
    password?: string;
    privateKey?: string;
    passphrase?: string;
}

/**
 * Query execution result
 */
export interface QueryResult {
    rows: Record<string, unknown>[];
    fields: FieldInfo[];
    rowCount: number;
    executionTime: number;
}

/**
 * Field/Column information
 */
export interface FieldInfo {
    name: string;
    type: string;
    table?: string;
}

/**
 * Database connection interface - Strategy Pattern
 */
export interface DatabaseConnection {
    config: ConnectionConfig;
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    executeQuery(query: string): Promise<QueryResult>;
    getDatabases(): Promise<string[]>;
    getTables(database: string): Promise<string[]>;
    getTableSchema(table: string): Promise<ColumnInfo[]>;
    isConnected(): boolean;
}

/**
 * Column schema information
 */
export interface ColumnInfo {
    name: string;
    type: string;
    nullable: boolean;
    primaryKey: boolean;
    defaultValue?: string;
}

/**
 * Tree item types for the explorer view
 */
export type TreeItemType = 'connection' | 'database' | 'table' | 'column';

/**
 * Connection status
 */
export type ConnectionStatus = 'connected' | 'disconnected' | 'connecting' | 'error';

/**
 * Query history entry
 */
export interface QueryHistoryEntry {
    id: string;
    query: string;
    connectionId: string;
    connectionName: string;
    executedAt: Date;
    executionTime: number;
    rowCount: number;
    status: 'success' | 'error';
    error?: string;
}
