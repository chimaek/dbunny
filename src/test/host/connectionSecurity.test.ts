import * as assert from 'assert';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ConnectionManager } from '../../managers/connectionManager';
import { ConnectionConfig } from '../../types/database';
import { QueryTabPanel } from '../../webview/QueryTabPanel';
import { QueryHistoryProvider } from '../../views/queryHistoryView';
import { I18n } from '../../utils/i18n';

function createManager(connections: ConnectionConfig[] = []) {
    const state = new Map<string, unknown>([['dbunny.connections', connections]]);
    const secrets = new Map<string, string>();
    const context = {
        extensionPath: path.resolve(__dirname, '../../..'),
        globalState: { get: (key: string, fallback: unknown) => state.get(key) ?? fallback, update: async (key: string, value: unknown) => { state.set(key, value); } },
        secrets: { get: async (key: string) => secrets.get(key), store: async (key: string, value: string) => { secrets.set(key, value); }, delete: async (key: string) => { secrets.delete(key); } }
    } as unknown as vscode.ExtensionContext;
    return { manager: new ConnectionManager(context), state, secrets, context };
}

const sqlite = (id: string, database = ':memory:'): ConnectionConfig => ({
    id, name: id, type: 'sqlite', host: '', port: 0, username: '', database
});

suite('ConnectionManager execution and persistence', () => {
    test('All exposed connection objects enforce read-only and persist no credential fields', async () => {
        const { manager, state, secrets } = createManager();
        await manager.ready;
        try {
            await manager.addConnection({ id: 'host-test', name: 'Host Test', type: 'sqlite', host: '', port: 0, username: '', database: ':memory:', password: 'dummy-password' });
            await manager.connect('host-test');
            await manager.executeQuery('CREATE TABLE items (id INTEGER)');
            await manager.executeQuery('INSERT INTO items VALUES (1)');
            manager.getActiveConnection()!.config.readOnly = true;
            manager.getConnection('host-test')!.config.readOnly = true;
            await assert.rejects(() => manager.executeQuery('DELETE FROM items'), /Read-Only/);
            await assert.rejects(() => manager.getActiveConnection()!.executeQuery('DELETE FROM items'), /Read-Only/);
            await assert.rejects(() => manager.getConnection('host-test')!.executeQuery('DELETE FROM items'), /Read-Only/);
            assert.strictEqual((await manager.executeQuery('SELECT COUNT(*) AS n FROM items')).rows[0].n, 1);
            assert.strictEqual((state.get('dbunny.connections') as ConnectionConfig[])[0].password, undefined);
            await manager.deleteConnection('host-test');
            assert.ok(!secrets.has('dbunny.credentials.host-test'));
        } finally { await manager.disconnect(); manager.dispose(); }
    });

    test('ensureConnection waits for restoration and reuses the live guarded connection', async () => {
        const { manager } = createManager([sqlite('restored')]);
        try {
            const connection = await manager.ensureConnection('restored');
            assert.strictEqual(connection, manager.getActiveConnection());
            assert.notStrictEqual(connection, manager.getConnection('restored'));
            assert.ok(connection.isConnected());
            await connection.executeQuery('CREATE TABLE items (id INTEGER)');
            await connection.executeQuery('INSERT INTO items VALUES (1)');
            assert.strictEqual(await manager.ensureConnection('restored'), connection);
            assert.strictEqual((await connection.executeQuery('SELECT COUNT(*) AS n FROM items')).rows[0].n, 1);
            connection.config.readOnly = true;
            await assert.rejects(() => connection.executeQuery('DELETE FROM items'), /Read-Only/);
        } finally { await manager.disconnect(); manager.dispose(); }
    });

    test('ensureConnection switches A/B/A and never falls back for missing or failed targets', async () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dbunny-ensure-'));
        const { manager } = createManager([
            sqlite('a', path.join(directory, 'a.db')),
            sqlite('b', path.join(directory, 'b.db')),
            sqlite('broken', directory)
        ]);
        try {
            const a = await manager.ensureConnection('a');
            await a.executeQuery('CREATE TABLE marker (value TEXT)');
            await a.executeQuery("INSERT INTO marker VALUES ('A')");
            const b = await manager.ensureConnection('b');
            await b.executeQuery('CREATE TABLE marker (value TEXT)');
            await b.executeQuery("INSERT INTO marker VALUES ('B')");
            assert.strictEqual((await b.executeQuery('SELECT value FROM marker')).rows[0].value, 'B');
            assert.strictEqual(a.isConnected(), false);
            const restored = await manager.ensureConnection('a');
            assert.strictEqual(restored.config.id, 'a');
            assert.strictEqual((await restored.executeQuery('SELECT value FROM marker')).rows[0].value, 'A');
            await assert.rejects(() => manager.ensureConnection('missing'), /Connection not found/);
            assert.strictEqual(manager.getActiveConnection(), restored);
            assert.ok(restored.isConnected());
            await restored.disconnect();
            const reconnected = await manager.ensureConnection('a');
            assert.notStrictEqual(reconnected, restored);
            assert.strictEqual((await reconnected.executeQuery('SELECT value FROM marker')).rows[0].value, 'A');
            await assert.rejects(() => manager.ensureConnection('broken'), /Failed to connect to SQLite/);
            assert.strictEqual(manager.getActiveConnection(), null);
            const recovered = await manager.ensureConnection('b');
            assert.strictEqual((await recovered.executeQuery('SELECT value FROM marker')).rows[0].value, 'B');
        } finally {
            await manager.disconnect();
            manager.dispose();
            assert.strictEqual(path.dirname(directory), path.resolve(os.tmpdir()));
            fs.rmSync(directory, { recursive: true, force: true });
        }
    });

    test('Query tabs execute against their own databases after A/B/A switches', async () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dbunny-query-tabs-'));
        const { manager, context } = createManager([
            sqlite('tab-a', path.join(directory, 'a.db')),
            sqlite('tab-b', path.join(directory, 'b.db'))
        ]);
        const i18n = I18n.getInstance(context);
        await i18n.initialize();
        const history = new QueryHistoryProvider(context, i18n);
        let panel: QueryTabPanel | undefined;
        try {
            for (const id of ['tab-a', 'tab-b']) {
                const connection = await manager.ensureConnection(id);
                await connection.executeQuery('CREATE TABLE marker (value TEXT)');
                await connection.executeQuery(`INSERT INTO marker VALUES ('${id}')`);
            }
            panel = QueryTabPanel.createOrShow(vscode.Uri.file(context.extensionPath), manager, i18n, history);
            const a = panel['_tabs'][0];
            Object.assign(a, { connectionId: 'tab-a', connectionName: 'A', databaseName: path.join(directory, 'a.db'), query: 'SELECT value FROM marker' });
            panel.addNewTab();
            const b = panel['_tabs'][1];
            Object.assign(b, { connectionId: 'tab-b', connectionName: 'B', databaseName: path.join(directory, 'b.db'), query: 'SELECT value FROM marker' });
            for (const tab of [a, b, a]) {
                panel['_switchTab'](tab.id);
                await panel['_executeQuery'](tab.id);
                assert.strictEqual(tab.error, null);
                assert.strictEqual(tab.results?.rows[0].value, tab.connectionId);
                assert.strictEqual(manager.getActiveConnection()?.config.id, tab.connectionId);
                assert.strictEqual(tab.isExecuting, false);
            }
            assert.strictEqual(history.getHistory().length, 3);
            assert.ok(history.getHistory().every(entry => entry.status === 'success'));
        } finally {
            panel?.dispose();
            await manager.disconnect();
            manager.dispose();
            assert.strictEqual(path.dirname(directory), path.resolve(os.tmpdir()));
            fs.rmSync(directory, { recursive: true, force: true });
        }
    });
});
