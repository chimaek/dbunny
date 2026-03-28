/**
 * v2.7.0 Excel 내보내기 통합 테스트
 * 실행: npx tsx src/test/integration/dataExport.test.ts
 *
 * 사전 요구사항: docker compose up -d
 */

import * as path from 'path';
import * as XLSX from 'xlsx';
import { ConnectionConfig } from '../../types/database';
import { MySQLProvider } from '../../providers/mysqlProvider';
import { PostgresProvider } from '../../providers/postgresProvider';
import { SQLiteProvider } from '../../providers/sqliteProvider';
import { H2Provider } from '../../providers/h2Provider';
import {
    exportSingleSheet,
    exportToExcel,
    fetchAndExportTables,
} from '../../utils/dataExport';
import { DatabaseConnection } from '../../types/database';

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

/** Excel Buffer → 2D 배열 */
function readSheet(buf: Uint8Array, index: number = 0): unknown[][] {
    const wb = XLSX.read(buf, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[index]];
    return XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
}

function readSheetNames(buf: Uint8Array): string[] {
    const wb = XLSX.read(buf, { type: 'array' });
    return wb.SheetNames;
}

// ── Configs ─────────────────────────────────────

const sqlitePath = path.resolve(__dirname, '../../../test-data/export-test.db');

const configs: Record<string, ConnectionConfig> = {
    mysql: {
        id: 'exp-mysql', name: 'MySQL Export', type: 'mysql',
        host: 'localhost', port: 3306,
        username: 'root', password: 'root1234', database: 'mydb',
    },
    postgres: {
        id: 'exp-pg', name: 'PG Export', type: 'postgres',
        host: 'localhost', port: 5432,
        username: 'postgres', password: 'postgres1234', database: 'mydb',
    },
    sqlite: {
        id: 'exp-sqlite', name: 'SQLite Export', type: 'sqlite',
        host: '', port: 0, username: '',
        database: sqlitePath,
    },
    h2: {
        id: 'exp-h2', name: 'H2 Export', type: 'h2',
        host: 'localhost', port: 5435,
        username: 'sa', password: '',
        database: 'mem:exporttest',
        h2Mode: { protocol: 'tcp', dbType: 'mem', dbPath: 'exporttest' },
    },
};

// ── 테이블 준비 ─────────────────────────────────

async function setupTestTables(conn: DatabaseConnection, dbType: string, db?: string) {
    // export_users 테이블
    try { await conn.executeQuery('DROP TABLE IF EXISTS export_users', db); } catch { /* ok */ }
    try { await conn.executeQuery('DROP TABLE IF EXISTS export_products', db); } catch { /* ok */ }

    let usersSQL: string;
    let productsSQL: string;

    switch (dbType) {
        case 'mysql':
            usersSQL = `CREATE TABLE export_users (
                id INT PRIMARY KEY AUTO_INCREMENT,
                name VARCHAR(100) NOT NULL,
                email VARCHAR(200),
                age INT
            )`;
            productsSQL = `CREATE TABLE export_products (
                id INT PRIMARY KEY AUTO_INCREMENT,
                product_name VARCHAR(200) NOT NULL,
                price DECIMAL(10,2),
                stock INT DEFAULT 0
            )`;
            break;
        case 'postgres':
            usersSQL = `CREATE TABLE export_users (
                id SERIAL PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                email VARCHAR(200),
                age INT
            )`;
            productsSQL = `CREATE TABLE export_products (
                id SERIAL PRIMARY KEY,
                product_name VARCHAR(200) NOT NULL,
                price DECIMAL(10,2),
                stock INT DEFAULT 0
            )`;
            break;
        case 'sqlite':
            usersSQL = `CREATE TABLE export_users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                email TEXT,
                age INTEGER
            )`;
            productsSQL = `CREATE TABLE export_products (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                product_name TEXT NOT NULL,
                price REAL,
                stock INTEGER DEFAULT 0
            )`;
            break;
        case 'h2':
            usersSQL = `CREATE TABLE export_users (
                id INT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                email VARCHAR(200),
                age INT
            )`;
            productsSQL = `CREATE TABLE export_products (
                id INT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
                product_name VARCHAR(200) NOT NULL,
                price DECIMAL(10,2),
                stock INT DEFAULT 0
            )`;
            break;
        default:
            throw new Error(`Unsupported: ${dbType}`);
    }

    await conn.executeQuery(usersSQL, db);
    await conn.executeQuery(productsSQL, db);

    // 데이터 삽입
    await conn.executeQuery("INSERT INTO export_users (name, email, age) VALUES ('Alice', 'alice@test.com', 30)", db);
    await conn.executeQuery("INSERT INTO export_users (name, email, age) VALUES ('Bob', 'bob@test.com', 25)", db);
    await conn.executeQuery("INSERT INTO export_users (name, email, age) VALUES ('Charlie', NULL, 35)", db);

    await conn.executeQuery("INSERT INTO export_products (product_name, price, stock) VALUES ('Widget', 9.99, 100)", db);
    await conn.executeQuery("INSERT INTO export_products (product_name, price, stock) VALUES ('Gadget', 29.99, 50)", db);
}

