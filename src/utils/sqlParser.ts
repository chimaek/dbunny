/**
 * SQL Parser — v2.0.0 자동완성 고도화를 위한 SQL 구문 분석 유틸리티
 *
 * 기능:
 * - 테이블 참조 및 별칭(alias) 추출
 * - JOIN 절 파싱
 * - 서브쿼리 컨텍스트 인식
 * - 커서 위치 기반 컨텍스트 판별
 */

/** 테이블 참조 정보 */
export interface TableReference {
    /** 실제 테이블 이름 */
    table: string;
    /** 별칭 (없으면 undefined) */
    alias?: string;
    /** 스키마 이름 (없으면 undefined) */
    schema?: string;
}

/** JOIN 절 정보 */
export interface JoinClause {
    type: 'JOIN' | 'INNER JOIN' | 'LEFT JOIN' | 'RIGHT JOIN' | 'FULL JOIN' | 'CROSS JOIN';
    table: TableReference;
    /** ON 절이 작성 완료되었는지 */
    hasOnClause: boolean;
}

/** 서브쿼리 정보 */
export interface SubqueryInfo {
    /** 서브쿼리 시작 위치 (괄호 포함) */
    start: number;
    /** 서브쿼리 끝 위치 (괄호 포함, 아직 닫히지 않았으면 -1) */
    end: number;
    /** 서브쿼리 내부의 테이블 참조 */
    tables: TableReference[];
    /** 서브쿼리 별칭 */
    alias?: string;
}

/** 커서 위치의 SQL 컨텍스트 */
export type CursorContext =
    | { type: 'SELECT_COLUMNS' }
    | { type: 'FROM_TABLE' }
    | { type: 'JOIN_TABLE' }
    | { type: 'JOIN_ON'; joinTable: TableReference }
    | { type: 'WHERE' }
    | { type: 'ALIAS_DOT'; alias: string }
    | { type: 'GROUP_BY' }
    | { type: 'ORDER_BY' }
    | { type: 'INSERT_INTO' }
    | { type: 'UPDATE_TABLE' }
    | { type: 'SET_CLAUSE' }
    | { type: 'UNKNOWN' };

/** SQL 파싱 결과 */
export interface SQLParseResult {
    /** FROM 절의 테이블 참조들 */
    tables: TableReference[];
    /** JOIN 절들 */
    joins: JoinClause[];
    /** 서브쿼리들 */
    subqueries: SubqueryInfo[];
    /** 커서 위치의 컨텍스트 */
    cursorContext: CursorContext;
    /** 별칭 → 테이블 이름 매핑 */
    aliasMap: Map<string, string>;
}

/**
 * 문자열 리터럴을 공백으로 치환하여 파싱을 안전하게 함
 */
function stripStrings(sql: string): string {
    return sql.replace(/'(?:[^'\\]|\\.)*'/g, m => ' '.repeat(m.length))
              .replace(/"(?:[^"\\]|\\.)*"/g, m => ' '.repeat(m.length));
}

/**
 * 괄호의 깊이를 추적하며, 커서 위치가 속한 가장 안쪽 괄호 범위를 반환
 */
function findParenthesisContext(sql: string, cursorPos: number): { innerSql: string; offset: number } | null {
    const stripped = stripStrings(sql);
    const stack: number[] = [];
    let innerStart = -1;

    for (let i = 0; i < stripped.length; i++) {
        if (stripped[i] === '(') {
            stack.push(i);
        } else if (stripped[i] === ')') {
            if (stack.length > 0) {
                const start = stack.pop()!;
                if (start < cursorPos && i >= cursorPos) {
                    // 이 괄호 쌍에 커서가 포함됨
                    if (innerStart === -1 || start > innerStart) {
                        innerStart = start;
                    }
                }
            }
        }
    }

    // 닫히지 않은 괄호 중 커서 앞에 있는 가장 안쪽 것
    if (innerStart === -1 && stack.length > 0) {
        for (let i = stack.length - 1; i >= 0; i--) {
            if (stack[i] < cursorPos) {
                innerStart = stack[i];
                break;
            }
        }
    }

    if (innerStart === -1) {
        return null;
    }

    const innerSql = sql.substring(innerStart + 1, cursorPos);
    return { innerSql, offset: innerStart + 1 };
}

