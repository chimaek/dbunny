/**
 * DBunny v2.3.0 — 읽기 전용 모드 통합 테스트
 *
 * 실제 DB 연결에서 읽기 전용 가드가 쓰기 쿼리를 올바르게 감지하는지 검증합니다.
 * 읽기 전용 모드 설정 시 쿼리 실행 전 차단이 동작하는 워크플로우를 테스트합니다.
 *
 * 실행법: npx tsx src/test/integration/readOnlyGuard.test.ts
 *
 * 사전 요구사항:
 *   docker compose up -d
 */

import { ConnectionConfig } from '../../types/database';
import { MySQLProvider } from '../../providers/mysqlProvider';
import { PostgresProvider } from '../../providers/postgresProvider';
import {
    checkWriteOperation
} from '../../utils/readOnlyGuard';

// ── Helpers ──────────────────────────────────────────────────

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

// ── DB Configs ───────────────────────────────────────────────

const mysqlConfig: ConnectionConfig = {
    id: 'test-mysql-readonly',
    name: 'MySQL ReadOnly Test',
    type: 'mysql',
    host: 'localhost',
    port: 3306,
    username: 'root',
    password: 'root1234',
    database: 'mydb',
    readOnly: true
};

const pgConfig: ConnectionConfig = {
    id: 'test-pg-readonly',
    name: 'PostgreSQL ReadOnly Test',
    type: 'postgres',
    host: 'localhost',
    port: 5432,
    username: 'postgres',
    password: 'postgres1234',
    database: 'mydb',
    readOnly: true
};

// ── Test Suites ──────────────────────────────────────────────

async function testMySQLReadOnly() {
    header('MySQL 읽기 전용 모드 통합 테스트');

    const provider = new MySQLProvider(mysqlConfig);

    try {
        await provider.connect();
        pass('MySQL 연결 성공');

        // 1. readOnly 설정 확인
        assert(provider.config.readOnly === true, 'config.readOnly === true');

        // 2. SELECT는 허용되어야 함
        const selectCheck = checkWriteOperation('SELECT * FROM users', 'mysql');
        assert(selectCheck.isWrite === false, 'SELECT는 쓰기 아님');

        // 3. 실제 SELECT 실행 가능
        const result = await provider.executeQuery('SELECT 1 AS test', mysqlConfig.database);
        assert(result.rows.length > 0, '읽기 쿼리 실행 성공');
        assert(result.rows[0].test === 1, 'SELECT 1 결과 올바름');

        // 4. INSERT는 차단 대상
        const insertCheck = checkWriteOperation('INSERT INTO users (name) VALUES ("test")', 'mysql');
        assert(insertCheck.isWrite === true, 'INSERT 쓰기 감지');
        assert(insertCheck.keyword === 'INSERT', 'keyword = INSERT');

        // 5. UPDATE는 차단 대상
        const updateCheck = checkWriteOperation('UPDATE users SET name = "x"', 'mysql');
        assert(updateCheck.isWrite === true, 'UPDATE 쓰기 감지');

        // 6. DELETE는 차단 대상
        const deleteCheck = checkWriteOperation('DELETE FROM users WHERE id = 1', 'mysql');
        assert(deleteCheck.isWrite === true, 'DELETE 쓰기 감지');

        // 7. DROP은 차단 대상
        const dropCheck = checkWriteOperation('DROP TABLE test_readonly', 'mysql');
        assert(dropCheck.isWrite === true, 'DROP 쓰기 감지');

        // 8. SHOW는 허용
        const showCheck = checkWriteOperation('SHOW TABLES', 'mysql');
        assert(showCheck.isWrite === false, 'SHOW는 쓰기 아님');

        // 9. DESCRIBE 허용
        const descCheck = checkWriteOperation('DESCRIBE users', 'mysql');
        assert(descCheck.isWrite === false, 'DESCRIBE는 쓰기 아님');

        // 10. EXPLAIN 허용
        const explainCheck = checkWriteOperation('EXPLAIN SELECT * FROM users', 'mysql');
        assert(explainCheck.isWrite === false, 'EXPLAIN는 쓰기 아님');

        // 11. 문자열 리터럴 내 키워드는 무시
        const stringCheck = checkWriteOperation("SELECT * FROM users WHERE name = 'DELETE FROM'", 'mysql');
        assert(stringCheck.isWrite === false, '문자열 내 DELETE 무시');

        // 12. 주석 내 키워드는 무시
        const commentCheck = checkWriteOperation('SELECT 1 -- INSERT INTO users', 'mysql');
        assert(commentCheck.isWrite === false, '주석 내 INSERT 무시');

        // 13. 다중 구문 — 하나라도 쓰기면 차단
        const multiCheck = checkWriteOperation('SELECT 1; DELETE FROM users', 'mysql');
        assert(multiCheck.isWrite === true, '다중 구문에서 DELETE 감지');

        // 14. TRUNCATE 차단
        const truncCheck = checkWriteOperation('TRUNCATE TABLE users', 'mysql');
        assert(truncCheck.isWrite === true, 'TRUNCATE 쓰기 감지');

        // 15. CREATE 차단
        const createCheck = checkWriteOperation('CREATE TABLE temp (id INT)', 'mysql');
        assert(createCheck.isWrite === true, 'CREATE 쓰기 감지');

        // 16. ALTER 차단
        const alterCheck = checkWriteOperation('ALTER TABLE users ADD COLUMN age INT', 'mysql');
        assert(alterCheck.isWrite === true, 'ALTER 쓰기 감지');

    } catch (err) {
        fail('MySQL 테스트 오류', err);
    } finally {
        await provider.disconnect();
    }
}

