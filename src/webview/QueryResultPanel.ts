import * as vscode from 'vscode';
import { QueryResult } from '../types/database';
import { I18n } from '../utils/i18n';
import { exportSingleSheet } from '../utils/dataExport';

/**
 * Column settings for result display
 */
interface ColumnSettings {
    name: string;
    visible: boolean;
    order: number;
}

/**
 * Webview panel for displaying query results
 */
export class QueryResultPanel {
    public static currentPanel: QueryResultPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];
    private _columnSettings: Map<string, ColumnSettings[]> = new Map();

    private constructor(
        panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri,
        private i18n: I18n
    ) {
        this._panel = panel;
        this._extensionUri = extensionUri;

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'export':
                        await this._handleExport(message.format, message.data, message.visibleColumns);
                        break;
                    case 'copy':
                        await vscode.env.clipboard.writeText(message.text);
                        vscode.window.showInformationMessage(this.i18n.t('copiedToClipboard') || 'Copied to clipboard');
                        break;
                    case 'saveColumnSettings':
                        this._columnSettings.set(message.queryId, message.settings);
                        break;
                    case 'saveChanges':
                        await this._handleSaveChanges(message.changes);
                        break;
                    case 'deleteRows':
                        await this._handleDeleteRows(message.rows);
                        break;
                }
            },
            null,
            this._disposables
        );
    }

    /**
     * Create or show the query result panel
     */
    public static createOrShow(
        extensionUri: vscode.Uri,
        i18n: I18n
    ): QueryResultPanel {
        const column = vscode.ViewColumn.Two;

        if (QueryResultPanel.currentPanel) {
            QueryResultPanel.currentPanel._panel.reveal(column);
            return QueryResultPanel.currentPanel;
        }

        const panel = vscode.window.createWebviewPanel(
            'dbunnyQueryResult',
            'Query Results',
            column,
            {
                enableScripts: true,
                localResourceRoots: [extensionUri],
                retainContextWhenHidden: true
            }
        );

        QueryResultPanel.currentPanel = new QueryResultPanel(panel, extensionUri, i18n);
        return QueryResultPanel.currentPanel;
    }

    /**
     * Update the panel with new query results
     */
    public updateResults(query: string, result: QueryResult): void {
        this._panel.webview.html = this._getHtmlContent(query, result);
    }

    /**
     * Show error in the panel
     */
    public showError(query: string, error: string): void {
        this._panel.webview.html = this._getErrorHtml(query, error);
    }

    /**
     * Show loading state
     */
    public showLoading(_query: string): void {
        this._panel.webview.html = this._getLoadingHtml();
    }

    private async _handleSaveChanges(changes: Array<{ rowIndex: number; originalRow: Record<string, unknown>; changes: Record<string, unknown> }>): Promise<void> {
        // Note: Inline editing is a visual feature for now.
        // Full implementation would require:
        // 1. Knowing the table name from the query
        // 2. Having primary key information
        // 3. Generating UPDATE statements
        // 4. Executing them with proper transaction handling

        const changeCount = changes.reduce((acc, c) => acc + Object.keys(c.changes).length, 0);
        vscode.window.showInformationMessage(
            this.i18n.t('changesRecorded', { count: changeCount }) || `${changeCount} change(s) recorded. Note: Inline editing preview - changes are not persisted to database.`
        );
    }

    private async _handleDeleteRows(rows: Array<{ rowIndex: number; row: Record<string, unknown> }>): Promise<void> {
        // Note: Row deletion is a visual feature for now.
        // Full implementation would require:
        // 1. Knowing the table name from the query
        // 2. Having primary key information
        // 3. Generating DELETE statements
        // 4. Executing them with proper transaction handling

        vscode.window.showInformationMessage(
            this.i18n.t('rowsMarkedForDeletion', { count: rows.length }) || `${rows.length} row(s) marked for deletion. Note: Inline editing preview - changes are not persisted to database.`
        );
    }

    private async _handleExport(format: string, data: QueryResult, visibleColumns?: string[]): Promise<void> {
        const defaultName = `query_result_${Date.now()}`;

        const filters: Record<string, string[]> = format === 'xlsx'
            ? { 'Excel': ['xlsx'], 'All Files': ['*'] }
            : { 'CSV': ['csv'], 'JSON': ['json'], 'All Files': ['*'] };

        const uri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(`${defaultName}.${format}`),
            filters,
        });

        if (!uri) { return; }

        if (format === 'xlsx') {
            const buf = exportSingleSheet(data, 'QueryResult', undefined, visibleColumns);
            await vscode.workspace.fs.writeFile(uri, buf);
        } else {
            const content = format === 'csv'
                ? this._toCSV(data, visibleColumns)
                : this._toJSON(data, visibleColumns);
            await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
        }

        vscode.window.showInformationMessage(`Exported to ${uri.fsPath}`);
    }

    private _toCSV(data: QueryResult, visibleColumns?: string[]): string {
        if (data.rows.length === 0) { return ''; }

        const headers = visibleColumns || data.fields.map(f => f.name);
        const lines = [headers.join(',')];

        for (const row of data.rows) {
            const values = headers.map(h => {
                const val = row[h];
                if (val === null || val === undefined) { return ''; }
                const str = String(val);
                if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                    return `"${str.replace(/"/g, '""')}"`;
                }
                return str;
            });
            lines.push(values.join(','));
        }

        return lines.join('\n');
    }

    private _toJSON(data: QueryResult, visibleColumns?: string[]): string {
        if (!visibleColumns) {
            return JSON.stringify(data.rows, null, 2);
        }

        const filteredRows = data.rows.map(row => {
            const filteredRow: Record<string, unknown> = {};
            for (const col of visibleColumns) {
                filteredRow[col] = row[col];
            }
            return filteredRow;
        });
        return JSON.stringify(filteredRows, null, 2);
    }

    private _generateQueryId(query: string): string {
        // Generate a simple hash from the query for settings storage
        let hash = 0;
        for (let i = 0; i < query.length; i++) {
            const char = query.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return 'q_' + Math.abs(hash).toString(36);
    }

    private _getHtmlContent(query: string, result: QueryResult): string {
        const queryId = this._generateQueryId(query);
        const savedSettings = this._columnSettings.get(queryId);

        // Generate column data for JavaScript
        const columnsData = result.fields.map((f, idx) => ({
            name: f.name,
            type: f.type || '',
            visible: savedSettings ? (savedSettings.find(s => s.name === f.name)?.visible ?? true) : true,
            order: savedSettings ? (savedSettings.find(s => s.name === f.name)?.order ?? idx) : idx
        }));

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Query Results</title>
    <style>
        :root {
            --accent-color: #007ACC;
            --success-color: #28a745;
            --warning-color: #ffc107;
            --error-color: #dc3545;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        html {
            font-size: var(--vscode-font-size, 13px);
        }
        body {
            font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
            color: var(--vscode-foreground);
            background: var(--vscode-editor-background);
            font-size: 1rem;
            line-height: 1.4;
        }

        /* Header */
        .header {
            padding: 1rem 1.5rem;
            background: linear-gradient(to bottom, var(--vscode-sideBar-background), var(--vscode-editor-background));
            border-bottom: 1px solid var(--vscode-panel-border);
            position: sticky;
            top: 0;
            z-index: 100;
        }
        .header-top {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 0.75rem;
        }
        .title {
            display: flex;
            align-items: center;
            gap: 0.75rem;
            font-size: 1.25rem;
            font-weight: 600;
        }
        .title-icon {
            font-size: 1.5rem;
        }

        /* Stats */
        .stats {
            display: flex;
            gap: 1rem;
            flex-wrap: wrap;
            margin-bottom: 0.75rem;
        }
        .stat-item {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            padding: 0.4rem 0.75rem;
            background: var(--vscode-input-background);
            border-radius: 0.4rem;
            border: 1px solid var(--vscode-panel-border);
        }
        .stat-icon {
            font-size: 1rem;
        }
        .stat-label {
            font-size: 0.75rem;
            color: var(--vscode-descriptionForeground);
            text-transform: uppercase;
            letter-spacing: 0.02rem;
        }
        .stat-value {
            font-size: 1rem;
            font-weight: 600;
            color: var(--vscode-foreground);
        }
        .stat-item.success .stat-value { color: var(--success-color); }

        /* Actions */
        .actions {
            display: flex;
            gap: 0.5rem;
        }
        .btn {
            padding: 0.4rem 0.75rem;
            border: 1px solid var(--vscode-button-border, var(--vscode-panel-border));
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border-radius: 0.4rem;
            cursor: pointer;
            font-size: 0.85rem;
            font-weight: 500;
            display: flex;
            align-items: center;
            gap: 0.4rem;
            transition: all 0.15s ease;
        }
        .btn:hover {
            background: var(--vscode-button-secondaryHoverBackground);
            transform: translateY(-1px);
        }
        .btn-primary {
            background: var(--accent-color);
            color: white;
            border-color: var(--accent-color);
        }
        .btn-primary:hover {
            filter: brightness(1.1);
        }

        /* Filter Bar */
        .filter-bar {
            display: flex;
            gap: 0.75rem;
            align-items: center;
            flex-wrap: wrap;
        }
        .search-box {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            padding: 0.4rem 0.75rem;
            background: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: 0.4rem;
            flex: 1;
            min-width: 200px;
            max-width: 350px;
        }
        .search-box:focus-within {
            border-color: var(--accent-color);
            outline: none;
        }
        .search-box input {
            flex: 1;
            background: transparent;
            border: none;
            color: var(--vscode-input-foreground);
            font-size: 0.9rem;
            outline: none;
        }
        .search-box input::placeholder {
            color: var(--vscode-input-placeholderForeground);
        }
        .search-clear {
            background: none;
            border: none;
            color: var(--vscode-descriptionForeground);
            cursor: pointer;
            padding: 0;
            font-size: 1rem;
            line-height: 1;
        }
        .search-clear:hover {
            color: var(--vscode-foreground);
        }

        .filter-info {
            font-size: 0.85rem;
            color: var(--vscode-descriptionForeground);
            padding: 0.4rem 0.75rem;
            background: var(--vscode-badge-background);
            border-radius: 0.4rem;
        }
        .filter-info.active {
            background: rgba(0, 122, 204, 0.2);
            color: var(--accent-color);
        }

        /* Query Section */
        .query-section {
            padding: 0 1.5rem;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        .query-toggle {
            padding: 0.5rem 0;
            cursor: pointer;
            user-select: none;
            display: flex;
            align-items: center;
            gap: 0.5rem;
            font-size: 0.85rem;
            color: var(--vscode-descriptionForeground);
        }
        .query-toggle:hover {
            color: var(--vscode-foreground);
        }
        .query-toggle .arrow {
            transition: transform 0.2s ease;
        }
        .query-section.open .query-toggle .arrow {
            transform: rotate(90deg);
        }
        .query-content {
            display: none;
            padding-bottom: 0.75rem;
        }
        .query-section.open .query-content {
            display: block;
        }
        .query-content pre {
            margin: 0;
            padding: 0.75rem;
            background: var(--vscode-textBlockQuote-background);
            border-radius: 0.4rem;
            white-space: pre-wrap;
            word-break: break-all;
            font-family: var(--vscode-editor-font-family, 'Consolas', monospace);
            font-size: 0.85rem;
            max-height: 8rem;
            overflow-y: auto;
        }

        /* Column Manager */
        .column-manager {
            position: relative;
        }
        .column-panel {
            display: none;
            position: absolute;
            top: 100%;
            right: 0;
            margin-top: 0.5rem;
            background: var(--vscode-editorWidget-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 0.5rem;
            box-shadow: 0 4px 12px rgba(0,0,0,0.2);
            z-index: 1000;
            min-width: 280px;
            max-height: 400px;
            overflow: hidden;
        }
        .column-panel.open {
            display: block;
        }
        .column-panel-header {
            padding: 0.75rem 1rem;
            border-bottom: 1px solid var(--vscode-panel-border);
            display: flex;
            justify-content: space-between;
            align-items: center;
            background: var(--vscode-sideBar-background);
        }
        .column-panel-header h4 {
            margin: 0;
            font-size: 0.9rem;
        }
        .column-panel-actions {
            display: flex;
            gap: 0.5rem;
        }
        .column-panel-actions button {
            padding: 0.25rem 0.5rem;
            font-size: 0.75rem;
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 0.25rem;
            cursor: pointer;
        }
        .column-panel-actions button:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }
        .column-list {
            max-height: 300px;
            overflow-y: auto;
            padding: 0.5rem;
        }
        .column-item {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            padding: 0.5rem;
            border-radius: 0.25rem;
            cursor: grab;
            user-select: none;
        }
        .column-item:hover {
            background: var(--vscode-list-hoverBackground);
        }
        .column-item.dragging {
            opacity: 0.5;
            background: var(--vscode-list-activeSelectionBackground);
        }
        .column-item.drag-over {
            border-top: 2px solid var(--accent-color);
        }
        .column-item input[type="checkbox"] {
            width: 1rem;
            height: 1rem;
            cursor: pointer;
        }
        .column-item .drag-handle {
            color: var(--vscode-descriptionForeground);
            cursor: grab;
            font-size: 1rem;
        }
        .column-item .column-name {
            flex: 1;
            font-size: 0.85rem;
        }
        .column-item .column-type {
            font-size: 0.75rem;
            color: var(--vscode-descriptionForeground);
        }

        /* Column Filter Dropdown */
        .column-filter-dropdown {
            display: none;
            position: absolute;
            top: 100%;
            left: 0;
            margin-top: 2px;
            background: var(--vscode-editorWidget-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 0.4rem;
            box-shadow: 0 4px 12px rgba(0,0,0,0.2);
            z-index: 1000;
            min-width: 200px;
            max-height: 300px;
            overflow: hidden;
        }
        .column-filter-dropdown.open {
            display: block;
        }
        .column-filter-search {
            padding: 0.5rem;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        .column-filter-search input {
            width: 100%;
            padding: 0.4rem 0.5rem;
            background: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: 0.25rem;
            color: var(--vscode-input-foreground);
            font-size: 0.85rem;
        }
        .column-filter-list {
            max-height: 220px;
            overflow-y: auto;
        }
        .column-filter-item {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            padding: 0.4rem 0.75rem;
            cursor: pointer;
            font-size: 0.85rem;
        }
        .column-filter-item:hover {
            background: var(--vscode-list-hoverBackground);
        }
        .column-filter-item.selected {
            background: var(--vscode-list-activeSelectionBackground);
            color: var(--vscode-list-activeSelectionForeground);
        }
        .column-filter-actions {
            padding: 0.5rem;
            border-top: 1px solid var(--vscode-panel-border);
            display: flex;
            gap: 0.5rem;
        }
        .column-filter-actions button {
            flex: 1;
            padding: 0.4rem;
            font-size: 0.8rem;
        }

        /* Table Container */
        .table-container {
            overflow: auto;
            max-height: calc(100vh - 16rem);
        }
        table {
            width: 100%;
            border-collapse: collapse;
            font-size: 0.85rem;
            font-family: var(--vscode-editor-font-family, monospace);
        }

        /* Table Header */
        th {
            position: sticky;
            top: 0;
            background: var(--vscode-editorWidget-background);
            padding: 0;
            text-align: left;
            font-weight: 600;
            border-bottom: 2px solid var(--vscode-panel-border);
            user-select: none;
            transition: background 0.15s ease;
        }
        th .th-wrapper {
            display: flex;
            align-items: center;
            position: relative;
        }
        th .th-content {
            flex: 1;
            padding: 0.6rem 0.75rem;
            display: flex;
            flex-direction: column;
            gap: 0.1rem;
            cursor: pointer;
        }
        th .th-content:hover {
            background: var(--vscode-list-hoverBackground);
        }
        th .th-name {
            white-space: nowrap;
        }
        th .th-type {
            font-size: 0.7rem;
            font-weight: normal;
            color: var(--vscode-descriptionForeground);
            opacity: 0.8;
        }
        th .sort-icon {
            margin-left: 0.25rem;
            opacity: 0.3;
            font-size: 0.7rem;
        }
        th.sorted-asc .sort-icon,
        th.sorted-desc .sort-icon { opacity: 1; }
        th .filter-btn {
            padding: 0.4rem;
            background: none;
            border: none;
            color: var(--vscode-descriptionForeground);
            cursor: pointer;
            font-size: 0.8rem;
            border-left: 1px solid var(--vscode-panel-border);
        }
        th .filter-btn:hover {
            background: var(--vscode-list-hoverBackground);
            color: var(--vscode-foreground);
        }
        th .filter-btn.active {
            color: var(--accent-color);
        }
        th.hidden-column {
            display: none;
        }

        /* Table Row Number */
        .row-num-header, .row-num {
            width: 3rem;
            min-width: 3rem;
            max-width: 3rem;
            text-align: center;
            color: var(--vscode-descriptionForeground);
            background: var(--vscode-editorWidget-background);
            border-right: 1px solid var(--vscode-panel-border);
            font-size: 0.8rem;
            position: sticky;
            left: 0;
        }
        .row-num-header {
            z-index: 2;
        }

        /* Table Cells */
        td {
            padding: 0.4rem 0.75rem;
            border-bottom: 1px solid var(--vscode-panel-border);
            max-width: 20rem;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            position: relative;
        }
        td.hidden-column {
            display: none;
        }
        tr:nth-child(even) td {
            background: rgba(128, 128, 128, 0.04);
        }
        tr:hover td {
            background: var(--vscode-list-hoverBackground) !important;
        }
        tr.selected td {
            background: var(--vscode-list-activeSelectionBackground) !important;
            color: var(--vscode-list-activeSelectionForeground);
        }
        tr.filtered-out {
            display: none;
        }
        tr.highlight td {
            background: rgba(255, 235, 59, 0.15) !important;
        }

        /* Value Types */
        .null-value {
            color: var(--vscode-descriptionForeground);
            font-style: italic;
            opacity: 0.7;
        }
        .number-value {
            color: var(--vscode-debugTokenExpression-number, #b5cea8);
            text-align: right;
        }
        .bool-true {
            color: var(--success-color);
        }
        .bool-false {
            color: var(--error-color);
        }

        /* No Results */
        .no-results {
            padding: 3rem 2rem;
            text-align: center;
            color: var(--vscode-descriptionForeground);
        }
        .no-results-icon {
            font-size: 3rem;
            margin-bottom: 1rem;
            opacity: 0.5;
        }
        .no-results-text {
            font-size: 1.1rem;
            margin-bottom: 0.4rem;
        }
        .no-results-hint {
            font-size: 0.9rem;
            opacity: 0.7;
        }

        /* Scrollbar */
        ::-webkit-scrollbar {
            width: 0.5rem;
            height: 0.5rem;
        }
        ::-webkit-scrollbar-track {
            background: transparent;
        }
        ::-webkit-scrollbar-thumb {
            background: var(--vscode-scrollbarSlider-background);
            border-radius: 0.25rem;
        }
        ::-webkit-scrollbar-thumb:hover {
            background: var(--vscode-scrollbarSlider-hoverBackground);
        }

        /* Cell Expand Modal */
        .cell-modal-overlay {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.5);
            z-index: 2000;
            justify-content: center;
            align-items: center;
        }
        .cell-modal-overlay.open {
            display: flex;
        }
        .cell-modal {
            background: var(--vscode-editorWidget-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 0.5rem;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
            width: 90%;
            max-width: 800px;
            max-height: 80vh;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }
        .cell-modal-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 0.75rem 1rem;
            border-bottom: 1px solid var(--vscode-panel-border);
            background: var(--vscode-sideBar-background);
        }
        .cell-modal-title {
            font-weight: 600;
            font-size: 0.9rem;
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }
        .cell-modal-title .column-name {
            color: var(--accent-color);
        }
        .cell-modal-actions {
            display: flex;
            gap: 0.5rem;
        }
        .cell-modal-actions button {
            padding: 0.3rem 0.6rem;
            font-size: 0.8rem;
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 0.25rem;
            cursor: pointer;
        }
        .cell-modal-actions button:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }
        .cell-modal-actions .close-btn {
            background: none;
            border: none;
            font-size: 1.2rem;
            color: var(--vscode-descriptionForeground);
            cursor: pointer;
            padding: 0.2rem 0.5rem;
        }
        .cell-modal-actions .close-btn:hover {
            color: var(--vscode-foreground);
        }
        .cell-modal-content {
            flex: 1;
            overflow: auto;
            padding: 1rem;
        }
        .cell-modal-content pre {
            margin: 0;
            white-space: pre-wrap;
            word-break: break-all;
            font-family: var(--vscode-editor-font-family, 'Consolas', monospace);
            font-size: 0.85rem;
            line-height: 1.5;
        }
        .cell-modal-content .json-key {
            color: #9cdcfe;
        }
        .cell-modal-content .json-string {
            color: #ce9178;
        }
        .cell-modal-content .json-number {
            color: #b5cea8;
        }
        .cell-modal-content .json-boolean {
            color: #569cd6;
        }
        .cell-modal-content .json-null {
            color: #569cd6;
        }
        .cell-modal-footer {
            padding: 0.5rem 1rem;
            border-top: 1px solid var(--vscode-panel-border);
            font-size: 0.75rem;
            color: var(--vscode-descriptionForeground);
            display: flex;
            justify-content: space-between;
        }

        /* Clickable cell indicator */
        td {
            cursor: pointer;
        }
        td:hover {
            background: var(--vscode-list-hoverBackground) !important;
        }

        /* Inline Editing Styles */
        .edit-mode-active td {
            cursor: text;
        }
        td.editing {
            padding: 0 !important;
            background: var(--vscode-input-background) !important;
        }
        td.editing input {
            width: 100%;
            height: 100%;
            padding: 0.4rem 0.75rem;
            border: 2px solid var(--accent-color);
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            font-family: inherit;
            font-size: inherit;
            outline: none;
            box-sizing: border-box;
        }
        td.modified {
            background: rgba(255, 193, 7, 0.15) !important;
            border-left: 3px solid var(--warning-color);
        }
        td.modified::before {
            content: '●';
            position: absolute;
            left: 2px;
            top: 2px;
            font-size: 0.5rem;
            color: var(--warning-color);
        }

        /* Edit Mode Header Indicator */
        .edit-mode-indicator {
            display: none;
            padding: 0.4rem 0.75rem;
            background: rgba(255, 193, 7, 0.2);
            border: 1px solid var(--warning-color);
            border-radius: 0.4rem;
            color: var(--warning-color);
            font-size: 0.85rem;
            font-weight: 500;
        }
        .edit-mode-indicator.active {
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }

        /* Pending Changes Bar */
        .pending-changes-bar {
            display: none;
            padding: 0.75rem 1.5rem;
            background: rgba(255, 193, 7, 0.1);
            border-bottom: 1px solid var(--warning-color);
            align-items: center;
            justify-content: space-between;
        }
        .pending-changes-bar.active {
            display: flex;
        }
        .pending-changes-info {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            font-size: 0.9rem;
        }
        .pending-changes-actions {
            display: flex;
            gap: 0.5rem;
        }
        .btn-save {
            background: var(--success-color) !important;
            color: white !important;
            border-color: var(--success-color) !important;
        }
        .btn-discard {
            background: var(--error-color) !important;
            color: white !important;
            border-color: var(--error-color) !important;
        }

        /* Row selection for multi-select */
        tr.multi-selected td {
            background: rgba(0, 122, 204, 0.2) !important;
        }
        tr.multi-selected td.row-num {
            background: var(--accent-color) !important;
            color: white;
        }

        /* Expand button in cells */
        td .expand-btn {
            position: absolute;
            right: 2px;
            top: 50%;
            transform: translateY(-50%);
            padding: 2px 4px;
            font-size: 0.65rem;
            background: var(--vscode-button-secondaryBackground);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 2px;
            cursor: pointer;
            opacity: 0;
            transition: opacity 0.15s;
        }
        td:hover .expand-btn {
            opacity: 0.7;
        }
        td .expand-btn:hover {
            opacity: 1;
            background: var(--vscode-button-secondaryHoverBackground);
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="header-top">
            <div class="title">
                <span class="title-icon">📊</span>
                <span>Query Results</span>
            </div>
            <div class="actions">
                <div class="column-manager">
                    <button class="btn" onclick="toggleColumnPanel()" title="Manage columns">
                        <span>⚙️</span> Columns
                    </button>
                    <div class="column-panel" id="columnPanel">
                        <div class="column-panel-header">
                            <h4>Column Settings</h4>
                            <div class="column-panel-actions">
                                <button onclick="showAllColumns()">Show All</button>
                                <button onclick="hideAllColumns()">Hide All</button>
                                <button onclick="resetColumns()">Reset</button>
                            </div>
                        </div>
                        <div class="column-list" id="columnList"></div>
                    </div>
                </div>
                <button class="btn" onclick="copyResults()" title="Copy visible data">
                    <span>📋</span> Copy
                </button>
                <button class="btn" onclick="exportCSV()" title="Export visible as CSV">
                    <span>📄</span> CSV
                </button>
                <button class="btn btn-primary" onclick="exportJSON()" title="Export visible as JSON">
                    <span>📦</span> JSON
                </button>
            </div>
        </div>
        <div class="stats">
            <div class="stat-item success">
                <span class="stat-icon">✅</span>
                <div>
                    <div class="stat-label">Rows</div>
                    <div class="stat-value">${result.rowCount.toLocaleString()}</div>
                </div>
            </div>
            <div class="stat-item">
                <span class="stat-icon">⏱️</span>
                <div>
                    <div class="stat-label">Time</div>
                    <div class="stat-value">${result.executionTime}ms</div>
                </div>
            </div>
            <div class="stat-item">
                <span class="stat-icon">📊</span>
                <div>
                    <div class="stat-label">Columns</div>
                    <div class="stat-value" id="visibleColumnsCount">${result.fields.length}</div>
                </div>
            </div>
        </div>
        <div class="filter-bar">
            <div class="search-box">
                <span>🔍</span>
                <input type="text" id="globalSearch" placeholder="Search all columns..." oninput="handleGlobalSearch(this.value)">
                <button class="search-clear" onclick="clearSearch()" style="display:none" id="searchClear">×</button>
            </div>
            <div class="filter-info" id="filterInfo">Showing all ${result.rows.length} rows</div>
            <div class="edit-mode-indicator" id="editModeIndicator">
                <span>✏️</span>
                <span>Edit Mode</span>
            </div>
        </div>
    </div>

    <!-- Pending Changes Bar -->
    <div class="pending-changes-bar" id="pendingChangesBar">
        <div class="pending-changes-info">
            <span>⚠️</span>
            <span id="pendingChangesCount">0 pending changes</span>
        </div>
        <div class="pending-changes-actions">
            <button class="btn btn-discard" onclick="discardAllChanges()">
                <span>✖</span> Discard All
            </button>
            <button class="btn btn-save" onclick="saveAllChanges()">
                <span>💾</span> Save Changes
            </button>
        </div>
    </div>

    <div class="query-section" id="querySection">
        <div class="query-toggle" onclick="toggleQuery()">
            <span class="arrow">▶</span>
            <span>Show Query</span>
        </div>
        <div class="query-content">
            <pre>${this._escapeHtml(query)}</pre>
        </div>
    </div>

    ${result.rows.length > 0 ? `
    <div class="table-container">
        <table id="resultTable">
            <thead>
                <tr id="headerRow">
                    <th class="row-num-header">#</th>
                </tr>
            </thead>
            <tbody id="tableBody"></tbody>
        </table>
    </div>
    ` : `
    <div class="no-results">
        <div class="no-results-icon">📭</div>
        <div class="no-results-text">No results returned</div>
        <div class="no-results-hint">The query executed successfully but returned no rows</div>
    </div>
    `}

    <!-- Cell Expand Modal -->
    <div class="cell-modal-overlay" id="cellModal">
        <div class="cell-modal">
            <div class="cell-modal-header">
                <div class="cell-modal-title">
                    <span>📋</span>
                    <span>Column: </span>
                    <span class="column-name" id="modalColumnName"></span>
                </div>
                <div class="cell-modal-actions">
                    <button onclick="copyModalContent()" title="Copy content">📋 Copy</button>
                    <button class="close-btn" onclick="closeCellModal()">×</button>
                </div>
            </div>
            <div class="cell-modal-content">
                <pre id="modalContent"></pre>
            </div>
            <div class="cell-modal-footer">
                <span id="modalType">Text</span>
                <span id="modalLength"></span>
            </div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        const resultData = ${JSON.stringify(result)};
        const queryId = '${queryId}';

        // State management
        let columns = ${JSON.stringify(columnsData)};
        let sortField = null;
        let sortDirection = 'asc';
        let globalSearchTerm = '';
        let columnFilters = {}; // { columnName: Set of selected values }
        let openFilterDropdown = null;
        let currentFilteredRows = []; // Store filtered rows for cell expand access

        // Inline editing state
        let pendingChanges = new Map(); // Map<rowIndex, Map<columnName, newValue>>
        let currentEditingCell = null;
        let selectedRows = new Set(); // For multi-row selection

        // Initialize
        function init() {
            renderTable();
            renderColumnPanel();
        }

        // Toggle query section
        function toggleQuery() {
            document.getElementById('querySection').classList.toggle('open');
        }

        // Toggle column settings panel
        function toggleColumnPanel() {
            const panel = document.getElementById('columnPanel');
            panel.classList.toggle('open');
            if (panel.classList.contains('open')) {
                renderColumnPanel();
            }
        }

        // Render column panel for visibility and reorder
        function renderColumnPanel() {
            const list = document.getElementById('columnList');
            if (!list) return;

            const sortedColumns = [...columns].sort((a, b) => a.order - b.order);

            list.innerHTML = sortedColumns.map((col, idx) => \`
                <div class="column-item" draggable="true" data-column="\${col.name}" data-order="\${col.order}">
                    <span class="drag-handle">⋮⋮</span>
                    <input type="checkbox" \${col.visible ? 'checked' : ''}
                           onchange="toggleColumnVisibility('\${col.name}', this.checked)">
                    <span class="column-name">\${escapeHtml(col.name)}</span>
                    <span class="column-type">\${col.type}</span>
                </div>
            \`).join('');

            // Setup drag and drop
            setupColumnDragDrop();
        }

        // Setup drag and drop for column reordering
        function setupColumnDragDrop() {
            const items = document.querySelectorAll('.column-item');
            let draggedItem = null;

            items.forEach(item => {
                item.addEventListener('dragstart', (e) => {
                    draggedItem = item;
                    item.classList.add('dragging');
                    e.dataTransfer.effectAllowed = 'move';
                });

                item.addEventListener('dragend', () => {
                    item.classList.remove('dragging');
                    items.forEach(i => i.classList.remove('drag-over'));
                    draggedItem = null;
                });

                item.addEventListener('dragover', (e) => {
                    e.preventDefault();
                    if (draggedItem && draggedItem !== item) {
                        item.classList.add('drag-over');
                    }
                });

                item.addEventListener('dragleave', () => {
                    item.classList.remove('drag-over');
                });

                item.addEventListener('drop', (e) => {
                    e.preventDefault();
                    item.classList.remove('drag-over');

                    if (draggedItem && draggedItem !== item) {
                        const fromCol = draggedItem.dataset.column;
                        const toCol = item.dataset.column;
                        reorderColumns(fromCol, toCol);
                    }
                });
            });
        }

        // Reorder columns
        function reorderColumns(fromName, toName) {
            const fromIdx = columns.findIndex(c => c.name === fromName);
            const toIdx = columns.findIndex(c => c.name === toName);

            if (fromIdx === -1 || toIdx === -1) return;

            // Update orders
            const sortedColumns = [...columns].sort((a, b) => a.order - b.order);
            const fromOrder = sortedColumns.findIndex(c => c.name === fromName);
            const toOrder = sortedColumns.findIndex(c => c.name === toName);

            // Remove from current position and insert at new position
            const [removed] = sortedColumns.splice(fromOrder, 1);
            sortedColumns.splice(toOrder, 0, removed);

            // Update order values
            sortedColumns.forEach((col, idx) => {
                const original = columns.find(c => c.name === col.name);
                if (original) original.order = idx;
            });

            saveColumnSettings();
            renderTable();
            renderColumnPanel();
        }

        // Toggle column visibility
        function toggleColumnVisibility(columnName, visible) {
            const col = columns.find(c => c.name === columnName);
            if (col) {
                col.visible = visible;
                saveColumnSettings();
                renderTable();
                updateVisibleColumnsCount();
            }
        }

        // Show all columns
        function showAllColumns() {
            columns.forEach(c => c.visible = true);
            saveColumnSettings();
            renderTable();
            renderColumnPanel();
            updateVisibleColumnsCount();
        }

        // Hide all columns
        function hideAllColumns() {
            columns.forEach(c => c.visible = false);
            saveColumnSettings();
            renderTable();
            renderColumnPanel();
            updateVisibleColumnsCount();
        }

        // Reset columns to default
        function resetColumns() {
            columns.forEach((c, idx) => {
                c.visible = true;
                c.order = idx;
            });
            columnFilters = {};
            saveColumnSettings();
            renderTable();
            renderColumnPanel();
            updateVisibleColumnsCount();
        }

        // Update visible columns count display
        function updateVisibleColumnsCount() {
            const count = columns.filter(c => c.visible).length;
            document.getElementById('visibleColumnsCount').textContent = count + '/' + columns.length;
        }

        // Save column settings
        function saveColumnSettings() {
            const settings = columns.map(c => ({
                name: c.name,
                visible: c.visible,
                order: c.order
            }));
            vscode.postMessage({
                command: 'saveColumnSettings',
                queryId: queryId,
                settings: settings
            });
        }

        // Get visible columns in order
        function getVisibleColumnsInOrder() {
            return [...columns]
                .filter(c => c.visible)
                .sort((a, b) => a.order - b.order);
        }

        // Render table
        function renderTable() {
            const headerRow = document.getElementById('headerRow');
            const tbody = document.getElementById('tableBody');
            if (!headerRow || !tbody) return;

            const visibleColumns = getVisibleColumnsInOrder();

            // Render headers
            headerRow.innerHTML = '<th class="row-num-header">#</th>' + visibleColumns.map(col => \`
                <th data-field="\${escapeHtml(col.name)}" class="\${sortField === col.name ? 'sorted-' + sortDirection : ''}">
                    <div class="th-wrapper">
                        <div class="th-content" onclick="handleSort('\${escapeHtml(col.name)}')">
                            <span class="th-name">\${escapeHtml(col.name)}</span>
                            <span class="th-type">\${col.type}</span>
                            <span class="sort-icon">\${sortField === col.name ? (sortDirection === 'asc' ? '↑' : '↓') : '↕'}</span>
                        </div>
                        <button class="filter-btn \${columnFilters[col.name]?.size > 0 ? 'active' : ''}"
                                onclick="event.stopPropagation(); toggleColumnFilter('\${escapeHtml(col.name)}', this)">
                            ▼
                        </button>
                    </div>
                    <div class="column-filter-dropdown" id="filter-\${escapeHtml(col.name)}">
                        <div class="column-filter-search">
                            <input type="text" placeholder="Search values..."
                                   oninput="filterColumnValues('\${escapeHtml(col.name)}', this.value)">
                        </div>
                        <div class="column-filter-list" id="filterList-\${escapeHtml(col.name)}"></div>
                        <div class="column-filter-actions">
                            <button class="btn" onclick="selectAllFilterValues('\${escapeHtml(col.name)}')">Select All</button>
                            <button class="btn" onclick="clearColumnFilter('\${escapeHtml(col.name)}')">Clear</button>
                            <button class="btn btn-primary" onclick="applyColumnFilter('\${escapeHtml(col.name)}')">Apply</button>
                        </div>
                    </div>
                </th>
            \`).join('');

            // Sort and filter data
            let filteredRows = [...resultData.rows];

            // Apply global search
            if (globalSearchTerm) {
                const term = globalSearchTerm.toLowerCase();
                filteredRows = filteredRows.filter(row => {
                    return visibleColumns.some(col => {
                        const val = row[col.name];
                        return val !== null && val !== undefined &&
                               String(val).toLowerCase().includes(term);
                    });
                });
            }

            // Apply column filters
            for (const [colName, selectedValues] of Object.entries(columnFilters)) {
                if (selectedValues && selectedValues.size > 0) {
                    filteredRows = filteredRows.filter(row => {
                        const val = row[colName];
                        const strVal = val === null ? 'NULL' : String(val);
                        return selectedValues.has(strVal);
                    });
                }
            }

            // Sort
            if (sortField) {
                filteredRows.sort((a, b) => {
                    const aVal = a[sortField];
                    const bVal = b[sortField];

                    if (aVal === null && bVal === null) return 0;
                    if (aVal === null) return 1;
                    if (bVal === null) return -1;

                    const aNum = parseFloat(aVal);
                    const bNum = parseFloat(bVal);

                    let comparison = 0;
                    if (!isNaN(aNum) && !isNaN(bNum)) {
                        comparison = aNum - bNum;
                    } else {
                        comparison = String(aVal).localeCompare(String(bVal));
                    }

                    return sortDirection === 'asc' ? comparison : -comparison;
                });
            }

            // Store filtered rows for access from cell handlers
            currentFilteredRows = filteredRows;

            // Render rows
            tbody.innerHTML = filteredRows.map((row, idx) => {
                const originalIdx = resultData.rows.indexOf(row);
                const rowChanges = pendingChanges.get(originalIdx);
                const isMultiSelected = selectedRows.has(originalIdx);

                const cells = visibleColumns.map(col => {
                    const originalVal = row[col.name];
                    const hasChange = rowChanges && rowChanges.has(col.name);
                    const val = hasChange ? rowChanges.get(col.name) : originalVal;
                    let displayVal, className = '';

                    if (val === null) {
                        displayVal = 'NULL';
                        className = 'null-value';
                    } else if (val === undefined) {
                        displayVal = '';
                        className = 'null-value';
                    } else if (typeof val === 'boolean') {
                        displayVal = val ? 'true' : 'false';
                        className = val ? 'bool-true' : 'bool-false';
                    } else if (typeof val === 'number') {
                        displayVal = escapeHtml(String(val));
                        className = 'number-value';
                    } else {
                        displayVal = escapeHtml(String(val));
                    }

                    // Check if content is long or JSON (show expand button)
                    const strVal = String(val);
                    const isLongContent = strVal.length > 50 || strVal.includes('\\n');
                    const isJsonContent = (strVal.startsWith('{') && strVal.endsWith('}')) ||
                                         (strVal.startsWith('[') && strVal.endsWith(']'));
                    const showExpandBtn = isLongContent || isJsonContent;

                    // Highlight search term
                    if (globalSearchTerm && displayVal.toLowerCase().includes(globalSearchTerm.toLowerCase())) {
                        const regex = new RegExp('(' + escapeRegex(globalSearchTerm) + ')', 'gi');
                        displayVal = displayVal.replace(regex, '<mark>$1</mark>');
                    }

                    // Add modified class if changed
                    if (hasChange) {
                        className += ' modified';
                    }

                    const expandBtn = showExpandBtn ?
                        \`<button class="expand-btn" onclick="event.stopPropagation(); openCellModal('\${escapeHtml(col.name)}', currentFilteredRows[\${idx}]['\${escapeHtml(col.name)}'], \${idx})">↗</button>\` : '';

                    return \`<td class="\${className}" data-field="\${escapeHtml(col.name)}" data-original-idx="\${originalIdx}" title="\${escapeHtml(String(originalVal))}">\${displayVal}\${expandBtn}</td>\`;
                }).join('');

                const rowClass = isMultiSelected ? 'multi-selected' : '';
                return \`<tr data-row="\${idx}" data-original-idx="\${originalIdx}" class="\${rowClass}">\n                    <td class="row-num">\${idx + 1}</td>\${cells}\n                </tr>\`;
            }).join('');

            // Update filter info
            updateFilterInfo(filteredRows.length);

            // Reattach row click handlers
            document.querySelectorAll('tbody tr').forEach(tr => {
                tr.addEventListener('click', () => {
                    document.querySelectorAll('tbody tr').forEach(r => r.classList.remove('selected'));
                    tr.classList.add('selected');
                });
            });

            // Attach cell double-click handlers for inline editing
            document.querySelectorAll('tbody td:not(.row-num)').forEach(td => {
                td.addEventListener('dblclick', (e) => {
                    e.stopPropagation();
                    startCellEdit(td);
                });
            });

            // Attach row click for multi-select with Ctrl/Shift
            document.querySelectorAll('tbody tr').forEach(tr => {
                tr.querySelector('.row-num')?.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const originalIdx = parseInt(tr.dataset.originalIdx, 10);
                    if (e.ctrlKey || e.metaKey) {
                        // Toggle selection
                        if (selectedRows.has(originalIdx)) {
                            selectedRows.delete(originalIdx);
                        } else {
                            selectedRows.add(originalIdx);
                        }
                        renderTable();
                    } else {
                        // Single selection
                        selectedRows.clear();
                        selectedRows.add(originalIdx);
                        renderTable();
                    }
                });
            });
        }

        // Start editing a cell
        function startCellEdit(td) {
            if (currentEditingCell) {
                finishCellEdit(currentEditingCell);
            }

            const field = td.dataset.field;
            const originalIdx = parseInt(td.dataset.originalIdx, 10);
            if (field === undefined || isNaN(originalIdx)) return;

            const row = resultData.rows[originalIdx];
            const rowChanges = pendingChanges.get(originalIdx);
            const currentValue = rowChanges && rowChanges.has(field) ? rowChanges.get(field) : row[field];

            // Create input element
            const input = document.createElement('input');
            input.type = 'text';
            input.value = currentValue === null ? '' : String(currentValue);
            input.dataset.field = field;
            input.dataset.originalIdx = String(originalIdx);
            input.dataset.originalValue = currentValue === null ? '' : String(currentValue);

            // Store original content
            td.dataset.originalHtml = td.innerHTML;
            td.innerHTML = '';
            td.classList.add('editing');
            td.appendChild(input);
            input.focus();
            input.select();

            currentEditingCell = td;

            // Show edit mode indicator
            document.getElementById('editModeIndicator')?.classList.add('active');

            // Handle input events
            input.addEventListener('blur', () => {
                setTimeout(() => finishCellEdit(td), 100);
            });

            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    finishCellEdit(td);
                    // Move to next cell
                    const nextTd = td.nextElementSibling;
                    if (nextTd && !nextTd.classList.contains('row-num')) {
                        startCellEdit(nextTd);
                    }
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    cancelCellEdit(td);
                } else if (e.key === 'Tab') {
                    e.preventDefault();
                    finishCellEdit(td);
                    const nextTd = e.shiftKey ? td.previousElementSibling : td.nextElementSibling;
                    if (nextTd && !nextTd.classList.contains('row-num')) {
                        startCellEdit(nextTd);
                    }
                }
            });
        }

        // Finish editing and save value
        function finishCellEdit(td) {
            if (!td.classList.contains('editing')) return;

            const input = td.querySelector('input');
            if (!input) return;

            const field = input.dataset.field;
            const originalIdx = parseInt(input.dataset.originalIdx, 10);
            const newValue = input.value;
            const originalValue = input.dataset.originalValue;

            // Check if value changed
            const row = resultData.rows[originalIdx];
            const dbOriginalValue = row[field] === null ? '' : String(row[field]);

            if (newValue !== dbOriginalValue) {
                // Record the change
                if (!pendingChanges.has(originalIdx)) {
                    pendingChanges.set(originalIdx, new Map());
                }
                pendingChanges.get(originalIdx).set(field, newValue === '' ? null : newValue);
            } else {
                // Remove change if reverted to original
                if (pendingChanges.has(originalIdx)) {
                    pendingChanges.get(originalIdx).delete(field);
                    if (pendingChanges.get(originalIdx).size === 0) {
                        pendingChanges.delete(originalIdx);
                    }
                }
            }

            currentEditingCell = null;
            updatePendingChangesUI();
            renderTable();
        }

        // Cancel editing
        function cancelCellEdit(td) {
            if (!td.classList.contains('editing')) return;

            td.innerHTML = td.dataset.originalHtml || '';
            td.classList.remove('editing');
            currentEditingCell = null;

            if (pendingChanges.size === 0) {
                document.getElementById('editModeIndicator')?.classList.remove('active');
            }
        }

        // Update pending changes UI
        function updatePendingChangesUI() {
            const bar = document.getElementById('pendingChangesBar');
            const countEl = document.getElementById('pendingChangesCount');
            const indicator = document.getElementById('editModeIndicator');

            let totalChanges = 0;
            pendingChanges.forEach(changes => totalChanges += changes.size);

            if (totalChanges > 0) {
                bar?.classList.add('active');
                indicator?.classList.add('active');
                if (countEl) {
                    countEl.textContent = totalChanges + ' pending change' + (totalChanges > 1 ? 's' : '');
                }
            } else {
                bar?.classList.remove('active');
                indicator?.classList.remove('active');
            }
        }

        // Discard all changes
        function discardAllChanges() {
            pendingChanges.clear();
            selectedRows.clear();
            updatePendingChangesUI();
            renderTable();
        }

        // Save all changes
        function saveAllChanges() {
            if (pendingChanges.size === 0) return;

            // Collect all changes into array for backend
            const changes = [];
            pendingChanges.forEach((columnChanges, rowIdx) => {
                const row = resultData.rows[rowIdx];
                const rowChange = {
                    rowIndex: rowIdx,
                    originalRow: row,
                    changes: {}
                };
                columnChanges.forEach((newValue, columnName) => {
                    rowChange.changes[columnName] = newValue;
                });
                changes.push(rowChange);
            });

            // Send to extension for processing
            vscode.postMessage({
                command: 'saveChanges',
                changes: changes
            });

            // Clear pending changes (backend will handle actual save)
            pendingChanges.clear();
            selectedRows.clear();
            updatePendingChangesUI();
            renderTable();
        }

        // Delete selected rows
        function deleteSelectedRows() {
            if (selectedRows.size === 0) return;

            const rowsToDelete = [];
            selectedRows.forEach(idx => {
                rowsToDelete.push({
                    rowIndex: idx,
                    row: resultData.rows[idx]
                });
            });

            vscode.postMessage({
                command: 'deleteRows',
                rows: rowsToDelete
            });

            selectedRows.clear();
            renderTable();
        }

        // Handle sorting
        function handleSort(field) {
            if (sortField === field) {
                sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
            } else {
                sortField = field;
                sortDirection = 'asc';
            }
            renderTable();
        }

        // Toggle column filter dropdown
        function toggleColumnFilter(columnName, btn) {
            const dropdown = document.getElementById('filter-' + columnName);
            if (!dropdown) return;

            // Close other open dropdowns
            document.querySelectorAll('.column-filter-dropdown.open').forEach(d => {
                if (d !== dropdown) d.classList.remove('open');
            });

            dropdown.classList.toggle('open');

            if (dropdown.classList.contains('open')) {
                openFilterDropdown = columnName;
                renderColumnFilterValues(columnName);
            } else {
                openFilterDropdown = null;
            }
        }

        // Render column filter values
        function renderColumnFilterValues(columnName, searchTerm = '') {
            const list = document.getElementById('filterList-' + columnName);
            if (!list) return;

            // Get unique values
            const values = new Set();
            resultData.rows.forEach(row => {
                const val = row[columnName];
                values.add(val === null ? 'NULL' : String(val));
            });

            let sortedValues = [...values].sort();

            // Filter by search term
            if (searchTerm) {
                const term = searchTerm.toLowerCase();
                sortedValues = sortedValues.filter(v => v.toLowerCase().includes(term));
            }

            // Get currently selected values
            const selectedValues = columnFilters[columnName] || new Set();

            list.innerHTML = sortedValues.slice(0, 100).map(val => \`
                <div class="column-filter-item \${selectedValues.has(val) ? 'selected' : ''}"
                     onclick="toggleFilterValue('\${escapeHtml(columnName)}', '\${escapeHtml(val)}')">
                    <input type="checkbox" \${selectedValues.has(val) ? 'checked' : ''}>
                    <span>\${escapeHtml(val)}</span>
                </div>
            \`).join('');

            if (sortedValues.length > 100) {
                list.innerHTML += '<div style="padding: 0.5rem; color: var(--vscode-descriptionForeground);">...and ' + (sortedValues.length - 100) + ' more</div>';
            }
        }

        // Filter column values (search within dropdown)
        function filterColumnValues(columnName, searchTerm) {
            renderColumnFilterValues(columnName, searchTerm);
        }

        // Toggle filter value selection
        function toggleFilterValue(columnName, value) {
            if (!columnFilters[columnName]) {
                columnFilters[columnName] = new Set();
            }

            if (columnFilters[columnName].has(value)) {
                columnFilters[columnName].delete(value);
            } else {
                columnFilters[columnName].add(value);
            }

            renderColumnFilterValues(columnName);
        }

        // Select all filter values
        function selectAllFilterValues(columnName) {
            columnFilters[columnName] = new Set();
            resultData.rows.forEach(row => {
                const val = row[columnName];
                columnFilters[columnName].add(val === null ? 'NULL' : String(val));
            });
            renderColumnFilterValues(columnName);
        }

        // Clear column filter
        function clearColumnFilter(columnName) {
            delete columnFilters[columnName];
            renderColumnFilterValues(columnName);
            renderTable();
        }

        // Apply column filter
        function applyColumnFilter(columnName) {
            const dropdown = document.getElementById('filter-' + columnName);
            if (dropdown) dropdown.classList.remove('open');
            openFilterDropdown = null;
            renderTable();
        }

        // Global search
        function handleGlobalSearch(term) {
            globalSearchTerm = term;
            document.getElementById('searchClear').style.display = term ? 'block' : 'none';
            renderTable();
        }

        function clearSearch() {
            document.getElementById('globalSearch').value = '';
            globalSearchTerm = '';
            document.getElementById('searchClear').style.display = 'none';
            renderTable();
        }

        // Update filter info
        function updateFilterInfo(visibleCount) {
            const info = document.getElementById('filterInfo');
            const total = resultData.rows.length;

            if (visibleCount === total && !globalSearchTerm && Object.keys(columnFilters).length === 0) {
                info.textContent = 'Showing all ' + total + ' rows';
                info.classList.remove('active');
            } else {
                info.textContent = 'Showing ' + visibleCount + ' of ' + total + ' rows';
                info.classList.add('active');
            }
        }

        // Copy results
        function copyResults() {
            const visibleColumns = getVisibleColumnsInOrder().map(c => c.name);
            const filteredData = getFilteredData();
            const text = JSON.stringify(filteredData.map(row => {
                const obj = {};
                visibleColumns.forEach(col => obj[col] = row[col]);
                return obj;
            }), null, 2);
            vscode.postMessage({ command: 'copy', text });
        }

        // Get filtered data
        function getFilteredData() {
            let rows = [...resultData.rows];
            const visibleColumns = getVisibleColumnsInOrder();

            if (globalSearchTerm) {
                const term = globalSearchTerm.toLowerCase();
                rows = rows.filter(row => {
                    return visibleColumns.some(col => {
                        const val = row[col.name];
                        return val !== null && val !== undefined &&
                               String(val).toLowerCase().includes(term);
                    });
                });
            }

            for (const [colName, selectedValues] of Object.entries(columnFilters)) {
                if (selectedValues && selectedValues.size > 0) {
                    rows = rows.filter(row => {
                        const val = row[colName];
                        const strVal = val === null ? 'NULL' : String(val);
                        return selectedValues.has(strVal);
                    });
                }
            }

            return rows;
        }

        function exportCSV() {
            const visibleColumns = getVisibleColumnsInOrder().map(c => c.name);
            vscode.postMessage({ command: 'export', format: 'csv', data: resultData, visibleColumns });
        }

        function exportJSON() {
            const visibleColumns = getVisibleColumnsInOrder().map(c => c.name);
            vscode.postMessage({ command: 'export', format: 'json', data: resultData, visibleColumns });
        }

        // Escape HTML
        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        // Escape regex special characters
        function escapeRegex(string) {
            return string.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\$&');
        }

        // Cell Modal Functions
        let currentModalContent = '';

        function openCellModal(columnName, value, rowIndex) {
            const modal = document.getElementById('cellModal');
            const columnNameEl = document.getElementById('modalColumnName');
            const contentEl = document.getElementById('modalContent');
            const typeEl = document.getElementById('modalType');
            const lengthEl = document.getElementById('modalLength');

            columnNameEl.textContent = columnName;

            // Store raw content for copying
            currentModalContent = value === null ? 'NULL' : String(value);

            // Determine content type and format accordingly
            let formattedContent = '';
            let contentType = 'Text';

            if (value === null) {
                formattedContent = '<span class="json-null">NULL</span>';
                contentType = 'NULL';
            } else if (typeof value === 'object') {
                // JSON object
                formattedContent = formatJsonWithHighlight(value);
                contentType = 'JSON Object';
                currentModalContent = JSON.stringify(value, null, 2);
            } else if (typeof value === 'string') {
                // Try to parse as JSON
                try {
                    const parsed = JSON.parse(value);
                    if (typeof parsed === 'object' && parsed !== null) {
                        formattedContent = formatJsonWithHighlight(parsed);
                        contentType = 'JSON';
                        currentModalContent = JSON.stringify(parsed, null, 2);
                    } else {
                        formattedContent = escapeHtml(value);
                    }
                } catch {
                    formattedContent = escapeHtml(value);
                }
            } else if (typeof value === 'number') {
                formattedContent = '<span class="json-number">' + value + '</span>';
                contentType = 'Number';
            } else if (typeof value === 'boolean') {
                formattedContent = '<span class="json-boolean">' + value + '</span>';
                contentType = 'Boolean';
            } else {
                formattedContent = escapeHtml(String(value));
            }

            contentEl.innerHTML = formattedContent;
            typeEl.textContent = contentType;
            lengthEl.textContent = currentModalContent.length + ' characters';

            modal.classList.add('open');
        }

        function closeCellModal() {
            document.getElementById('cellModal').classList.remove('open');
        }

        function copyModalContent() {
            vscode.postMessage({ command: 'copy', text: currentModalContent });
        }

        function formatJsonWithHighlight(obj, indent = 0) {
            const indentStr = '  '.repeat(indent);
            const nextIndent = '  '.repeat(indent + 1);

            if (obj === null) {
                return '<span class="json-null">null</span>';
            }

            if (Array.isArray(obj)) {
                if (obj.length === 0) return '[]';
                const items = obj.map(item => nextIndent + formatJsonWithHighlight(item, indent + 1));
                return '[\\n' + items.join(',\\n') + '\\n' + indentStr + ']';
            }

            if (typeof obj === 'object') {
                const keys = Object.keys(obj);
                if (keys.length === 0) return '{}';
                const pairs = keys.map(key => {
                    const val = formatJsonWithHighlight(obj[key], indent + 1);
                    return nextIndent + '<span class="json-key">"' + escapeHtml(key) + '"</span>: ' + val;
                });
                return '{\\n' + pairs.join(',\\n') + '\\n' + indentStr + '}';
            }

            if (typeof obj === 'string') {
                return '<span class="json-string">"' + escapeHtml(obj) + '"</span>';
            }

            if (typeof obj === 'number') {
                return '<span class="json-number">' + obj + '</span>';
            }

            if (typeof obj === 'boolean') {
                return '<span class="json-boolean">' + obj + '</span>';
            }

            return escapeHtml(String(obj));
        }

        // Close dropdowns when clicking outside
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.column-panel') && !e.target.closest('.column-manager .btn')) {
                document.getElementById('columnPanel')?.classList.remove('open');
            }
            if (!e.target.closest('.column-filter-dropdown') && !e.target.closest('.filter-btn')) {
                document.querySelectorAll('.column-filter-dropdown.open').forEach(d => d.classList.remove('open'));
                openFilterDropdown = null;
            }
        });

        // Close modal when clicking overlay
        document.getElementById('cellModal')?.addEventListener('click', (e) => {
            if (e.target.id === 'cellModal') {
                closeCellModal();
            }
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                // Close modal first if open
                const modal = document.getElementById('cellModal');
                if (modal?.classList.contains('open')) {
                    closeCellModal();
                    return;
                }
                // Cancel cell edit if active
                if (currentEditingCell) {
                    cancelCellEdit(currentEditingCell);
                    return;
                }
                // Clear selection
                if (selectedRows.size > 0) {
                    selectedRows.clear();
                    renderTable();
                    return;
                }
                document.getElementById('columnPanel')?.classList.remove('open');
                document.querySelectorAll('.column-filter-dropdown.open').forEach(d => d.classList.remove('open'));
            }
            if (e.ctrlKey && e.key === 'f') {
                e.preventDefault();
                document.getElementById('globalSearch')?.focus();
            }
            // Delete selected rows
            if (e.key === 'Delete' && selectedRows.size > 0 && !currentEditingCell) {
                e.preventDefault();
                if (confirm('Delete ' + selectedRows.size + ' selected row(s)?')) {
                    deleteSelectedRows();
                }
            }
            // Ctrl+C - Copy selected rows or cell value
            if (e.ctrlKey && e.key === 'c' && !currentEditingCell) {
                const selected = document.querySelector('tbody tr.selected');
                if (selected || selectedRows.size > 0) {
                    e.preventDefault();
                    copySelectedData();
                }
            }
            // Ctrl+S - Save changes
            if (e.ctrlKey && e.key === 's' && pendingChanges.size > 0) {
                e.preventDefault();
                saveAllChanges();
            }
            // Ctrl+Z - Discard changes (undo)
            if (e.ctrlKey && e.key === 'z' && pendingChanges.size > 0 && !currentEditingCell) {
                e.preventDefault();
                discardAllChanges();
            }
        });

        // Copy selected data to clipboard
        function copySelectedData() {
            const visibleColumns = getVisibleColumnsInOrder().map(c => c.name);
            let dataToCopy = [];

            if (selectedRows.size > 0) {
                selectedRows.forEach(idx => {
                    const row = resultData.rows[idx];
                    const rowData = {};
                    visibleColumns.forEach(col => rowData[col] = row[col]);
                    dataToCopy.push(rowData);
                });
            } else {
                // Copy single selected row
                const selected = document.querySelector('tbody tr.selected');
                if (selected) {
                    const idx = parseInt(selected.dataset.originalIdx, 10);
                    const row = resultData.rows[idx];
                    const rowData = {};
                    visibleColumns.forEach(col => rowData[col] = row[col]);
                    dataToCopy.push(rowData);
                }
            }

            if (dataToCopy.length > 0) {
                const text = JSON.stringify(dataToCopy, null, 2);
                vscode.postMessage({ command: 'copy', text });
            }
        }

        // Initialize
        init();
    </script>
</body>
</html>`;
    }

    private _getErrorHtml(query: string, error: string): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Query Error</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        html {
            font-size: var(--vscode-font-size, 13px);
        }
        body {
            font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, sans-serif);
            padding: 2.5rem;
            color: var(--vscode-foreground);
            background: var(--vscode-editor-background);
        }
        .error-container {
            max-width: 45rem;
            margin: 0 auto;
        }
        .error-header {
            display: flex;
            align-items: center;
            gap: 0.9rem;
            margin-bottom: 1.5rem;
        }
        .error-icon {
            font-size: 2.5rem;
        }
        .error-title {
            font-size: 1.5rem;
            font-weight: 600;
            color: #dc3545;
        }
        .error-box {
            padding: 1.5rem;
            background: rgba(220, 53, 69, 0.1);
            border: 1px solid rgba(220, 53, 69, 0.3);
            border-radius: 0.5rem;
            margin-bottom: 1.8rem;
        }
        .error-message {
            font-family: var(--vscode-editor-font-family, monospace);
            font-size: 1rem;
            white-space: pre-wrap;
            word-break: break-all;
            color: #dc3545;
        }
        .query-section {
            padding: 1.25rem;
            background: var(--vscode-input-background);
            border-radius: 0.5rem;
            border: 1px solid var(--vscode-panel-border);
        }
        .query-label {
            font-size: 0.9rem;
            color: var(--vscode-descriptionForeground);
            margin-bottom: 0.5rem;
            text-transform: uppercase;
            letter-spacing: 0.03rem;
        }
        .query-section pre {
            margin: 0;
            white-space: pre-wrap;
            font-family: var(--vscode-editor-font-family, monospace);
            font-size: 0.9rem;
            max-height: 11rem;
            overflow-y: auto;
        }
        .retry-btn {
            margin-top: 1.5rem;
            padding: 0.75rem 1.5rem;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 0.4rem;
            cursor: pointer;
            font-size: 1rem;
        }
        .retry-btn:hover {
            background: var(--vscode-button-hoverBackground);
        }
    </style>
</head>
<body>
    <div class="error-container">
        <div class="error-header">
            <span class="error-icon">❌</span>
            <span class="error-title">Query Failed</span>
        </div>
        <div class="error-box">
            <div class="error-message">${this._escapeHtml(error)}</div>
        </div>
        <div class="query-section">
            <div class="query-label">Query</div>
            <pre>${this._escapeHtml(query)}</pre>
        </div>
    </div>
</body>
</html>`;
    }

    private _getLoadingHtml(): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Executing Query...</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        html {
            font-size: var(--vscode-font-size, 13px);
        }
        body {
            font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, sans-serif);
            color: var(--vscode-foreground);
            background: var(--vscode-editor-background);
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            padding: 3rem;
        }
        .loading-container {
            text-align: center;
        }
        .bunny {
            font-size: 3.5rem;
            animation: hop 0.5s ease-in-out infinite alternate;
        }
        @keyframes hop {
            from { transform: translateY(0); }
            to { transform: translateY(-0.75rem); }
        }
        .spinner-container {
            margin: 1.8rem 0;
        }
        .spinner {
            width: 3rem;
            height: 3rem;
            border: 0.2rem solid var(--vscode-panel-border);
            border-top-color: var(--vscode-progressBar-background, #007ACC);
            border-radius: 50%;
            animation: spin 0.8s linear infinite;
            margin: 0 auto;
        }
        @keyframes spin {
            to { transform: rotate(360deg); }
        }
        .message {
            color: var(--vscode-descriptionForeground);
            font-size: 1.1rem;
        }
        .dots {
            display: inline-block;
        }
        .dots::after {
            content: '';
            animation: dots 1.5s steps(4, end) infinite;
        }
        @keyframes dots {
            0%, 20% { content: ''; }
            40% { content: '.'; }
            60% { content: '..'; }
            80%, 100% { content: '...'; }
        }
    </style>
</head>
<body>
    <div class="loading-container">
        <div class="bunny">🐰</div>
        <div class="spinner-container">
            <div class="spinner"></div>
        </div>
        <div class="message">Executing query<span class="dots"></span></div>
    </div>
</body>
</html>`;
    }

    private _escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    public dispose(): void {
        QueryResultPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const disposable = this._disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }
}
