import * as assert from 'assert';
import type * as vscode from 'vscode';
import { ConnectionManager } from '../../managers/connectionManager';
import { ConnectionConfig } from '../../types/database';

suite('ConnectionManager execution and persistence', () => {
    test('All exposed connection objects enforce read-only and persist no credential fields', async () => {
        const state = new Map<string, unknown>();
        const secrets = new Map<string, string>();
        const context = {
            globalState: { get: (key: string, fallback: unknown) => state.get(key) ?? fallback, update: async (key: string, value: unknown) => { state.set(key, value); } },
            secrets: { get: async (key: string) => secrets.get(key), store: async (key: string, value: string) => { secrets.set(key, value); }, delete: async (key: string) => { secrets.delete(key); } }
        } as unknown as vscode.ExtensionContext;
        const manager = new ConnectionManager(context);
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
});
