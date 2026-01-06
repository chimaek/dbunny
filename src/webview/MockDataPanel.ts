import * as vscode from 'vscode';
import { ColumnInfo } from '../types/database';
import { I18n } from '../utils/i18n';

export interface MockDataConfig {
    columnName: string;
    columnType: string;
    generator: string;
    options?: Record<string, unknown>;
}

/**
 * Webview panel for generating mock data
 */
export class MockDataPanel {
    public static currentPanel: MockDataPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];
    private _onGenerateData: ((sql: string) => void) | undefined;

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
                    case 'generate': {
                        const sql = this._generateInsertSQL(message.tableName, message.columns, message.rows);
                        if (this._onGenerateData) {
                            this._onGenerateData(sql);
                        }
                        break;
                    }
                    case 'copy': {
                        const copySql = this._generateInsertSQL(message.tableName, message.columns, message.rows);
                        await vscode.env.clipboard.writeText(copySql);
                        vscode.window.showInformationMessage(this.i18n.t('mockData.copied'));
                        break;
                    }
                    case 'export': {
                        const exportSql = this._generateInsertSQL(message.tableName, message.columns, message.rows);
                        await this._exportSQL(exportSql);
                        break;
                    }
                }
            },
            null,
            this._disposables
        );
    }

    public static createOrShow(
        extensionUri: vscode.Uri,
        i18n: I18n
    ): MockDataPanel {
        const column = vscode.ViewColumn.One;

        if (MockDataPanel.currentPanel) {
            MockDataPanel.currentPanel._panel.reveal(column);
            return MockDataPanel.currentPanel;
        }

        const panel = vscode.window.createWebviewPanel(
            'dbunnyMockData',
            'Mock Data Generator',
            column,
            {
                enableScripts: true,
                localResourceRoots: [extensionUri],
                retainContextWhenHidden: true
            }
        );

        MockDataPanel.currentPanel = new MockDataPanel(panel, extensionUri, i18n);
        return MockDataPanel.currentPanel;
    }

    public setOnGenerateData(callback: (sql: string) => void): void {
        this._onGenerateData = callback;
    }

    public showGenerator(tableName: string, columns: ColumnInfo[], dbType: string): void {
        this._panel.webview.html = this._getHtmlContent(tableName, columns, dbType);
    }

    private _generateInsertSQL(tableName: string, columns: { name: string; values: unknown[] }[], rows: number): string {
        if (columns.length === 0 || rows === 0) { return ''; }

        const columnNames = columns.map(c => c.name).join(', ');
        const lines: string[] = [];

        for (let i = 0; i < rows; i++) {
            const values = columns.map(c => {
                const val = c.values[i];
                if (val === null) { return 'NULL'; }
                if (typeof val === 'number') { return String(val); }
                if (typeof val === 'boolean') { return val ? 'TRUE' : 'FALSE'; }
                return `'${String(val).replace(/'/g, "''")}'`;
            }).join(', ');
            lines.push(`INSERT INTO ${tableName} (${columnNames}) VALUES (${values});`);
        }

        return lines.join('\n');
    }

    private async _exportSQL(sql: string): Promise<void> {
        const uri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(`mock_data_${Date.now()}.sql`),
            filters: {
                'SQL Files': ['sql'],
                'All Files': ['*']
            }
        });

        if (!uri) { return; }

        await vscode.workspace.fs.writeFile(uri, Buffer.from(sql, 'utf8'));
        vscode.window.showInformationMessage(this.i18n.t('mockData.exported', { path: uri.fsPath }));
    }

    private _getHtmlContent(tableName: string, columns: ColumnInfo[], dbType: string): string {
        const columnsJson = JSON.stringify(columns);

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Mock Data Generator</title>
    <style>
        :root {
            --bg-color: var(--vscode-editor-background);
            --text-color: var(--vscode-foreground);
            --border-color: var(--vscode-panel-border);
            --input-bg: var(--vscode-input-background);
            --input-border: var(--vscode-input-border);
            --button-bg: var(--vscode-button-background);
            --button-fg: var(--vscode-button-foreground);
        }

        * { box-sizing: border-box; margin: 0; padding: 0; }

        body {
            font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
            background: var(--bg-color);
            color: var(--text-color);
            padding: 0;
            font-size: 13px;
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
            background: var(--button-bg);
            color: var(--button-fg);
        }

        .content {
            padding: 20px;
        }

        .section {
            margin-bottom: 24px;
        }

        .section-title {
            font-size: 14px;
            font-weight: 600;
            margin-bottom: 12px;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .config-row {
            display: flex;
            gap: 16px;
            margin-bottom: 16px;
            align-items: center;
        }

        .config-label {
            min-width: 100px;
            font-weight: 500;
        }

        .config-input {
            flex: 1;
            max-width: 200px;
        }

        input, select {
            width: 100%;
            padding: 6px 10px;
            background: var(--input-bg);
            border: 1px solid var(--input-border, var(--border-color));
            border-radius: 4px;
            color: var(--text-color);
            font-size: 13px;
        }

        input:focus, select:focus {
            outline: none;
            border-color: var(--vscode-focusBorder);
        }

        .columns-table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 12px;
        }

        .columns-table th,
        .columns-table td {
            padding: 10px 12px;
            border: 1px solid var(--border-color);
            text-align: left;
        }

        .columns-table th {
            background: var(--vscode-editorWidget-background);
            font-weight: 600;
        }

        .columns-table tr:hover {
            background: var(--vscode-list-hoverBackground);
        }

        .type-badge {
            font-size: 11px;
            padding: 2px 6px;
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            border-radius: 3px;
        }

        .preview-section {
            margin-top: 24px;
        }

        .preview-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 12px;
        }

        .preview-table {
            width: 100%;
            border-collapse: collapse;
            font-family: var(--vscode-editor-font-family, monospace);
            font-size: 12px;
        }

        .preview-table th,
        .preview-table td {
            padding: 8px 10px;
            border: 1px solid var(--border-color);
            text-align: left;
            max-width: 200px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .preview-table th {
            background: var(--vscode-editorWidget-background);
            font-weight: 600;
        }

        .preview-table tr:nth-child(even) {
            background: rgba(128, 128, 128, 0.05);
        }

        .null-value {
            color: var(--vscode-descriptionForeground);
            font-style: italic;
        }

        .sql-preview {
            margin-top: 24px;
            padding: 16px;
            background: var(--vscode-textBlockQuote-background);
            border-radius: 6px;
            font-family: var(--vscode-editor-font-family, monospace);
            font-size: 12px;
            max-height: 300px;
            overflow: auto;
            white-space: pre-wrap;
            word-break: break-all;
        }

        .generator-options {
            margin-top: 8px;
            padding: 8px;
            background: var(--vscode-input-background);
            border-radius: 4px;
            font-size: 12px;
        }

        .option-row {
            display: flex;
            gap: 8px;
            align-items: center;
            margin-bottom: 4px;
        }

        .option-label {
            min-width: 60px;
            color: var(--vscode-descriptionForeground);
        }

        .option-input {
            flex: 1;
        }

        .option-input input {
            padding: 4px 8px;
            font-size: 12px;
        }

        .checkbox-row {
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .checkbox-row input[type="checkbox"] {
            width: auto;
        }
    </style>
</head>
<body>
    <div class="toolbar">
        <div class="toolbar-title">
            <span>🎲</span>
            <span>Mock Data Generator</span>
        </div>
        <span style="color: var(--vscode-descriptionForeground);">
            Table: <strong>${this._escapeHtml(tableName)}</strong>
        </span>
        <div class="toolbar-spacer"></div>
        <button class="toolbar-btn" onclick="copySQL()">
            <span>📋</span> Copy SQL
        </button>
        <button class="toolbar-btn" onclick="exportSQL()">
            <span>📄</span> Export
        </button>
        <button class="toolbar-btn primary" onclick="regenerate()">
            <span>🔄</span> Regenerate
        </button>
    </div>

    <div class="content">
        <div class="section">
            <div class="section-title">
                <span>⚙️</span> Configuration
            </div>
            <div class="config-row">
                <span class="config-label">Row Count:</span>
                <div class="config-input">
                    <input type="number" id="rowCount" value="10" min="1" max="1000" onchange="regenerate()">
                </div>
            </div>
        </div>

        <div class="section">
            <div class="section-title">
                <span>📋</span> Column Generators
            </div>
            <table class="columns-table">
                <thead>
                    <tr>
                        <th>Column</th>
                        <th>Type</th>
                        <th>Generator</th>
                        <th>Options</th>
                    </tr>
                </thead>
                <tbody id="columnsBody">
                </tbody>
            </table>
        </div>

        <div class="preview-section">
            <div class="preview-header">
                <div class="section-title">
                    <span>👁️</span> Preview
                </div>
            </div>
            <table class="preview-table" id="previewTable">
                <thead id="previewHead"></thead>
                <tbody id="previewBody"></tbody>
            </table>
        </div>

        <div class="section">
            <div class="section-title">
                <span>📝</span> Generated SQL
            </div>
            <div class="sql-preview" id="sqlPreview"></div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        const tableName = '${this._escapeHtml(tableName)}';
        const columns = ${columnsJson};
        const dbType = '${dbType}';

        let generatedData = [];
        let columnConfigs = {};

        // Generator functions
        const generators = {
            'auto': (col, options) => {
                const type = col.type.toLowerCase();
                if (type.includes('int') || type.includes('serial')) {
                    return generators.sequence(col, options);
                } else if (type.includes('varchar') || type.includes('text') || type.includes('char')) {
                    return generators.randomString(col, options);
                } else if (type.includes('bool')) {
                    return generators.boolean(col, options);
                } else if (type.includes('date') || type.includes('time')) {
                    return generators.date(col, options);
                } else if (type.includes('float') || type.includes('double') || type.includes('decimal') || type.includes('numeric')) {
                    return generators.randomFloat(col, options);
                } else if (type.includes('json')) {
                    return generators.json(col, options);
                } else if (type.includes('uuid')) {
                    return generators.uuid(col, options);
                }
                return generators.randomString(col, options);
            },
            'sequence': (col, options) => {
                const start = options.start || 1;
                const step = options.step || 1;
                return start + (options.index * step);
            },
            'randomInt': (col, options) => {
                const min = options.min || 0;
                const max = options.max || 1000;
                return Math.floor(Math.random() * (max - min + 1)) + min;
            },
            'randomFloat': (col, options) => {
                const min = options.min || 0;
                const max = options.max || 1000;
                const decimals = options.decimals || 2;
                const val = Math.random() * (max - min) + min;
                return parseFloat(val.toFixed(decimals));
            },
            'randomString': (col, options) => {
                const length = options.length || 10;
                const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
                let result = '';
                for (let i = 0; i < length; i++) {
                    result += chars.charAt(Math.floor(Math.random() * chars.length));
                }
                return result;
            },
            'firstName': (col, options) => {
                const names = ['James', 'Mary', 'John', 'Patricia', 'Robert', 'Jennifer', 'Michael', 'Linda', 'William', 'Elizabeth', 'David', 'Barbara', 'Richard', 'Susan', 'Joseph', 'Jessica', 'Thomas', 'Sarah', 'Charles', 'Karen'];
                return names[Math.floor(Math.random() * names.length)];
            },
            'lastName': (col, options) => {
                const names = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson', 'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin'];
                return names[Math.floor(Math.random() * names.length)];
            },
            'fullName': (col, options) => {
                return generators.firstName(col, options) + ' ' + generators.lastName(col, options);
            },
            'email': (col, options) => {
                const domains = ['gmail.com', 'yahoo.com', 'outlook.com', 'example.com', 'test.com'];
                const name = generators.firstName(col, options).toLowerCase() + Math.floor(Math.random() * 100);
                return name + '@' + domains[Math.floor(Math.random() * domains.length)];
            },
            'phone': (col, options) => {
                const area = Math.floor(Math.random() * 900) + 100;
                const prefix = Math.floor(Math.random() * 900) + 100;
                const line = Math.floor(Math.random() * 9000) + 1000;
                return area + '-' + prefix + '-' + line;
            },
            'date': (col, options) => {
                const start = options.startDate ? new Date(options.startDate) : new Date(2020, 0, 1);
                const end = options.endDate ? new Date(options.endDate) : new Date();
                const date = new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
                return date.toISOString().split('T')[0];
            },
            'datetime': (col, options) => {
                const start = options.startDate ? new Date(options.startDate) : new Date(2020, 0, 1);
                const end = options.endDate ? new Date(options.endDate) : new Date();
                const date = new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
                return date.toISOString().replace('T', ' ').slice(0, 19);
            },
            'boolean': (col, options) => {
                return Math.random() > 0.5;
            },
            'uuid': (col, options) => {
                return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
                    const r = Math.random() * 16 | 0;
                    const v = c === 'x' ? r : (r & 0x3 | 0x8);
                    return v.toString(16);
                });
            },
            'json': (col, options) => {
                return JSON.stringify({ key: 'value', num: Math.floor(Math.random() * 100) });
            },
            'null': (col, options) => {
                return null;
            },
            'custom': (col, options) => {
                const values = (options.values || '').split(',').map(v => v.trim()).filter(v => v);
                if (values.length === 0) return '';
                return values[Math.floor(Math.random() * values.length)];
            },
            'lorem': (col, options) => {
                const words = ['lorem', 'ipsum', 'dolor', 'sit', 'amet', 'consectetur', 'adipiscing', 'elit', 'sed', 'do', 'eiusmod', 'tempor', 'incididunt', 'ut', 'labore', 'et', 'dolore', 'magna', 'aliqua'];
                const count = options.words || 5;
                let result = [];
                for (let i = 0; i < count; i++) {
                    result.push(words[Math.floor(Math.random() * words.length)]);
                }
                return result.join(' ');
            },
            'address': (col, options) => {
                const num = Math.floor(Math.random() * 9999) + 1;
                const streets = ['Main St', 'Oak Ave', 'Park Rd', 'Cedar Ln', 'Elm St', 'Lake Dr', 'Hill Rd', 'River Rd'];
                return num + ' ' + streets[Math.floor(Math.random() * streets.length)];
            },
            'city': (col, options) => {
                const cities = ['New York', 'Los Angeles', 'Chicago', 'Houston', 'Phoenix', 'Philadelphia', 'San Antonio', 'San Diego', 'Dallas', 'Seoul', 'Busan', 'Tokyo', 'London', 'Paris'];
                return cities[Math.floor(Math.random() * cities.length)];
            },
            'country': (col, options) => {
                const countries = ['USA', 'Canada', 'UK', 'Germany', 'France', 'Japan', 'South Korea', 'China', 'Australia', 'Brazil'];
                return countries[Math.floor(Math.random() * countries.length)];
            }
        };

        function getGeneratorForType(type) {
            type = type.toLowerCase();
            if (type.includes('int') || type.includes('serial')) return 'sequence';
            if (type.includes('varchar') || type.includes('text')) return 'randomString';
            if (type.includes('bool')) return 'boolean';
            if (type.includes('date') && type.includes('time')) return 'datetime';
            if (type.includes('date')) return 'date';
            if (type.includes('time')) return 'datetime';
            if (type.includes('float') || type.includes('double') || type.includes('decimal')) return 'randomFloat';
            if (type.includes('uuid')) return 'uuid';
            if (type.includes('json')) return 'json';
            return 'auto';
        }

        function init() {
            // Initialize column configs
            columns.forEach(col => {
                columnConfigs[col.name] = {
                    generator: col.primaryKey ? 'sequence' : getGeneratorForType(col.type),
                    options: {}
                };
            });

            renderColumnsTable();
            regenerate();
        }

        function renderColumnsTable() {
            const tbody = document.getElementById('columnsBody');
            tbody.innerHTML = columns.map(col => {
                const config = columnConfigs[col.name];
                return \`
                    <tr>
                        <td>
                            <strong>\${escapeHtml(col.name)}</strong>
                            \${col.primaryKey ? '<span style="color: #f0ad4e;"> 🔑 PK</span>' : ''}
                            \${col.nullable ? '<span style="color: var(--vscode-descriptionForeground);"> (nullable)</span>' : ''}
                        </td>
                        <td><span class="type-badge">\${escapeHtml(col.type)}</span></td>
                        <td>
                            <select onchange="updateGenerator('\${col.name}', this.value)" id="gen-\${col.name}">
                                <option value="auto" \${config.generator === 'auto' ? 'selected' : ''}>Auto</option>
                                <optgroup label="Numbers">
                                    <option value="sequence" \${config.generator === 'sequence' ? 'selected' : ''}>Sequence (1, 2, 3...)</option>
                                    <option value="randomInt" \${config.generator === 'randomInt' ? 'selected' : ''}>Random Integer</option>
                                    <option value="randomFloat" \${config.generator === 'randomFloat' ? 'selected' : ''}>Random Float</option>
                                </optgroup>
                                <optgroup label="Text">
                                    <option value="randomString" \${config.generator === 'randomString' ? 'selected' : ''}>Random String</option>
                                    <option value="lorem" \${config.generator === 'lorem' ? 'selected' : ''}>Lorem Ipsum</option>
                                </optgroup>
                                <optgroup label="Personal">
                                    <option value="firstName" \${config.generator === 'firstName' ? 'selected' : ''}>First Name</option>
                                    <option value="lastName" \${config.generator === 'lastName' ? 'selected' : ''}>Last Name</option>
                                    <option value="fullName" \${config.generator === 'fullName' ? 'selected' : ''}>Full Name</option>
                                    <option value="email" \${config.generator === 'email' ? 'selected' : ''}>Email</option>
                                    <option value="phone" \${config.generator === 'phone' ? 'selected' : ''}>Phone</option>
                                </optgroup>
                                <optgroup label="Location">
                                    <option value="address" \${config.generator === 'address' ? 'selected' : ''}>Address</option>
                                    <option value="city" \${config.generator === 'city' ? 'selected' : ''}>City</option>
                                    <option value="country" \${config.generator === 'country' ? 'selected' : ''}>Country</option>
                                </optgroup>
                                <optgroup label="Date/Time">
                                    <option value="date" \${config.generator === 'date' ? 'selected' : ''}>Date</option>
                                    <option value="datetime" \${config.generator === 'datetime' ? 'selected' : ''}>DateTime</option>
                                </optgroup>
                                <optgroup label="Other">
                                    <option value="boolean" \${config.generator === 'boolean' ? 'selected' : ''}>Boolean</option>
                                    <option value="uuid" \${config.generator === 'uuid' ? 'selected' : ''}>UUID</option>
                                    <option value="json" \${config.generator === 'json' ? 'selected' : ''}>JSON</option>
                                    <option value="custom" \${config.generator === 'custom' ? 'selected' : ''}>Custom Values</option>
                                    <option value="null" \${config.generator === 'null' ? 'selected' : ''}>NULL</option>
                                </optgroup>
                            </select>
                        </td>
                        <td id="options-\${col.name}">
                            \${renderOptions(col.name, config.generator)}
                        </td>
                    </tr>
                \`;
            }).join('');
        }

        function renderOptions(colName, generator) {
            const config = columnConfigs[colName];
            switch (generator) {
                case 'sequence':
                    return \`
                        <div class="generator-options">
                            <div class="option-row">
                                <span class="option-label">Start:</span>
                                <div class="option-input">
                                    <input type="number" value="\${config.options.start || 1}"
                                           onchange="updateOption('\${colName}', 'start', parseInt(this.value))">
                                </div>
                            </div>
                        </div>
                    \`;
                case 'randomInt':
                case 'randomFloat':
                    return \`
                        <div class="generator-options">
                            <div class="option-row">
                                <span class="option-label">Min:</span>
                                <div class="option-input">
                                    <input type="number" value="\${config.options.min || 0}"
                                           onchange="updateOption('\${colName}', 'min', parseFloat(this.value))">
                                </div>
                            </div>
                            <div class="option-row">
                                <span class="option-label">Max:</span>
                                <div class="option-input">
                                    <input type="number" value="\${config.options.max || 1000}"
                                           onchange="updateOption('\${colName}', 'max', parseFloat(this.value))">
                                </div>
                            </div>
                        </div>
                    \`;
                case 'randomString':
                    return \`
                        <div class="generator-options">
                            <div class="option-row">
                                <span class="option-label">Length:</span>
                                <div class="option-input">
                                    <input type="number" value="\${config.options.length || 10}"
                                           onchange="updateOption('\${colName}', 'length', parseInt(this.value))">
                                </div>
                            </div>
                        </div>
                    \`;
                case 'lorem':
                    return \`
                        <div class="generator-options">
                            <div class="option-row">
                                <span class="option-label">Words:</span>
                                <div class="option-input">
                                    <input type="number" value="\${config.options.words || 5}"
                                           onchange="updateOption('\${colName}', 'words', parseInt(this.value))">
                                </div>
                            </div>
                        </div>
                    \`;
                case 'custom':
                    return \`
                        <div class="generator-options">
                            <div class="option-row">
                                <span class="option-label">Values:</span>
                                <div class="option-input">
                                    <input type="text" value="\${config.options.values || ''}"
                                           placeholder="val1, val2, val3"
                                           onchange="updateOption('\${colName}', 'values', this.value)">
                                </div>
                            </div>
                        </div>
                    \`;
                default:
                    return '<span style="color: var(--vscode-descriptionForeground);">-</span>';
            }
        }

        function updateGenerator(colName, generator) {
            columnConfigs[colName].generator = generator;
            columnConfigs[colName].options = {};
            document.getElementById('options-' + colName).innerHTML = renderOptions(colName, generator);
            regenerate();
        }

        function updateOption(colName, key, value) {
            columnConfigs[colName].options[key] = value;
            regenerate();
        }

        function regenerate() {
            const rowCount = parseInt(document.getElementById('rowCount').value) || 10;
            generatedData = [];

            for (let i = 0; i < rowCount; i++) {
                const row = {};
                columns.forEach(col => {
                    const config = columnConfigs[col.name];
                    const genFunc = generators[config.generator] || generators.auto;
                    row[col.name] = genFunc(col, { ...config.options, index: i });
                });
                generatedData.push(row);
            }

            renderPreview();
            renderSQL();
        }

        function renderPreview() {
            const thead = document.getElementById('previewHead');
            const tbody = document.getElementById('previewBody');

            thead.innerHTML = '<tr>' + columns.map(c => '<th>' + escapeHtml(c.name) + '</th>').join('') + '</tr>';

            tbody.innerHTML = generatedData.slice(0, 20).map(row => {
                return '<tr>' + columns.map(c => {
                    const val = row[c.name];
                    if (val === null) return '<td class="null-value">NULL</td>';
                    return '<td title="' + escapeHtml(String(val)) + '">' + escapeHtml(String(val)) + '</td>';
                }).join('') + '</tr>';
            }).join('');

            if (generatedData.length > 20) {
                tbody.innerHTML += '<tr><td colspan="' + columns.length + '" style="text-align:center; color: var(--vscode-descriptionForeground);">... and ' + (generatedData.length - 20) + ' more rows</td></tr>';
            }
        }

        function renderSQL() {
            const columnData = columns.map(c => ({
                name: c.name,
                values: generatedData.map(row => row[c.name])
            }));

            const sql = generateSQL(columnData);
            document.getElementById('sqlPreview').textContent = sql;
        }

        function generateSQL(columnData) {
            if (columnData.length === 0 || generatedData.length === 0) return '';

            const columnNames = columnData.map(c => c.name).join(', ');
            const lines = [];

            for (let i = 0; i < generatedData.length; i++) {
                const values = columnData.map(c => {
                    const val = c.values[i];
                    if (val === null) return 'NULL';
                    if (typeof val === 'number') return String(val);
                    if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
                    return "'" + String(val).replace(/'/g, "''") + "'";
                }).join(', ');
                lines.push('INSERT INTO ' + tableName + ' (' + columnNames + ') VALUES (' + values + ');');
            }

            return lines.join('\\n');
        }

        function copySQL() {
            const columnData = columns.map(c => ({
                name: c.name,
                values: generatedData.map(row => row[c.name])
            }));
            vscode.postMessage({
                command: 'copy',
                tableName,
                columns: columnData,
                rows: generatedData.length
            });
        }

        function exportSQL() {
            const columnData = columns.map(c => ({
                name: c.name,
                values: generatedData.map(row => row[c.name])
            }));
            vscode.postMessage({
                command: 'export',
                tableName,
                columns: columnData,
                rows: generatedData.length
            });
        }

        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        init();
    </script>
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
        MockDataPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const disposable = this._disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }
}
