/**
 * dataExport 유틸리티 유닛 테스트
 * 실행: npx tsx src/test/unit/dataExport.standalone.ts
 */

import * as XLSX from 'xlsx';
import {
    sanitizeSheetName,
    formatColumnType,
    buildWorksheet,
    exportSingleSheet,
    exportToExcel,
    ExcelExportConfig,
} from '../../utils/dataExport';
import { QueryResult, ColumnInfo, FieldInfo } from '../../types/database';

// ── 테스트 헬퍼 ────────────────────────────────────

let totalPass = 0;
let totalFail = 0;
const failures: string[] = [];

function section(name: string) {
    console.log(`\n--- ${name} ---`);
}

function pass(msg: string) {
    totalPass++;
    console.log(`  ✅ ${msg}`);
}

function fail(msg: string) {
    totalFail++;
    console.log(`  ❌ ${msg}`);
    failures.push(msg);
}

function assert(condition: boolean, msg: string) {
    if (condition) { pass(msg); } else { fail(msg); }
}

function assertEqual(actual: unknown, expected: unknown, msg: string) {
    if (actual === expected) {
        pass(msg);
    } else {
        fail(`${msg} — expected: ${JSON.stringify(expected)}, got: ${JSON.stringify(actual)}`);
    }
}

// ── 테스트 데이터 헬퍼 ─────────────────────────────

function makeQueryResult(
    fields: { name: string; type: string }[],
    rows: Record<string, unknown>[]
): QueryResult {
    return {
        fields: fields.map(f => ({ name: f.name, type: f.type } as FieldInfo)),
        rows,
        rowCount: rows.length,
        executionTime: 10,
    };
}

function makeSchema(cols: Partial<ColumnInfo>[]): ColumnInfo[] {
    return cols.map(c => ({
        name: c.name || '',
        type: c.type || 'VARCHAR',
        nullable: c.nullable ?? true,
        primaryKey: c.primaryKey ?? false,
        defaultValue: c.defaultValue,
    }));
}

/** Excel Buffer → 2D 배열로 읽기 */
function readExcelSheet(buf: Uint8Array, sheetIndex: number = 0): unknown[][] {
    const wb = XLSX.read(buf, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[sheetIndex]];
    return XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
}

function readExcelSheetNames(buf: Uint8Array): string[] {
    const wb = XLSX.read(buf, { type: 'array' });
    return wb.SheetNames;
}

// ── 테스트 시작 ────────────────────────────────────

console.log('==================================================');
console.log('  dataExport 유닛 테스트');
console.log('==================================================');

// ===== sanitizeSheetName =====

section('sanitizeSheetName');

assertEqual(sanitizeSheetName('users'), 'users', '기본 이름 유지');
assertEqual(sanitizeSheetName('data/log'), 'data_log', '슬래시 → 언더스코어');
assertEqual(sanitizeSheetName('a:b*c?d[e]f\\g'), 'a_b_c_d_e_f_g', '모든 특수문자 변환');
assertEqual(sanitizeSheetName(''), 'Sheet', '빈 문자열 → Sheet');

{
    const longName = 'a'.repeat(50);
    const result = sanitizeSheetName(longName);
    assert(result.length <= 31, `31자 제한 (${result.length}자)`);
}

{
    const existing = ['users'];
    assertEqual(sanitizeSheetName('users', existing), 'users_2', '중복 방지 _2');
}

{
    const existing = ['users', 'users_2', 'users_3'];
    assertEqual(sanitizeSheetName('users', existing), 'users_4', '중복 방지 _4');
}

{
    // 긴 이름 + 중복 → suffix 공간 확보
    const longName = 'a'.repeat(31);
    const existing = [longName.substring(0, 31)];
    const result = sanitizeSheetName(longName, existing);
    assert(result.length <= 31, `긴 이름 중복 시 31자 제한 (${result.length}자)`);
    assert(result.endsWith('_2'), '긴 이름 중복 시 _2 suffix');
}

// ===== formatColumnType =====

section('formatColumnType');

{
    const col = makeSchema([{ name: 'id', type: 'int', primaryKey: true, nullable: false }])[0];
    const result = formatColumnType(col);
    assert(result.includes('PK'), 'PK 포함');
    assert(result.includes('INT'), '타입 대문자');
    assert(result.includes('NOT NULL'), 'NOT NULL 포함');
}

{
    const col = makeSchema([{ name: 'name', type: 'varchar(100)', nullable: true }])[0];
    const result = formatColumnType(col);
    assert(!result.includes('PK'), 'PK 없음');
    assert(!result.includes('NOT NULL'), 'nullable이면 NOT NULL 없음');
    assert(result.includes('VARCHAR(100)'), '타입 대문자');
}