/**
 * 전체 쿼리 텍스트에서 커서 위치까지의 SQL을 분석
 */
export function parseSQL(fullText: string, cursorPos: number): SQLParseResult {
    const result: SQLParseResult = {
        tables: [],
        joins: [],
        subqueries: [],
        cursorContext: { type: 'UNKNOWN' },
        aliasMap: new Map(),
    };

    const textToCursor = fullText.substring(0, cursorPos);

    // 서브쿼리 안에 있는지 확인
    const parenCtx = findParenthesisContext(fullText, cursorPos);

    // 커서 컨텍스트 판별에는 커서까지의 텍스트 사용
    const effectiveTextForContext = parenCtx
        ? parenCtx.innerSql
        : textToCursor;

    // 테이블/별칭 추출에는 전체 텍스트 사용 (커서 뒤에 FROM/JOIN이 있을 수 있음)
    const effectiveTextForTables = parenCtx
        ? fullText.substring(parenCtx.offset)
        : fullText;

    const strippedContext = stripStrings(effectiveTextForContext);
    const strippedTables = stripStrings(effectiveTextForTables);

    // 1. 커서 직전의 "alias." 패턴 감지
    const dotContext = detectAliasDot(textToCursor);
    if (dotContext) {
        result.cursorContext = { type: 'ALIAS_DOT', alias: dotContext };
    }

    // 2. 테이블 참조 추출 (전체 텍스트에서)
    result.tables = extractTableReferences(strippedTables);
    result.joins = extractJoinClauses(strippedTables);

    // JOIN 테이블도 전체 테이블 목록에 추가
    for (const join of result.joins) {
        if (!result.tables.some(t => t.table === join.table.table && t.alias === join.table.alias)) {
            result.tables.push(join.table);
        }
    }

    // 3. 별칭 맵 구축
    for (const ref of result.tables) {
        if (ref.alias) {
            result.aliasMap.set(ref.alias.toLowerCase(), ref.table);
        }
        // 테이블 이름 자체도 맵에 넣어서 "users.id" 같은 패턴도 지원
        result.aliasMap.set(ref.table.toLowerCase(), ref.table);
    }

    // 4. 커서 컨텍스트 결정 (alias. 이 아닌 경우)
    if (result.cursorContext.type === 'UNKNOWN') {
        result.cursorContext = determineCursorContext(strippedContext, result.joins);
    }

    return result;
}

/**
 * "alias." 패턴 감지 — 커서 직전에 "identifier." 이 있으면 그 identifier를 반환
 */
function detectAliasDot(textToCursor: string): string | null {
    const match = textToCursor.match(/(\w+)\.\s*$/);
    return match ? match[1] : null;
}

/**
 * FROM 절에서 테이블 참조 추출
 * 패턴: FROM table [alias], FROM schema.table [alias]
 */
export function extractTableReferences(sql: string): TableReference[] {
    const refs: TableReference[] = [];
    const upper = sql.toUpperCase();

    // FROM 절 추출
    const fromPattern = /\bFROM\s+/gi;
    let fromMatch: RegExpExecArray | null;

    while ((fromMatch = fromPattern.exec(upper)) !== null) {
        const afterFrom = sql.substring(fromMatch.index + fromMatch[0].length);
        const tableRefs = parseTableList(afterFrom);
        refs.push(...tableRefs);
    }

    // UPDATE 절 추출
    const updatePattern = /\bUPDATE\s+/gi;
    let updateMatch: RegExpExecArray | null;

    while ((updateMatch = updatePattern.exec(upper)) !== null) {
        const afterUpdate = sql.substring(updateMatch.index + updateMatch[0].length);
        const ref = parseSingleTableRef(afterUpdate);
        if (ref) {
            refs.push(ref);
        }
    }

    // INSERT INTO 절 추출
    const insertPattern = /\bINSERT\s+INTO\s+/gi;
    let insertMatch: RegExpExecArray | null;

    while ((insertMatch = insertPattern.exec(upper)) !== null) {
        const afterInsert = sql.substring(insertMatch.index + insertMatch[0].length);
        const ref = parseSingleTableRef(afterInsert);
        if (ref) {
            refs.push(ref);
        }
    }

    return deduplicateRefs(refs);
}