async function cleanupTables(conn: DatabaseConnection, db?: string) {
    try { await conn.executeQuery('DROP TABLE IF EXISTS export_users', db); } catch { /* ok */ }
    try { await conn.executeQuery('DROP TABLE IF EXISTS export_products', db); } catch { /* ok */ }
}

// ── DB별 테스트 ─────────────────────────────────

async function testExportForDB(
    dbLabel: string,
    conn: DatabaseConnection,
    dbType: string
) {
    header(`${dbLabel} — Excel Export`);
    const db = dbType === 'h2' ? undefined : conn.config.database;

    try {
        await setupTestTables(conn, dbType, db);
    } catch (e) {
        fail(`[${dbLabel}] 테이블 준비 실패`, e);
        return;
    }

    // 1. 단일 테이블 내보내기
    try {
        const data = await conn.executeQuery('SELECT * FROM export_users', db);
        const schema = await conn.getTableSchema('export_users', db);
        const buf = exportSingleSheet(data, 'export_users', schema);

        assert(buf.length > 0, `[${dbLabel}] 단일 테이블 버퍼 생성`);

        const sheets = readSheetNames(buf);
        assertEqual(sheets.length, 1, `[${dbLabel}] 시트 1개`);
        assertEqual(sheets[0], 'export_users', `[${dbLabel}] 시트 이름`);

        const rows = readSheet(buf);
        // 헤더 + 타입 + 데이터 3행 = 6행 (단, 행 수는 schema 유무에 따라)
        assert(rows.length >= 4, `[${dbLabel}] 최소 4행 (헤더+타입+3데이터)`);

        // 헤더 확인
        const headerRow = rows[0] as string[];
        assert(headerRow.includes('name') || headerRow.includes('NAME'), `[${dbLabel}] 헤더에 name 포함`);

        // 타입 행 확인 (schema 제공했으므로 존재)
        const typeRow = rows[1] as string[];
        assert(
            typeRow.some(t => t && String(t).includes('NOT NULL')),
            `[${dbLabel}] 타입 행에 NOT NULL 포함`
        );

        // 데이터 확인
        const dataRow = rows[2] as unknown[];
        assert(dataRow.length >= 3, `[${dbLabel}] 데이터 행 컬럼 수`);
    } catch (e) { fail(`[${dbLabel}] 단일 테이블 내보내기`, e); }

    // 2. 타입 행 비활성화
    try {
        const data = await conn.executeQuery('SELECT * FROM export_users', db);
        const schema = await conn.getTableSchema('export_users', db);
        const buf = exportSingleSheet(data, 'users', schema, undefined, false);

        const rows = readSheet(buf);
        assertEqual(rows.length, 4, `[${dbLabel}] 타입 비활성 → 헤더+3데이터=4행`);
    } catch (e) { fail(`[${dbLabel}] 타입 비활성화`, e); }

    // 3. visibleColumns로 부분 내보내기
    try {
        const data = await conn.executeQuery('SELECT * FROM export_users', db);
        const fieldNames = data.fields.map(f => f.name);
        // name과 age만 내보내기 (필드 이름은 DB에 따라 대소문자가 다를 수 있음)
        const nameCol = fieldNames.find(f => f.toLowerCase() === 'name') || 'name';
        const ageCol = fieldNames.find(f => f.toLowerCase() === 'age') || 'age';
        const buf = exportSingleSheet(data, 'partial', undefined, [nameCol, ageCol], false);

        const rows = readSheet(buf);
        assertEqual((rows[0] as string[]).length, 2, `[${dbLabel}] 부분 내보내기 2컬럼`);
    } catch (e) { fail(`[${dbLabel}] 부분 내보내기`, e); }

    // 4. 멀티시트 내보내기
    try {
        const usersData = await conn.executeQuery('SELECT * FROM export_users', db);
        const usersSchema = await conn.getTableSchema('export_users', db);
        const productsData = await conn.executeQuery('SELECT * FROM export_products', db);
        const productsSchema = await conn.getTableSchema('export_products', db);

        const buf = exportToExcel({
            sheets: [
                { sheetName: 'export_users', data: usersData, schema: usersSchema },
                { sheetName: 'export_products', data: productsData, schema: productsSchema },
            ],
            showColumnTypes: true,
        });

        const sheetNames = readSheetNames(buf);
        assertEqual(sheetNames.length, 2, `[${dbLabel}] 멀티시트 2개`);
        assertEqual(sheetNames[0], 'export_users', `[${dbLabel}] 시트1 이름`);
        assertEqual(sheetNames[1], 'export_products', `[${dbLabel}] 시트2 이름`);

        // 시트1: 3행 데이터
        const users = readSheet(buf, 0);
        assert(users.length >= 4, `[${dbLabel}] 시트1 최소 4행`);

        // 시트2: 2행 데이터
        const products = readSheet(buf, 1);
        assert(products.length >= 3, `[${dbLabel}] 시트2 최소 3행`);
    } catch (e) { fail(`[${dbLabel}] 멀티시트 내보내기`, e); }

    // 5. fetchAndExportTables
    try {
        const buf = await fetchAndExportTables(
            [
                { tableName: 'export_users', database: db },
                { tableName: 'export_products', database: db },
            ],
            (sql, database) => conn.executeQuery(sql, database),
            (table, database) => conn.getTableSchema(table, database),
            true,
            dbType,
        );

        const sheetNames = readSheetNames(buf);
        assertEqual(sheetNames.length, 2, `[${dbLabel}] fetchAndExport 시트 2개`);

        const usersRows = readSheet(buf, 0);
        assert(usersRows.length >= 4, `[${dbLabel}] fetchAndExport users 최소 4행`);

        const productsRows = readSheet(buf, 1);
        assert(productsRows.length >= 3, `[${dbLabel}] fetchAndExport products 최소 3행`);
    } catch (e) { fail(`[${dbLabel}] fetchAndExportTables`, e); }

    // 6. NULL 값 보존
    try {
        const data = await conn.executeQuery('SELECT * FROM export_users', db);
        const buf = exportSingleSheet(data, 'nulls', undefined, undefined, false);
        const rows = readSheet(buf);

        // Charlie의 email은 NULL
        const charlieRow = rows.find(r => {
            const arr = r as unknown[];
            return arr.some(v => v === 'Charlie');
        }) as unknown[] | undefined;

        assert(charlieRow !== undefined, `[${dbLabel}] Charlie 행 존재`);
        if (charlieRow) {
            const emailIdx = (rows[0] as string[]).findIndex(
                h => String(h).toLowerCase() === 'email'
            );
            assertEqual(charlieRow[emailIdx], null, `[${dbLabel}] NULL email 보존`);
        }
    } catch (e) { fail(`[${dbLabel}] NULL 값 보존`, e); }

    // 7. 한글 데이터 내보내기
    try {
        await conn.executeQuery("INSERT INTO export_users (name, email, age) VALUES ('홍길동', 'hong@test.com', 40)", db);
        const data = await conn.executeQuery('SELECT * FROM export_users', db);
        const buf = exportSingleSheet(data, 'korean', undefined, undefined, false);
        const rows = readSheet(buf);

        const hasKorean = rows.some(r =>
            (r as unknown[]).some(v => typeof v === 'string' && v.includes('홍길동'))
        );
        assert(hasKorean, `[${dbLabel}] 한글 데이터 보존`);
    } catch (e) { fail(`[${dbLabel}] 한글 데이터`, e); }

    // 8. 특수 문자 내보내기
    try {
        await conn.executeQuery("INSERT INTO export_users (name, email, age) VALUES ('O''Brien', 'ob@test.com', 50)", db);
        const data = await conn.executeQuery('SELECT * FROM export_users', db);
        const buf = exportSingleSheet(data, 'special', undefined, undefined, false);
        const rows = readSheet(buf);

        const hasSingleQuote = rows.some(r =>
            (r as unknown[]).some(v => typeof v === 'string' && v.includes("O'Brien"))
        );
        assert(hasSingleQuote, `[${dbLabel}] 싱글쿼트 보존`);
    } catch (e) { fail(`[${dbLabel}] 특수 문자`, e); }

    // 9. 빈 테이블 내보내기
    try {
        await conn.executeQuery('DELETE FROM export_products', db);
        const data = await conn.executeQuery('SELECT * FROM export_products', db);
        const schema = await conn.getTableSchema('export_products', db);
        const buf = exportSingleSheet(data, 'empty', schema, undefined, false);
        const rows = readSheet(buf);

        // 빈 결과: 헤더만(1행) 또는 fields가 비어있으면 0행
        assert(rows.length <= 1, `[${dbLabel}] 빈 테이블 → 0~1행`);
        assertEqual(data.rows.length, 0, `[${dbLabel}] 빈 테이블 데이터 0행`);
    } catch (e) { fail(`[${dbLabel}] 빈 테이블`, e); }

    // 10. 대용량 데이터 내보내기
    try {
        // 100행 삽입
        for (let i = 0; i < 100; i++) {
            await conn.executeQuery(
                `INSERT INTO export_products (product_name, price, stock) VALUES ('item_${i}', ${(i * 1.5).toFixed(2)}, ${i})`,
                db
            );
        }
        const data = await conn.executeQuery('SELECT * FROM export_products', db);
        const buf = exportSingleSheet(data, 'bulk', undefined, undefined, false);
        const rows = readSheet(buf);

        assertEqual(rows.length, 101, `[${dbLabel}] 대용량 헤더+100행`);
    } catch (e) { fail(`[${dbLabel}] 대용량 내보내기`, e); }

    // 정리
    try {
        await cleanupTables(conn, db);
    } catch { /* ok */ }
}

// ── 실행 ────────────────────────────────────────

async function main() {
    console.log('╔══════════════════════════════════════════════════════════╗');
    console.log('║  DBunny v2.7.0 Excel Export Integration Tests          ║');
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
            await testExportForDB(p.label, provider, p.dbType);
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
