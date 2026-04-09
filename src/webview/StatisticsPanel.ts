import * as vscode from 'vscode';
import { ConnectionManager } from '../managers/connectionManager';
import { I18n } from '../utils/i18n';
import { collectTableStatistics, TableStatistics, ColumnStatistics } from '../utils/dataStatistics';

/**
 * 데이터 통계 패널
 * - 컬럼별 min/max/avg, NULL 비율, distinct 수
 * - 상위 N개 빈출값
 */
export class StatisticsPanel {
    public static currentPanel: StatisticsPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];
    private _tableName: string;
    private _databaseName: string;
    private _dbType: string;

    private constructor(
        panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri,
        private connectionManager: ConnectionManager,
        private i18n: I18n,
        tableName: string,
        databaseName: string,
        dbType: string
    ) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._tableName = tableName;
        this._databaseName = databaseName;
        this._dbType = dbType;

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.webview.onDidReceiveMessage(
            async (message) => {
                if (message.command === 'refresh') {
                    await this._loadStatistics();
                }
            },
            null,
            this._disposables
        );

        this._loadStatistics();
    }

    public static async createOrShow(
        extensionUri: vscode.Uri,
        connectionManager: ConnectionManager,
        i18n: I18n,
        tableName: string,
        databaseName: string,
        dbType: string
    ): Promise<void> {
        const column = vscode.ViewColumn.One;

        if (StatisticsPanel.currentPanel) {
            StatisticsPanel.currentPanel._panel.reveal(column);
            StatisticsPanel.currentPanel._tableName = tableName;
            StatisticsPanel.currentPanel._databaseName = databaseName;
            StatisticsPanel.currentPanel._dbType = dbType;
            await StatisticsPanel.currentPanel._loadStatistics();
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'dbunnyStatistics',
            `Stats: ${tableName}`,
            column,
            { enableScripts: true, localResourceRoots: [extensionUri], retainContextWhenHidden: true }
        );

        StatisticsPanel.currentPanel = new StatisticsPanel(
            panel, extensionUri, connectionManager, i18n,
            tableName, databaseName, dbType
        );
    }

    public dispose(): void {
        StatisticsPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const d = this._disposables.pop();
            if (d) { d.dispose(); }
        }
    }

    private async _loadStatistics(): Promise<void> {
        try {
            const conn = this.connectionManager.getActiveConnection();
            if (!conn) { this._showError('No active connection'); return; }

            this._panel.title = `Stats: ${this._tableName}`;
            this._panel.webview.html = this._getLoadingHtml();

            const schema = await conn.getTableSchema(this._tableName, this._databaseName);
            const stats = await collectTableStatistics(
                conn, this._tableName, schema, this._dbType, this._databaseName
            );

            this._panel.webview.html = this._getHtmlContent(stats);
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            this._showError(msg);
        }
    }

    private _showError(message: string): void {
        this._panel.webview.html = `<!DOCTYPE html><html><body style="padding:20px;font-family:var(--vscode-font-family);color:var(--vscode-errorForeground);">
            <h3>Error</h3><p>${this._escapeHtml(message)}</p></body></html>`;
    }

    private _getLoadingHtml(): string {
        const t = (k: string) => this.i18n.t(k) || k;
        return `<!DOCTYPE html><html><body style="padding:40px;text-align:center;font-family:var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-editor-background);">
            <p style="font-size:16px;">${t('statistics.loading')}</p></body></html>`;
    }

    private _getHtmlContent(stats: TableStatistics): string {
        const t = (k: string) => this.i18n.t(k) || k;

        const columnsHtml = stats.columns.map(col => this._renderColumnCard(col, stats.totalRows)).join('');

        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  :root {
    --bg: var(--vscode-editor-background);
    --fg: var(--vscode-editor-foreground);
    --card-bg: var(--vscode-editor-inactiveSelectionBackground, rgba(255,255,255,0.05));
    --border: var(--vscode-panel-border, #444);
    --accent: var(--vscode-textLink-foreground, #3794ff);
    --muted: var(--vscode-descriptionForeground, #888);
    --badge-bg: var(--vscode-badge-background);
    --badge-fg: var(--vscode-badge-foreground);
    --bar-bg: var(--vscode-progressBar-background, #0e70c0);
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: var(--vscode-font-family); color: var(--fg); background: var(--bg); padding: 16px; }

  .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
  .header h2 { font-size: 16px; font-weight: 600; }
  .header-meta { font-size: 12px; color: var(--muted); }
  .btn-refresh { background: none; border: 1px solid var(--border); color: var(--fg); padding: 4px 10px; border-radius: 3px; cursor: pointer; font-size: 12px; }
  .btn-refresh:hover { background: var(--card-bg); }

  /* 요약 카드 */
  .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin-bottom: 24px; }
  .summary-card { background: var(--card-bg); border-radius: 6px; padding: 14px; text-align: center; }
  .summary-value { font-size: 24px; font-weight: 700; color: var(--accent); }
  .summary-label { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; margin-top: 4px; }

  /* 컬럼 카드 */
  .col-card { background: var(--card-bg); border-radius: 6px; padding: 14px; margin-bottom: 12px; }
  .col-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
  .col-name { font-weight: 600; font-size: 14px; }
  .col-type { font-size: 11px; color: var(--muted); background: rgba(128,128,128,0.15); padding: 2px 6px; border-radius: 3px; }

  .col-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 8px; margin-bottom: 10px; }
  .stat { padding: 6px 8px; background: rgba(128,128,128,0.08); border-radius: 4px; }
  .stat-label { font-size: 10px; color: var(--muted); text-transform: uppercase; }
  .stat-value { font-size: 13px; font-weight: 600; margin-top: 2px; }

  /* NULL 바 */
  .null-bar { height: 6px; background: rgba(128,128,128,0.2); border-radius: 3px; margin-top: 6px; overflow: hidden; }
  .null-fill { height: 100%; background: var(--bar-bg); border-radius: 3px; transition: width 0.3s; }

  /* 빈출값 */
  .top-values { margin-top: 8px; }
  .top-values-title { font-size: 11px; color: var(--muted); margin-bottom: 4px; }
  .tv-row { display: flex; align-items: center; gap: 8px; font-size: 12px; padding: 2px 0; }
  .tv-bar { height: 4px; background: var(--bar-bg); border-radius: 2px; min-width: 2px; }
  .tv-val { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 200px; }
  .tv-cnt { color: var(--muted); font-size: 11px; min-width: 40px; text-align: right; }
</style>
</head>
<body>

<div class="header">
  <div>
    <h2>${t('statistics.title')}: ${this._escapeHtml(stats.tableName)}</h2>
    <span class="header-meta">${stats.executionTime}ms</span>
  </div>
  <button class="btn-refresh" id="btnRefresh">${t('statistics.refresh')}</button>
</div>

<div class="summary">
  <div class="summary-card">
    <div class="summary-value">${stats.totalRows.toLocaleString()}</div>
    <div class="summary-label">${t('statistics.totalRows')}</div>
  </div>
  <div class="summary-card">
    <div class="summary-value">${stats.columnCount}</div>
    <div class="summary-label">${t('statistics.columns')}</div>
  </div>
</div>

${columnsHtml}

<script>
(function() {
    const vscode = acquireVsCodeApi();
    document.getElementById('btnRefresh').addEventListener('click', () => {
        vscode.postMessage({ command: 'refresh' });
    });
})();
</script>
</body>
</html>`;
    }

    private _renderColumnCard(col: ColumnStatistics, totalRows: number): string {
        const t = (k: string) => this.i18n.t(k) || k;
        const maxCount = col.topValues.length > 0 ? col.topValues[0].count : 1;

        let statsHtml = `
        <div class="stat"><div class="stat-label">${t('statistics.distinct')}</div><div class="stat-value">${col.distinctCount.toLocaleString()}</div></div>
        <div class="stat"><div class="stat-label">${t('statistics.nullCount')}</div><div class="stat-value">${col.nullCount.toLocaleString()} (${col.nullPercent}%)</div></div>`;

        if (col.min !== undefined) {
            statsHtml += `<div class="stat"><div class="stat-label">${t('statistics.min')}</div><div class="stat-value">${this._escapeHtml(String(col.min))}</div></div>`;
        }
        if (col.max !== undefined) {
            statsHtml += `<div class="stat"><div class="stat-label">${t('statistics.max')}</div><div class="stat-value">${this._escapeHtml(String(col.max))}</div></div>`;
        }
        if (col.avg !== undefined) {
            statsHtml += `<div class="stat"><div class="stat-label">${t('statistics.avg')}</div><div class="stat-value">${col.avg}</div></div>`;
        }

        let topHtml = '';
        if (col.topValues.length > 0) {
            topHtml = `<div class="top-values">
                <div class="top-values-title">${t('statistics.topValues')}</div>`;
            for (const tv of col.topValues.slice(0, 5)) {
                const pct = Math.round((tv.count / maxCount) * 100);
                topHtml += `<div class="tv-row">
                    <span class="tv-val" title="${this._escapeHtml(tv.value)}">${this._escapeHtml(tv.value)}</span>
                    <div class="tv-bar" style="width:${pct}px"></div>
                    <span class="tv-cnt">${tv.count.toLocaleString()}</span>
                </div>`;
            }
            topHtml += '</div>';
        }

        const nullBarWidth = totalRows > 0 ? (col.nullCount / totalRows) * 100 : 0;

        return `<div class="col-card">
    <div class="col-header">
        <span class="col-name">${this._escapeHtml(col.columnName)}</span>
        <span class="col-type">${this._escapeHtml(col.columnType)}</span>
    </div>
    <div class="col-stats">${statsHtml}</div>
    <div class="null-bar"><div class="null-fill" style="width:${nullBarWidth}%"></div></div>
    ${topHtml}
</div>`;
    }

    private _escapeHtml(s: string): string {
        return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
}
