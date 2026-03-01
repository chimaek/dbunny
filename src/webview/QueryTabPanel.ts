import * as vscode from 'vscode';
import { ConnectionManager } from '../managers/connectionManager';
import { I18n } from '../utils/i18n';
import { QueryHistoryProvider } from '../views/queryHistoryView';

interface QueryTab {
    id: string;
    name: string;
    query: string;
    connectionId: string | null;
    connectionName: string;
    results: QueryResult | null;
    isExecuting: boolean;
    error: string | null;
}

interface QueryResult {
    columns: string[];
    rows: Record<string, unknown>[];
    rowCount: number;
    executionTime: number;
}

export class QueryTabPanel {
    public static currentPanel: QueryTabPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];
    private _tabs: QueryTab[] = [];
    private _activeTabId: string | null = null;
    private _tabCounter = 0;

    private constructor(
        panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri,
        private _connectionManager: ConnectionManager,
        private _i18n: I18n,
        private _queryHistoryProvider: QueryHistoryProvider
    ) {
        this._panel = panel;
        this._extensionUri = extensionUri;

        // Create initial tab
        this._createNewTab();

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'newTab': {
                        this._createNewTab();
                        break;
                    }
                    case 'closeTab': {
                        this._closeTab(message.tabId);
                        break;
                    }
                    case 'switchTab': {
                        this._switchTab(message.tabId);
                        break;
                    }
                    case 'renameTab': {
                        this._renameTab(message.tabId, message.name);
                        break;
                    }
                    case 'updateQuery': {
                        this._updateQuery(message.tabId, message.query);
                        break;
                    }
                    case 'setConnection': {
                        await this._setTabConnection(message.tabId, message.connectionId);
                        break;
                    }
                    case 'executeQuery': {
                        await this._executeQuery(message.tabId);
                        break;
                    }
                    case 'getConnections': {
                        this._sendConnections();
                        break;
                    }
                    case 'formatQuery': {
                        await this._formatQuery(message.tabId);
                        break;
                    }
                    case 'clearResults': {
                        this._clearResults(message.tabId);
                        break;
                    }
                }
            },
            null,
            this._disposables
        );

        this._update();
    }

    public static createOrShow(
        extensionUri: vscode.Uri,
        connectionManager: ConnectionManager,
        i18n: I18n,
        queryHistoryProvider: QueryHistoryProvider
    ): QueryTabPanel {
        const column = vscode.ViewColumn.One;

        if (QueryTabPanel.currentPanel) {
            QueryTabPanel.currentPanel._panel.reveal(column);
            return QueryTabPanel.currentPanel;
        }

        const panel = vscode.window.createWebviewPanel(
            'dbunnyQueryTabs',
            'Query Editor',
            column,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [extensionUri]
            }
        );

        QueryTabPanel.currentPanel = new QueryTabPanel(
            panel,
            extensionUri,
            connectionManager,
            i18n,
            queryHistoryProvider
        );
        return QueryTabPanel.currentPanel;
    }

    public addNewTab(): void {
        this._createNewTab();
    }

    private _createNewTab(): void {
        this._tabCounter++;
        const tab: QueryTab = {
            id: `tab-${Date.now()}-${this._tabCounter}`,
            name: `Query ${this._tabCounter}`,
            query: '-- Write your SQL query here\n\n',
            connectionId: null,
            connectionName: 'No Connection',
            results: null,
            isExecuting: false,
            error: null
        };

        // Try to set active connection
        const activeConnection = this._connectionManager.getActiveConnection();
        if (activeConnection) {
            tab.connectionId = activeConnection.config.id;
            tab.connectionName = activeConnection.config.name;
        }

        this._tabs.push(tab);
        this._activeTabId = tab.id;
        this._update();
    }

    private _closeTab(tabId: string): void {
        const index = this._tabs.findIndex(t => t.id === tabId);
        if (index === -1) { return; }

        this._tabs.splice(index, 1);

        if (this._tabs.length === 0) {
            this._createNewTab();
        } else if (this._activeTabId === tabId) {
            this._activeTabId = this._tabs[Math.min(index, this._tabs.length - 1)].id;
        }

        this._update();
    }

    private _switchTab(tabId: string): void {
        if (this._tabs.some(t => t.id === tabId)) {
            this._activeTabId = tabId;
            this._update();
        }
    }

    private _renameTab(tabId: string, name: string): void {
        const tab = this._tabs.find(t => t.id === tabId);
        if (tab) {
            tab.name = name;
            this._update();
        }
    }

    private _updateQuery(tabId: string, query: string): void {
        const tab = this._tabs.find(t => t.id === tabId);
        if (tab) {
            tab.query = query;
        }
    }

    private async _setTabConnection(tabId: string, connectionId: string): Promise<void> {
        const tab = this._tabs.find(t => t.id === tabId);
        if (!tab) { return; }

        if (!connectionId) {
            tab.connectionId = null;
            tab.connectionName = 'No Connection';
        } else {
            const connection = this._connectionManager.getConnection(connectionId);
            if (connection) {
                tab.connectionId = connectionId;
                tab.connectionName = connection.config.name;

                // Connect if not connected
                if (!connection.isConnected()) {
                    try {
                        await this._connectionManager.connect(connectionId);
                    } catch (error) {
                        vscode.window.showErrorMessage(
                            this._i18n.t('messages.connectionFailed', {
                                error: error instanceof Error ? error.message : 'Unknown error'
                            })
                        );
                    }
                }
            }
        }
        this._update();
    }

    private async _executeQuery(tabId: string): Promise<void> {
        const tab = this._tabs.find(t => t.id === tabId);
        if (!tab) { return; }

        if (!tab.connectionId) {
            vscode.window.showWarningMessage(this._i18n.t('queryTabs.noConnectionSelected'));
            return;
        }

        const query = tab.query.trim();
        if (!query) {
            vscode.window.showWarningMessage(this._i18n.t('messages.noQuery'));
            return;
        }

        tab.isExecuting = true;
        tab.error = null;
        this._update();

        try {
            const connection = this._connectionManager.getConnection(tab.connectionId);
            if (!connection || !connection.isConnected()) {
                throw new Error('Connection not available');
            }

            const startTime = Date.now();
            const result = await connection.executeQuery(query);
            const executionTime = Date.now() - startTime;

            tab.results = {
                columns: result.fields?.map(f => f.name) || [],
                rows: result.rows || [],
                rowCount: result.rowCount || 0,
                executionTime
            };

            // Add to history
            await this._queryHistoryProvider.addQuery({
                query,
                connectionId: tab.connectionId,
                connectionName: tab.connectionName,
                executedAt: new Date(),
                executionTime,
                rowCount: tab.results.rowCount,
                status: 'success'
            });

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            tab.error = errorMessage;
            tab.results = null;

            await this._queryHistoryProvider.addQuery({
                query,
                connectionId: tab.connectionId || '',
                connectionName: tab.connectionName,
                executedAt: new Date(),
                executionTime: 0,
                rowCount: 0,
                status: 'error',
                error: errorMessage
            });
        }

        tab.isExecuting = false;
        this._update();
    }

    private async _formatQuery(tabId: string): Promise<void> {
        const tab = this._tabs.find(t => t.id === tabId);
        if (!tab) { return; }

        try {
            const { format } = await import('sql-formatter');
            const formatted = format(tab.query, {
                language: 'sql',
                tabWidth: 2,
                keywordCase: 'upper',
                linesBetweenQueries: 2
            });
            tab.query = formatted;
            this._update();
        } catch (error) {
            vscode.window.showErrorMessage(
                this._i18n.t('messages.formatFailed', {
                    error: error instanceof Error ? error.message : 'Unknown error'
                })
            );
        }
    }

    private _clearResults(tabId: string): void {
        const tab = this._tabs.find(t => t.id === tabId);
        if (tab) {
            tab.results = null;
            tab.error = null;
            this._update();
        }
    }

    private _sendConnections(): void {
        const connections = this._connectionManager.getAllConnections().map(c => ({
            id: c.config.id,
            name: c.config.name,
            type: c.config.type,
            isConnected: c.isConnected()
        }));

        this._panel.webview.postMessage({
            command: 'connections',
            connections
        });
    }

    private _update(): void {
        this._panel.webview.html = this._getHtmlContent();
    }

    private _getHtmlContent(): string {
        const tabsJson = JSON.stringify(this._tabs);
        const activeTabId = this._activeTabId;

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Query Editor</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: var(--vscode-font-family);
            background: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
            height: 100vh;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }

        .tab-bar {
            display: flex;
            align-items: center;
            background: var(--vscode-editorGroupHeader-tabsBackground);
            border-bottom: 1px solid var(--vscode-editorGroupHeader-tabsBorder);
            height: 35px;
            overflow-x: auto;
            overflow-y: hidden;
        }

        .tab-bar::-webkit-scrollbar {
            height: 3px;
        }

        .tab-bar::-webkit-scrollbar-thumb {
            background: var(--vscode-scrollbarSlider-background);
        }

        .tabs {
            display: flex;
            flex: 1;
            min-width: 0;
        }

        .tab {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 0 12px;
            height: 35px;
            background: var(--vscode-tab-inactiveBackground);
            border-right: 1px solid var(--vscode-tab-border);
            cursor: pointer;
            min-width: 120px;
            max-width: 200px;
            font-size: 13px;
            color: var(--vscode-tab-inactiveForeground);
            white-space: nowrap;
            overflow: hidden;
        }

        .tab:hover {
            background: var(--vscode-tab-hoverBackground);
        }

        .tab.active {
            background: var(--vscode-tab-activeBackground);
            color: var(--vscode-tab-activeForeground);
            border-bottom: 2px solid var(--vscode-focusBorder);
        }

        .tab-title {
            flex: 1;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .tab-close {
            width: 18px;
            height: 18px;
            border: none;
            background: transparent;
            color: inherit;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 3px;
            opacity: 0;
            font-size: 14px;
        }

        .tab:hover .tab-close,
        .tab.active .tab-close {
            opacity: 0.7;
        }

        .tab-close:hover {
            background: var(--vscode-toolbar-hoverBackground);
            opacity: 1;
        }

        .new-tab-btn {
            width: 35px;
            height: 35px;
            border: none;
            background: transparent;
            color: var(--vscode-foreground);
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 18px;
            flex-shrink: 0;
        }

        .new-tab-btn:hover {
            background: var(--vscode-toolbar-hoverBackground);
        }

        .editor-container {
            display: flex;
            flex-direction: column;
            flex: 1;
            overflow: hidden;
        }

        .toolbar {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 8px 12px;
            background: var(--vscode-editorWidget-background);
            border-bottom: 1px solid var(--vscode-panel-border);
        }

        .connection-select {
            padding: 4px 8px;
            background: var(--vscode-dropdown-background);
            color: var(--vscode-dropdown-foreground);
            border: 1px solid var(--vscode-dropdown-border);
            border-radius: 4px;
            font-size: 12px;
            min-width: 180px;
        }

        .toolbar-btn {
            padding: 5px 12px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
            display: flex;
            align-items: center;
            gap: 5px;
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }

        .toolbar-btn:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }

        .toolbar-btn.primary {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }

        .toolbar-btn.primary:hover {
            background: var(--vscode-button-hoverBackground);
        }

        .toolbar-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        .toolbar-spacer {
            flex: 1;
        }

        .connection-badge {
            font-size: 11px;
            padding: 2px 8px;
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            border-radius: 10px;
        }

        .connection-badge.connected {
            background: rgba(40, 167, 69, 0.2);
            color: #28a745;
        }

        .split-view {
            display: flex;
            flex-direction: column;
            flex: 1;
            overflow: hidden;
        }

        .query-section {
            flex: 1;
            min-height: 150px;
            display: flex;
            flex-direction: column;
            border-bottom: 3px solid var(--vscode-panel-border);
        }

        .query-editor {
            flex: 1;
            width: 100%;
            padding: 12px;
            background: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
            border: none;
            font-family: var(--vscode-editor-font-family, 'Consolas', 'Courier New', monospace);
            font-size: 14px;
            line-height: 1.5;
            resize: none;
            outline: none;
        }

        .results-section {
            flex: 1;
            min-height: 150px;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }

        .results-header {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 8px 12px;
            background: var(--vscode-editorWidget-background);
            border-bottom: 1px solid var(--vscode-panel-border);
            font-size: 12px;
        }

        .results-title {
            font-weight: 600;
        }

        .results-stats {
            color: var(--vscode-descriptionForeground);
        }

        .results-spacer {
            flex: 1;
        }

        .results-search {
            display: flex;
            align-items: center;
        }

        .results-search input {
            padding: 4px 8px;
            background: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            color: var(--vscode-input-foreground);
            font-size: 12px;
            width: 150px;
        }

        .results-search input:focus {
            outline: none;
            border-color: var(--vscode-focusBorder);
        }

        .results-btn {
            padding: 4px 8px;
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            cursor: pointer;
            font-size: 11px;
        }

        .results-btn:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }

        .column-settings-panel {
            background: var(--vscode-editorWidget-background);
            border-bottom: 1px solid var(--vscode-panel-border);
            padding: 8px 12px;
        }

        .column-settings-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 8px;
            font-size: 12px;
            font-weight: 600;
        }

        .column-settings-header button {
            padding: 2px 6px;
            font-size: 10px;
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 3px;
            cursor: pointer;
            margin-left: 4px;
        }

        .column-settings-list {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
        }

        .column-setting-item {
            display: flex;
            align-items: center;
            gap: 4px;
            font-size: 11px;
            cursor: pointer;
            padding: 2px 6px;
            background: var(--vscode-input-background);
            border-radius: 3px;
        }

        .column-setting-item:hover {
            background: var(--vscode-list-hoverBackground);
        }

        .results-filter-info {
            display: none;
            padding: 4px 12px;
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            background: rgba(0, 122, 204, 0.1);
        }

        .results-table-container {
            flex: 1;
            overflow: auto;
        }

        .results-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 13px;
        }

        .results-table th,
        .results-table td {
            padding: 6px 12px;
            text-align: left;
            border-bottom: 1px solid var(--vscode-panel-border);
            white-space: nowrap;
            max-width: 300px;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .results-table th {
            background: var(--vscode-editorWidget-background);
            font-weight: 600;
            position: sticky;
            top: 0;
            z-index: 1;
            cursor: pointer;
            user-select: none;
        }

        .results-table th:hover {
            background: var(--vscode-list-hoverBackground);
        }

        .results-table th.sorted-asc,
        .results-table th.sorted-desc {
            background: var(--vscode-list-activeSelectionBackground);
            color: var(--vscode-list-activeSelectionForeground);
        }

        .results-table th .sort-indicator {
            margin-left: 4px;
            font-size: 10px;
        }

        .results-table tr:hover td {
            background: var(--vscode-list-hoverBackground);
        }

        .results-table mark {
            background: rgba(255, 235, 59, 0.4);
            color: inherit;
            padding: 0 2px;
            border-radius: 2px;
        }

        .error-message {
            padding: 16px;
            background: rgba(220, 53, 69, 0.1);
            border-left: 3px solid #dc3545;
            margin: 12px;
            border-radius: 4px;
            color: #dc3545;
            font-family: monospace;
            white-space: pre-wrap;
        }

        .loading {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 12px;
            padding: 40px;
            color: var(--vscode-descriptionForeground);
        }

        .loading-spinner {
            width: 20px;
            height: 20px;
            border: 2px solid var(--vscode-foreground);
            border-top-color: transparent;
            border-radius: 50%;
            animation: spin 1s linear infinite;
        }

        @keyframes spin {
            to { transform: rotate(360deg); }
        }

        .empty-results {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 40px;
            color: var(--vscode-descriptionForeground);
            gap: 8px;
        }

        .empty-results .icon {
            font-size: 32px;
            opacity: 0.5;
        }

        .keyboard-hint {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            background: var(--vscode-badge-background);
            padding: 2px 6px;
            border-radius: 3px;
        }
    </style>
</head>
<body>
    <div class="tab-bar">
        <div class="tabs" id="tabs"></div>
        <button class="new-tab-btn" onclick="newTab()" title="New Tab (Ctrl+T)">+</button>
    </div>

    <div class="editor-container" id="editorContainer"></div>

    <script>
        const vscode = acquireVsCodeApi();
        let tabs = ${tabsJson};
        let activeTabId = '${activeTabId}';
        let connections = [];

        // Request connections
        vscode.postMessage({ command: 'getConnections' });

        function init() {
            renderTabs();
            renderEditor();
            // Render results body for active tab
            if (activeTabId && tabColumnState[activeTabId]) {
                renderResultsBody(activeTabId);
            }
        }

        function renderTabs() {
            const tabsEl = document.getElementById('tabs');
            tabsEl.innerHTML = tabs.map(tab => \`
                <div class="tab \${tab.id === activeTabId ? 'active' : ''}"
                     onclick="switchTab('\${tab.id}')"
                     ondblclick="renameTab('\${tab.id}')">
                    <span class="tab-title">\${escapeHtml(tab.name)}</span>
                    <button class="tab-close" onclick="event.stopPropagation(); closeTab('\${tab.id}')">&times;</button>
                </div>
            \`).join('');
        }

        function renderEditor() {
            const container = document.getElementById('editorContainer');
            const tab = tabs.find(t => t.id === activeTabId);

            if (!tab) {
                container.innerHTML = '<div class="empty-results"><div class="icon">📝</div><div>No tabs open</div></div>';
                return;
            }

            container.innerHTML = \`
                <div class="toolbar">
                    <select class="connection-select" onchange="setConnection('\${tab.id}', this.value)">
                        <option value="">-- Select Connection --</option>
                        \${connections.map(c => \`
                            <option value="\${c.id}" \${c.id === tab.connectionId ? 'selected' : ''}>
                                \${escapeHtml(c.name)} (\${c.type})
                            </option>
                        \`).join('')}
                    </select>
                    <span class="connection-badge \${tab.connectionId ? 'connected' : ''}">\${escapeHtml(tab.connectionName)}</span>
                    <div class="toolbar-spacer"></div>
                    <span class="keyboard-hint">Ctrl+Enter to execute</span>
                    <button class="toolbar-btn" onclick="formatQuery('\${tab.id}')">Format</button>
                    <button class="toolbar-btn" onclick="clearResults('\${tab.id}')">Clear</button>
                    <button class="toolbar-btn primary" onclick="executeQuery('\${tab.id}')" \${tab.isExecuting ? 'disabled' : ''}>
                        \${tab.isExecuting ? 'Executing...' : '▶ Execute'}
                    </button>
                </div>
                <div class="split-view">
                    <div class="query-section">
                        <textarea class="query-editor"
                                  id="queryEditor"
                                  placeholder="Write your SQL query here..."
                                  onkeydown="handleKeyDown(event, '\${tab.id}')"
                                  oninput="updateQuery('\${tab.id}', this.value)">\${escapeHtml(tab.query)}</textarea>
                    </div>
                    <div class="results-section">
                        \${renderResults(tab)}
                    </div>
                </div>
            \`;

            // Focus editor and render results body
            setTimeout(() => {
                const editor = document.getElementById('queryEditor');
                if (editor) {
                    editor.focus();
                }
                // Render results body if tab has results
                if (tab && tab.results && tabColumnState[tab.id]) {
                    renderResultsBody(tab.id);
                }
            }, 0);
        }

        function renderResults(tab) {
            if (tab.isExecuting) {
                return \`
                    <div class="loading">
                        <div class="loading-spinner"></div>
                        <span>Executing query...</span>
                    </div>
                \`;
            }

            if (tab.error) {
                return \`
                    <div class="results-header">
                        <span class="results-title">Error</span>
                    </div>
                    <div class="error-message">\${escapeHtml(tab.error)}</div>
                \`;
            }

            if (!tab.results) {
                return \`
                    <div class="empty-results">
                        <div class="icon">📊</div>
                        <div>Execute a query to see results</div>
                    </div>
                \`;
            }

            const results = tab.results;

            if (results.rows.length === 0) {
                return \`
                    <div class="results-header">
                        <span class="results-title">Results</span>
                        <span class="results-stats">\${results.rowCount} rows | \${results.executionTime}ms</span>
                    </div>
                    <div class="empty-results">
                        <div class="icon">✓</div>
                        <div>Query executed successfully. No rows returned.</div>
                    </div>
                \`;
            }

            // Initialize column state for this tab if not exists
            if (!tabColumnState[tab.id]) {
                tabColumnState[tab.id] = {
                    columns: results.columns.map((col, idx) => ({ name: col, visible: true, order: idx })),
                    sortField: null,
                    sortDirection: 'asc',
                    searchTerm: '',
                    columnFilters: {}
                };
            }

            const state = tabColumnState[tab.id];
            const visibleColumns = state.columns.filter(c => c.visible).sort((a, b) => a.order - b.order);
            const hiddenCount = state.columns.length - visibleColumns.length;

            return \`
                <div class="results-header">
                    <span class="results-title">Results</span>
                    <span class="results-stats">\${results.rowCount} rows | \${results.executionTime}ms | \${visibleColumns.length}/\${results.columns.length} columns</span>
                    <div class="results-spacer"></div>
                    <div class="results-search">
                        <input type="text" placeholder="Search..." value="\${escapeHtml(state.searchTerm)}"
                               oninput="handleResultSearch('\${tab.id}', this.value)">
                    </div>
                    <button class="results-btn" onclick="toggleResultColumnPanel('\${tab.id}')" title="Column settings">
                        ⚙️ \${hiddenCount > 0 ? '(' + hiddenCount + ' hidden)' : ''}
                    </button>
                </div>
                <div class="column-settings-panel" id="columnSettings-\${tab.id}" style="display:none;">
                    <div class="column-settings-header">
                        <span>Column Settings</span>
                        <div>
                            <button onclick="showAllResultColumns('\${tab.id}')">Show All</button>
                            <button onclick="hideAllResultColumns('\${tab.id}')">Hide All</button>
                        </div>
                    </div>
                    <div class="column-settings-list">
                        \${state.columns.sort((a,b) => a.order - b.order).map(col => \`
                            <label class="column-setting-item">
                                <input type="checkbox" \${col.visible ? 'checked' : ''}
                                       onchange="toggleResultColumn('\${tab.id}', '\${escapeHtml(col.name)}', this.checked)">
                                <span>\${escapeHtml(col.name)}</span>
                            </label>
                        \`).join('')}
                    </div>
                </div>
                <div class="results-filter-info" id="filterInfo-\${tab.id}"></div>
                <div class="results-table-container">
                    <table class="results-table" id="resultsTable-\${tab.id}">
                        <thead>
                            <tr>
                                \${visibleColumns.map(col => \`
                                    <th onclick="handleResultSort('\${tab.id}', '\${escapeHtml(col.name)}')"
                                        class="\${state.sortField === col.name ? 'sorted-' + state.sortDirection : ''}">
                                        \${escapeHtml(col.name)}
                                        <span class="sort-indicator">\${state.sortField === col.name ? (state.sortDirection === 'asc' ? '↑' : '↓') : ''}</span>
                                    </th>
                                \`).join('')}
                            </tr>
                        </thead>
                        <tbody id="resultsBody-\${tab.id}">
                        </tbody>
                    </table>
                </div>
            \`;
        }

        // Tab column state management
        let tabColumnState = {};

        function renderResultsBody(tabId) {
            const tab = tabs.find(t => t.id === tabId);
            if (!tab || !tab.results || !tabColumnState[tabId]) return;

            const state = tabColumnState[tabId];
            const visibleColumns = state.columns.filter(c => c.visible).sort((a, b) => a.order - b.order);
            let rows = [...tab.results.rows];

            // Apply search filter
            if (state.searchTerm) {
                const term = state.searchTerm.toLowerCase();
                rows = rows.filter(row => {
                    return visibleColumns.some(col => {
                        const val = row[col.name];
                        return val !== null && val !== undefined && String(val).toLowerCase().includes(term);
                    });
                });
            }

            // Apply sorting
            if (state.sortField) {
                rows.sort((a, b) => {
                    const aVal = a[state.sortField];
                    const bVal = b[state.sortField];
                    if (aVal === null && bVal === null) return 0;
                    if (aVal === null) return 1;
                    if (bVal === null) return -1;
                    const aNum = parseFloat(aVal);
                    const bNum = parseFloat(bVal);
                    let cmp = 0;
                    if (!isNaN(aNum) && !isNaN(bNum)) {
                        cmp = aNum - bNum;
                    } else {
                        cmp = String(aVal).localeCompare(String(bVal));
                    }
                    return state.sortDirection === 'asc' ? cmp : -cmp;
                });
            }

            const tbody = document.getElementById('resultsBody-' + tabId);
            if (tbody) {
                tbody.innerHTML = rows.slice(0, 1000).map(row => \`
                    <tr>
                        \${visibleColumns.map(col => {
                            let val = row[col.name];
                            let display = formatValue(val);
                            // Highlight search term
                            if (state.searchTerm && display.toLowerCase().includes(state.searchTerm.toLowerCase())) {
                                const regex = new RegExp('(' + escapeRegex(state.searchTerm) + ')', 'gi');
                                display = display.replace(regex, '<mark>' + String.fromCharCode(36) + '1</mark>');
                            }
                            return \`<td title="\${escapeHtml(String(val ?? ''))}">\${display}</td>\`;
                        }).join('')}
                    </tr>
                \`).join('');
            }

            // Update filter info
            const filterInfo = document.getElementById('filterInfo-' + tabId);
            if (filterInfo) {
                const displayedRows = Math.min(rows.length, 1000);
                const totalRows = tab.results.rows.length;
                const isFiltered = state.searchTerm || rows.length !== totalRows;
                const isTruncated = rows.length > 1000;

                if (isFiltered || isTruncated) {
                    let msg = 'Showing ' + displayedRows + ' of ' + totalRows + ' rows';
                    if (isTruncated) {
                        msg += ' (limited to 1000)';
                    }
                    filterInfo.textContent = msg;
                    filterInfo.style.display = 'block';
                } else {
                    filterInfo.style.display = 'none';
                }
            }
        }

        function handleResultSearch(tabId, term) {
            if (tabColumnState[tabId]) {
                tabColumnState[tabId].searchTerm = term;
                renderResultsBody(tabId);
            }
        }

        function handleResultSort(tabId, field) {
            if (!tabColumnState[tabId]) return;
            const state = tabColumnState[tabId];
            if (state.sortField === field) {
                state.sortDirection = state.sortDirection === 'asc' ? 'desc' : 'asc';
            } else {
                state.sortField = field;
                state.sortDirection = 'asc';
            }
            renderEditor();
        }

        function toggleResultColumnPanel(tabId) {
            const panel = document.getElementById('columnSettings-' + tabId);
            if (panel) {
                panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
            }
        }

        function toggleResultColumn(tabId, colName, visible) {
            if (!tabColumnState[tabId]) return;
            const col = tabColumnState[tabId].columns.find(c => c.name === colName);
            if (col) {
                col.visible = visible;
                renderEditor();
            }
        }

        function showAllResultColumns(tabId) {
            if (!tabColumnState[tabId]) return;
            tabColumnState[tabId].columns.forEach(c => c.visible = true);
            renderEditor();
        }

        function hideAllResultColumns(tabId) {
            if (!tabColumnState[tabId]) return;
            tabColumnState[tabId].columns.forEach(c => c.visible = false);
            renderEditor();
        }

        function escapeRegex(string) {
            return string.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\$&');
        }

        function newTab() {
            vscode.postMessage({ command: 'newTab' });
        }

        function closeTab(tabId) {
            // Cleanup column state to prevent memory leak
            delete tabColumnState[tabId];
            vscode.postMessage({ command: 'closeTab', tabId });
        }

        function switchTab(tabId) {
            vscode.postMessage({ command: 'switchTab', tabId });
        }

        function renameTab(tabId) {
            const tab = tabs.find(t => t.id === tabId);
            const newName = prompt('Enter new tab name:', tab?.name || 'Query');
            if (newName && newName.trim()) {
                vscode.postMessage({ command: 'renameTab', tabId, name: newName.trim() });
            }
        }

        function updateQuery(tabId, query) {
            vscode.postMessage({ command: 'updateQuery', tabId, query });
        }

        function setConnection(tabId, connectionId) {
            vscode.postMessage({ command: 'setConnection', tabId, connectionId });
        }

        function executeQuery(tabId) {
            vscode.postMessage({ command: 'executeQuery', tabId });
        }

        function formatQuery(tabId) {
            vscode.postMessage({ command: 'formatQuery', tabId });
        }

        function clearResults(tabId) {
            vscode.postMessage({ command: 'clearResults', tabId });
        }

        function handleKeyDown(event, tabId) {
            if (event.ctrlKey && event.key === 'Enter') {
                event.preventDefault();
                executeQuery(tabId);
            }
        }

        function formatValue(value) {
            if (value === null) return 'NULL';
            if (value === undefined) return '';
            if (typeof value === 'object') return escapeHtml(JSON.stringify(value));
            return escapeHtml(String(value));
        }

        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        // Handle messages from extension
        window.addEventListener('message', event => {
            const message = event.data;
            if (message.command === 'connections') {
                connections = message.connections;
                renderEditor();
            }
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (event) => {
            if (event.ctrlKey && event.key === 't') {
                event.preventDefault();
                newTab();
            }
            if (event.ctrlKey && event.key === 'w') {
                event.preventDefault();
                if (activeTabId) {
                    closeTab(activeTabId);
                }
            }
        });

        init();
    </script>
</body>
</html>`;
    }

    public dispose(): void {
        QueryTabPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const disposable = this._disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }
}
