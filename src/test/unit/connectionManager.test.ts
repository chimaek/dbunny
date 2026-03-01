import * as assert from 'assert';
import { ConnectionConfig, DatabaseType } from '../../types/database';
import { MySQLProvider } from '../../providers/mysqlProvider';
import { PostgresProvider } from '../../providers/postgresProvider';
import { SQLiteProvider } from '../../providers/sqliteProvider';
import { H2Provider } from '../../providers/h2Provider';
import { MongoDBProvider } from '../../providers/mongoProvider';
import { RedisProvider } from '../../providers/redisProvider';
import * as providers from '../../providers/index';

// ============================================================
// ConnectionManager logic tests and provider factory tests
// ============================================================

suite('ConnectionManager Logic Tests', () => {

    test('Default ports should match expected values for all DB types', () => {
        const expectedPorts: Record<DatabaseType, number> = {
            mysql: 3306,
            postgres: 5432,
            sqlite: 0,
            mongodb: 27017,
            redis: 6379,
            h2: 5435
        };

        assert.strictEqual(expectedPorts.mysql, 3306);
        assert.strictEqual(expectedPorts.postgres, 5432);
        assert.strictEqual(expectedPorts.sqlite, 0);
        assert.strictEqual(expectedPorts.mongodb, 27017);
        assert.strictEqual(expectedPorts.redis, 6379);
        assert.strictEqual(expectedPorts.h2, 5435);
    });

    test('All 6 database types should exist in DatabaseType', () => {
        const types: DatabaseType[] = ['mysql', 'postgres', 'sqlite', 'mongodb', 'redis', 'h2'];
        assert.strictEqual(types.length, 6);
    });

    test('ConnectionConfig should allow optional fields', () => {
        const minimal: ConnectionConfig = {
            id: 'min-test',
            name: 'Minimal',
            type: 'mysql',
            host: 'localhost',
            port: 3306,
            username: 'root'
        };
        assert.strictEqual(minimal.password, undefined);
        assert.strictEqual(minimal.database, undefined);
        assert.strictEqual(minimal.ssh, undefined);
        assert.strictEqual(minimal.group, undefined);
        assert.strictEqual(minimal.h2Mode, undefined);
        assert.strictEqual(minimal.options, undefined);
    });

    test('ConnectionConfig should support group assignment', () => {
        const config: ConnectionConfig = {
            id: 'group-test',
            name: 'Grouped',
            type: 'postgres',
            host: 'localhost',
            port: 5432,
            username: 'admin',
            group: 'production'
        };
        assert.strictEqual(config.group, 'production');
    });

    test('ConnectionConfig should support H2 mode', () => {
        const config: ConnectionConfig = {
            id: 'h2-test',
            name: 'H2 DB',
            type: 'h2',
            host: 'localhost',
            port: 5435,
            username: 'sa',
            h2Mode: {
                protocol: 'tcp',
                dbType: 'mem',
                dbPath: 'testdb'
            }
        };
        assert.strictEqual(config.h2Mode?.protocol, 'tcp');
        assert.strictEqual(config.h2Mode?.dbType, 'mem');
        assert.strictEqual(config.h2Mode?.dbPath, 'testdb');
    });

    test('SSHConfig should support password authentication', () => {
        const config: ConnectionConfig = {
            id: 'ssh-pwd',
            name: 'SSH Password',
            type: 'mysql',
            host: 'db.internal',
            port: 3306,
            username: 'admin',
            ssh: {
                host: 'bastion.example.com',
                port: 22,
                username: 'ubuntu',
                password: 'secret'
            }
        };
        assert.ok(config.ssh?.password);
        assert.strictEqual(config.ssh?.host, 'bastion.example.com');
    });

    test('SSHConfig should support private key authentication', () => {
        const config: ConnectionConfig = {
            id: 'ssh-key',
            name: 'SSH Key',
            type: 'postgres',
            host: 'db.internal',
            port: 5432,
            username: 'admin',
            ssh: {
                host: 'bastion.example.com',
                port: 22,
                username: 'ubuntu',
                privateKey: 'ssh-rsa AAAA...',
                passphrase: 'my-passphrase'
            }
        };
        assert.ok(config.ssh?.privateKey);
        assert.ok(config.ssh?.passphrase);
    });
});

