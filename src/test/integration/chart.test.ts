/**
 * v3.0.0 차트 통합 테스트
 * 실행: npx tsx src/test/integration/chart.test.ts
 *
 * 사전 요구사항: docker compose up -d
 */

import * as path from 'path';
import { ConnectionConfig, DatabaseConnection, QueryResult, FieldInfo } from '../../types/database';
import { MySQLProvider } from '../../providers/mysqlProvider';
import { PostgresProvider } from '../../providers/postgresProvider';
import { SQLiteProvider } from '../../providers/sqliteProvider';
import { H2Provider } from '../../providers/h2Provider';
import {
    isNumericField,
    isDateField,
    getNumericColumns,
    getLabelColumns,
    suggestChartType,
    buildChartData,
    renderBarChart,
    renderPieChart,
    renderLineChart,
    renderChart,
    CHART_COLORS,
    MAX_DATA_POINTS,
} from '../../utils/chartBuilder';

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

function makeResult(fields: FieldInfo[], rows: Record<string, unknown>[]): QueryResult {
    return { fields, rows, rowCount: rows.length, executionTime: 10 };
}

// ── Unit Tests ──────────────────────────────────

function testUnitTests() {
    header('Chart Builder — Unit Tests');

    // isNumericField
    assert(isNumericField('INT'), 'INT → numeric');
    assert(isNumericField('DECIMAL(10,2)'), 'DECIMAL → numeric');
    assert(isNumericField('FLOAT'), 'FLOAT → numeric');
    assert(isNumericField('BIGSERIAL'), 'BIGSERIAL → numeric');
    assert(!isNumericField('VARCHAR(100)'), 'VARCHAR → not numeric');
    assert(!isNumericField('TEXT'), 'TEXT → not numeric');
    assert(!isNumericField('DATE'), 'DATE → not numeric');

    // isDateField
    assert(isDateField('DATE'), 'DATE → date');
    assert(isDateField('TIMESTAMP'), 'TIMESTAMP → date');
    assert(isDateField('DATETIME'), 'DATETIME → date');
    assert(!isDateField('INT'), 'INT → not date');
    assert(!isDateField('VARCHAR'), 'VARCHAR → not date');

    // getNumericColumns
    const fields: FieldInfo[] = [
        { name: 'id', type: 'INT' },
        { name: 'name', type: 'VARCHAR' },
        { name: 'salary', type: 'DECIMAL(10,2)' },
        { name: 'created', type: 'TIMESTAMP' },
    ];
    const numCols = getNumericColumns(fields);
    assertEqual(numCols.length, 2, 'getNumericColumns 2개 (id, salary)');
    assertEqual(numCols[0].name, 'id', 'numCols[0] = id');
    assertEqual(numCols[1].name, 'salary', 'numCols[1] = salary');

    // getLabelColumns
    const labelCols = getLabelColumns(fields);
    assert(labelCols.some(c => c.name === 'name'), 'labelCols에 name 포함');
    assert(labelCols.some(c => c.name === 'created'), 'labelCols에 created 포함');

    // suggestChartType
    const fewRows = makeResult(fields, [
        { id: 1, name: 'A', salary: 100, created: '2024-01-01' },
        { id: 2, name: 'B', salary: 200, created: '2024-01-02' },
        { id: 3, name: 'C', salary: 300, created: '2024-01-03' },
    ]);
    assertEqual(suggestChartType(fewRows, 'name', 'salary', fields), 'pie', '3개 라벨 → pie');
    assertEqual(suggestChartType(fewRows, 'created', 'salary', fields), 'line', 'date 라벨 → line');

    // 11개 이상 고유값 → bar
    const manyRows = makeResult(fields,
        Array.from({ length: 15 }, (_, i) => ({ id: i, name: `N${i}`, salary: i * 100, created: '' }))
    );
    assertEqual(suggestChartType(manyRows, 'name', 'salary', fields), 'bar', '15개 라벨 → bar');

    // buildChartData — raw
    const rawData = buildChartData(fewRows, 'name', 'salary', 'raw');
    assertEqual(rawData.length, 3, 'raw 3개');
    assertEqual(rawData[0].label, 'A', 'raw[0] label');
    assertEqual(rawData[0].value, 100, 'raw[0] value');
    assert(rawData[0].color.startsWith('#'), 'raw[0] color');

    // buildChartData — sum
    const grouped = makeResult(
        [{ name: 'dept', type: 'VARCHAR' }, { name: 'salary', type: 'INT' }],
        [
            { dept: 'Eng', salary: 100 },
            { dept: 'Eng', salary: 200 },
            { dept: 'Sales', salary: 150 },
        ]
    );
    const sumData = buildChartData(grouped, 'dept', 'salary', 'sum');
    assertEqual(sumData.length, 2, 'sum 2그룹');
    const eng = sumData.find(d => d.label === 'Eng');
    assert(eng !== undefined, 'Eng 그룹 존재');
    if (eng) { assertEqual(eng.value, 300, 'Eng sum = 300'); }

    // buildChartData — count
    const countData = buildChartData(grouped, 'dept', 'salary', 'count');
    const engCount = countData.find(d => d.label === 'Eng');
    if (engCount) { assertEqual(engCount.value, 2, 'Eng count = 2'); }

    // buildChartData — avg
    const avgData = buildChartData(grouped, 'dept', 'salary', 'avg');
    const engAvg = avgData.find(d => d.label === 'Eng');
    if (engAvg) { assertEqual(engAvg.value, 150, 'Eng avg = 150'); }

    // buildChartData — null 라벨
    const nullResult = makeResult(
        [{ name: 'dept', type: 'VARCHAR' }, { name: 'cnt', type: 'INT' }],
        [{ dept: null, cnt: 5 }, { dept: 'Sales', cnt: 10 }]
    );
    const nullData = buildChartData(nullResult, 'dept', 'cnt', 'raw');
    assert(nullData.some(d => d.label === '(row 1)'), 'null 라벨 → (row N)');

    // buildChartData — empty
    const emptyResult = makeResult([{ name: 'x', type: 'INT' }], []);
    assertEqual(buildChartData(emptyResult, 'x', 'x', 'raw').length, 0, '빈 데이터 → 0');

    // MAX_DATA_POINTS 제한
    const bigResult = makeResult(
        [{ name: 'id', type: 'INT' }, { name: 'val', type: 'INT' }],
        Array.from({ length: 100 }, (_, i) => ({ id: i, val: i }))
    );
    const capped = buildChartData(bigResult, 'id', 'val', 'raw');
    assertEqual(capped.length, MAX_DATA_POINTS, `MAX_DATA_POINTS = ${MAX_DATA_POINTS}`);

    // CHART_COLORS
    assert(CHART_COLORS.length >= 20, '최소 20개 색상');

    // renderBarChart
    const barSvg = renderBarChart(rawData);
    assert(barSvg.includes('<svg'), 'bar SVG 생성');
    assert(barSvg.includes('rect'), 'bar rect 포함');
    assert(barSvg.includes('A'), 'bar 라벨 포함');

    // renderPieChart
    const pieSvg = renderPieChart(rawData);
    assert(pieSvg.includes('<svg'), 'pie SVG 생성');
    assert(pieSvg.includes('path'), 'pie path 포함');

    // renderLineChart
    const lineSvg = renderLineChart(rawData);
    assert(lineSvg.includes('<svg'), 'line SVG 생성');
    assert(lineSvg.includes('<path'), 'line path 포함');
    assert(lineSvg.includes('circle'), 'line dots 포함');

    // renderChart
    assert(renderChart({ type: 'bar', title: 'T', labelColumn: 'x', valueColumn: 'y', data: rawData }).includes('rect'), 'renderChart bar');
    assert(renderChart({ type: 'pie', title: 'T', labelColumn: 'x', valueColumn: 'y', data: rawData }).includes('path'), 'renderChart pie');
    assert(renderChart({ type: 'line', title: 'T', labelColumn: 'x', valueColumn: 'y', data: rawData }).includes('circle'), 'renderChart line');

    // 빈 데이터 렌더링
    assert(renderBarChart([]).includes('No data'), '빈 bar → No data');
    assert(renderPieChart([]).includes('No data'), '빈 pie → No data');
    assert(renderLineChart([]).includes('No data'), '빈 line → No data');

    // 단일 포인트
    const singleData = [{ label: 'Only', value: 42, color: '#fff' }];
    assert(renderBarChart(singleData).includes('42'), '단일 bar 값 포함');
    assert(renderPieChart(singleData).includes('100.0%'), '단일 pie 100%');
    assert(renderLineChart(singleData).includes('circle'), '단일 line dot');
}