/**
 * 콤마로 구분된 테이블 목록 파싱
 * 예: "users u, posts p" → [{table:'users', alias:'u'}, {table:'posts', alias:'p'}]
 */
function parseTableList(afterKeyword: string): TableReference[] {
    const refs: TableReference[] = [];
    // SQL 키워드가 나오면 중단
    const endPattern = /\b(WHERE|JOIN|INNER|LEFT|RIGHT|FULL|CROSS|ON|ORDER|GROUP|HAVING|LIMIT|UNION|SET|VALUES|INTO)\b/i;
    const endMatch = endPattern.exec(afterKeyword);
    const tableSection = endMatch ? afterKeyword.substring(0, endMatch.index) : afterKeyword;

    const parts = tableSection.split(',');
    for (const part of parts) {
        const ref = parseSingleTableRef(part.trim());
        if (ref) {
            refs.push(ref);
        }
    }
    return refs;
}

/**
 * 단일 테이블 참조 파싱
 * 패턴: [schema.]table [AS] alias
 */
function parseSingleTableRef(text: string): TableReference | null {
    const trimmed = text.trim();
    if (!trimmed) {return null;}

    // (subquery) alias 패턴은 건너뜀
    if (trimmed.startsWith('(')) {return null;}

    // schema.table AS alias / schema.table alias / table AS alias / table alias / table
    const match = trimmed.match(/^(\w+)(?:\.(\w+))?\s*(?:\bAS\b\s+)?(\w+)?/i);
    if (!match) {return null;}

    const [, first, second, aliasOrNext] = match;

    // 키워드인지 확인
    if (isReservedKeyword(first)) {return null;}

    let table: string;
    let schema: string | undefined;
    let alias: string | undefined;

    if (second) {
        // schema.table 형태
        schema = first;
        table = second;
    } else {
        table = first;
    }

    if (aliasOrNext && !isReservedKeyword(aliasOrNext)) {
        alias = aliasOrNext;
    }

    return { table, alias, schema };
}

/**
 * JOIN 절 추출
 */
export function extractJoinClauses(sql: string): JoinClause[] {
    const joins: JoinClause[] = [];
    const joinPattern = /\b((?:INNER|LEFT|RIGHT|FULL|CROSS)\s+)?JOIN\s+/gi;
    let match: RegExpExecArray | null;

    while ((match = joinPattern.exec(sql)) !== null) {
        const joinType = (match[1] ? match[1].trim() + ' JOIN' : 'JOIN').toUpperCase() as JoinClause['type'];
        const afterJoin = sql.substring(match.index + match[0].length);

        const tableRef = parseSingleTableRef(afterJoin);
        if (!tableRef) {continue;}

        // ON 절이 있는지 확인
        const onPattern = /\bON\b/i;
        const onMatch = onPattern.exec(afterJoin);
        const hasOnClause = !!onMatch;

        joins.push({
            type: joinType,
            table: tableRef,
            hasOnClause,
        });
    }

    return joins;
}

/**
 * 커서 위치의 SQL 컨텍스트 결정
 */
