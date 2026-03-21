/**
 * dataImport 유틸리티 유닛 테스트
 * 실행: npx tsx src/test/unit/dataImport.standalone.ts
 */

import {
    detectFormat,
    parseCSV,
    parseJSON,
    parseExcel,
    parseFile,
    suggestColumnMapping,
    escapeValue,
    escapeIdentifier,
    buildInsertSQL,
    buildConflictSQL,
    DEFAULT_BATCH_SIZE,
    MAX_PREVIEW_ROWS,
} from '../../utils/dataImport';
import { ColumnInfo, DatabaseType, ConflictStrategy } from '../../types/database';

let passed = 0;
let failed = 0;
const errors: string[] = [];

function assert(condition: boolean, message: string): void {
    if (condition) {
        passed++;
    } else {
        failed++;
        errors.push(`  FAIL: ${message}`);
        console.error(`  ✗ ${message}`);
    }
}

function assertEqual(actual: unknown, expected: unknown, message: string): void {
    if (actual === expected) {
        passed++;
    } else {
        failed++;
        const msg = `${message} — expected: ${JSON.stringify(expected)}, got: ${JSON.stringify(actual)}`;
        errors.push(`  FAIL: ${msg}`);
        console.error(`  ✗ ${msg}`);
    }
}

function section(name: string): void {
    console.log(`\n=== ${name} ===`);
}

// ===== detectFormat =====

section('detectFormat');

assertEqual(detectFormat('data.csv'), 'csv', 'CSV 확장자 감지');
assertEqual(detectFormat('DATA.CSV'), 'csv', 'CSV 대소문자 무관');
assertEqual(detectFormat('report.json'), 'json', 'JSON 확장자 감지');
assertEqual(detectFormat('sheet.xlsx'), 'xlsx', 'XLSX 확장자 감지');
assertEqual(detectFormat('old.xls'), 'xlsx', 'XLS → xlsx 감지');
assertEqual(detectFormat('file.txt'), null, 'TXT → null');
assertEqual(detectFormat('noext'), null, '확장자 없음 → null');
assertEqual(detectFormat('my.file.csv'), 'csv', '이중 확장자 → csv');

// ===== parseCSV =====

section('parseCSV');

{
    const csv = 'name,age,city\nAlice,30,Seoul\nBob,25,Busan\n';
    const buf = new TextEncoder().encode(csv);
    const result = parseCSV(buf, 'test.csv');

    assertEqual(result.headers.length, 3, 'CSV 헤더 수');
    assertEqual(result.headers[0], 'name', 'CSV 헤더 0');
    assertEqual(result.headers[1], 'age', 'CSV 헤더 1');
    assertEqual(result.headers[2], 'city', 'CSV 헤더 2');
    assertEqual(result.totalRows, 2, 'CSV 행 수');
    assertEqual(result.rows[0][0], 'Alice', 'CSV 첫 행 이름');
    assertEqual(result.rows[0][1], 30, 'CSV 숫자 파싱 (dynamicTyping)');
    assertEqual(result.format, 'csv', 'CSV format 필드');
    assertEqual(result.fileName, 'test.csv', 'CSV fileName');
}

{
    // 따옴표 포함 CSV
    const csv = 'name,desc\n"Alice","Hello, ""World"""\n';
    const buf = new TextEncoder().encode(csv);
    const result = parseCSV(buf, 'quoted.csv');
    assertEqual(result.rows[0][1], 'Hello, "World"', 'CSV 따옴표 이스케이프');
}

{
    // 빈 CSV
    try {
        const buf = new TextEncoder().encode('');
        parseCSV(buf, 'empty.csv');
        assert(false, 'CSV 빈 파일 예외 발생 필요');
    } catch (e) {
        assert(true, 'CSV 빈 파일 예외 발생');
    }
}