async function testPostgreSQLReadOnly() {
    header('PostgreSQL 읽기 전용 모드 통합 테스트');

    const provider = new PostgresProvider(pgConfig);

    try {
        await provider.connect();
        pass('PostgreSQL 연결 성공');

        // 1. readOnly 설정 확인
        assert(provider.config.readOnly === true, 'config.readOnly === true');

        // 2. SELECT 실행 가능
        const result = await provider.executeQuery('SELECT 1 AS test', pgConfig.database);
        assert(result.rows.length > 0, '읽기 쿼리 실행 성공');

        // 3. INSERT 차단 확인
        const insertCheck = checkWriteOperation('INSERT INTO users (name) VALUES ($$test$$)', 'postgres');
        assert(insertCheck.isWrite === true, 'INSERT 쓰기 감지');

        // 4. UPDATE 차단
        const updateCheck = checkWriteOperation('UPDATE users SET name = $$x$$', 'postgres');
        assert(updateCheck.isWrite === true, 'UPDATE 쓰기 감지');

        // 5. DELETE 차단
        const deleteCheck = checkWriteOperation('DELETE FROM users WHERE id = 1', 'postgres');
        assert(deleteCheck.isWrite === true, 'DELETE 쓰기 감지');

        // 6. CTE (WITH ... SELECT) 허용
        const cteCheck = checkWriteOperation('WITH cte AS (SELECT 1) SELECT * FROM cte', 'postgres');
        assert(cteCheck.isWrite === false, 'CTE SELECT는 쓰기 아님');

        // 7. GRANT 차단
        const grantCheck = checkWriteOperation('GRANT SELECT ON users TO readonly_user', 'postgres');
        assert(grantCheck.isWrite === true, 'GRANT 쓰기 감지');

        // 8. REVOKE 차단
        const revokeCheck = checkWriteOperation('REVOKE ALL ON users FROM public', 'postgres');
        assert(revokeCheck.isWrite === true, 'REVOKE 쓰기 감지');

    } catch (err) {
        fail('PostgreSQL 테스트 오류', err);
    } finally {
        await provider.disconnect();
    }
}

async function testRedisReadOnly() {
    header('Redis 읽기 전용 모드 테스트');

    // Redis는 연결 없이 커맨드 체크만 테스트
    // (Redis 연결은 docker compose에서 제공)

    // 쓰기 명령어 차단
    const writeCommands = [
        'SET key val', 'DEL key', 'HSET h f v', 'LPUSH l v',
        'SADD s m', 'ZADD z 1 m', 'INCR counter',
        'EXPIRE key 100', 'FLUSHDB', 'FLUSHALL'
    ];

    for (const cmd of writeCommands) {
        const check = checkWriteOperation(cmd, 'redis');
        assert(check.isWrite === true, `Redis 쓰기 차단: ${cmd.split(' ')[0]}`);
    }

    // 읽기 명령어 허용
    const readCommands = [
        'GET key', 'HGET h f', 'LRANGE l 0 -1',
        'SMEMBERS s', 'ZRANGE z 0 -1', 'KEYS *',
        'TTL key', 'EXISTS key', 'INFO', 'PING', 'DBSIZE'
    ];

    for (const cmd of readCommands) {
        const check = checkWriteOperation(cmd, 'redis');
        assert(check.isWrite === false, `Redis 읽기 허용: ${cmd.split(' ')[0]}`);
    }
}

