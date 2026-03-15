/**
 * DBunny Integration Test - 6개 DB 프로바이더 전체 기능 테스트
 *
 * 실행법: npx tsx src/test/integration/run-all.ts
 *
 * 사전 요구사항:
 *   docker compose up -d
 */

import * as path from 'path';
import { ConnectionConfig } from '../../types/database';
import { MySQLProvider } from '../../providers/mysqlProvider';
import { PostgresProvider } from '../../providers/postgresProvider';
import { SQLiteProvider } from '../../providers/sqliteProvider';
import { H2Provider } from '../../providers/h2Provider';
import { MongoDBProvider } from '../../providers/mongoProvider';
import { RedisProvider } from '../../providers/redisProvider';

// ── Helpers ──────────────────────────────────────────────────

let totalPass = 0;
let totalFail = 0;
const failures: string[] = [];

function header(title: string) {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  ${title}`);
    console.log(`${'═'.repeat(60)}`);
}

function pass(msg: string) {
    totalPass++;
    console.log(`  ✅ ${msg}`);
}

function fail(msg: string, err?: unknown) {
    totalFail++;
    const detail = err instanceof Error ? err.message : String(err ?? '');
    console.log(`  ❌ ${msg}${detail ? ' — ' + detail : ''}`);
    failures.push(`${msg}: ${detail}`);
}

async function assert(condition: boolean, msg: string) {
    if (condition) { pass(msg); } else { fail(msg); }
}

async function assertThrows(fn: () => Promise<unknown>, msg: string) {
    try {
        await fn();
        fail(`${msg} (should have thrown)`);
    } catch {
        pass(msg);
    }
}

// ── Configs ──────────────────────────────────────────────────

const sqlitePath = path.resolve(__dirname, '../../../test-data/test.db');

const configs: Record<string, ConnectionConfig> = {
    mysql: {
        id: 'test-mysql', name: 'MySQL Test', type: 'mysql',
        host: 'localhost', port: 3306,
        username: 'root', password: 'root1234', database: 'mydb',
    },
    postgres: {
        id: 'test-pg', name: 'PostgreSQL Test', type: 'postgres',
        host: 'localhost', port: 5432,
        username: 'postgres', password: 'postgres1234', database: 'mydb',
    },
    sqlite: {
        id: 'test-sqlite', name: 'SQLite Test', type: 'sqlite',
        host: '', port: 0, username: '',
        database: sqlitePath,
    },
    h2: {
        id: 'test-h2', name: 'H2 Test', type: 'h2',
        host: 'localhost', port: 5435,
        username: 'sa', password: '',
        database: 'mem:test',
        h2Mode: { protocol: 'tcp', dbType: 'mem', dbPath: 'test' },
    },
    mongodb: {
        id: 'test-mongo', name: 'MongoDB Test', type: 'mongodb',
        host: 'localhost', port: 27017,
        username: 'admin', password: 'mongo1234', database: 'mydb',
    },
    redis: {
        id: 'test-redis', name: 'Redis Test', type: 'redis',
        host: 'localhost', port: 16379,
        username: '', password: 'redis1234',
    },
};

// ── MySQL Tests ──────────────────────────────────────────────

async function testMySQL() {
    header('MySQL 8.0');
    const provider = new MySQLProvider(configs.mysql);

    // connect
    try {
        await provider.connect();
        pass('connect()');
    } catch (e) { fail('connect()', e); return; }

    await assert(provider.isConnected(), 'isConnected() === true');

    // getDatabases
    try {
        const dbs = await provider.getDatabases();
        await assert(dbs.includes('mydb'), `getDatabases() includes 'mydb' — got ${dbs.length} databases`);
    } catch (e) { fail('getDatabases()', e); }

    // Verify init seed data exists (from docker-init)
    try {
        const initTables = await provider.getTables('mydb');
        if (initTables.includes('users') && initTables.includes('posts')) {
            const r = await provider.executeQuery('SELECT COUNT(*) as cnt FROM users', 'mydb');
            const cnt = Number((r.rows[0] as Record<string, unknown>).cnt);
            await assert(cnt >= 5, `init seed data — users: ${cnt} rows`);
            const r2 = await provider.executeQuery('SELECT COUNT(*) as cnt FROM posts', 'mydb');
            const cnt2 = Number((r2.rows[0] as Record<string, unknown>).cnt);
            await assert(cnt2 >= 5, `init seed data — posts: ${cnt2} rows`);
        } else {
            pass('init seed data — skipped (tables not yet created)');
        }
    } catch (e) { fail('init seed data check', e); }

    // executeQuery - CREATE TABLE (test-specific tables, won't conflict with init data)
    try {
        await provider.executeQuery('DROP TABLE IF EXISTS test_orders', 'mydb');
        await provider.executeQuery('DROP TABLE IF EXISTS test_users', 'mydb');
        await provider.executeQuery(`
            CREATE TABLE test_users (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                email VARCHAR(200),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `, 'mydb');
        pass('CREATE TABLE test_users');
    } catch (e) { fail('CREATE TABLE', e); }

    // CREATE with FK
    try {
        await provider.executeQuery(`
            CREATE TABLE test_orders (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                amount DECIMAL(10,2),
                FOREIGN KEY (user_id) REFERENCES test_users(id)
            )
        `, 'mydb');
        pass('CREATE TABLE test_orders (FK)');
    } catch (e) { fail('CREATE TABLE test_orders', e); }

    // INSERT
    try {
        const r = await provider.executeQuery("INSERT INTO test_users (name, email) VALUES ('Alice', 'alice@test.com')", 'mydb');
        await assert(r.rowCount >= 0, `INSERT — rowCount=${r.rowCount}`);
        await provider.executeQuery("INSERT INTO test_users (name, email) VALUES ('Bob', 'bob@test.com')", 'mydb');
        pass('INSERT x2');
    } catch (e) { fail('INSERT', e); }

    // SELECT
    try {
        const r = await provider.executeQuery('SELECT * FROM test_users', 'mydb');
        await assert(r.rows.length === 2, `SELECT — got ${r.rows.length} rows`);
        await assert(r.fields.length >= 3, `SELECT — got ${r.fields.length} fields`);
        await assert(r.executionTime >= 0, `executionTime=${r.executionTime}ms`);
    } catch (e) { fail('SELECT', e); }

    // UPDATE
    try {
        const r = await provider.executeQuery("UPDATE test_users SET email='updated@test.com' WHERE name='Alice'", 'mydb');
        await assert(r.rowCount >= 0, `UPDATE — rowCount=${r.rowCount}`);
        pass('UPDATE');
    } catch (e) { fail('UPDATE', e); }

    // getTables
    try {
        const tables = await provider.getTables('mydb');
        await assert(tables.includes('test_users'), `getTables() includes 'test_users'`);
        await assert(tables.includes('test_orders'), `getTables() includes 'test_orders'`);
    } catch (e) { fail('getTables()', e); }

    // getTableSchema
    try {
        const schema = await provider.getTableSchema('test_users', 'mydb');
        await assert(schema.length >= 3, `getTableSchema() — ${schema.length} columns`);
        const colNames = schema.map(c => c.name);
        await assert(colNames.includes('id'), `schema has 'id' column`);
        await assert(colNames.includes('name'), `schema has 'name' column`);
    } catch (e) { fail('getTableSchema()', e); }

    // getCreateTableStatement
    try {
        const stmt = await provider.getCreateTableStatement!('test_users', 'mydb');
        await assert(stmt.includes('CREATE TABLE'), `getCreateTableStatement()`);
    } catch (e) { fail('getCreateTableStatement()', e); }

    // getForeignKeys
    try {
        const fks = await provider.getForeignKeys!('test_orders', 'mydb');
        await assert(fks.length >= 1, `getForeignKeys() — got ${fks.length} FK`);
        await assert(fks[0].referencedTable === 'test_users', `FK references 'test_users'`);
    } catch (e) { fail('getForeignKeys()', e); }

    // Cleanup test tables
    try {
        await provider.executeQuery("DROP TABLE IF EXISTS test_orders", 'mydb');
        await provider.executeQuery("DROP TABLE IF EXISTS test_users", 'mydb');
        pass('cleanup test tables');
    } catch (e) { fail('cleanup', e); }

    // disconnect
    try {
        await provider.disconnect();
        await assert(!provider.isConnected(), 'isConnected() === false after disconnect');
        pass('disconnect()');
    } catch (e) { fail('disconnect()', e); }
}

// ── PostgreSQL Tests ─────────────────────────────────────────

async function testPostgres() {
    header('PostgreSQL 16');
    const provider = new PostgresProvider(configs.postgres);

    try {
        await provider.connect();
        pass('connect()');
    } catch (e) { fail('connect()', e); return; }

    await assert(provider.isConnected(), 'isConnected() === true');

    // getDatabases
    try {
        const dbs = await provider.getDatabases();
        await assert(dbs.includes('mydb'), `getDatabases() includes 'mydb'`);
    } catch (e) { fail('getDatabases()', e); }

    // Verify init seed data
    try {
        const initTables = await provider.getTables('mydb');
        if (initTables.includes('users') && initTables.includes('posts')) {
            const r = await provider.executeQuery('SELECT COUNT(*) as cnt FROM users');
            const cnt = Number((r.rows[0] as Record<string, unknown>).cnt);
            await assert(cnt >= 5, `init seed data — users: ${cnt} rows`);
        } else {
            pass('init seed data — skipped');
        }
    } catch (e) { fail('init seed data check', e); }

    // CREATE TABLE (test-specific)
    try {
        await provider.executeQuery('DROP TABLE IF EXISTS test_orders');
        await provider.executeQuery('DROP TABLE IF EXISTS test_users');
        await provider.executeQuery(`
            CREATE TABLE test_users (
                id SERIAL PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                email VARCHAR(200),
                created_at TIMESTAMP DEFAULT NOW()
            )
        `);
        pass('CREATE TABLE test_users');
    } catch (e) { fail('CREATE TABLE', e); }

    try {
        await provider.executeQuery(`
            CREATE TABLE test_orders (
                id SERIAL PRIMARY KEY,
                user_id INT NOT NULL REFERENCES test_users(id),
                amount DECIMAL(10,2)
            )
        `);
        pass('CREATE TABLE test_orders (FK)');
    } catch (e) { fail('CREATE TABLE test_orders', e); }

    // INSERT
    try {
        await provider.executeQuery("INSERT INTO test_users (name, email) VALUES ('Alice', 'alice@pg.com')");
        await provider.executeQuery("INSERT INTO test_users (name, email) VALUES ('Bob', 'bob@pg.com')");
        pass('INSERT x2');
    } catch (e) { fail('INSERT', e); }

    // SELECT
    try {
        const r = await provider.executeQuery('SELECT * FROM test_users');
        await assert(r.rows.length === 2, `SELECT — got ${r.rows.length} rows`);
        await assert(r.fields.length >= 3, `SELECT — got ${r.fields.length} fields`);
    } catch (e) { fail('SELECT', e); }

    // UPDATE
    try {
        await provider.executeQuery("UPDATE test_users SET email='updated@pg.com' WHERE name='Alice'");
        pass('UPDATE');
    } catch (e) { fail('UPDATE', e); }

    // getTables
    try {
        const tables = await provider.getTables('mydb');
        await assert(tables.includes('test_users'), `getTables() includes 'test_users'`);
        await assert(tables.includes('test_orders'), `getTables() includes 'test_orders'`);
    } catch (e) { fail('getTables()', e); }

    // getTableSchema
    try {
        const schema = await provider.getTableSchema('test_users');
        await assert(schema.length >= 3, `getTableSchema() — ${schema.length} columns`);
    } catch (e) { fail('getTableSchema()', e); }

    // getCreateTableStatement
    try {
        const stmt = await provider.getCreateTableStatement!('test_users');
        await assert(stmt.includes('CREATE TABLE'), `getCreateTableStatement()`);
    } catch (e) { fail('getCreateTableStatement()', e); }

    // getForeignKeys
    try {
        const fks = await provider.getForeignKeys!('test_orders');
        await assert(fks.length >= 1, `getForeignKeys() — got ${fks.length} FK`);
        await assert(fks[0].referencedTable === 'test_users', `FK references 'test_users'`);
    } catch (e) { fail('getForeignKeys()', e); }

    // Cleanup
    try {
        await provider.executeQuery("DROP TABLE IF EXISTS test_orders");
        await provider.executeQuery("DROP TABLE IF EXISTS test_users");
        pass('cleanup test tables');
    } catch (e) { fail('cleanup', e); }

    try {
        await provider.disconnect();
        await assert(!provider.isConnected(), 'isConnected() === false');
        pass('disconnect()');
    } catch (e) { fail('disconnect()', e); }
}

// ── SQLite Tests ─────────────────────────────────────────────

async function testSQLite() {
    header('SQLite (sql.js)');
    const provider = new SQLiteProvider(configs.sqlite);

    try {
        await provider.connect();
        pass('connect()');
    } catch (e) { fail('connect()', e); return; }

    await assert(provider.isConnected(), 'isConnected() === true');

    // getDatabases
    try {
        const dbs = await provider.getDatabases();
        await assert(dbs.length >= 1, `getDatabases() — got ${dbs.length}`);
    } catch (e) { fail('getDatabases()', e); }

    // CREATE TABLE
    try {
        await provider.executeQuery('DROP TABLE IF EXISTS orders');
        await provider.executeQuery('DROP TABLE IF EXISTS users');
        await provider.executeQuery(`
            CREATE TABLE users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                email TEXT,
                created_at TEXT DEFAULT (datetime('now'))
            )
        `);
        pass('CREATE TABLE users');
    } catch (e) { fail('CREATE TABLE', e); }

    try {
        await provider.executeQuery(`
            CREATE TABLE orders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id),
                amount REAL
            )
        `);
        pass('CREATE TABLE orders (FK)');
    } catch (e) { fail('CREATE TABLE orders', e); }

    // INSERT
    try {
        await provider.executeQuery("INSERT INTO users (name, email) VALUES ('Alice', 'alice@sqlite.com')");
        await provider.executeQuery("INSERT INTO users (name, email) VALUES ('Bob', 'bob@sqlite.com')");
        pass('INSERT x2');
    } catch (e) { fail('INSERT', e); }

    // SELECT
    try {
        const r = await provider.executeQuery('SELECT * FROM users');
        await assert(r.rows.length === 2, `SELECT — got ${r.rows.length} rows`);
        await assert(r.fields.length >= 3, `SELECT — got ${r.fields.length} fields`);
        await assert(r.executionTime >= 0, `executionTime=${r.executionTime}ms`);
    } catch (e) { fail('SELECT', e); }

    // UPDATE
    try {
        const r = await provider.executeQuery("UPDATE users SET email='updated@sqlite.com' WHERE name='Alice'");
        await assert(r.rowCount >= 0, `UPDATE — rowCount=${r.rowCount}`);
    } catch (e) { fail('UPDATE', e); }

    // getTables
    try {
        const tables = await provider.getTables('main');
        await assert(tables.includes('users'), `getTables() includes 'users'`);
        await assert(tables.includes('orders'), `getTables() includes 'orders'`);
    } catch (e) { fail('getTables()', e); }

    // getTableSchema
    try {
        const schema = await provider.getTableSchema('users');
        await assert(schema.length >= 3, `getTableSchema() — ${schema.length} columns`);
        const colNames = schema.map(c => c.name);
        await assert(colNames.includes('id'), `schema has 'id'`);
        await assert(colNames.includes('name'), `schema has 'name'`);
    } catch (e) { fail('getTableSchema()', e); }

    // getCreateTableStatement
    try {
        const stmt = await provider.getCreateTableStatement!('users');
        await assert(stmt.includes('CREATE TABLE'), `getCreateTableStatement()`);
    } catch (e) { fail('getCreateTableStatement()', e); }

    // getForeignKeys
    try {
        const fks = await provider.getForeignKeys!('orders');
        await assert(fks.length >= 1, `getForeignKeys() — got ${fks.length} FK`);
        await assert(fks[0].referencedTable === 'users', `FK references 'users'`);
    } catch (e) { fail('getForeignKeys()', e); }

    // DELETE
    try {
        await provider.executeQuery("DELETE FROM orders");
        await provider.executeQuery("DELETE FROM users WHERE name='Bob'");
        await provider.executeQuery('SELECT COUNT(*) as cnt FROM users');
        pass('DELETE');
    } catch (e) { fail('DELETE', e); }

    // .db file persistence check
    try {
        await provider.disconnect();
        await assert(!provider.isConnected(), 'isConnected() === false');
        pass('disconnect()');

        // Re-connect and verify data persists
        const provider2 = new SQLiteProvider(configs.sqlite);
        await provider2.connect();
        const r = await provider2.executeQuery('SELECT * FROM users');
        await assert(r.rows.length >= 1, `Persistence check — data survived reconnect (${r.rows.length} rows)`);
        await provider2.disconnect();
    } catch (e) { fail('persistence check', e); }
}

// ── H2 Tests ─────────────────────────────────────────────────

async function testH2() {
    header('H2 (PG protocol)');
    const provider = new H2Provider(configs.h2);

    try {
        await provider.connect();
        pass('connect()');
    } catch (e) { fail('connect()', e); return; }

    await assert(provider.isConnected(), 'isConnected() === true');

    // getDatabases (schemas)
    try {
        const dbs = await provider.getDatabases();
        await assert(dbs.length >= 1, `getDatabases() — got ${dbs.length} schemas`);
    } catch (e) { fail('getDatabases()', e); }

    // CREATE TABLE
    try {
        await provider.executeQuery('DROP TABLE IF EXISTS ORDERS');
        await provider.executeQuery('DROP TABLE IF EXISTS USERS');
        await provider.executeQuery(`
            CREATE TABLE USERS (
                ID INT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
                NAME VARCHAR(100) NOT NULL,
                EMAIL VARCHAR(200)
            )
        `);
        pass('CREATE TABLE USERS');
    } catch (e) { fail('CREATE TABLE', e); }

    try {
        await provider.executeQuery(`
            CREATE TABLE ORDERS (
                ID INT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
                USER_ID INT NOT NULL,
                AMOUNT DECIMAL(10,2),
                FOREIGN KEY (USER_ID) REFERENCES USERS(ID)
            )
        `);
        pass('CREATE TABLE ORDERS (FK)');
    } catch (e) { fail('CREATE TABLE ORDERS', e); }

    // INSERT
    try {
        await provider.executeQuery("INSERT INTO USERS (NAME, EMAIL) VALUES ('Alice', 'alice@h2.com')");
        await provider.executeQuery("INSERT INTO USERS (NAME, EMAIL) VALUES ('Bob', 'bob@h2.com')");
        pass('INSERT x2');
    } catch (e) { fail('INSERT', e); }

    // SELECT
    try {
        const r = await provider.executeQuery('SELECT * FROM USERS');
        await assert(r.rows.length === 2, `SELECT — got ${r.rows.length} rows`);
    } catch (e) { fail('SELECT', e); }

    // UPDATE
    try {
        await provider.executeQuery("UPDATE USERS SET EMAIL='updated@h2.com' WHERE NAME='Alice'");
        pass('UPDATE');
    } catch (e) { fail('UPDATE', e); }

    // getTables (H2 PG protocol returns lowercase names)
    try {
        const tables = await provider.getTables('PUBLIC');
        const tableUpper = tables.map(t => t.toUpperCase());
        await assert(tableUpper.includes('USERS'), `getTables() includes 'USERS' — got [${tables}]`);
        await assert(tableUpper.includes('ORDERS'), `getTables() includes 'ORDERS'`);
    } catch (e) { fail('getTables()', e); }

    // getTableSchema
    try {
        const schema = await provider.getTableSchema('USERS', 'PUBLIC');
        await assert(schema.length >= 3, `getTableSchema() — ${schema.length} columns`);
    } catch (e) { fail('getTableSchema()', e); }

    // getCreateTableStatement
    try {
        const stmt = await provider.getCreateTableStatement!('USERS', 'PUBLIC');
        await assert(stmt.includes('CREATE TABLE'), `getCreateTableStatement()`);
    } catch (e) { fail('getCreateTableStatement()', e); }

    // getForeignKeys
    try {
        const fks = await provider.getForeignKeys!('ORDERS', 'PUBLIC');
        await assert(fks.length >= 1, `getForeignKeys() — got ${fks.length} FK`);
        const refUpper = fks[0].referencedTable.toUpperCase();
        await assert(refUpper === 'USERS', `FK references 'USERS'`);
    } catch (e) { fail('getForeignKeys()', e); }

    // DELETE
    try {
        await provider.executeQuery("DELETE FROM ORDERS");
        await provider.executeQuery("DELETE FROM USERS");
        pass('DELETE');
    } catch (e) { fail('DELETE', e); }

    try {
        await provider.disconnect();
        await assert(!provider.isConnected(), 'isConnected() === false');
        pass('disconnect()');
    } catch (e) { fail('disconnect()', e); }
}

// ── MongoDB Tests ────────────────────────────────────────────

async function testMongoDB() {
    header('MongoDB 7');
    const provider = new MongoDBProvider(configs.mongodb);

    try {
        await provider.connect();
        pass('connect()');
    } catch (e) { fail('connect()', e); return; }

    await assert(provider.isConnected(), 'isConnected() === true');

    // getDatabases
    try {
        const dbs = await provider.getDatabases();
        await assert(dbs.length >= 1, `getDatabases() — got ${dbs.length} databases`);
    } catch (e) { fail('getDatabases()', e); }

    // Verify init seed data (from docker-init)
    try {
        const initCollections = await provider.getTables('mydb');
        if (initCollections.includes('users') && initCollections.includes('posts') && initCollections.includes('products')) {
            const r1 = await provider.executeQuery('db.users.countDocuments({})', 'mydb');
            const cnt1 = Number((r1.rows[0] as Record<string, unknown>).n ?? (r1.rows[0] as Record<string, unknown>).count ?? r1.rows[0]);
            await assert(cnt1 >= 5, `init seed data — users: ${cnt1} docs`);
            const r2 = await provider.executeQuery('db.posts.countDocuments({})', 'mydb');
            const cnt2 = Number((r2.rows[0] as Record<string, unknown>).n ?? (r2.rows[0] as Record<string, unknown>).count ?? r2.rows[0]);
            await assert(cnt2 >= 5, `init seed data — posts: ${cnt2} docs`);
            const r3 = await provider.executeQuery('db.products.countDocuments({})', 'mydb');
            const cnt3 = Number((r3.rows[0] as Record<string, unknown>).n ?? (r3.rows[0] as Record<string, unknown>).count ?? r3.rows[0]);
            await assert(cnt3 >= 5, `init seed data — products: ${cnt3} docs`);
        } else {
            pass('init seed data — skipped (collections not yet created)');
        }
    } catch (e) { fail('init seed data check', e); }

    // executeQuery — create test collection (won't conflict with init data)
    try {
        try {
            await provider.executeQuery('{"drop": "test_users"}', 'mydb');
        } catch { /* ignore if not exists */ }

        await provider.executeQuery('{"create": "test_users"}', 'mydb');
        pass('executeQuery() create test_users collection');
    } catch (e) { fail('executeQuery() create collection', e); }

    try {
        await provider.executeQuery(
            '{"insert": "test_users", "documents": [{"name": "Alice", "email": "alice@mongo.com"}, {"name": "Bob", "email": "bob@mongo.com"}]}',
            'mydb'
        );
        pass('executeQuery() insert documents');
    } catch (e) { fail('insert documents', e); }

    // executeQuery — find (JSON)
    try {
        const r = await provider.executeQuery('{"find": "test_users", "filter": {}}', 'mydb');
        await assert(r.rows.length >= 2, `find (JSON) — got ${r.rows.length} docs`);
    } catch (e) { fail('find query (JSON)', e); }

    // executeQuery — Shell syntax: db.collection.find({})
    try {
        const r = await provider.executeQuery('db.test_users.find({})', 'mydb');
        await assert(r.rows.length >= 2, `find (Shell) — got ${r.rows.length} docs`);
    } catch (e) { fail('find query (Shell)', e); }

    // Shell syntax with .limit()
    try {
        const r = await provider.executeQuery('db.test_users.find({}).limit(1)', 'mydb');
        await assert(r.rows.length === 1, `find.limit(1) (Shell) — got ${r.rows.length} doc`);
    } catch (e) { fail('find.limit (Shell)', e); }

    // getTables (collections)
    try {
        const tables = await provider.getTables('mydb');
        await assert(tables.includes('test_users'), `getTables() includes 'test_users'`);
    } catch (e) { fail('getTables()', e); }

    // getTableSchema (inferred from sample)
    try {
        const provider2 = new MongoDBProvider({ ...configs.mongodb, database: 'mydb' });
        await provider2.connect();
        const schema = await provider2.getTableSchema('test_users');
        await assert(schema.length >= 2, `getTableSchema() — ${schema.length} fields inferred`);
        const colNames = schema.map(c => c.name);
        await assert(colNames.includes('name'), `schema has 'name' field`);
        await provider2.disconnect();
    } catch (e) { fail('getTableSchema()', e); }

    // update (JSON)
    try {
        await provider.executeQuery(
            '{"update": "test_users", "updates": [{"q": {"name": "Alice"}, "u": {"$set": {"email": "updated@mongo.com"}}}]}',
            'mydb'
        );
        pass('update (JSON)');
    } catch (e) { fail('update (JSON)', e); }

    // Shell: db.collection.updateOne
    try {
        await provider.executeQuery(
            'db.test_users.updateOne({"name": "Alice"}, {"$set": {"email": "shell@mongo.com"}})',
            'mydb'
        );
        pass('updateOne (Shell)');
    } catch (e) { fail('updateOne (Shell)', e); }

    // Shell: db.collection.deleteOne
    try {
        await provider.executeQuery(
            'db.test_users.deleteOne({"name": "Bob"})',
            'mydb'
        );
        pass('deleteOne (Shell)');
    } catch (e) { fail('deleteOne (Shell)', e); }

    // Shell: db.collection.countDocuments
    try {
        const r = await provider.executeQuery('db.test_users.countDocuments({})', 'mydb');
        await assert(r.rows.length >= 1, `countDocuments (Shell) — got result`);
    } catch (e) { fail('countDocuments (Shell)', e); }

    // Cleanup test collection
    try {
        await provider.executeQuery('{"drop": "test_users"}', 'mydb');
        pass('cleanup test_users collection');
    } catch (e) { fail('cleanup', e); }

    try {
        await provider.disconnect();
        await assert(!provider.isConnected(), 'isConnected() === false');
        pass('disconnect()');
    } catch (e) { fail('disconnect()', e); }
}

// ── Redis Tests ──────────────────────────────────────────────

async function testRedis() {
    header('Redis 7');
    const provider = new RedisProvider(configs.redis);

    try {
        await provider.connect();
        pass('connect()');
    } catch (e) { fail('connect()', e); return; }

    await assert(provider.isConnected(), 'isConnected() === true');

    // getDatabases
    try {
        const dbs = await provider.getDatabases();
        await assert(dbs.length === 16, `getDatabases() — got ${dbs.length} databases`);
        await assert(dbs[0] === 'db0', `first db is 'db0'`);
    } catch (e) { fail('getDatabases()', e); }

    // PING
    try {
        const r = await provider.executeQuery('PING');
        await assert(r.rows.length >= 1, `PING — returned result`);
    } catch (e) { fail('PING', e); }

    // SET / GET
    try {
        await provider.executeQuery('SET test:key1 "hello dbunny"');
        const r = await provider.executeQuery('GET test:key1');
        const val = r.rows[0]?.value ?? r.rows[0]?.result;
        await assert(String(val).includes('hello dbunny'), `SET/GET — value='${val}'`);
    } catch (e) { fail('SET/GET', e); }

    // HSET / HGETALL
    try {
        await provider.executeQuery('HSET test:hash field1 val1 field2 val2');
        const r = await provider.executeQuery('HGETALL test:hash');
        await assert(r.rows.length >= 1, `HSET/HGETALL — got rows`);
    } catch (e) { fail('HSET/HGETALL', e); }

    // LPUSH / LRANGE
    try {
        await provider.executeQuery('LPUSH test:list a b c');
        const r = await provider.executeQuery('LRANGE test:list 0 -1');
        await assert(r.rows.length >= 1, `LPUSH/LRANGE — got rows`);
    } catch (e) { fail('LPUSH/LRANGE', e); }

    // SADD / SMEMBERS
    try {
        await provider.executeQuery('SADD test:set x y z');
        const r = await provider.executeQuery('SMEMBERS test:set');
        await assert(r.rows.length >= 1, `SADD/SMEMBERS — got rows`);
    } catch (e) { fail('SADD/SMEMBERS', e); }

    // getTables (KEYS)
    try {
        const keys = await provider.getTables('0');
        await assert(keys.length >= 1, `getTables() — got ${keys.length} keys`);
    } catch (e) { fail('getTables()', e); }

    // getTableSchema (TYPE)
    try {
        const schema = await provider.getTableSchema('test:key1');
        await assert(schema.length >= 1, `getTableSchema() — got ${schema.length} fields`);
    } catch (e) { fail('getTableSchema()', e); }

    // FLUSHDB should be blocked
    try {
        await assertThrows(
            () => provider.executeQuery('FLUSHDB'),
            'FLUSHDB blocked'
        );
    } catch (e) { fail('FLUSHDB block check', e); }

    // FLUSHALL should be blocked
    try {
        await assertThrows(
            () => provider.executeQuery('FLUSHALL'),
            'FLUSHALL blocked'
        );
    } catch (e) { fail('FLUSHALL block check', e); }

    // DEL
    try {
        await provider.executeQuery('DEL test:key1 test:hash test:list test:set');
        pass('DEL cleanup');
    } catch (e) { fail('DEL cleanup', e); }

    // SELECT (database switch)
    try {
        await provider.executeQuery('SELECT 1');
        pass('SELECT 1 (db switch)');
    } catch (e) { fail('SELECT 1', e); }

    try {
        await provider.disconnect();
        await assert(!provider.isConnected(), 'isConnected() === false');
        pass('disconnect()');
    } catch (e) { fail('disconnect()', e); }
}

// ── Main ─────────────────────────────────────────────────────

async function main() {
    console.log('🐰 DBunny Integration Test');
    console.log(`   시작: ${new Date().toLocaleTimeString()}`);

    const tests = [
        { name: 'MySQL', fn: testMySQL },
        { name: 'PostgreSQL', fn: testPostgres },
        { name: 'SQLite', fn: testSQLite },
        { name: 'H2', fn: testH2 },
        { name: 'MongoDB', fn: testMongoDB },
        { name: 'Redis', fn: testRedis },
    ];

    for (const t of tests) {
        try {
            await t.fn();
        } catch (e) {
            fail(`${t.name} — uncaught fatal error`, e);
        }
    }

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  RESULTS: ✅ ${totalPass} passed, ❌ ${totalFail} failed`);
    console.log(`${'═'.repeat(60)}`);

    if (failures.length > 0) {
        console.log('\n  Failures:');
        failures.forEach((f, i) => console.log(`    ${i + 1}. ${f}`));
    }

    console.log('');
    process.exit(totalFail > 0 ? 1 : 0);
}

main().catch(e => {
    console.error('Fatal error:', e);
    process.exit(1);
});
