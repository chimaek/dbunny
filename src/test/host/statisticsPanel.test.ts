import * as assert from 'assert';
import * as vscode from 'vscode';
import { SQLiteProvider } from '../../providers/sqliteProvider';
import { buildColumnStatsQuery, buildNumericStatsQuery, buildTopValuesQuery } from '../../utils/dataStatistics';
import { I18n } from '../../utils/i18n';
import { StatisticsPanel } from '../../webview/StatisticsPanel';

suite('Statistics panel', () => {
    test('partial failures preserve measured values and can be refreshed', async () => {
        const extension = vscode.extensions.getExtension('chimaek.dbunny')!;
        const i18n = I18n.getInstance({ extensionPath: extension.extensionPath } as vscode.ExtensionContext);
        await i18n.initialize();
        const provider = new SQLiteProvider({
            id: 'statistics-fixture', name: 'Statistics fixture', type: 'sqlite',
            host: '', port: 0, username: '', database: ':memory:'
        });
        const manager = { getActiveConnection: () => provider };
        const table = 'statistics_fixture';
        const t = (key: string) => i18n.t(`statistics.${key}`);
        const metric = (key: string, value: string) =>
            `<div class="stat-label">${t(key)}</div><div class="stat-value">${value}</div>`;
        const unavailable = (status: string, key: string) => `<span class="stat-${status}">${t(key)}</span>`;
        const failed = unavailable('failed', 'failed');
        const notComputed = unavailable('not-computed', 'notComputed');

        try {
            await provider.connect();
            await provider.executeQuery(`CREATE TABLE ${table} (amount INTEGER, missing INTEGER, label TEXT, limited INTEGER)`);
            await provider.executeQuery(`INSERT INTO ${table} VALUES (0, NULL, '<sample & "quoted">', 5)`);
            const blocked = new Set([
                buildColumnStatsQuery(table, 'limited', 'sqlite'),
                buildNumericStatsQuery(table, 'limited', 'sqlite'),
                buildTopValuesQuery(table, 'amount', 'sqlite')
            ]);
            const executeQuery = provider.executeQuery.bind(provider);
            provider.executeQuery = async (query, ...args) => {
                if (blocked.delete(query)) { throw new Error('Fixture aggregate unavailable'); }
                return executeQuery(query, ...args);
            };

            await StatisticsPanel.createOrShow(extension.extensionUri, manager, i18n, table, ':memory:', 'sqlite');
            const panel = StatisticsPanel.currentPanel!;
            const html = () => panel['_panel'].webview.html;
            const [amount, missing, label, limited] = html().split('<div class="col-card">').slice(1);

            assert.ok(html().includes(`<p class="partial-warning" role="status">${t('partialFailure')}</p>`));
            assert.ok(amount.includes(metric('avg', '0')) && amount.includes(metric('nullPercent', '0%')));
            assert.ok(amount.split('<div class="top-values">')[1].includes(failed));
            assert.ok(missing.includes(metric('distinct', '0')) && missing.includes(metric('min', 'NULL')));
            assert.ok(missing.includes(t('noTopValues')));
            assert.ok(label.includes(metric('avg', notComputed)) && label.includes('&lt;sample &amp; &quot;quoted&quot;&gt;'));
            assert.ok(limited.includes(metric('distinct', failed)) && limited.includes(metric('min', failed)));
            assert.ok(limited.includes(metric('nullPercent', notComputed)) && !limited.includes('class="null-bar"'));
            assert.ok(limited.includes('<span class="tv-val" title="5">5</span>'));

            await panel['_loadStatistics']();
            assert.doesNotMatch(html(), /class="partial-warning"|class="stat-failed"/);
            assert.ok(html().includes(metric('min', '5')) && html().includes('<span class="tv-val" title="0">0</span>'));
        } finally {
            StatisticsPanel.currentPanel?.dispose();
            await provider.disconnect();
        }
    });
});
