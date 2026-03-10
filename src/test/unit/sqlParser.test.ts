import * as assert from 'assert';
import { parseSQL, extractTableReferences, extractJoinClauses } from '../../utils/sqlParser';

// ============================================================
// SQL Parser Unit Tests — v2.0.0
// DB 연결 없이 순수 파싱 로직만 테스트
// ============================================================

suite('SQL Parser — extractTableReferences', () => {
    test('단일 테이블 (별칭 없음)', () => {
        const refs = extractTableReferences('SELECT * FROM users');
        assert.strictEqual(refs.length, 1);
        assert.strictEqual(refs[0].table, 'users');
        assert.strictEqual(refs[0].alias, undefined);
    });

    test('단일 테이블 + 별칭', () => {
        const refs = extractTableReferences('SELECT * FROM users u');
        assert.strictEqual(refs.length, 1);
        assert.strictEqual(refs[0].table, 'users');
        assert.strictEqual(refs[0].alias, 'u');
    });

    test('단일 테이블 + AS 별칭', () => {
        const refs = extractTableReferences('SELECT * FROM users AS u');
        assert.strictEqual(refs.length, 1);
        assert.strictEqual(refs[0].table, 'users');
        assert.strictEqual(refs[0].alias, 'u');
    });

    test('다중 테이블 (콤마 구분)', () => {
        const refs = extractTableReferences('SELECT * FROM users u, posts p');
        assert.strictEqual(refs.length, 2);
        assert.strictEqual(refs[0].table, 'users');
        assert.strictEqual(refs[0].alias, 'u');
        assert.strictEqual(refs[1].table, 'posts');
        assert.strictEqual(refs[1].alias, 'p');
    });

    test('스키마.테이블 형태', () => {
        const refs = extractTableReferences('SELECT * FROM public.users u');
        assert.strictEqual(refs.length, 1);
        assert.strictEqual(refs[0].schema, 'public');
        assert.strictEqual(refs[0].table, 'users');
        assert.strictEqual(refs[0].alias, 'u');
    });

    test('UPDATE 문에서 테이블 추출', () => {
        const refs = extractTableReferences('UPDATE users SET name = ?');
        assert.strictEqual(refs.length, 1);
        assert.strictEqual(refs[0].table, 'users');
    });

    test('INSERT INTO 문에서 테이블 추출', () => {
        const refs = extractTableReferences('INSERT INTO users VALUES (1)');
        assert.strictEqual(refs.length, 1);
        assert.strictEqual(refs[0].table, 'users');
    });

    test('WHERE 키워드 이후는 테이블로 인식하지 않음', () => {
        const refs = extractTableReferences('SELECT * FROM users WHERE id = 1');
        assert.strictEqual(refs.length, 1);
        assert.strictEqual(refs[0].table, 'users');
    });
});

suite('SQL Parser — extractJoinClauses', () => {
    test('단순 JOIN', () => {
        const joins = extractJoinClauses('SELECT * FROM users u JOIN posts p ON u.id = p.user_id');
        assert.strictEqual(joins.length, 1);
        assert.strictEqual(joins[0].type, 'JOIN');
        assert.strictEqual(joins[0].table.table, 'posts');
        assert.strictEqual(joins[0].table.alias, 'p');
        assert.strictEqual(joins[0].hasOnClause, true);
    });

    test('LEFT JOIN', () => {
        const joins = extractJoinClauses('SELECT * FROM users LEFT JOIN posts p ON u.id = p.user_id');
        assert.strictEqual(joins.length, 1);
        assert.strictEqual(joins[0].type, 'LEFT JOIN');
        assert.strictEqual(joins[0].table.table, 'posts');
    });

    test('다중 JOIN', () => {
        const sql = 'SELECT * FROM users u INNER JOIN posts p ON u.id = p.user_id LEFT JOIN comments c ON p.id = c.post_id';
        const joins = extractJoinClauses(sql);
        assert.strictEqual(joins.length, 2);
        assert.strictEqual(joins[0].type, 'INNER JOIN');
        assert.strictEqual(joins[0].table.table, 'posts');
        assert.strictEqual(joins[1].type, 'LEFT JOIN');
        assert.strictEqual(joins[1].table.table, 'comments');
    });

    test('ON 절 없는 JOIN (입력 중)', () => {
        const joins = extractJoinClauses('SELECT * FROM users u JOIN posts');
        assert.strictEqual(joins.length, 1);
        assert.strictEqual(joins[0].hasOnClause, false);
    });
});

