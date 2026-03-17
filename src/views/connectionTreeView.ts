import * as vscode from 'vscode';
import { ConnectionManager } from '../managers/connectionManager';
import { DatabaseConnection, TreeItemType } from '../types/database';
import { I18n } from '../utils/i18n';

/**
 * Tree item representing a connection, database, table, column, or group
 */
export class ConnectionTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly itemType: TreeItemType,
        public readonly connectionId?: string,
        public readonly databaseName?: string,
        public readonly tableName?: string,
        public readonly dbType?: string,
        public readonly groupName?: string,
        collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None,
        public readonly isFavorite: boolean = false
    ) {
        super(label, collapsibleState);
        // Include database type in contextValue for SQL vs NoSQL distinction
        if (dbType && itemType === 'table') {
            const isSqlDb = ['mysql', 'postgres', 'sqlite'].includes(dbType);
            const baseContext = isSqlDb ? 'table-sql' : 'table-nosql';
            this.contextValue = isFavorite ? `${baseContext}-favorite` : baseContext;
        } else {
            this.contextValue = itemType;
        }
        this.setIcon();
    }

    private setIcon(): void {
        switch (this.itemType) {
            case 'group':
                this.iconPath = new vscode.ThemeIcon('folder');
                break;
            case 'connection':
                this.iconPath = new vscode.ThemeIcon('database');
                break;
            case 'database':
                this.iconPath = new vscode.ThemeIcon('symbol-namespace');
                break;
            case 'table':
                if (this.isFavorite) {
                    this.iconPath = new vscode.ThemeIcon('star-full', new vscode.ThemeColor('charts.yellow'));
                } else {
                    this.iconPath = new vscode.ThemeIcon('symbol-class');
                }
                break;
            case 'column':
                this.iconPath = new vscode.ThemeIcon('symbol-field');
                break;
        }
    }
}

/**
 * Tree data provider for database connections
 */
