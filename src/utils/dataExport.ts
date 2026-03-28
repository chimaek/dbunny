/**
 * v2.7.0 — Excel 내보내기 유틸리티
 * 단일/멀티시트 .xlsx 내보내기, 컬럼 타입 표시, 스타일 적용
 */

import * as XLSX from 'xlsx';
import { QueryResult, ColumnInfo } from '../types/database';

// ── 타입 ───────────────────────────────────────────

/** 내보내기 대상 시트 1개 */
export interface ExportSheet {
    /** 시트 이름 (31자 이내, 특수문자 제거됨) */
    sheetName: string;
    /** 쿼리 결과 데이터 */
    data: QueryResult;
    /** 컬럼 스키마 (타입 표시용, 선택) */
    schema?: ColumnInfo[];
    /** 표시할 컬럼 목록 (선택 — 없으면 전체) */
    visibleColumns?: string[];
}

/** Excel 내보내기 설정 */
export interface ExcelExportConfig {
    /** 내보낼 시트 목록 */
    sheets: ExportSheet[];
    /** 헤더 행에 컬럼 타입 표시 여부 */
    showColumnTypes: boolean;
}

// ── 상수 ───────────────────────────────────────────

/** Excel 시트 이름 최대 길이 */
const MAX_SHEET_NAME_LENGTH = 31;

/** 시트 이름에 사용할 수 없는 문자 */
const INVALID_SHEET_CHARS = /[\\/*?:[\]]/g;

// ── 유틸리티 ───────────────────────────────────────

/**
 * Excel 시트 이름을 안전하게 변환
 * - 특수문자 제거, 31자 제한, 중복 방지
 */
export function sanitizeSheetName(name: string, existingNames: string[] = []): string {
    let safe = name.replace(INVALID_SHEET_CHARS, '_').trim();
    if (!safe) { safe = 'Sheet'; }
    if (safe.length > MAX_SHEET_NAME_LENGTH) {
        safe = safe.substring(0, MAX_SHEET_NAME_LENGTH);
    }

    // 중복 방지: Sheet, Sheet_2, Sheet_3, ...
    let result = safe;
    let counter = 2;
    while (existingNames.includes(result)) {
        const suffix = `_${counter}`;
        result = safe.substring(0, MAX_SHEET_NAME_LENGTH - suffix.length) + suffix;
        counter++;
    }

    return result;
}

/**
 * 컬럼 타입 표시 문자열 생성
 */
export function formatColumnType(col: ColumnInfo): string {
    const parts: string[] = [col.type.toUpperCase()];
    if (col.primaryKey) { parts.unshift('PK'); }
    if (!col.nullable) { parts.push('NOT NULL'); }
    if (col.defaultValue !== undefined && col.defaultValue !== null) {
        parts.push(`DEFAULT=${col.defaultValue}`);
    }
    return parts.join(' | ');
}

/**
 * 셀 값 추정 너비 (문자 수 기반)
 */
function estimateWidth(value: unknown): number {
    if (value === null || value === undefined) { return 4; }
    const str = String(value);
    let width = 0;
    for (const ch of str) {
        // 한글 등 wide char → 2칸
        width += ch.charCodeAt(0) > 0x7F ? 2 : 1;
    }
    return width;
}

/**
 * DB 타입에 따른 식별자 이스케이프
 */
function quoteIdentifier(name: string, dbType: string): string {
    if (dbType === 'mysql') {
        return `\`${name.replace(/`/g, '``')}\``;
    }
    return `"${name.replace(/"/g, '""')}"`;
}

// ── 핵심 함수 ──────────────────────────────────────

/**
 * QueryResult를 워크시트로 변환
 * - 헤더 행 + 선택적 타입 행 + 데이터 행
 */
export function buildWorksheet(
    sheet: ExportSheet,
    showColumnTypes: boolean
): XLSX.WorkSheet {
    const headers = sheet.visibleColumns || sheet.data.fields.map(f => f.name);
    const rows: unknown[][] = [];

    // 1행: 헤더 (컬럼명)
    rows.push(headers);

    // 2행: 컬럼 타입 (선택)
    if (showColumnTypes && sheet.schema && sheet.schema.length > 0) {
        const typeRow = headers.map(h => {
            const col = sheet.schema!.find(c => c.name === h);
            return col ? formatColumnType(col) : '';
        });
        rows.push(typeRow);
    }

    // 데이터 행
    for (const row of sheet.data.rows) {
        const values = headers.map(h => {
            const val = row[h];
            if (val === null || val === undefined) { return null; }
            if (val instanceof Date) { return val.toISOString(); }
            if (val instanceof Uint8Array || Buffer.isBuffer(val)) {
                return `0x${Buffer.from(val).toString('hex').toUpperCase()}`;
            }
            return val;
        });
        rows.push(values);
    }

    const ws = XLSX.utils.aoa_to_sheet(rows);

    // 컬럼 너비 자동 조정
    const colWidths: number[] = headers.map(() => 8);
    for (const row of rows) {
        for (let i = 0; i < row.length; i++) {
            const w = estimateWidth(row[i]);
            if (w > colWidths[i]) { colWidths[i] = Math.min(w, 50); }
        }
    }
    ws['!cols'] = colWidths.map(w => ({ wch: w + 2 }));

    return ws;
}

/**
 * 단일 QueryResult → Excel Buffer
 */
export function exportSingleSheet(
    data: QueryResult,
    sheetName: string = 'Sheet1',
    schema?: ColumnInfo[],
    visibleColumns?: string[],
    showColumnTypes: boolean = true
): Uint8Array {
    const config: ExcelExportConfig = {
        sheets: [{
            sheetName,
            data,
            schema,
            visibleColumns,
        }],
        showColumnTypes,
    };
    return exportToExcel(config);
}

/**
 * 멀티시트 Excel 내보내기 — 핵심 함수
 */
export function exportToExcel(config: ExcelExportConfig): Uint8Array {
    const wb = XLSX.utils.book_new();
    const usedNames: string[] = [];

    for (const sheet of config.sheets) {
        const safeName = sanitizeSheetName(sheet.sheetName, usedNames);
        usedNames.push(safeName);

        const ws = buildWorksheet(sheet, config.showColumnTypes);
        XLSX.utils.book_append_sheet(wb, ws, safeName);
    }

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    return new Uint8Array(buf);
}

/**
 * 멀티 테이블 데이터 조회 후 Excel 내보내기
 */
export async function fetchAndExportTables(
    tables: { tableName: string; database?: string }[],
    executeQuery: (sql: string, db?: string) => Promise<QueryResult>,
    getSchema: (table: string, db?: string) => Promise<ColumnInfo[]>,
    showColumnTypes: boolean = true,
    dbType: string = 'postgres'
): Promise<Uint8Array> {
    const sheets: ExportSheet[] = [];

    for (const t of tables) {
        const quoted = quoteIdentifier(t.tableName, dbType);
        const data = await executeQuery(`SELECT * FROM ${quoted}`, t.database);
        const schema = await getSchema(t.tableName, t.database);

        sheets.push({
            sheetName: t.tableName,
            data,
            schema,
        });
    }

    return exportToExcel({ sheets, showColumnTypes });
}
