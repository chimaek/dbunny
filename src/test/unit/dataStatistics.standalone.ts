/**
 * dataStatistics 유틸리티 유닛 테스트
 * 실행: npx tsx src/test/unit/dataStatistics.standalone.ts
 */

import {
    escapeIdentifier,
    isNumericType,
    buildRowCountQuery,
    buildColumnStatsQuery,
    buildNumericStatsQuery,
    buildTopValuesQuery,
} from '../../utils/dataStatistics';

// ── 헬퍼 ───────────────────────────────────────

let totalPass = 0;
let totalFail = 0;
const failures: string[] = [];

function section(name: string) { console.log(`\n--- ${name} ---`); }
function pass(msg: string) { totalPass++; console.log(`  ✅ ${msg}`); }
function fail(msg: string) { totalFail++; console.log(`  ❌ ${msg}`); failures.push(msg); }
function assert(cond: boolean, msg: string) { if (cond) { pass(msg); } else { fail(msg); } }
function assertEqual(a: unknown, b: unknown, msg: string) {
    if (a === b) { pass(msg); } else { fail(`${msg} — expected: ${JSON.stringify(b)}, got: ${JSON.stringify(a)}`); }
}

console.log('==================================================');
console.log('  dataStatistics 유닛 테스트');
console.log('==================================================');

// ===== escapeIdentifier =====

section('escapeIdentifier');

assertEqual(escapeIdentifier('users', 'mysql'), '`users`', 'MySQL 백틱');
assertEqual(escapeIdentifier('users', 'postgres'), '"users"', 'PG 큰따옴표');
assertEqual(escapeIdentifier('users', 'sqlite'), '"users"', 'SQLite 큰따옴표');
assertEqual(escapeIdentifier('users', 'h2'), '"users"', 'H2 큰따옴표');

// 특수문자 이스케이프
assertEqual(escapeIdentifier('my`table', 'mysql'), '`my``table`', 'MySQL 백틱 이스케이프');
assertEqual(escapeIdentifier('my"table', 'postgres'), '"my""table"', 'PG 큰따옴표 이스케이프');

// 예약어
assertEqual(escapeIdentifier('select', 'mysql'), '`select`', 'MySQL 예약어');
assertEqual(escapeIdentifier('order', 'postgres'), '"order"', 'PG 예약어');

// 한글 테이블명
assertEqual(escapeIdentifier('사용자', 'mysql'), '`사용자`', 'MySQL 한글');
assertEqual(escapeIdentifier('사용자', 'postgres'), '"사용자"', 'PG 한글');

// 빈 문자열
assertEqual(escapeIdentifier('', 'mysql'), '``', 'MySQL 빈 문자열');

// ===== isNumericType =====

section('isNumericType');

// 참
assert(isNumericType('INT'), 'INT');
assert(isNumericType('integer'), 'integer');
assert(isNumericType('BIGINT'), 'BIGINT');
assert(isNumericType('SMALLINT'), 'SMALLINT');
assert(isNumericType('TINYINT'), 'TINYINT');
assert(isNumericType('DECIMAL(10,2)'), 'DECIMAL(10,2)');
assert(isNumericType('NUMERIC(5)'), 'NUMERIC(5)');
assert(isNumericType('FLOAT'), 'FLOAT');
assert(isNumericType('DOUBLE'), 'DOUBLE');
assert(isNumericType('DOUBLE PRECISION'), 'DOUBLE PRECISION');
assert(isNumericType('REAL'), 'REAL');
assert(isNumericType('MONEY'), 'MONEY');
assert(isNumericType('SERIAL'), 'SERIAL');
assert(isNumericType('BIGSERIAL'), 'BIGSERIAL');
assert(isNumericType('NUMBER'), 'NUMBER');
assert(isNumericType('number(10)'), 'number(10)');

// 거짓
assert(!isNumericType('VARCHAR(100)'), 'VARCHAR(100)');
assert(!isNumericType('TEXT'), 'TEXT');
assert(!isNumericType('CHAR(10)'), 'CHAR(10)');
assert(!isNumericType('DATE'), 'DATE');
assert(!isNumericType('TIMESTAMP'), 'TIMESTAMP');
assert(!isNumericType('BOOLEAN'), 'BOOLEAN');
assert(!isNumericType('BLOB'), 'BLOB');
assert(!isNumericType('JSON'), 'JSON');
assert(!isNumericType('UUID'), 'UUID');
assert(!isNumericType('ENUM'), 'ENUM');

