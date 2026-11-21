/**
 * v2.9.0 — 데이터 통계 유틸리티
 * 컬럼별 통계 쿼리 생성 + 결과 정리
 */

import { ColumnInfo, DatabaseConnection } from '../types/database';

// ── 타입 ───────────────────────────────────────────

/** 통계 항목 하나의 계산 결과. 계산에 성공해도 집계 값은 NULL일 수 있다. */
export type StatisticOutcome<T> =
    | { status: 'computed'; value: T }
    | { status: 'failed' }
    | { status: 'not-computed' };

interface ColumnStatisticOutcomes {
    totalCount: StatisticOutcome<number>;
    nullCount: StatisticOutcome<number>;
    nullPercent: StatisticOutcome<number>;
    distinctCount: StatisticOutcome<number>;
    min: StatisticOutcome<number | string | null>;
    max: StatisticOutcome<number | string | null>;
    avg: StatisticOutcome<number | null>;
    topValues: StatisticOutcome<{ value: string; count: number }[]>;
}

/** 단일 컬럼 통계 */
export interface ColumnStatistics {
    columnName: string;
    columnType: string;
    totalCount: number;
    nullCount: number;
    nullPercent: number;
    distinctCount: number;
    /** 최솟값·최댓값은 문자열도 지원하며 평균은 숫자 컬럼만 계산한다. */
    min?: number | string;
    max?: number | string;
    avg?: number;
    /** 상위 빈출값 */
    topValues: { value: string; count: number }[];
    /** 실패 여부를 판단하는 항목별 결과. 기존 수치 필드는 호환용이다. */
    outcomes?: ColumnStatisticOutcomes;
}

/** 테이블 전체 통계 */
export interface TableStatistics {
    tableName: string;
    totalRows: number;
    columnCount: number;
    columns: ColumnStatistics[];
    executionTime: number;
}

// ── 유틸리티 ───────────────────────────────────────

/** DB별 식별자 이스케이프 */
export function escapeIdentifier(name: string, dbType: string): string {
    if (dbType === 'mysql') { return `\`${name.replace(/`/g, '``')}\``; }
    return `"${name.replace(/"/g, '""')}"`;
}

/** 숫자 타입 여부 */
export function isNumericType(type: string): boolean {
    const t = type.toLowerCase();
    return t.includes('int') || t.includes('decimal') || t.includes('numeric')
        || t.includes('float') || t.includes('double') || t.includes('real')
        || t.includes('money') || t === 'serial' || t === 'bigserial'
        || t.includes('number');
}

/** DB별 LIMIT 구문 */
function limitClause(n: number, dbType: string): string {
    if (dbType === 'h2') { return `LIMIT ${n}`; }
    return `LIMIT ${n}`;
}

// ── 쿼리 빌더 ─────────────────────────────────────

/** 테이블 전체 행 수 쿼리 */
export function buildRowCountQuery(tableName: string, dbType: string): string {
    return `SELECT COUNT(*) AS total_rows FROM ${escapeIdentifier(tableName, dbType)}`;
}

/** 단일 컬럼 기본 통계 쿼리 (count, null, distinct) */
export function buildColumnStatsQuery(
    tableName: string,
    columnName: string,
    dbType: string
): string {
    const tbl = escapeIdentifier(tableName, dbType);
    const col = escapeIdentifier(columnName, dbType);
    return `SELECT
  COUNT(*) AS total_count,
  SUM(CASE WHEN ${col} IS NULL THEN 1 ELSE 0 END) AS null_count,
  COUNT(DISTINCT ${col}) AS distinct_count
FROM ${tbl}`;
}

/** 범위 집계 쿼리. 평균이 지원되지 않는 컬럼은 MIN/MAX만 조회한다. */
export function buildNumericStatsQuery(
    tableName: string,
    columnName: string,
    dbType: string,
    includeAverage = true
): string {
    const tbl = escapeIdentifier(tableName, dbType);
    const col = escapeIdentifier(columnName, dbType);
    return `SELECT
  MIN(${col}) AS min_val,
  MAX(${col}) AS max_val${includeAverage ? `,\n  AVG(${col}) AS avg_val` : ''}
FROM ${tbl}`;
}

/** 상위 N개 빈출값 쿼리 */
export function buildTopValuesQuery(
    tableName: string,
    columnName: string,
    dbType: string,
    topN: number = 10
): string {
    const tbl = escapeIdentifier(tableName, dbType);
    const col = escapeIdentifier(columnName, dbType);
    return `SELECT ${col} AS val, COUNT(*) AS cnt
FROM ${tbl}
WHERE ${col} IS NOT NULL
GROUP BY ${col}
ORDER BY cnt DESC
${limitClause(topN, dbType)}`;
}

// ── 통계 수집 ──────────────────────────────────────

function computed<T>(value: T): StatisticOutcome<T> {
    return { status: 'computed', value };
}

const failed = { status: 'failed' } as const;
const notComputed = { status: 'not-computed' } as const;

function aggregateValue(row: Record<string, unknown> | undefined, alias: string): unknown {
    if (!row) { return undefined; }
    // 드라이버마다 별칭의 대소문자가 다르다. SQL NULL은 그대로 유지한다.
    return Object.hasOwn(row, alias) ? row[alias] : row[alias.toUpperCase()];
}

