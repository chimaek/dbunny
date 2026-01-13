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
    group?: string;
    h2Mode?: H2ConnectionMode;
}

/**
 * H2 Database connection mode
 */
export interface H2ConnectionMode {
    /** Connection protocol: 'tcp' (default) or 'ssl' */
    protocol: 'tcp' | 'ssl';
    /** Database type: 'file' (persistent) or 'mem' (in-memory) */
    dbType: 'file' | 'mem';
    /** For file mode: database file path. For mem mode: database name */
    dbPath?: string;
}

/**
 * Supported database types
 */
export type DatabaseType = 'mysql' | 'postgres' | 'sqlite' | 'mongodb' | 'redis' | 'h2';

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
    executeQuery(query: string, database?: string): Promise<QueryResult>;
    getDatabases(): Promise<string[]>;
    getTables(database: string): Promise<string[]>;
    getTableSchema(table: string, database?: string): Promise<ColumnInfo[]>;
    getCreateTableStatement?(table: string, database?: string): Promise<string>;
    getForeignKeys?(table: string, database?: string): Promise<ForeignKeyInfo[]>;
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
 * Foreign key information for ERD
 */
export interface ForeignKeyInfo {
    constraintName: string;
    columnName: string;
    referencedTable: string;
    referencedColumn: string;
}

/**
 * Table info for ERD with columns and foreign keys
 */
export interface TableERDInfo {
    name: string;
    columns: ColumnInfo[];
    foreignKeys: ForeignKeyInfo[];
}

/**
 * Tree item types for the explorer view
 */
export type TreeItemType = 'connection' | 'database' | 'table' | 'column' | 'group';

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

/**
 * Saved query (bookmark)
 */
export interface SavedQuery {
    id: string;
    name: string;
    query: string;
    description?: string;
    category?: string;
    databaseType?: DatabaseType;
    createdAt: Date;
    updatedAt: Date;
}
