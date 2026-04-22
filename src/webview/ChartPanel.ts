import * as vscode from 'vscode';
import { ConnectionManager } from '../managers/connectionManager';
import { I18n } from '../utils/i18n';
import { QueryResult } from '../types/database';
import {
    ChartType,
    buildChartData,
    renderBarChart,
    renderPieChart,
    renderLineChart,
    getNumericColumns,
    suggestChartType,
} from '../utils/chartBuilder';

/**
 * 차트 패널 — 쿼리 결과를 막대/파이/라인 차트로 시각화
 */
export class ChartPanel {
    public static currentPanel: ChartPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];
    private _result: QueryResult;
    private _tableName: string;
    private _databaseName: string;
    private _dbType: string;

    private constructor(
        panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri,
        private connectionManager: ConnectionManager,
        private i18n: I18n,
        result: QueryResult,
        tableName: string,
        databaseName: string,
        dbType: string
    ) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._result = result;
        this._tableName = tableName;
        this._databaseName = databaseName;
        this._dbType = dbType;

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'renderChart':
                        this._handleRenderChart(
                            message.chartType,
                            message.labelColumn,
                            message.valueColumn,
                            message.aggregation
                        );
                        break;
                    case 'refresh':
                        await this._handleRefresh();
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
        result: QueryResult,
        tableName: string,
        databaseName: string,
        dbType: string
    ): Promise<void> {
        const column = vscode.ViewColumn.Beside;

        if (ChartPanel.currentPanel) {
            ChartPanel.currentPanel._panel.reveal(column);
            ChartPanel.currentPanel._result = result;
            ChartPanel.currentPanel._tableName = tableName;
            ChartPanel.currentPanel._databaseName = databaseName;
            ChartPanel.currentPanel._dbType = dbType;
            ChartPanel.currentPanel._panel.webview.html =
                ChartPanel.currentPanel._getHtmlContent();
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'dbunnyChart',
            `Chart: ${tableName}`,
            column,
            { enableScripts: true, localResourceRoots: [extensionUri], retainContextWhenHidden: true }
        );

        ChartPanel.currentPanel = new ChartPanel(
            panel, extensionUri, connectionManager, i18n,
            result, tableName, databaseName, dbType
        );
    }

    public dispose(): void {
        ChartPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const d = this._disposables.pop();
            if (d) { d.dispose(); }
        }
    }

    private _handleRenderChart(
        chartType: ChartType,
        labelColumn: string,
        valueColumn: string,
        aggregation: 'raw' | 'sum' | 'count' | 'avg'
    ): void {
        const data = buildChartData(this._result, labelColumn, valueColumn, aggregation);

        let svg: string;
        switch (chartType) {
            case 'bar': svg = renderBarChart(data); break;
            case 'pie': svg = renderPieChart(data); break;
            case 'line': svg = renderLineChart(data); break;
            default: svg = renderBarChart(data);
        }

        this._panel.webview.postMessage({
            command: 'chartRendered',
            svg,
            dataPoints: data.length,
        });
    }

    private async _handleRefresh(): Promise<void> {
        try {
            const conn = this.connectionManager.getActiveConnection();
            if (!conn) { return; }

            const quote = this._dbType === 'mysql' ? '`' : '"';
            const escaped = this._dbType === 'mysql'
                ? this._tableName.replace(/`/g, '``')
                : this._tableName.replace(/"/g, '""');
            const result = await conn.executeQuery(
                `SELECT * FROM ${quote}${escaped}${quote}`, this._databaseName
            );
            this._result = result;
            this._panel.webview.html = this._getHtmlContent();
        } catch {
            // 새로고침 실패 시 기존 데이터 유지
        }
    }

    private _getHtmlContent(): string {
        const t = (k: string) => this.i18n.t(k) || k;
        const fields = this._result.fields;
        const numericCols = getNumericColumns(fields);
        const allCols = fields.map(f => f.name);

        // 기본 선택: 첫 번째 비숫자 컬럼 = 라벨, 첫 번째 숫자 컬럼 = 값
        const defaultLabel = fields.find(f => !numericCols.some(n => n.name === f.name))?.name || allCols[0] || '';
        const defaultValue = numericCols[0]?.name || allCols[0] || '';
        const defaultType = suggestChartType(this._result, defaultLabel, defaultValue, fields);

        const fieldsJson = JSON.stringify(fields);
        const numericColsJson = JSON.stringify(numericCols.map(c => c.name));
        const allColsJson = JSON.stringify(allCols);

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
    --input-bg: var(--vscode-input-background);
    --input-fg: var(--vscode-input-foreground);
    --input-border: var(--vscode-input-border);
    --btn-bg: var(--vscode-button-background);
    --btn-fg: var(--vscode-button-foreground);
    --btn-hover: var(--vscode-button-hoverBackground);
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: var(--vscode-font-family); color: var(--fg); background: var(--bg); padding: 16px; }

  .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
  .header h2 { font-size: 16px; font-weight: 600; }
  .header-meta { font-size: 12px; color: var(--muted); }

  .controls { display: flex; flex-wrap: wrap; gap: 10px; align-items: end; margin-bottom: 16px; padding: 12px; background: var(--card-bg); border-radius: 6px; }
  .control-group { display: flex; flex-direction: column; gap: 3px; }
  .control-group label { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; }
  .control-group select, .control-group input {
    padding: 5px 8px; background: var(--input-bg); color: var(--input-fg);
    border: 1px solid var(--input-border); border-radius: 3px; font-size: 13px;
  }

  .chart-types { display: flex; gap: 4px; }
  .chart-type-btn {
    padding: 5px 10px; border: 1px solid var(--border); background: none;
    color: var(--fg); border-radius: 3px; cursor: pointer; font-size: 12px;
  }
  .chart-type-btn.active { background: var(--btn-bg); color: var(--btn-fg); border-color: var(--btn-bg); }
  .chart-type-btn:hover:not(.active) { background: var(--card-bg); }

  .btn-render { padding: 5px 14px; background: var(--btn-bg); color: var(--btn-fg); border: none; border-radius: 3px; cursor: pointer; font-size: 13px; }
  .btn-render:hover { background: var(--btn-hover); }

  #chartArea { padding: 16px 0; min-height: 200px; }
  #chartArea svg { color: var(--fg); }

  .no-data { text-align: center; padding: 40px; color: var(--muted); font-size: 14px; }
  .info { font-size: 12px; color: var(--muted); margin-top: 8px; }
</style>
</head>
<body>

<div class="header">
  <div>
    <h2>${t('chart.title')}: ${this._escapeHtml(this._tableName)}</h2>
    <span class="header-meta">${this._result.rowCount} ${t('chart.rows')}</span>
  </div>
</div>

<div class="controls">
  <div class="control-group">
    <label>${t('chart.chartType')}</label>
    <div class="chart-types">
      <button class="chart-type-btn ${defaultType === 'bar' ? 'active' : ''}" data-type="bar">📊 ${t('chart.bar')}</button>
      <button class="chart-type-btn ${defaultType === 'pie' ? 'active' : ''}" data-type="pie">🥧 ${t('chart.pie')}</button>
      <button class="chart-type-btn ${defaultType === 'line' ? 'active' : ''}" data-type="line">📈 ${t('chart.line')}</button>
    </div>
  </div>

  <div class="control-group">
    <label>${t('chart.labelColumn')}</label>
    <select id="labelCol"></select>
  </div>

  <div class="control-group">
    <label>${t('chart.valueColumn')}</label>
    <select id="valueCol"></select>
  </div>

  <div class="control-group">
    <label>${t('chart.aggregation')}</label>
    <select id="aggregation">
      <option value="raw">${t('chart.aggRaw')}</option>
      <option value="sum">${t('chart.aggSum')}</option>
      <option value="count">${t('chart.aggCount')}</option>
      <option value="avg">${t('chart.aggAvg')}</option>
    </select>
  </div>

  <button class="btn-render" id="btnRender">${t('chart.render')}</button>
</div>

<div id="chartArea">
  <div class="no-data">${t('chart.selectAndRender')}</div>
</div>
<div id="chartInfo" class="info"></div>

<script>
(function() {
    const vscode = acquireVsCodeApi();
    const fields = ${fieldsJson};
    const numericCols = ${numericColsJson};
    const allCols = ${allColsJson};

    const labelSelect = document.getElementById('labelCol');
    const valueSelect = document.getElementById('valueCol');
    let currentType = '${defaultType}';

    // 컬럼 셀렉트 초기화
    allCols.forEach(col => {
        const opt = document.createElement('option');
        opt.value = col;
        opt.textContent = col;
        if (col === '${this._escapeHtml(defaultLabel)}') opt.selected = true;
        labelSelect.appendChild(opt);
    });

    allCols.forEach(col => {
        const opt = document.createElement('option');
        opt.value = col;
        opt.textContent = col + (numericCols.includes(col) ? ' 🔢' : '');
        if (col === '${this._escapeHtml(defaultValue)}') opt.selected = true;
        valueSelect.appendChild(opt);
    });

    // 차트 타입 버튼
    document.querySelectorAll('.chart-type-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.chart-type-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentType = btn.dataset.type;
        });
    });

    // 렌더링 버튼
    document.getElementById('btnRender').addEventListener('click', () => {
        vscode.postMessage({
            command: 'renderChart',
            chartType: currentType,
            labelColumn: labelSelect.value,
            valueColumn: valueSelect.value,
            aggregation: document.getElementById('aggregation').value,
        });
    });

    // 차트 수신
    window.addEventListener('message', event => {
        const msg = event.data;
        if (msg.command === 'chartRendered') {
            document.getElementById('chartArea').innerHTML = msg.svg;
            document.getElementById('chartInfo').textContent =
                msg.dataPoints + ' ${t('chart.dataPoints')}';
        }
    });

    // 초기 렌더링
    if (allCols.length >= 2) {
        document.getElementById('btnRender').click();
    }
})();
</script>
</body>
</html>`;
    }

    private _escapeHtml(s: string): string {
        return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
}