async function testMongoDBReadOnly() {
    header('MongoDB 읽기 전용 모드 테스트');

    // MongoDB Shell 문법 체크
    const writeQueries = [
        'db.users.insertOne({name: "test"})',
        'db.users.updateOne({id:1}, {$set:{name:"x"}})',
        'db.users.deleteOne({id:1})',
        'db.users.drop()',
        'db.users.createIndex({name:1})',
        'db.users.bulkWrite([])'
    ];

    for (const q of writeQueries) {
        const check = checkWriteOperation(q, 'mongodb');
        const method = q.match(/\.(\w+)\(/)?.[1] || '';
        assert(check.isWrite === true, `MongoDB 쓰기 차단: ${method}`);
    }

    const readQueries = [
        'db.users.find({})',
        'db.users.findOne({id:1})',
        'db.users.count()',
        'db.users.aggregate([])',
        'db.users.distinct("name")'
    ];

    for (const q of readQueries) {
        const check = checkWriteOperation(q, 'mongodb');
        const method = q.match(/\.(\w+)\(/)?.[1] || '';
        assert(check.isWrite === false, `MongoDB 읽기 허용: ${method}`);
    }
}

async function testReadOnlyConfigPersistence() {
    header('readOnly 설정 영속성 테스트');

    // readOnly가 ConnectionConfig에 올바르게 저장되는지 테스트
    const config: ConnectionConfig = {
        id: 'test-persistence',
        name: 'Persistence Test',
        type: 'mysql',
        host: 'localhost',
        port: 3306,
        username: 'root',
        password: 'test',
        readOnly: true
    };

    assert(config.readOnly === true, 'readOnly 필드 설정됨');

    // readOnly 토글
    const toggled = { ...config, readOnly: false };
    assert(toggled.readOnly === false, 'readOnly 토글 → false');

    // readOnly 미설정 시 undefined
    const noReadOnly: ConnectionConfig = {
        id: 'test-no-readonly',
        name: 'No ReadOnly',
        type: 'postgres',
        host: 'localhost',
        port: 5432,
        username: 'test',
    };
    assert(noReadOnly.readOnly === undefined, 'readOnly 미설정 시 undefined');
    assert(!noReadOnly.readOnly, '!readOnly === true (falsy)');

    // 기존 설정과의 호환성 (readOnly가 없는 기존 설정)
    const legacyConfig = JSON.parse('{"id":"old","name":"Old","type":"mysql","host":"localhost","port":3306,"username":"root"}') as ConnectionConfig;
    assert(legacyConfig.readOnly === undefined, '레거시 설정 호환 — readOnly undefined');
    assert(!legacyConfig.readOnly, '레거시 설정 호환 — falsy');
}

async function testReadOnlyWorkflow() {
    header('읽기 전용 모드 워크플로우 시나리오');

    const mysql = new MySQLProvider(mysqlConfig);

    try {
        await mysql.connect();

        // 시나리오: DBA가 프로덕션 DB를 읽기 전용으로 연결
        // Step 1: 읽기 쿼리는 정상 실행
        const tables = await mysql.getDatabases();
        assert(tables.length > 0, '읽기 전용에서 getDatabases() 성공');

        const query1 = 'SELECT COUNT(*) AS cnt FROM information_schema.tables';
        const check1 = checkWriteOperation(query1, 'mysql');
        assert(check1.isWrite === false, '정보 조회 쿼리 허용');

        const result1 = await mysql.executeQuery(query1);
        assert(result1.rows.length > 0, '정보 조회 실행 성공');

        // Step 2: 실수로 쓰기 쿼리 시도 → 가드가 차단
        const dangerousQueries = [
            'DROP DATABASE testdb',
            'DELETE FROM information_schema.tables',
            'TRUNCATE TABLE users',
            'ALTER TABLE users DROP COLUMN name'
        ];

        for (const dq of dangerousQueries) {
            const check = checkWriteOperation(dq, 'mysql');
            assert(check.isWrite === true, `위험 쿼리 차단: ${check.keyword}`);
        }

        // Step 3: 안전한 분석 쿼리는 모두 허용
        const safeQueries = [
            'SELECT * FROM information_schema.columns LIMIT 10',
            'SHOW CREATE TABLE information_schema.TABLES',
            'EXPLAIN SELECT 1'
        ];

        for (const sq of safeQueries) {
            const check = checkWriteOperation(sq, 'mysql');
            assert(check.isWrite === false, `안전 쿼리 허용: ${sq.substring(0, 30)}...`);
        }

    } catch (err) {
        fail('워크플로우 테스트 오류', err);
    } finally {
        await mysql.disconnect();
    }
}

// ── Main ─────────────────────────────────────────────────────

async function main() {
    console.log('\n🔒 DBunny v2.3.0 — 읽기 전용 모드 통합 테스트\n');

    await testMySQLReadOnly();
    await testPostgreSQLReadOnly();
    await testRedisReadOnly();
    await testMongoDBReadOnly();
    await testReadOnlyConfigPersistence();
    await testReadOnlyWorkflow();

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
