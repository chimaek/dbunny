import * as Papa from 'papaparse';
import * as XLSX from 'xlsx';
import {
    ParsedFileData,
    ImportFileFormat,
    ColumnMapping,
    DataImportConfig,
    ImportProgress,
    ImportResult,
    ImportError,
    DatabaseType,
    DatabaseConnection,
    ColumnInfo,
    ConflictStrategy,
} from '../types/database';

// ===== 파일 파싱 =====

/**
 * 파일 확장자로 형식 판별
 */
export function detectFormat(fileName: string): ImportFileFormat | null {
    const ext = fileName.toLowerCase().split('.').pop();
    switch (ext) {
        case 'csv': return 'csv';
        case 'json': return 'json';
        case 'xlsx': case 'xls': return 'xlsx';
        default: return null;
    }
}

/**
 * CSV 바이트 → ParsedFileData
 */
export function parseCSV(buffer: Uint8Array, fileName: string): ParsedFileData {
    const text = new TextDecoder('utf-8').decode(buffer);
    const result = Papa.parse(text, {
        header: false,
        skipEmptyLines: true,
        dynamicTyping: true,
    });

    if (result.errors.length > 0 && result.data.length === 0) {
        throw new Error(`CSV parse error: ${result.errors[0].message}`);
    }

    const data = result.data as unknown[][];
    if (data.length === 0) {
        throw new Error('CSV file is empty');
    }

    const headers = (data[0] as unknown[]).map(h => String(h ?? ''));
    const rows = data.slice(1);

    return { headers, rows, totalRows: rows.length, format: 'csv', fileName };
}

/**
 * JSON 바이트 → ParsedFileData
 * 지원 형식: 배열 of 객체 [{ col: val }, ...]
 */
export function parseJSON(buffer: Uint8Array, fileName: string): ParsedFileData {
    const text = new TextDecoder('utf-8').decode(buffer);
    const parsed = JSON.parse(text);

    let data: Record<string, unknown>[];
    if (Array.isArray(parsed)) {
        data = parsed;
    } else if (parsed && typeof parsed === 'object') {
        // 단일 객체 → 배열로 래핑
        data = [parsed];
    } else {
        throw new Error('JSON must be an array of objects or a single object');
    }

    if (data.length === 0) {
        throw new Error('JSON array is empty');
    }

    // 모든 객체의 키를 합쳐서 헤더 생성
    const headerSet = new Set<string>();
    for (const row of data) {
        if (row && typeof row === 'object') {
            for (const key of Object.keys(row)) {
                headerSet.add(key);
            }
        }
    }
    const headers = Array.from(headerSet);

    // 객체 → 행 배열
    const rows = data.map(obj => headers.map(h => (obj as Record<string, unknown>)[h] ?? null));

    return { headers, rows, totalRows: rows.length, format: 'json', fileName };
}

/**
 * Excel 바이트 → ParsedFileData (첫 번째 시트)
 */
export function parseExcel(buffer: Uint8Array, fileName: string): ParsedFileData {
    const workbook = XLSX.read(buffer, { type: 'array' });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
        throw new Error('Excel file has no sheets');
    }

    const sheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null });

    if (data.length === 0) {
        throw new Error('Excel sheet is empty');
    }

    const headers = (data[0] as unknown[]).map(h => String(h ?? ''));
    const rows = data.slice(1) as unknown[][];

    return { headers, rows, totalRows: rows.length, format: 'xlsx', fileName };
}

/**
 * 형식에 따라 자동 파싱
 */
export function parseFile(buffer: Uint8Array, fileName: string): ParsedFileData {
    const format = detectFormat(fileName);
    if (!format) {
        throw new Error(`Unsupported file format: ${fileName}`);
    }

    switch (format) {
        case 'csv': return parseCSV(buffer, fileName);
        case 'json': return parseJSON(buffer, fileName);
        case 'xlsx': return parseExcel(buffer, fileName);
    }
}

// ===== 컬럼 매핑 자동 제안 =====

/**
 * 소스 헤더와 테이블 컬럼을 자동 매핑 (이름 유사도 기반)
 */
