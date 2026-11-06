import { QueryExecutionOptions, QueryResult } from '../types/database';
import { isWriteQuery, stripStringsAndComments } from './readOnlyGuard';

/** 단일 조회 SQL만 DB에서 반환할 행 수를 제한한다. 쓰기 SQL은 변경하지 않는다. */
export function limitSelectQuery(query: string, options?: QueryExecutionOptions, dbType = 'sql'): string {
    if (!options) { return query; }
    const masked = stripStringsAndComments(query, dbType);
    const cleaned = masked.trim().replace(/;\s*$/, '');
    if (!/^(SELECT|WITH)\b/i.test(cleaned) || cleaned.includes(';') || isWriteQuery(query, dbType).isWrite || /\bFOR\s+(UPDATE|SHARE)\b/i.test(cleaned)) {
        return query;
    }
    const end = masked.trimEnd().length;
    const sql = masked.trimEnd().endsWith(';') ? query.slice(0, end - 1) + query.slice(end) : query;
    return `SELECT * FROM (${sql}\n) AS dbunny_result_limit LIMIT ${options.maxRows + 1}`;
}

export function limitResult(result: QueryResult, options?: QueryExecutionOptions): QueryResult {
    if (!options || result.rows.length <= options.maxRows) { return result; }
    return { ...result, rows: result.rows.slice(0, options.maxRows), rowCount: options.maxRows, truncated: true };
}
