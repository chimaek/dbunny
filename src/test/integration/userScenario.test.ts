/**
 * v2.6~3.0 사용자 시나리오 통합 테스트
 * 실행: npx tsx src/test/integration/userScenario.test.ts
 *
 * 사전 요구사항: docker compose up -d
 *
 * 실제 사용자가 수행하는 워크플로우를 시뮬레이션:
 * 1. CSV 데이터 가져오기 → 통계 확인 → 차트 생성
 * 2. 행 삽입 → Excel 내보내기 → 다시 가져오기
 * 3. 대용량 데이터 가져오기 → 통계 → 차트
 * 4. 한글/특수문자 데이터 전체 파이프라인
 * 5. 충돌 처리 (skip/upsert) → 결과 검증
 * 6. NULL/빈값 엣지 케이스 전체 흐름
 */

import * as path from 'path';
import * as XLSX from 'xlsx';
import { ConnectionConfig, DatabaseConnection } from '../../types/database';
import { MySQLProvider } from '../../providers/mysqlProvider';
import { PostgresProvider } from '../../providers/postgresProvider';
import { SQLiteProvider } from '../../providers/sqliteProvider';
import { H2Provider } from '../../providers/h2Provider';
import {
    parseCSV,
    parseJSON,
    suggestColumnMapping,
    importData,
    DEFAULT_BATCH_SIZE,
} from '../../utils/dataImport';
import { exportSingleSheet, fetchAndExportTables } from '../../utils/dataExport';
import { collectTableStatistics } from '../../utils/dataStatistics';
import { buildChartData, renderBarChart, renderPieChart, renderLineChart } from '../../utils/chartBuilder';

// ── Helpers ─────────────────────────────────────

let totalPass = 0;
let totalFail = 0;
const failures: string[] = [];

