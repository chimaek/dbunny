/**
 * SQL Parser 스탠드얼론 테스트 — vscode 의존성 없이 실행 가능
 *
 * 실행법: npx tsx src/test/unit/sqlParser.standalone.ts
 */

import { parseSQL, extractTableReferences, extractJoinClauses } from '../../utils/sqlParser';

let totalPass = 0;
let totalFail = 0;
const failures: string[] = [];

function header(title: string) {
    console.log(`\n${'─'.repeat(50)}`);
    console.log(`  ${title}`);
    console.log(`${'─'.repeat(50)}`);
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

// ── extractTableReferences ───────────────────────────────

header('extractTableReferences');

(() => {
    const refs = extractTableReferences('SELECT * FROM users');
    assert(refs.length === 1, '단일 테이블');
    assert(refs[0].table === 'users', '테이블 이름: users');
    assert(refs[0].alias === undefined, '별칭 없음');
})();

(() => {
    const refs = extractTableReferences('SELECT * FROM users u');
    assert(refs[0].table === 'users', '테이블: users');
    assert(refs[0].alias === 'u', '별칭: u');
})();

(() => {
    const refs = extractTableReferences('SELECT * FROM users AS u');
    assert(refs[0].table === 'users', 'AS 키워드 — 테이블: users');
    assert(refs[0].alias === 'u', 'AS 키워드 — 별칭: u');
})();

(() => {
    const refs = extractTableReferences('SELECT * FROM users u, posts p');
    assert(refs.length === 2, '다중 테이블: 2개');
    assert(refs[0].table === 'users' && refs[0].alias === 'u', 'users u');
    assert(refs[1].table === 'posts' && refs[1].alias === 'p', 'posts p');
})();

(() => {
    const refs = extractTableReferences('SELECT * FROM public.users u');
    assert(refs[0].schema === 'public', '스키마: public');
    assert(refs[0].table === 'users', '테이블: users');
    assert(refs[0].alias === 'u', '별칭: u');
})();

(() => {
    const refs = extractTableReferences('UPDATE users SET name = ?');
    assert(refs.length === 1 && refs[0].table === 'users', 'UPDATE 문 테이블 추출');
})();

(() => {
    const refs = extractTableReferences('INSERT INTO users VALUES (1)');
    assert(refs.length === 1 && refs[0].table === 'users', 'INSERT INTO 테이블 추출');
})();

(() => {
    const refs = extractTableReferences('SELECT * FROM users WHERE id = 1');
    assert(refs.length === 1, 'WHERE 이후는 테이블로 인식 안 함');
})();

// ── extractJoinClauses ───────────────────────────────────

header('extractJoinClauses');

(() => {
    const joins = extractJoinClauses('SELECT * FROM users u JOIN posts p ON u.id = p.user_id');
    assert(joins.length === 1, 'JOIN 1개');
    assert(joins[0].type === 'JOIN', 'type: JOIN');
    assert(joins[0].table.table === 'posts', 'table: posts');
    assert(joins[0].table.alias === 'p', 'alias: p');
    assert(joins[0].hasOnClause === true, 'ON 절 있음');
})();

(() => {
    const joins = extractJoinClauses('SELECT * FROM users LEFT JOIN posts p ON u.id = p.user_id');
    assert(joins[0].type === 'LEFT JOIN', 'type: LEFT JOIN');
})();

(() => {
    const sql = 'SELECT * FROM users u INNER JOIN posts p ON u.id = p.user_id LEFT JOIN comments c ON p.id = c.post_id';
    const joins = extractJoinClauses(sql);
    assert(joins.length === 2, '다중 JOIN: 2개');
    assert(joins[0].type === 'INNER JOIN', '1st: INNER JOIN');
    assert(joins[1].type === 'LEFT JOIN', '2nd: LEFT JOIN');
})();

(() => {
    const joins = extractJoinClauses('SELECT * FROM users u JOIN posts');
    assert(joins[0].hasOnClause === false, 'ON 절 없음 (입력 중)');
})();

// ── parseSQL 커서 컨텍스트 ───────────────────────────────

header('parseSQL — 커서 컨텍스트');

(() => {
    const sql = 'SELECT u. FROM users u';
    const result = parseSQL(sql, 'SELECT u.'.length);
    assert(result.cursorContext.type === 'ALIAS_DOT', 'ALIAS_DOT: u.');
    if (result.cursorContext.type === 'ALIAS_DOT') {
        assert(result.cursorContext.alias === 'u', 'alias: u');
    }
    assert(result.aliasMap.get('u') === 'users', 'aliasMap: u → users');
})();

(() => {
    const result = parseSQL('SELECT ', 'SELECT '.length);
    assert(result.cursorContext.type === 'SELECT_COLUMNS', 'SELECT_COLUMNS');
})();

(() => {
    const result = parseSQL('SELECT * FROM ', 'SELECT * FROM '.length);
    assert(result.cursorContext.type === 'FROM_TABLE', 'FROM_TABLE');
})();

(() => {
    const result = parseSQL('SELECT * FROM users u JOIN ', 'SELECT * FROM users u JOIN '.length);
    assert(result.cursorContext.type === 'JOIN_TABLE', 'JOIN_TABLE');
})();

(() => {
    const sql = 'SELECT * FROM users u JOIN posts p ON ';
    const result = parseSQL(sql, sql.length);
    assert(result.cursorContext.type === 'JOIN_ON', 'JOIN_ON');
    if (result.cursorContext.type === 'JOIN_ON') {
        assert(result.cursorContext.joinTable.table === 'posts', 'joinTable: posts');
    }
})();

(() => {
    const result = parseSQL('SELECT * FROM users WHERE ', 'SELECT * FROM users WHERE '.length);
    assert(result.cursorContext.type === 'WHERE', 'WHERE');
})();

(() => {
    const result = parseSQL('SELECT * FROM users GROUP BY ', 'SELECT * FROM users GROUP BY '.length);
    assert(result.cursorContext.type === 'GROUP_BY', 'GROUP_BY');
})();

(() => {
    const result = parseSQL('SELECT * FROM users ORDER BY ', 'SELECT * FROM users ORDER BY '.length);
    assert(result.cursorContext.type === 'ORDER_BY', 'ORDER_BY');
})();

// ── 테이블 및 별칭 추출 ────────────────────────────────

header('parseSQL — 테이블 및 별칭');

(() => {
    const sql = 'SELECT * FROM users u JOIN posts p ON u.id = p.user_id';
    const result = parseSQL(sql, sql.length);
    assert(result.tables.length === 2, '테이블 2개');
    const names = result.tables.map(t => t.table);
    assert(names.includes('users'), 'users 포함');
    assert(names.includes('posts'), 'posts 포함');
    assert(result.aliasMap.get('u') === 'users', 'u → users');
    assert(result.aliasMap.get('p') === 'posts', 'p → posts');
})();

(() => {
    const sql = `SELECT u.name, p.title, c.body
        FROM users u
        INNER JOIN posts p ON u.id = p.user_id
        LEFT JOIN comments c ON p.id = c.post_id`;
    const result = parseSQL(sql, sql.length);
    assert(result.tables.length === 3, '3개 테이블');
    assert(result.aliasMap.get('c') === 'comments', 'c → comments');
})();

(() => {
    const sql = 'SELECT * FROM users, posts';
    const result = parseSQL(sql, sql.length);
    assert(result.tables.length === 2, '콤마 구분 2개');
})();

// ── 서브쿼리 ────────────────────────────────────────────

header('서브쿼리 컨텍스트');

(() => {
    const sql = 'SELECT * FROM (SELECT * FROM ';
    const result = parseSQL(sql, sql.length);
    assert(result.cursorContext.type === 'FROM_TABLE', '서브쿼리 내 FROM_TABLE');
})();

(() => {
    const sql = 'SELECT * FROM (SELECT * FROM orders o WHERE o.';
    const result = parseSQL(sql, sql.length);
    assert(result.cursorContext.type === 'ALIAS_DOT', '서브쿼리 내 ALIAS_DOT');
    if (result.cursorContext.type === 'ALIAS_DOT') {
        assert(result.cursorContext.alias === 'o', 'alias: o');
    }
    assert(result.aliasMap.get('o') === 'orders', 'o → orders');
})();

// ── 엣지 케이스 ─────────────────────────────────────────

header('엣지 케이스');

(() => {
    const result = parseSQL('', 0);
    assert(result.tables.length === 0, '빈 문자열 — 테이블 0개');
    assert(result.cursorContext.type === 'UNKNOWN', '빈 문자열 — UNKNOWN');
})();

(() => {
    const sql = "SELECT * FROM users WHERE name = 'FROM posts'";
    const result = parseSQL(sql, sql.length);
    const names = result.tables.map(t => t.table);
    assert(!names.includes('posts'), '문자열 리터럴 내 FROM 무시');
})();

(() => {
    const refs = extractTableReferences('SELECT * FROM SELECT');
    const names = refs.map(r => r.table);
    assert(!names.includes('SELECT'), 'SQL 키워드는 테이블로 인식 안 함');
})();

(() => {
    const sql = 'select * from Users U join Posts P on U.id = P.user_id';
    const result = parseSQL(sql, sql.length);
    assert(result.aliasMap.get('u') === 'Users', '대소문자 혼용 — u → Users');
    assert(result.aliasMap.get('p') === 'Posts', '대소문자 혼용 — p → Posts');
})();

// ── UPDATE / INSERT / SET 컨텍스트 ────────────────────

header('parseSQL — UPDATE / INSERT / SET 컨텍스트');

(() => {
    const sql = 'UPDATE users SET ';
    const result = parseSQL(sql, sql.length);
    assert(result.cursorContext.type === 'SET_CLAUSE', 'UPDATE ... SET → SET_CLAUSE');
})();

(() => {
    const sql = 'UPDATE ';
    const result = parseSQL(sql, sql.length);
    assert(result.cursorContext.type === 'UPDATE_TABLE', 'UPDATE → UPDATE_TABLE');
})();

(() => {
    const sql = 'INSERT INTO ';
    const result = parseSQL(sql, sql.length);
    assert(result.cursorContext.type === 'INSERT_INTO', 'INSERT INTO → INSERT_INTO');
})();

(() => {
    const sql = 'UPDATE users SET name = "test" WHERE ';
    const result = parseSQL(sql, sql.length);
    assert(result.cursorContext.type === 'WHERE', 'UPDATE ... WHERE → WHERE');
})();

// ── 복잡한 JOIN 시나리오 ────────────────────────────

header('extractJoinClauses — 다양한 JOIN 타입');

(() => {
    const joins = extractJoinClauses('SELECT * FROM a CROSS JOIN b');
    assert(joins.length === 1, 'CROSS JOIN 감지');
    assert(joins[0].type === 'CROSS JOIN', 'type: CROSS JOIN');
})();

(() => {
    const joins = extractJoinClauses('SELECT * FROM a RIGHT JOIN b ON a.id = b.aid');
    assert(joins[0].type === 'RIGHT JOIN', 'type: RIGHT JOIN');
    assert(joins[0].hasOnClause === true, 'ON 절 있음');
})();

(() => {
    const joins = extractJoinClauses('SELECT * FROM a FULL JOIN b ON a.id = b.id');
    assert(joins[0].type === 'FULL JOIN', 'type: FULL JOIN');
})();

// ── 스키마 접두사가 있는 테이블 ────────────────────────

header('extractTableReferences — 스키마 접두사');

(() => {
    const refs = extractTableReferences('SELECT * FROM myschema.users u JOIN myschema.posts p ON u.id = p.user_id');
    const userRef = refs.find(r => r.table === 'users');
    assert(userRef !== undefined, 'users 테이블 추출');
    assert(userRef?.schema === 'myschema', 'users 스키마: myschema');
    assert(userRef?.alias === 'u', 'users 별칭: u');
})();

(() => {
    const refs = extractTableReferences('SELECT * FROM pg_catalog.pg_tables');
    assert(refs.length === 1, 'pg_catalog 스키마 테이블');
    assert(refs[0].schema === 'pg_catalog', 'schema: pg_catalog');
    assert(refs[0].table === 'pg_tables', 'table: pg_tables');
})();

// ── 복잡한 서브쿼리 시나리오 ────────────────────────

header('서브쿼리 — 복잡한 시나리오');

(() => {
    // 이중 괄호 (서브쿼리 안의 함수)
    const sql = 'SELECT * FROM (SELECT MAX(id) FROM users WHERE ';
    const result = parseSQL(sql, sql.length);
    assert(result.cursorContext.type === 'WHERE', '서브쿼리 내부 WHERE');
})();

(() => {
    // JOIN 내 서브쿼리
    const sql = 'SELECT * FROM users u JOIN (SELECT user_id, COUNT(*) as cnt FROM orders GROUP BY ';
    const result = parseSQL(sql, sql.length);
    assert(result.cursorContext.type === 'GROUP_BY', '서브쿼리 내부 GROUP BY');
})();

// ── 다중 FROM 절 ────────────────────────────────────

header('extractTableReferences — 다중 테이블');

(() => {
    const refs = extractTableReferences('SELECT * FROM users u, posts p, comments c WHERE u.id = p.user_id');
    assert(refs.length === 3, '3개 콤마 구분 테이블');
    const names = refs.map(r => r.table);
    assert(names.includes('users'), 'users 포함');
    assert(names.includes('posts'), 'posts 포함');
    assert(names.includes('comments'), 'comments 포함');
})();

(() => {
    const refs = extractTableReferences('SELECT * FROM (SELECT 1) AS sub');
    // 서브쿼리는 건너뜀
    assert(refs.length === 0, '서브쿼리는 테이블로 추출 안 됨');
})();

// ── aliasMap 동작 검증 ────────────────────────────

header('parseSQL — aliasMap 상세');

(() => {
    const sql = 'SELECT * FROM users AS u JOIN orders AS o ON u.id = o.user_id';
    const result = parseSQL(sql, sql.length);
    assert(result.aliasMap.get('u') === 'users', 'AS 키워드 별칭 — u → users');
    assert(result.aliasMap.get('o') === 'orders', 'AS 키워드 별칭 — o → orders');
    // 테이블 이름 자체도 맵에 있어야 함
    assert(result.aliasMap.get('users') === 'users', 'users → users');
    assert(result.aliasMap.get('orders') === 'orders', 'orders → orders');
})();

(() => {
    // 대소문자 무관
    const sql = 'SELECT * FROM Users U';
    const result = parseSQL(sql, sql.length);
    assert(result.aliasMap.get('u') === 'Users', '대소문자 무관 별칭 매핑');
})();

// ── 커서가 쿼리 중간에 있는 경우 ──────────────────

header('parseSQL — 커서 위치 변형');

(() => {
    const sql = 'SELECT * FROM users WHERE id = 1 ORDER BY name';
    // 커서가 WHERE 절 중간
    const cursorPos = 'SELECT * FROM users WHERE '.length;
    const result = parseSQL(sql, cursorPos);
    assert(result.cursorContext.type === 'WHERE', '쿼리 중간 커서 — WHERE');
})();

(() => {
    const sql = 'SELECT * FROM users WHERE id = 1 ORDER BY name';
    // 커서가 ORDER BY 뒤
    const cursorPos = 'SELECT * FROM users WHERE id = 1 ORDER BY '.length;
    const result = parseSQL(sql, cursorPos);
    assert(result.cursorContext.type === 'ORDER_BY', '쿼리 중간 커서 — ORDER BY');
})();

(() => {
    // 커서가 첫 글자 위치
    const result = parseSQL('SELECT * FROM users', 1);
    assert(result.cursorContext.type !== undefined, '커서 위치 1에서도 동작');
})();

// ── Results ─────────────────────────────────────────────

console.log(`\n${'═'.repeat(50)}`);
console.log(`  RESULTS: ✅ ${totalPass} passed, ❌ ${totalFail} failed`);
console.log(`${'═'.repeat(50)}`);

if (failures.length > 0) {
    console.log('\n  Failures:');
    failures.forEach((f, i) => console.log(`    ${i + 1}. ${f}`));
}

process.exit(totalFail > 0 ? 1 : 0);