suite('SQL Parser — parseSQL 커서 컨텍스트', () => {
    test('ALIAS_DOT: u. 뒤에서 커서', () => {
        const sql = 'SELECT u. FROM users u';
        const cursorPos = 'SELECT u.'.length;
        const result = parseSQL(sql, cursorPos);
        assert.strictEqual(result.cursorContext.type, 'ALIAS_DOT');
        if (result.cursorContext.type === 'ALIAS_DOT') {
            assert.strictEqual(result.cursorContext.alias, 'u');
        }
    });

    test('ALIAS_DOT: alias 맵에서 실제 테이블 이름 확인', () => {
        const sql = 'SELECT u. FROM users u';
        const cursorPos = 'SELECT u.'.length;
        const result = parseSQL(sql, cursorPos);
        assert.strictEqual(result.aliasMap.get('u'), 'users');
    });

    test('SELECT_COLUMNS: SELECT 다음, FROM 이전', () => {
        const sql = 'SELECT ';
        const result = parseSQL(sql, sql.length);
        assert.strictEqual(result.cursorContext.type, 'SELECT_COLUMNS');
    });

    test('FROM_TABLE: FROM 다음에 테이블 입력 중', () => {
        const sql = 'SELECT * FROM ';
        const result = parseSQL(sql, sql.length);
        assert.strictEqual(result.cursorContext.type, 'FROM_TABLE');
    });

    test('JOIN_TABLE: JOIN 다음에 테이블 입력 중', () => {
        const sql = 'SELECT * FROM users u JOIN ';
        const result = parseSQL(sql, sql.length);
        assert.strictEqual(result.cursorContext.type, 'JOIN_TABLE');
    });

    test('JOIN_ON: JOIN 테이블 뒤 ON 절 작성 중', () => {
        const sql = 'SELECT * FROM users u JOIN posts p ON ';
        const result = parseSQL(sql, sql.length);
        assert.strictEqual(result.cursorContext.type, 'JOIN_ON');
        if (result.cursorContext.type === 'JOIN_ON') {
            assert.strictEqual(result.cursorContext.joinTable.table, 'posts');
        }
    });

    test('WHERE: WHERE 절 내부', () => {
        const sql = 'SELECT * FROM users WHERE ';
        const result = parseSQL(sql, sql.length);
        assert.strictEqual(result.cursorContext.type, 'WHERE');
    });

    test('GROUP_BY: GROUP BY 절', () => {
        const sql = 'SELECT * FROM users GROUP BY ';
        const result = parseSQL(sql, sql.length);
        assert.strictEqual(result.cursorContext.type, 'GROUP_BY');
    });

    test('ORDER_BY: ORDER BY 절', () => {
        const sql = 'SELECT * FROM users ORDER BY ';
        const result = parseSQL(sql, sql.length);
        assert.strictEqual(result.cursorContext.type, 'ORDER_BY');
    });
});