function numericValue(value: unknown): number | undefined {
    if (typeof value !== 'number' && typeof value !== 'bigint' &&
        (typeof value !== 'string' || value.trim() === '')) { return undefined; }
    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
}

function countValue(value: unknown): StatisticOutcome<number> {
    const count = numericValue(value);
    return count !== undefined && Number.isInteger(count) && count >= 0 ? computed(count) : failed;
}

function rangeValue(value: unknown, numeric: boolean): StatisticOutcome<number | string | null> {
    if (value === null) { return computed(null); }
    const parsed = numeric ? numericValue(value) : value === undefined ? undefined : String(value);
    return parsed !== undefined ? computed(parsed) : failed;
}

function averageValue(value: unknown): StatisticOutcome<number | null> {
    if (value === null) { return computed(null); }
    const number = numericValue(value);
    return number !== undefined ? computed(Math.round(number * 100) / 100) : failed;
}

function legacyValue<T>(result: StatisticOutcome<T>): NonNullable<T> | undefined {
    return result.status === 'computed' ? result.value ?? undefined : undefined;
}

/**
 * 테이블 전체 통계 수집
 */
export async function collectTableStatistics(
    conn: Pick<DatabaseConnection, 'executeQuery'>,
    tableName: string,
    schema: ColumnInfo[],
    dbType: string,
    database?: string,
    topN: number = 10
): Promise<TableStatistics> {
    const startTime = Date.now();

    // 1. 총 행 수
    const rowCountResult = await conn.executeQuery(
        buildRowCountQuery(tableName, dbType), database
    );
    const rowCount = countValue(aggregateValue(rowCountResult.rows[0], 'total_rows'));
    if (rowCount.status !== 'computed') { throw new Error('Invalid table row count result'); }
    const totalRows = rowCount.value;

    // 2. 컬럼별 통계
    const columns: ColumnStatistics[] = [];

    for (const col of schema) {
        const numeric = isNumericType(col.type);
        const outcomes: ColumnStatisticOutcomes = {
            totalCount: failed,
            nullCount: failed,
            nullPercent: notComputed,
            distinctCount: failed,
            min: failed,
            max: failed,
            avg: numeric ? failed : notComputed,
            topValues: failed,
        };

        try {
            // 기본 통계 (count, null, distinct)
            const basicResult = await conn.executeQuery(
                buildColumnStatsQuery(tableName, col.name, dbType), database
            );
            const row = basicResult.rows[0];
            const count = countValue(aggregateValue(row, 'total_count'));
            const rawNulls = aggregateValue(row, 'null_count');
            // 빈 테이블에서는 SUM이 NULL이지만 NULL 행 수는 실제로 0이다.
            const nulls = count.status === 'computed' && count.value === 0 && rawNulls === null
                ? computed(0) : countValue(rawNulls);
            outcomes.totalCount = count;
            outcomes.nullCount = nulls;
            outcomes.distinctCount = countValue(aggregateValue(row, 'distinct_count'));
            if (count.status === 'computed' && nulls.status === 'computed') {
                outcomes.nullPercent = computed(count.value > 0 ? Math.round((nulls.value / count.value) * 10000) / 100 : 0);
            }
        } catch { /* 기본 집계 실패 상태 유지. 범위와 빈출값은 별도로 조회한다. */ }

        try {
            const result = await conn.executeQuery(buildNumericStatsQuery(tableName, col.name, dbType, numeric), database);
            const row = result.rows[0];
            outcomes.min = rangeValue(aggregateValue(row, 'min_val'), numeric);
            outcomes.max = rangeValue(aggregateValue(row, 'max_val'), numeric);
            if (numeric) { outcomes.avg = averageValue(aggregateValue(row, 'avg_val')); }
        } catch { /* 범위 집계 실패 상태 유지 */ }

        try {
            const result = await conn.executeQuery(buildTopValuesQuery(tableName, col.name, dbType, topN), database);
            outcomes.topValues = computed(result.rows.map(row => {
                const value = aggregateValue(row, 'val');
                const count = countValue(aggregateValue(row, 'cnt'));
                if (value === undefined || count.status !== 'computed') { throw new Error('Invalid frequency result'); }
                return { value: value === null ? 'NULL' : String(value), count: count.value };
            }));
        } catch { /* 빈출값 실패 상태 유지 */ }

        columns.push({
            columnName: col.name,
            columnType: col.type,
            totalCount: legacyValue(outcomes.totalCount) ?? totalRows,
            nullCount: legacyValue(outcomes.nullCount) ?? 0,
            nullPercent: legacyValue(outcomes.nullPercent) ?? 0,
            distinctCount: legacyValue(outcomes.distinctCount) ?? 0,
            min: legacyValue(outcomes.min),
            max: legacyValue(outcomes.max),
            avg: legacyValue(outcomes.avg),
            topValues: legacyValue(outcomes.topValues) ?? [],
            outcomes,
        });
    }

    return {
        tableName,
        totalRows,
        columnCount: schema.length,
        columns,
        executionTime: Date.now() - startTime,
    };
}