{
    // 헤더만 있는 CSV
    const csv = 'name,age\n';
    const buf = new TextEncoder().encode(csv);
    const result = parseCSV(buf, 'header-only.csv');
    assertEqual(result.totalRows, 0, 'CSV 헤더만 → 0행');
}

{
    // NULL 값
    const csv = 'a,b,c\n1,,3\n';
    const buf = new TextEncoder().encode(csv);
    const result = parseCSV(buf, 'nulls.csv');
    assertEqual(result.rows[0][1], null, 'CSV 빈 필드 → null (dynamicTyping)');
}

// ===== parseJSON =====

section('parseJSON');

{
    const json = JSON.stringify([
        { name: 'Alice', age: 30 },
        { name: 'Bob', age: 25 },
    ]);
    const buf = new TextEncoder().encode(json);
    const result = parseJSON(buf, 'test.json');

    assertEqual(result.headers.length, 2, 'JSON 헤더 수');
    assert(result.headers.includes('name'), 'JSON 헤더 name');
    assert(result.headers.includes('age'), 'JSON 헤더 age');
    assertEqual(result.totalRows, 2, 'JSON 행 수');
    assertEqual(result.format, 'json', 'JSON format');
}

{
    // 단일 객체
    const json = JSON.stringify({ name: 'Solo', age: 99 });
    const buf = new TextEncoder().encode(json);
    const result = parseJSON(buf, 'single.json');
    assertEqual(result.totalRows, 1, 'JSON 단일 객체 → 1행');
}

{
    // 이종 키 (일부 객체에만 존재하는 키)
    const json = JSON.stringify([
        { a: 1, b: 2 },
        { a: 3, c: 4 },
    ]);
    const buf = new TextEncoder().encode(json);
    const result = parseJSON(buf, 'mixed.json');
    assertEqual(result.headers.length, 3, 'JSON 이종 키 → 3 헤더');
    // a행에서 c는 null
    const cIdx = result.headers.indexOf('c');
    assertEqual(result.rows[0][cIdx], null, 'JSON 누락 키 → null');
}

{
    // 빈 배열
    try {
        const buf = new TextEncoder().encode('[]');
        parseJSON(buf, 'empty.json');
        assert(false, 'JSON 빈 배열 예외');
    } catch (e) {
        assert(true, 'JSON 빈 배열 예외 발생');
    }
}

{
    // 잘못된 JSON
    try {
        const buf = new TextEncoder().encode('{invalid');
        parseJSON(buf, 'bad.json');
        assert(false, 'JSON 파싱 에러 예외');
    } catch (e) {
        assert(true, 'JSON 파싱 에러 예외 발생');
    }
}

{
    // 숫자/문자열이 아닌 값
    try {
        const buf = new TextEncoder().encode('"just a string"');
        parseJSON(buf, 'string.json');
        assert(false, 'JSON 문자열 리터럴 예외');
    } catch (e) {
        assert(true, 'JSON 문자열 리터럴 예외 발생');
    }
}

// ===== parseExcel =====

section('parseExcel');

{
    // xlsx 라이브러리로 간단한 워크북 생성
    const XLSX = require('xlsx');
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
        ['name', 'age', 'city'],
        ['Alice', 30, 'Seoul'],
        ['Bob', 25, 'Busan'],
    ]);
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    const result = parseExcel(new Uint8Array(buf), 'test.xlsx');

    assertEqual(result.headers.length, 3, 'Excel 헤더 수');
    assertEqual(result.headers[0], 'name', 'Excel 헤더 0');
    assertEqual(result.totalRows, 2, 'Excel 행 수');
    assertEqual(result.rows[0][0], 'Alice', 'Excel 첫 행 이름');
    assertEqual(result.rows[0][1], 30, 'Excel 숫자');
    assertEqual(result.format, 'xlsx', 'Excel format');
}

// ===== parseFile (자동 형식 감지) =====

section('parseFile');

{
    const csv = 'x,y\n1,2\n';
    const buf = new TextEncoder().encode(csv);
    const result = parseFile(buf, 'auto.csv');
    assertEqual(result.format, 'csv', 'parseFile CSV 자동 감지');
}