{
    const col = makeSchema([{ name: 'status', type: 'int', nullable: false, defaultValue: '0' }])[0];
    const result = formatColumnType(col);
    assert(result.includes('DEFAULT=0'), 'DEFAULT 값 포함');
}

{
    const col = makeSchema([{ name: 'age', type: 'int', nullable: true, defaultValue: undefined }])[0];
    const result = formatColumnType(col);
    assert(!result.includes('DEFAULT'), 'DEFAULT 없음');
}

// ===== buildWorksheet =====

section('buildWorksheet — 기본');

{
    const data = makeQueryResult(
        [{ name: 'name', type: 'varchar' }, { name: 'age', type: 'int' }],
        [{ name: 'Alice', age: 30 }, { name: 'Bob', age: 25 }]
    );

    const ws = buildWorksheet({ sheetName: 'test', data }, false);
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null }) as unknown[][];

    assertEqual(rows.length, 3, '헤더 + 데이터 2행 = 3행');
    assertEqual(rows[0][0], 'name', '헤더 0');
    assertEqual(rows[0][1], 'age', '헤더 1');
    assertEqual(rows[1][0], 'Alice', '데이터 0,0');
    assertEqual(rows[1][1], 30, '데이터 0,1');
    assertEqual(rows[2][0], 'Bob', '데이터 1,0');
}

section('buildWorksheet — 컬럼 타입 표시');

{
    const data = makeQueryResult(
        [{ name: 'id', type: 'int' }, { name: 'name', type: 'varchar' }],
        [{ id: 1, name: 'test' }]
    );
    const schema = makeSchema([
        { name: 'id', type: 'int', primaryKey: true, nullable: false },
        { name: 'name', type: 'varchar(100)', nullable: true },
    ]);

    const ws = buildWorksheet({ sheetName: 'test', data, schema }, true);
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null }) as unknown[][];

    assertEqual(rows.length, 3, '헤더 + 타입 + 데이터 1행 = 3행');
    assert(String(rows[1][0]).includes('PK'), '타입 행에 PK 표시');
    assert(String(rows[1][0]).includes('INT'), '타입 행에 INT');
    assertEqual(rows[2][0], 1, '데이터 행 시작 (타입 행 이후)');
}

section('buildWorksheet — 타입 표시 비활성화');

{
    const data = makeQueryResult(
        [{ name: 'id', type: 'int' }],
        [{ id: 1 }]
    );
    const schema = makeSchema([{ name: 'id', type: 'int', primaryKey: true }]);

    const ws = buildWorksheet({ sheetName: 'test', data, schema }, false);
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null }) as unknown[][];

    assertEqual(rows.length, 2, '타입 행 없이 헤더 + 데이터 = 2행');
}

section('buildWorksheet — visibleColumns');

{
    const data = makeQueryResult(
        [{ name: 'id', type: 'int' }, { name: 'name', type: 'varchar' }, { name: 'email', type: 'varchar' }],
        [{ id: 1, name: 'Alice', email: 'a@t.com' }]
    );

    const ws = buildWorksheet({ sheetName: 'test', data, visibleColumns: ['name', 'email'] }, false);
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null }) as unknown[][];

    assertEqual(rows[0].length, 2, 'visibleColumns로 2개만 표시');
    assertEqual(rows[0][0], 'name', '첫번째 컬럼');
    assertEqual(rows[0][1], 'email', '두번째 컬럼');
}

section('buildWorksheet — NULL 값');

{
    const data = makeQueryResult(
        [{ name: 'name', type: 'varchar' }, { name: 'age', type: 'int' }],
        [{ name: 'Alice', age: null }, { name: null, age: 25 }]
    );

    const ws = buildWorksheet({ sheetName: 'test', data }, false);
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null }) as unknown[][];

    assertEqual(rows[1][1], null, 'NULL age 보존');
    assertEqual(rows[2][0], null, 'NULL name 보존');
}

section('buildWorksheet — 컬럼 너비');

{
    const data = makeQueryResult(
        [{ name: 'short', type: 'int' }, { name: 'very_long_column_name_here', type: 'varchar' }],
        [{ short: 1, very_long_column_name_here: 'value' }]
    );

    const ws = buildWorksheet({ sheetName: 'test', data }, false);
    assert(ws['!cols'] !== undefined, '컬럼 너비 설정됨');
    assert(ws['!cols']!.length === 2, '컬럼 2개');
    assert(ws['!cols']![1].wch! > ws['!cols']![0].wch!, '긴 컬럼이 더 넓음');
}

