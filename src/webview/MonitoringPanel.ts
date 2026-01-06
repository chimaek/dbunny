import * as vscode from 'vscode';
import { DatabaseConnection, ConnectionConfig } from '../types/database';
import { I18n } from '../utils/i18n';

interface ProcessInfo {
    id: number | string;
    user: string;
    host: string;
    database: string;
    command: string;
    time: number;
    state: string;
    info: string;
}

interface ServerStatus {
    uptime: number;
    connections: number;
    activeConnections: number;
    queries: number;
    slowQueries: number;
    bytesReceived: number;
    bytesSent: number;
}

export class MonitoringPanel {
    public static currentPanel: MonitoringPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];
    private _connection: DatabaseConnection;
    private _connectionConfig: ConnectionConfig;
    private _refreshInterval: NodeJS.Timeout | undefined;
    private _localization: I18n;

    private constructor(
        panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri,
        connection: DatabaseConnection,
        connectionConfig: ConnectionConfig,
        localization: I18n
    ) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._connection = connection;
        this._connectionConfig = connectionConfig;
        this._localization = localization;

        this._update();

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'refresh': {
                        await this._refreshData();
                        break;
                    }
                    case 'killProcess': {
                        await this._killProcess(message.processId);
                        break;
                    }
                    case 'startAutoRefresh': {
                        this._startAutoRefresh(message.interval);
                        break;
                    }
                    case 'stopAutoRefresh': {
                        this._stopAutoRefresh();
                        break;
                    }
                }
            },
            null,
            this._disposables
        );

        // Start auto-refresh by default (5 seconds)
        this._startAutoRefresh(5000);
    }

    public static createOrShow(
        extensionUri: vscode.Uri,
        connection: DatabaseConnection,
        connectionConfig: ConnectionConfig,
        localization: I18n
    ): void {
        const column = vscode.ViewColumn.One;

        if (MonitoringPanel.currentPanel) {
            MonitoringPanel.currentPanel._panel.reveal(column);
            MonitoringPanel.currentPanel._connection = connection;
            MonitoringPanel.currentPanel._connectionConfig = connectionConfig;
            MonitoringPanel.currentPanel._update();
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'dbunnyMonitoring',
            `Monitoring: ${connectionConfig.name}`,
            column,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [extensionUri]
            }
        );

        MonitoringPanel.currentPanel = new MonitoringPanel(
            panel,
            extensionUri,
            connection,
            connectionConfig,
            localization
        );
    }

    private _startAutoRefresh(interval: number): void {
        this._stopAutoRefresh();
        this._refreshInterval = setInterval(() => {
            this._refreshData();
        }, interval);
    }

    private _stopAutoRefresh(): void {
        if (this._refreshInterval) {
            clearInterval(this._refreshInterval);
            this._refreshInterval = undefined;
        }
    }

    private async _refreshData(): Promise<void> {
        try {
            const processes = await this._getProcessList();
            const status = await this._getServerStatus();

            this._panel.webview.postMessage({
                command: 'updateData',
                processes,
                status
            });
        } catch (error) {
            vscode.window.showErrorMessage(
                this._localization.t('monitoring.refreshFailed', { error: String(error) })
            );
        }
    }

    private async _getProcessList(): Promise<ProcessInfo[]> {
        const dbType = this._connectionConfig.type;

        if (dbType === 'mysql') {
            const result = await this._connection.executeQuery('SHOW FULL PROCESSLIST');
            return result.rows.map((row: Record<string, unknown>) => ({
                id: row['Id'] as number,
                user: row['User'] as string || '',
                host: row['Host'] as string || '',
                database: row['db'] as string || '',
                command: row['Command'] as string || '',
                time: row['Time'] as number || 0,
                state: row['State'] as string || '',
                info: row['Info'] as string || ''
            }));
        } else if (dbType === 'postgres') {
            const result = await this._connection.executeQuery(`
                SELECT
                    pid as id,
                    usename as user,
                    client_addr as host,
                    datname as database,
                    state as command,
                    EXTRACT(EPOCH FROM (now() - query_start))::integer as time,
                    wait_event_type as state,
                    query as info
                FROM pg_stat_activity
                WHERE pid <> pg_backend_pid()
                ORDER BY query_start DESC NULLS LAST
            `);
            return result.rows.map((row: Record<string, unknown>) => ({
                id: row['id'] as number,
                user: row['user'] as string || '',
                host: row['host'] as string || '',
                database: row['database'] as string || '',
                command: row['command'] as string || '',
                time: row['time'] as number || 0,
                state: row['state'] as string || '',
                info: row['info'] as string || ''
            }));
        }

        return [];
    }

    private async _getServerStatus(): Promise<ServerStatus> {
        const dbType = this._connectionConfig.type;

        if (dbType === 'mysql') {
            const result = await this._connection.executeQuery('SHOW GLOBAL STATUS');
            const statusMap: Record<string, string> = {};
            result.rows.forEach((row: Record<string, unknown>) => {
                statusMap[row['Variable_name'] as string] = row['Value'] as string;
            });

            return {
                uptime: parseInt(statusMap['Uptime'] || '0'),
                connections: parseInt(statusMap['Connections'] || '0'),
                activeConnections: parseInt(statusMap['Threads_connected'] || '0'),
                queries: parseInt(statusMap['Queries'] || '0'),
                slowQueries: parseInt(statusMap['Slow_queries'] || '0'),
                bytesReceived: parseInt(statusMap['Bytes_received'] || '0'),
                bytesSent: parseInt(statusMap['Bytes_sent'] || '0')
            };
        } else if (dbType === 'postgres') {
            // PostgreSQL stats
            const connResult = await this._connection.executeQuery(`
                SELECT count(*) as count FROM pg_stat_activity
            `);
            const activeResult = await this._connection.executeQuery(`
                SELECT count(*) as count FROM pg_stat_activity WHERE state = 'active'
            `);
            const statsResult = await this._connection.executeQuery(`
                SELECT
                    EXTRACT(EPOCH FROM (now() - pg_postmaster_start_time()))::integer as uptime,
                    sum(xact_commit + xact_rollback) as queries
                FROM pg_stat_database
            `);

            const stats = statsResult.rows[0] as Record<string, unknown> || {};

            return {
                uptime: stats['uptime'] as number || 0,
                connections: (connResult.rows[0] as Record<string, unknown>)?.['count'] as number || 0,
                activeConnections: (activeResult.rows[0] as Record<string, unknown>)?.['count'] as number || 0,
                queries: stats['queries'] as number || 0,
                slowQueries: 0,
                bytesReceived: 0,
                bytesSent: 0
            };
        }

        return {
            uptime: 0,
            connections: 0,
            activeConnections: 0,
            queries: 0,
            slowQueries: 0,
            bytesReceived: 0,
            bytesSent: 0
        };
    }

    private async _killProcess(processId: number | string): Promise<void> {
        try {
            const dbType = this._connectionConfig.type;

            if (dbType === 'mysql') {
                await this._connection.executeQuery(`KILL ${processId}`);
            } else if (dbType === 'postgres') {
                await this._connection.executeQuery(`SELECT pg_terminate_backend(${processId})`);
            }

            vscode.window.showInformationMessage(
                this._localization.t('monitoring.processKilled', { id: String(processId) })
            );

            await this._refreshData();
        } catch (error) {
            vscode.window.showErrorMessage(
                this._localization.t('monitoring.killFailed', { error: String(error) })
            );
        }
    }

    private _update(): void {
        this._panel.webview.html = this._getHtmlContent();
        this._refreshData();
    }

    private _getHtmlContent(): string {
        const dbType = this._connectionConfig.type;
        const isSupported = dbType === 'mysql' || dbType === 'postgres';

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Database Monitoring</title>
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
            padding: 20px;
        }

        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
            padding-bottom: 15px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }

        .header h1 {
            font-size: 24px;
            display: flex;
            align-items: center;
            gap: 10px;
        }

        .controls {
            display: flex;
            gap: 10px;
            align-items: center;
        }

        .btn {
            padding: 8px 16px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 13px;
            display: inline-flex;
            align-items: center;
            gap: 6px;
            transition: all 0.2s;
        }

        .btn-primary {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }

        .btn-primary:hover {
            background: var(--vscode-button-hoverBackground);
        }

        .btn-danger {
            background: #dc3545;
            color: white;
        }

        .btn-danger:hover {
            background: #c82333;
        }

        .btn-secondary {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }

        .toggle-btn {
            padding: 6px 12px;
        }

        .toggle-btn.active {
            background: #28a745;
            color: white;
        }

        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
            margin-bottom: 25px;
        }

        .stat-card {
            background: var(--vscode-editor-inactiveSelectionBackground);
            border-radius: 8px;
            padding: 20px;
            text-align: center;
        }

        .stat-value {
            font-size: 32px;
            font-weight: bold;
            color: var(--vscode-textLink-foreground);
            margin-bottom: 5px;
        }

        .stat-label {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            text-transform: uppercase;
            letter-spacing: 1px;
        }

        .section {
            margin-bottom: 25px;
        }

        .section-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 15px;
        }

        .section-title {
            font-size: 18px;
            font-weight: 600;
        }

        .process-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 13px;
        }

        .process-table th,
        .process-table td {
            padding: 10px 12px;
            text-align: left;
            border-bottom: 1px solid var(--vscode-panel-border);
        }

        .process-table th {
            background: var(--vscode-editor-inactiveSelectionBackground);
            font-weight: 600;
            position: sticky;
            top: 0;
        }

        .process-table tr:hover {
            background: var(--vscode-list-hoverBackground);
        }

        .process-id {
            font-family: monospace;
            color: var(--vscode-textLink-foreground);
        }

        .process-query {
            max-width: 400px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            font-family: monospace;
            font-size: 12px;
        }

        .process-time {
            font-family: monospace;
        }

        .process-time.warning {
            color: #ffc107;
        }

        .process-time.danger {
            color: #dc3545;
        }

        .state-badge {
            display: inline-block;
            padding: 3px 8px;
            border-radius: 12px;
            font-size: 11px;
            font-weight: 500;
        }

        .state-active {
            background: rgba(40, 167, 69, 0.2);
            color: #28a745;
        }

        .state-idle {
            background: rgba(108, 117, 125, 0.2);
            color: #6c757d;
        }

        .state-waiting {
            background: rgba(255, 193, 7, 0.2);
            color: #ffc107;
        }

        .kill-btn {
            padding: 4px 8px;
            font-size: 11px;
        }

        .empty-state {
            text-align: center;
            padding: 40px;
            color: var(--vscode-descriptionForeground);
        }

        .not-supported {
            text-align: center;
            padding: 60px 20px;
        }

        .not-supported h2 {
            margin-bottom: 15px;
            color: var(--vscode-errorForeground);
        }

        .refresh-indicator {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
        }

        .refresh-indicator.active::before {
            content: '';
            width: 8px;
            height: 8px;
            background: #28a745;
            border-radius: 50%;
            animation: pulse 1s infinite;
        }

        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
        }

        .table-container {
            max-height: 500px;
            overflow-y: auto;
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
        }

        select {
            padding: 6px 10px;
            border: 1px solid var(--vscode-input-border);
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 4px;
            font-size: 13px;
        }
    </style>
