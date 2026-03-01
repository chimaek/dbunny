import * as assert from 'assert';
import { SQLiteProvider } from '../../providers/sqliteProvider';
import { RedisProvider } from '../../providers/redisProvider';
import { ConnectionConfig } from '../../types/database';

// ============================================================
// Security-focused tests: SQL injection, XSS prevention,
// identifier validation, URL encoding, destructive cmd blocking
// ============================================================

suite('SQL Injection Prevention Tests', () => {
    const sqliteConfig: ConnectionConfig = {
        id: 'security-test',
        name: 'Security Test',
        type: 'sqlite',
        host: 'localhost',
        port: 0,
        username: '',
        database: ':memory:'
    };

    test('SQLite: getTableSchema should reject SQL injection in table name', async () => {
        const provider = new SQLiteProvider(sqliteConfig);
        await provider.connect();

        const maliciousNames = [
            "users'; DROP TABLE users; --",
            "users' OR '1'='1",
            "users\"); DROP TABLE users; --",
            "users`; DROP TABLE users; --",
            "'; SELECT * FROM sqlite_master; --"
        ];

        for (const name of maliciousNames) {
            await assert.rejects(
                () => provider.getTableSchema(name),
                /Invalid table name/,
                `Should reject table name: ${name}`
            );
        }

        await provider.disconnect();
    });

    test('SQLite: getCreateTableStatement should reject SQL injection', async () => {
        const provider = new SQLiteProvider(sqliteConfig);
        await provider.connect();

        await assert.rejects(
            () => provider.getCreateTableStatement("test'; DROP TABLE test; --"),
            /Invalid table name/
        );

        await provider.disconnect();
    });

    test('SQLite: getForeignKeys should reject SQL injection', async () => {
        const provider = new SQLiteProvider(sqliteConfig);
        await provider.connect();

        await assert.rejects(
            () => provider.getForeignKeys("test'; DROP TABLE test; --"),
            /Invalid table name/
        );

        await provider.disconnect();
    });

    test('SQLite: Valid table names should be accepted', async () => {
        const provider = new SQLiteProvider(sqliteConfig);
        await provider.connect();

        await provider.executeQuery('CREATE TABLE valid_table_123 (id INTEGER PRIMARY KEY)');

        const schema = await provider.getTableSchema('valid_table_123');
        assert.ok(schema.length > 0);

        await provider.disconnect();
    });

    test('SQLite: Table names with underscores and numbers should pass', async () => {
        const provider = new SQLiteProvider(sqliteConfig);
        await provider.connect();

        await provider.executeQuery('CREATE TABLE my_table_2 (id INTEGER PRIMARY KEY)');
        const schema = await provider.getTableSchema('my_table_2');
        assert.ok(schema.length > 0);

        await provider.disconnect();
    });

    test('SQLite: Table names with dots should be accepted (schema.table notation)', async () => {
        const provider = new SQLiteProvider(sqliteConfig);
        await provider.connect();

        // schema.table notation should pass validation
        // It may fail at SQLite level, but should NOT throw "Invalid table name"
        try {
            await provider.getTableSchema('main.nonexistent');
        } catch (error) {
            const msg = error instanceof Error ? error.message : '';
            assert.ok(!msg.includes('Invalid table name'), 'Should accept dot notation');
        }

        await provider.disconnect();
    });

    test('SQLite: Table names with spaces should be rejected', async () => {
        const provider = new SQLiteProvider(sqliteConfig);
        await provider.connect();

        await assert.rejects(
            () => provider.getTableSchema('my table'),
            /Invalid table name/
        );

        await provider.disconnect();
    });
});

suite('Redis Security Tests', () => {
    const redisConfig: ConnectionConfig = {
        id: 'redis-security-test',
        name: 'Redis Security',
        type: 'redis',
        host: 'localhost',
        port: 6379,
        username: 'user@domain',
        password: 'p@ss:w0rd/special&chars=yes',
    };

    test('Redis: Should instantiate with special character credentials', () => {
        const provider = new RedisProvider(redisConfig);
        assert.ok(provider);
        assert.strictEqual(provider.config.password, 'p@ss:w0rd/special&chars=yes');
    });

    test('Redis: getDatabases should return 16 databases', async () => {
        const provider = new RedisProvider(redisConfig);
        const dbs = await provider.getDatabases();
        assert.strictEqual(dbs.length, 16);
        assert.strictEqual(dbs[0], 'db0');
        assert.strictEqual(dbs[15], 'db15');
    });
});

