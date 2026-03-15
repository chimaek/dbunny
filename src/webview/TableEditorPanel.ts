import * as vscode from 'vscode';
import { ConnectionManager } from '../managers/connectionManager';
import { I18n } from '../utils/i18n';
import { QueryResult } from '../types/database';
import { checkWriteOperation } from '../utils/readOnlyGuard';

/**
 * Webview panel for editing table data
 */
export class TableEditorPanel {
    public static currentPanel: TableEditorPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];
    private _tableName: string;
    private _databaseName: string;
    private _dbType: string = 'mysql';

    private constructor(
        panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri,
        private connectionManager: ConnectionManager,
        private i18n: I18n,
        tableName: string,
        databaseName: string
    ) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._tableName = tableName;
        this._databaseName = databaseName;

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.webview.onDidReceiveMessage(
            async (message) => {
                // 읽기 전용 모드에서 쓰기 작업 차단
                const writeCommands = ['insert', 'update', 'delete'];
                if (writeCommands.includes(message.command)) {
                    const conn = this.connectionManager.getActiveConnection();
                    if (conn?.config.readOnly) {
                        vscode.window.showWarningMessage(
                            this.i18n.t('readOnly.tableEditorBlocked', { name: conn.config.name })
                        );
                        return;
                    }
                }
                if (message.command === 'executeCustom') {
                    const conn = this.connectionManager.getActiveConnection();
                    if (conn?.config.readOnly) {
                        const check = checkWriteOperation(message.query, conn.config.type);
                        if (check.isWrite) {
                            vscode.window.showWarningMessage(
                                this.i18n.t('readOnly.blocked', { keyword: check.keyword!, name: conn.config.name })
                            );
                            return;
                        }
                    }
                }

                switch (message.command) {
                    case 'refresh':
                        await this._loadData();
                        break;
                    case 'insert':
                        await this._handleInsert(message.data);
                        break;
                    case 'update':
                        await this._handleUpdate(message.data);
                        break;
                    case 'delete':
                        await this._handleDelete(message.data);
                        break;
                    case 'executeCustom':
                        await this._handleCustomQuery(message.query);
                        break;
                }
            },
            null,
            this._disposables
        );

        this._loadData();
    }

    /**
     * Create or show the table editor panel
     */
    public static async createOrShow(
        extensionUri: vscode.Uri,
        connectionManager: ConnectionManager,
        i18n: I18n,
        tableName: string,
        databaseName: string
    ): Promise<void> {
        const column = vscode.ViewColumn.One;

        if (TableEditorPanel.currentPanel) {
            TableEditorPanel.currentPanel._panel.reveal(column);
            TableEditorPanel.currentPanel._tableName = tableName;
            TableEditorPanel.currentPanel._databaseName = databaseName;
            await TableEditorPanel.currentPanel._loadData();
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'dbunnyTableEditor',
            `Table: ${tableName}`,
            column,
            {
                enableScripts: true,
                localResourceRoots: [extensionUri],
                retainContextWhenHidden: true
            }
        );

        TableEditorPanel.currentPanel = new TableEditorPanel(
            panel,
            extensionUri,
            connectionManager,
            i18n,
            tableName,
            databaseName
        );
    }

    private async _loadData(): Promise<void> {
        try {
            const connection = this.connectionManager.getActiveConnection();
            if (!connection) {
                this._showError('No active connection');
                return;
            }

            // Get database type for proper identifier escaping
            this._dbType = connection.config.type;

            // Get schema with database context
            const schema = await connection.getTableSchema(this._tableName, this._databaseName);

            // Get data (limited to 100 rows for performance) with database context
            const result = await connection.executeQuery(
                `SELECT * FROM ${this._escapeIdentifier(this._tableName)} LIMIT 100`,
                this._databaseName
            );

            this._panel.title = `Table: ${this._tableName}`;
            this._panel.webview.html = this._getHtmlContent(schema, result);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            this._showError(message);
        }
    }

    private async _handleInsert(data: Record<string, unknown>): Promise<void> {
        try {
            const connection = this.connectionManager.getActiveConnection();
            if (!connection) { throw new Error('No active connection'); }

            const columns = Object.keys(data).filter(k => data[k] !== undefined && data[k] !== '');
            const values = columns.map(k => this._escapeValue(data[k]));

            const query = `INSERT INTO ${this._escapeIdentifier(this._tableName)} (${columns.map(c => this._escapeIdentifier(c)).join(', ')}) VALUES (${values.join(', ')})`;

            await connection.executeQuery(query, this._databaseName);
            vscode.window.showInformationMessage('Row inserted successfully');
            await this._loadData();
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            vscode.window.showErrorMessage(`Insert failed: ${message}`);
        }
    }

    private async _handleUpdate(data: { where: Record<string, unknown>; set: Record<string, unknown> }): Promise<void> {
        try {
            const connection = this.connectionManager.getActiveConnection();
            if (!connection) { throw new Error('No active connection'); }

            const setClauses = Object.entries(data.set)
                .map(([k, v]) => `${this._escapeIdentifier(k)} = ${this._escapeValue(v)}`)
                .join(', ');

            const whereClauses = Object.entries(data.where)
                .map(([k, v]) => `${this._escapeIdentifier(k)} = ${this._escapeValue(v)}`)
                .join(' AND ');

            const query = `UPDATE ${this._escapeIdentifier(this._tableName)} SET ${setClauses} WHERE ${whereClauses}`;

            await connection.executeQuery(query, this._databaseName);
            vscode.window.showInformationMessage('Row updated successfully');
            await this._loadData();
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            vscode.window.showErrorMessage(`Update failed: ${message}`);
        }
    }

    private async _handleDelete(where: Record<string, unknown>): Promise<void> {
        try {
            const connection = this.connectionManager.getActiveConnection();
            if (!connection) { throw new Error('No active connection'); }

            const whereClauses = Object.entries(where)
                .map(([k, v]) => `${this._escapeIdentifier(k)} = ${this._escapeValue(v)}`)
                .join(' AND ');

            const query = `DELETE FROM ${this._escapeIdentifier(this._tableName)} WHERE ${whereClauses}`;

            await connection.executeQuery(query, this._databaseName);
            vscode.window.showInformationMessage('Row deleted successfully');
            await this._loadData();
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            vscode.window.showErrorMessage(`Delete failed: ${message}`);
        }
    }

    private async _handleCustomQuery(query: string): Promise<void> {
        try {
            const connection = this.connectionManager.getActiveConnection();
            if (!connection) { throw new Error('No active connection'); }

            await connection.executeQuery(query, this._databaseName);
            vscode.window.showInformationMessage('Query executed successfully');
            await this._loadData();
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            vscode.window.showErrorMessage(`Query failed: ${message}`);
        }
    }

    private _escapeIdentifier(name: string): string {
        // Different databases use different identifier quoting
        switch (this._dbType) {
            case 'postgres':
                // PostgreSQL uses double quotes
                // Handle schema.table format
                if (name.includes('.')) {
                    const parts = name.split('.');
                    return parts.map(p => `"${p.replace(/"/g, '""')}"`).join('.');
                }
                return `"${name.replace(/"/g, '""')}"`;
            case 'mysql':
                // MySQL uses backticks
                return `\`${name.replace(/`/g, '``')}\``;
            case 'sqlite':
                // SQLite accepts double quotes or brackets
                return `"${name.replace(/"/g, '""')}"`;
            case 'mongodb':
            case 'redis':
                // NoSQL - no escaping needed
                return name;
            default:
                // Default to double quotes (ANSI SQL standard)
                return `"${name.replace(/"/g, '""')}"`;
        }
    }

    private _escapeValue(value: unknown): string {
        if (value === null || value === undefined) {return 'NULL';}
        if (typeof value === 'number') {return String(value);}
        if (typeof value === 'boolean') {return value ? '1' : '0';}
        return `'${String(value).replace(/'/g, "''")}'`;
    }

    private _showError(message: string): void {
        this._panel.webview.html = `
<!DOCTYPE html>
<html>
<head>
    <style>
        html { font-size: var(--vscode-font-size, 13px); }
        body { font-family: var(--vscode-font-family); padding: 1.5rem; color: var(--vscode-foreground); background: var(--vscode-editor-background); }
        .error { color: var(--vscode-errorForeground); padding: 1.5rem; background: var(--vscode-inputValidation-errorBackground); border-radius: 0.3rem; font-size: 1rem; }
    </style>
</head>
<body>
    <div class="error">Error: ${this._escapeHtml(message)}</div>
</body>
</html>`;
    }

    private _getHtmlContent(schema: any[], result: QueryResult): string {
        const columns = schema.map(col => col.name);
        const primaryKeys = schema.filter(col => col.primaryKey).map(col => col.name);

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Table Editor</title>
    <style>
        * { box-sizing: border-box; }
        html {
            font-size: var(--vscode-font-size, 13px);
        }
        body {
            font-family: var(--vscode-font-family);
            padding: 0;
            margin: 0;
            color: var(--vscode-foreground);
            background: var(--vscode-editor-background);
            font-size: 1rem;
        }
        .toolbar {
            padding: 0.9rem 1.25rem;
            background: var(--vscode-sideBar-background);
            border-bottom: 1px solid var(--vscode-panel-border);
            display: flex;
            gap: 0.5rem;
            align-items: center;
            position: sticky;
            top: 0;
            z-index: 100;
        }
        .toolbar h3 {
            margin: 0;
            flex: 1;
            font-size: 1.1rem;
        }
        button {
            padding: 0.4rem 0.9rem;
            border: none;
            border-radius: 0.25rem;
            cursor: pointer;
            font-size: 0.9rem;
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        button:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }
        button.primary {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        button.danger {
            background: var(--vscode-inputValidation-errorBackground);
            color: var(--vscode-errorForeground);
        }
        .table-container {
            overflow: auto;
            max-height: calc(100vh - 9rem);
        }
        table {
            width: 100%;
            border-collapse: collapse;
            font-size: 0.9rem;
        }
        th, td {
            padding: 0.5rem 0.9rem;
            text-align: left;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        th {
            position: sticky;
            top: 0;
            background: var(--vscode-editorWidget-background);
            font-weight: 600;
        }
        th.pk::after {
            content: ' (PK)';
            color: var(--vscode-descriptionForeground);
            font-size: 0.75rem;
        }
        tr:hover td {
            background: var(--vscode-list-hoverBackground);
        }
        tr.selected td {
            background: var(--vscode-list-activeSelectionBackground);
        }
        td input {
            width: 100%;
            padding: 0.25rem 0.4rem;
            border: 1px solid var(--vscode-input-border);
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 0.125rem;
            font-size: 0.9rem;
        }
        .null {
            color: var(--vscode-descriptionForeground);
            font-style: italic;
        }
        .actions {
            white-space: nowrap;
        }
        .actions button {
            padding: 0.25rem 0.5rem;
            margin-right: 0.25rem;
        }
        .modal {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0,0,0,0.5);
            z-index: 200;
            justify-content: center;
            align-items: center;
        }
        .modal.show {
            display: flex;
        }
        .modal-content {
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 0.5rem;
            padding: 1.5rem;
            min-width: 30rem;
            max-height: 80vh;
            overflow-y: auto;
        }
        .modal-content h3 {
            margin-top: 0;
            font-size: 1.25rem;
        }
        .form-group {
            margin-bottom: 0.9rem;
        }
        .form-group label {
            display: block;
            margin-bottom: 0.25rem;
            font-weight: 500;
            font-size: 1rem;
        }
        .form-group input {
            width: 100%;
            padding: 0.5rem;
            border: 1px solid var(--vscode-input-border);
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 0.25rem;
            font-size: 1rem;
        }
        .modal-buttons {
            display: flex;
            gap: 0.5rem;
            justify-content: flex-end;
            margin-top: 1.25rem;
        }
        .row-count {
            color: var(--vscode-descriptionForeground);
            font-size: 0.9rem;
        }
    </style>
</head>
<body>
    <div class="toolbar">
        <h3>${this._escapeHtml(this._tableName)}</h3>
        <span class="row-count">${result.rowCount} rows</span>
        <button onclick="refresh()">Refresh</button>
        <button class="primary" onclick="showInsertModal()">+ Insert Row</button>
    </div>

    <div class="table-container">
        <table>
            <thead>
                <tr>
                    ${columns.map(col =>
                        `<th class="${primaryKeys.includes(col) ? 'pk' : ''}">${this._escapeHtml(col)}</th>`
                    ).join('')}
                    <th>Actions</th>
                </tr>
            </thead>
            <tbody>
                ${result.rows.map((row, idx) => `
                <tr data-idx="${idx}">
                    ${columns.map(col => {
                        const val = row[col];
                        const display = val === null ? '<span class="null">NULL</span>'
                            : val === undefined ? '<span class="null">undefined</span>'
                            : this._escapeHtml(String(val));
                        return `<td data-col="${col}" data-value="${this._escapeHtml(String(val ?? ''))}">${display}</td>`;
                    }).join('')}
                    <td class="actions">
                        <button onclick="editRow(${idx})">Edit</button>
                        <button class="danger" onclick="deleteRow(${idx})">Delete</button>
                    </td>
                </tr>
                `).join('')}
            </tbody>
        </table>
    </div>

    <!-- Insert Modal -->
    <div id="insertModal" class="modal">
        <div class="modal-content">
            <h3>Insert New Row</h3>
            <form id="insertForm">
                ${columns.map(col => `
                <div class="form-group">
                    <label>${this._escapeHtml(col)}${primaryKeys.includes(col) ? ' (PK)' : ''}</label>
                    <input type="text" name="${col}" placeholder="Enter value...">
                </div>
                `).join('')}
                <div class="modal-buttons">
                    <button type="button" onclick="closeModal('insertModal')">Cancel</button>
                    <button type="submit" class="primary">Insert</button>
                </div>
            </form>
        </div>
    </div>

    <!-- Edit Modal -->
    <div id="editModal" class="modal">
        <div class="modal-content">
            <h3>Edit Row</h3>
            <form id="editForm">
                ${columns.map(col => `
                <div class="form-group">
                    <label>${this._escapeHtml(col)}${primaryKeys.includes(col) ? ' (PK - readonly)' : ''}</label>
                    <input type="text" name="${col}" ${primaryKeys.includes(col) ? 'readonly' : ''}>
                </div>
                `).join('')}
                <div class="modal-buttons">
                    <button type="button" onclick="closeModal('editModal')">Cancel</button>
                    <button type="submit" class="primary">Update</button>
                </div>
            </form>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        const columns = ${JSON.stringify(columns)};
        const primaryKeys = ${JSON.stringify(primaryKeys)};
        const rows = ${JSON.stringify(result.rows)};
        let editingRowIdx = -1;

        function refresh() {
            vscode.postMessage({ command: 'refresh' });
        }

        function showInsertModal() {
            document.getElementById('insertForm').reset();
            document.getElementById('insertModal').classList.add('show');
        }

        function closeModal(id) {
            document.getElementById(id).classList.remove('show');
        }

        function editRow(idx) {
            editingRowIdx = idx;
            const row = rows[idx];
            const form = document.getElementById('editForm');
            columns.forEach(col => {
                const input = form.querySelector(\`[name="\${col}"]\`);
                if (input) input.value = row[col] ?? '';
            });
            document.getElementById('editModal').classList.add('show');
        }

        function deleteRow(idx) {
            if (!confirm('Are you sure you want to delete this row?')) return;
            const row = rows[idx];
            const where = {};
            primaryKeys.forEach(pk => where[pk] = row[pk]);
            if (Object.keys(where).length === 0) {
                columns.forEach(col => where[col] = row[col]);
            }
            vscode.postMessage({ command: 'delete', data: where });
        }

        document.getElementById('insertForm').addEventListener('submit', (e) => {
            e.preventDefault();
            const formData = new FormData(e.target);
            const data = {};
            columns.forEach(col => {
                const val = formData.get(col);
                if (val !== '') data[col] = val;
            });
            vscode.postMessage({ command: 'insert', data });
            closeModal('insertModal');
        });

        document.getElementById('editForm').addEventListener('submit', (e) => {
            e.preventDefault();
            const formData = new FormData(e.target);
            const row = rows[editingRowIdx];
            const where = {};
            primaryKeys.forEach(pk => where[pk] = row[pk]);
            if (Object.keys(where).length === 0) {
                columns.forEach(col => where[col] = row[col]);
            }
            const set = {};
            columns.forEach(col => {
                if (!primaryKeys.includes(col)) {
                    set[col] = formData.get(col);
                }
            });
            vscode.postMessage({ command: 'update', data: { where, set } });
            closeModal('editModal');
        });

        // Close modal on backdrop click
        document.querySelectorAll('.modal').forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) closeModal(modal.id);
            });
        });
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
        TableEditorPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const disposable = this._disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }
}
