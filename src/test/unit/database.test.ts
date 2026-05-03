import * as assert from 'assert';
import { ConnectionConfig, DatabaseType, RoutineInfo, RoutineType, TreeItemType } from '../../types/database';

suite('Database Types Unit Tests', () => {
    const supportedTypes: DatabaseType[] = ['mysql', 'postgres', 'sqlite', 'mongodb', 'redis', 'h2'];

    test('Should have all supported database types', () => {
        assert.strictEqual(supportedTypes.length, 6);
        assert.ok(supportedTypes.includes('mysql'));
        assert.ok(supportedTypes.includes('postgres'));
        assert.ok(supportedTypes.includes('sqlite'));
        assert.ok(supportedTypes.includes('mongodb'));
        assert.ok(supportedTypes.includes('redis'));
        assert.ok(supportedTypes.includes('h2'));
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

// ══════════════════════════════════════════════════
// v3.2.0 — Routine Browser Types
// ══════════════════════════════════════════════════

suite('Routine Browser Types', () => {
    test('TreeItemType should include routine-group and routine', () => {
        const validTypes: TreeItemType[] = [
            'connection', 'database', 'table', 'column', 'group',
            'routine-group', 'routine',
        ];
        assert.strictEqual(validTypes.length, 7);
        assert.ok(validTypes.includes('routine-group'));
        assert.ok(validTypes.includes('routine'));
    });

    test('RoutineType should have 4 valid values', () => {
        const types: RoutineType[] = ['procedure', 'function', 'view', 'trigger'];
        assert.strictEqual(types.length, 4);
    });

    test('RoutineInfo should have required fields', () => {
        const info: RoutineInfo = {
            name: 'sp_test',
            type: 'procedure',
            source: 'CREATE PROCEDURE sp_test() BEGIN SELECT 1; END;',
            database: 'mydb',
            definer: 'root@localhost',
            parameters: [
                { name: 'p_id', dataType: 'INT', mode: 'IN', ordinalPosition: 0 },
            ],
            returnType: undefined,
        };
        assert.strictEqual(info.name, 'sp_test');
        assert.strictEqual(info.type, 'procedure');
        assert.ok(info.source.includes('CREATE'));
        assert.strictEqual(info.parameters.length, 1);
    });

    test('RoutineInfo for view should have empty parameters', () => {
        const info: RoutineInfo = {
            name: 'vw_users',
            type: 'view',
            source: 'CREATE VIEW vw_users AS SELECT * FROM users',
            parameters: [],
        };
        assert.strictEqual(info.type, 'view');
        assert.strictEqual(info.parameters.length, 0);
    });

    test('RoutineInfo for function should have returnType', () => {
        const info: RoutineInfo = {
            name: 'fn_add',
            type: 'function',
            source: '',
            parameters: [],
            returnType: 'INT',
        };
        assert.strictEqual(info.returnType, 'INT');
    });

    test('RoutineParameter modes should be IN/OUT/INOUT', () => {
        const modes = ['IN', 'OUT', 'INOUT'] as const;
        assert.strictEqual(modes.length, 3);
    });
});