{
    const json = JSON.stringify([{ a: 1 }]);
    const buf = new TextEncoder().encode(json);
    const result = parseFile(buf, 'auto.json');
    assertEqual(result.format, 'json', 'parseFile JSON 자동 감지');
}

{
    try {
        const buf = new TextEncoder().encode('hello');
        parseFile(buf, 'unknown.txt');
        assert(false, 'parseFile 지원하지 않는 형식 예외');
    } catch (e) {
        assert(true, 'parseFile 지원하지 않는 형식 예외 발생');
    }
}

// ===== suggestColumnMapping =====

section('suggestColumnMapping');

{
    const headers = ['name', 'age', 'email', 'unknown_field'];
    const columns: ColumnInfo[] = [
        { name: 'name', type: 'varchar(100)', nullable: false, primaryKey: false },
        { name: 'age', type: 'int', nullable: true, primaryKey: false },
        { name: 'email', type: 'varchar(255)', nullable: true, primaryKey: false },
        { name: 'id', type: 'int', nullable: false, primaryKey: true },
    ];

    const mappings = suggestColumnMapping(headers, columns);

    assertEqual(mappings.length, 4, '매핑 수 = 소스 헤더 수');
    assertEqual(mappings[0].targetColumn, 'name', 'name → name 매칭');
    assertEqual(mappings[1].targetColumn, 'age', 'age → age 매칭');
    assertEqual(mappings[2].targetColumn, 'email', 'email → email 매칭');
    assertEqual(mappings[3].targetColumn, '', 'unknown_field → 매칭 없음');
}

{
    // 언더스코어/하이픈 무시 매칭
    const headers = ['user_name', 'user-age'];
    const columns: ColumnInfo[] = [
        { name: 'username', type: 'varchar', nullable: false, primaryKey: false },
        { name: 'userage', type: 'int', nullable: true, primaryKey: false },
    ];

    const mappings = suggestColumnMapping(headers, columns);
    assertEqual(mappings[0].targetColumn, 'username', 'user_name → username (언더스코어 무시)');
    assertEqual(mappings[1].targetColumn, 'userage', 'user-age → userage (하이픈 무시)');
}

{
    // 포함 관계 매칭
    const headers = ['product_name'];
    const columns: ColumnInfo[] = [
        { name: 'name', type: 'varchar', nullable: false, primaryKey: false },
    ];

    const mappings = suggestColumnMapping(headers, columns);
    assertEqual(mappings[0].targetColumn, 'name', 'product_name → name (포함 관계)');
}

// ===== escapeValue =====

section('escapeValue');

assertEqual(escapeValue(null, 'mysql'), 'NULL', 'null → NULL');
assertEqual(escapeValue(undefined, 'mysql'), 'NULL', 'undefined → NULL');
assertEqual(escapeValue(42, 'mysql'), '42', '숫자');
assertEqual(escapeValue(3.14, 'postgres'), '3.14', '소수');
assertEqual(escapeValue(Infinity, 'mysql'), 'NULL', 'Infinity → NULL');
assertEqual(escapeValue(true, 'postgres'), 'TRUE', 'true');
assertEqual(escapeValue(false, 'sqlite'), 'FALSE', 'false');
assertEqual(escapeValue('hello', 'mysql'), "'hello'", '문자열');
assertEqual(escapeValue("it's", 'mysql'), "'it''s'", "MySQL 싱글쿼트 이스케이프 (표준 SQL)");
assertEqual(escapeValue("it's", 'postgres'), "'it''s'", "PG 싱글쿼트");
assertEqual(escapeValue('back\\slash', 'mysql'), "'back\\\\slash'", 'MySQL 백슬래시');
assertEqual(escapeValue('back\\slash', 'postgres'), "'back\\slash'", 'PG 백슬래시 보존');

// ===== escapeIdentifier =====

section('escapeIdentifier');

