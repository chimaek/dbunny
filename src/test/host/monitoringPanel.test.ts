import * as assert from 'assert';
import * as vscode from 'vscode';
import { MySQLProvider } from '../../providers/mysqlProvider';
import { I18n } from '../../utils/i18n';
import { MonitoringPanel } from '../../webview/MonitoringPanel';

const processListQuery = 'SHOW FULL PROCESSLIST';
const serverStatusQuery = 'SHOW GLOBAL STATUS';
const emptyResult = { rows: [], fields: [], rowCount: 0, executionTime: 0 };

function fixture(name: string): MySQLProvider {
    return new MySQLProvider({ id: name, name, type: 'mysql', host: '', port: 0, username: '' });
}

async function waitForVisibility(panel: vscode.WebviewPanel, visible: boolean): Promise<void> {
    if (panel.visible === visible) { return; }
    await new Promise<void>(resolve => {
        const subscription = panel.onDidChangeViewState(() => {
            if (panel.visible === visible) {
                subscription.dispose();
                resolve();
            }
        });
    });
}

suite('Monitoring panel refresh', () => {
    const extension = () => vscode.extensions.getExtension('chimaek.dbunny')!;
    const open = (connection: MySQLProvider) => {
        const { extensionPath, extensionUri } = extension();
        const i18n = I18n.getInstance({ extensionPath } as vscode.ExtensionContext);
        MonitoringPanel.createOrShow(extensionUri, connection, connection.config, i18n);
        return MonitoringPanel.currentPanel!;
    };

    teardown(() => MonitoringPanel.currentPanel?.dispose());

    test('repeated automatic failures stay quiet until the error changes or the refresh recovers', async () => {
        const connection = fixture('Monitoring alerts');
        const timeout = new Error('Fixture monitoring timeout');
        let failure: Error | undefined;
        connection.executeQuery = async () => {
            if (failure) { throw failure; }
            return emptyResult;
        };

        const panel = open(connection);
        panel['_setAutoRefresh'](false, 5000);
        await new Promise(resolve => setImmediate(resolve));

        const notifications: string[] = [];
        const showError = vscode.window.showErrorMessage;
        vscode.window.showErrorMessage = async (message: string) => {
            notifications.push(message);
            return undefined;
        };
        try {
            failure = timeout;
            await panel['_refreshData']('auto');
            await panel['_refreshData']('auto');
            assert.strictEqual(notifications.length, 1);
            assert.match(notifications[0], /Fixture monitoring timeout/);

            await panel['_refreshData']();
            await panel['_refreshData']('auto');
            assert.strictEqual(notifications.length, 2, 'an explicit refresh still reports its failure');

            failure = new Error('Fixture monitoring connection closed');
            await panel['_refreshData']('auto');
            assert.strictEqual(notifications.length, 3);
            assert.match(notifications[2], /Fixture monitoring connection closed/);

            failure = undefined;
            await panel['_refreshData']('auto');
            failure = new Error('Fixture monitoring connection closed');
            await panel['_refreshData']('auto');
            await panel['_refreshData']('auto');
            assert.strictEqual(notifications.length, 4, 'the same error is reported again after recovery');
        } finally {
            vscode.window.showErrorMessage = showError;
        }
    });

    test('manual requests and timer ticks skip a pending refresh and recover after failure', async () => {
        const connection = fixture('Slow monitoring');
        const calls: string[] = [];
        let failFirst!: (error: Error) => void;
        const pending = new Promise<void>((_, reject) => { failFirst = reject; });
        connection.executeQuery = async query => {
            calls.push(query);
            if (calls.length === 1) { await pending; }
            return emptyResult;
        };

        const panel = open(connection);
        try {
            panel['_setAutoRefresh'](true, 10);
            await panel['_refreshData']();
            await new Promise(resolve => setTimeout(resolve, 45));
            panel['_setAutoRefresh'](false, 10);
            assert.deepStrictEqual(calls, [processListQuery]);

            failFirst(new Error('Fixture monitoring refresh failed'));
            await new Promise(resolve => setImmediate(resolve));
            await panel['_refreshData']();
            assert.deepStrictEqual(calls, [processListQuery, processListQuery, serverStatusQuery]);
        } finally {
            failFirst(new Error('Fixture monitoring refresh finished'));
        }
    });

    test('opening another connection waits for the old request and reads only the new view', async () => {
        const previous = fixture('Previous monitoring');
        const next = fixture('Next monitoring');
        const calls: string[] = [];
        let completePrevious!: () => void;
        const pending = new Promise<void>(resolve => { completePrevious = resolve; });
        previous.executeQuery = async query => {
            calls.push(`previous: ${query}`);
            await pending;
            return emptyResult;
        };
        next.executeQuery = async query => {
            calls.push(`next: ${query}`);
            return emptyResult;
        };

        open(previous);
        try {
            open(next);
            assert.deepStrictEqual(calls, [`previous: ${processListQuery}`]);
            completePrevious();
            await new Promise(resolve => setImmediate(resolve));
            assert.deepStrictEqual(calls, [
                `previous: ${processListQuery}`, `next: ${processListQuery}`, `next: ${serverStatusQuery}`
            ]);
        } finally {
            completePrevious();
        }
    });

    test('automatic queries pause when hidden and stop when closed', async () => {
        const connection = fixture('Monitoring visibility');
        let refreshes = 0;
        connection.executeQuery = async query => {
            if (query === processListQuery) { refreshes++; }
            return emptyResult;
        };
        const waitForPolls = () => new Promise(resolve => setTimeout(resolve, 60));

        const panel = open(connection);
        const webviewPanel = panel['_panel'];
        panel['_setAutoRefresh'](true, 10);
        const coveringPanel = vscode.window.createWebviewPanel('monitoringCover', 'Monitoring cover', vscode.ViewColumn.One, {});
        try {
            await waitForVisibility(webviewPanel, false);
            const hiddenCount = refreshes;
            await waitForPolls();
            assert.strictEqual(refreshes, hiddenCount, 'hidden panel must not query');

            webviewPanel.reveal(vscode.ViewColumn.One);
            await waitForVisibility(webviewPanel, true);
            await waitForPolls();
            assert.ok(refreshes > hiddenCount, 'visible panel resumes automatic queries');

            panel['_setAutoRefresh'](false, 10);
            coveringPanel.reveal(vscode.ViewColumn.One);
            await waitForVisibility(webviewPanel, false);
            webviewPanel.reveal(vscode.ViewColumn.One);
            await waitForVisibility(webviewPanel, true);
            const disabledCount = refreshes;
            await waitForPolls();
            assert.strictEqual(refreshes, disabledCount, 'Auto stays off on reveal');

            panel['_setAutoRefresh'](false, 1000);
            open(connection);
            assert.match(webviewPanel.webview.html, /id="autoRefreshBtn" aria-pressed="false"/);
            assert.match(webviewPanel.webview.html, /<option value="1000" selected>1s<\/option>/);

            panel['_setAutoRefresh'](true, 10);
            const closedCount = refreshes;
            webviewPanel.dispose();
            await waitForPolls();
            assert.strictEqual(MonitoringPanel.currentPanel, undefined);
            assert.strictEqual(refreshes, closedCount, 'closed panel must not query');
        } finally {
            coveringPanel.dispose();
        }
    });
});
