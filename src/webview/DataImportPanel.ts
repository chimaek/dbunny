import * as vscode from 'vscode';
import { ConnectionManager } from '../managers/connectionManager';
import { I18n } from '../utils/i18n';
import { ColumnInfo, ParsedFileData, ColumnMapping, ConflictStrategy, DataImportConfig } from '../types/database';
import { parseFile, suggestColumnMapping, importData, MAX_PREVIEW_ROWS, DEFAULT_BATCH_SIZE } from '../utils/dataImport';
import { checkWriteOperation } from '../utils/readOnlyGuard';

/**
 * 데이터 가져오기 WebView 패널
 * - 파일 선택 (CSV / JSON / Excel)
 * - 컬럼 매핑 미리보기
 * - 충돌 처리 옵션
 * - 대용량 파일 진행률 표시
 */
export class DataImportPanel {
    public static currentPanel: DataImportPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];
    private _tableName: string;
    private _databaseName: string;
    private _tableColumns: ColumnInfo[] = [];
    private _parsedData: ParsedFileData | null = null;

    private constructor(
        panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri,
        private connectionManager: ConnectionManager,
        private i18n: I18n,
        tableName: string,
        databaseName: string,
        tableColumns: ColumnInfo[]
    ) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._tableName = tableName;
        this._databaseName = databaseName;
        this._tableColumns = tableColumns;

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'selectFile':
                        await this._handleSelectFile();
                        break;
                    case 'startImport':
                        await this._handleStartImport(message);
                        break;
                }
            },
            null,
            this._disposables
        );

        // 초기 HTML 렌더링
        this._panel.webview.html = this._getHtmlContent();
    }

    /**
     * 패널 생성 또는 표시
     */
    public static async createOrShow(
        extensionUri: vscode.Uri,
        connectionManager: ConnectionManager,
        i18n: I18n,
        tableName: string,
        databaseName: string,
        tableColumns: ColumnInfo[]
    ): Promise<void> {
        const column = vscode.ViewColumn.One;

        if (DataImportPanel.currentPanel) {
            DataImportPanel.currentPanel._panel.reveal(column);
            DataImportPanel.currentPanel._tableName = tableName;
            DataImportPanel.currentPanel._databaseName = databaseName;
            DataImportPanel.currentPanel._tableColumns = tableColumns;
            DataImportPanel.currentPanel._parsedData = null;
            DataImportPanel.currentPanel._panel.webview.html =
                DataImportPanel.currentPanel._getHtmlContent();
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'dbunnyDataImport',
            `Import → ${tableName}`,
            column,
            {
                enableScripts: true,
                localResourceRoots: [extensionUri],
                retainContextWhenHidden: true
            }
        );

        DataImportPanel.currentPanel = new DataImportPanel(
            panel, extensionUri, connectionManager, i18n,
            tableName, databaseName, tableColumns
        );
    }

    /**
     * 파일 선택 → 파싱 → 미리보기 전송
     */
    private async _handleSelectFile(): Promise<void> {
        const uris = await vscode.window.showOpenDialog({
            canSelectMany: false,
            filters: {
                'Data Files': ['csv', 'json', 'xlsx', 'xls'],
                'CSV': ['csv'],
                'JSON': ['json'],
                'Excel': ['xlsx', 'xls'],
            },
        });
        if (!uris || uris.length === 0) { return; }

        try {
            const fileData = await vscode.workspace.fs.readFile(uris[0]);
            const fileName = uris[0].fsPath.split(/[/\\]/).pop() || 'unknown';
            this._parsedData = parseFile(fileData, fileName);

            // 자동 매핑 제안
            const mappings = suggestColumnMapping(
                this._parsedData.headers,
                this._tableColumns
            );

            // 미리보기 행 (최대 50)
            const previewRows = this._parsedData.rows.slice(0, MAX_PREVIEW_ROWS);

            this._panel.webview.postMessage({
                command: 'fileLoaded',
                data: {
                    fileName: this._parsedData.fileName,
                    format: this._parsedData.format,
                    totalRows: this._parsedData.totalRows,
                    headers: this._parsedData.headers,
                    previewRows,
                    mappings,
                },
            });
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(
                this.i18n.t('dataImport.parseFailed', { error: msg })
            );
        }
    }

    /**
     * 가져오기 실행
     */
    private async _handleStartImport(message: {
        mappings: ColumnMapping[];
        strategy: ConflictStrategy;
        batchSize: number;
    }): Promise<void> {
        if (!this._parsedData) {
            vscode.window.showWarningMessage(this.i18n.t('dataImport.noFile'));
            return;
        }

        const conn = this.connectionManager.getActiveConnection();
        if (!conn) {
            vscode.window.showWarningMessage(this.i18n.t('messages.noConnection'));
            return;
        }

        // 읽기 전용 체크
        if (conn.config.readOnly) {
            vscode.window.showWarningMessage(
                this.i18n.t('readOnly.blocked', { keyword: 'INSERT', name: conn.config.name })
            );
            return;
        }

        // PK 컬럼 추출
        const pkColumns = this._tableColumns
            .filter(c => c.primaryKey)
            .map(c => c.name);

        const config: DataImportConfig = {
            tableName: this._tableName,
            database: this._databaseName,
            columnMapping: message.mappings,
            conflictStrategy: message.strategy,
            batchSize: message.batchSize || DEFAULT_BATCH_SIZE,
            primaryKeyColumns: pkColumns,
        };

        // 진행률 표시
        this._panel.webview.postMessage({ command: 'importStarted' });

        try {
            const result = await importData(
                conn,
                this._parsedData,
                config,
                (progress) => {
                    this._panel.webview.postMessage({
                        command: 'importProgress',
                        data: progress,
                    });
                }
            );

            this._panel.webview.postMessage({
                command: 'importComplete',
                data: result,
            });

            const summary = this.i18n.t('dataImport.complete', {
                inserted: result.inserted.toString(),
                skipped: result.skipped.toString(),
                failed: result.failed.toString(),
                time: result.executionTime.toString(),
            });
            vscode.window.showInformationMessage(summary);
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            this._panel.webview.postMessage({
                command: 'importError',
                error: msg,
            });
            vscode.window.showErrorMessage(
                this.i18n.t('dataImport.importFailed', { error: msg })
            );
        }
    }

    private dispose(): void {
        DataImportPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const d = this._disposables.pop();
            if (d) { d.dispose(); }
        }
    }

    // ===== HTML 생성 =====

    private _getHtmlContent(): string {
        const t = (key: string, params?: Record<string, string>) => this.i18n.t(key, params);
        const columnsJson = JSON.stringify(this._tableColumns);

        return /*html*/ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Data Import</title>
<style>
:root {
    --bg: var(--vscode-editor-background);
    --fg: var(--vscode-editor-foreground);
    --border: var(--vscode-panel-border, #444);
    --input-bg: var(--vscode-input-background);
    --input-fg: var(--vscode-input-foreground);
    --btn-bg: var(--vscode-button-background);
    --btn-fg: var(--vscode-button-foreground);
    --btn-hover: var(--vscode-button-hoverBackground);
    --badge-bg: var(--vscode-badge-background);
    --badge-fg: var(--vscode-badge-foreground);
    --success: #27AE60;
    --warning: #F1C40F;
    --error: #E74C3C;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: var(--vscode-font-family); color: var(--fg); background: var(--bg); padding: 16px; }
h2 { font-size: 16px; margin-bottom: 12px; display: flex; align-items: center; gap: 8px; }
h3 { font-size: 13px; margin: 12px 0 8px; color: var(--fg); opacity: 0.85; }

.section { margin-bottom: 20px; padding: 12px; border: 1px solid var(--border); border-radius: 6px; }
.section-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }

/* 버튼 */
.btn { padding: 6px 14px; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; font-family: inherit; }
.btn-primary { background: var(--btn-bg); color: var(--btn-fg); }
.btn-primary:hover { background: var(--btn-hover); }
.btn-secondary { background: transparent; color: var(--fg); border: 1px solid var(--border); }
.btn-secondary:hover { background: var(--input-bg); }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }

/* 파일 선택 영역 */
.file-drop {
    border: 2px dashed var(--border); border-radius: 8px; padding: 32px;
    text-align: center; cursor: pointer; transition: border-color 0.2s;
}
.file-drop:hover { border-color: var(--btn-bg); }
.file-drop .icon { font-size: 32px; margin-bottom: 8px; }
.file-info { margin-top: 8px; font-size: 12px; opacity: 0.7; }

/* 배지 */
.badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 11px; background: var(--badge-bg); color: var(--badge-fg); }