suite('SQL Parser — parseSQL 테이블 및 별칭 추출', () => {
    test('FROM + JOIN에서 모든 테이블 추출', () => {
        const sql = 'SELECT * FROM users u JOIN posts p ON u.id = p.user_id';
        const result = parseSQL(sql, sql.length);
        assert.strictEqual(result.tables.length, 2);

        const tableNames = result.tables.map(t => t.table);
        assert.ok(tableNames.includes('users'));
        assert.ok(tableNames.includes('posts'));
    });

    test('별칭 맵 정확성', () => {
        const sql = 'SELECT * FROM users u JOIN posts p ON u.id = p.user_id';
        const result = parseSQL(sql, sql.length);
        assert.strictEqual(result.aliasMap.get('u'), 'users');
        assert.strictEqual(result.aliasMap.get('p'), 'posts');
        assert.strictEqual(result.aliasMap.get('users'), 'users');
        assert.strictEqual(result.aliasMap.get('posts'), 'posts');
    });

    test('복잡한 다중 JOIN 쿼리', () => {
        const sql = `SELECT u.name, p.title, c.body
            FROM users u
            INNER JOIN posts p ON u.id = p.user_id
            LEFT JOIN comments c ON p.id = c.post_id
            WHERE u.age > 18`;
        const result = parseSQL(sql, sql.length);

        assert.strictEqual(result.tables.length, 3);
        assert.strictEqual(result.aliasMap.get('u'), 'users');
        assert.strictEqual(result.aliasMap.get('p'), 'posts');
        assert.strictEqual(result.aliasMap.get('c'), 'comments');
    });

    test('별칭 없는 다중 테이블', () => {
        const sql = 'SELECT * FROM users, posts';
        const result = parseSQL(sql, sql.length);

        assert.strictEqual(result.tables.length, 2);
        assert.strictEqual(result.aliasMap.get('users'), 'users');
        assert.strictEqual(result.aliasMap.get('posts'), 'posts');
    });
});

suite('SQL Parser — 서브쿼리 컨텍스트', () => {
    test('서브쿼리 내부에서 FROM 인식', () => {
        const sql = 'SELECT * FROM (SELECT * FROM ';
        const cursorPos = sql.length;
        const result = parseSQL(sql, cursorPos);
        // 서브쿼리 내부에서 FROM 다음이므로 FROM_TABLE
        assert.strictEqual(result.cursorContext.type, 'FROM_TABLE');
    });

    test('서브쿼리 내부 테이블 인식', () => {
        const sql = 'SELECT * FROM (SELECT * FROM orders o WHERE o.';
        const cursorPos = sql.length;
        const result = parseSQL(sql, cursorPos);
        assert.strictEqual(result.cursorContext.type, 'ALIAS_DOT');
        if (result.cursorContext.type === 'ALIAS_DOT') {
            assert.strictEqual(result.cursorContext.alias, 'o');
        }
        assert.strictEqual(result.aliasMap.get('o'), 'orders');
    });
});

suite('SQL Parser — 엣지 케이스', () => {
    test('빈 문자열', () => {
        const result = parseSQL('', 0);
        assert.strictEqual(result.tables.length, 0);
        assert.strictEqual(result.cursorContext.type, 'UNKNOWN');
    });

    test('키워드만 있는 경우', () => {
        const sql = 'SELECT';
        const result = parseSQL(sql, sql.length);
        assert.strictEqual(result.tables.length, 0);
    });

    test('문자열 리터럴 안의 FROM은 무시', () => {
        const sql = "SELECT * FROM users WHERE name = 'FROM posts'";
        const result = parseSQL(sql, sql.length);
        // 'FROM posts'는 문자열이므로 posts가 테이블로 추출되면 안 됨
        const tableNames = result.tables.map(t => t.table);
        assert.ok(!tableNames.includes('posts'));
    });

    test('테이블 이름이 SQL 키워드와 동일한 경우 제외', () => {
        // FROM SELECT — 'SELECT'는 키워드이므로 테이블로 인식하면 안 됨
        const refs = extractTableReferences('SELECT * FROM SELECT');
        const tableNames = refs.map(r => r.table);
        assert.ok(!tableNames.includes('SELECT'));
    });

    test('대소문자 혼용', () => {
        const sql = 'select * from Users U join Posts P on U.id = P.user_id';
        const result = parseSQL(sql, sql.length);
        assert.strictEqual(result.aliasMap.get('u'), 'Users');
        assert.strictEqual(result.aliasMap.get('p'), 'Posts');
    });
});
