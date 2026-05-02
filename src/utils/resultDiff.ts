/**
 * 쿼리 결과 비교(Diff) 유틸리티
 *
 * v3.1.0 — 두 쿼리 결과를 비교하여 추가/삭제/변경된 행을 감지합니다.
 */

import type { QueryResult } from '../types/database';

/** 행 diff 상태 */
export type RowDiffStatus = 'added' | 'removed' | 'modified' | 'unchanged';

/** 셀 단위 비교 결과 */
export interface CellDiff {
    column: string;
    leftValue: unknown;
    rightValue: unknown;
    changed: boolean;
}

/** 행 단위 비교 결과 */
export interface RowDiff {
    status: RowDiffStatus;
    key: Record<string, unknown>;
    leftRow?: Record<string, unknown>;
    rightRow?: Record<string, unknown>;
    cells: CellDiff[];
    rowIndex: { left?: number; right?: number };
}

/** 전체 비교 결과 */
export interface DiffResult {
    summary: {
        totalLeft: number;
        totalRight: number;
        added: number;
        removed: number;
        modified: number;
        unchanged: number;
    };
    columns: string[];
    rows: RowDiff[];
    keyColumns: string[];
}

/** 행 키 생성 — 지정된 컬럼으로 키 문자열 생성 */
function buildRowKey(row: Record<string, unknown>, keyColumns: string[]): string {
    return keyColumns
        .map(col => {
            const val = row[col];
            if (val === null || val === undefined) { return `\0null:${col}`; }
            return String(val);
        })
        .join('\x01');
}

/** 값이 같은지 비교 (null, 숫자, 문자열 등) */
function valuesEqual(a: unknown, b: unknown): boolean {
    if (a === b) { return true; }
    if (a === null || a === null) { return a === b; }
    if (a === undefined || b === undefined) { return a === b; }

    // 숫자 비교 (문자열 "1" vs 숫자 1)
    if (typeof a === 'number' && typeof b === 'string') {
        return String(a) === b;
    }
    if (typeof b === 'number' && typeof a === 'string') {
        return String(b) === a;
    }

    // Date 비교
    if (a instanceof Date && b instanceof Date) {
        return a.getTime() === b.getTime();
    }

    return String(a) === String(b);
}

/** 두 컬럼 목록 병합 (순서 유지, 중복 제거) */
function mergeColumns(leftFields: string[], rightFields: string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const col of leftFields) {
        if (!seen.has(col)) {
            seen.add(col);
            result.push(col);
        }
    }
    for (const col of rightFields) {
        if (!seen.has(col)) {
            seen.add(col);
            result.push(col);
        }
    }
    return result;
}

/** 자동 키 컬럼 감지 시도 */
function detectKeyColumns(leftFields: string[], rightFields: string[]): string[] | undefined {
    // 공통 컬럼 중 id, _id, {table}_id 패턴이 있으면 자동 선택
    const commonCols = leftFields.filter(f => rightFields.includes(f));

    const idPatterns = ['id', '_id', 'Id', 'ID'];
    const idCol = commonCols.find(c => idPatterns.includes(c));
    if (idCol) { return [idCol]; }

    // *_id 패턴
    const fkIdCol = commonCols.find(c => c.endsWith('_id') || c.endsWith('Id'));
    if (fkIdCol) { return [fkIdCol]; }

    // code, key, name 등 고유값 가능성이 높은 컬럼
    const uniqueCols = commonCols.filter(c =>
        ['code', 'key', 'name', 'email', 'username', 'slug'].includes(c.toLowerCase())
    );
    if (uniqueCols.length > 0) { return [uniqueCols[0]]; }

    return undefined;
}

/**
 * 두 쿼리 결과를 비교하여 DiffResult를 반환합니다.
 *
 * @param left - 이전(왼쪽) 쿼리 결과
 * @param right - 이후(오른쪽) 쿼리 결과
 * @param keyColumns - 행 식별에 사용할 컬럼 (생략 시 자동 감지, 실패하면 전체 행 비교)
 */
