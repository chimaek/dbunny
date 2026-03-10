import * as vscode from 'vscode';
import { ConnectionManager } from '../managers/connectionManager';
import { I18n } from '../utils/i18n';
import { QueryHistoryProvider } from '../views/queryHistoryView';
import {
    extractParameters,
    hasParameters,
    substituteParameters,
    getUniqueParameterNames,
    createEmptyConnectionData,
    ConnectionVariableData,
    VariableSet,
    EnvironmentProfile
} from '../utils/queryParameter';

interface QueryTab {
    id: string;
    name: string;
    query: string;
    connectionId: string | null;
    connectionName: string;
    databaseName: string | null;
    databases: string[];
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
                    case 'setDatabase': {
                        const dbTab = this._tabs.find(t => t.id === message.tabId);
                        if (dbTab) {
                            dbTab.databaseName = message.databaseName || null;
                            this._update();
                        }
                        break;
                    }
                    case 'executeQuery': {
                        await this._executeQuery(message.tabId);
                        break;
                    }
                    case 'executeWithParams': {
                        // 파라미터 값이 제공된 쿼리 실행
                        await this._executeQuery(message.tabId, message.values);
                        break;
                    }
                    case 'saveVariableSet': {
                        const tab = this._tabs.find(t => t.id === message.tabId);
                        if (tab?.connectionId) {
                            await this._saveVariableSet(tab.connectionId, message.setName, message.variables);
                        }
                        break;
                    }
                    case 'deleteVariableSet': {
                        const delTab = this._tabs.find(t => t.id === message.tabId);
                        if (delTab?.connectionId) {
                            await this._deleteVariableSet(delTab.connectionId, message.setName);
                            const connData = this._getConnectionVariableData(delTab.connectionId);
                            this._panel.webview.postMessage({
                                command: 'variableDataUpdated',
                                connectionData: connData
                            });
                        }
                        break;
                    }
                    case 'saveProfileVariables': {
                        const profTab = this._tabs.find(t => t.id === message.tabId);
                        if (profTab?.connectionId) {
                            await this._saveProfileVariables(
                                profTab.connectionId, message.profileName, message.variables
                            );
                        }
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
            databaseName: null,
            databases: [],
            results: null,
            isExecuting: false,
            error: null
        };

