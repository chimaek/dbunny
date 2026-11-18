import * as assert from 'assert';
import * as vscode from 'vscode';
import type { QueryResult } from '../../types/database';
import { I18n } from '../../utils/i18n';
import { DiffPanel } from '../../webview/DiffPanel';

suite('Result Diff panel', () => {
    test('duplicate keys block stale results and a shared unique key restores the diff', async () => {
        const extension = vscode.extensions.getExtension('chimaek.dbunny')!;
        const i18n = I18n.getInstance({ extensionPath: extension.extensionPath } as vscode.ExtensionContext);
        await i18n.initialize();

        const fields = [
            { name: 'id', type: 'int' },
            { name: 'line', type: 'int' },
            { name: 'quantity', type: 'int' }
        ];
        const left: QueryResult = {
            fields, rows: [{ id: 1, line: 10, quantity: 1 }, { id: 1, line: 20, quantity: 2 }],
            rowCount: 2, executionTime: 0
        };
        const right: QueryResult = {
            fields, rows: [{ id: 1, line: 10, quantity: 3 }, { id: 1, line: 30, quantity: 2 }],
            rowCount: 2, executionTime: 0
        };
        const panel = DiffPanel.createOrShow(extension.extensionUri, i18n);
        const html = () => panel['_panel'].webview.html;
        const currentDiff = () => panel['_currentDiff'];

        try {
            panel.showDiff(left, right, 'Before', 'After'); // Auto-detects the repeated id.
            assert.match(html(), /<section class="duplicate-keys" role="status">/);
            assert.ok(html().includes(i18n.t('diff.duplicateCounts', { keys: 1, left: 2, right: 2 })));
            assert.doesNotMatch(html(), /id="diffTable"|data-dbunny-click="exportDiff/);
            assert.strictEqual(currentDiff(), null);

            panel['_changeKeyColumn'](1); // line
            assert.match(html(), /<option value="1" selected>line<\/option>/);
            assert.match(html(), /id="diffTable"/);
            assert.match(html(), /data-dbunny-click="exportDiff/);
            assert.doesNotMatch(html(), /<section class="duplicate-keys"/);
            assert.deepStrictEqual(currentDiff()?.summary, {
                totalLeft: 2, totalRight: 2, added: 1, removed: 1, modified: 1, unchanged: 0
            });

            panel['_changeKeyColumn'](0); // id again
            assert.match(html(), /<section class="duplicate-keys"/);
            assert.doesNotMatch(html(), /id="diffTable"|data-dbunny-click="exportDiff/);
            assert.strictEqual(currentDiff(), null);
            panel['_changeKeyColumn'](99);
            assert.strictEqual(currentDiff(), null);
            assert.deepStrictEqual(left.rows.map(row => row.line), [10, 20]);
            assert.deepStrictEqual(right.rows.map(row => row.line), [10, 30]);
        } finally {
            panel.dispose();
        }
    });
});
