import { createNonce, secureWebviewHtml, serializeForWebview, webviewEventScript } from '../utils/webviewSecurity';
import * as vscode from 'vscode';
import { ConnectionManager } from '../managers/connectionManager';
import { I18n } from '../utils/i18n';
import { RoutineInfo } from '../types/database';

/**
 * 루틴(저장 프로시저, 함수, 뷰, 트리거) 소스 뷰어 및 실행 패널
 */
export class RoutinePanel {
    private readonly _nonce = createNonce();
    public static currentPanel: RoutinePanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];
    private _routine: RoutineInfo | undefined;
    private _source: string = '';
    private _connectionManager: ConnectionManager;

    private constructor(
        panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri,
        private i18n: I18n,
        connectionManager: ConnectionManager
    ) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._connectionManager = connectionManager;

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'execute':
                        await this._handleExecute(message.params || {});
                        break;
                    case 'copySource':
                        await vscode.env.clipboard.writeText(this._source);
                        vscode.window.showInformationMessage(i18n.t('routine.sourceCopied'));
                        break;
                    case 'drop':
                        await this._handleDrop();
                        break;
                    case 'close':
                        this.dispose();
                        break;
                }
            },
            null,
            this._disposables
        );

        this._panel.webview.html = secureWebviewHtml(this._getHtmlContent(), this._panel.webview, this._nonce);
    }

    public static createOrShow(
        extensionUri: vscode.Uri,
        connectionManager: ConnectionManager,
        i18n: I18n
    ): RoutinePanel {
        const column = vscode.ViewColumn.Beside;

        if (RoutinePanel.currentPanel) {
            RoutinePanel.currentPanel._panel.reveal(column);
            return RoutinePanel.currentPanel;
        }

        const panel = vscode.window.createWebviewPanel(
            'dbunnyRoutine',
            i18n.t('routine.title'),
            column,
            { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'resources')], retainContextWhenHidden: true }
        );

        RoutinePanel.currentPanel = new RoutinePanel(panel, extensionUri, i18n, connectionManager);
        return RoutinePanel.currentPanel;
    }

    public dispose(): void {
        RoutinePanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const d = this._disposables.pop();
            if (d) { d.dispose(); }
        }
    }

    public showLoading(): void {
        this._panel.title = this.i18n.t('routine.loading');
        this._panel.webview.postMessage({ command: 'showLoading' });
    }

    public showRoutine(routine: RoutineInfo, source: string): void {
        this._routine = routine;
        this._source = source;
        this._panel.title = routine.name;
        this._panel.webview.html = secureWebviewHtml(this._getHtmlContent(), this._panel.webview, this._nonce);
    }

    public showError(message: string): void {
        this._panel.webview.postMessage({ command: 'showError', message });
    }

    private _getHtmlContent(): string {
        const t = (k: string) => this.i18n.t(k) || k;
        const routine = this._routine;
        const source = this._source;
        const conn = this._connectionManager.getActiveConnection();
        const dbType = conn?.config.type || 'mysql';

        const routineJson = routine ? serializeForWebview(routine) : 'null';
        const sourceJson = serializeForWebview(source);
        const dbTypeJson = serializeForWebview(dbType);

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
    --code-bg: var(--vscode-textCodeBlock-background, rgba(0,0,0,0.2));
    --danger: var(--vscode-inputValidation-errorBorder, #e74c3c);
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: var(--vscode-font-family); color: var(--fg); background: var(--bg); padding: 16px; }
  .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
  .header h2 { font-size: 16px; font-weight: 600; }
  .header-meta { font-size: 12px; color: var(--muted); }
  .badge {
    display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 11px;
    font-weight: 600; text-transform: uppercase; border: 1px solid var(--border);
  }
  .section { margin-bottom: 16px; }
  .section-title { font-size: 12px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; }
  .code-block {
    background: var(--code-bg); border: 1px solid var(--border); border-radius: 4px;
    padding: 12px; overflow-x: auto; max-height: 400px; overflow-y: auto; font-size: 13px;
    font-family: var(--vscode-editor-font-family, monospace); line-height: 1.5;
  }
  .code-block .kw { color: var(--vscode-symbolIcon-classForeground, #569cd6); font-weight: 600; }
  .param-table { width: 100%; border-collapse: collapse; font-size: 13px; }
  .param-table th { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--border); color: var(--muted); font-size: 11px; text-transform: uppercase; }
  .param-table td { padding: 4px 8px; border-bottom: 1px solid var(--border); }
  .param-mode { font-size: 11px; padding: 1px 4px; border-radius: 3px; background: var(--card-bg); }
  .actions { display: flex; gap: 8px; flex-wrap: wrap; }
  .btn {
    padding: 6px 12px; border: none; border-radius: 3px; cursor: pointer; font-size: 12px;
    display: flex; align-items: center; gap: 4px;
  }
  .btn-primary { background: var(--btn-bg); color: var(--btn-fg); }
  .btn-primary:hover { background: var(--btn-hover); }
  .btn-secondary { background: none; border: 1px solid var(--border); color: var(--fg); }
  .btn-secondary:hover { background: var(--card-bg); }
  .btn-danger { background: none; border: 1px solid var(--danger); color: var(--danger); }
  .btn-danger:hover { background: rgba(231,76,60,0.1); }
  .no-data { text-align: center; padding: 40px; color: var(--muted); font-size: 14px; }
  .error-msg { padding: 12px; background: rgba(231,76,60,0.1); border: 1px solid var(--danger); border-radius: 4px; color: var(--danger); font-size: 13px; }
  .result-area { margin-top: 8px; }
  .flex-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  input { padding: 4px 8px; background: var(--input-bg); color: var(--input-fg); border: 1px solid var(--input-border); border-radius: 3px; font-size: 13px; }
</style>
</head>
<body>
<div id="app">
  <div class="no-data">${t('routine.selectRoutine')}</div>
</div>
<script nonce="${this._nonce}">
(function() {
    const vscode = acquireVsCodeApi();
    const routine = ${routineJson};
    const source = ${sourceJson};
    const dbType = ${dbTypeJson};

    function esc(s) {
        return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function getBadge(type) {
        return {procedure:'P',function:'F',view:'V',trigger:'T'}[type] || '?';
    }

    function render() {
        if (!routine) {
            document.getElementById('app').innerHTML = '<div class="no-data">Select a routine to view</div>';
            return;
        }

        const badge = getBadge(routine.type);
        let paramsHtml = '';
        if (routine.parameters && routine.parameters.length > 0) {
            paramsHtml = '<div class="section"><div class="section-title">Parameters</div>' +
                '<table class="param-table"><tr><th>Name</th><th>Type</th><th>Mode</th></tr>' +
                routine.parameters.map(p =>
                    '<tr><td>' + esc(p.name) + '</td><td>' + esc(p.dataType) + '</td><td><span class="param-mode">' + esc(p.mode) + '</span></td></tr>'
                ).join('') +
                '</table></div>';
        }

        let hasParams = routine.parameters && routine.parameters.length > 0;
        let canExecute = (routine.type === 'procedure' || routine.type === 'function') && dbType !== 'sqlite';
        let canDrop = routine.type !== 'trigger' || dbType !== 'postgres';

        document.getElementById('app').innerHTML =
            '<div class="header">' +
              '<div>' +
                '<h2>' + esc(routine.name) + ' <span class="badge">' + badge + ' &middot; ' + esc(routine.type) + '</span></h2>' +
                (routine.database ? '<span class="header-meta">' + esc(routine.database) + '</span>' : '') +
              '</div>' +
              '<div class="flex-row">' +
                '<button class="btn btn-secondary" data-dbunny-click="copySource()">📋 Copy</button>' +
              '</div>' +
            '</div>' +
            '<div class="section">' +
              '<div class="section-title">Source Code</div>' +
              '<div class="code-block">' + (source ? formatSource(source) : '<span class="muted">(no source available)</span>') + '</div>' +
            '</div>' +
            paramsHtml +
            (routine.type === 'function' && routine.returnType ? '<div class="section"><span class="header-meta">Returns: ' + esc(routine.returnType) + '</span></div>' : '') +
            '<div class="actions">' +
              (canExecute ? '<button class="btn btn-primary" data-dbunny-click="executeRoutine()">▶ Execute</button>' : '') +
              (canDrop ? '<button class="btn btn-danger" data-dbunny-click="dropRoutine()">🗑 Drop</button>' : '') +
            '</div>' +
            '<div id="execParams" style="display:none; margin-top:12px; padding:12px; background:var(--card-bg); border-radius:4px;">' +
              '<div class="section-title">Execute Parameters</div>' +
              '<div id="paramInputs"></div>' +
              '<button class="btn btn-primary" data-dbunny-click="doExecute()" style="margin-top:8px;">Run</button>' +
              '<button class="btn btn-secondary" data-dbunny-click="hideExec()" style="margin-top:8px;">Cancel</button>' +
            '</div>' +
            '<div id="execResult" class="result-area"></div>';
    }

    function formatSource(src) {
        var kw = 'CREATE|PROCEDURE|FUNCTION|VIEW|TRIGGER|SELECT|FROM|WHERE|INSERT|UPDATE|DELETE|DROP|ALTER|BEGIN|END|DECLARE|SET|RETURNS|RETURN|LANGUAGE|AS|IN|OUT|INOUT|IF|ELSE|THEN|LOOP|CALL|EXECUTE|OR|REPLACE|DEFINER|SQL|SECURITY|INVOKER|DETERMINISTIC|CONTAINS|READS|MODIFIES|NO|TABLE|INTO|VALUES|JOIN|LEFT|RIGHT|INNER|ON|GROUP|BY|ORDER|HAVING|LIMIT|OFFSET|UNION|ALL|DISTINCT|CASE|WHEN|AND|NOT|NULL|IS|LIKE|BETWEEN|EXISTS|EXCEPT|INTERSECT|PRIMARY|KEY|FOREIGN|REFERENCES|INDEX|UNIQUE|CHECK|CONSTRAINT|DEFAULT|AUTO_INCREMENT|CASCADE';
        var re = new RegExp('\\\\b(' + kw + ')\\\\b', 'gi');
        return esc(src).replace(re, '<span class="kw">$1</span>');
    }

    function copySource() { vscode.postMessage({command:'copySource'}); }
    function executeRoutine() {
        if (!routine.parameters || routine.parameters.length === 0) {
            vscode.postMessage({command:'execute', params:{}});
            return;
        }
        var div = document.getElementById('execParams');
        div.style.display = 'block';
        var inputs = routine.parameters.filter(function(p){return p.mode!=='OUT'}).map(function(p){return '<div class="flex-row" style="margin-bottom:6px;"><label style="min-width:80px;">'+esc(p.name)+' ('+esc(p.dataType)+')</label><input id="param_'+esc(p.name)+'" placeholder="'+esc(p.mode)+'"></div>'}).join('');
        document.getElementById('paramInputs').innerHTML = inputs;
    }
    function hideExec() { document.getElementById('execParams').style.display = 'none'; }

    function doExecute() {
        var params = {};
        if (routine.parameters) {
            routine.parameters.forEach(function(p) {
                var el = document.getElementById('param_'+p.name);
                if (el) { params[p.name] = el.value; }
            });
        }
        hideExec();
        vscode.postMessage({command:'execute', params:params});
    }

    function dropRoutine() { vscode.postMessage({command:'drop'}); }

    window.addEventListener('message', function(event) {
        var msg = event.data;
        if (msg.command === 'showLoading') {
            document.getElementById('app').innerHTML = '<div class="no-data">Loading routine...</div>';
        } else if (msg.command === 'showError') {
            document.getElementById('execResult').innerHTML = '<div class="error-msg">' + esc(msg.message) + '</div>';
        } else if (msg.command === 'executed') {
            if (msg.result && msg.result.rows && msg.result.rows.length > 0) {
                var cols = msg.result.fields.map(function(f){return f.name;});
                var headerRow = '<tr>' + cols.map(function(c){return '<th>'+esc(c)+'</th>';}).join('') + '</tr>';
                var dataRows = msg.result.rows.map(function(r){return '<tr>'+cols.map(function(c){return '<td>'+esc(String(r[c]||''))+'</td>';}).join('')+'</tr>';}).join('');
                document.getElementById('execResult').innerHTML = '<div class="section-title" style="margin-top:12px;">Result ('+msg.result.rowCount+' rows, '+msg.result.executionTime+'ms)</div><table class="param-table"><thead>'+headerRow+'</thead><tbody>'+dataRows+'</tbody></table>';
            } else {
                document.getElementById('execResult').innerHTML = '<div class="header-meta" style="margin-top:12px;">Executed successfully (no result set)</div>';
            }
        }
    });

    render();
${webviewEventScript(["copySource","executeRoutine","dropRoutine","doExecute","hideExec"],[])}
})();
</script>
</body>
</html>`;
    }

    private async _handleExecute(params: Record<string, unknown>): Promise<void> {
        try {
            const conn = this._connectionManager.getActiveConnection();
            if (!conn || !conn.executeRoutine || !this._routine) {
                vscode.window.showWarningMessage(this.i18n.t('messages.noConnection'));
                return;
            }
            const result = await conn.executeRoutine(this._routine.name, params, this._routine.database);
            this._panel.webview.postMessage({ command: 'executed', result });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            this._panel.webview.postMessage({ command: 'showError', message });
        }
    }

    private async _handleDrop(): Promise<void> {
        if (!this._routine) { return; }
        const confirm = await vscode.window.showWarningMessage(
            this.i18n.t('routine.dropConfirm', { name: this._routine.name }),
            { modal: true },
            this.i18n.t('common.delete')
        );
        if (!confirm) { return; }

        try {
            const conn = this._connectionManager.getActiveConnection();
            if (!conn || !conn.dropRoutine) {
                vscode.window.showWarningMessage(this.i18n.t('messages.noConnection'));
                return;
            }
            await conn.dropRoutine(this._routine.name, this._routine.type, this._routine.database);
            vscode.window.showInformationMessage(
                this.i18n.t('routine.dropped', { name: this._routine.name })
            );
            this.dispose();
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            vscode.window.showErrorMessage(
                this.i18n.t('routine.dropFailed', { error: message })
            );
        }
    }

    private _escapeHtml(s: string): string {
        return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
}