/* 매핑 테이블 */
.mapping-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.mapping-table th { text-align: left; padding: 6px 8px; border-bottom: 2px solid var(--border); font-weight: 600; }
.mapping-table td { padding: 6px 8px; border-bottom: 1px solid var(--border); }
.mapping-table select { width: 100%; padding: 4px 6px; background: var(--input-bg); color: var(--input-fg); border: 1px solid var(--border); border-radius: 3px; font-size: 12px; }

/* 미리보기 테이블 */
.preview-wrapper { overflow-x: auto; max-height: 300px; overflow-y: auto; }
.preview-table { width: 100%; border-collapse: collapse; font-size: 11px; white-space: nowrap; }
.preview-table th { position: sticky; top: 0; background: var(--input-bg); padding: 4px 8px; border-bottom: 2px solid var(--border); text-align: left; }
.preview-table td { padding: 4px 8px; border-bottom: 1px solid var(--border); max-width: 200px; overflow: hidden; text-overflow: ellipsis; }
.preview-table tr:hover td { background: var(--input-bg); }

/* 옵션 영역 */
.options-row { display: flex; gap: 16px; align-items: center; flex-wrap: wrap; }
.option-group { display: flex; flex-direction: column; gap: 4px; }
.option-group label { font-size: 11px; opacity: 0.7; }
.option-group select, .option-group input { padding: 4px 8px; background: var(--input-bg); color: var(--input-fg); border: 1px solid var(--border); border-radius: 3px; font-size: 12px; }

