/**
 * SQL 파서 심화 유닛 테스트
 *
 * 기본 테스트(sqlParser.test.ts)에서 다루지 않는 복잡한 SQL 패턴을 테스트합니다.
 *
 * 테스트 영역:
 * 1. 복잡한 서브쿼리 (다중 중첩, 상관 서브쿼리)
 * 2. CTE (WITH 절) 패턴
 * 3. 복합 JOIN (3+ 테이블, self-join)
 * 4. 스키마 한정 테이블명 (schema.table)
 * 5. 문자열 리터럴 내 키워드 무시
 * 6. 복잡한 별칭 패턴 (AS, 콤마 분리)
 * 7. INSERT/UPDATE/DELETE 컨텍스트
 * 8. 엣지 케이스 (빈 쿼리, 불완전 쿼리, 극단적 위치)
 *
 * 실행법: npx tsx src/test/unit/sqlParserAdvanced.standalone.ts
 */

import {
    parseSQL,
    extractTableReferences,
    extractJoinClauses,
} from '../../utils/sqlParser';

// ── Helpers ──────────────────────────────────────────────────

let totalPass = 0;
let totalFail = 0;

function pass(msg: string) {
    totalPass++;
    console.log(`  ✅ ${msg}`);
}

function fail(msg: string, detail?: string) {
    totalFail++;
    console.log(`  ❌ ${msg}${detail ? ' — ' + detail : ''}`);
}

function assert(condition: boolean, msg: string, detail?: string) {
    if (condition) { pass(msg); } else { fail(msg, detail); }
}