        // Try to set active connection
        const activeConnection = this._connectionManager.getActiveConnection();
        if (activeConnection) {
            tab.connectionId = activeConnection.config.id;
            tab.connectionName = activeConnection.config.name;
            tab.databaseName = activeConnection.config.database || null;

            // 데이터베이스 목록 비동기 로드
            if (activeConnection.isConnected()) {
                activeConnection.getDatabases().then(dbs => {
                    tab.databases = dbs;
                    if (!tab.databaseName && dbs.length > 0) {
                        tab.databaseName = dbs[0];
                    }
                    this._update();
                }).catch(() => { /* 무시 */ });
            }
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
            tab.databaseName = null;
            tab.databases = [];
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

                // connect() 후 activeConnection을 사용 (connect가 새 객체를 생성하므로)
                const activeConn = this._connectionManager.getActiveConnection();
                if (activeConn && activeConn.config.id === connectionId) {
                    // 데이터베이스 목록 로드 및 기본 데이터베이스 설정
                    try {
                        tab.databases = await activeConn.getDatabases();
                        tab.databaseName = activeConn.config.database || tab.databases[0] || null;
                    } catch {
                        tab.databases = [];
                        tab.databaseName = activeConn.config.database || null;
                    }
                }
            }
        }
        this._update();
    }

    private async _executeQuery(tabId: string, paramValues?: Record<string, string>): Promise<void> {
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

        // 파라미터가 있으면 입력 다이얼로그 표시 (값이 아직 제공되지 않은 경우)
        if (hasParameters(query) && !paramValues) {
            const paramNames = getUniqueParameterNames(query);
            const connData = this._getConnectionVariableData(tab.connectionId);
            this._panel.webview.postMessage({
                command: 'showParameterDialog',
                tabId,
                paramNames,
                connectionData: connData
            });
            return;
        }

        // 파라미터 치환
        let finalQuery = query;
        if (paramValues) {
            finalQuery = substituteParameters(query, paramValues);
        }

        tab.isExecuting = true;
        tab.error = null;
        this._update();

        try {
            // getConnection()은 Map에서 가져오므로 연결되지 않은 객체일 수 있음
            // activeConnection을 우선 사용하고 fallback으로 getConnection 사용
            const activeConn = this._connectionManager.getActiveConnection();
            const connection = (activeConn && activeConn.config.id === tab.connectionId)
                ? activeConn
                : this._connectionManager.getConnection(tab.connectionId);
            if (!connection || !connection.isConnected()) {
                throw new Error('Connection not available');
            }

            const startTime = Date.now();
            // 탭에서 선택된 데이터베이스를 전달하여 "No database selected" 에러 방지
            const database = tab.databaseName || connection.config.database;
            const result = await connection.executeQuery(finalQuery, database || undefined);
            const executionTime = Date.now() - startTime;

            tab.results = {
                columns: result.fields?.map(f => f.name) || [],
                rows: result.rows || [],
                rowCount: result.rowCount || 0,
                executionTime
            };

            // Add to history (원본 쿼리 + 치환된 쿼리 둘 다 기록)
            await this._queryHistoryProvider.addQuery({
                query: paramValues ? `${finalQuery}\n-- Original: ${query}` : query,
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
                query: paramValues ? finalQuery : query,
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

    // ===== 변수 세트 / 환경 프로필 관리 =====

    /** 연결별 변수 데이터 로드 */
    private _getConnectionVariableData(connectionId: string): ConnectionVariableData {
        const allData = this._connectionManager.context.globalState.get<Record<string, ConnectionVariableData>>(
            'dbunny.queryParameters', {}
        );
        return allData[connectionId] || createEmptyConnectionData();
    }

    /** 연결별 변수 데이터 저장 */
    private async _saveConnectionVariableData(connectionId: string, data: ConnectionVariableData): Promise<void> {
        const allData = this._connectionManager.context.globalState.get<Record<string, ConnectionVariableData>>(
            'dbunny.queryParameters', {}
        );
        allData[connectionId] = data;
        await this._connectionManager.context.globalState.update('dbunny.queryParameters', allData);
    }

    /** 변수 세트 저장 */
    private async _saveVariableSet(connectionId: string, name: string, variables: Record<string, string>): Promise<void> {
        const data = this._getConnectionVariableData(connectionId);
        const existingIndex = data.variableSets.findIndex(s => s.name === name);

        if (existingIndex >= 0) {
            data.variableSets[existingIndex].variables = variables;
        } else {
            data.variableSets.push({ name, variables });
        }
        data.lastUsedSet = name;
        await this._saveConnectionVariableData(connectionId, data);
    }

    /** 변수 세트 삭제 */
    private async _deleteVariableSet(connectionId: string, name: string): Promise<void> {
        const data = this._getConnectionVariableData(connectionId);
        data.variableSets = data.variableSets.filter(s => s.name !== name);
        if (data.lastUsedSet === name) {
            data.lastUsedSet = undefined;
        }
        await this._saveConnectionVariableData(connectionId, data);
    }

    /** 환경 프로필 변수 저장 */
    private async _saveProfileVariables(
        connectionId: string, profileName: string, variables: Record<string, string>
    ): Promise<void> {
        const data = this._getConnectionVariableData(connectionId);
        const profile = data.profiles.find(p => p.name === profileName);
        if (profile) {
            profile.variables = { ...profile.variables, ...variables };
        } else {
            data.profiles.push({ name: profileName, variables });
        }
        data.lastUsedProfile = profileName;
        await this._saveConnectionVariableData(connectionId, data);
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
        /* === 파라미터 다이얼로그 스타일 === */
        .param-overlay {
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 1000;
        }
        .param-dialog {
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-widget-border, var(--vscode-editorWidget-border, #454545));
            border-radius: 8px;
            padding: 20px;
            min-width: 420px;
            max-width: 600px;
            max-height: 80vh;
            overflow-y: auto;
            box-shadow: 0 4px 20px rgba(0,0,0,0.3);
        }
        .param-dialog h3 {
            margin-bottom: 12px;
            font-size: 14px;
            color: var(--vscode-foreground);
        }
        .param-dialog .param-section {
            margin-bottom: 16px;
        }
        .param-dialog .param-section-title {
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: var(--vscode-descriptionForeground);
            margin-bottom: 8px;
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .param-dialog .param-row {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 8px;
        }
        .param-dialog .param-label {
            min-width: 120px;
            font-size: 12px;
            color: var(--vscode-foreground);
            font-family: var(--vscode-editor-font-family, monospace);
        }
        .param-dialog .param-input {
            flex: 1;
            padding: 4px 8px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border, transparent);
            border-radius: 3px;
            font-size: 12px;
            outline: none;
        }
        .param-dialog .param-input:focus {
            border-color: var(--vscode-focusBorder);
        }
        .param-dialog .param-actions {
            display: flex;
            justify-content: flex-end;
            gap: 8px;
            margin-top: 16px;
        }
        .param-dialog .param-btn {
            padding: 5px 14px;
            border: none;
            border-radius: 3px;
            font-size: 12px;
            cursor: pointer;
        }
        .param-dialog .param-btn.primary {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        .param-dialog .param-btn.primary:hover {
            background: var(--vscode-button-hoverBackground);
        }
        .param-dialog .param-btn.secondary {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        .param-dialog .param-btn.secondary:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }
        .param-dialog .param-presets {
            display: flex;
            gap: 6px;
            flex-wrap: wrap;
            margin-bottom: 8px;
        }
        .param-dialog .preset-chip {
            padding: 2px 8px;
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            border-radius: 10px;
            font-size: 11px;
            cursor: pointer;
            border: none;
            display: flex;
            align-items: center;
            gap: 4px;
        }
        .param-dialog .preset-chip:hover {
            opacity: 0.8;
        }
        .param-dialog .preset-chip.active {
            outline: 1px solid var(--vscode-focusBorder);
        }
        .param-dialog .preset-chip .delete-preset {
            font-size: 10px;
            opacity: 0.6;
            cursor: pointer;
        }
        .param-dialog .preset-chip .delete-preset:hover {
            opacity: 1;
        }
        .param-dialog .profile-tabs {
            display: flex;
            gap: 4px;
            margin-bottom: 10px;
            border-bottom: 1px solid var(--vscode-widget-border, #454545);
            padding-bottom: 4px;
        }
        .param-dialog .profile-tab {
            padding: 3px 10px;
            font-size: 11px;
            background: none;
            border: none;
            color: var(--vscode-descriptionForeground);
            cursor: pointer;
            border-radius: 3px 3px 0 0;
        }
        .param-dialog .profile-tab.active {
            background: var(--vscode-tab-activeBackground, var(--vscode-editor-background));
            color: var(--vscode-foreground);
            border-bottom: 2px solid var(--vscode-focusBorder);
        }
        .param-dialog .save-set-row {
            display: flex;
            gap: 6px;
            margin-top: 8px;
        }
        .param-dialog .save-set-input {
            flex: 1;
            padding: 3px 8px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border, transparent);
            border-radius: 3px;
            font-size: 11px;
        }
    </style>
</head>
<body>
    <div class="tab-bar">
        <div class="tabs" id="tabs"></div>
        <button class="new-tab-btn" onclick="newTab()" title="New Tab (Ctrl+T)">+</button>
    </div>

    <div class="editor-container" id="editorContainer"></div>
    <div id="paramDialogContainer"></div>

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
                    \${tab.databases && tab.databases.length > 0 ? \`
                        <select class="connection-select" onchange="setDatabase('\${tab.id}', this.value)">
                            \${tab.databases.map(db => \`
                                <option value="\${escapeHtml(db)}" \${db === tab.databaseName ? 'selected' : ''}>
                                    \${escapeHtml(db)}
                                </option>
                            \`).join('')}
                        </select>
                    \` : ''}
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

        function setDatabase(tabId, databaseName) {
            vscode.postMessage({ command: 'setDatabase', tabId, databaseName });
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

        // ===== 파라미터 다이얼로그 =====
        let currentParamTabId = null;
        let currentParamNames = [];
        let currentConnectionData = null;
        let currentActiveProfile = null;

        function showParameterDialog(tabId, paramNames, connectionData) {
            currentParamTabId = tabId;
            currentParamNames = paramNames;
            currentConnectionData = connectionData;
            currentActiveProfile = connectionData.lastUsedProfile || null;

            renderParameterDialog();
        }

        function renderParameterDialog() {
            const container = document.getElementById('paramDialogContainer');
            if (!currentParamTabId || !currentParamNames.length) {
                container.innerHTML = '';
                return;
            }

            const data = currentConnectionData;
            const lastSet = data.lastUsedSet;

            // 활성 프로필에서 변수 값 가져오기
            let prefillValues = {};
            if (currentActiveProfile) {
                const profile = data.profiles.find(p => p.name === currentActiveProfile);
                if (profile) prefillValues = { ...profile.variables };
            }
            // 마지막 사용 변수 세트에서 값 가져오기 (프로필보다 우선)
            if (lastSet) {
                const set = data.variableSets.find(s => s.name === lastSet);
                if (set) prefillValues = { ...prefillValues, ...set.variables };
            }

            container.innerHTML = \`
                <div class="param-overlay" onclick="if(event.target===this)closeParamDialog()">
                    <div class="param-dialog">
                        <h3>Query Parameters</h3>

                        \${data.profiles.length > 0 ? \`
                            <div class="param-section">
                                <div class="param-section-title">Environment Profile</div>
                                <div class="profile-tabs">
                                    <button class="profile-tab \${!currentActiveProfile ? 'active' : ''}"
                                            onclick="selectProfile(null)">None</button>
                                    \${data.profiles.map(p => \`
                                        <button class="profile-tab \${currentActiveProfile === p.name ? 'active' : ''}"
                                                onclick="selectProfile('\${escapeHtml(p.name)}')">\${escapeHtml(p.name)}</button>
                                    \`).join('')}
                                </div>
                            </div>
                        \` : ''}

                        \${data.variableSets.length > 0 ? \`
                            <div class="param-section">
                                <div class="param-section-title">Saved Variable Sets</div>
                                <div class="param-presets">
                                    \${data.variableSets.map(s => \`
                                        <button class="preset-chip \${lastSet === s.name ? 'active' : ''}"
                                                onclick="loadVariableSet('\${escapeHtml(s.name)}')">
                                            \${escapeHtml(s.name)}
                                            <span class="delete-preset" onclick="event.stopPropagation();deleteVariableSet('\${escapeHtml(s.name)}')">&times;</span>
                                        </button>
                                    \`).join('')}
                                </div>
                            </div>
                        \` : ''}

                        <div class="param-section">
                            <div class="param-section-title">Variables</div>
                            \${currentParamNames.map(name => \`
                                <div class="param-row">
                                    <label class="param-label">{{\${escapeHtml(name)}}}</label>
                                    <input class="param-input" id="param-\${escapeHtml(name)}"
                                           value="\${escapeHtml(prefillValues[name] || '')}"
                                           placeholder="Enter value..."
                                           onkeydown="if(event.key==='Enter')submitParams()">
                                </div>
                            \`).join('')}
                        </div>

                        <div class="save-set-row">
                            <input class="save-set-input" id="saveSetName" placeholder="Save as variable set..."
                                   onkeydown="if(event.key==='Enter')saveCurrentSet()">
                            <button class="param-btn secondary" onclick="saveCurrentSet()">Save</button>
                        </div>

                        \${currentActiveProfile ? \`
                            <div class="save-set-row" style="margin-top:4px">
                                <span style="flex:1;font-size:11px;color:var(--vscode-descriptionForeground)">
                                    Save to profile: \${escapeHtml(currentActiveProfile)}
                                </span>
                                <button class="param-btn secondary" onclick="saveToProfile()">Save to Profile</button>
                            </div>
                        \` : ''}

                        <div class="param-actions">
                            <button class="param-btn secondary" onclick="closeParamDialog()">Cancel</button>
                            <button class="param-btn primary" onclick="submitParams()">Execute</button>
                        </div>
                    </div>
                </div>
            \`;

            // 첫 번째 입력 필드에 포커스
            setTimeout(() => {
                const firstInput = document.getElementById('param-' + currentParamNames[0]);
                if (firstInput) firstInput.focus();
            }, 50);
        }

        function closeParamDialog() {
            currentParamTabId = null;
            currentParamNames = [];
            currentConnectionData = null;
            currentActiveProfile = null;
            document.getElementById('paramDialogContainer').innerHTML = '';
        }

        function submitParams() {
            const values = {};
            for (const name of currentParamNames) {
                const input = document.getElementById('param-' + name);
                values[name] = input ? input.value : '';
            }
            vscode.postMessage({
                command: 'executeWithParams',
                tabId: currentParamTabId,
                values
            });
            closeParamDialog();
        }

        function loadVariableSet(setName) {
            if (!currentConnectionData) return;
            const set = currentConnectionData.variableSets.find(s => s.name === setName);
            if (!set) return;
            currentConnectionData.lastUsedSet = setName;
            for (const name of currentParamNames) {
                const input = document.getElementById('param-' + name);
                if (input && set.variables[name] !== undefined) {
                    input.value = set.variables[name];
                }
            }
            renderParameterDialog();
        }

        function deleteVariableSet(setName) {
            vscode.postMessage({
                command: 'deleteVariableSet',
                tabId: currentParamTabId,
                setName
            });
            if (currentConnectionData) {
                currentConnectionData.variableSets = currentConnectionData.variableSets.filter(s => s.name !== setName);
                if (currentConnectionData.lastUsedSet === setName) {
                    currentConnectionData.lastUsedSet = undefined;
                }
                renderParameterDialog();
            }
        }

        function saveCurrentSet() {
            const nameInput = document.getElementById('saveSetName');
            const setName = nameInput ? nameInput.value.trim() : '';
            if (!setName) return;

            const variables = {};
            for (const name of currentParamNames) {
                const input = document.getElementById('param-' + name);
                variables[name] = input ? input.value : '';
            }

            vscode.postMessage({
                command: 'saveVariableSet',
                tabId: currentParamTabId,
                setName,
                variables
            });

            // 로컬 상태 업데이트
            if (currentConnectionData) {
                const existing = currentConnectionData.variableSets.findIndex(s => s.name === setName);
                if (existing >= 0) {
                    currentConnectionData.variableSets[existing].variables = variables;
                } else {
                    currentConnectionData.variableSets.push({ name: setName, variables });
                }
                currentConnectionData.lastUsedSet = setName;
                renderParameterDialog();
            }
        }

        function selectProfile(profileName) {
            currentActiveProfile = profileName;
            // 프로필의 변수 값으로 입력 필드 업데이트
            if (profileName && currentConnectionData) {
                const profile = currentConnectionData.profiles.find(p => p.name === profileName);
                if (profile) {
                    for (const name of currentParamNames) {
                        const input = document.getElementById('param-' + name);
                        if (input && profile.variables[name] !== undefined) {
                            input.value = profile.variables[name];
                        }
                    }
                }
            }
            renderParameterDialog();
        }

        function saveToProfile() {
            if (!currentActiveProfile) return;
            const variables = {};
            for (const name of currentParamNames) {
                const input = document.getElementById('param-' + name);
                variables[name] = input ? input.value : '';
            }

            vscode.postMessage({
                command: 'saveProfileVariables',
                tabId: currentParamTabId,
                profileName: currentActiveProfile,
                variables
            });

            // 로컬 상태 업데이트
            if (currentConnectionData) {
                const profile = currentConnectionData.profiles.find(p => p.name === currentActiveProfile);
                if (profile) {
                    profile.variables = { ...profile.variables, ...variables };
                }
            }
        }

        // Handle messages from extension
        window.addEventListener('message', event => {
            const message = event.data;
            if (message.command === 'connections') {
                connections = message.connections;
                renderEditor();
            } else if (message.command === 'showParameterDialog') {
                showParameterDialog(message.tabId, message.paramNames, message.connectionData);
            } else if (message.command === 'variableDataUpdated') {
                currentConnectionData = message.connectionData;
                renderParameterDialog();
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