/* 진행률 바 */
.progress-container { display: none; margin-top: 12px; }
.progress-container.visible { display: block; }
.progress-bar-outer { width: 100%; height: 20px; background: var(--input-bg); border-radius: 10px; overflow: hidden; }
.progress-bar-inner { height: 100%; background: var(--btn-bg); transition: width 0.3s ease; border-radius: 10px; }
.progress-stats { display: flex; gap: 16px; margin-top: 8px; font-size: 12px; }
.stat { display: flex; align-items: center; gap: 4px; }
.stat-dot { width: 8px; height: 8px; border-radius: 50%; }
.stat-dot.inserted { background: var(--success); }
.stat-dot.skipped { background: var(--warning); }
.stat-dot.failed { background: var(--error); }

/* 결과 */
.result-panel { padding: 12px; border-radius: 6px; margin-top: 12px; display: none; }
.result-panel.visible { display: block; }
.result-panel.success { border: 1px solid var(--success); background: rgba(39,174,96,0.1); }
.result-panel.error { border: 1px solid var(--error); background: rgba(231,76,60,0.1); }
.error-list { max-height: 150px; overflow-y: auto; margin-top: 8px; font-size: 11px; }
.error-item { padding: 2px 0; color: var(--error); }

/* 숨김 */
.hidden { display: none !important; }
</style>
</head>
<body>
    <h2>
        <span style="font-size: 20px;">&#128230;</span>
        ${t('dataImport.title')} — <code>${this._tableName}</code>
    </h2>

    <!-- 1. 파일 선택 -->
    <div class="section" id="fileSection">
        <div class="file-drop" id="fileDrop" onclick="selectFile()">
            <div class="icon">&#128196;</div>
            <div>${t('dataImport.selectFile')}</div>
            <div class="file-info">CSV, JSON, Excel (.xlsx)</div>
        </div>
        <div id="fileInfo" class="hidden" style="margin-top:8px; font-size:12px;">
            <span id="fileNameBadge" class="badge"></span>
            <span id="fileRowCount" style="margin-left:8px;"></span>
        </div>
    </div>

    <!-- 2. 컬럼 매핑 -->
    <div class="section hidden" id="mappingSection">
        <div class="section-header">
            <h3>${t('dataImport.columnMapping')}</h3>
        </div>
        <table class="mapping-table" id="mappingTable">
            <thead>
                <tr>
                    <th>${t('dataImport.sourceColumn')}</th>
                    <th>→</th>
                    <th>${t('dataImport.targetColumn')}</th>
                    <th>${t('dataImport.type')}</th>
                </tr>
            </thead>
            <tbody id="mappingBody"></tbody>
        </table>
    </div>

    <!-- 3. 데이터 미리보기 -->
    <div class="section hidden" id="previewSection">
        <h3>${t('dataImport.preview')} <span id="previewCount" class="badge"></span></h3>
        <div class="preview-wrapper">
            <table class="preview-table" id="previewTable">
                <thead id="previewHead"></thead>
                <tbody id="previewBody"></tbody>
            </table>
        </div>
    </div>

    <!-- 4. 옵션 + 실행 -->
    <div class="section hidden" id="optionsSection">
        <h3>${t('dataImport.options')}</h3>
        <div class="options-row">
            <div class="option-group">
                <label>${t('dataImport.conflictStrategy')}</label>
                <select id="strategySelect">
                    <option value="skip">${t('dataImport.strategySkip')}</option>
                    <option value="overwrite">${t('dataImport.strategyOverwrite')}</option>
                    <option value="upsert">${t('dataImport.strategyUpsert')}</option>
                </select>
            </div>
            <div class="option-group">
                <label>${t('dataImport.batchSize')}</label>
                <input type="number" id="batchSizeInput" value="${DEFAULT_BATCH_SIZE}" min="1" max="1000" style="width:80px;"/>
            </div>
            <div style="flex:1;"></div>
            <button class="btn btn-primary" id="importBtn" onclick="startImport()">
                ${t('dataImport.startImport')}
            </button>
        </div>

        <!-- 진행률 -->
        <div class="progress-container" id="progressContainer">
            <div class="progress-bar-outer">
                <div class="progress-bar-inner" id="progressBar" style="width:0%"></div>
            </div>
            <div class="progress-stats">
                <span id="progressText">0 / 0</span>
                <span class="stat"><span class="stat-dot inserted"></span> <span id="statInserted">0</span></span>
                <span class="stat"><span class="stat-dot skipped"></span> <span id="statSkipped">0</span></span>
                <span class="stat"><span class="stat-dot failed"></span> <span id="statFailed">0</span></span>
            </div>
        </div>

        <!-- 결과 -->
        <div class="result-panel" id="resultPanel">
            <div id="resultText"></div>
            <div class="error-list" id="errorList"></div>
        </div>
    </div>

