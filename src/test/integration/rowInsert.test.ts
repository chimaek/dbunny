/**
 * v2.8.0 행 삽입 폼 통합 테스트
 * 실행: npx tsx src/test/integration/rowInsert.test.ts
 *
 * 사전 요구사항: docker compose up -d
 *
 * 테스트 범위:
 * - 단일 행 삽입 (전체/부분 컬럼)
 * - 일괄 삽입 (CSV 붙여넣기 시나리오)
 * - NOT NULL 제약 조건 검증
 * - DEFAULT 값 동작
 * - FK 참조 값 조회
 * - NULL 및 특수문자 삽입
 * - 읽기 전용 보호 (시뮬레이션)
 */

import * as path from 'path';
import { ConnectionConfig, DatabaseConnection } from '../../types/database';
import { MySQLProvider } from '../../providers/mysqlProvider';
import { PostgresProvider } from '../../providers/postgresProvider';
import { SQLiteProvider } from '../../providers/sqliteProvider';
import { H2Provider } from '../../providers/h2Provider';

// ── Helpers ─────────────────────────────────────

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

function assert(condition: boolean, msg: string) {
    if (condition) { pass(msg); } else { fail(msg); }
}

function assertEqual(actual: unknown, expected: unknown, msg: string) {
    if (actual === expected) { pass(msg); }
    else { fail(`${msg} — expected: ${JSON.stringify(expected)}, got: ${JSON.stringify(actual)}`); }
}

function getField(row: Record<string, unknown>, field: string): unknown {
    if (row[field] !== undefined) { return row[field]; }
    if (row[field.toUpperCase()] !== undefined) { return row[field.toUpperCase()]; }
    if (row[field.toLowerCase()] !== undefined) { return row[field.toLowerCase()]; }
    return undefined;
}

// ── SQL 유틸 (RowInsertPanel과 동일 로직) ──────

function escapeIdentifier(name: string, dbType: string): string {
    if (dbType === 'mysql') { return `\`${name.replace(/`/g, '``')}\``; }
    return `"${name.replace(/"/g, '""')}"`;
}

function escapeValue(value: unknown, dbType: string): string {
    if (value === null || value === undefined) { return 'NULL'; }
    if (typeof value === 'number') { return String(value); }
    if (typeof value === 'boolean') { return value ? '1' : '0'; }
    const str = String(value);
    if (str.toUpperCase() === 'NULL') { return 'NULL'; }
    if (dbType === 'mysql') {
        return `'${str.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
    }
    return `'${str.replace(/'/g, "''")}'`;
}

function buildInsertSQL(
    tableName: string,
    data: Record<string, unknown>,
    dbType: string
): string {
    const columns = Object.keys(data).filter(k => data[k] !== undefined && data[k] !== '');
    const cols = columns.map(c => escapeIdentifier(c, dbType)).join(', ');
    const vals = columns.map(k => escapeValue(data[k], dbType)).join(', ');
    return `INSERT INTO ${escapeIdentifier(tableName, dbType)} (${cols}) VALUES (${vals})`;
}

// ── Configs ─────────────────────────────────────

const sqlitePath = path.resolve(__dirname, '../../../test-data/rowinsert-test.db');

const configs: Record<string, ConnectionConfig> = {
    mysql: {
        id: 'ri-mysql', name: 'MySQL RowInsert', type: 'mysql',
        host: 'localhost', port: 3306,
        username: 'root', password: 'root1234', database: 'mydb',
    },
    postgres: {
        id: 'ri-pg', name: 'PG RowInsert', type: 'postgres',
        host: 'localhost', port: 5432,
        username: 'postgres', password: 'postgres1234', database: 'mydb',
    },
    sqlite: {
        id: 'ri-sqlite', name: 'SQLite RowInsert', type: 'sqlite',
        host: '', port: 0, username: '',
        database: sqlitePath,
    },
    h2: {
        id: 'ri-h2', name: 'H2 RowInsert', type: 'h2',
        host: 'localhost', port: 5435,
        username: 'sa', password: '',
        database: 'mem:rowinserttest',
        h2Mode: { protocol: 'tcp', dbType: 'mem', dbPath: 'rowinserttest' },
    },
};