export function suggestColumnMapping(
    sourceHeaders: string[],
    tableColumns: ColumnInfo[]
): ColumnMapping[] {
    const mappings: ColumnMapping[] = [];

    for (const header of sourceHeaders) {
        const normalized = header.toLowerCase().replace(/[_\s-]/g, '');

        // 정확히 일치하는 컬럼 찾기
        let match = tableColumns.find(
            col => col.name.toLowerCase().replace(/[_\s-]/g, '') === normalized
        );

        // 포함 관계로 매칭
        if (!match) {
            match = tableColumns.find(
                col => normalized.includes(col.name.toLowerCase().replace(/[_\s-]/g, ''))
                    || col.name.toLowerCase().replace(/[_\s-]/g, '').includes(normalized)
            );
        }

        mappings.push({
            sourceColumn: header,
            targetColumn: match?.name ?? '',
            targetType: match?.type ?? '',
        });
    }

    return mappings;
}

// ===== SQL 생성 =====

/**
 * 값을 SQL 리터럴로 이스케이프
 */
export function escapeValue(value: unknown, dbType: DatabaseType): string {
    if (value === null || value === undefined) {
        return 'NULL';
    }
    if (typeof value === 'number') {
        if (!isFinite(value)) { return 'NULL'; }
        return String(value);
    }
    if (typeof value === 'boolean') {
        return value ? 'TRUE' : 'FALSE';
    }
    // 문자열 이스케이프 — 싱글쿼트 → 이중 싱글쿼트
    const str = String(value).replace(/'/g, "''");
    if (dbType === 'mysql') {
        // MySQL은 백슬래시도 이스케이프
        return `'${str.replace(/\\/g, '\\\\')}'`;
    }
    return `'${str}'`;
}

/**
 * 식별자(테이블명/컬럼명) 이스케이프
 */
export function escapeIdentifier(name: string, dbType: DatabaseType): string {
    switch (dbType) {
        case 'mysql':
            return `\`${name.replace(/`/g, '``')}\``;
        case 'h2':
        case 'postgres':
        case 'sqlite':
            return `"${name.replace(/"/g, '""')}"`;
        default:
            return `"${name.replace(/"/g, '""')}"`;
    }
}

/**
 * 단일 행 INSERT SQL 생성
 */
export function buildInsertSQL(
    tableName: string,
    columns: string[],
    values: unknown[],
    dbType: DatabaseType
): string {
    const tbl = escapeIdentifier(tableName, dbType);
    const cols = columns.map(c => escapeIdentifier(c, dbType)).join(', ');
    const vals = values.map(v => escapeValue(v, dbType)).join(', ');
    return `INSERT INTO ${tbl} (${cols}) VALUES (${vals})`;
}

/**
 * 충돌 처리 포함 INSERT SQL
 */
export function buildConflictSQL(
    tableName: string,
    columns: string[],
    values: unknown[],
    dbType: DatabaseType,
    strategy: ConflictStrategy,
    primaryKeyColumns: string[]
): string {
    const base = buildInsertSQL(tableName, columns, values, dbType);

    if (strategy === 'skip') {
        switch (dbType) {
            case 'mysql':
                return base.replace('INSERT INTO', 'INSERT IGNORE INTO');
            case 'postgres':
                if (primaryKeyColumns.length > 0) {
                    const pkCols = primaryKeyColumns.map(c => escapeIdentifier(c, dbType)).join(', ');
                    return `${base} ON CONFLICT (${pkCols}) DO NOTHING`;
                }
                return base.replace('INSERT INTO', 'INSERT INTO') + ' ON CONFLICT DO NOTHING';
            case 'sqlite':
                return base.replace('INSERT INTO', 'INSERT OR IGNORE INTO');
            case 'h2':
                // H2는 INSERT IGNORE/MERGE 모두 skip 지원 불가
                // 일반 INSERT → isDuplicateKeyError로 catch 처리
                return base;
            default:
                return base;
        }
    }

    if (strategy === 'overwrite' || strategy === 'upsert') {
        const nonPkCols = columns.filter(c => !primaryKeyColumns.includes(c));

        switch (dbType) {
            case 'mysql': {
                if (nonPkCols.length === 0) { return base; }
                const updates = nonPkCols.map(c => {
                    const esc = escapeIdentifier(c, dbType);
                    return `${esc} = VALUES(${esc})`;
                }).join(', ');
                return `${base} ON DUPLICATE KEY UPDATE ${updates}`;
            }
            case 'postgres': {
                if (primaryKeyColumns.length === 0) { return base; }
                const pkCols = primaryKeyColumns.map(c => escapeIdentifier(c, dbType)).join(', ');
                if (nonPkCols.length === 0) {
                    return `${base} ON CONFLICT (${pkCols}) DO NOTHING`;
                }
                const updates = nonPkCols.map(c => {
                    const esc = escapeIdentifier(c, dbType);
                    return `${esc} = EXCLUDED.${esc}`;
                }).join(', ');
                return `${base} ON CONFLICT (${pkCols}) DO UPDATE SET ${updates}`;
            }
            case 'sqlite': {
                return base.replace('INSERT INTO', 'INSERT OR REPLACE INTO');
            }
            case 'h2': {
                // H2 MERGE INTO — PK 컬럼이 INSERT 컬럼에 포함된 경우에만
                const pkInCols = primaryKeyColumns.filter(pk => columns.includes(pk));
                if (pkInCols.length > 0) {
                    const tbl = escapeIdentifier(tableName, dbType);
                    const cols = columns.map(c => escapeIdentifier(c, dbType)).join(', ');
                    const vals = values.map(v => escapeValue(v, dbType)).join(', ');
                    const pkCols = pkInCols.map(c => escapeIdentifier(c, dbType)).join(', ');
                    return `MERGE INTO ${tbl} (${cols}) KEY (${pkCols}) VALUES (${vals})`;
                }
                return base;
            }
            default:
                return base;
        }
    }

    return base;
}