// ===== buildRowCountQuery =====

section('buildRowCountQuery');

{
    const q = buildRowCountQuery('users', 'mysql');
    assert(q.includes('COUNT(*)'), 'COUNT(*) 포함');
    assert(q.includes('`users`'), 'MySQL 테이블명');
    assert(q.includes('total_rows'), 'alias total_rows');
}

{
    const q = buildRowCountQuery('my_table', 'postgres');
    assert(q.includes('"my_table"'), 'PG 테이블명');
}

{
    const q = buildRowCountQuery('order', 'h2');
    assert(q.includes('"order"'), 'H2 예약어 이스케이프');
}

// ===== buildColumnStatsQuery =====

section('buildColumnStatsQuery');

{
    const q = buildColumnStatsQuery('users', 'age', 'mysql');
    assert(q.includes('COUNT(*)'), 'total_count');
    assert(q.includes('SUM(CASE WHEN `age` IS NULL'), 'null_count');
    assert(q.includes('COUNT(DISTINCT `age`)'), 'distinct_count');
    assert(q.includes('`users`'), '테이블명');
}

{
    const q = buildColumnStatsQuery('data', 'value', 'postgres');
    assert(q.includes('"value"'), 'PG 컬럼 이스케이프');
    assert(q.includes('"data"'), 'PG 테이블 이스케이프');
}

// ===== buildNumericStatsQuery =====

section('buildNumericStatsQuery');

{
    const q = buildNumericStatsQuery('users', 'salary', 'mysql');
    assert(q.includes('MIN(`salary`)'), 'MIN');
    assert(q.includes('MAX(`salary`)'), 'MAX');
    assert(q.includes('AVG(`salary`)'), 'AVG');
    assert(q.includes('`users`'), '테이블명');
}

{
    const q = buildNumericStatsQuery('t', 'c', 'sqlite');
    assert(q.includes('MIN("c")'), 'SQLite MIN');
    assert(q.includes('MAX("c")'), 'SQLite MAX');
    assert(q.includes('AVG("c")'), 'SQLite AVG');
}

// ===== buildTopValuesQuery =====

section('buildTopValuesQuery');

{
    const q = buildTopValuesQuery('users', 'dept', 'mysql', 10);
    assert(q.includes('GROUP BY `dept`'), 'GROUP BY');
    assert(q.includes('ORDER BY cnt DESC'), 'ORDER BY cnt DESC');
    assert(q.includes('LIMIT 10'), 'LIMIT 10');
    assert(q.includes('WHERE `dept` IS NOT NULL'), 'NULL 제외');
    assert(q.includes('`dept` AS val'), 'val alias');
    assert(q.includes('COUNT(*) AS cnt'), 'cnt alias');
}

{
    const q = buildTopValuesQuery('t', 'c', 'postgres', 5);
    assert(q.includes('LIMIT 5'), 'LIMIT 5');
    assert(q.includes('"c"'), 'PG 컬럼 이스케이프');
}

{
    const q = buildTopValuesQuery('t', 'c', 'h2', 3);
    assert(q.includes('LIMIT 3'), 'H2 LIMIT 3');
}

// 다른 topN 값
{
    const q = buildTopValuesQuery('t', 'c', 'mysql', 1);
    assert(q.includes('LIMIT 1'), 'topN=1');
}

{
    const q = buildTopValuesQuery('t', 'c', 'mysql', 100);
    assert(q.includes('LIMIT 100'), 'topN=100');
}

// ── 결과 ───────────────────────────────────────

console.log('\n==================================================');
console.log(`Total: ${totalPass + totalFail} | Passed: ${totalPass} | Failed: ${totalFail}`);
if (failures.length > 0) {
    console.log('\nFailed tests:');
    failures.forEach(f => console.log(`  FAIL: ${f}`));
}
console.log('==================================================');

process.exit(totalFail > 0 ? 1 : 0);