suite('HTML Escaping Tests', () => {
    // This function mirrors the _escapeHtml implementations in
    // TableEditorPanel and ConnectionFormPanel
    function escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    test('Should escape script tags', () => {
        assert.strictEqual(
            escapeHtml('<script>alert("xss")</script>'),
            '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
        );
    });

    test('Should escape ampersand', () => {
        assert.strictEqual(escapeHtml('a&b'), 'a&amp;b');
    });

    test('Should escape single quotes', () => {
        assert.strictEqual(escapeHtml("it's"), 'it&#039;s');
    });

    test('Should escape double quotes', () => {
        assert.strictEqual(escapeHtml('say "hello"'), 'say &quot;hello&quot;');
    });

    test('Should handle empty string', () => {
        assert.strictEqual(escapeHtml(''), '');
    });

    test('Should not alter safe text', () => {
        assert.strictEqual(escapeHtml('hello world 123'), 'hello world 123');
    });

    test('Should escape img/onerror injection', () => {
        const malicious = '"><img src=x onerror=alert(1)>';
        const escaped = escapeHtml(malicious);
        assert.ok(!escaped.includes('<img'));
        assert.ok(!escaped.includes('onerror'));
        assert.ok(escaped.includes('&lt;img'));
    });

    test('Should escape event handler injection', () => {
        const malicious = "' onmouseover='alert(1)'";
        const escaped = escapeHtml(malicious);
        assert.ok(!escaped.includes("onmouseover"));
        assert.ok(escaped.includes('&#039;'));
    });

    test('Should escape all five special chars in one string', () => {
        const input = `<div class="a" id='b'>&`;
        const expected = '&lt;div class=&quot;a&quot; id=&#039;b&#039;&gt;&amp;';
        assert.strictEqual(escapeHtml(input), expected);
    });
});

suite('Identifier Escaping Tests', () => {
    // Mirrors _escapeIdentifier from TableEditorPanel for each DB type

    function escapeIdentifierMySQL(name: string): string {
        return `\`${name.replace(/`/g, '``')}\``;
    }

    function escapeIdentifierPostgres(name: string): string {
        if (name.includes('.')) {
            const parts = name.split('.');
            return parts.map(p => `"${p.replace(/"/g, '""')}"`).join('.');
        }
        return `"${name.replace(/"/g, '""')}"`;
    }

    function escapeIdentifierSQLite(name: string): string {
        return `"${name.replace(/"/g, '""')}"`;
    }

    test('MySQL: Should escape backticks in identifier', () => {
        assert.strictEqual(escapeIdentifierMySQL('my`table'), '`my``table`');
    });

    test('MySQL: Should wrap normal identifier', () => {
        assert.strictEqual(escapeIdentifierMySQL('users'), '`users`');
    });

    test('MySQL: Should handle empty backtick', () => {
        assert.strictEqual(escapeIdentifierMySQL('``'), '`````````');
    });

    test('PostgreSQL: Should escape double quotes in identifier', () => {
        assert.strictEqual(escapeIdentifierPostgres('my"table'), '"my""table"');
    });

    test('PostgreSQL: Should handle schema.table format', () => {
        assert.strictEqual(escapeIdentifierPostgres('public.users'), '"public"."users"');
    });

    test('PostgreSQL: Should handle schema.table with quotes', () => {
        assert.strictEqual(escapeIdentifierPostgres('my"schema.my"table'), '"my""schema"."my""table"');
    });

    test('SQLite: Should use double quotes', () => {
        assert.strictEqual(escapeIdentifierSQLite('my table'), '"my table"');
    });

    test('SQLite: Should escape double quotes', () => {
        assert.strictEqual(escapeIdentifierSQLite('my"table'), '"my""table"');
    });
});

suite('Value Escaping Tests', () => {
    // Mirrors _escapeValue from TableEditorPanel

    function escapeValue(value: unknown): string {
        if (value === null || value === undefined) { return 'NULL'; }
        if (typeof value === 'number') { return String(value); }
        if (typeof value === 'boolean') { return value ? '1' : '0'; }
        return `'${String(value).replace(/'/g, "''")}'`;
    }

    test('Should handle null', () => {
        assert.strictEqual(escapeValue(null), 'NULL');
    });

    test('Should handle undefined', () => {
        assert.strictEqual(escapeValue(undefined), 'NULL');
    });

    test('Should handle numbers', () => {
        assert.strictEqual(escapeValue(42), '42');
        assert.strictEqual(escapeValue(3.14), '3.14');
        assert.strictEqual(escapeValue(0), '0');
        assert.strictEqual(escapeValue(-1), '-1');
    });

    test('Should handle boolean', () => {
        assert.strictEqual(escapeValue(true), '1');
        assert.strictEqual(escapeValue(false), '0');
    });

    test('Should handle plain string', () => {
        assert.strictEqual(escapeValue('hello'), "'hello'");
    });

    test('Should escape single quotes in string', () => {
        assert.strictEqual(escapeValue("it's"), "'it''s'");
    });

    test('Should escape consecutive single quotes', () => {
        // Input: '' (two single quotes)
        // Each ' becomes '' -> result: ''''
        // Wrapped in quotes: ''''''
        assert.strictEqual(escapeValue("''"), "''''''");
    });

    test('Should handle empty string', () => {
        assert.strictEqual(escapeValue(''), "''");
    });

    test('Should handle string with SQL injection attempt', () => {
        const result = escapeValue("'; DROP TABLE users; --");
        assert.strictEqual(result, "'''; DROP TABLE users; --'");
    });
});
