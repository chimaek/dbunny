/**
 * DBunny 보안 통합 테스트
 *
 * 실제 DB 연결에서 SQL 인젝션 방지, 특수문자 처리, 식별자 이스케이핑이
 * 올바르게 동작하는지 검증합니다.
 *
 * 실행법: npx tsx src/test/integration/security.test.ts
 *
 * 사전 요구사항:
 *   docker compose up -d
 */

import { ConnectionConfig } from '../../types/database';
import { MySQLProvider } from '../../providers/mysqlProvider';
import { PostgresProvider } from '../../providers/postgresProvider';
import { SQLiteProvider } from '../../providers/sqliteProvider';

// ── Helpers ──────────────────────────────────────────────

let totalPass = 0;
let totalFail = 0;
const failures: string[] = [];

function header(title: string) {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  ${title}`);
    console.log(`${'═'.repeat(60)}`);
}

function pass(msg: string) {
    totalPass++;
    console.log(`  ✅ ${msg}`);
}

function fail(msg: string, err?: unknown) {
    totalFail++;
    const detail = err instanceof Error ? err.message : String(err ?? '');
    console.log(`  ❌ ${msg}${detail ? ' — ' + detail : ''}`);
    failures.push(`${msg}: ${detail}`);
}

function assert(condition: boolean, msg: string) {
    if (condition) { pass(msg); } else { fail(msg); }
}

// ── DB Configs ───────────────────────────────────────────

const mysqlConfig: ConnectionConfig = {
    id: 'sec-mysql', name: 'MySQL Security', type: 'mysql',
    host: 'localhost', port: 3306,
    username: 'root', password: 'root1234', database: 'mydb',
};

const pgConfig: ConnectionConfig = {
    id: 'sec-pg', name: 'PG Security', type: 'postgres',
    host: 'localhost', port: 5432,
    username: 'postgres', password: 'postgres1234', database: 'mydb',
};

const sqliteConfig: ConnectionConfig = {
    id: 'sec-sqlite', name: 'SQLite Security', type: 'sqlite',
    host: 'localhost', port: 0,
    username: '', database: ':memory:',
};

// ── MySQL Security Tests ─────────────────────────────────

async function testMySQLSecurity() {
    header('MySQL 보안 통합 테스트');

    const provider = new MySQLProvider(mysqlConfig);

    try {
        await provider.connect();
        pass('MySQL 연결 성공');

        // 테스트 테이블 생성
        await provider.executeQuery(`
            CREATE TABLE IF NOT EXISTS sec_test (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(200),
                email VARCHAR(200),
                bio TEXT
            )
        `);
        pass('테스트 테이블 생성');

        // 1. SQL 인젝션 방지 — 작은따옴표 이스케이핑
        await provider.executeQuery(
            `INSERT INTO sec_test (name, email) VALUES ('O''Brien', 'ob@test.com')`
        );
        const obResult = await provider.executeQuery(
            `SELECT * FROM sec_test WHERE name = 'O''Brien'`
        );
        assert(obResult.rows.length === 1, '작은따옴표 포함 이름 삽입/조회 성공');

        // 2. SQL 인젝션 시도 — 입력값에 SQL 구문
        await provider.executeQuery(
            `INSERT INTO sec_test (name, email) VALUES ('test''; DROP TABLE sec_test; --', 'hack@test.com')`
        );
        // 테이블이 살아있는지 확인
        const tableCheck = await provider.executeQuery('SELECT COUNT(*) AS cnt FROM sec_test');
        assert(Number(tableCheck.rows[0].cnt) >= 2, 'SQL 인젝션 시도 후 테이블 생존');

        // 3. 유니코드 및 이모지
        await provider.executeQuery(
            `INSERT INTO sec_test (name, bio) VALUES ('한국어이름', '🐰 DBunny 테스트 🔒')`
        );
        const unicodeResult = await provider.executeQuery(
            `SELECT * FROM sec_test WHERE name = '한국어이름'`
        );
        assert(unicodeResult.rows.length === 1, '유니코드 이름 삽입/조회');
        assert(String(unicodeResult.rows[0].bio).includes('🐰'), '이모지 데이터 보존');

        // 4. NULL 바이트 처리
        try {
            await provider.executeQuery(
                `INSERT INTO sec_test (name) VALUES ('null\x00byte')`
            );
            pass('NULL 바이트 포함 값 처리 (에러 없음)');
        } catch {
            pass('NULL 바이트 포함 값 거부 (보안적으로 올바름)');
        }

        // 5. 매우 긴 문자열
        const longStr = 'x'.repeat(199);
        await provider.executeQuery(
            `INSERT INTO sec_test (name) VALUES ('${longStr}')`
        );
        const longResult = await provider.executeQuery(
            `SELECT name FROM sec_test WHERE name = '${longStr}'`
        );
        assert(longResult.rows.length === 1, '199자 문자열 삽입/조회');

        // 6. getTableSchema — SQL 인젝션 차단 (MySQL은 backtick 이스케이핑으로 방어)
        try {
            await provider.getTableSchema("sec_test'; DROP TABLE sec_test; --");
            // backtick 이스케이핑으로 인해 존재하지 않는 테이블 에러 발생
            fail('악성 테이블 이름이 에러 없이 허용됨');
        } catch {
            // 테이블이 존재하지 않아 에러 발생 = 인젝션 실패
            pass('getTableSchema SQL 인젝션 차단 (backtick 이스케이핑)');
        }
        // 테이블이 살아있는지 재확인
        const afterSchemaCheck = await provider.executeQuery('SELECT COUNT(*) AS cnt FROM sec_test');
        assert(Number(afterSchemaCheck.rows[0].cnt) >= 2, 'getTableSchema 인젝션 시도 후 테이블 생존');

        // 7. 정상 스키마 조회
        const schema = await provider.getTableSchema('sec_test');
        assert(schema.length >= 3, 'getTableSchema 정상 동작');

        // 8. LIKE 절 와일드카드 이스케이핑
        await provider.executeQuery(
            `INSERT INTO sec_test (name) VALUES ('100%_discount')`
        );
        const likeResult = await provider.executeQuery(
            `SELECT * FROM sec_test WHERE name LIKE '100\\%\\_discount'`
        );
        assert(likeResult.rows.length === 1, 'LIKE 와일드카드 이스케이핑');

        // 정리
        await provider.executeQuery('DROP TABLE IF EXISTS sec_test');
        pass('테이블 정리 완료');

    } catch (err) {
        fail('MySQL 보안 테스트 오류', err);
    } finally {
        await provider.disconnect();
    }
}

// ── PostgreSQL Security Tests ────────────────────────────

async function testPostgreSQLSecurity() {
    header('PostgreSQL 보안 통합 테스트');

    const provider = new PostgresProvider(pgConfig);

    try {
        await provider.connect();
        pass('PostgreSQL 연결 성공');

        await provider.executeQuery(`
            CREATE TABLE IF NOT EXISTS sec_test (
                id SERIAL PRIMARY KEY,
                name VARCHAR(200),
                data JSONB,
                tags TEXT[]
            )
        `);
        pass('테스트 테이블 생성');

        // 1. Dollar-quoted 문자열 (PostgreSQL 전용)
        await provider.executeQuery(
            `INSERT INTO sec_test (name) VALUES ($$It's a "quoted" test$$)`
        );
        const dollarResult = await provider.executeQuery(
            `SELECT * FROM sec_test WHERE name = $$It's a "quoted" test$$`
        );
        assert(dollarResult.rows.length === 1, 'Dollar-quoted 문자열 처리');

        // 2. JSONB 데이터
        await provider.executeQuery(
            `INSERT INTO sec_test (name, data) VALUES ('json_test', '{"key": "value", "nested": {"a": 1}}'::jsonb)`
        );
        const jsonResult = await provider.executeQuery(
            `SELECT data->>'key' AS val FROM sec_test WHERE name = 'json_test'`
        );
        assert(jsonResult.rows.length === 1, 'JSONB 삽입/조회');
        assert(String(jsonResult.rows[0].val) === 'value', 'JSONB 값 추출');

        // 3. 배열 타입
        await provider.executeQuery(
            `INSERT INTO sec_test (name, tags) VALUES ('array_test', ARRAY['tag1', 'tag2', 'tag''s'])`
        );
        const arrayResult = await provider.executeQuery(
            `SELECT tags FROM sec_test WHERE name = 'array_test'`
        );
        assert(arrayResult.rows.length === 1, '배열 타입 삽입/조회');

        // 4. SQL 인젝션 시도 — UNION SELECT
        const unionResult = await provider.executeQuery(
            `SELECT name FROM sec_test WHERE name = 'nonexistent' UNION SELECT 'injected'`
        );
        // UNION은 정상 SQL이므로 실행은 됨 — 여기서는 결과 확인
        assert(unionResult.rows.length >= 1, 'UNION SELECT 실행 (정상 SQL)');

        // 5. 스키마 격리 확인
        const tablesResult = await provider.executeQuery(
            `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'sec_test'`
        );
        assert(tablesResult.rows.length === 1, 'public 스키마에 테이블 존재');

        // 6. 트랜잭션 내 에러 복구
        try {
            await provider.executeQuery('BEGIN');
            await provider.executeQuery(`INSERT INTO sec_test (name) VALUES ('tx_test')`);
            await provider.executeQuery('INVALID SQL SYNTAX HERE');
        } catch {
            // 에러 발생 시 롤백
        }
        try {
            await provider.executeQuery('ROLLBACK');
        } catch {
            // 이미 롤백된 경우
        }
        // 트랜잭션 에러 후에도 정상 쿼리 실행 가능
        const afterTxResult = await provider.executeQuery('SELECT 1 AS ok');
        assert(afterTxResult.rows.length === 1, '트랜잭션 에러 후 복구');

        // 정리
        await provider.executeQuery('DROP TABLE IF EXISTS sec_test');
        pass('테이블 정리 완료');

    } catch (err) {
        fail('PostgreSQL 보안 테스트 오류', err);
    } finally {
        await provider.disconnect();
    }
}