function header(title: string) {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  ${title}`);
    console.log(`${'═'.repeat(60)}`);
}
function pass(msg: string) { totalPass++; console.log(`  ✅ ${msg}`); }
function fail(msg: string, err?: unknown) {
    totalFail++;
    const detail = err instanceof Error ? err.message : String(err ?? '');
    console.log(`  ❌ ${msg}${detail ? ' — ' + detail : ''}`);
    failures.push(`${msg}: ${detail}`);
}
function assert(cond: boolean, msg: string) { if (cond) { pass(msg); } else { fail(msg); } }
function assertEqual(a: unknown, b: unknown, msg: string) {
    if (a === b) { pass(msg); } else { fail(`${msg} — expected: ${JSON.stringify(b)}, got: ${JSON.stringify(a)}`); }
}

function getField(row: Record<string, unknown>, field: string): unknown {
    if (row[field] !== undefined) { return row[field]; }
    if (row[field.toUpperCase()] !== undefined) { return row[field.toUpperCase()]; }
    if (row[field.toLowerCase()] !== undefined) { return row[field.toLowerCase()]; }
    return undefined;
}

// ── Configs ─────────────────────────────────────

const sqlitePath = path.resolve(__dirname, '../../../test-data/scenario-test.db');

const configs: Record<string, ConnectionConfig> = {
    mysql: {
        id: 'sc-mysql', name: 'MySQL Scenario', type: 'mysql',
        host: 'localhost', port: 3306,
        username: 'root', password: 'root1234', database: 'mydb',
    },
    postgres: {
        id: 'sc-pg', name: 'PG Scenario', type: 'postgres',
        host: 'localhost', port: 5432,
        username: 'postgres', password: 'postgres1234', database: 'mydb',
    },
    sqlite: {
        id: 'sc-sqlite', name: 'SQLite Scenario', type: 'sqlite',
        host: '', port: 0, username: '',
        database: sqlitePath,
    },
    h2: {
        id: 'sc-h2', name: 'H2 Scenario', type: 'h2',
        host: 'localhost', port: 5435,
        username: 'sa', password: '',
        database: 'mem:scenariotest',
        h2Mode: { protocol: 'tcp', dbType: 'mem', dbPath: 'scenariotest' },
    },
};

// ── 테이블 준비 ─────────────────────────────────

async function setupScenarioTable(conn: DatabaseConnection, dbType: string, db?: string) {
    try { await conn.executeQuery('DROP TABLE IF EXISTS sc_employees', db); } catch { /* ok */ }

    let sql: string;
    switch (dbType) {
        case 'mysql':
            sql = `CREATE TABLE sc_employees (
                id INT PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                department VARCHAR(50),
                salary DECIMAL(10,2),
                email VARCHAR(200)
            )`;
            break;
        case 'postgres':
            sql = `CREATE TABLE sc_employees (
                id INT PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                department VARCHAR(50),
                salary DECIMAL(10,2),
                email VARCHAR(200)
            )`;
            break;
        case 'sqlite':
            sql = `CREATE TABLE sc_employees (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                department TEXT,
                salary REAL,
                email TEXT
            )`;
            break;
        case 'h2':
            sql = `CREATE TABLE sc_employees (
                id INT PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                department VARCHAR(50),
                salary DECIMAL(10,2),
                email VARCHAR(200)
            )`;
            break;
        default:
            throw new Error(`Unsupported: ${dbType}`);
    }
    await conn.executeQuery(sql, db);
}

async function cleanup(conn: DatabaseConnection, db?: string) {
    try { await conn.executeQuery('DROP TABLE IF EXISTS sc_employees', db); } catch { /* ok */ }
}

// ── 시나리오 테스트 ─────────────────────────────

async function testScenarios(label: string, conn: DatabaseConnection, dbType: string) {
    header(`${label} — User Scenarios`);
    const db = dbType === 'h2' ? undefined : conn.config.database;

    // ─── 시나리오 1: CSV 가져오기 → 통계 → 차트 ───
    try {
        await setupScenarioTable(conn, dbType, db);

        // 1a. CSV 파싱 + 가져오기
        const csv = `id,name,department,salary,email
1,Alice,Engineering,5000.00,alice@test.com
2,Bob,Engineering,4500.00,bob@test.com
3,Charlie,Design,6000.00,charlie@test.com
4,Diana,Marketing,4800.00,diana@test.com
5,Eve,Design,5500.00,eve@test.com
6,Frank,Engineering,7000.00,frank@test.com
7,Grace,Marketing,4200.00,grace@test.com
8,Hank,Design,5800.00,hank@test.com`;

        const parsed = parseCSV(new TextEncoder().encode(csv), 'employees.csv');
        assertEqual(parsed.totalRows, 8, `[${label}] S1: CSV 파싱 8행`);

        const schema = await conn.getTableSchema('sc_employees', db);
        const mappings = suggestColumnMapping(parsed.headers, schema);
        const mappedCount = mappings.filter(m => m.targetColumn !== '').length;
        assertEqual(mappedCount, 5, `[${label}] S1: 5컬럼 매핑`);

        const importResult = await importData(conn, parsed, {
            tableName: 'sc_employees',
            database: db,
            columnMapping: mappings,
            conflictStrategy: 'skip',
            batchSize: DEFAULT_BATCH_SIZE,
            primaryKeyColumns: ['id'],
        });
        assertEqual(importResult.inserted, 8, `[${label}] S1: 8행 삽입`);
        assertEqual(importResult.failed, 0, `[${label}] S1: 실패 0`);

        // 1b. 통계 확인
        const stats = await collectTableStatistics(conn, 'sc_employees', schema, dbType, db);
        assertEqual(stats.totalRows, 8, `[${label}] S1: 통계 총 8행`);

        const deptStat = stats.columns.find(c => c.columnName.toLowerCase() === 'department');
        assert(deptStat !== undefined, `[${label}] S1: department 통계`);
        if (deptStat) {
            assertEqual(deptStat.distinctCount, 3, `[${label}] S1: 3개 부서`);
            assertEqual(deptStat.nullCount, 0, `[${label}] S1: department NULL 0`);
        }

        const salStat = stats.columns.find(c => c.columnName.toLowerCase() === 'salary');
        if (salStat) {
            assert(salStat.avg !== undefined && salStat.avg! > 5000, `[${label}] S1: salary AVG > 5000`);
        }

        // 1c. 차트 생성
        const queryResult = await conn.executeQuery('SELECT * FROM sc_employees', db);
        const barData = buildChartData(queryResult, 'department', 'salary', 'sum');
        assertEqual(barData.length, 3, `[${label}] S1: 부서별 합계 3개`);
        const barSvg = renderBarChart(barData);
        assert(barSvg.includes('<svg'), `[${label}] S1: bar SVG 생성`);

        const pieData = buildChartData(queryResult, 'department', 'salary', 'count');
        const pieSvg = renderPieChart(pieData);
        assert(pieSvg.includes('path'), `[${label}] S1: pie SVG 생성`);

    } catch (e) { fail(`[${label}] 시나리오 1`, e); }

    // ─── 시나리오 2: 행 삽입 → Excel 내보내기 → 재가져오기 ───
    try {
        // 2a. 추가 행 삽입 (INSERT SQL 직접)
        await conn.executeQuery(
            `INSERT INTO sc_employees (id, name, department, salary, email) VALUES (9, 'Ivy', 'HR', 3800.00, 'ivy@test.com')`,
            db
        );
        await conn.executeQuery(
            `INSERT INTO sc_employees (id, name, department, salary, email) VALUES (10, 'Jack', 'HR', 4100.00, 'jack@test.com')`,
            db
        );

        // 2b. Excel 내보내기
        const data = await conn.executeQuery('SELECT * FROM sc_employees ORDER BY id', db);
        assertEqual(data.rows.length, 10, `[${label}] S2: 총 10행`);

        const excelSchema = await conn.getTableSchema('sc_employees', db);
        const buf = exportSingleSheet(data, 'sc_employees', excelSchema);
        assert(buf.length > 100, `[${label}] S2: Excel 버퍼 생성`);

        // Excel 파일 검증
        const wb = XLSX.read(buf, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const excelRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null }) as unknown[][];
        // 헤더 + 타입 + 데이터 10행
        assert(excelRows.length >= 11, `[${label}] S2: Excel 최소 11행`);

    } catch (e) { fail(`[${label}] 시나리오 2`, e); }

    // ─── 시나리오 3: 대용량 가져오기 → 통계 → 차트 ───
    try {
        await cleanup(conn, db);
        await setupScenarioTable(conn, dbType, db);

        // 200행 CSV 생성
        const depts = ['Eng', 'Design', 'Marketing', 'HR', 'Finance'];
        let bigCsv = 'id,name,department,salary,email\n';
        for (let i = 1; i <= 200; i++) {
            const dept = depts[i % depts.length];
            const sal = (3000 + i * 10).toFixed(2);
            bigCsv += `${i},Employee_${i},${dept},${sal},emp${i}@test.com\n`;
        }

        const parsed = parseCSV(new TextEncoder().encode(bigCsv), 'big.csv');
        assertEqual(parsed.totalRows, 200, `[${label}] S3: 200행 파싱`);

        const schema = await conn.getTableSchema('sc_employees', db);
        const mappings = suggestColumnMapping(parsed.headers, schema);

        let progressCallCount = 0;
        const result = await importData(conn, parsed, {
            tableName: 'sc_employees',
            database: db,
            columnMapping: mappings,
            conflictStrategy: 'skip',
            batchSize: 50,
            primaryKeyColumns: ['id'],
        }, () => { progressCallCount++; });

        assertEqual(result.inserted, 200, `[${label}] S3: 200행 삽입`);
        assert(progressCallCount >= 4, `[${label}] S3: 진행률 콜백 4회+ (${progressCallCount}회)`);

        // 통계
        const stats = await collectTableStatistics(conn, 'sc_employees', schema, dbType, db);
        assertEqual(stats.totalRows, 200, `[${label}] S3: 통계 200행`);
        const deptStat = stats.columns.find(c => c.columnName.toLowerCase() === 'department');
        if (deptStat) {
            assertEqual(deptStat.distinctCount, 5, `[${label}] S3: 5개 부서`);
            assert(deptStat.topValues.length >= 5, `[${label}] S3: 빈출값 5개+`);
            // 200 / 5 = 40씩
            assertEqual(deptStat.topValues[0].count, 40, `[${label}] S3: 각 부서 40명`);
        }

        // 차트
        const queryResult = await conn.executeQuery('SELECT * FROM sc_employees', db);
        const avgData = buildChartData(queryResult, 'department', 'salary', 'avg');
        assertEqual(avgData.length, 5, `[${label}] S3: 부서별 평균 5개`);

    } catch (e) { fail(`[${label}] 시나리오 3`, e); }

    // ─── 시나리오 4: 한글/특수문자 전체 파이프라인 ───
    try {
        await cleanup(conn, db);
        await setupScenarioTable(conn, dbType, db);

        const csv = `id,name,department,salary,email
1,홍길동,개발팀,5500.00,hong@test.com
2,김영희,디자인팀,4800.00,kim@test.com
3,O'Brien,마케팅,6200.00,ob@test.com
4,José García,개발팀,5100.00,jose@test.com`;

        const parsed = parseCSV(new TextEncoder().encode(csv), 'korean.csv');
        assertEqual(parsed.totalRows, 4, `[${label}] S4: 한글 CSV 4행`);

        const schema = await conn.getTableSchema('sc_employees', db);
        const mappings = suggestColumnMapping(parsed.headers, schema);

        const result = await importData(conn, parsed, {
            tableName: 'sc_employees',
            database: db,
            columnMapping: mappings,
            conflictStrategy: 'skip',
            batchSize: 10,
            primaryKeyColumns: ['id'],
        });
        assertEqual(result.inserted, 4, `[${label}] S4: 4행 삽입`);
        assertEqual(result.failed, 0, `[${label}] S4: 실패 0`);

        // DB 검증
        const check = await conn.executeQuery('SELECT * FROM sc_employees', db);
        const hong = check.rows.find(r => {
            const name = getField(r, 'name');
            return typeof name === 'string' && name.includes('홍길동');
        });
        assert(hong !== undefined, `[${label}] S4: 홍길동 존재`);

        const obrien = check.rows.find(r => {
            const name = getField(r, 'name');
            return typeof name === 'string' && name.includes("O'Brien");
        });
        assert(obrien !== undefined, `[${label}] S4: O'Brien 존재`);

        // Excel 내보내기 + 한글 검증
        const data = await conn.executeQuery('SELECT * FROM sc_employees', db);
        const buf = exportSingleSheet(data, '직원목록', undefined, undefined, false);
        const wb = XLSX.read(buf, { type: 'array' });
        assertEqual(wb.SheetNames[0], '직원목록', `[${label}] S4: 한글 시트 이름`);

        // 통계
        const stats = await collectTableStatistics(conn, 'sc_employees', schema, dbType, db);
        assertEqual(stats.totalRows, 4, `[${label}] S4: 통계 4행`);

    } catch (e) { fail(`[${label}] 시나리오 4`, e); }

    // ─── 시나리오 5: 충돌 처리 (skip → upsert) ───
    try {
        await cleanup(conn, db);
        await setupScenarioTable(conn, dbType, db);

        // 초기 데이터
        const csv1 = `id,name,department,salary,email
1,Alice,Eng,5000,alice@v1.com
2,Bob,Eng,4500,bob@v1.com
3,Charlie,Design,6000,charlie@v1.com`;

        const parsed1 = parseCSV(new TextEncoder().encode(csv1), 'v1.csv');
        const schema = await conn.getTableSchema('sc_employees', db);
        const mappings = suggestColumnMapping(parsed1.headers, schema);

        await importData(conn, parsed1, {
            tableName: 'sc_employees', database: db,
            columnMapping: mappings, conflictStrategy: 'skip',
            batchSize: 10, primaryKeyColumns: ['id'],
        });

        // 중복 + 신규 데이터 (skip)
        const csv2 = `id,name,department,salary,email
1,Alice-updated,Eng,9999,alice@v2.com
4,Diana,Marketing,4800,diana@v2.com`;

        const parsed2 = parseCSV(new TextEncoder().encode(csv2), 'v2.csv');
        await importData(conn, parsed2, {
            tableName: 'sc_employees', database: db,
            columnMapping: mappings, conflictStrategy: 'skip',
            batchSize: 10, primaryKeyColumns: ['id'],
        });

        // skip이므로 id=1은 원본 유지, id=4는 신규 삽입
        const afterSkip = await conn.executeQuery('SELECT * FROM sc_employees ORDER BY id', db);
        assertEqual(afterSkip.rows.length, 4, `[${label}] S5: skip 후 4행`);

        const alice = afterSkip.rows.find(r => Number(getField(r, 'id')) === 1);
        if (alice) {
            // skip이므로 원본 유지
            const email = getField(alice, 'email');
            assertEqual(email, 'alice@v1.com', `[${label}] S5: skip → 원본 email 유지`);
        }

    } catch (e) { fail(`[${label}] 시나리오 5`, e); }

    // ─── 시나리오 6: NULL/빈값 전체 흐름 ───
    try {
        await cleanup(conn, db);
        await setupScenarioTable(conn, dbType, db);

        const csv = `id,name,department,salary,email
1,NullTest,,,"
2,EmptyDept,,0,empty@test.com
3,OnlyName,,,`;

        const parsed = parseCSV(new TextEncoder().encode(csv), 'nulls.csv');
        const schema = await conn.getTableSchema('sc_employees', db);
        const mappings = suggestColumnMapping(parsed.headers, schema);

        const result = await importData(conn, parsed, {
            tableName: 'sc_employees', database: db,
            columnMapping: mappings, conflictStrategy: 'skip',
            batchSize: 10, primaryKeyColumns: ['id'],
        });

        // 일부 행은 삽입 성공, 일부는 타입 문제로 실패 가능
        assert(result.inserted + result.failed === parsed.totalRows, `[${label}] S6: 총 처리 수 일치`);

        // 통계
        const stats = await collectTableStatistics(conn, 'sc_employees', schema, dbType, db);
        assert(stats.totalRows >= 0, `[${label}] S6: 통계 조회 성공`);

        // 차트 (빈 데이터도 에러 없이)
        const data = await conn.executeQuery('SELECT * FROM sc_employees', db);
        const chartData = buildChartData(data, 'department', 'salary', 'sum');
        const svg = renderBarChart(chartData);
        assert(svg.length > 0, `[${label}] S6: 차트 생성 성공`);

    } catch (e) { fail(`[${label}] 시나리오 6`, e); }

    // ─── 시나리오 7: JSON 가져오기 → 멀티시트 Excel ───
    try {
        await cleanup(conn, db);
        await setupScenarioTable(conn, dbType, db);

        const jsonData = [
            { id: 1, name: 'Alice', department: 'Eng', salary: 5000, email: 'a@t.com' },
            { id: 2, name: 'Bob', department: 'Design', salary: 4500, email: 'b@t.com' },
        ];
        const parsed = parseJSON(new TextEncoder().encode(JSON.stringify(jsonData)), 'data.json');
        assertEqual(parsed.totalRows, 2, `[${label}] S7: JSON 2행`);

        const schema = await conn.getTableSchema('sc_employees', db);
        const mappings = suggestColumnMapping(parsed.headers, schema);

        await importData(conn, parsed, {
            tableName: 'sc_employees', database: db,
            columnMapping: mappings, conflictStrategy: 'skip',
            batchSize: 10, primaryKeyColumns: ['id'],
        });

        // 멀티시트 Excel (fetchAndExportTables)
        const buf = await fetchAndExportTables(
            [{ tableName: 'sc_employees', database: db }],
            (sql, database) => conn.executeQuery(sql, database),
            (table, database) => conn.getTableSchema(table, database),
            true,
            dbType,
        );

        const wb = XLSX.read(buf, { type: 'array' });
        assertEqual(wb.SheetNames.length, 1, `[${label}] S7: fetchAndExport 1시트`);
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null }) as unknown[][];
        assert(rows.length >= 3, `[${label}] S7: 헤더+타입+2행 최소 3행`);

    } catch (e) { fail(`[${label}] 시나리오 7`, e); }

    // ─── 시나리오 8: 라인 차트 (순서 데이터) ───
    try {
        await cleanup(conn, db);
        await setupScenarioTable(conn, dbType, db);

        // 월별 데이터 시뮬레이션
        for (let i = 1; i <= 12; i++) {
            const month = String(i).padStart(2, '0');
            await conn.executeQuery(
                `INSERT INTO sc_employees (id, name, department, salary) VALUES (${i}, 'Month_${month}', '2024-${month}', ${3000 + i * 100})`,
                db
            );
        }

        const data = await conn.executeQuery('SELECT * FROM sc_employees ORDER BY id', db);
        const lineData = buildChartData(data, 'department', 'salary', 'raw');
        assertEqual(lineData.length, 12, `[${label}] S8: 12개 포인트`);

        const lineSvg = renderLineChart(lineData);
        assert(lineSvg.includes('<path'), `[${label}] S8: line path`);
        assert(lineSvg.includes('circle'), `[${label}] S8: line dots`);

    } catch (e) { fail(`[${label}] 시나리오 8`, e); }

    try { await cleanup(conn, db); } catch { /* ok */ }
}

// ── 실행 ────────────────────────────────────────

async function main() {
    console.log('╔══════════════════════════════════════════════════════════╗');
    console.log('║  DBunny v2.6~3.0 User Scenario Integration Tests       ║');
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
            await testScenarios(p.label, provider, p.dbType);
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