export class ConnectionTreeProvider implements vscode.TreeDataProvider<ConnectionTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<ConnectionTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor(
        private connectionManager: ConnectionManager,
        private i18n: I18n
    ) {}

    /**
     * Refresh the tree view
     */
    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    /**
     * Get tree item for display
     */
    getTreeItem(element: ConnectionTreeItem): vscode.TreeItem {
        return element;
    }

    /**
     * Get children of a tree item
     */
    async getChildren(element?: ConnectionTreeItem): Promise<ConnectionTreeItem[]> {
        if (!element) {
            // Root level - show groups and ungrouped connections
            return this.getRootItems();
        }

        switch (element.itemType) {
            case 'group':
                return this.getGroupConnectionItems(element.groupName!);
            case 'connection':
                return this.getDatabaseItems(element.connectionId!);
            case 'database':
                return this.getTableItems(element.connectionId!, element.databaseName!);
            case 'table':
                return this.getColumnItems(element.connectionId!, element.tableName!, element.databaseName);
            default:
                return [];
        }
    }

    /**
     * Get root level items (groups + ungrouped connections)
     */
    private getRootItems(): ConnectionTreeItem[] {
        const items: ConnectionTreeItem[] = [];
        const groups = this.connectionManager.getGroups();

        // Add group items
        for (const group of groups) {
            const groupItem = new ConnectionTreeItem(
                group,
                'group',
                undefined,
                undefined,
                undefined,
                undefined,
                group,
                vscode.TreeItemCollapsibleState.Collapsed
            );
            groupItem.tooltip = `${group} (${this.connectionManager.getConnectionsByGroup(group).length} connections)`;
            items.push(groupItem);
        }

        // Add ungrouped connections
        const ungroupedConnections = this.connectionManager.getConnectionsByGroup(null);
        for (const conn of ungroupedConnections) {
            items.push(this.createConnectionItem(conn));
        }

        return items;
    }

    /**
     * Get connection items for a group
     */
    private getGroupConnectionItems(groupName: string): ConnectionTreeItem[] {
        const connections = this.connectionManager.getConnectionsByGroup(groupName);
        return connections.map(conn => this.createConnectionItem(conn));
    }

    /**
     * Create a connection tree item
     */
    private createConnectionItem(conn: DatabaseConnection): ConnectionTreeItem {
        const isActive = this.connectionManager.isConnected(conn.config.id);
        const item = new ConnectionTreeItem(
            conn.config.name,
            'connection',
            conn.config.id,
            undefined,
            undefined,
            conn.config.type,
            conn.config.group,
            isActive ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed
        );

        // 컬러 코딩 인디케이터
        const colorDot = conn.config.color ? `●` : '';
        const readOnlyIcon = conn.config.readOnly ? ' 🔒' : '';

        // Show connection status with color indicator
        if (isActive) {
            const iconColor = this.getConnectionIconColor(conn);
            if (conn.config.readOnly) {
                item.description = `${colorDot} ${this.i18n.t('connection.connected')}${readOnlyIcon}`.trim();
                item.iconPath = new vscode.ThemeIcon('lock', new vscode.ThemeColor(iconColor));
            } else {
                item.description = `${colorDot} ${this.i18n.t('connection.connected')}`.trim();
                item.iconPath = new vscode.ThemeIcon('database', new vscode.ThemeColor(iconColor));
            }
        } else {
            item.description = `${colorDot} ${this.getDbTypeLabel(conn.config.type)}${readOnlyIcon}`.trim();
        }

        item.tooltip = this.buildConnectionTooltip(conn);

        return item;
    }

    /**
     * Get database items for a connection
     */
    private async getDatabaseItems(connectionId: string): Promise<ConnectionTreeItem[]> {
        try {
            const connection = this.connectionManager.getActiveConnection();
            if (!connection || connection.config.id !== connectionId) {
                return [];
            }

            const databases = await connection.getDatabases();
            const dbType = connection.config.type;
            return databases.map(db => new ConnectionTreeItem(
                db,
                'database',
                connectionId,
                db,
                undefined,
                dbType,
                undefined,
                vscode.TreeItemCollapsibleState.Collapsed
            ));
        } catch (error) {
            console.error('Failed to get databases:', error);
            return [];
        }
    }

    /**
     * Get table items for a database
     */
    private async getTableItems(connectionId: string, databaseName: string): Promise<ConnectionTreeItem[]> {
        try {
            const connection = this.connectionManager.getActiveConnection();
            if (!connection || connection.config.id !== connectionId) {
                return [];
            }

            const tables = await connection.getTables(databaseName);
            const dbType = connection.config.type;
            const favorites = this.connectionManager.getFavorites(connectionId, databaseName);

            // Sort tables: favorites first, then alphabetically
            const sortedTables = [...tables].sort((a, b) => {
                const aIsFavorite = favorites.includes(a);
                const bIsFavorite = favorites.includes(b);

                if (aIsFavorite && !bIsFavorite) { return -1; }
                if (!aIsFavorite && bIsFavorite) { return 1; }
                return a.localeCompare(b);
            });

            return sortedTables.map(table => {
                const isFavorite = favorites.includes(table);
                const item = new ConnectionTreeItem(
                    table,
                    'table',
                    connectionId,
                    databaseName,
                    table,
                    dbType,
                    undefined,
                    vscode.TreeItemCollapsibleState.Collapsed,
                    isFavorite
                );
                if (isFavorite) {
                    item.description = '★';
                }
                return item;
            });
        } catch (error) {
            console.error('Failed to get tables:', error);
            return [];
        }
    }

    /**
     * Get column items for a table
     */
    private async getColumnItems(connectionId: string, tableName: string, databaseName?: string): Promise<ConnectionTreeItem[]> {
        try {
            const connection = this.connectionManager.getActiveConnection();
            if (!connection || connection.config.id !== connectionId) {
                return [];
            }

            const columns = await connection.getTableSchema(tableName, databaseName);
            const dbType = connection.config.type;
            return columns.map(col => {
                const item = new ConnectionTreeItem(
                    col.name,
                    'column',
                    connectionId,
                    undefined,
                    tableName,
                    dbType,
                    undefined,
                    vscode.TreeItemCollapsibleState.None
                );
                item.description = col.type;
                if (col.primaryKey) {
                    item.iconPath = new vscode.ThemeIcon('key');
                }
                return item;
            });
        } catch (error) {
            console.error('Failed to get columns:', error);
            return [];
        }
    }

    /**
     * Build tooltip for connection
     */
    private buildConnectionTooltip(conn: DatabaseConnection): string {
        const config = conn.config;
        const lines = [
            `Name: ${config.name}`,
            `Type: ${config.type.toUpperCase()}`,
            `Host: ${config.host}:${config.port}`,
        ];

        if (config.database) {
            lines.push(`Database: ${config.database}`);
        }

        if (config.group) {
            lines.push(`Group: ${config.group}`);
        }

        if (config.ssh) {
            lines.push(`SSH: ${config.ssh.host}:${config.ssh.port || 22}`);
        }

        if (config.readOnly) {
            lines.push('Mode: Read-Only 🔒');
        }

        if (config.color) {
            const label = config.color.label || config.color.id;
            lines.push(`Color: ${label}`);
        }

        return lines.join('\n');
    }

    /**
     * 연결의 아이콘 색상 결정 — 사용자 컬러 > 기본(readOnly=yellow, 일반=green)
     */
    private getConnectionIconColor(conn: DatabaseConnection): string {
        if (conn.config.color) {
            // VSCode ThemeColor에 직접 hex를 쓸 수 없으므로 프리셋→charts 매핑
            const colorMap: Record<string, string> = {
                red: 'charts.red',
                orange: 'charts.orange',
                yellow: 'charts.yellow',
                green: 'charts.green',
                blue: 'charts.blue',
                purple: 'charts.purple',
                pink: 'charts.pink',
                gray: 'descriptionForeground',
            };
            return colorMap[conn.config.color.id] || (conn.config.readOnly ? 'charts.yellow' : 'charts.green');
        }
        return conn.config.readOnly ? 'charts.yellow' : 'charts.green';
    }

    /**
     * Get display label for database type
     */
    private getDbTypeLabel(type: string): string {
        const labels: Record<string, string> = {
            mysql: 'MySQL',
            postgres: 'PostgreSQL',
            sqlite: 'SQLite',
            mongodb: 'MongoDB',
            redis: 'Redis'
        };
        return labels[type] || type;
    }
}
