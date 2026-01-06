import * as vscode from 'vscode';
import { I18n } from '../utils/i18n';

export interface Migration {
    id: string;
    version: string;
    name: string;
    description: string;
    upScript: string;
    downScript: string;
    createdAt: Date;
    appliedAt?: Date;
    status: 'pending' | 'applied' | 'rolled_back';
}

/**
 * Webview panel for database migrations
 */
export class MigrationPanel {
    public static currentPanel: MigrationPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];
    private _migrations: Migration[] = [];
    private _context: vscode.ExtensionContext;

    private constructor(
        panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri,
        private i18n: I18n,
        context: vscode.ExtensionContext
    ) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._context = context;

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'createMigration': {
                        await this._createMigration(message.name, message.description);
                        break;
                    }
                    case 'applyMigration': {
                        await this._applyMigration(message.id);
                        break;
                    }
                    case 'rollbackMigration': {
                        await this._rollbackMigration(message.id);
                        break;
                    }
                    case 'deleteMigration': {
                        await this._deleteMigration(message.id);
                        break;
                    }
                    case 'exportMigration': {
                        await this._exportMigration(message.id);
                        break;
                    }
                    case 'updateScript': {
                        await this._updateScript(message.id, message.scriptType, message.script);
                        break;
                    }
                    case 'refresh': {
                        this._updatePanel();
                        break;
                    }
                }
            },
            null,
            this._disposables
        );

        // Load migrations from storage
        this._loadMigrations();
    }

    public static createOrShow(
        extensionUri: vscode.Uri,
        i18n: I18n,
        context: vscode.ExtensionContext
    ): MigrationPanel {
        const column = vscode.ViewColumn.One;

        if (MigrationPanel.currentPanel) {
            MigrationPanel.currentPanel._panel.reveal(column);
            return MigrationPanel.currentPanel;
        }

        const panel = vscode.window.createWebviewPanel(
            'dbunnyMigration',
            'DB Migration',
            column,
            {
                enableScripts: true,
                localResourceRoots: [extensionUri],
                retainContextWhenHidden: true
            }
        );

        MigrationPanel.currentPanel = new MigrationPanel(panel, extensionUri, i18n, context);
        return MigrationPanel.currentPanel;
    }

    public setDatabaseName(dbName: string): void {
        this._updatePanel();
    }

    private _loadMigrations(): void {
        this._migrations = this._context.globalState.get<Migration[]>('dbunny.migrations', []);
        this._updatePanel();
    }

    private async _saveMigrations(): Promise<void> {
        await this._context.globalState.update('dbunny.migrations', this._migrations);
    }

    private async _createMigration(name: string, description: string): Promise<void> {
        const version = this._generateVersion();
        const migration: Migration = {
            id: `${Date.now()}`,
            version,
            name,
            description,
            upScript: `-- Migration: ${name}\n-- Version: ${version}\n-- Description: ${description}\n\n-- Add your UP migration SQL here\n`,
            downScript: `-- Rollback: ${name}\n-- Version: ${version}\n\n-- Add your DOWN migration SQL here\n`,
            createdAt: new Date(),
            status: 'pending'
        };

        this._migrations.push(migration);
        await this._saveMigrations();
        this._updatePanel();
        vscode.window.showInformationMessage(this.i18n.t('migration.created', { name }));
    }

    private async _applyMigration(id: string): Promise<void> {
        const migration = this._migrations.find(m => m.id === id);
        if (!migration) { return; }

        migration.status = 'applied';
        migration.appliedAt = new Date();
        await this._saveMigrations();
        this._updatePanel();
        vscode.window.showInformationMessage(this.i18n.t('migration.applied', { name: migration.name }));
    }

    private async _rollbackMigration(id: string): Promise<void> {
        const migration = this._migrations.find(m => m.id === id);
        if (!migration) { return; }

        migration.status = 'rolled_back';
        migration.appliedAt = undefined;
        await this._saveMigrations();
        this._updatePanel();
        vscode.window.showInformationMessage(this.i18n.t('migration.rolledBack', { name: migration.name }));
    }

    private async _deleteMigration(id: string): Promise<void> {
        const migration = this._migrations.find(m => m.id === id);
        if (!migration) { return; }

        this._migrations = this._migrations.filter(m => m.id !== id);
        await this._saveMigrations();
        this._updatePanel();
        vscode.window.showInformationMessage(this.i18n.t('migration.deleted', { name: migration.name }));
    }

    private async _exportMigration(id: string): Promise<void> {
        const migration = this._migrations.find(m => m.id === id);
        if (!migration) { return; }

        const content = `-- ============================================
-- Migration: ${migration.name}
-- Version: ${migration.version}
-- Created: ${migration.createdAt}
-- Description: ${migration.description}
-- ============================================

-- UP Migration
${migration.upScript}

-- ============================================
-- DOWN Migration (Rollback)
-- ============================================

${migration.downScript}
`;

        const uri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(`migration_${migration.version}_${migration.name.replace(/\s+/g, '_')}.sql`),
            filters: {
                'SQL Files': ['sql'],
                'All Files': ['*']
            }
        });

        if (!uri) { return; }

        await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
        vscode.window.showInformationMessage(this.i18n.t('migration.exported', { path: uri.fsPath }));
    }

    private async _updateScript(id: string, scriptType: 'up' | 'down', script: string): Promise<void> {
        const migration = this._migrations.find(m => m.id === id);
        if (!migration) { return; }

        if (scriptType === 'up') {
            migration.upScript = script;
        } else {
            migration.downScript = script;
        }
        await this._saveMigrations();
    }

    private _generateVersion(): string {
        const now = new Date();
        return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
    }

    private _updatePanel(): void {
        this._panel.webview.html = this._getHtmlContent();
    }

    private _getHtmlContent(): string {
        const migrationsJson = JSON.stringify(this._migrations.map(m => ({
            ...m,
            createdAt: m.createdAt instanceof Date ? m.createdAt.toISOString() : m.createdAt,
            appliedAt: m.appliedAt instanceof Date ? m.appliedAt.toISOString() : m.appliedAt
        })));

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>DB Migration</title>
    <style>
        :root {
            --bg-color: var(--vscode-editor-background);
            --text-color: var(--vscode-foreground);
            --border-color: var(--vscode-panel-border);
            --success-color: #28a745;
            --warning-color: #ffc107;
            --danger-color: #dc3545;
        }

        * { box-sizing: border-box; margin: 0; padding: 0; }

        body {
            font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
            background: var(--bg-color);
            color: var(--text-color);
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
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }

        .content {
            padding: 20px;
        }

        .stats {
            display: flex;
            gap: 16px;
            margin-bottom: 24px;
        }

        .stat-card {
            flex: 1;
            padding: 16px;
            background: var(--vscode-editorWidget-background);
            border: 1px solid var(--border-color);
            border-radius: 8px;
            text-align: center;
        }

        .stat-value {
            font-size: 28px;
            font-weight: bold;
        }

        .stat-value.success { color: var(--success-color); }
        .stat-value.warning { color: var(--warning-color); }
        .stat-value.danger { color: var(--danger-color); }

        .stat-label {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            margin-top: 4px;
        }

        .migration-list {
            display: flex;
            flex-direction: column;
            gap: 12px;
        }

        .migration-card {
            background: var(--vscode-editorWidget-background);
            border: 1px solid var(--border-color);
            border-radius: 8px;
            overflow: hidden;
        }

        .migration-header {
            padding: 12px 16px;
            display: flex;
            align-items: center;
            gap: 12px;
            cursor: pointer;
            border-bottom: 1px solid var(--border-color);
        }

        .migration-header:hover {
            background: var(--vscode-list-hoverBackground);
        }

        .migration-version {
            font-family: var(--vscode-editor-font-family, monospace);
            font-size: 11px;
            padding: 2px 8px;
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            border-radius: 4px;
        }

        .migration-name {
            font-weight: 600;
            flex: 1;
        }

        .migration-status {
            font-size: 11px;
            padding: 2px 8px;
            border-radius: 4px;
        }

        .migration-status.pending {
            background: rgba(255, 193, 7, 0.2);
            color: var(--warning-color);
        }

        .migration-status.applied {
            background: rgba(40, 167, 69, 0.2);
            color: var(--success-color);
        }

        .migration-status.rolled_back {
            background: rgba(220, 53, 69, 0.2);
            color: var(--danger-color);
        }

        .migration-body {
            padding: 16px;
            display: none;
        }

        .migration-body.expanded {
            display: block;
        }

        .migration-desc {
            color: var(--vscode-descriptionForeground);
            margin-bottom: 12px;
        }

        .migration-meta {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            margin-bottom: 16px;
        }

        .script-tabs {
            display: flex;
            gap: 4px;
            margin-bottom: 8px;
        }

        .script-tab {
            padding: 6px 12px;
            background: transparent;
            border: 1px solid var(--border-color);
            border-bottom: none;
            border-radius: 4px 4px 0 0;
            cursor: pointer;
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
        }

        .script-tab.active {
            background: var(--vscode-input-background);
            color: var(--text-color);
        }

        .script-editor {
            width: 100%;
            min-height: 150px;
            padding: 12px;
            background: var(--vscode-input-background);
            border: 1px solid var(--border-color);
            border-radius: 0 4px 4px 4px;
            color: var(--text-color);
            font-family: var(--vscode-editor-font-family, monospace);
            font-size: 12px;
            resize: vertical;
        }

        .migration-actions {
            display: flex;
            gap: 8px;
            margin-top: 16px;
            padding-top: 16px;
            border-top: 1px solid var(--border-color);
        }

        .action-btn {
            padding: 6px 12px;
            border: 1px solid var(--border-color);
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
            display: flex;
            align-items: center;
            gap: 4px;
        }

        .action-btn.apply {
            background: var(--success-color);
            color: white;
            border-color: var(--success-color);
        }

        .action-btn.rollback {
            background: var(--warning-color);
            color: black;
            border-color: var(--warning-color);
        }

        .action-btn.delete {
            background: var(--danger-color);
            color: white;
            border-color: var(--danger-color);
        }

        .action-btn.export {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }

        .empty-state {
            text-align: center;
            padding: 60px 20px;
            color: var(--vscode-descriptionForeground);
        }

        .empty-state .icon {
            font-size: 48px;
            margin-bottom: 16px;
        }

        /* Modal */
        .modal-overlay {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.5);
            display: none;
            align-items: center;
            justify-content: center;
            z-index: 1000;
        }

        .modal-overlay.show {
            display: flex;
        }

        .modal {
            background: var(--vscode-editorWidget-background);
            border: 1px solid var(--border-color);
            border-radius: 8px;
            padding: 24px;
            width: 400px;
            max-width: 90%;
        }

        .modal-title {
            font-size: 16px;
            font-weight: 600;
            margin-bottom: 16px;
        }

        .form-group {
            margin-bottom: 16px;
        }

        .form-label {
            display: block;
            font-size: 12px;
            margin-bottom: 4px;
        }

        .form-input {
            width: 100%;
            padding: 8px;
            background: var(--vscode-input-background);
            border: 1px solid var(--border-color);
            border-radius: 4px;
            color: var(--text-color);
            font-size: 13px;
        }

        .modal-actions {
            display: flex;
            gap: 8px;
            justify-content: flex-end;
            margin-top: 20px;
        }
    </style>