section('buildWorksheet — 한글 너비');

{
    const data = makeQueryResult(
        [{ name: 'name', type: 'varchar' }],
        [{ name: '한글이름테스트' }]
    );

    const ws = buildWorksheet({ sheetName: 'test', data }, false);
    // 한글 7자 × 2 = 14 → 최소 14 이상이어야 함
    assert(ws['!cols']![0].wch! >= 14, '한글 너비 계산 (wide char × 2)');
}

section('buildWorksheet — 빈 데이터');

{
    const data = makeQueryResult(
        [{ name: 'id', type: 'int' }, { name: 'name', type: 'varchar' }],
        []
    );

    const ws = buildWorksheet({ sheetName: 'test', data }, false);
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null }) as unknown[][];

    assertEqual(rows.length, 1, '빈 데이터 → 헤더만');
    assertEqual(rows[0][0], 'id', '헤더 유지');
}

// ===== exportSingleSheet =====

section('exportSingleSheet');

{
    const data = makeQueryResult(
        [{ name: 'id', type: 'int' }, { name: 'name', type: 'varchar' }],
        [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }]
    );

    const buf = exportSingleSheet(data, 'users');
    assert(buf instanceof Uint8Array, '반환 타입 Uint8Array');
    assert(buf.length > 0, '빈 버퍼가 아님');

    const sheets = readExcelSheetNames(buf);
    assertEqual(sheets.length, 1, '시트 1개');
    assertEqual(sheets[0], 'users', '시트 이름');

    const rows = readExcelSheet(buf);
    assertEqual(rows.length, 3, '스키마 없으면 타입 행 없이 헤더 + 데이터 2 = 3행');
}

{
    const data = makeQueryResult(
        [{ name: 'x', type: 'int' }],
        [{ x: 1 }]
    );
    const buf = exportSingleSheet(data, 'Sheet1', undefined, undefined, false);
    const rows = readExcelSheet(buf);
    assertEqual(rows.length, 2, 'showColumnTypes=false → 헤더 + 데이터 = 2행');
}

{
    const data = makeQueryResult(
        [{ name: 'id', type: 'int' }, { name: 'name', type: 'varchar' }, { name: 'age', type: 'int' }],
        [{ id: 1, name: 'Alice', age: 30 }]
    );
    const buf = exportSingleSheet(data, 'test', undefined, ['name', 'age'], false);
    const rows = readExcelSheet(buf);
    assertEqual(rows[0].length, 2, 'visibleColumns로 2개만');
    assertEqual(rows[0][0], 'name', 'visibleColumns 순서');
}

// ===== exportToExcel — 멀티시트 =====

section('exportToExcel — 멀티시트');

{
    const data1 = makeQueryResult(
        [{ name: 'id', type: 'int' }],
        [{ id: 1 }, { id: 2 }]
    );
    const data2 = makeQueryResult(
        [{ name: 'name', type: 'varchar' }, { name: 'email', type: 'varchar' }],
        [{ name: 'Alice', email: 'a@t.com' }]
    );

    const config: ExcelExportConfig = {
        sheets: [
            { sheetName: 'users', data: data1 },
            { sheetName: 'contacts', data: data2 },
        ],
        showColumnTypes: false,
    };

    const buf = exportToExcel(config);
    const sheets = readExcelSheetNames(buf);

    assertEqual(sheets.length, 2, '멀티시트 2개');
    assertEqual(sheets[0], 'users', '시트1 이름');
    assertEqual(sheets[1], 'contacts', '시트2 이름');

    const rows1 = readExcelSheet(buf, 0);
    assertEqual(rows1.length, 3, '시트1: 헤더 + 데이터 2행');

    const rows2 = readExcelSheet(buf, 1);
    assertEqual(rows2.length, 2, '시트2: 헤더 + 데이터 1행');
    assertEqual(rows2[0].length, 2, '시트2: 컬럼 2개');
}

section('exportToExcel — 중복 시트 이름 자동 해결');

{
    const data = makeQueryResult([{ name: 'x', type: 'int' }], [{ x: 1 }]);

    const config: ExcelExportConfig = {
        sheets: [
            { sheetName: 'Sheet', data },
            { sheetName: 'Sheet', data },
            { sheetName: 'Sheet', data },
        ],
        showColumnTypes: false,
    };

    const buf = exportToExcel(config);
    const sheets = readExcelSheetNames(buf);

    assertEqual(sheets[0], 'Sheet', '첫번째 시트 원본 이름');
    assertEqual(sheets[1], 'Sheet_2', '두번째 중복 → _2');
    assertEqual(sheets[2], 'Sheet_3', '세번째 중복 → _3');
}