<script>
    const vscode = acquireVsCodeApi();
    const tableColumns = ${columnsJson};
    let currentMappings = [];

    function selectFile() {
        vscode.postMessage({ command: 'selectFile' });
    }

    function startImport() {
        const strategy = document.getElementById('strategySelect').value;
        const batchSize = parseInt(document.getElementById('batchSizeInput').value) || ${DEFAULT_BATCH_SIZE};

        // 매핑 수집
        const mappings = [];
        const rows = document.querySelectorAll('#mappingBody tr');
        rows.forEach(row => {
            const sourceCol = row.dataset.source;
            const select = row.querySelector('select');
            const targetCol = select.value;
            const targetType = select.selectedOptions[0]?.dataset.type || '';
            if (targetCol) {
                mappings.push({ sourceColumn: sourceCol, targetColumn: targetCol, targetType });
            }
        });

        if (mappings.length === 0) {
            return;
        }

        document.getElementById('importBtn').disabled = true;
        vscode.postMessage({ command: 'startImport', mappings, strategy, batchSize });
    }

    // 메시지 수신
    window.addEventListener('message', event => {
        const msg = event.data;
        switch (msg.command) {
            case 'fileLoaded':
                onFileLoaded(msg.data);
                break;
            case 'importStarted':
                document.getElementById('progressContainer').classList.add('visible');
                document.getElementById('resultPanel').classList.remove('visible', 'success', 'error');
                break;
            case 'importProgress':
                updateProgress(msg.data);
                break;
            case 'importComplete':
                onImportComplete(msg.data);
                break;
            case 'importError':
                onImportError(msg.error);
                break;
        }
    });

    function onFileLoaded(data) {
        // 파일 정보
        document.getElementById('fileInfo').classList.remove('hidden');
        document.getElementById('fileNameBadge').textContent = data.fileName + ' (' + data.format.toUpperCase() + ')';
        document.getElementById('fileRowCount').textContent = data.totalRows + ' rows';

        // 매핑 테이블
        const tbody = document.getElementById('mappingBody');
        tbody.innerHTML = '';
        currentMappings = data.mappings;

        data.mappings.forEach(m => {
            const tr = document.createElement('tr');
            tr.dataset.source = m.sourceColumn;

            // 소스 컬럼
            const tdSrc = document.createElement('td');
            tdSrc.textContent = m.sourceColumn;
            tr.appendChild(tdSrc);

            // 화살표
            const tdArrow = document.createElement('td');
            tdArrow.textContent = '→';
            tdArrow.style.textAlign = 'center';
            tr.appendChild(tdArrow);

            // 타겟 셀렉트
            const tdTarget = document.createElement('td');
            const select = document.createElement('select');
            const optNone = document.createElement('option');
            optNone.value = '';
            optNone.textContent = '— skip —';
            select.appendChild(optNone);

            tableColumns.forEach(col => {
                const opt = document.createElement('option');
                opt.value = col.name;
                opt.dataset.type = col.type;
                opt.textContent = col.name;
                if (m.targetColumn === col.name) { opt.selected = true; }
                select.appendChild(opt);
            });
            tdTarget.appendChild(select);
            tr.appendChild(tdTarget);

            // 타입
            const tdType = document.createElement('td');
            tdType.textContent = m.targetType;
            tdType.style.opacity = '0.6';
            select.addEventListener('change', () => {
                const selOpt = select.selectedOptions[0];
                tdType.textContent = selOpt?.dataset.type || '';
            });
            tr.appendChild(tdType);

            tbody.appendChild(tr);
        });

        document.getElementById('mappingSection').classList.remove('hidden');

        // 미리보기 테이블
        const previewHead = document.getElementById('previewHead');
        const previewBody = document.getElementById('previewBody');
        previewHead.innerHTML = '';
        previewBody.innerHTML = '';

        const headTr = document.createElement('tr');
        data.headers.forEach(h => {
            const th = document.createElement('th');
            th.textContent = h;
            headTr.appendChild(th);
        });
        previewHead.appendChild(headTr);

        data.previewRows.forEach(row => {
            const tr = document.createElement('tr');
            row.forEach(cell => {
                const td = document.createElement('td');
                td.textContent = cell === null ? 'NULL' : String(cell);
                if (cell === null) { td.style.opacity = '0.4'; td.style.fontStyle = 'italic'; }
                tr.appendChild(td);
            });
            previewBody.appendChild(tr);
        });

        document.getElementById('previewCount').textContent =
            Math.min(data.previewRows.length, ${MAX_PREVIEW_ROWS}) + ' / ' + data.totalRows;
        document.getElementById('previewSection').classList.remove('hidden');
        document.getElementById('optionsSection').classList.remove('hidden');

        // 리셋
        document.getElementById('importBtn').disabled = false;
        document.getElementById('progressContainer').classList.remove('visible');
        document.getElementById('resultPanel').classList.remove('visible', 'success', 'error');
    }

    function updateProgress(p) {
        const pct = p.total > 0 ? Math.round((p.current / p.total) * 100) : 0;
        document.getElementById('progressBar').style.width = pct + '%';
        document.getElementById('progressText').textContent = p.current + ' / ' + p.total;
        document.getElementById('statInserted').textContent = p.inserted;
        document.getElementById('statSkipped').textContent = p.skipped;
        document.getElementById('statFailed').textContent = p.failed;
    }

    function onImportComplete(result) {
        updateProgress({
            total: result.inserted + result.skipped + result.failed,
            current: result.inserted + result.skipped + result.failed,
            inserted: result.inserted,
            skipped: result.skipped,
            failed: result.failed,
        });

        const panel = document.getElementById('resultPanel');
        panel.classList.add('visible', result.failed > 0 ? 'error' : 'success');
        document.getElementById('resultText').textContent =
            'Inserted: ' + result.inserted + ' | Skipped: ' + result.skipped +
            ' | Failed: ' + result.failed + ' | Time: ' + result.executionTime + 'ms';

        if (result.errors && result.errors.length > 0) {
            const errorList = document.getElementById('errorList');
            errorList.innerHTML = '';
            result.errors.forEach(e => {
                const div = document.createElement('div');
                div.className = 'error-item';
                div.textContent = 'Row ' + e.row + ': ' + e.message;
                errorList.appendChild(div);
            });
        }

        document.getElementById('importBtn').disabled = false;
    }

    function onImportError(error) {
        const panel = document.getElementById('resultPanel');
        panel.classList.add('visible', 'error');
        document.getElementById('resultText').textContent = 'Import failed: ' + error;
        document.getElementById('importBtn').disabled = false;
    }
</script>
</body>
</html>`;
    }
}
