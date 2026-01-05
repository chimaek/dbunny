import * as vscode from 'vscode';
import { QueryHistoryEntry } from '../types/database';
import { I18n } from '../utils/i18n';

/**
 * Tree item for query history
 */
export class QueryHistoryTreeItem extends vscode.TreeItem {
    constructor(
        public readonly entry: QueryHistoryEntry
    ) {
        super(
            QueryHistoryTreeItem.truncateQuery(entry.query),
            vscode.TreeItemCollapsibleState.None
        );

        this.description = this.formatTime(entry.executedAt);
        this.tooltip = this.buildTooltip(entry);
        this.contextValue = 'queryHistory';

        if (entry.status === 'success') {
            this.iconPath = new vscode.ThemeIcon('check', new vscode.ThemeColor('charts.green'));
        } else {
            this.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('charts.red'));
        }

        this.command = {
            command: 'dbunny.copyQuery',
            title: 'Copy Query',
            arguments: [entry.query]
        };
    }

    private static truncateQuery(query: string, maxLength: number = 50): string {
        const cleaned = query.replace(/\s+/g, ' ').trim();
        if (cleaned.length <= maxLength) {
            return cleaned;
        }
        return cleaned.substring(0, maxLength) + '...';
    }

    private formatTime(date: Date): string {
        const now = new Date();
        const diff = now.getTime() - new Date(date).getTime();
        const minutes = Math.floor(diff / 60000);
        const hours = Math.floor(diff / 3600000);
        const days = Math.floor(diff / 86400000);

        if (minutes < 1) return 'just now';
        if (minutes < 60) return `${minutes}m ago`;
        if (hours < 24) return `${hours}h ago`;
        return `${days}d ago`;
    }

    private buildTooltip(entry: QueryHistoryEntry): string {
        const lines = [
            entry.query,
            '',
            `Connection: ${entry.connectionName}`,
            `Time: ${entry.executionTime}ms`,
            `Rows: ${entry.rowCount}`,
            `Status: ${entry.status}`
        ];

        if (entry.error) {
            lines.push(`Error: ${entry.error}`);
        }

        return lines.join('\n');
    }
}

/**
 * Tree data provider for query history
 */
export class QueryHistoryProvider implements vscode.TreeDataProvider<QueryHistoryTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<QueryHistoryTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private history: QueryHistoryEntry[] = [];
    private readonly maxHistorySize = 100;

    constructor(
        private context: vscode.ExtensionContext,
        private _i18n: I18n
    ) {
        this.loadHistory();
    }

    /**
     * Refresh the tree view
     */
    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    /**
     * Add a query to history
     */
    async addQuery(entry: Omit<QueryHistoryEntry, 'id'>): Promise<void> {
        const newEntry: QueryHistoryEntry = {
            ...entry,
            id: crypto.randomUUID()
        };

        this.history.unshift(newEntry);

        // Limit history size
        if (this.history.length > this.maxHistorySize) {
            this.history = this.history.slice(0, this.maxHistorySize);
        }

        await this.saveHistory();
        this.refresh();
    }

    /**
     * Clear all history
     */
    async clearHistory(): Promise<void> {
        this.history = [];
        await this.saveHistory();
        this.refresh();
    }

    /**
     * Get tree item for display
     */
    getTreeItem(element: QueryHistoryTreeItem): vscode.TreeItem {
        return element;
    }

    /**
     * Get children of a tree item
     */
    async getChildren(_element?: QueryHistoryTreeItem): Promise<QueryHistoryTreeItem[]> {
        return this.history.map(entry => new QueryHistoryTreeItem(entry));
    }

    /**
     * Load history from storage
     */
    private loadHistory(): void {
        const saved = this.context.globalState.get<QueryHistoryEntry[]>('dbunny.queryHistory', []);
        this.history = saved;
    }

    /**
     * Save history to storage
     */
    private async saveHistory(): Promise<void> {
        await this.context.globalState.update('dbunny.queryHistory', this.history);
    }

    /**
     * Get all history entries
     */
    getHistory(): QueryHistoryEntry[] {
        return [...this.history];
    }
}