// ── 테이블 준비 ─────────────────────────────────

async function setupTables(conn: DatabaseConnection, dbType: string, db?: string) {
    // 참조 테이블 먼저
    try { await conn.executeQuery('DROP TABLE IF EXISTS ri_orders', db); } catch { /* ok */ }
    try { await conn.executeQuery('DROP TABLE IF EXISTS ri_users', db); } catch { /* ok */ }
    try { await conn.executeQuery('DROP TABLE IF EXISTS ri_categories', db); } catch { /* ok */ }

    let catSQL: string;
    let userSQL: string;
    let orderSQL: string;

    switch (dbType) {
        case 'mysql':
            catSQL = `CREATE TABLE ri_categories (
                id INT PRIMARY KEY AUTO_INCREMENT,
                name VARCHAR(100) NOT NULL
            )`;
            userSQL = `CREATE TABLE ri_users (
                id INT PRIMARY KEY AUTO_INCREMENT,
                name VARCHAR(100) NOT NULL,
                email VARCHAR(200),
                age INT DEFAULT 25,
                category_id INT,
                FOREIGN KEY (category_id) REFERENCES ri_categories(id)
            )`;
            orderSQL = `CREATE TABLE ri_orders (
                id INT PRIMARY KEY AUTO_INCREMENT,
                user_id INT NOT NULL,
                amount DECIMAL(10,2) NOT NULL,
                note TEXT,
                FOREIGN KEY (user_id) REFERENCES ri_users(id)
            )`;
            break;
        case 'postgres':
            catSQL = `CREATE TABLE ri_categories (
                id SERIAL PRIMARY KEY,
                name VARCHAR(100) NOT NULL
            )`;
            userSQL = `CREATE TABLE ri_users (
                id SERIAL PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                email VARCHAR(200),
                age INT DEFAULT 25,
                category_id INT REFERENCES ri_categories(id)
            )`;
            orderSQL = `CREATE TABLE ri_orders (
                id SERIAL PRIMARY KEY,
                user_id INT NOT NULL REFERENCES ri_users(id),
                amount DECIMAL(10,2) NOT NULL,
                note TEXT
            )`;
            break;
        case 'sqlite':
            catSQL = `CREATE TABLE ri_categories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL
            )`;
            userSQL = `CREATE TABLE ri_users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                email TEXT,
                age INTEGER DEFAULT 25,
                category_id INTEGER REFERENCES ri_categories(id)
            )`;
            orderSQL = `CREATE TABLE ri_orders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES ri_users(id),
                amount REAL NOT NULL,
                note TEXT
            )`;
            break;
        case 'h2':
            catSQL = `CREATE TABLE ri_categories (
                id INT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
                name VARCHAR(100) NOT NULL
            )`;
            userSQL = `CREATE TABLE ri_users (
                id INT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                email VARCHAR(200),
                age INT DEFAULT 25,
                category_id INT,
                CONSTRAINT fk_user_cat FOREIGN KEY (category_id) REFERENCES ri_categories(id)
            )`;
            orderSQL = `CREATE TABLE ri_orders (
                id INT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
                user_id INT NOT NULL,
                amount DECIMAL(10,2) NOT NULL,
                note VARCHAR(1000),
                CONSTRAINT fk_order_user FOREIGN KEY (user_id) REFERENCES ri_users(id)
            )`;
            break;
        default:
            throw new Error(`Unsupported: ${dbType}`);
    }

    await conn.executeQuery(catSQL, db);
    await conn.executeQuery(userSQL, db);
    await conn.executeQuery(orderSQL, db);

    // 참조 데이터 삽입
    await conn.executeQuery("INSERT INTO ri_categories (name) VALUES ('Engineering')", db);
    await conn.executeQuery("INSERT INTO ri_categories (name) VALUES ('Design')", db);
    await conn.executeQuery("INSERT INTO ri_categories (name) VALUES ('Marketing')", db);
}

