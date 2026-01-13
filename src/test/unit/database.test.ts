import * as assert from 'assert';
import { ConnectionConfig, DatabaseType } from '../../types/database';

suite('Database Types Unit Tests', () => {
    const supportedTypes: DatabaseType[] = ['mysql', 'postgres', 'sqlite', 'mongodb', 'redis'];

    test('Should have all supported database types', () => {
        assert.strictEqual(supportedTypes.length, 5);
        assert.ok(supportedTypes.includes('mysql'));
        assert.ok(supportedTypes.includes('postgres'));
        assert.ok(supportedTypes.includes('sqlite'));
        assert.ok(supportedTypes.includes('mongodb'));
        assert.ok(supportedTypes.includes('redis'));
    });

    test('ConnectionConfig should have required fields', () => {
        const config: ConnectionConfig = {
            id: 'test-id',
            name: 'Test Connection',
            type: 'mysql',
            host: 'localhost',
            port: 3306,
            username: 'root',
            password: 'password',
            database: 'testdb'
        };

        assert.ok(config.id);
        assert.ok(config.name);
        assert.ok(config.type);
        assert.ok(config.host);
        assert.strictEqual(typeof config.port, 'number');
    });

    test('Default ports should be correct', () => {
        const defaultPorts: Record<DatabaseType, number> = {
            mysql: 3306,
            postgres: 5432,
            sqlite: 0,
            mongodb: 27017,
            redis: 6379,
            h2: 5435
        };

        assert.strictEqual(defaultPorts.mysql, 3306);
        assert.strictEqual(defaultPorts.postgres, 5432);
        assert.strictEqual(defaultPorts.sqlite, 0);
        assert.strictEqual(defaultPorts.mongodb, 27017);
        assert.strictEqual(defaultPorts.redis, 6379);
        assert.strictEqual(defaultPorts.h2, 5435);
    });

    test('SSH config should be optional', () => {
        const configWithoutSSH: ConnectionConfig = {
            id: 'test-id',
            name: 'Test Connection',
            type: 'mysql',
            host: 'localhost',
            port: 3306,
            username: 'root'
        };

        const configWithSSH: ConnectionConfig = {
            id: 'test-id',
            name: 'Test Connection',
            type: 'mysql',
            host: 'localhost',
            port: 3306,
            username: 'root',
            ssh: {
                host: 'bastion.example.com',
                port: 22,
                username: 'ubuntu'
            }
        };

        assert.strictEqual(configWithoutSSH.ssh, undefined);
        assert.ok(configWithSSH.ssh);
        assert.strictEqual(configWithSSH.ssh.host, 'bastion.example.com');
    });
});