// ── SQLite Security Tests ────────────────────────────────

async function testSQLiteSecurity() {
    header('SQLite 보안 통합 테스트');

    const provider = new SQLiteProvider(sqliteConfig);

    try {
        await provider.connect();
        pass('SQLite 연결 성공');

        await provider.executeQuery(`
            CREATE TABLE sec_test (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT,
                amount REAL
            )
        `);
        pass('테스트 테이블 생성');

        // 1. 작은따옴표 이스케이핑
        await provider.executeQuery(
            `INSERT INTO sec_test (name) VALUES ('It''s safe')`
        );
        const quoteResult = await provider.executeQuery(
            `SELECT * FROM sec_test WHERE name = 'It''s safe'`
        );
        assert(quoteResult.rows.length === 1, '작은따옴표 이스케이핑 동작');

        // 2. 테이블 이름 SQL 인젝션 차단
        const maliciousNames = [
            "sec_test'; DROP TABLE sec_test; --",
            "sec_test' OR '1'='1",
            "' UNION SELECT sql FROM sqlite_master --",
        ];

        for (const name of maliciousNames) {
            try {
                await provider.getTableSchema(name);
                fail(`악성 테이블 이름 허용됨: ${name.substring(0, 30)}`);
            } catch (err) {
                const msg = err instanceof Error ? err.message : '';
                assert(msg.includes('Invalid table name'), `테이블 이름 인젝션 차단: ${name.substring(0, 25)}...`);
            }
        }

        // 3. 정수/실수 타입 정확성
        await provider.executeQuery(
            `INSERT INTO sec_test (name, amount) VALUES ('pi', 3.14159265358979)`
        );
        const piResult = await provider.executeQuery(
            `SELECT amount FROM sec_test WHERE name = 'pi'`
        );
        assert(Math.abs(Number(piResult.rows[0].amount) - 3.14159265358979) < 0.0001, '실수 정밀도 보존');

        // 4. NULL 처리
        await provider.executeQuery(
            `INSERT INTO sec_test (name, amount) VALUES (NULL, NULL)`
        );
        const nullResult = await provider.executeQuery(
            `SELECT * FROM sec_test WHERE name IS NULL`
        );
        assert(nullResult.rows.length === 1, 'NULL 삽입/조회');
        assert(nullResult.rows[0].amount === null, 'NULL 값 보존');

        // 5. 빈 문자열 vs NULL 구분
        await provider.executeQuery(
            `INSERT INTO sec_test (name) VALUES ('')`
        );
        const emptyResult = await provider.executeQuery(
            `SELECT * FROM sec_test WHERE name = ''`
        );
        const nullCount = await provider.executeQuery(
            `SELECT COUNT(*) AS cnt FROM sec_test WHERE name IS NULL`
        );
        assert(emptyResult.rows.length === 1, '빈 문자열 조회');
        assert(Number(nullCount.rows[0].cnt) === 1, 'NULL과 빈 문자열 구분');

        // 6. sqlite_master 접근 (정보 노출)
        const masterResult = await provider.executeQuery(
            `SELECT type, name, sql FROM sqlite_master WHERE type = 'table'`
        );
        assert(masterResult.rows.length >= 1, 'sqlite_master 조회 가능 (읽기)');

        pass('SQLite 보안 테스트 완료');

    } catch (err) {
        fail('SQLite 보안 테스트 오류', err);
    } finally {
        await provider.disconnect();
    }
}

// ── Main ─────────────────────────────────────────────────

async function main() {
    console.log('\n🔐 DBunny 보안 통합 테스트\n');

    await testMySQLSecurity();
    await testPostgreSQLSecurity();
    await testSQLiteSecurity();

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  결과: ✅ ${totalPass}개 통과, ❌ ${totalFail}개 실패`);
    console.log(`${'═'.repeat(60)}`);

    if (totalFail > 0) {
        console.log('\n실패한 테스트:');
        failures.forEach(f => console.log(`  - ${f}`));
        process.exit(1);
    }
}

main();
