import { testPort } from './testConfig';
import * as assert from 'assert';
import { MySQLProvider } from '../../providers/mysqlProvider';
import { PostgresProvider } from '../../providers/postgresProvider';
import { H2Provider } from '../../providers/h2Provider';
import { guardConnection } from '../../utils/guardedConnection';
import { ConnectionConfig } from '../../types/database';
import { MongoDBProvider } from '../../providers/mongoProvider';
import { RedisProvider } from '../../providers/redisProvider';
import { SQLiteProvider } from '../../providers/sqliteProvider';

async function main() {
    const configs: ConnectionConfig[] = [
        { id: 'policy-mysql', name: 'MySQL', type: 'mysql', host: 'localhost', port: testPort('mysql'), username: 'root', password: 'root1234', database: 'mydb', readOnly: true },
        { id: 'policy-pg', name: 'PostgreSQL', type: 'postgres', host: 'localhost', port: testPort('postgres'), username: 'postgres', password: 'postgres1234', database: 'mydb', readOnly: true },
        { id: 'policy-h2', name: 'H2', type: 'h2', host: 'localhost', port: testPort('h2'), username: 'sa', password: '', database: 'mem:test', h2Mode: { protocol: 'tcp', dbType: 'mem', dbPath: 'test' }, readOnly: true }
    ];
    for (const config of configs) {
        const raw = config.type === 'mysql' ? new MySQLProvider(config) : config.type === 'postgres' ? new PostgresProvider(config) : new H2Provider(config);
        const connection = guardConnection(raw, () => ({ timeoutMs: 1000, maxRows: 2 }));
        try {
            await connection.connect();
            const result = await connection.executeQuery('SELECT 1 AS item_value UNION ALL SELECT 2 UNION ALL SELECT 3');
            assert.strictEqual(result.rows.length, 2);
            assert.strictEqual(result.truncated, true);
            await assert.rejects(() => connection.executeQuery('WITH n AS (SELECT 1) DELETE FROM missing_table'), /Read-Only/);
            if (config.type === 'postgres') {
                await assert.rejects(() => connection.executeQuery('SELECT pg_sleep(0.2)', undefined, { timeoutMs: 10, maxRows: 2 }), /timeout/);
                assert.strictEqual((await connection.executeQuery('SELECT 1 AS value')).rowCount, 1);
            }
            console.log(`PASS ${config.name}: protected execution, bounded results and query settings`);
        } finally { await connection.disconnect(); }
    }
    const pg = guardConnection(new PostgresProvider({ ...configs[1], readOnly: false }), () => ({ timeoutMs: 2000, maxRows: 5 }));
    await pg.connect();
    try {
        await pg.executeQuery('DROP TABLE IF EXISTS dbunny_policy_items');
        await pg.executeQuery('CREATE TABLE dbunny_policy_items (id INTEGER)');
        await pg.executeQuery('INSERT INTO dbunny_policy_items VALUES (1)');
        await pg.executeQuery('CREATE OR REPLACE FUNCTION dbunny_policy_write() RETURNS INTEGER LANGUAGE plpgsql AS $$ BEGIN INSERT INTO dbunny_policy_items VALUES (2); RETURN 2; END $$');
        pg.config.readOnly = true;
        for (const query of ['VALUES (1 # 2); DELETE FROM dbunny_policy_items', 'SELECT pg_terminate_backend(pg_backend_pid())', 'SELECT "pg_catalog"."setval"(\'missing\', 1)']) {
            await assert.rejects(() => pg.executeQuery(query), /Read-Only/);
        }
        await assert.rejects(() => pg.executeQuery('SELECT dbunny_policy_write()'), /read-only transaction/);
        assert.strictEqual((await pg.executeQuery('SELECT COUNT(*)::int AS n FROM dbunny_policy_items')).rows[0].n, 1);
        assert.strictEqual((await pg.executeQuery('SELECT 1 # 2 AS n')).rows[0].n, 3);
        console.log('PASS PostgreSQL: XOR bypass, management functions and server-enforced read-only SELECT functions');
    } finally {
        pg.config.readOnly = false;
        await pg.executeQuery('DROP FUNCTION IF EXISTS dbunny_policy_write()');
        await pg.executeQuery('DROP TABLE IF EXISTS dbunny_policy_items');
        await pg.disconnect();
    }
    const sqlite = guardConnection(new SQLiteProvider({ id: 'policy-sqlite', name: 'SQLite', type: 'sqlite', host: '', port: 0, username: '', database: ':memory:', readOnly: true }), () => ({ timeoutMs: 1000, maxRows: 2 }));
    const mongo = guardConnection(new MongoDBProvider({ id: 'policy-mongo', name: 'MongoDB', type: 'mongodb', host: 'localhost', port: testPort('mongodb'), username: 'admin', password: 'mongo1234', database: 'mydb', readOnly: true }), () => ({ timeoutMs: 2000, maxRows: 2 }));
    const redis = guardConnection(new RedisProvider({ id: 'policy-redis', name: 'Redis', type: 'redis', host: 'localhost', port: testPort('redis'), username: '', password: 'redis1234', readOnly: true }), () => ({ timeoutMs: 1000, maxRows: 2 }));
    for (const [provider, write, read] of [
        [sqlite, 'CREATE TABLE forbidden (id INTEGER)', 'SELECT 1'],
        [mongo, '{"delete":"users","deletes":[]}', 'db.users.aggregate([{"$match":{}}])'],
        [redis, 'SET dbunny:forbidden 1', 'PING']
    ] as const) {
        try {
            await provider.connect();
            await assert.rejects(() => provider.executeQuery(write), /Read-Only/);
            await provider.executeQuery(read);
            console.log(`PASS ${provider.config.type}: live read-only execution boundary`);
        } finally { await provider.disconnect(); }
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
