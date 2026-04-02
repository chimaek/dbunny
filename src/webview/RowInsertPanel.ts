import * as vscode from 'vscode';
import { ConnectionManager } from '../managers/connectionManager';
import { I18n } from '../utils/i18n';
import { ColumnInfo, ForeignKeyInfo } from '../types/database';

/**
 * 행 삽입 폼 WebView 패널
 * - 필드명과 타입이 표시되는 폼 기반 행 삽입
 * - 컬럼 제약 조건 자동 감지 (NOT NULL, DEFAULT, FK)
 * - FK 참조 값 드롭다운 선택
 * - CSV 붙여넣기 일괄 삽입
 */
export class RowInsertPanel {
    public static currentPanel: RowInsertPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];
    private _tableName: string;
    private _databaseName: string;
    private _dbType: string = 'mysql';
    private _tableColumns: ColumnInfo[] = [];
    private _foreignKeys: ForeignKeyInfo[] = [];
    private _fkValues: Record<string, { value: unknown; label: string }[]> = {};

    private constructor(
        panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri,
        private connectionManager: ConnectionManager,
        private i18n: I18n,
        tableName: string,
        databaseName: string,
        tableColumns: ColumnInfo[],
        foreignKeys: ForeignKeyInfo[],
        fkValues: Record<string, { value: unknown; label: string }[]>,
        dbType: string
    ) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._tableName = tableName;
        this._databaseName = databaseName;
        this._tableColumns = tableColumns;
        this._foreignKeys = foreignKeys;
        this._fkValues = fkValues;
        this._dbType = dbType;

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'insertRow':
                        await this._handleInsertRow(message.data);
                        break;
                    case 'insertBatch':
                        await this._handleInsertBatch(message.rows);
                        break;
                }
            },
            null,
            this._disposables
        );

        this._panel.webview.html = this._getHtmlContent();
    }

    public static async createOrShow(
        extensionUri: vscode.Uri,
        connectionManager: ConnectionManager,
        i18n: I18n,
        tableName: string,
        databaseName: string,
        tableColumns: ColumnInfo[],
        foreignKeys: ForeignKeyInfo[],
        fkValues: Record<string, { value: unknown; label: string }[]>,
        dbType: string
    ): Promise<void> {
        const column = vscode.ViewColumn.One;

        if (RowInsertPanel.currentPanel) {
            RowInsertPanel.currentPanel._panel.reveal(column);
            RowInsertPanel.currentPanel._tableName = tableName;
            RowInsertPanel.currentPanel._databaseName = databaseName;
            RowInsertPanel.currentPanel._tableColumns = tableColumns;
            RowInsertPanel.currentPanel._foreignKeys = foreignKeys;
            RowInsertPanel.currentPanel._fkValues = fkValues;
            RowInsertPanel.currentPanel._dbType = dbType;
            RowInsertPanel.currentPanel._panel.webview.html =
                RowInsertPanel.currentPanel._getHtmlContent();
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'dbunnyRowInsert',
            `Insert: ${tableName}`,
            column,
            {
                enableScripts: true,
                localResourceRoots: [extensionUri],
                retainContextWhenHidden: true,
            }
        );

        RowInsertPanel.currentPanel = new RowInsertPanel(
            panel, extensionUri, connectionManager, i18n,
            tableName, databaseName, tableColumns, foreignKeys, fkValues, dbType
        );
    }

    public dispose(): void {
        RowInsertPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const d = this._disposables.pop();
            if (d) { d.dispose(); }
        }
    }

    // ── INSERT 처리 ────────────────────────────────

    private async _handleInsertRow(data: Record<string, unknown>): Promise<void> {
        try {
            const conn = this.connectionManager.getActiveConnection();
            if (!conn) { throw new Error('No active connection'); }

            const columns = Object.keys(data).filter(k => data[k] !== undefined && data[k] !== '');
            if (columns.length === 0) {
                vscode.window.showWarningMessage(this.i18n.t('rowInsert.noValues'));
                return;
            }

            const values = columns.map(k => this._escapeValue(data[k]));
            const query = `INSERT INTO ${this._escapeIdentifier(this._tableName)} (${columns.map(c => this._escapeIdentifier(c)).join(', ')}) VALUES (${values.join(', ')})`;

            await conn.executeQuery(query, this._databaseName);

            this._panel.webview.postMessage({ command: 'insertSuccess' });
            vscode.window.showInformationMessage(this.i18n.t('rowInsert.success'));
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            this._panel.webview.postMessage({ command: 'insertError', error: msg });
            vscode.window.showErrorMessage(this.i18n.t('rowInsert.failed', { error: msg }));
        }
    }

    private async _handleInsertBatch(rows: Record<string, unknown>[]): Promise<void> {
        try {
            const conn = this.connectionManager.getActiveConnection();
            if (!conn) { throw new Error('No active connection'); }

            let inserted = 0;
            let failed = 0;
            const errors: string[] = [];

            for (let i = 0; i < rows.length; i++) {
                const data = rows[i];
                const columns = Object.keys(data).filter(k => data[k] !== undefined && data[k] !== '');
                if (columns.length === 0) { continue; }

                try {
                    const values = columns.map(k => this._escapeValue(data[k]));
                    const query = `INSERT INTO ${this._escapeIdentifier(this._tableName)} (${columns.map(c => this._escapeIdentifier(c)).join(', ')}) VALUES (${values.join(', ')})`;
                    await conn.executeQuery(query, this._databaseName);
                    inserted++;
                } catch (e) {
                    failed++;
                    const errMsg = e instanceof Error ? e.message : String(e);
                    errors.push(`Row ${i + 1}: ${errMsg}`);
                }
            }

            this._panel.webview.postMessage({
                command: 'batchComplete',
                data: { inserted, failed, errors },
            });

            vscode.window.showInformationMessage(
                this.i18n.t('rowInsert.batchComplete', {
                    inserted: String(inserted),
                    failed: String(failed),
                })
            );
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(this.i18n.t('rowInsert.failed', { error: msg }));
        }
    }

    // ── SQL 유틸리티 ───────────────────────────────

    private _escapeIdentifier(name: string): string {
        switch (this._dbType) {
            case 'mysql':
                return `\`${name.replace(/`/g, '``')}\``;
            case 'postgres':
                if (name.includes('.')) {
                    return name.split('.').map(p => `"${p.replace(/"/g, '""')}"`).join('.');
                }
                return `"${name.replace(/"/g, '""')}"`;
            default:
                return `"${name.replace(/"/g, '""')}"`;
        }
    }

    private _escapeValue(value: unknown): string {
        if (value === null || value === undefined) { return 'NULL'; }
        if (typeof value === 'number') { return String(value); }
        if (typeof value === 'boolean') { return value ? '1' : '0'; }
        const str = String(value);
        if (str.toUpperCase() === 'NULL') { return 'NULL'; }
        if (this._dbType === 'mysql') {
            return `'${str.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
        }
        return `'${str.replace(/'/g, "''")}'`;
    }

    // ── HTML 생성 ──────────────────────────────────

    private _getHtmlContent(): string {
        const t = (key: string) => this.i18n.t(key) || key;
        const columnsJson = JSON.stringify(this._tableColumns);
        const fkJson = JSON.stringify(this._foreignKeys);
        const fkValuesJson = JSON.stringify(this._fkValues);

        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${t('rowInsert.title')}</title>
<style>
  :root {
    --bg: var(--vscode-editor-background);
    --fg: var(--vscode-editor-foreground);
    --input-bg: var(--vscode-input-background);
    --input-fg: var(--vscode-input-foreground);
    --input-border: var(--vscode-input-border);
    --btn-bg: var(--vscode-button-background);
    --btn-fg: var(--vscode-button-foreground);
    --btn-hover: var(--vscode-button-hoverBackground);
    --badge-bg: var(--vscode-badge-background);
    --badge-fg: var(--vscode-badge-foreground);
    --error: var(--vscode-errorForeground);
    --border: var(--vscode-panel-border, #444);
    --success: #4ec9b0;
    --warning: #cca700;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: var(--vscode-font-family); color: var(--fg); background: var(--bg); padding: 16px; }
  h2 { margin-bottom: 16px; font-weight: 500; font-size: 16px; }
  .tabs { display: flex; gap: 0; margin-bottom: 16px; border-bottom: 1px solid var(--border); }
  .tab { padding: 8px 16px; cursor: pointer; border: none; background: none; color: var(--fg); opacity: 0.6; border-bottom: 2px solid transparent; }
  .tab.active { opacity: 1; border-bottom-color: var(--btn-bg); }
  .tab:hover { opacity: 0.9; }
  .tab-content { display: none; }
  .tab-content.active { display: block; }

  /* 폼 */
  .form-grid { display: grid; gap: 10px; }
  .field { display: grid; grid-template-columns: 200px 1fr; gap: 8px; align-items: start; padding: 6px 0; border-bottom: 1px solid var(--border); }
  .field:last-child { border-bottom: none; }
  .field-label { display: flex; flex-direction: column; gap: 3px; padding-top: 4px; }
  .field-name { font-weight: 600; font-size: 13px; }
  .field-meta { display: flex; flex-wrap: wrap; gap: 4px; }
  .badge { font-size: 10px; padding: 1px 5px; border-radius: 3px; background: var(--badge-bg); color: var(--badge-fg); }
  .badge.pk { background: #e6b422; color: #000; }
  .badge.notnull { background: #c24038; color: #fff; }
  .badge.fk { background: #569cd6; color: #fff; }
  .badge.default { background: #3c8; color: #000; }
  .field-input { width: 100%; }
  .field-input input, .field-input select, .field-input textarea {
    width: 100%; padding: 5px 8px; background: var(--input-bg); color: var(--input-fg);
    border: 1px solid var(--input-border); border-radius: 3px; font-size: 13px; font-family: inherit;
  }
  .field-input textarea { min-height: 60px; resize: vertical; }
  .field-hint { font-size: 11px; color: var(--fg); opacity: 0.6; margin-top: 2px; }

  /* 버튼 */
  .actions { margin-top: 16px; display: flex; gap: 8px; }
  button { padding: 6px 14px; border: none; border-radius: 3px; cursor: pointer; font-size: 13px; }
  .btn-primary { background: var(--btn-bg); color: var(--btn-fg); }
  .btn-primary:hover { background: var(--btn-hover); }
  .btn-secondary { background: transparent; color: var(--fg); border: 1px solid var(--border); }
  .btn-secondary:hover { background: var(--input-bg); }

  /* CSV 붙여넣기 */
  .csv-area { width: 100%; min-height: 120px; padding: 8px; background: var(--input-bg); color: var(--input-fg); border: 1px solid var(--input-border); border-radius: 3px; font-family: monospace; font-size: 12px; resize: vertical; }
  .csv-hint { font-size: 12px; opacity: 0.7; margin: 8px 0; }
  .csv-preview { margin-top: 12px; }
  .csv-preview table { width: 100%; border-collapse: collapse; font-size: 12px; }
  .csv-preview th, .csv-preview td { padding: 4px 8px; border: 1px solid var(--border); text-align: left; }
  .csv-preview th { background: var(--badge-bg); color: var(--badge-fg); }

  /* 결과 */
  .result { margin-top: 12px; padding: 10px; border-radius: 4px; font-size: 13px; }
  .result.success { background: rgba(78,201,176,0.15); color: var(--success); }
  .result.error { background: rgba(194,64,56,0.15); color: var(--error); }
  .error-list { margin-top: 8px; font-size: 12px; max-height: 200px; overflow-y: auto; }
  .error-list li { margin: 2px 0; }
</style>
</head>
<body>
<h2>${t('rowInsert.title')}: ${this._escapeHtml(this._tableName)}</h2>

<div class="tabs">
  <div class="tab active" data-tab="form">${t('rowInsert.singleInsert')}</div>
  <div class="tab" data-tab="csv">${t('rowInsert.csvPaste')}</div>
</div>

<!-- 단일 행 삽입 폼 -->
<div id="tab-form" class="tab-content active">
  <div class="form-grid" id="insertForm"></div>
  <div class="actions">
    <button class="btn-primary" id="btnInsert">${t('rowInsert.insert')}</button>
    <button class="btn-secondary" id="btnClear">${t('rowInsert.clear')}</button>
  </div>
  <div id="formResult"></div>
</div>

<!-- CSV 붙여넣기 -->
<div id="tab-csv" class="tab-content">
  <p class="csv-hint">${t('rowInsert.csvHint')}</p>
  <textarea class="csv-area" id="csvInput" placeholder="name,age,email\nAlice,30,alice@test.com\nBob,25,bob@test.com"></textarea>
  <div class="actions">
    <button class="btn-secondary" id="btnPreviewCsv">${t('rowInsert.preview')}</button>
    <button class="btn-primary" id="btnInsertCsv">${t('rowInsert.insertAll')}</button>
  </div>
  <div class="csv-preview" id="csvPreview"></div>
  <div id="csvResult"></div>
</div>

<script>
(function() {
    const vscode = acquireVsCodeApi();
    const columns = ${columnsJson};
    const foreignKeys = ${fkJson};
    const fkValues = ${fkValuesJson};

    // ── 탭 전환 ───────────────────────────────
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
        });
    });

    // ── FK 맵 구성 ────────────────────────────
    const fkMap = {};
    foreignKeys.forEach(fk => { fkMap[fk.columnName] = fk; });

    // ── 폼 생성 ───────────────────────────────
    const form = document.getElementById('insertForm');

    columns.forEach(col => {
        const fk = fkMap[col.name];
        const hasFk = fk && fkValues[col.name] && fkValues[col.name].length > 0;

        const div = document.createElement('div');
        div.className = 'field';

        // 라벨
        let badges = '';
        if (col.primaryKey) badges += '<span class="badge pk">PK</span>';
        if (!col.nullable) badges += '<span class="badge notnull">NOT NULL</span>';
        if (hasFk) badges += '<span class="badge fk">FK → ' + escapeHtml(fk.referencedTable) + '</span>';
        if (col.defaultValue !== undefined && col.defaultValue !== null) {
            badges += '<span class="badge default">DEFAULT: ' + escapeHtml(String(col.defaultValue)) + '</span>';
        }

        div.innerHTML = '<div class="field-label">' +
            '<span class="field-name">' + escapeHtml(col.name) + '</span>' +
            '<div class="field-meta">' + badges + '</div>' +
            '<span class="field-hint">' + escapeHtml(col.type) + '</span>' +
            '</div>';

        // 입력 필드
        const inputDiv = document.createElement('div');
        inputDiv.className = 'field-input';

        if (hasFk) {
            // FK 드롭다운
            const select = document.createElement('select');
            select.dataset.col = col.name;
            select.innerHTML = '<option value="">-- select --</option>';
            fkValues[col.name].forEach(item => {
                const opt = document.createElement('option');
                opt.value = String(item.value);
                opt.textContent = item.label;
                select.appendChild(opt);
            });
            inputDiv.appendChild(select);
        } else if (isTextType(col.type)) {
            const textarea = document.createElement('textarea');
            textarea.dataset.col = col.name;
            textarea.placeholder = col.nullable ? 'NULL' : '';
            inputDiv.appendChild(textarea);
        } else {
            const input = document.createElement('input');
            input.type = isNumericType(col.type) ? 'number' : 'text';
            input.dataset.col = col.name;
            input.placeholder = col.nullable ? 'NULL' : '';
            if (col.defaultValue !== undefined && col.defaultValue !== null) {
                input.placeholder = 'default: ' + col.defaultValue;
            }
            inputDiv.appendChild(input);
        }

        div.appendChild(inputDiv);
        form.appendChild(div);
    });

    // ── 단일 삽입 ─────────────────────────────
    document.getElementById('btnInsert').addEventListener('click', () => {
        const data = {};
        columns.forEach(col => {
            const el = document.querySelector('[data-col="' + col.name + '"]');
            if (el && el.value !== '') {
                data[col.name] = el.value;
            }
        });
        vscode.postMessage({ command: 'insertRow', data });
    });

    document.getElementById('btnClear').addEventListener('click', () => {
        document.querySelectorAll('[data-col]').forEach(el => { el.value = ''; });
        document.getElementById('formResult').innerHTML = '';
    });

    // ── CSV 붙여넣기 ──────────────────────────
    document.getElementById('btnPreviewCsv').addEventListener('click', () => {
        const parsed = parseCsv(document.getElementById('csvInput').value);
        if (!parsed) return;
        renderCsvPreview(parsed);
    });

    document.getElementById('btnInsertCsv').addEventListener('click', () => {
        const parsed = parseCsv(document.getElementById('csvInput').value);
        if (!parsed) return;

        const rows = parsed.rows.map(row => {
            const obj = {};
            parsed.headers.forEach((h, i) => {
                const col = columns.find(c => c.name.toLowerCase() === h.toLowerCase());
                if (col && row[i] !== undefined && row[i] !== '') {
                    obj[col.name] = row[i];
                }
            });
            return obj;
        });

        vscode.postMessage({ command: 'insertBatch', rows });
    });

    function parseCsv(text) {
        const lines = text.trim().split('\\n').filter(l => l.trim());
        if (lines.length < 2) {
            document.getElementById('csvResult').innerHTML =
                '<div class="result error">${t('rowInsert.csvMinRows')}</div>';
            return null;
        }
        const headers = lines[0].split(',').map(h => h.trim());
        const rows = lines.slice(1).map(line => {
            const vals = [];
            let current = '';
            let inQuote = false;
            for (const ch of line) {
                if (ch === '"') { inQuote = !inQuote; }
                else if (ch === ',' && !inQuote) { vals.push(current.trim()); current = ''; }
                else { current += ch; }
            }
            vals.push(current.trim());
            return vals;
        });
        return { headers, rows };
    }

    function renderCsvPreview(parsed) {
        const container = document.getElementById('csvPreview');
        let html = '<table><tr>';
        parsed.headers.forEach(h => { html += '<th>' + escapeHtml(h) + '</th>'; });
        html += '</tr>';
        parsed.rows.slice(0, 20).forEach(row => {
            html += '<tr>';
            row.forEach(v => { html += '<td>' + escapeHtml(v) + '</td>'; });
            html += '</tr>';
        });
        html += '</table>';
        if (parsed.rows.length > 20) {
            html += '<p style="opacity:0.6;font-size:12px;margin-top:4px">... +' + (parsed.rows.length - 20) + ' more rows</p>';
        }
        container.innerHTML = html;
    }

    // ── 메시지 수신 ───────────────────────────
    window.addEventListener('message', event => {
        const msg = event.data;
        switch (msg.command) {
            case 'insertSuccess':
                document.getElementById('formResult').innerHTML =
                    '<div class="result success">${t('rowInsert.success')}</div>';
                break;
            case 'insertError':
                document.getElementById('formResult').innerHTML =
                    '<div class="result error">' + escapeHtml(msg.error) + '</div>';
                break;
            case 'batchComplete': {
                const d = msg.data;
                let html = '<div class="result ' + (d.failed === 0 ? 'success' : 'error') + '">';
                html += '${t('rowInsert.batchResult')}: ' + d.inserted + ' / ' + (d.inserted + d.failed);
                if (d.failed > 0) {
                    html += '<ul class="error-list">';
                    d.errors.slice(0, 20).forEach(e => { html += '<li>' + escapeHtml(e) + '</li>'; });
                    html += '</ul>';
                }
                html += '</div>';
                document.getElementById('csvResult').innerHTML = html;
                break;
            }
        }
    });

    // ── 유틸리티 ──────────────────────────────
    function escapeHtml(s) {
        if (s === null || s === undefined) return '';
        return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    function isTextType(type) {
        const t = type.toLowerCase();
        return t.includes('text') || t.includes('clob') || t.includes('json') || t.includes('xml');
    }

    function isNumericType(type) {
        const t = type.toLowerCase();
        return t.includes('int') || t.includes('decimal') || t.includes('numeric')
            || t.includes('float') || t.includes('double') || t.includes('real')
            || t === 'serial' || t === 'bigserial';
    }
})();
</script>
</body>
</html>`;
    }

    private _escapeHtml(s: string): string {
        return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
}