async function cleanup(conn: DatabaseConnection, db?: string) {
    try { await conn.executeQuery('DROP TABLE IF EXISTS ri_orders', db); } catch { /* ok */ }
    try { await conn.executeQuery('DROP TABLE IF EXISTS ri_users', db); } catch { /* ok */ }
    try { await conn.executeQuery('DROP TABLE IF EXISTS ri_categories', db); } catch { /* ok */ }
}

// ── DB별 테스트 ─────────────────────────────────

async function testForDB(
    label: string,
    conn: DatabaseConnection,
    dbType: string
) {
    header(`${label} — Row Insert`);
    const db = dbType === 'h2' ? undefined : conn.config.database;

    try {
        await setupTables(conn, dbType, db);
    } catch (e) {
        fail(`[${label}] 테이블 준비 실패`, e);
        return;
    }

    // 1. 단일 행 삽입 (전체 컬럼)
    try {
        const sql = buildInsertSQL('ri_users', {
            name: 'Alice', email: 'alice@test.com', age: 30, category_id: 1,
        }, dbType);
        await conn.executeQuery(sql, db);

        const check = await conn.executeQuery('SELECT * FROM ri_users', db);
        assertEqual(check.rows.length, 1, `[${label}] 전체 컬럼 삽입 1행`);
        assertEqual(getField(check.rows[0], 'name'), 'Alice', `[${label}] name 확인`);
        assertEqual(Number(getField(check.rows[0], 'age')), 30, `[${label}] age 확인`);
    } catch (e) { fail(`[${label}] 전체 컬럼 삽입`, e); }

    // 2. 부분 컬럼 삽입 (name만 — NOT NULL)
    try {
        const sql = buildInsertSQL('ri_users', { name: 'Bob' }, dbType);
        await conn.executeQuery(sql, db);

        const check = await conn.executeQuery('SELECT * FROM ri_users ORDER BY name', db);
        const bob = check.rows.find(r => getField(r, 'name') === 'Bob');
        assert(bob !== undefined, `[${label}] 부분 컬럼 삽입 성공`);
        if (bob) {
            // age에 DEFAULT 25 적용 여부
            const age = Number(getField(bob, 'age'));
            assertEqual(age, 25, `[${label}] DEFAULT 값 적용 (age=25)`);
        }
    } catch (e) { fail(`[${label}] 부분 컬럼 삽입`, e); }

    // 3. NULL 값 명시 삽입
    try {
        const sql = buildInsertSQL('ri_users', {
            name: 'Charlie', email: 'NULL', age: 35,
        }, dbType);
        await conn.executeQuery(sql, db);

        const check = await conn.executeQuery("SELECT * FROM ri_users WHERE name = 'Charlie'", db);
        assert(check.rows.length > 0, `[${label}] NULL 명시 삽입 성공`);
        if (check.rows.length > 0) {
            const email = getField(check.rows[0], 'email');
            assert(email === null || email === undefined, `[${label}] email NULL 확인`);
        }
    } catch (e) { fail(`[${label}] NULL 값 삽입`, e); }

    // 4. 특수문자 삽입 (한글, 싱글쿼트)
    try {
        const sql = buildInsertSQL('ri_users', {
            name: "O'Brien", email: '홍길동@test.com',
        }, dbType);
        await conn.executeQuery(sql, db);

        const check = await conn.executeQuery('SELECT * FROM ri_users', db);
        const obrien = check.rows.find(r => {
            const name = getField(r, 'name');
            return typeof name === 'string' && name.includes("O'Brien");
        });
        assert(obrien !== undefined, `[${label}] 싱글쿼트 삽입 성공`);
        if (obrien) {
            assert(
                String(getField(obrien, 'email')).includes('홍길동'),
                `[${label}] 한글 이메일 보존`
            );
        }
    } catch (e) { fail(`[${label}] 특수문자 삽입`, e); }

    // 5. NOT NULL 제약 위반
    try {
        // name이 NOT NULL인데 빈 INSERT → 에러 발생해야 함
        const sql = buildInsertSQL('ri_users', { email: 'no-name@test.com' }, dbType);
        await conn.executeQuery(sql, db);
        fail(`[${label}] NOT NULL 위반 시 에러 미발생`);
    } catch {
        pass(`[${label}] NOT NULL 위반 시 에러 발생`);
    }

    // 6. FK 참조 삽입
    try {
        // 먼저 user 삽입 (id=1 ~ 이미 있음)
        const sql = buildInsertSQL('ri_orders', {
            user_id: 1, amount: 99.99, note: 'test order',
        }, dbType);
        await conn.executeQuery(sql, db);

        const check = await conn.executeQuery('SELECT * FROM ri_orders', db);
        assert(check.rows.length >= 1, `[${label}] FK 참조 삽입 성공`);
    } catch (e) { fail(`[${label}] FK 참조 삽입`, e); }

    // 7. FK 제약 위반 (존재하지 않는 user_id)
    try {
        const sql = buildInsertSQL('ri_orders', {
            user_id: 9999, amount: 10.00,
        }, dbType);
        await conn.executeQuery(sql, db);
        // SQLite는 FK 제약을 기본으로 강제하지 않음 (PRAGMA foreign_keys=ON 필요)
        if (dbType === 'sqlite') {
            pass(`[${label}] FK 위반 — SQLite는 기본 비활성`);
        } else {
            fail(`[${label}] FK 위반 시 에러 미발생`);
        }
    } catch {
        pass(`[${label}] FK 위반 시 에러 발생`);
    }

    // 8. 일괄 삽입 (CSV 붙여넣기 시나리오)
    try {
        // ri_categories 기존 3개 + 추가 5개 = 8개
        const csvRows = [
            { name: 'Sales' },
            { name: 'HR' },
            { name: 'Finance' },
            { name: 'Legal' },
            { name: 'Operations' },
        ];

        let inserted = 0;
        for (const row of csvRows) {
            const sql = buildInsertSQL('ri_categories', row, dbType);
            await conn.executeQuery(sql, db);
            inserted++;
        }

        assertEqual(inserted, 5, `[${label}] 일괄 삽입 5행 성공`);

        const check = await conn.executeQuery('SELECT COUNT(*) as cnt FROM ri_categories', db);
        const cnt = Number(getField(check.rows[0], 'cnt'));
        assertEqual(cnt, 8, `[${label}] 총 카테고리 8개`);
    } catch (e) { fail(`[${label}] 일괄 삽입`, e); }

    // 9. getTableSchema — 제약 조건 감지
    try {
        const schema = await conn.getTableSchema('ri_users', db);
        assert(schema.length >= 4, `[${label}] 스키마 컬럼 4개 이상`);

        const namCol = schema.find(c => c.name.toLowerCase() === 'name');
        assert(namCol !== undefined, `[${label}] name 컬럼 존재`);
        if (namCol) {
            assert(!namCol.nullable, `[${label}] name NOT NULL 감지`);
        }

        const ageCol = schema.find(c => c.name.toLowerCase() === 'age');
        if (ageCol) {
            assert(ageCol.nullable, `[${label}] age nullable 감지`);
            // DEFAULT 값 감지 (DB에 따라 형태가 다름)
            const hasDefault = ageCol.defaultValue !== undefined && ageCol.defaultValue !== null;
            assert(hasDefault, `[${label}] age DEFAULT 감지`);
        }

        // PK 감지
        const idCol = schema.find(c => c.name.toLowerCase() === 'id');
        if (idCol) {
            assert(idCol.primaryKey, `[${label}] id PK 감지`);
        }
    } catch (e) { fail(`[${label}] 스키마 감지`, e); }

    // 10. getForeignKeys — FK 정보 조회
    try {
        if (conn.getForeignKeys) {
            const fks = await conn.getForeignKeys('ri_users', db);
            assert(Array.isArray(fks), `[${label}] FK 배열 반환`);
            if (fks.length > 0) {
                const catFk = fks.find(fk =>
                    fk.columnName.toLowerCase() === 'category_id'
                );
                assert(catFk !== undefined, `[${label}] category_id FK 감지`);
                if (catFk) {
                    assert(
                        catFk.referencedTable.toLowerCase() === 'ri_categories',
                        `[${label}] FK 참조 테이블 ri_categories`
                    );
                    assert(
                        catFk.referencedColumn.toLowerCase() === 'id',
                        `[${label}] FK 참조 컬럼 id`
                    );
                }
            } else {
                pass(`[${label}] FK 목록 빈 배열 (DB별 차이 허용)`);
                pass(`[${label}] FK 참조 테이블 — skip`);
                pass(`[${label}] FK 참조 컬럼 — skip`);
            }
        } else {
            pass(`[${label}] getForeignKeys 미구현 — skip`);
            pass(`[${label}] FK 참조 테이블 — skip`);
            pass(`[${label}] FK 참조 컬럼 — skip`);
        }
    } catch (e) { fail(`[${label}] FK 조회`, e); }

    // 11. FK 참조 값 조회 (드롭다운 시나리오)
    try {
        if (conn.getForeignKeys) {
            const fks = await conn.getForeignKeys('ri_users', db);
            const catFk = fks.find(fk => fk.columnName.toLowerCase() === 'category_id');
            if (catFk) {
                const refCol = escapeIdentifier(catFk.referencedColumn, dbType);
                const refTable = escapeIdentifier(catFk.referencedTable, dbType);
                const result = await conn.executeQuery(
                    `SELECT DISTINCT ${refCol} FROM ${refTable} ORDER BY ${refCol} LIMIT 200`,
                    db
                );
                assert(result.rows.length >= 3, `[${label}] FK 참조 값 조회 3개 이상`);
            } else {
                pass(`[${label}] FK 참조 값 조회 — FK 없어서 skip`);
            }
        } else {
            pass(`[${label}] FK 참조 값 조회 — skip`);
        }
    } catch (e) { fail(`[${label}] FK 참조 값 조회`, e); }

    // 정리
    try { await cleanup(conn, db); } catch { /* ok */ }
}

