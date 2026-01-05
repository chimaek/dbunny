import * as vscode from 'vscode';
import { QueryResult } from '../types/database';
import { I18n } from '../utils/i18n';

/**
 * Webview panel for displaying query results
 */
export class QueryResultPanel {
    public static currentPanel: QueryResultPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];

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
                        await this._handleExport(message.format, message.data);
                        break;
                    case 'copy':
                        await vscode.env.clipboard.writeText(message.text);
                        vscode.window.showInformationMessage('Copied to clipboard');
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

    private async _handleExport(format: string, data: QueryResult): Promise<void> {
        const defaultName = `query_result_${Date.now()}`;

        const uri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(`${defaultName}.${format}`),
            filters: {
                'CSV': ['csv'],
                'JSON': ['json'],
                'All Files': ['*']
            }
        });

        if (!uri) { return; }

        let content: string;
        if (format === 'csv') {
            content = this._toCSV(data);
        } else {
            content = JSON.stringify(data.rows, null, 2);
        }

        await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
        vscode.window.showInformationMessage(`Exported to ${uri.fsPath}`);
    }

    private _toCSV(data: QueryResult): string {
        if (data.rows.length === 0) { return ''; }

        const headers = data.fields.map(f => f.name);
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

    private _getHtmlContent(query: string, result: QueryResult): string {
        const tableHeaders = result.fields.map(f =>
            `<th data-field="${this._escapeHtml(f.name)}">
                <div class="th-content">
                    <span class="th-name">${this._escapeHtml(f.name)}</span>
                    <span class="th-type">${f.type || ''}</span>
                </div>
                <span class="sort-icon">↕</span>
            </th>`
        ).join('');

        const tableRows = result.rows.map((row, idx) =>
            `<tr data-row="${idx}">
                <td class="row-num">${idx + 1}</td>
                ${result.fields.map(f => {
                    const val = row[f.name];
                    let displayVal: string;
                    let className = '';

                    if (val === null) {
                        displayVal = 'NULL';
                        className = 'null-value';
                    } else if (val === undefined) {
                        displayVal = 'undefined';
                        className = 'null-value';
                    } else if (typeof val === 'boolean') {
                        displayVal = val ? 'true' : 'false';
                        className = val ? 'bool-true' : 'bool-false';
                    } else if (typeof val === 'number') {
                        displayVal = this._escapeHtml(String(val));
                        className = 'number-value';
                    } else {
                        displayVal = this._escapeHtml(String(val));
                    }

                    return `<td class="${className}" title="${this._escapeHtml(String(val))}">${displayVal}</td>`;
                }).join('')}
            </tr>`
        ).join('');

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
            padding: 1.25rem 1.5rem;
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
            margin-bottom: 0.9rem;
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
            gap: 1.5rem;
            flex-wrap: wrap;
        }
        .stat-item {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            padding: 0.5rem 1rem;
            background: var(--vscode-input-background);
            border-radius: 0.4rem;
            border: 1px solid var(--vscode-panel-border);
        }
        .stat-icon {
            font-size: 1.25rem;
        }
        .stat-label {
            font-size: 0.85rem;
            color: var(--vscode-descriptionForeground);
            text-transform: uppercase;
            letter-spacing: 0.02rem;
        }
        .stat-value {
            font-size: 1.1rem;
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
            padding: 0.5rem 1rem;
            border: 1px solid var(--vscode-button-border, var(--vscode-panel-border));
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border-radius: 0.4rem;
            cursor: pointer;
            font-size: 0.9rem;
            font-weight: 500;
            display: flex;
            align-items: center;
            gap: 0.4rem;
            transition: all 0.15s ease;
        }
        .btn:hover {
            background: var(--vscode-button-secondaryHoverBackground);
            transform: translateY(-0.0625rem);
        }
        .btn-primary {
            background: var(--accent-color);
            color: white;
            border-color: var(--accent-color);
        }
        .btn-primary:hover {
            filter: brightness(1.1);
        }

        /* Query Section */
        .query-section {
            padding: 0 1.5rem;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        .query-toggle {
            padding: 0.75rem 0;
            cursor: pointer;
            user-select: none;
            display: flex;
            align-items: center;
            gap: 0.5rem;
            font-size: 0.9rem;
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
            padding-bottom: 0.9rem;
        }
        .query-section.open .query-content {
            display: block;
        }
        .query-content pre {
            margin: 0;
            padding: 0.9rem;
            background: var(--vscode-textBlockQuote-background);
            border-radius: 0.4rem;
            white-space: pre-wrap;
            word-break: break-all;
            font-family: var(--vscode-editor-font-family, 'Consolas', monospace);
            font-size: 0.9rem;
            max-height: 9rem;
            overflow-y: auto;
        }

        /* Table Container */
        .table-container {
            overflow: auto;
            max-height: calc(100vh - 15rem);
        }
        table {
            width: 100%;
            border-collapse: collapse;
            font-size: 0.9rem;
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
            cursor: pointer;
            user-select: none;
            transition: background 0.15s ease;
        }
        th:hover {
            background: var(--vscode-list-hoverBackground);
        }
        th .th-content {
            padding: 0.75rem 0.9rem;
            display: flex;
            flex-direction: column;
            gap: 0.125rem;
        }
        th .th-name {
            white-space: nowrap;
        }
        th .th-type {
            font-size: 0.75rem;
            font-weight: normal;
            color: var(--vscode-descriptionForeground);
            opacity: 0.8;
        }
        th .sort-icon {
            position: absolute;
            right: 0.5rem;
            top: 50%;
            transform: translateY(-50%);
            opacity: 0.3;
            font-size: 0.75rem;
        }
        th:hover .sort-icon {
            opacity: 0.7;
        }
        th.sorted-asc .sort-icon { opacity: 1; }
        th.sorted-asc .sort-icon::after { content: '↑'; }
        th.sorted-desc .sort-icon { opacity: 1; }
        th.sorted-desc .sort-icon::after { content: '↓'; }

        /* Table Row Number */
        .row-num-header, .row-num {
            width: 3.5rem;
            min-width: 3.5rem;
            max-width: 3.5rem;
            text-align: center;
            color: var(--vscode-descriptionForeground);
            background: var(--vscode-editorWidget-background);
            border-right: 1px solid var(--vscode-panel-border);
            font-size: 0.85rem;
            position: sticky;
            left: 0;
        }
        .row-num-header {
            z-index: 2;
        }

        /* Table Cells */
        td {
            padding: 0.5rem 0.9rem;
            border-bottom: 1px solid var(--vscode-panel-border);
            max-width: 25rem;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            position: relative;
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
            padding: 4.5rem 3rem;
            text-align: center;
            color: var(--vscode-descriptionForeground);
        }
        .no-results-icon {
            font-size: 3.5rem;
            margin-bottom: 1.25rem;
            opacity: 0.5;
        }
        .no-results-text {
            font-size: 1.25rem;
            margin-bottom: 0.5rem;
        }
        .no-results-hint {
            font-size: 1rem;
            opacity: 0.7;
        }

        /* Scrollbar */
        ::-webkit-scrollbar {
            width: 0.625rem;
            height: 0.625rem;
        }
        ::-webkit-scrollbar-track {
            background: transparent;
        }
        ::-webkit-scrollbar-thumb {
            background: var(--vscode-scrollbarSlider-background);
            border-radius: 0.3rem;
        }
        ::-webkit-scrollbar-thumb:hover {
            background: var(--vscode-scrollbarSlider-hoverBackground);
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
                <button class="btn" onclick="copyResults()" title="Copy to clipboard">
                    <span>📋</span> Copy
                </button>
                <button class="btn" onclick="exportCSV()" title="Export as CSV">
                    <span>📄</span> CSV
                </button>
                <button class="btn btn-primary" onclick="exportJSON()" title="Export as JSON">
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
                    <div class="stat-value">${result.fields.length}</div>
                </div>
            </div>
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
                <tr>
                    <th class="row-num-header">#</th>
                    ${tableHeaders}
                </tr>
            </thead>
            <tbody>${tableRows}</tbody>
        </table>
    </div>
    ` : `
    <div class="no-results">
        <div class="no-results-icon">📭</div>
        <div class="no-results-text">No results returned</div>
        <div class="no-results-hint">The query executed successfully but returned no rows</div>
    </div>
    `}

    <script>
        const vscode = acquireVsCodeApi();
        const resultData = ${JSON.stringify(result)};
        let sortField = null;
        let sortDirection = 'asc';

        function toggleQuery() {
            document.getElementById('querySection').classList.toggle('open');
        }

        function copyResults() {
            const text = JSON.stringify(resultData.rows, null, 2);
            vscode.postMessage({ command: 'copy', text });
        }

        function exportCSV() {
            vscode.postMessage({ command: 'export', format: 'csv', data: resultData });
        }

        function exportJSON() {
            vscode.postMessage({ command: 'export', format: 'json', data: resultData });
        }

        // Column sorting
        document.querySelectorAll('th[data-field]').forEach(th => {
            th.addEventListener('click', () => {
                const field = th.dataset.field;

                // Toggle direction if same field
                if (sortField === field) {
                    sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
                } else {
                    sortField = field;
                    sortDirection = 'asc';
                }

                // Update UI
                document.querySelectorAll('th').forEach(h => {
                    h.classList.remove('sorted-asc', 'sorted-desc');
                });
                th.classList.add('sorted-' + sortDirection);

                // Sort data
                const tbody = document.querySelector('tbody');
                const rows = Array.from(tbody.querySelectorAll('tr'));

                rows.sort((a, b) => {
                    const aVal = a.querySelector('td[title]')?.title || '';
                    const bVal = b.querySelector('td[title]')?.title || '';

                    const aNum = parseFloat(aVal);
                    const bNum = parseFloat(bVal);

                    let comparison = 0;
                    if (!isNaN(aNum) && !isNaN(bNum)) {
                        comparison = aNum - bNum;
                    } else {
                        comparison = aVal.localeCompare(bVal);
                    }

                    return sortDirection === 'asc' ? comparison : -comparison;
                });

                rows.forEach(row => tbody.appendChild(row));
            });
        });

        // Row selection
        document.querySelectorAll('tbody tr').forEach(tr => {
            tr.addEventListener('click', () => {
                document.querySelectorAll('tbody tr').forEach(r => r.classList.remove('selected'));
                tr.classList.add('selected');
            });
        });
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
