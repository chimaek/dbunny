/**
 * v2.9.0 — 데이터 통계 유틸리티
 * 컬럼별 통계 쿼리 생성 + 결과 정리
 */

import { ColumnInfo, DatabaseConnection } from '../types/database';

// ── 타입 ───────────────────────────────────────────

/** 단일 컬럼 통계 */
export interface ColumnStatistics {
    columnName: string;
    columnType: string;
    totalCount: number;
    nullCount: number;
    nullPercent: number;
    distinctCount: number;
    /** 숫자 컬럼 전용 */
    min?: number | string;
    max?: number | string;
    avg?: number;
    /** 상위 빈출값 */
    topValues: { value: string; count: number }[];
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

/** 숫자 컬럼 min/max/avg 쿼리 */
export function buildNumericStatsQuery(
    tableName: string,
    columnName: string,
    dbType: string
): string {
    const tbl = escapeIdentifier(tableName, dbType);
    const col = escapeIdentifier(columnName, dbType);
    return `SELECT
  MIN(${col}) AS min_val,
  MAX(${col}) AS max_val,
  AVG(${col}) AS avg_val
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

/**
 * 테이블 전체 통계 수집
 */
export async function collectTableStatistics(
    conn: DatabaseConnection,
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
    const totalRows = Number(
        rowCountResult.rows[0]?.total_rows
        ?? rowCountResult.rows[0]?.TOTAL_ROWS
        ?? 0
    );

    // 2. 컬럼별 통계
    const columns: ColumnStatistics[] = [];

    for (const col of schema) {
        const colStat: ColumnStatistics = {
            columnName: col.name,
            columnType: col.type,
            totalCount: totalRows,
            nullCount: 0,
            nullPercent: 0,
            distinctCount: 0,
            topValues: [],
        };

        try {
            // 기본 통계 (count, null, distinct)
            const basicResult = await conn.executeQuery(
                buildColumnStatsQuery(tableName, col.name, dbType), database
            );
            const row = basicResult.rows[0] as Record<string, unknown>;
            if (row) {
                colStat.totalCount = Number(row.total_count ?? row.TOTAL_COUNT ?? totalRows);
                colStat.nullCount = Number(row.null_count ?? row.NULL_COUNT ?? 0);
                colStat.distinctCount = Number(row.distinct_count ?? row.DISTINCT_COUNT ?? 0);
                colStat.nullPercent = colStat.totalCount > 0
                    ? Math.round((colStat.nullCount / colStat.totalCount) * 10000) / 100
                    : 0;
            }

            // 숫자 컬럼 min/max/avg
            if (isNumericType(col.type)) {
                const numResult = await conn.executeQuery(
                    buildNumericStatsQuery(tableName, col.name, dbType), database
                );
                const numRow = numResult.rows[0] as Record<string, unknown>;
                if (numRow) {
                    const minVal = numRow.min_val ?? numRow.MIN_VAL;
                    const maxVal = numRow.max_val ?? numRow.MAX_VAL;
                    const avgVal = numRow.avg_val ?? numRow.AVG_VAL;
                    colStat.min = minVal !== null && minVal !== undefined ? Number(minVal) : undefined;
                    colStat.max = maxVal !== null && maxVal !== undefined ? Number(maxVal) : undefined;
                    colStat.avg = avgVal !== null && avgVal !== undefined
                        ? Math.round(Number(avgVal) * 100) / 100 : undefined;
                }
            } else {
                // 비숫자 컬럼 min/max (문자열)
                try {
                    const minMaxResult = await conn.executeQuery(
                        buildNumericStatsQuery(tableName, col.name, dbType), database
                    );
                    const mmRow = minMaxResult.rows[0] as Record<string, unknown>;
                    if (mmRow) {
                        const minVal = mmRow.min_val ?? mmRow.MIN_VAL;
                        const maxVal = mmRow.max_val ?? mmRow.MAX_VAL;
                        if (minVal !== null && minVal !== undefined) { colStat.min = String(minVal); }
                        if (maxVal !== null && maxVal !== undefined) { colStat.max = String(maxVal); }
                    }
                } catch { /* min/max 실패 무시 */ }
            }

            // 상위 빈출값
            try {
                const topResult = await conn.executeQuery(
                    buildTopValuesQuery(tableName, col.name, dbType, topN), database
                );
                colStat.topValues = topResult.rows.map(r => {
                    const v = r.val ?? r.VAL;
                    const c = r.cnt ?? r.CNT;
                    return {
                        value: v !== null && v !== undefined ? String(v) : 'NULL',
                        count: Number(c ?? 0),
                    };
                });
            } catch { /* 빈출값 실패 무시 */ }
        } catch {
            // 컬럼 통계 실패 시 기본값 유지
        }

        columns.push(colStat);
    }

    return {
        tableName,
        totalRows,
        columnCount: schema.length,
        columns,
        executionTime: Date.now() - startTime,
    };
}