assertEqual(escapeIdentifier('name', 'mysql'), '`name`', 'MySQL 식별자');
assertEqual(escapeIdentifier('name', 'postgres'), '"name"', 'PG 식별자');
assertEqual(escapeIdentifier('name', 'sqlite'), '"name"', 'SQLite 식별자');
assertEqual(escapeIdentifier('name', 'h2'), '"name"', 'H2 식별자');
assertEqual(escapeIdentifier('table`name', 'mysql'), '`table``name`', 'MySQL 백틱 이스케이프');
assertEqual(escapeIdentifier('col"name', 'postgres'), '"col""name"', 'PG 더블쿼트 이스케이프');

// ===== buildInsertSQL =====

section('buildInsertSQL');

{
    const sql = buildInsertSQL('users', ['name', 'age'], ['Alice', 30], 'mysql');
    assertEqual(sql, "INSERT INTO `users` (`name`, `age`) VALUES ('Alice', 30)", 'MySQL INSERT');
}

{
    const sql = buildInsertSQL('users', ['name', 'age'], ['Alice', 30], 'postgres');
    assertEqual(sql, 'INSERT INTO "users" ("name", "age") VALUES (\'Alice\', 30)', 'PG INSERT');
}

{
    const sql = buildInsertSQL('users', ['name', 'val'], [null, true], 'sqlite');
    assertEqual(sql, 'INSERT INTO "users" ("name", "val") VALUES (NULL, TRUE)', 'SQLite INSERT NULL/BOOL');
}

// ===== buildConflictSQL — skip =====

section('buildConflictSQL — skip');

{
    const sql = buildConflictSQL('t', ['a', 'b'], [1, 2], 'mysql', 'skip', ['a']);
    assert(sql.startsWith('INSERT IGNORE INTO'), 'MySQL skip → INSERT IGNORE');
}

{
    const sql = buildConflictSQL('t', ['a', 'b'], [1, 2], 'postgres', 'skip', ['a']);
    assert(sql.includes('ON CONFLICT ("a") DO NOTHING'), 'PG skip → ON CONFLICT DO NOTHING');
}

{
    const sql = buildConflictSQL('t', ['a', 'b'], [1, 2], 'sqlite', 'skip', ['a']);
    assert(sql.startsWith('INSERT OR IGNORE INTO'), 'SQLite skip → INSERT OR IGNORE');
}

{
    const sql = buildConflictSQL('t', ['a', 'b'], [1, 2], 'h2', 'skip', ['a']);
    assert(sql.startsWith('INSERT INTO'), 'H2 skip → plain INSERT (중복은 isDuplicateKeyError 처리)');
}

// ===== buildConflictSQL — overwrite/upsert =====

section('buildConflictSQL — overwrite/upsert');

{
    const sql = buildConflictSQL('t', ['id', 'name'], [1, 'a'], 'mysql', 'upsert', ['id']);
    assert(sql.includes('ON DUPLICATE KEY UPDATE'), 'MySQL upsert → ON DUPLICATE KEY UPDATE');
    assert(sql.includes('`name` = VALUES(`name`)'), 'MySQL upsert non-PK 컬럼 업데이트');
    assert(!sql.includes('`id` = VALUES(`id`)'), 'MySQL upsert PK 제외');
}

{
    const sql = buildConflictSQL('t', ['id', 'val'], [1, 'x'], 'postgres', 'overwrite', ['id']);
    assert(sql.includes('ON CONFLICT ("id") DO UPDATE SET'), 'PG overwrite → ON CONFLICT DO UPDATE');
    assert(sql.includes('"val" = EXCLUDED."val"'), 'PG overwrite EXCLUDED 참조');
}

{
    const sql = buildConflictSQL('t', ['id', 'val'], [1, 'x'], 'sqlite', 'upsert', ['id']);
    assert(sql.startsWith('INSERT OR REPLACE INTO'), 'SQLite upsert → INSERT OR REPLACE');
}

