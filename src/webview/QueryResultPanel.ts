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
    public showLoading(query: string): void {
        this._panel.webview.html = this._getLoadingHtml(query);
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

        if (!uri) return;

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
        if (data.rows.length === 0) return '';

        const headers = data.fields.map(f => f.name);
        const lines = [headers.join(',')];

        for (const row of data.rows) {
            const values = headers.map(h => {
                const val = row[h];
                if (val === null || val === undefined) return '';
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
            `<th>${this._escapeHtml(f.name)}<span class="type">${f.type}</span></th>`
        ).join('');

        const tableRows = result.rows.map(row =>
            `<tr>${result.fields.map(f => {
                const val = row[f.name];
                const displayVal = val === null ? '<span class="null">NULL</span>'
                    : val === undefined ? '<span class="null">undefined</span>'
                    : this._escapeHtml(String(val));
                return `<td>${displayVal}</td>`;
            }).join('')}</tr>`
        ).join('');

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Query Results</title>
    <style>
        * { box-sizing: border-box; }
        body {
            font-family: var(--vscode-font-family, monospace);
            padding: 0;
            margin: 0;
            color: var(--vscode-foreground);
            background: var(--vscode-editor-background);
            font-size: 13px;
        }
        .header {
            padding: 12px 16px;
            background: var(--vscode-sideBar-background);
            border-bottom: 1px solid var(--vscode-panel-border);
            display: flex;
            align-items: center;
            justify-content: space-between;
            position: sticky;
            top: 0;
            z-index: 100;
        }
        .stats {
            display: flex;
            gap: 16px;
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
        }
        .stats span {
            display: flex;
            align-items: center;
            gap: 4px;
        }
        .stats .value {
            color: var(--vscode-foreground);
            font-weight: 500;
        }
        .actions {
            display: flex;
            gap: 8px;
        }
        .actions button {
            padding: 4px 12px;
            border: 1px solid var(--vscode-button-border, transparent);
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
        }
        .actions button:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }
        .query-section {
            padding: 12px 16px;
            background: var(--vscode-textBlockQuote-background);
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        .query-section pre {
            margin: 0;
            white-space: pre-wrap;
            word-break: break-all;
            font-family: var(--vscode-editor-font-family, monospace);
            font-size: 12px;
            color: var(--vscode-textPreformat-foreground);
            max-height: 80px;
            overflow-y: auto;
        }
        .table-container {
            overflow: auto;
            max-height: calc(100vh - 160px);
        }
        table {
            width: 100%;
            border-collapse: collapse;
            font-size: 12px;
        }
        th {
            position: sticky;
            top: 0;
            background: var(--vscode-editorWidget-background);
            padding: 8px 12px;
            text-align: left;
            font-weight: 600;
            border-bottom: 2px solid var(--vscode-panel-border);
            white-space: nowrap;
        }
        th .type {
            display: block;
            font-size: 10px;
            font-weight: normal;
            color: var(--vscode-descriptionForeground);
            margin-top: 2px;
        }
        td {
            padding: 6px 12px;
            border-bottom: 1px solid var(--vscode-panel-border);
            max-width: 300px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        td:hover {
            white-space: normal;
            word-break: break-all;
        }
        tr:hover td {
            background: var(--vscode-list-hoverBackground);
        }
        .null {
            color: var(--vscode-descriptionForeground);
            font-style: italic;
        }
        .no-results {
            padding: 40px;
            text-align: center;
            color: var(--vscode-descriptionForeground);
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="stats">
            <span>Rows: <span class="value">${result.rowCount}</span></span>
            <span>Time: <span class="value">${result.executionTime}ms</span></span>
            <span>Columns: <span class="value">${result.fields.length}</span></span>
        </div>
        <div class="actions">
            <button onclick="copyResults()">Copy</button>
            <button onclick="exportCSV()">Export CSV</button>
            <button onclick="exportJSON()">Export JSON</button>
        </div>
    </div>

    <details class="query-section">
        <summary style="cursor: pointer; user-select: none;">Query</summary>
        <pre>${this._escapeHtml(query)}</pre>
    </details>

    ${result.rows.length > 0 ? `
    <div class="table-container">
        <table>
            <thead>
                <tr>${tableHeaders}</tr>
            </thead>
            <tbody>${tableRows}</tbody>
        </table>
    </div>
    ` : `
    <div class="no-results">
        No results returned
    </div>
    `}

    <script>
        const vscode = acquireVsCodeApi();
        const resultData = ${JSON.stringify(result)};

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
        body {
            font-family: var(--vscode-font-family);
            padding: 20px;
            color: var(--vscode-foreground);
            background: var(--vscode-editor-background);
        }
        .error-container {
            padding: 20px;
            background: var(--vscode-inputValidation-errorBackground);
            border: 1px solid var(--vscode-inputValidation-errorBorder);
            border-radius: 4px;
        }
        .error-title {
            color: var(--vscode-errorForeground);
            font-weight: 600;
            margin-bottom: 12px;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .error-message {
            font-family: monospace;
            white-space: pre-wrap;
            word-break: break-all;
        }
        .query-section {
            margin-top: 20px;
            padding: 12px;
            background: var(--vscode-textBlockQuote-background);
            border-radius: 4px;
        }
        .query-section pre {
            margin: 8px 0 0 0;
            white-space: pre-wrap;
            font-family: monospace;
            font-size: 12px;
        }
    </style>
</head>
<body>
    <div class="error-container">
        <div class="error-title">Query Execution Failed</div>
        <div class="error-message">${this._escapeHtml(error)}</div>
    </div>
    <div class="query-section">
        <strong>Query:</strong>
        <pre>${this._escapeHtml(query)}</pre>
    </div>
</body>
</html>`;
    }

    private _getLoadingHtml(query: string): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Executing Query...</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            padding: 40px;
            color: var(--vscode-foreground);
            background: var(--vscode-editor-background);
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            min-height: 200px;
        }
        .spinner {
            width: 32px;
            height: 32px;
            border: 3px solid var(--vscode-panel-border);
            border-top-color: var(--vscode-progressBar-background);
            border-radius: 50%;
            animation: spin 0.8s linear infinite;
            margin-bottom: 16px;
        }
        @keyframes spin {
            to { transform: rotate(360deg); }
        }
        .message {
            color: var(--vscode-descriptionForeground);
        }
    </style>
</head>
<body>
    <div class="spinner"></div>
    <div class="message">Executing query...</div>
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