export function computeDiff(
    left: QueryResult,
    right: QueryResult,
    keyColumns?: string[]
): DiffResult {
    const leftColNames = left.fields.map(f => f.name);
    const rightColNames = right.fields.map(f => f.name);
    const allColumns = mergeColumns(leftColNames, rightColNames);

    // 키 컬럼 결정
    let effectiveKeys = keyColumns;
    if (!effectiveKeys || effectiveKeys.length === 0) {
        effectiveKeys = detectKeyColumns(leftColNames, rightColNames);
    }
    if (!effectiveKeys || effectiveKeys.length === 0) {
        // 자동 감지 실패 → 공통 컬럼 전체를 키로 사용
        const commonCols = leftColNames.filter(c => rightColNames.includes(c));
        effectiveKeys = commonCols.length > 0 ? commonCols : allColumns;
    }

    // 행을 키 기반 Map으로 변환
    const leftMap = new Map<string, { row: Record<string, unknown>; index: number }>();
    const rightMap = new Map<string, { row: Record<string, unknown>; index: number }>();

    for (let i = 0; i < left.rows.length; i++) {
        const row = left.rows[i];
        const key = buildRowKey(row, effectiveKeys);
        leftMap.set(key, { row, index: i });
    }

    for (let i = 0; i < right.rows.length; i++) {
        const row = right.rows[i];
        const key = buildRowKey(row, effectiveKeys);
        rightMap.set(key, { row, index: i });
    }

    // Diff 계산
    const rows: RowDiff[] = [];
    let added = 0;
    let removed = 0;
    let modified = 0;
    let unchanged = 0;

    // 왼쪽에만 있는 행 → removed
    for (const [key, { row, index }] of leftMap) {
        if (!rightMap.has(key)) {
            const cells: CellDiff[] = allColumns.map(col => ({
                column: col,
                leftValue: row[col],
                rightValue: undefined,
                changed: true
            }));
            rows.push({
                status: 'removed',
                key: Object.fromEntries(effectiveKeys.map(k => [k, row[k]])),
                leftRow: row,
                cells,
                rowIndex: { left: index }
            });
            removed++;
        }
    }

    // 오른쪽에만 있는 행 → added
    for (const [key, { row, index }] of rightMap) {
        if (!leftMap.has(key)) {
            const cells: CellDiff[] = allColumns.map(col => ({
                column: col,
                leftValue: undefined,
                rightValue: row[col],
                changed: true
            }));
            rows.push({
                status: 'added',
                key: Object.fromEntries(effectiveKeys.map(k => [k, row[k]])),
                rightRow: row,
                cells,
                rowIndex: { right: index }
            });
            added++;
        }
    }

    // 양쪽에 있는 행 → modified 또는 unchanged
    for (const [key, leftEntry] of leftMap) {
        const rightEntry = rightMap.get(key);
        if (!rightEntry) { continue; }

        const leftRow = leftEntry.row;
        const rightRow = rightEntry.row;
        let hasChange = false;

        const cells: CellDiff[] = allColumns.map(col => {
            const lv = leftRow[col];
            const rv = rightRow[col];
            const changed = !valuesEqual(lv, rv);
            if (changed) { hasChange = true; }
            return { column: col, leftValue: lv, rightValue: rv, changed };
        });

        const status = hasChange ? 'modified' : 'unchanged';
        if (hasChange) { modified++; } else { unchanged++; }

        rows.push({
            status,
            key: Object.fromEntries(effectiveKeys.map(k => [k, leftRow[k]])),
            leftRow,
            rightRow,
            cells,
            rowIndex: { left: leftEntry.index, right: rightEntry.index }
        });
    }

    // 정렬: removed → modified → unchanged → added (가독성)
    const statusOrder: Record<RowDiffStatus, number> = {
        removed: 0,
        modified: 1,
        unchanged: 2,
        added: 3
    };
    rows.sort((a, b) => statusOrder[a.status] - statusOrder[b.status]);

    return {
        summary: {
            totalLeft: left.rows.length,
            totalRight: right.rows.length,
            added,
            removed,
            modified,
            unchanged
        },
        columns: allColumns,
        rows,
        keyColumns: effectiveKeys
    };
}

/** DiffResult를 마크다운 문자열로 변환 */
export function diffToMarkdown(diff: DiffResult, leftLabel: string, rightLabel: string): string {
    const lines: string[] = [];

    lines.push(`# Query Result Diff`);
    lines.push('');
    lines.push(`**Left**: ${leftLabel}`);
    lines.push(`**Right**: ${rightLabel}`);
    lines.push('');

    const s = diff.summary;
    lines.push(`## Summary`);
    lines.push('');
    lines.push(`| Metric | Count |`);
    lines.push(`|--------|-------|`);
    lines.push(`| Left rows | ${s.totalLeft} |`);
    lines.push(`| Right rows | ${s.totalRight} |`);
    lines.push(`| **Added** | ${s.added} |`);
    lines.push(`| **Removed** | ${s.removed} |`);
    lines.push(`| **Modified** | ${s.modified} |`);
    lines.push(`| Unchanged | ${s.unchanged} |`);
    lines.push('');

    if (diff.keyColumns.length > 0) {
        lines.push(`Key columns: \`${diff.keyColumns.join('`, `')}\``);
        lines.push('');
    }

    // 변경 내역이 있으면 테이블 출력
    const changedRows = diff.rows.filter(r => r.status !== 'unchanged');
    if (changedRows.length === 0) {
        lines.push('No differences found.');
        return lines.join('\n');
    }

    lines.push(`## Changes (${changedRows.length} rows)`);
    lines.push('');

    const statusLabel: Record<RowDiffStatus, string> = {
        added: '+',
        removed: '-',
        modified: '~',
        unchanged: ' '
    };

    // 헤더
    lines.push('| Status | ' + diff.columns.join(' | ') + ' |');
    lines.push('|--------|' + diff.columns.map(() => '-------').join('|') + '|');

    for (const row of changedRows) {
        const prefix = statusLabel[row.status];
        const values = diff.columns.map(col => {
            const cell = row.cells.find(c => c.column === col);
            if (!cell) { return ''; }
            const val = row.status === 'removed' ? cell.leftValue : cell.rightValue;
            if (val === null || val === undefined) { return 'NULL'; }
            const str = String(val);
            if (cell.changed && row.status === 'modified') {
                return `${cell.leftValue ?? 'NULL'} → ${cell.rightValue ?? 'NULL'}`;
            }
            return str;
        });
        lines.push(`| ${prefix} | ${values.join(' | ')} |`);
    }

    return lines.join('\n');
}

/** DiffResult를 JSON 문자열로 변환 */
export function diffToJson(diff: DiffResult): string {
    const output = {
        summary: diff.summary,
        keyColumns: diff.keyColumns,
        changes: diff.rows
            .filter(r => r.status !== 'unchanged')
            .map(r => ({
                status: r.status,
                key: r.key,
                changes: r.cells
                    .filter(c => c.changed)
                    .map(c => ({
                        column: c.column,
                        left: c.leftValue,
                        right: c.rightValue
                    }))
            }))
    };
    return JSON.stringify(output, null, 2);
}
