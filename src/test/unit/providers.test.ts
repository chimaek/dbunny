import * as assert from 'assert';
import { ConnectionConfig } from '../../types/database';
import { MySQLProvider } from '../../providers/mysqlProvider';
import { PostgresProvider } from '../../providers/postgresProvider';
import { SQLiteProvider } from '../../providers/sqliteProvider';
import { H2Provider } from '../../providers/h2Provider';
import { RedisProvider } from '../../providers/redisProvider';
import { MongoDBProvider } from '../../providers/mongoProvider';

// ============================================================
// Provider instantiation and basic interface tests
// These tests verify the contract without requiring live DB
// ============================================================

suite('MySQLProvider Unit Tests', () => {
    const config: ConnectionConfig = {
        id: 'mysql-test',
        name: 'Test MySQL',
        type: 'mysql',
        host: 'localhost',
        port: 3306,
        username: 'root',
        password: 'test',
        database: 'testdb'
    };

    test('Should instantiate with config', () => {
        const provider = new MySQLProvider(config);
        assert.strictEqual(provider.config.type, 'mysql');
        assert.strictEqual(provider.config.host, 'localhost');
        assert.strictEqual(provider.config.port, 3306);
    });

    test('isConnected should return false before connect', () => {
        const provider = new MySQLProvider(config);
        assert.strictEqual(provider.isConnected(), false);
    });

    test('executeQuery should throw when not connected', async () => {
        const provider = new MySQLProvider(config);
        await assert.rejects(
            () => provider.executeQuery('SELECT 1'),
            /Not connected to database/
        );
    });

    test('getForeignKeys should throw when not connected', async () => {
        const provider = new MySQLProvider(config);
        await assert.rejects(
            () => provider.getForeignKeys('users'),
            /Not connected to database/
        );
    });

    test('disconnect should not throw when not connected', async () => {
        const provider = new MySQLProvider(config);
        await provider.disconnect(); // should not throw
        assert.strictEqual(provider.isConnected(), false);
    });

    test('Should accept SSH config', () => {
        const sshConfig: ConnectionConfig = {
            ...config,
            ssh: {
                host: 'bastion.example.com',
                port: 22,
                username: 'ubuntu',
                password: 'secret'
            }
        };
        const provider = new MySQLProvider(sshConfig);
        assert.ok(provider.config.ssh);
        assert.strictEqual(provider.config.ssh.host, 'bastion.example.com');
    });
});

suite('PostgresProvider Unit Tests', () => {
    const config: ConnectionConfig = {
        id: 'pg-test',
        name: 'Test PostgreSQL',
        type: 'postgres',
        host: 'localhost',
        port: 5432,
        username: 'postgres',
        password: 'test',
        database: 'testdb'
    };

    test('Should instantiate with config', () => {
        const provider = new PostgresProvider(config);
        assert.strictEqual(provider.config.type, 'postgres');
        assert.strictEqual(provider.config.port, 5432);
    });

    test('isConnected should return false before connect', () => {
        const provider = new PostgresProvider(config);
        assert.strictEqual(provider.isConnected(), false);
    });

    test('executeQuery should throw when not connected', async () => {
        const provider = new PostgresProvider(config);
        await assert.rejects(
            () => provider.executeQuery('SELECT 1'),
            /Not connected to database/
        );
    });

    test('disconnect should not throw when not connected', async () => {
        const provider = new PostgresProvider(config);
        await provider.disconnect();
        assert.strictEqual(provider.isConnected(), false);
    });

    test('Should accept SSH config', () => {
        const sshConfig: ConnectionConfig = {
            ...config,
            ssh: {
                host: 'bastion.example.com',
                port: 22,
                username: 'ubuntu'
            }
        };
        const provider = new PostgresProvider(sshConfig);
        assert.ok(provider.config.ssh);
    });
});

