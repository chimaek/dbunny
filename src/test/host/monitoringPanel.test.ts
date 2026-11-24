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

suite('Monitoring panel refresh', () => {
    const extension = () => vscode.extensions.getExtension('chimaek.dbunny')!;
    const open = (connection: MySQLProvider) => {
        const { extensionPath, extensionUri } = extension();
        const i18n = I18n.getInstance({ extensionPath } as vscode.ExtensionContext);
        MonitoringPanel.createOrShow(extensionUri, connection, connection.config, i18n);
        return MonitoringPanel.currentPanel!;
    };

    teardown(() => MonitoringPanel.currentPanel?.dispose());

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
            panel['_startAutoRefresh'](10);
            await panel['_refreshData']();
            await new Promise(resolve => setTimeout(resolve, 45));
            panel['_stopAutoRefresh']();
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
});
