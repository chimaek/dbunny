import * as assert from 'assert';
import * as vm from 'vm';
import type * as vscode from 'vscode';
import { CredentialStore } from '../../utils/credentialStore';
import { EncryptionService } from '../../utils/encryption';
import { guardConnection } from '../../utils/guardedConnection';
import { limitSelectQuery } from '../../utils/queryLimits';
import { checkWriteOperation } from '../../utils/readOnlyGuard';
import { createNonce, installWebviewHandlers, secureWebviewHtml, serializeForWebview, webviewArgument } from '../../utils/webviewSecurity';
import { SQLiteProvider } from '../../providers/sqliteProvider';
import { ConnectionConfig } from '../../types/database';

function credentials() {
    const data = new Map<string, string>();
    const secrets = {
        get: async (key: string) => data.get(key),
        store: async (key: string, value: string) => { data.set(key, value); },
        delete: async (key: string) => { data.delete(key); },
        onDidChange: () => ({ dispose() {} })
    } as vscode.SecretStorage;
    const encryption = new EncryptionService({ secrets } as vscode.ExtensionContext);
    return { store: new CredentialStore(secrets, encryption), encryption, data };
}
const config: ConnectionConfig = { id: 'dummy', name: 'Dummy', type: 'sqlite', host: '', port: 0, username: '', database: ':memory:' };

suite('Credential storage and migration', () => {
    test('DB and all SSH secrets stay out of metadata; an empty edit retains them', async () => {
        const { store } = credentials();
        const saved = await store.save({ ...config, password: 'db-secret', ssh: { host: 'invalid.test', port: 22, username: 'dummy', password: 'ssh-secret', privateKey: 'key-content', passphrase: 'key-pass' } });
        assert.strictEqual(saved.password, undefined);
        assert.deepStrictEqual(saved.ssh, { host: 'invalid.test', port: 22, username: 'dummy' });
        const edited = await store.save({ ...saved, password: '', name: 'Renamed' });
        const resolved = await store.resolve(edited);
        assert.strictEqual(resolved.password, 'db-secret');
        assert.strictEqual(resolved.ssh?.password, 'ssh-secret');
        assert.strictEqual(resolved.ssh?.privateKey, 'key-content');
        assert.strictEqual(resolved.ssh?.passphrase, 'key-pass');
    });
    test('Legacy encrypted DB password and plaintext SSH secrets migrate without loss', async () => {
        const { store, encryption } = credentials();
        const legacy = { ...config, password: await encryption.encrypt('old-password'), ssh: { host: 'invalid.test', port: 22, username: 'dummy', password: 'old-ssh' } };
        const saved = await store.migrate(legacy);
        assert.ok(!JSON.stringify(saved).includes('old-ssh'));
        assert.strictEqual((await store.resolve(saved)).password, 'old-password');
        assert.strictEqual((await store.resolve(saved)).ssh?.password, 'old-ssh');
        assert.deepStrictEqual(await store.migrate(saved), saved);
    });
    test('Copies keep independent credentials; disabling SSH and deleting remove secrets', async () => {
        const { store, data } = credentials();
        const saved = await store.save({ ...config, password: 'retained', ssh: { host: 'invalid.test', port: 22, username: 'dummy', password: 'ssh' } });
        const copy = await store.duplicate(saved, 'copy');
        await store.delete(saved.id);
        assert.strictEqual((await store.resolve(copy)).password, 'retained');
        await store.save({ ...copy, ssh: undefined });
        assert.ok(!data.get('dbunny.credentials.copy')!.includes('sshPassword'));
        await store.delete(copy.id);
        assert.strictEqual(data.has('dbunny.credentials.copy'), false);
    });
    test('Unreadable legacy ciphertext is rejected before replacing state', async () => {
        const { store, data } = credentials();
        await assert.rejects(() => store.migrate({ ...config, password: 'broken-legacy-value' }));
        assert.strictEqual(data.has('dbunny.credentials.dummy'), false);
    });
});