{
    const sql = buildConflictSQL('t', ['id', 'val'], [1, 'x'], 'h2', 'upsert', ['id']);
    assert(sql.startsWith('MERGE INTO'), 'H2 upsert → MERGE INTO');
    assert(sql.includes('KEY ("id")'), 'H2 MERGE KEY 절');
}

{
    // PK만 있는 테이블 (non-PK 없음)
    const sql = buildConflictSQL('t', ['id'], [1], 'mysql', 'upsert', ['id']);
    // ON DUPLICATE KEY UPDATE 절이 없어야 함
    assert(!sql.includes('ON DUPLICATE KEY UPDATE'), 'MySQL upsert PK만 → UPDATE 없음');
}

{
    // PG - PK 없이 overwrite
    const sql = buildConflictSQL('t', ['a', 'b'], [1, 2], 'postgres', 'overwrite', []);
    // PK 없으면 일반 INSERT
    assert(!sql.includes('ON CONFLICT'), 'PG overwrite PK 없음 → 일반 INSERT');
}

// ===== 복합 PK =====

section('복합 PK');

{
    const sql = buildConflictSQL('t', ['a', 'b', 'c'], [1, 2, 3], 'postgres', 'upsert', ['a', 'b']);
    assert(sql.includes('ON CONFLICT ("a", "b") DO UPDATE SET'), 'PG 복합 PK conflict 절');
    assert(sql.includes('"c" = EXCLUDED."c"'), 'PG 복합 PK non-PK 업데이트');
}

{
    const sql = buildConflictSQL('t', ['a', 'b', 'c'], [1, 2, 3], 'h2', 'upsert', ['a', 'b']);
    assert(sql.includes('KEY ("a", "b")'), 'H2 복합 PK KEY 절');
}

// ===== 상수 검증 =====

section('상수 검증');

assertEqual(DEFAULT_BATCH_SIZE, 100, 'DEFAULT_BATCH_SIZE = 100');
assertEqual(MAX_PREVIEW_ROWS, 50, 'MAX_PREVIEW_ROWS = 50');

// ===== 다양한 DB 타입 × 전략 조합 =====

section('DB 타입 × 전략 조합');

const dbTypes: DatabaseType[] = ['mysql', 'postgres', 'sqlite', 'h2'];
const strategies: ConflictStrategy[] = ['skip', 'overwrite', 'upsert'];

for (const dbType of dbTypes) {
    for (const strategy of strategies) {
        const sql = buildConflictSQL('test_table', ['id', 'name', 'value'], [1, 'a', 'b'], dbType, strategy, ['id']);
        assert(typeof sql === 'string' && sql.length > 0, `${dbType} × ${strategy} → 유효한 SQL`);
    }
}

// ===== 특수 문자 이스케이프 =====

section('특수 문자 이스케이프');

{
    const sql = buildInsertSQL('users', ['bio'], ["Hello 'World' \"Quoted\""], 'mysql');
    assert(sql.includes("''"), 'MySQL 싱글쿼트 이스케이프 in INSERT');
}

{
    const sql = buildInsertSQL('data', ['json_col'], ['{"key": "value"}'], 'postgres');
    assert(sql.includes("'{\"key\": \"value\"}'"), 'PG JSON 문자열 보존');
}

{
    // 한국어 데이터
    const sql = buildInsertSQL('users', ['name'], ['홍길동'], 'mysql');
    assert(sql.includes("'홍길동'"), '한국어 데이터 보존');
}

{
    // 빈 문자열
    assertEqual(escapeValue('', 'mysql'), "''", '빈 문자열 이스케이프');
}

// ===== 결과 =====

console.log(`\n${'='.repeat(50)}`);
console.log(`Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
if (errors.length > 0) {
    console.log('\nFailed tests:');
    errors.forEach(e => console.log(e));
}
console.log(`${'='.repeat(50)}`);

process.exit(failed > 0 ? 1 : 0);