section('exportToExcel — 특수문자 시트 이름');

{
    const data = makeQueryResult([{ name: 'x', type: 'int' }], [{ x: 1 }]);

    const config: ExcelExportConfig = {
        sheets: [
            { sheetName: 'data/log', data },
            { sheetName: 'test:result', data },
        ],
        showColumnTypes: false,
    };

    const buf = exportToExcel(config);
    const sheets = readExcelSheetNames(buf);

    assertEqual(sheets[0], 'data_log', '슬래시 → 언더스코어');
    assertEqual(sheets[1], 'test_result', '콜론 → 언더스코어');
}

section('exportToExcel — 스키마 포함 멀티시트');

{
    const data = makeQueryResult(
        [{ name: 'id', type: 'int' }, { name: 'name', type: 'varchar' }],
        [{ id: 1, name: 'Alice' }]
    );
    const schema = makeSchema([
        { name: 'id', type: 'int', primaryKey: true, nullable: false },
        { name: 'name', type: 'varchar(100)', nullable: true },
    ]);

    const config: ExcelExportConfig = {
        sheets: [
            { sheetName: 'users', data, schema },
        ],
        showColumnTypes: true,
    };

    const buf = exportToExcel(config);
    const rows = readExcelSheet(buf, 0);

    assertEqual(rows.length, 3, '헤더 + 타입 + 데이터 1 = 3행');
    assert(String(rows[1][0]).includes('PK'), '타입 행에 PK');
    assertEqual(rows[2][0], 1, '데이터는 3행부터');
}

section('exportToExcel — 대용량 데이터');

{
    const fields = [{ name: 'id', type: 'int' }, { name: 'val', type: 'varchar' }];
    const rows: Record<string, unknown>[] = [];
    for (let i = 0; i < 1000; i++) {
        rows.push({ id: i, val: `row_${i}` });
    }
    const data = makeQueryResult(fields, rows);

    const buf = exportSingleSheet(data, 'big', undefined, undefined, false);
    const excelRows = readExcelSheet(buf);

    assertEqual(excelRows.length, 1001, '헤더 + 1000행');
    assertEqual(excelRows[1][0], 0, '첫 데이터 행 id=0');
    assertEqual(excelRows[1000][0], 999, '마지막 데이터 행 id=999');
}

section('exportToExcel — 한글 데이터');

{
    const data = makeQueryResult(
        [{ name: '이름', type: 'varchar' }, { name: '나이', type: 'int' }],
        [{ '이름': '홍길동', '나이': 30 }, { '이름': '김영희', '나이': 25 }]
    );

    const buf = exportSingleSheet(data, '사용자', undefined, undefined, false);
    const sheets = readExcelSheetNames(buf);
    assertEqual(sheets[0], '사용자', '한글 시트 이름');

    const rows = readExcelSheet(buf);
    assertEqual(rows[0][0], '이름', '한글 헤더');
    assertEqual(rows[1][0], '홍길동', '한글 데이터');
}

section('exportToExcel — 특수 값 타입');

{
    const data = makeQueryResult(
        [{ name: 'txt', type: 'text' }, { name: 'num', type: 'int' }, { name: 'nil', type: 'int' }],
        [
            { txt: "he said \"hello\"", num: 0, nil: null },
            { txt: "line1\nline2", num: -42, nil: undefined },
        ]
    );

    const buf = exportSingleSheet(data, 'special', undefined, undefined, false);
    const rows = readExcelSheet(buf);

    assertEqual(rows[1][0], 'he said "hello"', '따옴표 보존');
    assertEqual(rows[1][1], 0, '숫자 0 보존');
    assertEqual(rows[1][2], null, 'null 보존');
    assert(String(rows[2][0]).includes('line1'), '개행 포함 문자열');
    assertEqual(rows[2][1], -42, '음수 보존');
}

// ── 결과 ───────────────────────────────────────────

console.log('\n==================================================');
console.log(`Total: ${totalPass + totalFail} | Passed: ${totalPass} | Failed: ${totalFail}`);
if (failures.length > 0) {
    console.log('\nFailed tests:');
    failures.forEach(f => console.log(`  FAIL: ${f}`));
}
console.log('==================================================');

process.exit(totalFail > 0 ? 1 : 0);