function section(title: string) {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  ${title}`);
    console.log(`${'═'.repeat(60)}`);
}

// ══════════════════════════════════════════════════════════════
//  1. 복잡한 서브쿼리
// ══════════════════════════════════════════════════════════════

function testComplexSubqueries() {
    section('복잡한 서브쿼리');

    // WHERE IN 서브쿼리
    const sql1 = 'SELECT * FROM users WHERE id IN (SELECT user_id FROM orders WHERE total > 100)';
    const r1 = parseSQL(sql1, sql1.indexOf('total'));
    assert(r1.cursorContext.type === 'WHERE', 'IN 서브쿼리 — WHERE 컨텍스트');

    // FROM 서브쿼리 (파생 테이블)
    const sql2 = 'SELECT t.name FROM (SELECT name, COUNT(*) as cnt FROM users GROUP BY name) t WHERE t.';
    const r2 = parseSQL(sql2, sql2.length);
    assert(r2.cursorContext.type === 'ALIAS_DOT', 'FROM 서브쿼리 — ALIAS_DOT');
    assert(r2.cursorContext.type === 'ALIAS_DOT' && r2.cursorContext.alias === 't',
        'FROM 서브쿼리 — alias = t');

    // EXISTS 서브쿼리 — 커서가 외부 WHERE에 있을 때
    const sql3 = 'SELECT u.name FROM users u WHERE EXISTS (SELECT 1 FROM orders o WHERE o.user_id = u.id) AND u.';
    const r3 = parseSQL(sql3, sql3.length);
    assert(r3.cursorContext.type === 'ALIAS_DOT', 'EXISTS 서브쿼리 + ALIAS_DOT');
    assert(r3.cursorContext.type === 'ALIAS_DOT' && r3.cursorContext.alias === 'u',
        'EXISTS — alias = u');

    // 다중 중첩 서브쿼리 커서 위치
    const sql4 = 'SELECT * FROM (SELECT * FROM (SELECT id FROM users) inner_t) outer_t WHERE outer_t.';
    const r4 = parseSQL(sql4, sql4.length);
    assert(r4.cursorContext.type === 'ALIAS_DOT', '2중 중첩 서브쿼리 — ALIAS_DOT');

    // 서브쿼리 내부의 FROM 컨텍스트
    const sql5 = 'SELECT * FROM users WHERE id IN (SELECT user_id FROM ';
    const r5 = parseSQL(sql5, sql5.length);
    assert(r5.cursorContext.type === 'FROM_TABLE', '서브쿼리 내부 FROM_TABLE');
}

// ══════════════════════════════════════════════════════════════
//  2. CTE (WITH 절) 패턴
// ══════════════════════════════════════════════════════════════

function testCTEPatterns() {
    section('CTE (WITH 절) 패턴');

    // 단일 CTE
    const sql1 = `
        WITH active_users AS (
            SELECT id, name FROM users WHERE active = true
        )
        SELECT au.name FROM active_users au WHERE au.`;
    const r1 = parseSQL(sql1, sql1.length);
    assert(r1.cursorContext.type === 'ALIAS_DOT', 'CTE — ALIAS_DOT');
    assert(r1.cursorContext.type === 'ALIAS_DOT' && r1.cursorContext.alias === 'au',
        'CTE — alias = au');

    // CTE에서 테이블 추출
    const refs1 = extractTableReferences(sql1);
    const tableNames1 = refs1.map(r => r.table);
    assert(tableNames1.includes('users'), 'CTE — users 테이블 추출');
    assert(tableNames1.includes('active_users'), 'CTE — active_users 참조');

    // 다중 CTE
    const sql2 = `
        WITH
            dept_totals AS (SELECT dept, SUM(salary) as total FROM employees GROUP BY dept),
            top_depts AS (SELECT dept FROM dept_totals WHERE total > 100000)
        SELECT e.name FROM employees e JOIN top_depts td ON e.dept = td.dept WHERE e.`;
    const r2 = parseSQL(sql2, sql2.length);
    assert(r2.cursorContext.type === 'ALIAS_DOT', '다중 CTE — ALIAS_DOT');

    const refs2 = extractTableReferences(sql2);
    const tableNames2 = refs2.map(r => r.table);
    assert(tableNames2.includes('employees'), '다중 CTE — employees 추출');
}

// ══════════════════════════════════════════════════════════════
//  3. 복합 JOIN
// ══════════════════════════════════════════════════════════════

function testComplexJoins() {
    section('복합 JOIN');

    // 3테이블 JOIN
    const sql1 = `
        SELECT u.name, p.title, c.content
        FROM users u
        INNER JOIN posts p ON u.id = p.user_id
        LEFT JOIN comments c ON p.id = c.post_id
        WHERE u.`;
    const r1 = parseSQL(sql1, sql1.length);
    assert(r1.tables.length >= 3, `3테이블 JOIN — ${r1.tables.length}개 테이블`);
    assert(r1.joins.length === 2, `3테이블 JOIN — 2개 JOIN`);
    assert(r1.cursorContext.type === 'ALIAS_DOT', '3테이블 JOIN — ALIAS_DOT');

    // JOIN 타입 확인
    const joinTypes = r1.joins.map(j => j.type);
    assert(joinTypes.includes('INNER JOIN'), 'INNER JOIN 타입 추출');
    assert(joinTypes.includes('LEFT JOIN'), 'LEFT JOIN 타입 추출');

    // Self-join
    const sql2 = `
        SELECT e.name as employee, m.name as manager
        FROM employees e
        LEFT JOIN employees m ON e.manager_id = m.id
        WHERE e.`;
    const r2 = parseSQL(sql2, sql2.length);
    assert(r2.cursorContext.type === 'ALIAS_DOT' && r2.cursorContext.alias === 'e',
        'Self-join — alias = e');
    assert(r2.aliasMap.get('e') === 'employees', 'Self-join — e → employees');
    assert(r2.aliasMap.get('m') === 'employees', 'Self-join — m → employees');

    // CROSS JOIN
    const sql3 = 'SELECT * FROM colors CROSS JOIN sizes WHERE ';
    const r3 = parseSQL(sql3, sql3.length);
    assert(r3.cursorContext.type === 'WHERE', 'CROSS JOIN — WHERE 컨텍스트');

    // JOIN ON 컨텍스트 — ON 절 작성 중
    const sql4 = 'SELECT * FROM users u JOIN posts p ON ';
    const r4 = parseSQL(sql4, sql4.length);
    assert(r4.cursorContext.type === 'JOIN_ON', 'JOIN ON 컨텍스트');
    if (r4.cursorContext.type === 'JOIN_ON') {
        assert(r4.cursorContext.joinTable.table === 'posts', 'JOIN ON — joinTable = posts');
    }

    // 4테이블 JOIN 체인
    const sql5 = `
        SELECT *
        FROM a
        JOIN b ON a.id = b.a_id
        JOIN c ON b.id = c.b_id
        JOIN d ON c.id = d.c_id
        WHERE d.`;
    const r5 = parseSQL(sql5, sql5.length);
    assert(r5.tables.length >= 4, `4테이블 JOIN — ${r5.tables.length}개 테이블`);
    assert(r5.joins.length === 3, `4테이블 JOIN — 3개 JOIN`);
}

// ══════════════════════════════════════════════════════════════
//  4. 스키마 한정 테이블명
// ══════════════════════════════════════════════════════════════

function testSchemaQualifiedTables() {
    section('스키마 한정 테이블명');

    // schema.table
    const sql1 = 'SELECT * FROM public.users u WHERE u.';
    const r1 = parseSQL(sql1, sql1.length);
    assert(r1.tables.length >= 1, 'schema.table — 테이블 추출');
    const schemaTable = r1.tables.find(t => t.table === 'users' && t.schema === 'public');
    assert(schemaTable !== undefined, 'schema.table — schema=public, table=users');
    assert(schemaTable?.alias === 'u', 'schema.table — alias=u');

    // 다중 스키마 테이블 — FROM은 extractTableReferences, JOIN은 extractJoinClauses
    const sql2 = 'SELECT a.*, b.* FROM schema1.table1 a JOIN schema2.table2 b ON a.id = b.ref_id';
    const refs = extractTableReferences(sql2);
    const s1 = refs.find(r => r.schema === 'schema1');
    assert(s1?.table === 'table1', 'schema1.table1 추출 (FROM)');
    assert(s1?.alias === 'a', 'schema1.table1 alias=a');

    // JOIN 테이블은 parseSQL을 통해 전체 테이블 목록에 포함됨
    const r2full = parseSQL(sql2, sql2.length);
    const joinTable = r2full.tables.find(t => t.table === 'table2');
    assert(joinTable !== undefined, 'schema2.table2 추출 (JOIN via parseSQL)');
    assert(joinTable?.alias === 'b', 'schema2.table2 alias=b');

    // aliasMap에 스키마 테이블도 포함
    const r2 = parseSQL(sql1, sql1.length);
    assert(r2.aliasMap.get('u') === 'users', 'aliasMap — u → users');
}

// ══════════════════════════════════════════════════════════════
//  5. 문자열 리터럴 내 키워드 무시
// ══════════════════════════════════════════════════════════════

function testStringLiteralIgnoring() {
    section('문자열 리터럴 내 키워드 무시');

    // 'FROM' 이 문자열 안에 있는 경우
    const sql1 = "SELECT * FROM users WHERE name = 'FROM the start' AND ";
    const r1 = parseSQL(sql1, sql1.length);
    assert(r1.tables.length === 1, `문자열 내 FROM 무시 — ${r1.tables.length}개 테이블`);
    assert(r1.tables[0]?.table === 'users', '문자열 내 FROM — users만 추출');

    // 'JOIN' 이 문자열 안에 있는 경우
    const sql2 = "SELECT * FROM logs WHERE message LIKE '%JOIN operation failed%' AND ";
    const r2 = parseSQL(sql2, sql2.length);
    assert(r2.joins.length === 0, '문자열 내 JOIN 무시 — 0개 JOIN');

    // 큰따옴표 문자열
    const sql3 = 'SELECT * FROM users WHERE description = "SELECT FROM WHERE" AND ';
    const r3 = parseSQL(sql3, sql3.length);
    assert(r3.tables.length === 1, '큰따옴표 내 키워드 무시');

    // 이스케이프된 따옴표
    const sql4 = "SELECT * FROM items WHERE name = 'it\\'s a table' AND ";
    const r4 = parseSQL(sql4, sql4.length);
    const tableNames4 = r4.tables.map(t => t.table);
    assert(tableNames4.includes('items'), '이스케이프 따옴표 — items 추출');
}

// ══════════════════════════════════════════════════════════════
//  6. 복잡한 별칭 패턴
// ══════════════════════════════════════════════════════════════

function testComplexAliasPatterns() {
    section('복잡한 별칭 패턴');

    // AS 키워드 사용
    const sql1 = 'SELECT * FROM users AS u WHERE u.';
    const r1 = parseSQL(sql1, sql1.length);
    assert(r1.aliasMap.get('u') === 'users', 'AS 키워드 — u → users');

    // 콤마 분리 다중 테이블 + 별칭
    const sql2 = 'SELECT u.name, p.title FROM users u, posts p WHERE u.';
    const r2 = parseSQL(sql2, sql2.length);
    assert(r2.aliasMap.get('u') === 'users', '콤마 분리 — u → users');
    assert(r2.aliasMap.get('p') === 'posts', '콤마 분리 — p → posts');
    assert(r2.tables.length >= 2, `콤마 분리 — ${r2.tables.length}개 테이블`);

    // 별칭 없는 테이블 (테이블명 자체를 키로 사용)
    const sql3 = 'SELECT users.name FROM users WHERE users.';
    const r3 = parseSQL(sql3, sql3.length);
    assert(r3.aliasMap.get('users') === 'users', '별칭 없음 — users → users');
    assert(r3.cursorContext.type === 'ALIAS_DOT', '별칭 없음 — ALIAS_DOT');
    if (r3.cursorContext.type === 'ALIAS_DOT') {
        assert(r3.cursorContext.alias === 'users', '별칭 없음 — alias = users');
    }

    // 별칭이 SQL 키워드와 유사 (하지만 키워드 아닌 것)
    const sql4 = 'SELECT * FROM data d WHERE d.';
    const r4 = parseSQL(sql4, sql4.length);
    assert(r4.aliasMap.get('d') === 'data', '단일문자 별칭 — d → data');
}

// ══════════════════════════════════════════════════════════════
//  7. INSERT / UPDATE / DELETE 컨텍스트
// ══════════════════════════════════════════════════════════════

function testDMLContext() {
    section('INSERT / UPDATE / DELETE 컨텍스트');

    // INSERT INTO 컨텍스트
    const sql1 = 'INSERT INTO ';
    const r1 = parseSQL(sql1, sql1.length);
    assert(r1.cursorContext.type === 'INSERT_INTO', 'INSERT INTO 컨텍스트');

    // UPDATE 컨텍스트
    const sql2 = 'UPDATE ';
    const r2 = parseSQL(sql2, sql2.length);
    assert(r2.cursorContext.type === 'UPDATE_TABLE', 'UPDATE 컨텍스트');

    // SET 컨텍스트
    const sql3 = 'UPDATE users SET ';
    const r3 = parseSQL(sql3, sql3.length);
    assert(r3.cursorContext.type === 'SET_CLAUSE', 'SET 컨텍스트');

    // UPDATE 테이블 추출
    const refs3 = extractTableReferences(sql3);
    assert(refs3.some(r => r.table === 'users'), 'UPDATE — users 테이블 추출');

    // INSERT INTO 테이블 추출
    const sql4 = 'INSERT INTO orders (user_id, amount) VALUES (1, 100)';
    const refs4 = extractTableReferences(sql4);
    assert(refs4.some(r => r.table === 'orders'), 'INSERT INTO — orders 추출');

    // DELETE FROM — FROM 키워드 재활용
    const sql5 = 'DELETE FROM users WHERE ';
    const r5 = parseSQL(sql5, sql5.length);
    assert(r5.cursorContext.type === 'WHERE', 'DELETE FROM — WHERE 컨텍스트');
    const refs5 = extractTableReferences(sql5);
    assert(refs5.some(r => r.table === 'users'), 'DELETE FROM — users 추출');
}

// ══════════════════════════════════════════════════════════════
//  8. GROUP BY / ORDER BY 컨텍스트
// ══════════════════════════════════════════════════════════════

function testGroupByOrderBy() {
    section('GROUP BY / ORDER BY 컨텍스트');

    // GROUP BY 컨텍스트
    const sql1 = 'SELECT dept, COUNT(*) FROM employees GROUP BY ';
    const r1 = parseSQL(sql1, sql1.length);
    assert(r1.cursorContext.type === 'GROUP_BY', 'GROUP BY 컨텍스트');

    // ORDER BY 컨텍스트
    const sql2 = 'SELECT * FROM users ORDER BY ';
    const r2 = parseSQL(sql2, sql2.length);
    assert(r2.cursorContext.type === 'ORDER_BY', 'ORDER BY 컨텍스트');

    // GROUP BY 후 HAVING + alias
    const sql3 = 'SELECT dept, COUNT(*) as cnt FROM employees GROUP BY dept HAVING cnt > 5 ORDER BY ';
    const r3 = parseSQL(sql3, sql3.length);
    assert(r3.cursorContext.type === 'ORDER_BY', 'HAVING 후 ORDER BY');

    // ORDER BY + alias.
    const sql4 = 'SELECT u.name, COUNT(p.id) as post_count FROM users u JOIN posts p ON u.id = p.user_id GROUP BY u.name ORDER BY u.';
    const r4 = parseSQL(sql4, sql4.length);
    assert(r4.cursorContext.type === 'ALIAS_DOT', 'ORDER BY + ALIAS_DOT');
    if (r4.cursorContext.type === 'ALIAS_DOT') {
        assert(r4.cursorContext.alias === 'u', 'ORDER BY — alias = u');
    }
}

// ══════════════════════════════════════════════════════════════
//  9. 엣지 케이스
// ══════════════════════════════════════════════════════════════

function testEdgeCases() {
    section('엣지 케이스');

    // 빈 쿼리
    const r1 = parseSQL('', 0);
    assert(r1.cursorContext.type === 'UNKNOWN', '빈 쿼리 — UNKNOWN');
    assert(r1.tables.length === 0, '빈 쿼리 — 0개 테이블');

    // SELECT만 입력
    const r2 = parseSQL('SELECT ', 7);
    assert(r2.cursorContext.type === 'SELECT_COLUMNS', 'SELECT만 — SELECT_COLUMNS');

    // 커서 위치 0
    const r3 = parseSQL('SELECT * FROM users', 0);
    assert(r3.cursorContext.type === 'UNKNOWN', '커서 0 — UNKNOWN');

    // 커서가 쿼리 끝을 넘는 경우
    const sql4 = 'SELECT * FROM users';
    const r4 = parseSQL(sql4, sql4.length + 100);
    // 에러 없이 처리되는지
    assert(r4.tables.length >= 1, '커서 오버플로 — 에러 없이 처리');

    // 줄바꿈 포함 쿼리
    const sql5 = 'SELECT\n  *\nFROM\n  users u\nWHERE\n  u.';
    const r5 = parseSQL(sql5, sql5.length);
    assert(r5.cursorContext.type === 'ALIAS_DOT', '줄바꿈 포함 — ALIAS_DOT');
    assert(r5.aliasMap.get('u') === 'users', '줄바꿈 — u → users');

    // 탭 포함 쿼리
    const sql6 = 'SELECT\t*\tFROM\tusers\tu\tWHERE\tu.';
    const r6 = parseSQL(sql6, sql6.length);
    assert(r6.cursorContext.type === 'ALIAS_DOT', '탭 포함 — ALIAS_DOT');

    // 대소문자 혼합
    const sql7 = 'sElEcT * fRoM Users u wHeRe u.';
    const r7 = parseSQL(sql7, sql7.length);
    assert(r7.cursorContext.type === 'ALIAS_DOT', '대소문자 혼합 — ALIAS_DOT');
    assert(r7.aliasMap.get('u') === 'Users', '대소문자 — u → Users (원본 보존)');

    // 세미콜론이 있는 쿼리
    const sql8 = 'SELECT * FROM users; SELECT * FROM posts WHERE ';
    const r8 = parseSQL(sql8, sql8.length);
    // 두 번째 쿼리의 컨텍스트를 가져와야 함
    assert(r8.cursorContext.type === 'WHERE', '세미콜론 후 WHERE');

    // 주석 포함 (라인 주석은 stripStrings에서 처리 안 되므로)
    const sql9 = 'SELECT * FROM users u -- this is a comment\nWHERE u.';
    const r9 = parseSQL(sql9, sql9.length);
    assert(r9.cursorContext.type === 'ALIAS_DOT', '라인 주석 후 — ALIAS_DOT');

    // 매우 긴 테이블명
    const longName = 'a'.repeat(200);
    const sql10 = `SELECT * FROM ${longName} t WHERE t.`;
    const r10 = parseSQL(sql10, sql10.length);
    assert(r10.aliasMap.get('t') === longName, '200자 테이블명 처리');
}

// ══════════════════════════════════════════════════════════════
//  10. extractJoinClauses 심화
// ══════════════════════════════════════════════════════════════

function testExtractJoinClausesAdvanced() {
    section('extractJoinClauses 심화');

    // 모든 JOIN 타입
    const sql = `
        SELECT * FROM t1
        INNER JOIN t2 ON t1.id = t2.t1_id
        LEFT JOIN t3 ON t2.id = t3.t2_id
        RIGHT JOIN t4 ON t3.id = t4.t3_id
        FULL JOIN t5 ON t4.id = t5.t4_id
        CROSS JOIN t6
    `;
    const joins = extractJoinClauses(sql);
    assert(joins.length === 5, `5가지 JOIN 타입 — ${joins.length}개`);

    const types = joins.map(j => j.type);
    assert(types.includes('INNER JOIN'), 'INNER JOIN 추출');
    assert(types.includes('LEFT JOIN'), 'LEFT JOIN 추출');
    assert(types.includes('RIGHT JOIN'), 'RIGHT JOIN 추출');
    assert(types.includes('FULL JOIN'), 'FULL JOIN 추출');
    assert(types.includes('CROSS JOIN'), 'CROSS JOIN 추출');

    // CROSS JOIN은 ON 절이 없음
    const crossJoin = joins.find(j => j.type === 'CROSS JOIN');
    assert(crossJoin?.hasOnClause === false, 'CROSS JOIN — ON 없음');

    // 나머지는 ON 절 있음
    const innerJoin = joins.find(j => j.type === 'INNER JOIN');
    assert(innerJoin?.hasOnClause === true, 'INNER JOIN — ON 있음');

    // JOIN 없는 쿼리
    const noJoinSql = 'SELECT * FROM users WHERE id = 1';
    const noJoins = extractJoinClauses(noJoinSql);
    assert(noJoins.length === 0, 'JOIN 없음 — 빈 배열');

    // JOIN with alias
    const aliasSql = 'SELECT * FROM users u JOIN posts p ON u.id = p.user_id';
    const aliasJoins = extractJoinClauses(aliasSql);
    assert(aliasJoins.length === 1, 'JOIN with alias — 1개');
    assert(aliasJoins[0].table.table === 'posts', 'JOIN alias — table=posts');
    assert(aliasJoins[0].table.alias === 'p', 'JOIN alias — alias=p');
}

// ══════════════════════════════════════════════════════════════
//  11. aliasMap 무결성
// ══════════════════════════════════════════════════════════════

function testAliasMapIntegrity() {
    section('aliasMap 무결성');

    // FROM + JOIN 모든 별칭이 맵에 있는지
    const sql = `
        SELECT o.id, u.name, p.title
        FROM orders o
        JOIN users u ON o.user_id = u.id
        LEFT JOIN products p ON o.product_id = p.id
        WHERE o.`;
    const r = parseSQL(sql, sql.length);

    assert(r.aliasMap.has('o'), 'aliasMap — o 존재');
    assert(r.aliasMap.has('u'), 'aliasMap — u 존재');
    assert(r.aliasMap.has('p'), 'aliasMap — p 존재');
    assert(r.aliasMap.get('o') === 'orders', 'aliasMap — o → orders');
    assert(r.aliasMap.get('u') === 'users', 'aliasMap — u → users');
    assert(r.aliasMap.get('p') === 'products', 'aliasMap — p → products');

    // 테이블명 자체도 맵에 포함
    assert(r.aliasMap.has('orders'), 'aliasMap — orders 자체 포함');
    assert(r.aliasMap.has('users'), 'aliasMap — users 자체 포함');
    assert(r.aliasMap.has('products'), 'aliasMap — products 자체 포함');

    // 대소문자 구분 (소문자로 저장)
    const sql2 = 'SELECT * FROM MyTable AS MT WHERE MT.';
    const r2 = parseSQL(sql2, sql2.length);
    assert(r2.aliasMap.get('mt') === 'MyTable', 'aliasMap — 소문자 키 + 원본 값');

    // 중복 테이블 별칭 (마지막 값 유지)
    const sql3 = 'SELECT * FROM users u, users u';
    const r3 = parseSQL(sql3, sql3.length);
    // 중복 제거되어야 함
    assert(r3.tables.length >= 1, '중복 테이블 — 최소 1개');
}

// ══════════════════════════════════════════════════════════════
//  12. 실제 시나리오 쿼리
// ══════════════════════════════════════════════════════════════

function testRealWorldQueries() {
    section('실제 시나리오 쿼리');

    // 대시보드 쿼리: 여러 집계 + JOIN
    const sql1 = `
        SELECT
            u.name,
            COUNT(o.id) as order_count,
            SUM(o.total) as total_spent,
            MAX(o.created_at) as last_order
        FROM users u
        LEFT JOIN orders o ON u.id = o.user_id
        WHERE u.active = true
        GROUP BY u.name
        HAVING COUNT(o.id) > 0
        ORDER BY total_spent DESC
        LIMIT 10`;
    const r1 = parseSQL(sql1, sql1.indexOf('u.name') + 2); // u. 뒤
    assert(r1.cursorContext.type === 'ALIAS_DOT', '대시보드 — ALIAS_DOT');
    assert(r1.aliasMap.get('u') === 'users', '대시보드 — u → users');
    assert(r1.aliasMap.get('o') === 'orders', '대시보드 — o → orders');

    // 검색 쿼리: LIKE + OR
    const sql2 = 'SELECT * FROM products p WHERE p.name LIKE \'%phone%\' OR p.';
    const r2 = parseSQL(sql2, sql2.length);
    assert(r2.cursorContext.type === 'ALIAS_DOT', '검색 쿼리 — ALIAS_DOT');
    assert(r2.cursorContext.type === 'ALIAS_DOT' && r2.cursorContext.alias === 'p',
        '검색 쿼리 — alias=p');

    // 복잡한 리포트 쿼리
    const sql3 = `
        SELECT
            d.name as dept_name,
            e.name as emp_name,
            e.salary,
            AVG(e.salary) OVER (PARTITION BY d.id) as dept_avg
        FROM departments d
        JOIN employees e ON d.id = e.dept_id
        WHERE e.salary > (SELECT AVG(salary) FROM employees)
        ORDER BY d.`;
    const r3 = parseSQL(sql3, sql3.length);
    assert(r3.cursorContext.type === 'ALIAS_DOT', '리포트 쿼리 — ALIAS_DOT');
    assert(r3.aliasMap.get('d') === 'departments', '리포트 — d → departments');
    assert(r3.aliasMap.get('e') === 'employees', '리포트 — e → employees');

    // UNION 쿼리
    const sql4 = `
        SELECT name, 'customer' as type FROM customers
        UNION ALL
        SELECT name, 'supplier' as type FROM suppliers
        ORDER BY `;
    const r4 = parseSQL(sql4, sql4.length);
    assert(r4.cursorContext.type === 'ORDER_BY', 'UNION — ORDER BY 컨텍스트');
    const allTables = extractTableReferences(sql4);
    const tableNames = allTables.map(t => t.table);
    assert(tableNames.includes('customers'), 'UNION — customers 추출');
    assert(tableNames.includes('suppliers'), 'UNION — suppliers 추출');
}

// ── Main ─────────────────────────────────────────────────────

function main() {
    console.log('🔍 SQL 파서 심화 유닛 테스트\n');

    testComplexSubqueries();
    testCTEPatterns();
    testComplexJoins();
    testSchemaQualifiedTables();
    testStringLiteralIgnoring();
    testComplexAliasPatterns();
    testDMLContext();
    testGroupByOrderBy();
    testEdgeCases();
    testExtractJoinClausesAdvanced();
    testAliasMapIntegrity();
    testRealWorldQueries();

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  결과: ✅ ${totalPass}개 통과, ❌ ${totalFail}개 실패`);
    console.log(`${'═'.repeat(60)}`);

    console.log('');
    process.exit(totalFail > 0 ? 1 : 0);
}

main();