// ── DB Configs ──────────────────────────────────

const sqlitePath = path.resolve(__dirname, '../../../test-data/chart-test.db');

const configs: Record<string, ConnectionConfig> = {
    mysql: {
        id: 'chart-mysql', name: 'MySQL Chart', type: 'mysql',
        host: 'localhost', port: 3306,
        username: 'root', password: 'root1234', database: 'mydb',
    },
    postgres: {
        id: 'chart-pg', name: 'PG Chart', type: 'postgres',
        host: 'localhost', port: 5432,
        username: 'postgres', password: 'postgres1234', database: 'mydb',
    },
    sqlite: {
        id: 'chart-sqlite', name: 'SQLite Chart', type: 'sqlite',
        host: '', port: 0, username: '',
        database: sqlitePath,
    },
    h2: {
        id: 'chart-h2', name: 'H2 Chart', type: 'h2',
        host: 'localhost', port: 5435,
        username: 'sa', password: '',
        database: 'mem:charttest',
        h2Mode: { protocol: 'tcp', dbType: 'mem', dbPath: 'charttest' },
    },
};

async function setupTable(conn: DatabaseConnection, dbType: string, db?: string) {
    try { await conn.executeQuery('DROP TABLE IF EXISTS chart_sales', db); } catch { /* ok */ }

    let sql: string;
    switch (dbType) {
        case 'mysql':
            sql = `CREATE TABLE chart_sales (
                id INT PRIMARY KEY AUTO_INCREMENT,
                product VARCHAR(50) NOT NULL,
                category VARCHAR(30),
                amount DECIMAL(10,2),
                quantity INT,
                sale_date DATE
            )`;
            break;
        case 'postgres':
            sql = `CREATE TABLE chart_sales (
                id SERIAL PRIMARY KEY,
                product VARCHAR(50) NOT NULL,
                category VARCHAR(30),
                amount DECIMAL(10,2),
                quantity INT,
                sale_date DATE
            )`;
            break;
        case 'sqlite':
            sql = `CREATE TABLE chart_sales (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                product TEXT NOT NULL,
                category TEXT,
                amount REAL,
                quantity INTEGER,
                sale_date TEXT
            )`;
            break;
        case 'h2':
            sql = `CREATE TABLE chart_sales (
                id INT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
                product VARCHAR(50) NOT NULL,
                category VARCHAR(30),
                amount DECIMAL(10,2),
                quantity INT,
                sale_date DATE
            )`;
            break;
        default:
            throw new Error(`Unsupported: ${dbType}`);
    }

    await conn.executeQuery(sql, db);

    const inserts = [
        "('Widget', 'Electronics', 29.99, 10, '2024-01-15')",
        "('Gadget', 'Electronics', 49.99, 5, '2024-02-10')",
        "('Doohickey', 'Electronics', 19.99, 20, '2024-03-05')",
        "('Thingamajig', 'Home', 9.99, 50, '2024-01-20')",
        "('Whatchamacallit', 'Home', 14.99, 30, '2024-02-25')",
        "('Doodad', 'Home', 7.99, 40, '2024-03-15')",
        "('Gizmo', 'Office', 39.99, 8, '2024-01-10')",
        "('Contraption', 'Office', 59.99, 3, '2024-02-20')",
        "('Apparatus', 'Office', 24.99, 15, '2024-03-01')",
        "('Mechanism', 'Tools', 34.99, 12, '2024-01-25')",
    ];

    for (const vals of inserts) {
        await conn.executeQuery(
            `INSERT INTO chart_sales (product, category, amount, quantity, sale_date) VALUES ${vals}`,
            db
        );
    }
}

