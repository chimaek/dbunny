import { createNonce, secureWebviewHtml, serializeForWebview, webviewEventScript } from '../utils/webviewSecurity';
import * as vscode from 'vscode';
import { QueryResult } from '../types/database';
import { I18n } from '../utils/i18n';
import { compareResults, diffToMarkdown, diffToJson, DiffComparison, DiffResult, DuplicateDiffKey, RowDiff } from '../utils/resultDiff';

/**
 * WebView panel for comparing query results (row-level diff)
 */
export class DiffPanel {
    private readonly _nonce = createNonce();
    public static currentPanel: DiffPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];

    private _leftResult: QueryResult | null = null;
    private _rightResult: QueryResult | null = null;
    private _leftLabel = '';
    private _rightLabel = '';
    private _currentDiff: DiffResult | null = null;

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
                    case 'exportDiff':
                        await this._handleExportDiff(message.format);
                        break;
                    case 'recomputeDiff':
                        this._changeKeyColumn(message.columnIndex);
                        break;
                    case 'copy':
                        await vscode.env.clipboard.writeText(message.text);
                        break;
                }
            },
            null,
            this._disposables
        );
    }

    public static createOrShow(
        extensionUri: vscode.Uri,
        i18n: I18n
    ): DiffPanel {
        const column = vscode.ViewColumn.One;

        if (DiffPanel.currentPanel) {
            DiffPanel.currentPanel._panel.reveal(column);
            return DiffPanel.currentPanel;
        }

        const panel = vscode.window.createWebviewPanel(
            'dbunnyResultDiff',
            'Result Diff',
            column,
            {
                enableScripts: true,
                localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'resources')],
                retainContextWhenHidden: true
            }
        );

        DiffPanel.currentPanel = new DiffPanel(panel, extensionUri, i18n);
        return DiffPanel.currentPanel;
    }

    /** 두 쿼리 결과를 전달받아 diff 계산 후 표시 */
    public showDiff(
        left: QueryResult,
        right: QueryResult,
        leftLabel: string,
        rightLabel: string,
        keyColumns?: string[]
    ): void {
        this._leftResult = left;
        this._rightResult = right;
        this._leftLabel = leftLabel;
        this._rightLabel = rightLabel;

        this._recomputeDiff(keyColumns);
    }

    public showLoading(): void {
        this._panel.webview.html = secureWebviewHtml(this._getLoadingHtml(), this._panel.webview, this._nonce);
    }

    private _changeKeyColumn(columnIndex: unknown): void {
        if (typeof columnIndex !== 'number' || !Number.isInteger(columnIndex) || columnIndex < 0) { return; }
        const column = this._sharedKeyColumns()[columnIndex];
        if (column !== undefined) { this._recomputeDiff([column]); }
    }

    private _sharedKeyColumns(): string[] {
        const rightColumns = new Set(this._rightResult?.fields.map(field => field.name));
        const leftColumns = new Set(this._leftResult?.fields.map(field => field.name));
        return [...leftColumns].filter(column => rightColumns.has(column));
    }

    private _recomputeDiff(keyColumns?: string[]): void {
        if (!this._leftResult || !this._rightResult) { return; }
        const comparison = compareResults(this._leftResult, this._rightResult, keyColumns);
        this._currentDiff = comparison.kind === 'diff' ? comparison.diff : null;
        const html = this._getHtmlContent(comparison, this._leftLabel, this._rightLabel);
        this._panel.webview.html = secureWebviewHtml(html, this._panel.webview, this._nonce);
    }

    private async _handleExportDiff(format: string): Promise<void> {
        const diff = this._currentDiff;
        if (!diff) { return; }

        const ext = format === 'json' ? 'json' : 'md';
        const uri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(`query_diff_${Date.now()}.${ext}`),
            filters: {
                [format === 'json' ? 'JSON' : 'Markdown']: [ext],
                'All Files': ['*']
            }
        });

        if (!uri || this._currentDiff !== diff) { return; }

        const content = format === 'json'
            ? diffToJson(diff)
            : diffToMarkdown(diff, this._leftLabel, this._rightLabel);
        await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
        vscode.window.showInformationMessage(
            this.i18n.t('diff.exported', { path: uri.fsPath })
        );
    }

    private _getHtmlContent(comparison: DiffComparison, leftLabel: string, rightLabel: string): string {
        const diff = comparison.kind === 'diff' ? comparison.diff : null;
        const s = diff?.summary;
        const hasChanges = s && s.added + s.removed + s.modified > 0;
        const keys = comparison.kind === 'diff' ? comparison.diff.keyColumns : comparison.keyColumns;
        const sharedColumns = this._sharedKeyColumns();
        const selectedKey = keys.length === 1 ? keys[0] : undefined;
        const selectedIndex = selectedKey === undefined ? -1 : sharedColumns.indexOf(selectedKey);
        const canChangeKey = sharedColumns.length > (selectedIndex < 0 ? 0 : 1);
        const title = this._escapeHtml(this.i18n.t('diff.title'));

        // 행을 JSON으로 전달 (스크립트에서 필터링)
        const rowsJson = serializeForWebview(diff?.rows ?? []);
        const columnsJson = serializeForWebview(diff?.columns ?? []);

        return `<!DOCTYPE html>
<html lang="${this._escapeHtml(this.i18n.getCurrentLocale())}">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <style>
        :root {
            --bg-color: var(--vscode-editor-background);
            --text-color: var(--vscode-foreground);
            --border-color: var(--vscode-panel-border);
            --added-bg: rgba(40, 167, 69, 0.15);
            --added-color: #28a745;
            --removed-bg: rgba(220, 53, 69, 0.15);
            --removed-color: #dc3545;
            --modified-bg: rgba(255, 193, 7, 0.15);
            --modified-color: #ffc107;
            --unchanged-bg: rgba(128, 128, 128, 0.05);
            --cell-modified-bg: rgba(255, 193, 7, 0.3);
        }

        * { box-sizing: border-box; margin: 0; padding: 0; }

        body {
            font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
            background: var(--bg-color);
            color: var(--text-color);
        }

        .toolbar {
            position: sticky;
            top: 0;
            background: var(--vscode-titleBar-activeBackground);
            border-bottom: 1px solid var(--border-color);
            padding: 10px 20px;
            display: flex;
            align-items: center;
            gap: 12px;
            z-index: 100;
            flex-wrap: wrap;
        }

        .toolbar-title {
            font-size: 14px;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .toolbar-spacer { flex: 1; }

        .toolbar-btn {
            padding: 5px 10px;
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: 1px solid var(--border-color);
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
            display: flex;
            align-items: center;
            gap: 4px;
        }

        .toolbar-btn:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }

        .key-column {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            max-width: 100%;
            font-size: 12px;
            overflow-wrap: anywhere;
        }

        .key-column select {
            min-width: 0;
            max-width: 18em;
            padding: 4px 6px;
            font: inherit;
            background: var(--vscode-dropdown-background);
            color: var(--vscode-dropdown-foreground);
            border: 1px solid var(--vscode-dropdown-border, var(--border-color));
        }

        .duplicate-keys {
            margin: 12px 20px 16px;
            padding: 12px 16px;
            border: 1px solid var(--vscode-inputValidation-warningBorder, var(--border-color));
            background: var(--vscode-inputValidation-warningBackground, var(--bg-color));
            color: var(--vscode-inputValidation-warningForeground, var(--text-color));
        }

        .duplicate-keys h2 { font-size: 14px; }
        .duplicate-keys p { margin-top: 6px; font-size: 13px; }

        .filter-group {
            display: flex;
            gap: 4px;
        }

        .filter-btn {
            padding: 4px 10px;
            border: 1px solid var(--border-color);
            border-radius: 4px;
            cursor: pointer;
            font-size: 11px;
            background: transparent;
            color: var(--text-color);
        }

        .filter-btn.active {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border-color: transparent;
        }

        .filter-btn:hover:not(.active) {
            background: var(--vscode-list-hoverBackground);
        }

        .summary {
            padding: 16px 20px;
            display: flex;
            gap: 12px;
            flex-wrap: wrap;
        }

        .summary-card {
            flex: 1;
            min-width: 120px;
            padding: 12px 16px;
            border-radius: 8px;
            border: 1px solid var(--border-color);
            background: var(--vscode-editorWidget-background);
        }

        .summary-title {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            text-transform: uppercase;
            margin-bottom: 4px;
        }

        .summary-value {
            font-size: 22px;
            font-weight: bold;
        }

        .summary-value.success { color: var(--added-color); }
        .summary-value.danger { color: var(--removed-color); }
        .summary-value.warning { color: var(--modified-color); }

        .sources {
            padding: 0 20px;
            display: flex;
            gap: 16px;
            margin-bottom: 12px;
        }

        .source {
            flex: 1;
            padding: 10px 14px;
            background: var(--vscode-input-background);
            border: 1px solid var(--border-color);
            border-radius: 6px;
        }

        .source-label {
            font-size: 10px;
            color: var(--vscode-descriptionForeground);
            text-transform: uppercase;
            margin-bottom: 2px;
        }

        .source-name {
            font-size: 13px;
            font-weight: 600;
        }

        .diff-container {
            padding: 0 20px 20px;
        }

        .diff-table-wrapper {
            overflow-x: auto;
            border: 1px solid var(--border-color);
            border-radius: 6px;
        }

        .diff-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 12px;
            font-family: var(--vscode-editor-font-family, monospace);
        }

        .diff-table th {
            text-align: left;
            padding: 8px 12px;
            background: var(--vscode-editorWidget-background);
            border-bottom: 2px solid var(--border-color);
            font-weight: 600;
            white-space: nowrap;
            position: sticky;
            top: 0;
        }

        .diff-table th.marker-col {
            width: 30px;
            text-align: center;
        }

        .diff-table td {
            padding: 6px 12px;
            border-bottom: 1px solid var(--border-color);
            white-space: nowrap;
            max-width: 300px;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .diff-table td.marker-col {
            text-align: center;
            font-weight: bold;
            width: 30px;
        }

        .diff-table tr.row-added td { background: var(--added-bg); }
        .diff-table tr.row-removed td { background: var(--removed-bg); }
        .diff-table tr.row-modified td { background: var(--modified-bg); }
        .diff-table tr.row-unchanged td { background: var(--unchanged-bg); }

        .diff-table tr.row-modified td.cell-changed {
            background: var(--cell-modified-bg);
            font-weight: 600;
        }

        .marker-added { color: var(--added-color); }
        .marker-removed { color: var(--removed-color); }
        .marker-modified { color: var(--modified-color); }

        .cell-null {
            color: var(--vscode-descriptionForeground);
            font-style: italic;
        }

        .no-changes {
            padding: 60px 20px;
            text-align: center;
        }

        .no-changes-icon {
            font-size: 48px;
            margin-bottom: 16px;
        }

        .no-changes-text {
            font-size: 16px;
            color: var(--added-color);
            font-weight: 600;
        }

        .row-count {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            padding: 8px 0;
        }
    </style>
</head>
<body>
    <div class="toolbar">
        <div class="toolbar-title">
            <span>&#x1F50D;</span>
            <span>${title}</span>
        </div>
        ${canChangeKey ? `
        <label class="key-column">
            ${this._escapeHtml(this.i18n.t('diff.keyColumn'))}
            <select data-dbunny-change="changeKeyColumn(this.value)">
                ${selectedIndex < 0 ? `<option disabled selected>${this._escapeHtml(keys.join(', '))}</option>` : ''}
                ${sharedColumns.map((column, index) => `<option value="${index}"${index === selectedIndex ? ' selected' : ''}>${this._escapeHtml(column)}</option>`).join('')}
            </select>
        </label>` : ''}
        ${diff && s ? `
        <div class="filter-group">
            <button class="filter-btn active" data-dbunny-click="filterRows('all')">All (${diff.rows.length})</button>
            <button class="filter-btn" data-dbunny-click="filterRows('added')">+ Added (${s.added})</button>
            <button class="filter-btn" data-dbunny-click="filterRows('removed')">- Removed (${s.removed})</button>
            <button class="filter-btn" data-dbunny-click="filterRows('modified')">~ Modified (${s.modified})</button>
            <button class="filter-btn" data-dbunny-click="filterRows('unchanged')">&nbsp; Unchanged (${s.unchanged})</button>
        </div>
        <div class="toolbar-spacer"></div>
        <button class="toolbar-btn" data-dbunny-click="exportDiff('markdown')">Export MD</button>
        <button class="toolbar-btn" data-dbunny-click="exportDiff('json')">Export JSON</button>` : ''}
    </div>

    ${comparison.kind === 'ambiguous' ? this._renderDuplicateKeys(comparison.duplicates, keys, canChangeKey) : ''}
    ${s ? `
    <div class="summary">
        <div class="summary-card">
            <div class="summary-title">Left Rows</div>
            <div class="summary-value">${s.totalLeft}</div>
        </div>
        <div class="summary-card">
            <div class="summary-title">Right Rows</div>
            <div class="summary-value">${s.totalRight}</div>
        </div>
        <div class="summary-card">
            <div class="summary-title">Added</div>
            <div class="summary-value success">${s.added}</div>
        </div>
        <div class="summary-card">
            <div class="summary-title">Removed</div>
            <div class="summary-value danger">${s.removed}</div>
        </div>
        <div class="summary-card">
            <div class="summary-title">Modified</div>
            <div class="summary-value warning">${s.modified}</div>
        </div>
        <div class="summary-card">
            <div class="summary-title">Unchanged</div>
            <div class="summary-value">${s.unchanged}</div>
        </div>
    </div>` : ''}

    <div class="sources">
        <div class="source">
            <div class="source-label">Left (Before)</div>
            <div class="source-name">${this._escapeHtml(leftLabel)}</div>
        </div>
        <div class="source">
            <div class="source-label">Right (After)</div>
            <div class="source-name">${this._escapeHtml(rightLabel)}</div>
        </div>
    </div>

    ${diff ? `<div class="diff-container">
        ${!hasChanges ? `
            <div class="no-changes">
                <div class="no-changes-icon">&#x2705;</div>
                <div class="no-changes-text">No differences found</div>
            </div>
        ` : ''}
        <div class="row-count" id="rowCount">Showing ${diff.rows.length} of ${diff.rows.length} rows</div>
        <div class="diff-table-wrapper">
            <table class="diff-table" id="diffTable">
                <thead>
                    <tr>
                        <th class="marker-col"></th>
                        ${diff.columns.map(col => `<th>${this._escapeHtml(col)}</th>`).join('')}
                    </tr>
                </thead>
                <tbody id="diffBody">
                    ${this._renderRows(diff.rows, diff.columns)}
                </tbody>
            </table>
        </div>
    </div>` : ''}

    <script nonce="${this._nonce}">
        const vscode = acquireVsCodeApi();
        const allRows = ${rowsJson};
        const allColumns = ${columnsJson};
        let currentFilter = 'all';

        function escapeHtml(text) {
            if (text === null || text === undefined) return '<span class="cell-null">NULL</span>';
            const str = String(text);
            return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        }

        function renderCell(cell, status) {
            if (cell.changed && status === 'modified') {
                const lv = cell.leftValue === null || cell.leftValue === undefined ? 'NULL' : String(cell.leftValue);
                const rv = cell.rightValue === null || cell.rightValue === undefined ? 'NULL' : String(cell.rightValue);
                return '<td class="cell-changed" title="' + escapeHtml(lv) + ' → ' + escapeHtml(rv) + '">' +
                    escapeHtml(rv) + ' <span style="opacity:0.6;font-size:10px">← ' + escapeHtml(lv) + '</span></td>';
            }
            if (status === 'removed') {
                return '<td>' + escapeHtml(cell.leftValue) + '</td>';
            }
            return '<td>' + escapeHtml(cell.rightValue) + '</td>';
        }

        function renderRows(rows) {
            return rows.map(row => {
                const markerMap = { added: '+', removed: '-', modified: '~', unchanged: '&nbsp;' };
                const marker = markerMap[row.status] || '&nbsp;';
                const markerClass = 'marker-' + row.status;
                const cells = allColumns.map(col => {
                    const cell = row.cells.find(c => c.column === col);
                    return cell ? renderCell(cell, row.status) : '<td></td>';
                }).join('');
                return '<tr class="row-' + row.status + '">' +
                    '<td class="marker-col"><span class="' + markerClass + '">' + marker + '</span></td>' +
                    cells + '</tr>';
            }).join('');
        }

        function filterRows(filter) {
            currentFilter = filter;
            // Update filter buttons
            document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
            event.target.classList.add('active');

            const filtered = filter === 'all'
                ? allRows
                : allRows.filter(r => r.status === filter);

            document.getElementById('diffBody').innerHTML = renderRows(filtered);
            document.getElementById('rowCount').textContent =
                'Showing ' + filtered.length + ' of ' + allRows.length + ' rows';
        }

        function exportDiff(format) {
            vscode.postMessage({ command: 'exportDiff', format: format });
        }

        function changeKeyColumn(value) {
            vscode.postMessage({ command: 'recomputeDiff', columnIndex: Number(value) });
        }
    ${webviewEventScript(["filterRows", "exportDiff", "changeKeyColumn"])}
</script>
</body>
</html>`;
    }

    private _renderDuplicateKeys(duplicates: DuplicateDiffKey[], keys: string[], canChangeKey: boolean): string {
        const leftCount = duplicates.reduce((count, group) => count + (group.leftRowIndexes.length > 1 ? group.leftRowIndexes.length : 0), 0);
        const rightCount = duplicates.reduce((count, group) => count + (group.rightRowIndexes.length > 1 ? group.rightRowIndexes.length : 0), 0);
        return `<section class="duplicate-keys" role="status">
            <h2>${this._escapeHtml(this.i18n.t('diff.duplicateKeys'))} · ${this._escapeHtml(keys.join(', '))}</h2>
            <p>${this._escapeHtml(this.i18n.t('diff.duplicateCounts', { keys: duplicates.length, left: leftCount, right: rightCount }))}</p>
            <p>${this._escapeHtml(this.i18n.t(canChangeKey ? 'diff.pickUniqueKey' : 'diff.addUniqueKey'))}</p>
        </section>`;
    }

    private _renderRows(rows: RowDiff[], columns: string[]): string {
        return rows.map(row => {
            const markerMap: Record<string, string> = { added: '+', removed: '-', modified: '~', unchanged: '&nbsp;' };
            const marker = markerMap[row.status] || '&nbsp;';
            const markerClass = `marker-${row.status}`;

            const cells = columns.map(col => {
                const cell = row.cells.find(c => c.column === col);
                if (!cell) { return '<td></td>'; }
                return this._renderCell(cell, row.status);
            }).join('');

            return `<tr class="row-${row.status}">
                <td class="marker-col"><span class="${markerClass}">${marker}</span></td>
                ${cells}
            </tr>`;
        }).join('');
    }

    private _renderCell(cell: { column: string; leftValue: unknown; rightValue: unknown; changed: boolean }, status: string): string {
        if (cell.changed && status === 'modified') {
            const lv = cell.leftValue === null || cell.leftValue === undefined ? 'NULL' : String(cell.leftValue);
            const rv = cell.rightValue === null || cell.rightValue === undefined ? 'NULL' : String(cell.rightValue);
            return `<td class="cell-changed" title="${this._escapeHtml(lv)} → ${this._escapeHtml(rv)}">`
                + `${this._escapeHtml(rv)} <span style="opacity:0.6;font-size:10px">← ${this._escapeHtml(lv)}</span></td>`;
        }

        const val = status === 'removed' ? cell.leftValue : cell.rightValue;
        if (val === null || val === undefined) {
            return '<td><span class="cell-null">NULL</span></td>';
        }
        return `<td>${this._escapeHtml(String(val))}</td>`;
    }

    private _getLoadingHtml(): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Loading...</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: var(--vscode-font-family);
            background: var(--vscode-editor-background);
            color: var(--vscode-foreground);
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
        }
        .loading { text-align: center; }
        .spinner {
            width: 48px;
            height: 48px;
            border: 3px solid var(--vscode-panel-border);
            border-top-color: var(--vscode-progressBar-background);
            border-radius: 50%;
            animation: spin 0.8s linear infinite;
            margin: 0 auto 16px;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
    </style>
</head>
<body>
    <div class="loading">
        <div class="spinner"></div>
        <div>Comparing results...</div>
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
        DiffPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const disposable = this._disposables.pop();
            if (disposable) { disposable.dispose(); }
        }
    }
}
