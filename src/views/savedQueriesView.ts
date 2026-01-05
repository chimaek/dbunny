import * as vscode from 'vscode';
import { SavedQuery } from '../types/database';
import { I18n } from '../utils/i18n';

/**
 * Tree item for saved queries
 */
export class SavedQueryTreeItem extends vscode.TreeItem {
    constructor(
        public readonly savedQuery: SavedQuery
    ) {
        super(savedQuery.name, vscode.TreeItemCollapsibleState.None);

        this.description = savedQuery.category || '';
        this.tooltip = this.buildTooltip(savedQuery);
        this.contextValue = 'savedQuery';
        this.iconPath = new vscode.ThemeIcon('bookmark');

        this.command = {
            command: 'dbunny.loadSavedQuery',
            title: 'Load Query',
            arguments: [savedQuery]
        };
    }

    private buildTooltip(query: SavedQuery): string {
        const lines = [
            query.name,
            '',
            query.query,
            ''
        ];

        if (query.description) {
            lines.push(`Description: ${query.description}`);
        }
        if (query.category) {
            lines.push(`Category: ${query.category}`);
        }
        if (query.databaseType) {
            lines.push(`Database: ${query.databaseType}`);
        }

        return lines.join('\n');
    }
}

/**
 * Tree data provider for saved queries
 */
export class SavedQueriesProvider implements vscode.TreeDataProvider<SavedQueryTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<SavedQueryTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private savedQueries: SavedQuery[] = [];

    constructor(
        private context: vscode.ExtensionContext,
        private _i18n: I18n
    ) {
        this.loadSavedQueries();
    }

    /**
     * Refresh the tree view
     */
    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    /**
     * Save a new query
     */
    async saveQuery(query: Omit<SavedQuery, 'id' | 'createdAt' | 'updatedAt'>): Promise<SavedQuery> {
        const now = new Date();
        const newQuery: SavedQuery = {
            ...query,
            id: crypto.randomUUID(),
            createdAt: now,
            updatedAt: now
        };

        this.savedQueries.push(newQuery);
        await this.persistSavedQueries();
        this.refresh();

        return newQuery;
    }

    /**
     * Update an existing query
     */
    async updateQuery(id: string, updates: Partial<Omit<SavedQuery, 'id' | 'createdAt'>>): Promise<void> {
        const index = this.savedQueries.findIndex(q => q.id === id);
        if (index !== -1) {
            this.savedQueries[index] = {
                ...this.savedQueries[index],
                ...updates,
                updatedAt: new Date()
            };
            await this.persistSavedQueries();
            this.refresh();
        }
    }

    /**
     * Delete a saved query
     */
    async deleteQuery(id: string): Promise<void> {
        this.savedQueries = this.savedQueries.filter(q => q.id !== id);
        await this.persistSavedQueries();
        this.refresh();
    }

    /**
     * Get a saved query by ID
     */
    getQuery(id: string): SavedQuery | undefined {
        return this.savedQueries.find(q => q.id === id);
    }

    /**
     * Get all saved queries
     */
    getAllQueries(): SavedQuery[] {
        return [...this.savedQueries];
    }

    /**
     * Get all categories
     */
    getCategories(): string[] {
        const categories = new Set<string>();
        this.savedQueries.forEach(q => {
            if (q.category) {
                categories.add(q.category);
            }
        });
        return Array.from(categories).sort();
    }

    /**
     * Get tree item for display
     */
    getTreeItem(element: SavedQueryTreeItem): vscode.TreeItem {
        return element;
    }

    /**
     * Get children of a tree item
     */
    async getChildren(_element?: SavedQueryTreeItem): Promise<SavedQueryTreeItem[]> {
        // Sort by name
        const sorted = [...this.savedQueries].sort((a, b) => a.name.localeCompare(b.name));
        return sorted.map(query => new SavedQueryTreeItem(query));
    }

    /**
     * Load saved queries from storage
     */
    private loadSavedQueries(): void {
        const saved = this.context.globalState.get<SavedQuery[]>('dbunny.savedQueries', []);
        this.savedQueries = saved;
    }

    /**
     * Save queries to storage
     */
    private async persistSavedQueries(): Promise<void> {
        await this.context.globalState.update('dbunny.savedQueries', this.savedQueries);
    }
}
