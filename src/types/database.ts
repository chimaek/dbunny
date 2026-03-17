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
    /** 읽기 전용 모드 — INSERT/UPDATE/DELETE/DROP 등 차단 */
    readOnly?: boolean;
    /** 연결별 컬러 코딩 — 탭/트리뷰/상태바에 표시되는 색상 */
    color?: ConnectionColor;
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
 * 연결별 컬러 코딩 설정
 */
export interface ConnectionColor {
    /** 프리셋 컬러 ID 또는 커스텀 hex 코드 */
    id: string;
    /** 표시용 색상 hex 값 */
    hex: string;
    /** 사용자에게 보여질 라벨 (예: "운영", "개발") */
    label?: string;
}

/**
 * 프리셋 컬러 목록 — 환경별 의미가 있는 색상
 */
export const CONNECTION_COLOR_PRESETS: { id: string; hex: string; label: string; labelEn: string }[] = [
    { id: 'red', hex: '#E74C3C', label: '운영(빨강)', labelEn: 'Production (Red)' },
    { id: 'orange', hex: '#E67E22', label: '스테이징(주황)', labelEn: 'Staging (Orange)' },
    { id: 'yellow', hex: '#F1C40F', label: '테스트(노랑)', labelEn: 'Testing (Yellow)' },
    { id: 'green', hex: '#27AE60', label: '개발(초록)', labelEn: 'Development (Green)' },
    { id: 'blue', hex: '#3498DB', label: '로컬(파랑)', labelEn: 'Local (Blue)' },
    { id: 'purple', hex: '#9B59B6', label: '분석(보라)', labelEn: 'Analytics (Purple)' },
    { id: 'pink', hex: '#E91E8F', label: '핑크', labelEn: 'Pink' },
    { id: 'gray', hex: '#95A5A6', label: '기타(회색)', labelEn: 'Other (Gray)' },
];

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