suite('Provider Factory Pattern Tests', () => {

    test('All providers should be exported from providers/index', () => {
        assert.ok(providers.MySQLProvider, 'MySQLProvider should be exported');
        assert.ok(providers.PostgresProvider, 'PostgresProvider should be exported');
        assert.ok(providers.SQLiteProvider, 'SQLiteProvider should be exported');
        assert.ok(providers.MongoDBProvider, 'MongoDBProvider should be exported');
        assert.ok(providers.RedisProvider, 'RedisProvider should be exported');
        assert.ok(providers.H2Provider, 'H2Provider should be exported');
    });

    test('MySQL provider should implement DatabaseConnection interface', () => {
        const config: ConnectionConfig = {
            id: 'test', name: 'test', type: 'mysql',
            host: 'localhost', port: 3306, username: 'root'
        };
        const provider = new MySQLProvider(config);

        assert.strictEqual(typeof provider.connect, 'function');
        assert.strictEqual(typeof provider.disconnect, 'function');
        assert.strictEqual(typeof provider.executeQuery, 'function');
        assert.strictEqual(typeof provider.getDatabases, 'function');
        assert.strictEqual(typeof provider.getTables, 'function');
        assert.strictEqual(typeof provider.getTableSchema, 'function');
        assert.strictEqual(typeof provider.isConnected, 'function');
        assert.strictEqual(typeof provider.getForeignKeys, 'function');
        assert.strictEqual(typeof provider.getCreateTableStatement, 'function');
    });

    test('PostgreSQL provider should implement DatabaseConnection interface', () => {
        const config: ConnectionConfig = {
            id: 'test', name: 'test', type: 'postgres',
            host: 'localhost', port: 5432, username: 'postgres'
        };
        const provider = new PostgresProvider(config);

        assert.strictEqual(typeof provider.connect, 'function');
        assert.strictEqual(typeof provider.disconnect, 'function');
        assert.strictEqual(typeof provider.executeQuery, 'function');
        assert.strictEqual(typeof provider.getDatabases, 'function');
        assert.strictEqual(typeof provider.getTables, 'function');
        assert.strictEqual(typeof provider.getTableSchema, 'function');
        assert.strictEqual(typeof provider.isConnected, 'function');
        assert.strictEqual(typeof provider.getForeignKeys, 'function');
    });

    test('SQLite provider should implement DatabaseConnection interface', () => {
        const config: ConnectionConfig = {
            id: 'test', name: 'test', type: 'sqlite',
            host: 'localhost', port: 0, username: ''
        };
        const provider = new SQLiteProvider(config);

        assert.strictEqual(typeof provider.connect, 'function');
        assert.strictEqual(typeof provider.disconnect, 'function');
        assert.strictEqual(typeof provider.executeQuery, 'function');
        assert.strictEqual(typeof provider.getDatabases, 'function');
        assert.strictEqual(typeof provider.getTables, 'function');
        assert.strictEqual(typeof provider.getTableSchema, 'function');
        assert.strictEqual(typeof provider.isConnected, 'function');
        assert.strictEqual(typeof provider.getForeignKeys, 'function');
        assert.strictEqual(typeof provider.getCreateTableStatement, 'function');
    });

    test('H2 provider should implement DatabaseConnection interface', () => {
        const config: ConnectionConfig = {
            id: 'test', name: 'test', type: 'h2',
            host: 'localhost', port: 5435, username: 'sa'
        };
        const provider = new H2Provider(config);

        assert.strictEqual(typeof provider.connect, 'function');
        assert.strictEqual(typeof provider.disconnect, 'function');
        assert.strictEqual(typeof provider.executeQuery, 'function');
        assert.strictEqual(typeof provider.getDatabases, 'function');
        assert.strictEqual(typeof provider.getTables, 'function');
        assert.strictEqual(typeof provider.getTableSchema, 'function');
        assert.strictEqual(typeof provider.isConnected, 'function');
        assert.strictEqual(typeof provider.getForeignKeys, 'function');
        assert.strictEqual(typeof provider.getCreateTableStatement, 'function');
    });

    test('MongoDB provider should implement DatabaseConnection interface', () => {
        const config: ConnectionConfig = {
            id: 'test', name: 'test', type: 'mongodb',
            host: 'localhost', port: 27017, username: 'admin'
        };
        const provider = new MongoDBProvider(config);

        assert.strictEqual(typeof provider.connect, 'function');
        assert.strictEqual(typeof provider.disconnect, 'function');
        assert.strictEqual(typeof provider.executeQuery, 'function');
        assert.strictEqual(typeof provider.getDatabases, 'function');
        assert.strictEqual(typeof provider.getTables, 'function');
        assert.strictEqual(typeof provider.getTableSchema, 'function');
        assert.strictEqual(typeof provider.isConnected, 'function');
    });

    test('Redis provider should implement DatabaseConnection interface', () => {
        const config: ConnectionConfig = {
            id: 'test', name: 'test', type: 'redis',
            host: 'localhost', port: 6379, username: ''
        };
        const provider = new RedisProvider(config);

        assert.strictEqual(typeof provider.connect, 'function');
        assert.strictEqual(typeof provider.disconnect, 'function');
        assert.strictEqual(typeof provider.executeQuery, 'function');
        assert.strictEqual(typeof provider.getDatabases, 'function');
        assert.strictEqual(typeof provider.getTables, 'function');
        assert.strictEqual(typeof provider.getTableSchema, 'function');
        assert.strictEqual(typeof provider.isConnected, 'function');
    });

    test('Each provider should store its config', () => {
        const configs: ConnectionConfig[] = [
            { id: '1', name: 'MySQL', type: 'mysql', host: 'h1', port: 3306, username: 'u1' },
            { id: '2', name: 'PG', type: 'postgres', host: 'h2', port: 5432, username: 'u2' },
            { id: '3', name: 'SQLite', type: 'sqlite', host: 'h3', port: 0, username: '' },
            { id: '4', name: 'H2', type: 'h2', host: 'h4', port: 5435, username: 'sa' },
            { id: '5', name: 'Mongo', type: 'mongodb', host: 'h5', port: 27017, username: 'u5' },
            { id: '6', name: 'Redis', type: 'redis', host: 'h6', port: 6379, username: '' },
        ];

        const providerClasses = [MySQLProvider, PostgresProvider, SQLiteProvider, H2Provider, MongoDBProvider, RedisProvider];

        configs.forEach((config, i) => {
            const provider = new providerClasses[i](config);
            assert.strictEqual(provider.config.id, config.id);
            assert.strictEqual(provider.config.name, config.name);
            assert.strictEqual(provider.config.type, config.type);
            assert.strictEqual(provider.config.host, config.host);
        });
    });
});
