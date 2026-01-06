import * as vscode from 'vscode';
import { ColumnInfo } from '../types/database';
import { I18n } from '../utils/i18n';

export interface TableCompareInfo {
    name: string;
    columns: ColumnInfo[];
}

export interface CompareResult {
    leftOnly: ColumnInfo[];
    rightOnly: ColumnInfo[];
    different: { left: ColumnInfo; right: ColumnInfo; differences: string[] }[];
    same: ColumnInfo[];
}

/**
 * Webview panel for comparing table schemas
 */
export class SchemaComparePanel {
    public static currentPanel: SchemaComparePanel | undefined;
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
                    case 'exportDiff':
                        await this._handleExportDiff(message.content);
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
    ): SchemaComparePanel {
        const column = vscode.ViewColumn.One;

        if (SchemaComparePanel.currentPanel) {
            SchemaComparePanel.currentPanel._panel.reveal(column);
            return SchemaComparePanel.currentPanel;
        }

        const panel = vscode.window.createWebviewPanel(
            'dbunnySchemaCompare',
            'Schema Compare',
            column,
            {
                enableScripts: true,
                localResourceRoots: [extensionUri],
                retainContextWhenHidden: true
            }
        );

        SchemaComparePanel.currentPanel = new SchemaComparePanel(panel, extensionUri, i18n);
        return SchemaComparePanel.currentPanel;
    }

    public showComparison(
        leftTable: TableCompareInfo,
        rightTable: TableCompareInfo,
        leftSource: string,
        rightSource: string
    ): void {
        const result = this._compareSchemas(leftTable.columns, rightTable.columns);
        this._panel.webview.html = this._getHtmlContent(leftTable, rightTable, leftSource, rightSource, result);
    }

    public showLoading(): void {
        this._panel.webview.html = this._getLoadingHtml();
    }

    private _compareSchemas(leftColumns: ColumnInfo[], rightColumns: ColumnInfo[]): CompareResult {
        const leftMap = new Map(leftColumns.map(c => [c.name, c]));
        const rightMap = new Map(rightColumns.map(c => [c.name, c]));

        const leftOnly: ColumnInfo[] = [];
        const rightOnly: ColumnInfo[] = [];
        const different: { left: ColumnInfo; right: ColumnInfo; differences: string[] }[] = [];
        const same: ColumnInfo[] = [];

        // Check left columns
        for (const [name, leftCol] of leftMap) {
            const rightCol = rightMap.get(name);
            if (!rightCol) {
                leftOnly.push(leftCol);
            } else {
                const differences: string[] = [];
                if (leftCol.type.toLowerCase() !== rightCol.type.toLowerCase()) {
                    differences.push(`Type: ${leftCol.type} → ${rightCol.type}`);
                }
                if (leftCol.nullable !== rightCol.nullable) {
                    differences.push(`Nullable: ${leftCol.nullable} → ${rightCol.nullable}`);
                }
                if (leftCol.primaryKey !== rightCol.primaryKey) {
                    differences.push(`PK: ${leftCol.primaryKey} → ${rightCol.primaryKey}`);
                }
                if ((leftCol.defaultValue || '') !== (rightCol.defaultValue || '')) {
                    differences.push(`Default: ${leftCol.defaultValue || 'null'} → ${rightCol.defaultValue || 'null'}`);
                }

                if (differences.length > 0) {
                    different.push({ left: leftCol, right: rightCol, differences });
                } else {
                    same.push(leftCol);
                }
            }
        }

        // Check right-only columns
        for (const [name, rightCol] of rightMap) {
            if (!leftMap.has(name)) {
                rightOnly.push(rightCol);
            }
        }

        return { leftOnly, rightOnly, different, same };
    }

    private async _handleExportDiff(content: string): Promise<void> {
        const uri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(`schema_diff_${Date.now()}.md`),
            filters: {
                'Markdown': ['md'],
                'All Files': ['*']
            }
        });

        if (!uri) { return; }

        await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
        vscode.window.showInformationMessage(this.i18n.t('compare.exported', { path: uri.fsPath }));
    }

    private _getHtmlContent(
        leftTable: TableCompareInfo,
        rightTable: TableCompareInfo,
        leftSource: string,
        rightSource: string,
        result: CompareResult
    ): string {
        const totalChanges = result.leftOnly.length + result.rightOnly.length + result.different.length;
        const isIdentical = totalChanges === 0;

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Schema Compare</title>
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
            --same-bg: rgba(128, 128, 128, 0.05);
        }

        * { box-sizing: border-box; margin: 0; padding: 0; }

        body {
            font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
            background: var(--bg-color);
            color: var(--text-color);
            padding: 0;
        }

        .toolbar {
            position: sticky;
            top: 0;
            background: var(--vscode-titleBar-activeBackground);
            border-bottom: 1px solid var(--border-color);
            padding: 12px 20px;
            display: flex;
            align-items: center;
            gap: 16px;
            z-index: 100;
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
            padding: 6px 12px;
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: 1px solid var(--border-color);
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
            display: flex;
            align-items: center;
            gap: 6px;
        }

        .toolbar-btn:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }

        .toolbar-btn.primary {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }

        .summary {
            padding: 20px;
            display: flex;
            gap: 16px;
            flex-wrap: wrap;
        }

        .summary-card {
            flex: 1;
            min-width: 200px;
            padding: 16px;
            border-radius: 8px;
            border: 1px solid var(--border-color);
            background: var(--vscode-editorWidget-background);
        }

        .summary-card.identical {
            border-color: var(--added-color);
            background: var(--added-bg);
        }

        .summary-card.different {
            border-color: var(--modified-color);
            background: var(--modified-bg);
        }

        .summary-title {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            margin-bottom: 8px;
            text-transform: uppercase;
        }

        .summary-value {
            font-size: 24px;
            font-weight: bold;
        }

        .summary-value.success { color: var(--added-color); }
        .summary-value.warning { color: var(--modified-color); }
        .summary-value.danger { color: var(--removed-color); }

        .sources {
            padding: 0 20px;
            display: flex;
            gap: 20px;
            margin-bottom: 20px;
        }

        .source {
            flex: 1;
            padding: 12px 16px;
            background: var(--vscode-input-background);
            border: 1px solid var(--border-color);
            border-radius: 6px;
        }

        .source-label {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            text-transform: uppercase;
            margin-bottom: 4px;
        }

        .source-name {
            font-size: 14px;
            font-weight: 600;
        }

        .diff-section {
            padding: 0 20px 20px;
        }

        .diff-header {
            font-size: 14px;
            font-weight: 600;
            padding: 12px 0;
            display: flex;
            align-items: center;
            gap: 8px;
            border-bottom: 1px solid var(--border-color);
            margin-bottom: 12px;
        }

        .diff-badge {
            font-size: 11px;
            padding: 2px 8px;
            border-radius: 10px;
            font-weight: normal;
        }

        .diff-badge.added { background: var(--added-bg); color: var(--added-color); }
        .diff-badge.removed { background: var(--removed-bg); color: var(--removed-color); }
        .diff-badge.modified { background: var(--modified-bg); color: var(--modified-color); }
        .diff-badge.same { background: var(--same-bg); color: var(--vscode-descriptionForeground); }

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
        }

        .diff-table td {
            padding: 8px 12px;
            border-bottom: 1px solid var(--border-color);
        }

        .diff-table tr.added td { background: var(--added-bg); }
        .diff-table tr.removed td { background: var(--removed-bg); }
        .diff-table tr.modified td { background: var(--modified-bg); }

        .diff-indicator {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            display: inline-block;
            margin-right: 8px;
        }

        .diff-indicator.added { background: var(--added-color); }
        .diff-indicator.removed { background: var(--removed-color); }
        .diff-indicator.modified { background: var(--modified-color); }

        .changes-list {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            margin-top: 4px;
        }

        .change-item {
            padding: 2px 0;
        }

        .identical-message {
            padding: 40px;
            text-align: center;
            color: var(--added-color);
        }

        .identical-icon {
            font-size: 48px;
            margin-bottom: 16px;
        }

        .identical-text {
            font-size: 18px;
            font-weight: 600;
        }

        .empty-section {
            padding: 20px;
            text-align: center;
            color: var(--vscode-descriptionForeground);
            font-style: italic;
        }
    </style>