</head>
<body>
    <div class="toolbar">
        <div class="toolbar-title">
            <span>📦</span>
            <span>DB Migration Manager</span>
        </div>
        <div class="toolbar-spacer"></div>
        <button class="toolbar-btn" onclick="refresh()">
            <span>🔄</span> Refresh
        </button>
        <button class="toolbar-btn primary" onclick="showCreateModal()">
            <span>➕</span> New Migration
        </button>
    </div>

    <div class="content">
        <div class="stats">
            <div class="stat-card">
                <div class="stat-value" id="totalCount">0</div>
                <div class="stat-label">Total Migrations</div>
            </div>
            <div class="stat-card">
                <div class="stat-value success" id="appliedCount">0</div>
                <div class="stat-label">Applied</div>
            </div>
            <div class="stat-card">
                <div class="stat-value warning" id="pendingCount">0</div>
                <div class="stat-label">Pending</div>
            </div>
            <div class="stat-card">
                <div class="stat-value danger" id="rolledBackCount">0</div>
                <div class="stat-label">Rolled Back</div>
            </div>
        </div>

        <div class="migration-list" id="migrationList">
        </div>
    </div>

    <div class="modal-overlay" id="createModal">
        <div class="modal">
            <div class="modal-title">Create New Migration</div>
            <div class="form-group">
                <label class="form-label">Migration Name</label>
                <input type="text" class="form-input" id="migrationName" placeholder="e.g., add_users_table">
            </div>
            <div class="form-group">
                <label class="form-label">Description</label>
                <input type="text" class="form-input" id="migrationDesc" placeholder="e.g., Create users table with basic fields">
            </div>
            <div class="modal-actions">
                <button class="toolbar-btn" onclick="hideCreateModal()">Cancel</button>
                <button class="toolbar-btn primary" onclick="createMigration()">Create</button>
            </div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let migrations = ${migrationsJson};
        let expandedIds = new Set();
        let activeScripts = {};

        function init() {
            updateStats();
            renderMigrations();
        }

        function updateStats() {
            document.getElementById('totalCount').textContent = migrations.length;
            document.getElementById('appliedCount').textContent = migrations.filter(m => m.status === 'applied').length;
            document.getElementById('pendingCount').textContent = migrations.filter(m => m.status === 'pending').length;
            document.getElementById('rolledBackCount').textContent = migrations.filter(m => m.status === 'rolled_back').length;
        }

        function renderMigrations() {
            const list = document.getElementById('migrationList');

            if (migrations.length === 0) {
                list.innerHTML = \`
                    <div class="empty-state">
                        <div class="icon">📭</div>
                        <div>No migrations yet</div>
                        <div style="margin-top: 8px; font-size: 12px;">Click "New Migration" to create your first migration</div>
                    </div>
                \`;
                return;
            }

            // Sort by version descending
            const sorted = [...migrations].sort((a, b) => b.version.localeCompare(a.version));

            list.innerHTML = sorted.map(m => {
                const isExpanded = expandedIds.has(m.id);
                const activeScript = activeScripts[m.id] || 'up';

                return \`
                    <div class="migration-card">
                        <div class="migration-header" onclick="toggleMigration('\${m.id}')">
                            <span class="migration-version">v\${m.version}</span>
                            <span class="migration-name">\${escapeHtml(m.name)}</span>
                            <span class="migration-status \${m.status}">\${m.status.replace('_', ' ').toUpperCase()}</span>
                        </div>
                        <div class="migration-body \${isExpanded ? 'expanded' : ''}">
                            <div class="migration-desc">\${escapeHtml(m.description || 'No description')}</div>
                            <div class="migration-meta">
                                Created: \${formatDate(m.createdAt)}
                                \${m.appliedAt ? ' | Applied: ' + formatDate(m.appliedAt) : ''}
                            </div>
                            <div class="script-tabs">
                                <button class="script-tab \${activeScript === 'up' ? 'active' : ''}"
                                        onclick="setActiveScript('\${m.id}', 'up')">⬆️ UP Migration</button>
                                <button class="script-tab \${activeScript === 'down' ? 'active' : ''}"
                                        onclick="setActiveScript('\${m.id}', 'down')">⬇️ DOWN Rollback</button>
                            </div>
                            <textarea class="script-editor"
                                      id="script-\${m.id}"
                                      onchange="saveScript('\${m.id}', '\${activeScript}')">\${escapeHtml(activeScript === 'up' ? m.upScript : m.downScript)}</textarea>
                            <div class="migration-actions">
                                \${m.status === 'pending' ? \`
                                    <button class="action-btn apply" onclick="applyMigration('\${m.id}')">
                                        ▶️ Apply
                                    </button>
                                \` : ''}
                                \${m.status === 'applied' ? \`
                                    <button class="action-btn rollback" onclick="rollbackMigration('\${m.id}')">
                                        ↩️ Rollback
                                    </button>
                                \` : ''}
                                <button class="action-btn export" onclick="exportMigration('\${m.id}')">
                                    📄 Export
                                </button>
                                <button class="action-btn delete" onclick="deleteMigration('\${m.id}')">
                                    🗑️ Delete
                                </button>
                            </div>
                        </div>
                    </div>
                \`;
            }).join('');
        }

        function toggleMigration(id) {
            if (expandedIds.has(id)) {
                expandedIds.delete(id);
            } else {
                expandedIds.add(id);
            }
            renderMigrations();
        }

        function setActiveScript(id, type) {
            activeScripts[id] = type;
            renderMigrations();
        }

        function saveScript(id, type) {
            const script = document.getElementById('script-' + id).value;
            vscode.postMessage({ command: 'updateScript', id, scriptType: type, script });
        }

        function showCreateModal() {
            document.getElementById('createModal').classList.add('show');
            document.getElementById('migrationName').focus();
        }

        function hideCreateModal() {
            document.getElementById('createModal').classList.remove('show');
            document.getElementById('migrationName').value = '';
            document.getElementById('migrationDesc').value = '';
        }

        function createMigration() {
            const name = document.getElementById('migrationName').value.trim();
            const description = document.getElementById('migrationDesc').value.trim();

            if (!name) {
                alert('Please enter a migration name');
                return;
            }

            vscode.postMessage({ command: 'createMigration', name, description });
            hideCreateModal();
        }

        function applyMigration(id) {
            if (confirm('Apply this migration?')) {
                vscode.postMessage({ command: 'applyMigration', id });
            }
        }

        function rollbackMigration(id) {
            if (confirm('Rollback this migration?')) {
                vscode.postMessage({ command: 'rollbackMigration', id });
            }
        }

        function deleteMigration(id) {
            if (confirm('Delete this migration? This cannot be undone.')) {
                vscode.postMessage({ command: 'deleteMigration', id });
            }
        }

        function exportMigration(id) {
            vscode.postMessage({ command: 'exportMigration', id });
        }

        function refresh() {
            vscode.postMessage({ command: 'refresh' });
        }

        function formatDate(dateStr) {
            const date = new Date(dateStr);
            return date.toLocaleString();
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
        MigrationPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const disposable = this._disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }
}