function determineCursorContext(sql: string, joins: JoinClause[]): CursorContext {
    const upper = sql.toUpperCase().trimEnd();

    // 마지막 주요 키워드 찾기
    const keywords = [
        { pattern: /\bSELECT\b/g, type: 'SELECT' as const },
        { pattern: /\bFROM\b/g, type: 'FROM' as const },
        { pattern: /\b(?:(?:INNER|LEFT|RIGHT|FULL|CROSS)\s+)?JOIN\b/g, type: 'JOIN' as const },
        { pattern: /\bON\b/g, type: 'ON' as const },
        { pattern: /\bWHERE\b/g, type: 'WHERE' as const },
        { pattern: /\bGROUP\s+BY\b/g, type: 'GROUP_BY' as const },
        { pattern: /\bORDER\s+BY\b/g, type: 'ORDER_BY' as const },
        { pattern: /\bUPDATE\b/g, type: 'UPDATE' as const },
        { pattern: /\bSET\b/g, type: 'SET' as const },
        { pattern: /\bINSERT\s+INTO\b/g, type: 'INSERT_INTO' as const },
    ];

    let lastKeyword = { type: 'UNKNOWN' as string, index: -1 };

    for (const kw of keywords) {
        let m: RegExpExecArray | null;
        while ((m = kw.pattern.exec(upper)) !== null) {
            if (m.index > lastKeyword.index) {
                lastKeyword = { type: kw.type, index: m.index };
            }
        }
    }

    // SELECT 다음에 FROM이 아직 없는 경우
    if (lastKeyword.type === 'SELECT') {
        const afterSelect = upper.substring(lastKeyword.index + 6);
        if (!afterSelect.includes('FROM')) {
            return { type: 'SELECT_COLUMNS' };
        }
    }

    switch (lastKeyword.type) {
        case 'FROM': {
            // FROM 다음에 테이블 이름 입력 중
            const afterFrom = upper.substring(lastKeyword.index + 4);
            if (!afterFrom.match(/\b(WHERE|JOIN|ORDER|GROUP|HAVING|LIMIT|UNION)\b/)) {
                return { type: 'FROM_TABLE' };
            }
            break;
        }
        case 'JOIN': {
            // JOIN 다음에 ON이 아직 없으면 테이블 입력 중
            const afterJoin = upper.substring(lastKeyword.index);
            if (!afterJoin.includes(' ON ')) {
                return { type: 'JOIN_TABLE' };
            }
            // ON 절 작성 중인 JOIN 찾기
            const lastJoin = joins[joins.length - 1];
            if (lastJoin) {
                return { type: 'JOIN_ON', joinTable: lastJoin.table };
            }
            break;
        }
        case 'ON': {
            const lastJoin = joins[joins.length - 1];
            if (lastJoin) {
                return { type: 'JOIN_ON', joinTable: lastJoin.table };
            }
            break;
        }
        case 'WHERE':
            return { type: 'WHERE' };
        case 'GROUP_BY':
            return { type: 'GROUP_BY' };
        case 'ORDER_BY':
            return { type: 'ORDER_BY' };
        case 'UPDATE': {
            const afterUpdate = upper.substring(lastKeyword.index + 6);
            if (!afterUpdate.includes('SET')) {
                return { type: 'UPDATE_TABLE' };
            }
            break;
        }
        case 'SET':
            return { type: 'SET_CLAUSE' };
        case 'INSERT_INTO':
            return { type: 'INSERT_INTO' };
    }

    return { type: 'UNKNOWN' };
}

/**
 * 중복 테이블 참조 제거
 */
function deduplicateRefs(refs: TableReference[]): TableReference[] {
    const seen = new Set<string>();
    const result: TableReference[] = [];
    for (const ref of refs) {
        const key = `${ref.schema || ''}.${ref.table}.${ref.alias || ''}`.toLowerCase();
        if (!seen.has(key)) {
            seen.add(key);
            result.push(ref);
        }
    }
    return result;
}

const RESERVED_KEYWORDS = new Set([
    'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'LIKE', 'BETWEEN',
    'IS', 'NULL', 'AS', 'DISTINCT', 'ALL', 'TOP', 'LIMIT', 'OFFSET',
    'ORDER', 'BY', 'ASC', 'DESC', 'GROUP', 'HAVING', 'UNION', 'INTERSECT', 'EXCEPT',
    'JOIN', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'CROSS', 'NATURAL',
    'ON', 'USING', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE',
    'CREATE', 'ALTER', 'DROP', 'TRUNCATE', 'TABLE', 'DATABASE', 'INDEX', 'VIEW',
    'PRIMARY', 'FOREIGN', 'KEY', 'REFERENCES', 'UNIQUE', 'CHECK', 'DEFAULT',
    'INSERT', 'EXISTS', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
    'BEGIN', 'COMMIT', 'ROLLBACK', 'TRANSACTION',
]);

function isReservedKeyword(word: string): boolean {
    return RESERVED_KEYWORDS.has(word.toUpperCase());
}