suite('SQLiteProvider Unit Tests', () => {
    const config: ConnectionConfig = {
        id: 'sqlite-test',
        name: 'Test SQLite',
        type: 'sqlite',
        host: 'localhost',
        port: 0,
        username: '',
        database: ':memory:'
    };

    test('Should instantiate with config', () => {
        const provider = new SQLiteProvider(config);
        assert.strictEqual(provider.config.type, 'sqlite');
    });

    test('isConnected should return false before connect', () => {
        const provider = new SQLiteProvider(config);
        assert.strictEqual(provider.isConnected(), false);
    });

    test('Should connect to in-memory database', async () => {
        const provider = new SQLiteProvider(config);
        await provider.connect();
        assert.strictEqual(provider.isConnected(), true);
        await provider.disconnect();
        assert.strictEqual(provider.isConnected(), false);
    });

    test('Should execute basic queries on in-memory database', async () => {
        const provider = new SQLiteProvider(config);
        await provider.connect();

        // Create table
        await provider.executeQuery('CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)');

        // Insert data
        await provider.executeQuery("INSERT INTO test (id, name) VALUES (1, 'hello')");

        // Select data
        const result = await provider.executeQuery('SELECT * FROM test');
        assert.strictEqual(result.rows.length, 1);
        assert.strictEqual(result.rows[0].name, 'hello');

        await provider.disconnect();
    });

    test('Should return database list with in-memory db name', async () => {
        const provider = new SQLiteProvider(config);
        await provider.connect();

        const databases = await provider.getDatabases();
        assert.strictEqual(databases.length, 1);
        assert.strictEqual(databases[0], 'memory');

        await provider.disconnect();
    });

    test('Should return table list', async () => {
        const provider = new SQLiteProvider(config);
        await provider.connect();

        await provider.executeQuery('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)');
        await provider.executeQuery('CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT)');

        const tables = await provider.getTables('memory');
        assert.strictEqual(tables.length, 2);
        assert.ok(tables.includes('users'));
        assert.ok(tables.includes('posts'));

        await provider.disconnect();
    });

    test('Should return table schema', async () => {
        const provider = new SQLiteProvider(config);
        await provider.connect();

        await provider.executeQuery('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT)');

        const schema = await provider.getTableSchema('users');
        assert.strictEqual(schema.length, 3);

        const idCol = schema.find(c => c.name === 'id');
        assert.ok(idCol);
        assert.strictEqual(idCol.primaryKey, true);

        const nameCol = schema.find(c => c.name === 'name');
        assert.ok(nameCol);
        assert.strictEqual(nameCol.nullable, false);

        const emailCol = schema.find(c => c.name === 'email');
        assert.ok(emailCol);
        assert.strictEqual(emailCol.nullable, true);

        await provider.disconnect();
    });

    test('Should reject invalid table names in getTableSchema', async () => {
        const provider = new SQLiteProvider(config);
        await provider.connect();

        await assert.rejects(
            () => provider.getTableSchema("users'; DROP TABLE users; --"),
            /Invalid table name/
        );

        await provider.disconnect();
    });

    test('Should reject invalid table names in getCreateTableStatement', async () => {
        const provider = new SQLiteProvider(config);
        await provider.connect();

        await assert.rejects(
            () => provider.getCreateTableStatement("users'; DROP TABLE users; --"),
            /Invalid table name/
        );

        await provider.disconnect();
    });

    test('Should reject invalid table names in getForeignKeys', async () => {
        const provider = new SQLiteProvider(config);
        await provider.connect();

        await assert.rejects(
            () => provider.getForeignKeys("users'; DROP TABLE users; --"),
            /Invalid table name/
        );

        await provider.disconnect();
    });

    test('Should get CREATE TABLE statement', async () => {
        const provider = new SQLiteProvider(config);
        await provider.connect();

        await provider.executeQuery('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL)');

        const createStmt = await provider.getCreateTableStatement('users');
        assert.ok(createStmt.includes('CREATE TABLE'));
        assert.ok(createStmt.includes('users'));

        await provider.disconnect();
    });

    test('Should handle foreign keys', async () => {
        const provider = new SQLiteProvider(config);
        await provider.connect();

        await provider.executeQuery('PRAGMA foreign_keys = ON');
        await provider.executeQuery('CREATE TABLE authors (id INTEGER PRIMARY KEY, name TEXT)');
        await provider.executeQuery('CREATE TABLE books (id INTEGER PRIMARY KEY, title TEXT, author_id INTEGER REFERENCES authors(id))');

        const fks = await provider.getForeignKeys('books');
        assert.strictEqual(fks.length, 1);
        assert.strictEqual(fks[0].referencedTable, 'authors');
        assert.strictEqual(fks[0].referencedColumn, 'id');
        assert.strictEqual(fks[0].columnName, 'author_id');

        await provider.disconnect();
    });

    test('Should count modified rows for write operations', async () => {
        const provider = new SQLiteProvider(config);
        await provider.connect();

        await provider.executeQuery('CREATE TABLE items (id INTEGER PRIMARY KEY, val TEXT)');
        await provider.executeQuery("INSERT INTO items VALUES (1, 'a')");
        await provider.executeQuery("INSERT INTO items VALUES (2, 'b')");
        await provider.executeQuery("INSERT INTO items VALUES (3, 'c')");

        const result = await provider.executeQuery("DELETE FROM items WHERE id > 1");
        assert.strictEqual(result.rowCount, 2);

        await provider.disconnect();
    });

    test('Should throw on non-existent database file', async () => {
        const fileConfig: ConnectionConfig = {
            ...config,
            database: '/non/existent/path/database.db'
        };
        const provider = new SQLiteProvider(fileConfig);
        await assert.rejects(
            () => provider.connect(),
            /Database file not found/
        );
    });

    test('Should throw on query execution error', async () => {
        const provider = new SQLiteProvider(config);
        await provider.connect();

        await assert.rejects(
            () => provider.executeQuery('SELECT * FROM nonexistent_table'),
            /Query execution failed/
        );

        await provider.disconnect();
    });
});