</head>
<body>
    ${!isSupported ? `
        <div class="not-supported">
            <h2>Monitoring Not Supported</h2>
            <p>Real-time monitoring is only available for MySQL and PostgreSQL databases.</p>
        </div>
    ` : `
        <div class="header">
            <h1>
                <span>Real-time Monitoring</span>
                <span class="refresh-indicator" id="refreshIndicator">Auto-refresh</span>
            </h1>
            <div class="controls">
                <select id="refreshInterval" onchange="changeInterval()">
                    <option value="1000">1s</option>
                    <option value="5000" selected>5s</option>
                    <option value="10000">10s</option>
                    <option value="30000">30s</option>
                </select>
                <button class="btn btn-secondary toggle-btn active" id="autoRefreshBtn" onclick="toggleAutoRefresh()">
                    Auto
                </button>
                <button class="btn btn-primary" onclick="refresh()">
                    Refresh
                </button>
            </div>
        </div>

        <div class="stats-grid" id="statsGrid">
            <div class="stat-card">
                <div class="stat-value" id="statUptime">-</div>
                <div class="stat-label">Uptime</div>
            </div>
            <div class="stat-card">
                <div class="stat-value" id="statConnections">-</div>
                <div class="stat-label">Total Connections</div>
            </div>
            <div class="stat-card">
                <div class="stat-value" id="statActive">-</div>
                <div class="stat-label">Active Connections</div>
            </div>
            <div class="stat-card">
                <div class="stat-value" id="statQueries">-</div>
                <div class="stat-label">Total Queries</div>
            </div>
            ${dbType === 'mysql' ? `
                <div class="stat-card">
                    <div class="stat-value" id="statSlow">-</div>
                    <div class="stat-label">Slow Queries</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value" id="statTraffic">-</div>
                    <div class="stat-label">Traffic (In/Out)</div>
                </div>
            ` : ''}
        </div>

        <div class="section">
            <div class="section-header">
                <h2 class="section-title">Active Processes</h2>
                <span id="processCount">0 processes</span>
            </div>
            <div class="table-container">
                <table class="process-table">
                    <thead>
                        <tr>
                            <th>ID</th>
                            <th>User</th>
                            <th>Host</th>
                            <th>Database</th>
                            <th>State</th>
                            <th>Time</th>
                            <th>Query</th>
                            <th>Action</th>
                        </tr>
                    </thead>
                    <tbody id="processTableBody">
                        <tr>
                            <td colspan="8" class="empty-state">Loading...</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
    `}

    <script>
        const vscode = acquireVsCodeApi();
        let autoRefresh = true;

        function refresh() {
            vscode.postMessage({ command: 'refresh' });
        }

        function toggleAutoRefresh() {
            autoRefresh = !autoRefresh;
            const btn = document.getElementById('autoRefreshBtn');
            const indicator = document.getElementById('refreshIndicator');

            if (autoRefresh) {
                btn.classList.add('active');
                indicator.classList.add('active');
                const interval = parseInt(document.getElementById('refreshInterval').value);
                vscode.postMessage({ command: 'startAutoRefresh', interval });
            } else {
                btn.classList.remove('active');
                indicator.classList.remove('active');
                vscode.postMessage({ command: 'stopAutoRefresh' });
            }
        }

        function changeInterval() {
            if (autoRefresh) {
                const interval = parseInt(document.getElementById('refreshInterval').value);
                vscode.postMessage({ command: 'startAutoRefresh', interval });
            }
        }

        function killProcess(processId) {
            if (confirm('Are you sure you want to kill this process?')) {
                vscode.postMessage({ command: 'killProcess', processId });
            }
        }

        function formatUptime(seconds) {
            const days = Math.floor(seconds / 86400);
            const hours = Math.floor((seconds % 86400) / 3600);
            const minutes = Math.floor((seconds % 3600) / 60);

            if (days > 0) {
                return days + 'd ' + hours + 'h';
            } else if (hours > 0) {
                return hours + 'h ' + minutes + 'm';
            } else {
                return minutes + 'm ' + (seconds % 60) + 's';
            }
        }

        function formatBytes(bytes) {
            if (bytes === 0) return '0 B';
            const k = 1024;
            const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
            const i = Math.floor(Math.log(bytes) / Math.log(k));
            return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
        }

        function formatNumber(num) {
            if (num >= 1000000) {
                return (num / 1000000).toFixed(1) + 'M';
            } else if (num >= 1000) {
                return (num / 1000).toFixed(1) + 'K';
            }
            return num.toString();
        }

        function getStateClass(state) {
            if (!state) return 'state-idle';
            const s = state.toLowerCase();
            if (s.includes('active') || s.includes('query') || s.includes('executing')) {
                return 'state-active';
            } else if (s.includes('wait') || s.includes('lock')) {
                return 'state-waiting';
            }
            return 'state-idle';
        }

        function getTimeClass(seconds) {
            if (seconds > 60) return 'danger';
            if (seconds > 10) return 'warning';
            return '';
        }

        window.addEventListener('message', event => {
            const message = event.data;

            if (message.command === 'updateData') {
                // Update stats
                const status = message.status;
                document.getElementById('statUptime').textContent = formatUptime(status.uptime);
                document.getElementById('statConnections').textContent = formatNumber(status.connections);
                document.getElementById('statActive').textContent = status.activeConnections;
                document.getElementById('statQueries').textContent = formatNumber(status.queries);

                const slowEl = document.getElementById('statSlow');
                if (slowEl) {
                    slowEl.textContent = status.slowQueries;
                }

                const trafficEl = document.getElementById('statTraffic');
                if (trafficEl) {
                    trafficEl.textContent = formatBytes(status.bytesReceived) + ' / ' + formatBytes(status.bytesSent);
                }

                // Update process table
                const processes = message.processes;
                const tbody = document.getElementById('processTableBody');
                document.getElementById('processCount').textContent = processes.length + ' processes';

                if (processes.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="8" class="empty-state">No active processes</td></tr>';
                } else {
                    tbody.innerHTML = processes.map(p => \`
                        <tr>
                            <td class="process-id">\${p.id}</td>
                            <td>\${p.user || '-'}</td>
                            <td>\${p.host || '-'}</td>
                            <td>\${p.database || '-'}</td>
                            <td><span class="state-badge \${getStateClass(p.command || p.state)}">\${p.command || p.state || 'idle'}</span></td>
                            <td class="process-time \${getTimeClass(p.time)}">\${p.time}s</td>
                            <td class="process-query" title="\${(p.info || '').replace(/"/g, '&quot;')}">\${p.info || '-'}</td>
                            <td>
                                <button class="btn btn-danger kill-btn" onclick="killProcess('\${p.id}')">Kill</button>
                            </td>
                        </tr>
                    \`).join('');
                }
            }
        });

        // Initial state
        document.getElementById('refreshIndicator')?.classList.add('active');
    </script>
</body>
</html>`;
    }

    public dispose(): void {
        this._stopAutoRefresh();
        MonitoringPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }
}