suite('Read-only execution boundary and limits', () => {
    test('Actual SQLite provider rejects writes through the shared boundary and limits reads', async () => {
        const raw = new SQLiteProvider({ ...config });
        await raw.connect();
        try {
            await raw.executeQuery('CREATE TABLE items (id INTEGER)');
            await raw.executeQuery('INSERT INTO items VALUES (1), (2), (3)');
            raw.config.readOnly = true;
            const guarded = guardConnection(raw, () => ({ maxRows: 2, timeoutMs: 1000 }));
            await assert.rejects(() => guarded.executeQuery('DELETE FROM items'), /Read-Only/);
            await assert.rejects(() => guarded.executeQuery('WITH n AS (SELECT 1) DELETE FROM items'), /Read-Only/);
            await assert.rejects(() => guarded.executeQuery('PRAGMA user_version = 7'), /Read-Only/);
            const result = await guarded.executeQuery('SELECT * FROM items ORDER BY id');
            assert.deepStrictEqual(result.rows, [{ id: 1 }, { id: 2 }]);
            assert.strictEqual(result.truncated, true);
            assert.strictEqual((await raw.executeQuery('SELECT COUNT(*) AS n FROM items')).rows[0].n, 3);
        } finally { await raw.disconnect(); }
    });
    test('CTE, executable comments, output commands and administrative operations are blocked', () => {
        for (const sql of ["SELECT '--'; DELETE FROM items", '/*!50000 DELETE FROM items */', 'WITH gone AS (DELETE FROM items RETURNING *) SELECT * FROM gone', 'SELECT * INTO copy FROM items', 'EXPLAIN ANALYZE DELETE FROM items', 'DO $$ BEGIN DELETE FROM items; END $$']) {
            assert.strictEqual(checkWriteOperation(sql, 'postgres').isWrite, true, sql);
        }
        assert.strictEqual(checkWriteOperation('SHOW CREATE TABLE items', 'mysql').isWrite, false);
        assert.strictEqual(checkWriteOperation('CONFIG SET x y', 'redis').isWrite, true);
        assert.strictEqual(checkWriteOperation('{"delete":"items","deletes":[]}', 'mongodb').isWrite, true);
        assert.strictEqual(checkWriteOperation('db.items.aggregate([{"$out":"copy"}])', 'mongodb').isWrite, true);
        assert.strictEqual(checkWriteOperation('db.items.find({})', 'mongodb').isWrite, false);
        assert.strictEqual(checkWriteOperation('{"aggregate":"items","pipeline":[{"\\u0024out":"copy"}],"cursor":{}}', 'mongodb').isWrite, true);
        assert.strictEqual(checkWriteOperation('db.items.aggregate([{"\\u0024merge":"copy"}])', 'mongodb').isWrite, true);
    });
    test('Write SQL and multiple statements are not rewritten by preview limits', () => {
        const options = { maxRows: 2, timeoutMs: 1000 };
        for (const sql of ['INSERT INTO items SELECT 1', 'SELECT 1; SELECT 2', 'SELECT * FROM items FOR UPDATE']) {
            assert.strictEqual(limitSelectQuery(sql, options), sql);
        }
        assert.match(limitSelectQuery("SELECT ';' AS value;", options), /LIMIT 3$/);
        assert.ok(!limitSelectQuery('SELECT 1; -- comment', options).includes('1;'));
    });
    test('PostgreSQL operators, arrays and quoted side-effect functions cannot hide writes', () => {
        for (const sql of ['VALUES (1 # 2); DELETE FROM items', 'SELECT ARRAY[setval(\'sequence\', 2)]',
            'SELECT "pg_catalog"."pg_terminate_backend"(123)', 'SELECT set_config(\'search_path\', \'public\', false)']) {
            assert.strictEqual(checkWriteOperation(sql, 'postgres').isWrite, true, sql);
        }
        assert.strictEqual(checkWriteOperation('SELECT 1 # 2 AS value', 'postgres').isWrite, false);
        assert.strictEqual(checkWriteOperation('SELECT 1 # DELETE ignored\n', 'mysql').isWrite, false);
        assert.strictEqual(checkWriteOperation("SELECT 'setval(1)'", 'postgres').isWrite, false);
        assert.strictEqual(checkWriteOperation('SELECT $$DELETE; setval(1)$$', 'postgres').isWrite, false);
        assert.match(limitSelectQuery('SELECT 1 # 2 AS value', { maxRows: 2, timeoutMs: 1000 }, 'postgres'), /LIMIT 3$/);
    });
});

suite('Webview CSP and delegated events', () => {
    test('Only explicitly nonced scripts are authorized, and script terminators are escaped', () => {
        const nonce = createNonce();
        assert.notStrictEqual(nonce, createNonce());
        const html = secureWebviewHtml('<html><head></head><body><script>untrusted()</script></body></html>', { cspSource: 'vscode-webview://dummy' } as vscode.Webview, nonce);
        assert.match(html, /default-src 'none'/);
        assert.match(html, new RegExp(`script-src 'nonce-${nonce.replace(/[+]/g, '\\+')}';`));
        assert.ok(html.includes('<script>untrusted()</script>'));
        assert.ok(!html.includes('<script nonce='));
        const value = '</script><script>bad()</script>\u2028';
        assert.ok(!serializeForWebview(value).includes('<'));
        assert.strictEqual(JSON.parse(serializeForWebview(value)), value);
        assert.ok(webviewArgument("O'Reilly\"").includes('&quot;'));
    });
    test('Whitelisted handlers accept quoted data, event values and row lookups without eval', () => {
        const listeners = new Map<string, (event: any) => void>();
        const calls: unknown[][] = [];
        class ElementStub {
            constructor(readonly attributes: Record<string, string>, readonly value = '7') {}
            parentElement = null;
            getAttribute(name: string) { return this.attributes[name]; }
            closest() { return this; }
        }
        const context = {
            document: { addEventListener: (type: string, listener: (event: any) => void) => listeners.set(type, listener) },
            Element: ElementStub,
            callbacks: { select: (...args: unknown[]) => calls.push(args) },
            rows: [{ text: '<hello>' }], console: { error() {} }
        };
        vm.runInNewContext(`(${installWebviewHandlers.toString()})(callbacks, () => ({currentFilteredRows: rows}));`, context);
        const emit = (type: string, code: string) => listeners.get(type)!({ target: new ElementStub({ [`data-dbunny-${type}`]: code }), stopPropagation() {}, key: 'Enter' });
        emit('click', `select("O'Reilly", currentFilteredRows[0]["text"], null)`);
        emit('change', 'select(parseInt(this.value))');
        emit('keydown', "if(event.key==='Enter')select(true)");
        emit('click', 'constructor("return process")()');
        emit('click', 'fetch("https://invalid.test")');
        assert.deepStrictEqual(calls, [["O'Reilly", '<hello>', null], [7], [true]]);
    });
});