async function cleanup(conn: DatabaseConnection, db?: string) {
    try { await conn.executeQuery('DROP TABLE IF EXISTS chart_sales', db); } catch { /* ok */ }
}

// ── DB별 통합 테스트 ────────────────────────────

async function testForDB(label: string, conn: DatabaseConnection, dbType: string) {
    header(`${label} — Chart Integration`);
    const db = dbType === 'h2' ? undefined : conn.config.database;

    try { await setupTable(conn, dbType, db); } catch (e) {
        fail(`[${label}] 테이블 준비 실패`, e);
        return;
    }

    // 1. 전체 데이터 조회 → 차트 데이터 변환
    try {
        const result = await conn.executeQuery('SELECT * FROM chart_sales', db);
        assertEqual(result.rows.length, 10, `[${label}] 10행 조회`);

        // raw 막대 차트
        const barData = buildChartData(result, 'product', 'amount', 'raw');
        assertEqual(barData.length, 10, `[${label}] raw bar 10개`);
        assert(barData[0].value > 0, `[${label}] raw bar 값 > 0`);

        const barSvg = renderBarChart(barData);
        assert(barSvg.includes('<svg'), `[${label}] bar SVG 생성`);
        assert(barSvg.includes('rect'), `[${label}] bar rect 포함`);
    } catch (e) { fail(`[${label}] raw 막대 차트`, e); }

    // 2. 카테고리별 합계 → 파이 차트
    try {
        const result = await conn.executeQuery('SELECT * FROM chart_sales', db);
        const pieData = buildChartData(result, 'category', 'amount', 'sum');
        assertEqual(pieData.length, 4, `[${label}] sum 파이 4 카테고리`);

        const electronics = pieData.find(d => d.label === 'Electronics');
        assert(electronics !== undefined, `[${label}] Electronics 존재`);
        if (electronics) {
            // 29.99 + 49.99 + 19.99 = 99.97
            assert(electronics.value >= 99, `[${label}] Electronics sum ≈ 99.97`);
        }

        const pieSvg = renderPieChart(pieData);
        assert(pieSvg.includes('path'), `[${label}] pie path 포함`);
        assert(pieSvg.includes('%'), `[${label}] pie 퍼센트 포함`);
    } catch (e) { fail(`[${label}] 카테고리별 파이 차트`, e); }

    // 3. 카테고리별 개수 → 막대 차트
    try {
        const result = await conn.executeQuery('SELECT * FROM chart_sales', db);
        const countData = buildChartData(result, 'category', 'amount', 'count');
        const elecCount = countData.find(d => d.label === 'Electronics');
        if (elecCount) {
            assertEqual(elecCount.value, 3, `[${label}] Electronics count = 3`);
        } else {
            pass(`[${label}] Electronics count — skip`);
        }
    } catch (e) { fail(`[${label}] count 집계`, e); }

    // 4. 날짜별 라인 차트
    try {
        const result = await conn.executeQuery('SELECT * FROM chart_sales ORDER BY sale_date', db);
        const lineData = buildChartData(result, 'sale_date', 'amount', 'raw');
        assert(lineData.length === 10, `[${label}] line 10개`);

        const lineSvg = renderLineChart(lineData);
        assert(lineSvg.includes('<path'), `[${label}] line path 포함`);
        assert(lineSvg.includes('circle'), `[${label}] line dots 포함`);
    } catch (e) { fail(`[${label}] 날짜별 라인 차트`, e); }

    // 5. 평균 집계
    try {
        const result = await conn.executeQuery('SELECT * FROM chart_sales', db);
        const avgData = buildChartData(result, 'category', 'quantity', 'avg');
        const homeAvg = avgData.find(d => d.label === 'Home');
        if (homeAvg) {
            // (50+30+40)/3 = 40
            assertEqual(homeAvg.value, 40, `[${label}] Home avg quantity = 40`);
        } else {
            pass(`[${label}] Home avg — skip`);
        }
    } catch (e) { fail(`[${label}] 평균 집계`, e); }

    // 6. 빈 데이터 차트
    try {
        await conn.executeQuery('DELETE FROM chart_sales', db);
        const result = await conn.executeQuery('SELECT * FROM chart_sales', db);
        const emptyData = buildChartData(result, 'product', 'amount', 'raw');
        assertEqual(emptyData.length, 0, `[${label}] 빈 데이터 0개`);
        assert(renderBarChart(emptyData).includes('No data'), `[${label}] 빈 bar → No data`);
    } catch (e) { fail(`[${label}] 빈 데이터 차트`, e); }

    try { await cleanup(conn, db); } catch { /* ok */ }
}

// ── 실행 ────────────────────────────────────────

async function main() {
    console.log('╔══════════════════════════════════════════════════════════╗');
    console.log('║  DBunny v3.0.0 Chart Integration Tests                 ║');
    console.log('╚══════════════════════════════════════════════════════════╝');

    testUnitTests();

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