// ===== 배치 가져오기 =====

/** 기본 배치 크기 */
export const DEFAULT_BATCH_SIZE = 100;

/** 최대 미리보기 행 수 */
export const MAX_PREVIEW_ROWS = 50;

/**
 * 데이터를 배치로 나누어 테이블에 가져오기
 */
export async function importData(
    connection: DatabaseConnection,
    parsedData: ParsedFileData,
    config: DataImportConfig,
    onProgress?: (progress: ImportProgress) => void
): Promise<ImportResult> {
    const startTime = Date.now();
    const dbType = connection.config.type;

    // 매핑된 컬럼만 사용
    const activeMappings = config.columnMapping.filter(m => m.targetColumn !== '');
    if (activeMappings.length === 0) {
        throw new Error('No columns mapped — at least one column must be mapped');
    }

    const targetColumns = activeMappings.map(m => m.targetColumn);
    const sourceIndices = activeMappings.map(m =>
        parsedData.headers.indexOf(m.sourceColumn)
    );

    const progress: ImportProgress = {
        total: parsedData.totalRows,
        current: 0,
        inserted: 0,
        skipped: 0,
        failed: 0,
        errors: [],
    };

    const batchSize = config.batchSize || DEFAULT_BATCH_SIZE;
    const pkColumns = config.primaryKeyColumns || [];

    for (let i = 0; i < parsedData.rows.length; i += batchSize) {
        const batch = parsedData.rows.slice(i, i + batchSize);

        for (let j = 0; j < batch.length; j++) {
            const rowIndex = i + j;
            const row = batch[j];
            const values = sourceIndices.map(idx => (idx >= 0 ? row[idx] : null));

            try {
                const sql = buildConflictSQL(
                    config.tableName,
                    targetColumns,
                    values,
                    dbType,
                    config.conflictStrategy,
                    pkColumns
                );

                const result = await connection.executeQuery(sql, config.database);

                // 행 삽입 여부 판단
                if (result.rowCount > 0 || config.conflictStrategy === 'skip') {
                    progress.inserted++;
                } else {
                    progress.skipped++;
                }
            } catch (error) {
                const msg = error instanceof Error ? error.message : String(error);

                // skip 전략이고 중복 키 에러면 skipped 카운트
                if (config.conflictStrategy === 'skip' && isDuplicateKeyError(msg)) {
                    progress.skipped++;
                } else {
                    progress.failed++;
                    if (progress.errors.length < 100) {
                        progress.errors.push({ row: rowIndex + 1, message: msg });
                    }
                }
            }

            progress.current = rowIndex + 1;
        }

        // 배치 완료마다 진행률 콜백
        if (onProgress) {
            onProgress({ ...progress });
        }
    }

    return {
        inserted: progress.inserted,
        skipped: progress.skipped,
        failed: progress.failed,
        errors: progress.errors,
        executionTime: Date.now() - startTime,
    };
}

/**
 * 중복 키 에러 판별
 */
function isDuplicateKeyError(message: string): boolean {
    const msg = message.toLowerCase();
    return msg.includes('duplicate')
        || msg.includes('unique constraint')
        || msg.includes('unique index')
        || msg.includes('primary key violation')
        || msg.includes('conflict')
        || msg.includes('already exists');
}