suite('H2Provider Unit Tests', () => {
    const config: ConnectionConfig = {
        id: 'h2-test',
        name: 'Test H2',
        type: 'h2',
        host: 'localhost',
        port: 5435,
        username: 'sa',
        password: '',
        h2Mode: {
            protocol: 'tcp',
            dbType: 'mem',
            dbPath: 'testdb'
        }
    };

    test('Should instantiate with config', () => {
        const provider = new H2Provider(config);
        assert.strictEqual(provider.config.type, 'h2');
        assert.strictEqual(provider.config.port, 5435);
    });

    test('isConnected should return false before connect', () => {
        const provider = new H2Provider(config);
        assert.strictEqual(provider.isConnected(), false);
    });

    test('executeQuery should throw when not connected', async () => {
        const provider = new H2Provider(config);
        await assert.rejects(
            () => provider.executeQuery('SELECT 1'),
            /Not connected to database/
        );
    });

    test('getTables should throw when not connected', async () => {
        const provider = new H2Provider(config);
        await assert.rejects(
            () => provider.getTables('PUBLIC'),
            /Not connected to database/
        );
    });

    test('getTableSchema should throw when not connected', async () => {
        const provider = new H2Provider(config);
        await assert.rejects(
            () => provider.getTableSchema('users'),
            /Not connected to database/
        );
    });

    test('getForeignKeys should throw when not connected', async () => {
        const provider = new H2Provider(config);
        await assert.rejects(
            () => provider.getForeignKeys('users'),
            /Not connected to database/
        );
    });

    test('disconnect should not throw when not connected', async () => {
        const provider = new H2Provider(config);
        await provider.disconnect();
        assert.strictEqual(provider.isConnected(), false);
    });

    test('Should handle in-memory mode config', () => {
        const memConfig: ConnectionConfig = {
            ...config,
            h2Mode: { protocol: 'tcp', dbType: 'mem', dbPath: 'mydb' }
        };
        const provider = new H2Provider(memConfig);
        assert.strictEqual(provider.config.h2Mode?.dbType, 'mem');
    });

    test('Should handle file mode config', () => {
        const fileConfig: ConnectionConfig = {
            ...config,
            h2Mode: { protocol: 'tcp', dbType: 'file', dbPath: '~/mydb' }
        };
        const provider = new H2Provider(fileConfig);
        assert.strictEqual(provider.config.h2Mode?.dbType, 'file');
        assert.strictEqual(provider.config.h2Mode?.dbPath, '~/mydb');
    });

    test('Should handle SSL protocol config', () => {
        const sslConfig: ConnectionConfig = {
            ...config,
            h2Mode: { protocol: 'ssl', dbType: 'mem' }
        };
        const provider = new H2Provider(sslConfig);
        assert.strictEqual(provider.config.h2Mode?.protocol, 'ssl');
    });
});

suite('RedisProvider Unit Tests', () => {
    const config: ConnectionConfig = {
        id: 'redis-test',
        name: 'Test Redis',
        type: 'redis',
        host: 'localhost',
        port: 6379,
        username: '',
    };

    test('Should instantiate with config', () => {
        const provider = new RedisProvider(config);
        assert.strictEqual(provider.config.type, 'redis');
        assert.strictEqual(provider.config.port, 6379);
    });

    test('isConnected should return false before connect', () => {
        const provider = new RedisProvider(config);
        assert.strictEqual(provider.isConnected(), false);
    });

    test('executeQuery should throw when not connected', async () => {
        const provider = new RedisProvider(config);
        await assert.rejects(
            () => provider.executeQuery('PING'),
            /Not connected to database/
        );
    });

    test('getDatabases should return db0 through db15', async () => {
        const provider = new RedisProvider(config);
        const databases = await provider.getDatabases();
        assert.strictEqual(databases.length, 16);
        assert.strictEqual(databases[0], 'db0');
        assert.strictEqual(databases[15], 'db15');
    });
});

suite('MongoDBProvider Unit Tests', () => {
    const config: ConnectionConfig = {
        id: 'mongo-test',
        name: 'Test MongoDB',
        type: 'mongodb',
        host: 'localhost',
        port: 27017,
        username: 'admin',
        password: 'password',
        database: 'testdb'
    };

    test('Should instantiate with config', () => {
        const provider = new MongoDBProvider(config);
        assert.strictEqual(provider.config.type, 'mongodb');
        assert.strictEqual(provider.config.port, 27017);
    });

    test('isConnected should return false before connect', () => {
        const provider = new MongoDBProvider(config);
        assert.strictEqual(provider.isConnected(), false);
    });

    test('executeQuery should throw when not connected', async () => {
        const provider = new MongoDBProvider(config);
        await assert.rejects(
            () => provider.executeQuery('{"ping": 1}'),
            /Not connected to database/
        );
    });

    test('disconnect should not throw when not connected', async () => {
        const provider = new MongoDBProvider(config);
        await provider.disconnect();
        assert.strictEqual(provider.isConnected(), false);
    });
});
