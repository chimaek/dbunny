import * as vscode from 'vscode';
import { ConnectionConfig, DatabaseType } from '../types/database';
import { ConnectionManager } from '../managers/connectionManager';
import { I18n } from '../utils/i18n';

/**
 * Webview panel for connection form (add/edit)
 */
export class ConnectionFormPanel {
    public static currentPanel: ConnectionFormPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];

    private constructor(
        panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri,
        private connectionManager: ConnectionManager,
        private i18n: I18n,
        private existingConfig?: ConnectionConfig
    ) {
        this._panel = panel;
        this._extensionUri = extensionUri;

        this._panel.webview.html = this._getHtmlContent();

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'save':
                        await this._handleSave(message.data);
                        break;
                    case 'test':
                        await this._handleTest(message.data);
                        break;
                    case 'cancel':
                        this._panel.dispose();
                        break;
                }
            },
            null,
            this._disposables
        );
    }

    /**
     * Create or show the connection form panel
     */
    public static createOrShow(
        extensionUri: vscode.Uri,
        connectionManager: ConnectionManager,
        i18n: I18n,
        existingConfig?: ConnectionConfig
    ): void {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        if (ConnectionFormPanel.currentPanel) {
            ConnectionFormPanel.currentPanel._panel.reveal(column);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'dbunnyConnectionForm',
            existingConfig ? i18n.t('connection.editConnection') : i18n.t('connection.addConnection'),
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [extensionUri]
            }
        );

        ConnectionFormPanel.currentPanel = new ConnectionFormPanel(
            panel,
            extensionUri,
            connectionManager,
            i18n,
            existingConfig
        );
    }

    private async _handleSave(data: ConnectionConfig): Promise<void> {
        try {
            if (this.existingConfig) {
                await this.connectionManager.updateConnection(data);
                vscode.window.showInformationMessage(
                    this.i18n.t('messages.connectionUpdated', { name: data.name })
                );
            } else {
                data.id = this.connectionManager.generateConnectionId();
                await this.connectionManager.addConnection(data);
                vscode.window.showInformationMessage(
                    this.i18n.t('messages.connectionAdded', { name: data.name })
                );
            }
            this._panel.dispose();
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            vscode.window.showErrorMessage(message);
        }
    }

    private async _handleTest(data: ConnectionConfig): Promise<void> {
        try {
            this._panel.webview.postMessage({ command: 'testing', status: true });
            const success = await this.connectionManager.testConnection(data);
            this._panel.webview.postMessage({
                command: 'testResult',
                success,
                message: success
                    ? this.i18n.t('connection.testSuccess')
                    : this.i18n.t('connection.testFailed', { error: 'Connection failed' })
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            this._panel.webview.postMessage({
                command: 'testResult',
                success: false,
                message: this.i18n.t('connection.testFailed', { error: message })
            });
        } finally {
            this._panel.webview.postMessage({ command: 'testing', status: false });
        }
    }

    private _getHtmlContent(): string {
        const config = this.existingConfig;
        const isEdit = !!config;

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${isEdit ? 'Edit' : 'Add'} Connection</title>
    <style>
        :root {
            --vscode-font: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
        }
        * {
            box-sizing: border-box;
        }
        body {
            font-family: var(--vscode-font);
            padding: 20px;
            color: var(--vscode-foreground);
            background: var(--vscode-editor-background);
        }
        h2 {
            margin-top: 0;
            color: var(--vscode-foreground);
            border-bottom: 1px solid var(--vscode-panel-border);
            padding-bottom: 10px;
        }
        .form-group {
            margin-bottom: 16px;
        }
        label {
            display: block;
            margin-bottom: 6px;
            font-weight: 500;
            color: var(--vscode-foreground);
        }
        input, select {
            width: 100%;
            padding: 8px 12px;
            border: 1px solid var(--vscode-input-border);
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 4px;
            font-size: 14px;
        }
        input:focus, select:focus {
            outline: none;
            border-color: var(--vscode-focusBorder);
        }
        .row {
            display: flex;
            gap: 16px;
        }
        .row .form-group {
            flex: 1;
        }
        .buttons {
            display: flex;
            gap: 10px;
            margin-top: 24px;
            padding-top: 16px;
            border-top: 1px solid var(--vscode-panel-border);
        }
        button {
            padding: 8px 16px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 500;
        }
        .btn-primary {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        .btn-primary:hover {
            background: var(--vscode-button-hoverBackground);
        }
        .btn-secondary {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        .btn-secondary:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }
        .btn-test {
            margin-left: auto;
        }
        .message {
            padding: 10px;
            border-radius: 4px;
            margin-top: 16px;
            display: none;
        }
        .message.success {
            background: var(--vscode-testing-iconPassed);
            color: white;
            display: block;
        }
        .message.error {
            background: var(--vscode-testing-iconFailed);
            color: white;
            display: block;
        }
        .ssh-section {
            margin-top: 24px;
            padding: 16px;
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
        }
        .ssh-section h3 {
            margin-top: 0;
            font-size: 14px;
        }
        .checkbox-group {
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .checkbox-group input {
            width: auto;
        }
        .hidden {
            display: none;
        }
        .spinner {
            display: inline-block;
            width: 14px;
            height: 14px;
            border: 2px solid transparent;
            border-top-color: currentColor;
            border-radius: 50%;
            animation: spin 0.8s linear infinite;
            margin-right: 8px;
        }
        @keyframes spin {
            to { transform: rotate(360deg); }
        }
    </style>
</head>
<body>
    <h2>${isEdit ? '🐰 Edit Connection' : '🐰 Add New Connection'}</h2>

    <form id="connectionForm">
        <div class="form-group">
            <label for="name">Connection Name *</label>
            <input type="text" id="name" name="name" required value="${config?.name || ''}" placeholder="My Database">
        </div>

        <div class="form-group">
            <label for="type">Database Type *</label>
            <select id="type" name="type" required>
                <option value="mysql" ${config?.type === 'mysql' ? 'selected' : ''}>MySQL</option>
                <option value="postgres" ${config?.type === 'postgres' ? 'selected' : ''}>PostgreSQL</option>
                <option value="sqlite" ${config?.type === 'sqlite' ? 'selected' : ''}>SQLite</option>
                <option value="mongodb" ${config?.type === 'mongodb' ? 'selected' : ''}>MongoDB</option>
                <option value="redis" ${config?.type === 'redis' ? 'selected' : ''}>Redis</option>
            </select>
        </div>

        <div id="connectionFields">
            <div class="row">
                <div class="form-group">
                    <label for="host">Host *</label>
                    <input type="text" id="host" name="host" value="${config?.host || 'localhost'}" placeholder="localhost">
                </div>
                <div class="form-group" style="max-width: 120px;">
                    <label for="port">Port *</label>
                    <input type="number" id="port" name="port" value="${config?.port || 3306}" placeholder="3306">
                </div>
            </div>

            <div class="row">
                <div class="form-group">
                    <label for="username">Username</label>
                    <input type="text" id="username" name="username" value="${config?.username || ''}" placeholder="root">
                </div>
                <div class="form-group">
                    <label for="password">Password</label>
                    <input type="password" id="password" name="password" placeholder="••••••••">
                </div>
            </div>

            <div class="form-group">
                <label for="database">Database</label>
                <input type="text" id="database" name="database" value="${config?.database || ''}" placeholder="mydb">
            </div>
        </div>

        <div id="sqliteFields" class="hidden">
            <div class="form-group">
                <label for="sqlitePath">Database File Path *</label>
                <input type="text" id="sqlitePath" name="sqlitePath" value="${config?.database || ''}" placeholder="/path/to/database.db">
            </div>
        </div>

        <div class="ssh-section">
            <div class="checkbox-group">
                <input type="checkbox" id="useSSH" name="useSSH" ${config?.ssh ? 'checked' : ''}>
                <label for="useSSH" style="margin-bottom: 0;">Use SSH Tunnel</label>
            </div>
            <div id="sshFields" class="${config?.ssh ? '' : 'hidden'}">
                <div class="row" style="margin-top: 16px;">
                    <div class="form-group">
                        <label for="sshHost">SSH Host</label>
                        <input type="text" id="sshHost" name="sshHost" value="${config?.ssh?.host || ''}" placeholder="bastion.example.com">
                    </div>
                    <div class="form-group" style="max-width: 120px;">
                        <label for="sshPort">SSH Port</label>
                        <input type="number" id="sshPort" name="sshPort" value="${config?.ssh?.port || 22}" placeholder="22">
                    </div>
                </div>
                <div class="row">
                    <div class="form-group">
                        <label for="sshUsername">SSH Username</label>
                        <input type="text" id="sshUsername" name="sshUsername" value="${config?.ssh?.username || ''}" placeholder="ubuntu">
                    </div>
                    <div class="form-group">
                        <label for="sshPassword">SSH Password</label>
                        <input type="password" id="sshPassword" name="sshPassword" placeholder="••••••••">
                    </div>
                </div>
            </div>
        </div>

        <div id="testMessage" class="message"></div>

        <div class="buttons">
            <button type="button" class="btn-secondary" onclick="cancel()">Cancel</button>
            <button type="button" class="btn-secondary btn-test" id="testBtn" onclick="testConnection()">
                Test Connection
            </button>
            <button type="submit" class="btn-primary">
                ${isEdit ? 'Update' : 'Save'} Connection
            </button>
        </div>
    </form>

    <script>
        const vscode = acquireVsCodeApi();
        const form = document.getElementById('connectionForm');
        const typeSelect = document.getElementById('type');
        const connectionFields = document.getElementById('connectionFields');
        const sqliteFields = document.getElementById('sqliteFields');
        const useSSHCheckbox = document.getElementById('useSSH');
        const sshFields = document.getElementById('sshFields');
        const testMessage = document.getElementById('testMessage');
        const testBtn = document.getElementById('testBtn');

        const defaultPorts = {
            mysql: 3306,
            postgres: 5432,
            sqlite: 0,
            mongodb: 27017,
            redis: 6379
        };

        typeSelect.addEventListener('change', function() {
            const type = this.value;
            document.getElementById('port').value = defaultPorts[type];

            if (type === 'sqlite') {
                connectionFields.classList.add('hidden');
                sqliteFields.classList.remove('hidden');
            } else {
                connectionFields.classList.remove('hidden');
                sqliteFields.classList.add('hidden');
            }
        });

        useSSHCheckbox.addEventListener('change', function() {
            if (this.checked) {
                sshFields.classList.remove('hidden');
            } else {
                sshFields.classList.add('hidden');
            }
        });

        form.addEventListener('submit', function(e) {
            e.preventDefault();
            const data = getFormData();
            vscode.postMessage({ command: 'save', data });
        });

        function getFormData() {
            const type = typeSelect.value;
            const data = {
                id: '${config?.id || ''}',
                name: document.getElementById('name').value,
                type: type,
                host: type === 'sqlite' ? 'localhost' : document.getElementById('host').value,
                port: parseInt(document.getElementById('port').value) || defaultPorts[type],
                username: document.getElementById('username').value,
                password: document.getElementById('password').value,
                database: type === 'sqlite'
                    ? document.getElementById('sqlitePath').value
                    : document.getElementById('database').value
            };

            if (useSSHCheckbox.checked) {
                data.ssh = {
                    host: document.getElementById('sshHost').value,
                    port: parseInt(document.getElementById('sshPort').value) || 22,
                    username: document.getElementById('sshUsername').value,
                    password: document.getElementById('sshPassword').value
                };
            }

            return data;
        }

        function testConnection() {
            const data = getFormData();
            vscode.postMessage({ command: 'test', data });
        }

        function cancel() {
            vscode.postMessage({ command: 'cancel' });
        }

        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.command) {
                case 'testing':
                    if (message.status) {
                        testBtn.innerHTML = '<span class="spinner"></span>Testing...';
                        testBtn.disabled = true;
                    } else {
                        testBtn.innerHTML = 'Test Connection';
                        testBtn.disabled = false;
                    }
                    break;
                case 'testResult':
                    testMessage.className = 'message ' + (message.success ? 'success' : 'error');
                    testMessage.textContent = message.message;
                    break;
            }
        });

        // Initialize
        typeSelect.dispatchEvent(new Event('change'));
    </script>
</body>
</html>`;
    }

    public dispose(): void {
        ConnectionFormPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const disposable = this._disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }
}