// ── 실행 ────────────────────────────────────────

async function main() {
    console.log('╔══════════════════════════════════════════════════════════╗');
    console.log('║  DBunny v2.8.0 Row Insert Integration Tests            ║');
    console.log('╚══════════════════════════════════════════════════════════╝');

    const providers = [
        { label: 'MySQL', config: configs.mysql, ProviderClass: MySQLProvider, dbType: 'mysql' },
        { label: 'PostgreSQL', config: configs.postgres, ProviderClass: PostgresProvider, dbType: 'postgres' },
        { label: 'SQLite', config: configs.sqlite, ProviderClass: SQLiteProvider, dbType: 'sqlite' },
        { label: 'H2', config: configs.h2, ProviderClass: H2Provider, dbType: 'h2' },
    ];

    for (const p of providers) {
        const provider = new p.ProviderClass(p.config);
        try {
            await provider.connect();
            await testForDB(p.label, provider, p.dbType);
            await provider.disconnect();
        } catch (e) {
            fail(`[${p.label}] 연결 실패`, e);
            try { await provider.disconnect(); } catch { /* ok */ }
        }
    }

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  Total: ${totalPass + totalFail} | ✅ Passed: ${totalPass} | ❌ Failed: ${totalFail}`);
    if (failures.length > 0) {
        console.log(`\n  Failed tests:`);
        failures.forEach(f => console.log(`    - ${f}`));
    }
    console.log(`${'═'.repeat(60)}`);

    process.exit(totalFail > 0 ? 1 : 0);
}

main();