</head>
<body>
    <div class="toolbar">
        <div class="toolbar-title">
            <span>🔍</span>
            <span>Schema Compare</span>
        </div>
        <div class="toolbar-spacer"></div>
        <button class="toolbar-btn primary" onclick="exportDiff()">
            <span>📄</span> Export Report
        </button>
    </div>

    <div class="summary">
        <div class="summary-card ${isIdentical ? 'identical' : 'different'}">
            <div class="summary-title">Status</div>
            <div class="summary-value ${isIdentical ? 'success' : 'warning'}">
                ${isIdentical ? '✓ Identical' : '⚠ Different'}
            </div>
        </div>
        <div class="summary-card">
            <div class="summary-title">Left Only</div>
            <div class="summary-value ${result.leftOnly.length > 0 ? 'danger' : ''}">${result.leftOnly.length}</div>
        </div>
        <div class="summary-card">
            <div class="summary-title">Right Only</div>
            <div class="summary-value ${result.rightOnly.length > 0 ? 'success' : ''}">${result.rightOnly.length}</div>
        </div>
        <div class="summary-card">
            <div class="summary-title">Modified</div>
            <div class="summary-value ${result.different.length > 0 ? 'warning' : ''}">${result.different.length}</div>
        </div>
        <div class="summary-card">
            <div class="summary-title">Same</div>
            <div class="summary-value">${result.same.length}</div>
        </div>
    </div>

    <div class="sources">
        <div class="source">
            <div class="source-label">Left (Source)</div>
            <div class="source-name">📋 ${this._escapeHtml(leftSource)} / ${this._escapeHtml(leftTable.name)}</div>
        </div>
        <div class="source">
            <div class="source-label">Right (Target)</div>
            <div class="source-name">📋 ${this._escapeHtml(rightSource)} / ${this._escapeHtml(rightTable.name)}</div>
        </div>
    </div>

    ${isIdentical ? `
        <div class="identical-message">
            <div class="identical-icon">✅</div>
            <div class="identical-text">Schemas are identical</div>
        </div>
    ` : ''}

    ${result.leftOnly.length > 0 ? `
        <div class="diff-section">
            <div class="diff-header">
                <span class="diff-indicator removed"></span>
                Only in Left
                <span class="diff-badge removed">${result.leftOnly.length} columns</span>
            </div>
            <table class="diff-table">
                <thead>
                    <tr>
                        <th>Column</th>
                        <th>Type</th>
                        <th>Nullable</th>
                        <th>Primary Key</th>
                        <th>Default</th>
                    </tr>
                </thead>
                <tbody>
                    ${result.leftOnly.map(col => `
                        <tr class="removed">
                            <td><span class="diff-indicator removed"></span>${this._escapeHtml(col.name)}</td>
                            <td>${this._escapeHtml(col.type)}</td>
                            <td>${col.nullable ? 'YES' : 'NO'}</td>
                            <td>${col.primaryKey ? '🔑 PK' : '-'}</td>
                            <td>${col.defaultValue || '-'}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    ` : ''}

    ${result.rightOnly.length > 0 ? `
        <div class="diff-section">
            <div class="diff-header">
                <span class="diff-indicator added"></span>
                Only in Right
                <span class="diff-badge added">${result.rightOnly.length} columns</span>
            </div>
            <table class="diff-table">
                <thead>
                    <tr>
                        <th>Column</th>
                        <th>Type</th>
                        <th>Nullable</th>
                        <th>Primary Key</th>
                        <th>Default</th>
                    </tr>
                </thead>
                <tbody>
                    ${result.rightOnly.map(col => `
                        <tr class="added">
                            <td><span class="diff-indicator added"></span>${this._escapeHtml(col.name)}</td>
                            <td>${this._escapeHtml(col.type)}</td>
                            <td>${col.nullable ? 'YES' : 'NO'}</td>
                            <td>${col.primaryKey ? '🔑 PK' : '-'}</td>
                            <td>${col.defaultValue || '-'}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    ` : ''}

    ${result.different.length > 0 ? `
        <div class="diff-section">
            <div class="diff-header">
                <span class="diff-indicator modified"></span>
                Modified
                <span class="diff-badge modified">${result.different.length} columns</span>
            </div>
            <table class="diff-table">
                <thead>
                    <tr>
                        <th>Column</th>
                        <th>Left Type</th>
                        <th>Right Type</th>
                        <th>Changes</th>
                    </tr>
                </thead>
                <tbody>
                    ${result.different.map(d => `
                        <tr class="modified">
                            <td><span class="diff-indicator modified"></span>${this._escapeHtml(d.left.name)}</td>
                            <td>${this._escapeHtml(d.left.type)}</td>
                            <td>${this._escapeHtml(d.right.type)}</td>
                            <td>
                                <div class="changes-list">
                                    ${d.differences.map(diff => `<div class="change-item">• ${this._escapeHtml(diff)}</div>`).join('')}
                                </div>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    ` : ''}

    ${result.same.length > 0 ? `
        <div class="diff-section">
            <div class="diff-header">
                Same
                <span class="diff-badge same">${result.same.length} columns</span>
            </div>
            <table class="diff-table">
                <thead>
                    <tr>
                        <th>Column</th>
                        <th>Type</th>
                        <th>Nullable</th>
                        <th>Primary Key</th>
                        <th>Default</th>
                    </tr>
                </thead>
                <tbody>
                    ${result.same.map(col => `
                        <tr>
                            <td>${this._escapeHtml(col.name)}</td>
                            <td>${this._escapeHtml(col.type)}</td>
                            <td>${col.nullable ? 'YES' : 'NO'}</td>
                            <td>${col.primaryKey ? '🔑 PK' : '-'}</td>
                            <td>${col.defaultValue || '-'}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    ` : ''}

    <script>
        const vscode = acquireVsCodeApi();
        const leftTable = '${this._escapeHtml(leftTable.name)}';
        const rightTable = '${this._escapeHtml(rightTable.name)}';
        const leftSource = '${this._escapeHtml(leftSource)}';
        const rightSource = '${this._escapeHtml(rightSource)}';

        function exportDiff() {
            const content = \`# Schema Comparison Report

## Sources
- **Left**: \${leftSource} / \${leftTable}
- **Right**: \${rightSource} / \${rightTable}

## Summary
- Left Only: ${result.leftOnly.length} columns
- Right Only: ${result.rightOnly.length} columns
- Modified: ${result.different.length} columns
- Same: ${result.same.length} columns

${result.leftOnly.length > 0 ? `## Only in Left
| Column | Type | Nullable | PK | Default |
|--------|------|----------|-----|---------|
${result.leftOnly.map(c => `| ${c.name} | ${c.type} | ${c.nullable ? 'YES' : 'NO'} | ${c.primaryKey ? 'PK' : '-'} | ${c.defaultValue || '-'} |`).join('\n')}
` : ''}

${result.rightOnly.length > 0 ? `## Only in Right
| Column | Type | Nullable | PK | Default |
|--------|------|----------|-----|---------|
${result.rightOnly.map(c => `| ${c.name} | ${c.type} | ${c.nullable ? 'YES' : 'NO'} | ${c.primaryKey ? 'PK' : '-'} | ${c.defaultValue || '-'} |`).join('\n')}
` : ''}

${result.different.length > 0 ? `## Modified
| Column | Changes |
|--------|---------|
${result.different.map(d => `| ${d.left.name} | ${d.differences.join(', ')} |`).join('\n')}
` : ''}
\`;
            vscode.postMessage({ command: 'exportDiff', content });
        }
    </script>
</body>
</html>`;
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
        <div>Comparing schemas...</div>
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
        SchemaComparePanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const disposable = this._disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }
}
