import * as vscode from 'vscode';
import { ConnectionConfig } from '../types/database';
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
                    case 'browseFile':
                        await this._handleBrowseFile();
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

    private async _handleBrowseFile(): Promise<void> {
        const result = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            filters: {
                'SQLite Database': ['db', 'sqlite', 'sqlite3', 'db3'],
                'All Files': ['*']
            },
            title: this.i18n.t('connection.selectSqliteFile') || 'Select SQLite Database File'
        });

        if (result && result.length > 0) {
            const filePath = result[0].fsPath;
            this._panel.webview.postMessage({
                command: 'fileSelected',
                path: filePath
            });
        }
    }

    private _getHtmlContent(): string {
        const config = this.existingConfig;
        const isEdit = !!config;

        // Get translations for webview
        const t = {
            title: isEdit ? this.i18n.t('webview.connectionForm.editTitle') : this.i18n.t('webview.connectionForm.title'),
            subtitle: isEdit ? this.i18n.t('webview.connectionForm.editSubtitle') : this.i18n.t('webview.connectionForm.subtitle'),
            basicInfo: this.i18n.t('webview.connectionForm.basicInfo'),
            connectionName: this.i18n.t('webview.connectionForm.connectionName'),
            connectionNamePlaceholder: this.i18n.t('webview.connectionForm.connectionNamePlaceholder'),
            connectionDetails: this.i18n.t('webview.connectionForm.connectionDetails'),
            host: this.i18n.t('webview.connectionForm.host'),
            port: this.i18n.t('webview.connectionForm.port'),
            username: this.i18n.t('webview.connectionForm.username'),
            password: this.i18n.t('webview.connectionForm.password'),
            database: this.i18n.t('webview.connectionForm.database'),
            optional: this.i18n.t('webview.connectionForm.optional'),
            required: this.i18n.t('webview.connectionForm.required'),
            sshTunnel: this.i18n.t('webview.connectionForm.sshTunnel'),
            sshDesc: this.i18n.t('webview.connectionForm.sshDesc'),
            sshConfig: this.i18n.t('webview.connectionForm.sshConfig'),
            sshHost: this.i18n.t('webview.connectionForm.sshHost'),
            sshPort: this.i18n.t('webview.connectionForm.sshPort'),
            sshUsername: this.i18n.t('webview.connectionForm.sshUsername'),
            sshPassword: this.i18n.t('webview.connectionForm.sshPassword'),
            testConnection: this.i18n.t('webview.connectionForm.testConnection'),
            saveConnection: isEdit ? this.i18n.t('webview.connectionForm.updateConnection') : this.i18n.t('webview.connectionForm.saveConnection'),
            testing: this.i18n.t('webview.connectionForm.testing'),
            cancel: this.i18n.t('webview.common.cancel'),
            filePath: this.i18n.t('webview.connectionForm.database')
        };

        return `<!DOCTYPE html>
<html lang="${this.i18n.getCurrentLanguage()}">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${t.title}</title>
    <style>
        :root {
            --vscode-font: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
            --mysql-color: #00758F;
            --postgres-color: #336791;
            --sqlite-color: #003B57;
            --mongodb-color: #47A248;
            --redis-color: #DC382D;
            --h2-color: #0074BD;
            --border-radius: 0.5rem;
            --transition: all 0.2s ease;
        }
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }
        html {
            font-size: var(--vscode-font-size, 13px);
        }
        body {
            font-family: var(--vscode-font);
            padding: 0;
            color: var(--vscode-foreground);
            background: var(--vscode-editor-background);
            line-height: 1.5;
        }
        .container {
            max-width: 50rem;
            margin: 0 auto;
            padding: 2.5rem;
        }
        .header {
            display: flex;
            align-items: center;
            gap: 0.9rem;
            margin-bottom: 2.5rem;
            padding-bottom: 1.5rem;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        .header-icon {
            font-size: 2.5rem;
        }
        .header h1 {
            font-size: 1.8rem;
            font-weight: 600;
            color: var(--vscode-foreground);
        }
        .header p {
            font-size: 1rem;
            color: var(--vscode-descriptionForeground);
            margin-top: 0.25rem;
        }

        /* Database Type Selector */
        .db-type-selector {
            display: grid;
            grid-template-columns: repeat(6, 1fr);
            gap: 0.9rem;
            margin-bottom: 2rem;
        }
        .db-type-card {
            display: flex;
            flex-direction: column;
            align-items: center;
            padding: 1.25rem 0.5rem;
            border: 2px solid var(--vscode-input-border);
            border-radius: var(--border-radius);
            cursor: pointer;
            transition: var(--transition);
            background: var(--vscode-input-background);
        }
        .db-type-card:hover {
            border-color: var(--vscode-focusBorder);
            transform: translateY(-0.125rem);
        }
        .db-type-card.selected {
            border-color: var(--db-color, var(--vscode-focusBorder));
            background: color-mix(in srgb, var(--db-color, var(--vscode-focusBorder)) 10%, transparent);
        }
        .db-type-card .icon {
            width: 3rem;
            height: 3rem;
            display: flex;
            align-items: center;
            justify-content: center;
            margin-bottom: 0.5rem;
            font-size: 2rem;
            border-radius: 0.5rem;
        }
        .db-type-card .name {
            font-size: 0.9rem;
            font-weight: 500;
            color: var(--vscode-foreground);
        }
        .db-type-card[data-type="mysql"] { --db-color: var(--mysql-color); }
        .db-type-card[data-type="postgres"] { --db-color: var(--postgres-color); }
        .db-type-card[data-type="sqlite"] { --db-color: var(--sqlite-color); }
        .db-type-card[data-type="mongodb"] { --db-color: var(--mongodb-color); }
        .db-type-card[data-type="redis"] { --db-color: var(--redis-color); }
        .db-type-card[data-type="h2"] { --db-color: var(--h2-color); }

        /* Form Styles */
        .form-section {
            background: var(--vscode-input-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: var(--border-radius);
            padding: 1.5rem;
            margin-bottom: 1.5rem;
        }
        .form-section-title {
            font-size: 1rem;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.03rem;
            color: var(--vscode-descriptionForeground);
            margin-bottom: 1.25rem;
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }
        .form-section-title::before {
            content: '';
            width: 0.25rem;
            height: 1.25rem;
            background: var(--db-color, var(--vscode-focusBorder));
            border-radius: 0.125rem;
        }
        .form-group {
            margin-bottom: 1.25rem;
        }
        .form-group:last-child {
            margin-bottom: 0;
        }
        label {
            display: flex;
            align-items: center;
            gap: 0.4rem;
            margin-bottom: 0.5rem;
            font-size: 1rem;
            font-weight: 500;
            color: var(--vscode-foreground);
        }
        label .required {
            color: var(--vscode-errorForeground);
        }
        label .hint {
            font-size: 0.85rem;
            color: var(--vscode-descriptionForeground);
            font-weight: 400;
        }
        input, select {
            width: 100%;
            padding: 0.75rem 1rem;
            border: 1px solid var(--vscode-input-border);
            background: var(--vscode-editor-background);
            color: var(--vscode-input-foreground);
            border-radius: 0.4rem;
            font-size: 1.1rem;
            transition: var(--transition);
        }
        input:focus, select:focus {
            outline: none;
            border-color: var(--db-color, var(--vscode-focusBorder));
            box-shadow: 0 0 0 0.2rem color-mix(in srgb, var(--db-color, var(--vscode-focusBorder)) 20%, transparent);
        }
        input::placeholder {
            color: var(--vscode-input-placeholderForeground);
        }
        .row {
            display: grid;
            grid-template-columns: 1fr auto;
            gap: 0.9rem;
        }
        .row.equal {
            grid-template-columns: 1fr 1fr;
        }
        .port-input {
            width: 7.5rem;
        }

        /* SSH Section */
        .ssh-toggle {
            display: flex;
            align-items: center;
            gap: 0.9rem;
            padding: 1rem 1.25rem;
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: var(--border-radius);
            cursor: pointer;
            transition: var(--transition);
            margin-bottom: 1.5rem;
        }
        .ssh-toggle:hover {
            border-color: var(--vscode-focusBorder);
        }
        .ssh-toggle.active {
            border-color: var(--vscode-focusBorder);
            background: color-mix(in srgb, var(--vscode-focusBorder) 5%, var(--vscode-editor-background));
        }
        .ssh-toggle input {
            width: 1.4rem;
            height: 1.4rem;
            cursor: pointer;
        }
        .ssh-toggle-content {
            flex: 1;
        }
        .ssh-toggle-title {
            font-size: 1.1rem;
            font-weight: 500;
        }
        .ssh-toggle-desc {
            font-size: 0.9rem;
            color: var(--vscode-descriptionForeground);
        }
        .ssh-fields {
            display: none;
            animation: slideDown 0.3s ease;
        }
        .ssh-fields.visible {
            display: block;
        }
        @keyframes slideDown {
            from {
                opacity: 0;
                transform: translateY(-0.75rem);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }

        /* Buttons */
        .buttons {
            display: flex;
            gap: 0.9rem;
            margin-top: 2rem;
            padding-top: 1.5rem;
            border-top: 1px solid var(--vscode-panel-border);
        }
        button {
            padding: 0.75rem 1.5rem;
            border: none;
            border-radius: 0.4rem;
            cursor: pointer;
            font-size: 1.1rem;
            font-weight: 500;
            transition: var(--transition);
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }
        .btn-primary {
            background: var(--db-color, var(--vscode-button-background));
            color: white;
            flex: 1;
            justify-content: center;
        }
        .btn-primary:hover {
            filter: brightness(1.1);
            transform: translateY(-0.0625rem);
        }
        .btn-primary:active {
            transform: translateY(0);
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
            background: transparent;
            border: 1px solid var(--vscode-input-border);
            color: var(--vscode-foreground);
        }
        .btn-test:hover {
            border-color: var(--db-color, var(--vscode-focusBorder));
            color: var(--db-color, var(--vscode-focusBorder));
        }

        /* Messages */
        .message {
            padding: 0.9rem 1.25rem;
            border-radius: 0.4rem;
            margin-top: 1.25rem;
            display: none;
            align-items: center;
            gap: 0.75rem;
            font-size: 1rem;
            animation: fadeIn 0.3s ease;
        }
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(-0.3rem); }
            to { opacity: 1; transform: translateY(0); }
        }
        .message.success {
            display: flex;
            background: color-mix(in srgb, #28a745 15%, var(--vscode-editor-background));
            border: 1px solid #28a745;
            color: #28a745;
        }
        .message.error {
            display: flex;
            background: color-mix(in srgb, #dc3545 15%, var(--vscode-editor-background));
            border: 1px solid #dc3545;
            color: #dc3545;
        }
        .message .icon {
            font-size: 1.4rem;
        }

        /* Spinner */
        .spinner {
            display: inline-block;
            width: 1.25rem;
            height: 1.25rem;
            border: 0.125rem solid transparent;
            border-top-color: currentColor;
            border-radius: 50%;
            animation: spin 0.8s linear infinite;
        }
        @keyframes spin {
            to { transform: rotate(360deg); }
        }

        /* File Input Row */
        .file-input-row {
            display: flex;
            gap: 0.5rem;
        }
        .file-input-row input {
            flex: 1;
        }
        .btn-browse {
            padding: 0.75rem 1rem;
            border: 1px solid var(--vscode-input-border);
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border-radius: 0.4rem;
            cursor: pointer;
            font-size: 1rem;
            white-space: nowrap;
            transition: var(--transition);
        }
        .btn-browse:hover {
            background: var(--vscode-button-secondaryHoverBackground);
            border-color: var(--db-color, var(--vscode-focusBorder));
        }

        /* Hidden */
        .hidden {
            display: none !important;
        }

        /* Responsive */
        @media (max-width: 45rem) {
            .db-type-selector {
                grid-template-columns: repeat(3, 1fr);
            }
            .row {
                grid-template-columns: 1fr;
            }
            .port-input {
                width: 100%;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <span class="header-icon">🐰</span>
            <div>
                <h1>${t.title}</h1>
                <p>${t.subtitle}</p>
            </div>
        </div>

        <form id="connectionForm">
            <!-- Database Type Selector -->
            <div class="db-type-selector">
                <div class="db-type-card ${config?.type === 'mysql' || !config ? 'selected' : ''}" data-type="mysql" onclick="selectDbType('mysql')">
                    <div class="icon">🐬</div>
                    <span class="name">MySQL</span>
                </div>
                <div class="db-type-card ${config?.type === 'postgres' ? 'selected' : ''}" data-type="postgres" onclick="selectDbType('postgres')">
                    <div class="icon">🐘</div>
                    <span class="name">PostgreSQL</span>
                </div>
                <div class="db-type-card ${config?.type === 'sqlite' ? 'selected' : ''}" data-type="sqlite" onclick="selectDbType('sqlite')">
                    <div class="icon">🪶</div>
                    <span class="name">SQLite</span>
                </div>
                <div class="db-type-card ${config?.type === 'mongodb' ? 'selected' : ''}" data-type="mongodb" onclick="selectDbType('mongodb')">
                    <div class="icon">🍃</div>
                    <span class="name">MongoDB</span>
                </div>
                <div class="db-type-card ${config?.type === 'redis' ? 'selected' : ''}" data-type="redis" onclick="selectDbType('redis')">
                    <div class="icon">⚡</div>
                    <span class="name">Redis</span>
                </div>
                <div class="db-type-card ${config?.type === 'h2' ? 'selected' : ''}" data-type="h2" onclick="selectDbType('h2')">
                    <div class="icon">🗄️</div>
                    <span class="name">H2</span>
                </div>
            </div>
            <input type="hidden" id="type" name="type" value="${this._escapeHtml(config?.type || 'mysql')}">

            <!-- Basic Info -->
            <div class="form-section">
                <div class="form-section-title">${t.basicInfo}</div>
                <div class="form-group">
                    <label for="name">
                        ${t.connectionName}
                        <span class="required">*</span>
                    </label>
                    <input type="text" id="name" name="name" required value="${this._escapeHtml(config?.name || '')}" placeholder="${t.connectionNamePlaceholder}">
                </div>
            </div>

            <!-- Connection Details -->
            <div class="form-section" id="connectionFields">
                <div class="form-section-title">${t.connectionDetails}</div>
                <div class="row">
                    <div class="form-group">
                        <label for="host">
                            ${t.host}
                            <span class="required">*</span>
                        </label>
                        <input type="text" id="host" name="host" value="${this._escapeHtml(config?.host || 'localhost')}" placeholder="localhost">
                    </div>
                    <div class="form-group">
                        <label for="port">
                            ${t.port}
                            <span class="required">*</span>
                        </label>
                        <input type="number" id="port" name="port" class="port-input" value="${config?.port || 3306}" placeholder="3306">
                    </div>
                </div>

                <div class="row equal">
                    <div class="form-group">
                        <label for="username">
                            ${t.username}
                            <span class="hint">(${t.optional})</span>
                        </label>
                        <input type="text" id="username" name="username" value="${this._escapeHtml(config?.username || '')}" placeholder="root">
                    </div>
                    <div class="form-group">
                        <label for="password">
                            ${t.password}
                            <span class="hint">(${t.optional})</span>
                        </label>
                        <input type="password" id="password" name="password" placeholder="••••••••">
                    </div>
                </div>

                <div class="form-group">
                    <label for="database">
                        ${t.database}
                        <span class="hint">(${t.optional})</span>
                    </label>
                    <input type="text" id="database" name="database" value="${this._escapeHtml(config?.database || '')}" placeholder="mydb">
                </div>
            </div>

            <!-- SQLite Fields -->
            <div class="form-section hidden" id="sqliteFields">
                <div class="form-section-title">${t.filePath}</div>
                <div class="form-group">
                    <label for="sqlitePath">
                        ${t.filePath}
                        <span class="required">*</span>
                    </label>
                    <div class="file-input-row">
                        <input type="text" id="sqlitePath" name="sqlitePath" value="${this._escapeHtml(config?.database || '')}" placeholder="/path/to/database.db">
                        <button type="button" class="btn-browse" onclick="browseFile()">📂 Browse</button>
                    </div>
                </div>
            </div>

            <!-- H2 Options -->
            <div class="form-section hidden" id="h2Fields">
                <div class="form-section-title">H2 Options</div>
                <div class="form-group">
                    <label for="h2DbType">Database Mode</label>
                    <select id="h2DbType" name="h2DbType" onchange="toggleH2DbPath()">
                        <option value="mem" ${config?.h2Mode?.dbType === 'mem' || !config?.h2Mode ? 'selected' : ''}>In-Memory (Volatile)</option>
                        <option value="file" ${config?.h2Mode?.dbType === 'file' ? 'selected' : ''}>Embedded (File)</option>
                    </select>
                </div>
                <div class="form-group" id="h2DbPathGroup">
                    <label for="h2DbPath">
                        <span id="h2DbPathLabel">Database Name</span>
                        <span class="hint">(${t.optional})</span>
                    </label>
                    <input type="text" id="h2DbPath" name="h2DbPath" value="${this._escapeHtml(config?.h2Mode?.dbPath || '')}" placeholder="testdb">
                </div>
                <div class="form-group">
                    <div style="font-size: 0.85rem; color: var(--vscode-descriptionForeground); padding: 0.75rem; background: var(--vscode-editor-background); border-radius: 0.4rem; line-height: 1.6;">
                        <strong style="color: var(--vscode-errorForeground);">⚠️ Important:</strong> H2 must be started via <strong>command line</strong>, not GUI.<br><br>
                        <strong>Step 1.</strong> Download H2: <a href="https://h2database.com/html/download.html" style="color: var(--vscode-textLink-foreground);">h2database.com</a><br>
                        <strong>Step 2.</strong> Run in terminal:<br>
                        <code style="font-family: monospace; background: var(--vscode-textCodeBlock-background); padding: 0.5rem; display: block; margin: 0.5rem 0; border-radius: 0.25rem; font-size: 0.75rem;">java -cp h2*.jar org.h2.tools.Server -tcp -tcpAllowOthers -pg -pgAllowOthers -pgPort 5435 -ifNotExists</code>
                        <strong>Step 3.</strong> Connect with: Host=localhost, Port=5435, User=sa<br><br>
                        <span style="color: var(--vscode-descriptionForeground);">❌ H2 Console (GUI/Browser) does not enable PostgreSQL protocol</span>
                    </div>
                </div>
            </div>

            <!-- SSH Tunnel -->
            <label class="ssh-toggle ${config?.ssh ? 'active' : ''}" id="sshToggle">
                <input type="checkbox" id="useSSH" name="useSSH" ${config?.ssh ? 'checked' : ''}>
                <div class="ssh-toggle-content">
                    <div class="ssh-toggle-title">🔐 ${t.sshTunnel}</div>
                    <div class="ssh-toggle-desc">${t.sshDesc}</div>
                </div>
            </label>

            <div class="form-section ssh-fields ${config?.ssh ? 'visible' : ''}" id="sshFields">
                <div class="form-section-title">${t.sshConfig}</div>
                <div class="row">
                    <div class="form-group">
                        <label for="sshHost">${t.sshHost}</label>
                        <input type="text" id="sshHost" name="sshHost" value="${this._escapeHtml(config?.ssh?.host || '')}" placeholder="bastion.example.com">
                    </div>
                    <div class="form-group">
                        <label for="sshPort">${t.sshPort}</label>
                        <input type="number" id="sshPort" name="sshPort" class="port-input" value="${config?.ssh?.port || 22}" placeholder="22">
                    </div>
                </div>
                <div class="row equal">
                    <div class="form-group">
                        <label for="sshUsername">${t.sshUsername}</label>
                        <input type="text" id="sshUsername" name="sshUsername" value="${this._escapeHtml(config?.ssh?.username || '')}" placeholder="ubuntu">
                    </div>
                    <div class="form-group">
                        <label for="sshPassword">${t.sshPassword}</label>
                        <input type="password" id="sshPassword" name="sshPassword" placeholder="••••••••">
                    </div>
                </div>
            </div>

            <div id="testMessage" class="message">
                <span class="icon"></span>
                <span class="text"></span>
            </div>

            <div class="buttons">
                <button type="button" class="btn-secondary" onclick="cancel()">${t.cancel}</button>
                <button type="button" class="btn-test" id="testBtn" onclick="testConnection()">
                    <span class="btn-icon">🔌</span>
                    ${t.testConnection}
                </button>
                <button type="submit" class="btn-primary" id="saveBtn">
                    <span class="btn-icon">${isEdit ? '💾' : '➕'}</span>
                    ${t.saveConnection}
                </button>
            </div>
        </form>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        const form = document.getElementById('connectionForm');
        const typeInput = document.getElementById('type');
        const connectionFields = document.getElementById('connectionFields');
        const sqliteFields = document.getElementById('sqliteFields');
        const h2Fields = document.getElementById('h2Fields');
        const useSSHCheckbox = document.getElementById('useSSH');
        const sshToggle = document.getElementById('sshToggle');
        const sshFields = document.getElementById('sshFields');
        const testMessage = document.getElementById('testMessage');
        const testBtn = document.getElementById('testBtn');

        const defaultPorts = {
            mysql: 3306,
            postgres: 5432,
            sqlite: 0,
            mongodb: 27017,
            redis: 6379,
            h2: 5435
        };

        const dbColors = {
            mysql: '#00758F',
            postgres: '#336791',
            sqlite: '#003B57',
            mongodb: '#47A248',
            redis: '#DC382D',
            h2: '#0074BD'
        };

        function selectDbType(type) {
            // Update hidden input
            typeInput.value = type;

            // Update card selection
            document.querySelectorAll('.db-type-card').forEach(card => {
                card.classList.remove('selected');
            });
            document.querySelector('[data-type="' + type + '"]').classList.add('selected');

            // Update port
            document.getElementById('port').value = defaultPorts[type];

            // Show/hide fields based on type
            if (type === 'sqlite') {
                connectionFields.classList.add('hidden');
                sqliteFields.classList.remove('hidden');
                h2Fields.classList.add('hidden');
                sshToggle.classList.add('hidden');
                sshFields.classList.remove('visible');
            } else if (type === 'h2') {
                connectionFields.classList.remove('hidden');
                sqliteFields.classList.add('hidden');
                h2Fields.classList.remove('hidden');
                sshToggle.classList.remove('hidden');
                // Set default username for H2
                const usernameField = document.getElementById('username');
                if (!usernameField.value) {
                    usernameField.value = 'sa';
                }
            } else {
                connectionFields.classList.remove('hidden');
                sqliteFields.classList.add('hidden');
                h2Fields.classList.add('hidden');
                sshToggle.classList.remove('hidden');
            }

            // Update CSS variable for theming
            document.documentElement.style.setProperty('--db-color', dbColors[type]);
        }

        function toggleH2DbPath() {
            const dbType = document.getElementById('h2DbType').value;
            const label = document.getElementById('h2DbPathLabel');
            const input = document.getElementById('h2DbPath');

            if (dbType === 'mem') {
                label.textContent = 'Database Name';
                input.placeholder = 'testdb';
            } else {
                label.textContent = 'Database File Path';
                input.placeholder = './data/mydb';
            }
        }

        // SSH Toggle
        useSSHCheckbox.addEventListener('change', function() {
            if (this.checked) {
                sshToggle.classList.add('active');
                sshFields.classList.add('visible');
            } else {
                sshToggle.classList.remove('active');
                sshFields.classList.remove('visible');
            }
        });

        // Form submit
        form.addEventListener('submit', function(e) {
            e.preventDefault();
            const data = getFormData();
            vscode.postMessage({ command: 'save', data });
        });

        function getFormData() {
            const type = typeInput.value;
            const data = {
                id: '${this._escapeHtml(config?.id || '')}',
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

            // Add H2 mode options
            if (type === 'h2') {
                data.h2Mode = {
                    protocol: 'tcp',
                    dbType: document.getElementById('h2DbType').value,
                    dbPath: document.getElementById('h2DbPath').value
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

        function browseFile() {
            vscode.postMessage({ command: 'browseFile' });
        }

        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.command) {
                case 'testing':
                    if (message.status) {
                        testBtn.innerHTML = '<span class="spinner"></span>${t.testing}';
                        testBtn.disabled = true;
                    } else {
                        testBtn.innerHTML = '<span class="btn-icon">🔌</span>${t.testConnection}';
                        testBtn.disabled = false;
                    }
                    break;
                case 'testResult':
                    testMessage.className = 'message ' + (message.success ? 'success' : 'error');
                    testMessage.querySelector('.icon').textContent = message.success ? '✅' : '❌';
                    testMessage.querySelector('.text').textContent = message.message;
                    break;
                case 'fileSelected':
                    document.getElementById('sqlitePath').value = message.path;
                    break;
            }
        });

        // Initialize with current type
        selectDbType('${this._escapeHtml(config?.type || 'mysql')}');
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
