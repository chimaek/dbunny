/**
 * DBunny — 데이터베이스 선택 통합 테스트
 *
 * "No database selected" 이슈 해결 검증:
 * - config.database 없이 연결 후 database 파라미터로 쿼리 실행
 * - config.database 있는 연결에서 다른 데이터베이스로 전환
 * - Redis 'db' 접두사 호환성
 * - 각 프로바이더의 getDatabases() + executeQuery(query, database) 연동
 *
 * 실행법: npx tsx src/test/integration/databaseSelect.test.ts
 *
 * 사전 요구사항:
 *   docker compose up -d
 */

import { ConnectionConfig } from '../../types/database';
import { MySQLProvider } from '../../providers/mysqlProvider';
import { PostgresProvider } from '../../providers/postgresProvider';
import { RedisProvider } from '../../providers/redisProvider';

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

async function assert(condition: boolean, msg: string) {
    if (condition) { pass(msg); } else { fail(msg); }
}

// ── Configs ──────────────────────────────────────────────────

// config.database가 있는 일반 연결
const mysqlWithDb: ConnectionConfig = {
    id: 'test-mysql-db', name: 'MySQL with DB', type: 'mysql',
    host: 'localhost', port: 3306,
    username: 'root', password: 'root1234', database: 'mydb',
};

// config.database가 없는 연결 (이슈 시나리오)
const mysqlNoDb: ConnectionConfig = {
    id: 'test-mysql-nodb', name: 'MySQL no DB', type: 'mysql',
    host: 'localhost', port: 3306,
    username: 'root', password: 'root1234',
    // database 필드 없음!
};

const postgresWithDb: ConnectionConfig = {
    id: 'test-pg-db', name: 'PG with DB', type: 'postgres',
    host: 'localhost', port: 5432,
    username: 'postgres', password: 'postgres1234', database: 'mydb',
};

const postgresNoDb: ConnectionConfig = {
    id: 'test-pg-nodb', name: 'PG no DB', type: 'postgres',
    host: 'localhost', port: 5432,
    username: 'postgres', password: 'postgres1234',
    // database 필드 없음 → PostgreSQL 기본값 'postgres' 사용
};

const redisConfig: ConnectionConfig = {
    id: 'test-redis', name: 'Redis Test', type: 'redis',
    host: 'localhost', port: 16379,
    username: '', password: 'redis1234',
};

// ── MySQL Tests ──────────────────────────────────────────────

async function testMySQLWithDatabase() {
    header('MySQL — config.database 있는 경우');
    const provider = new MySQLProvider(mysqlWithDb);

    try {
        await provider.connect();
        pass('connect()');
    } catch (e) { fail('connect()', e); return; }

    // getDatabases: 목록에 mydb 포함
    try {
        const dbs = await provider.getDatabases();
        await assert(dbs.includes('mydb'), `getDatabases()에 mydb 포함 — ${dbs.length}개`);
        await assert(dbs.includes('information_schema'), `getDatabases()에 information_schema 포함`);
    } catch (e) { fail('getDatabases()', e); }

    // database 파라미터 없이 쿼리 — config.database로 동작
    try {
        const r = await provider.executeQuery('SELECT COUNT(*) as cnt FROM users');
        const cnt = Number(r.rows[0]?.cnt);
        await assert(cnt > 0, `database 파라미터 없이 쿼리 성공 — users ${cnt}행`);
    } catch (e) { fail('database 파라미터 없이 쿼리', e); }

    // database 파라미터 명시적으로 전달
    try {
        const r = await provider.executeQuery('SELECT COUNT(*) as cnt FROM users', 'mydb');
        const cnt = Number(r.rows[0]?.cnt);
        await assert(cnt > 0, `database='mydb' 명시 — users ${cnt}행`);
    } catch (e) { fail("database='mydb' 명시 쿼리", e); }

    // 다른 데이터베이스로 전환 (information_schema)
    try {
        const r = await provider.executeQuery(
            "SELECT COUNT(*) as cnt FROM TABLES WHERE TABLE_SCHEMA = 'mydb'",
            'information_schema'
        );
        const cnt = Number(r.rows[0]?.cnt);
        await assert(cnt > 0, `information_schema로 전환 — mydb 테이블 ${cnt}개`);
    } catch (e) { fail('information_schema 전환', e); }

    // 전환 후 다시 mydb로 돌아와서 쿼리
    try {
        const r = await provider.executeQuery('SELECT 1 as ok FROM users LIMIT 1', 'mydb');
        await assert(r.rows.length === 1, 'mydb로 복귀 쿼리 성공');
    } catch (e) { fail('mydb 복귀 쿼리', e); }

    await provider.disconnect();
}

async function testMySQLWithoutDatabase() {
    header('MySQL — config.database 없는 경우 (이슈 시나리오)');
    const provider = new MySQLProvider(mysqlNoDb);

    try {
        await provider.connect();
        pass('config.database 없이 connect() 성공');
    } catch (e) { fail('connect()', e); return; }

    // database 파라미터 없이 쿼리 → "No database selected" 에러
    try {
        await provider.executeQuery('SELECT * FROM users');
        fail('database 없이 쿼리가 성공하면 안됨');
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await assert(
            msg.includes('No database selected'),
            `예상대로 "No database selected" 에러 발생`
        );
    }

    // database 파라미터로 'mydb' 전달 → 성공 (수정된 코드가 해결하는 핵심)
    try {
        const r = await provider.executeQuery('SELECT COUNT(*) as cnt FROM users', 'mydb');
        const cnt = Number(r.rows[0]?.cnt);
        await assert(cnt > 0, `database='mydb' 전달 시 쿼리 성공 — users ${cnt}행`);
        pass('🎯 "No database selected" 이슈 해결 확인');
    } catch (e) { fail('database 파라미터 전달 쿼리 (핵심 이슈)', e); }

    // getDatabases() → 결과에서 DB 선택 가능
    try {
        const dbs = await provider.getDatabases();
        await assert(dbs.includes('mydb'), `getDatabases()에서 mydb 확인 가능 — ${dbs.length}개`);

        // 첫 번째 DB로 쿼리 실행 (드롭다운 자동 선택 시뮬레이션)
        const firstDb = dbs.find(d => d === 'mydb') || dbs[0];
        const r = await provider.executeQuery('SELECT 1 as ok', firstDb);
        await assert(r.rows.length === 1, `getDatabases() 결과로 쿼리 실행 성공 (db: ${firstDb})`);
    } catch (e) { fail('getDatabases → 쿼리 실행', e); }

    // information_schema로 SHOW TABLES 쿼리
    try {
        const r = await provider.executeQuery(
            "SELECT TABLE_NAME FROM TABLES WHERE TABLE_SCHEMA = 'mydb' LIMIT 5",
            'information_schema'
        );
        await assert(r.rows.length > 0, `information_schema 쿼리 성공 — ${r.rows.length}개 테이블`);
    } catch (e) { fail('information_schema 쿼리', e); }

    await provider.disconnect();
}

async function testMySQLDatabaseSwitch() {
    header('MySQL — 데이터베이스 전환 연속 테스트');
    const provider = new MySQLProvider(mysqlNoDb);

    try {
        await provider.connect();
        pass('connect()');
    } catch (e) { fail('connect()', e); return; }

    // mydb → information_schema → mydb 연속 전환
    try {
        // 1. mydb
        const r1 = await provider.executeQuery('SELECT DATABASE() as db', 'mydb');
        const db1 = String(r1.rows[0]?.db);
        await assert(db1 === 'mydb', `1차 전환: mydb — 현재 DB = ${db1}`);

        // 2. information_schema
        const r2 = await provider.executeQuery('SELECT DATABASE() as db', 'information_schema');
        const db2 = String(r2.rows[0]?.db);
        await assert(db2 === 'information_schema', `2차 전환: information_schema — 현재 DB = ${db2}`);

        // 3. 다시 mydb
        const r3 = await provider.executeQuery('SELECT DATABASE() as db', 'mydb');
        const db3 = String(r3.rows[0]?.db);
        await assert(db3 === 'mydb', `3차 전환: mydb 복귀 — 현재 DB = ${db3}`);

        // 4. mysql 시스템 DB
        const r4 = await provider.executeQuery('SELECT DATABASE() as db', 'mysql');
        const db4 = String(r4.rows[0]?.db);
        await assert(db4 === 'mysql', `4차 전환: mysql — 현재 DB = ${db4}`);
    } catch (e) { fail('연속 DB 전환', e); }

    // 전환 후 상태 유지 검증: database 파라미터 없이 쿼리하면 마지막 전환된 DB 사용
    try {
        await provider.executeQuery('SELECT 1', 'mydb'); // mydb로 전환
        const r = await provider.executeQuery('SELECT DATABASE() as db');
        const currentDb = String(r.rows[0]?.db);
        await assert(currentDb === 'mydb', `USE 후 상태 유지 — 현재 DB = ${currentDb}`);
    } catch (e) { fail('DB 전환 상태 유지', e); }

    await provider.disconnect();
}

// ── PostgreSQL Tests ─────────────────────────────────────────

async function testPostgresWithDatabase() {
    header('PostgreSQL — config.database 있는 경우');
    const provider = new PostgresProvider(postgresWithDb);

    try {
        await provider.connect();
        pass('connect()');
    } catch (e) { fail('connect()', e); return; }

    // getDatabases
    try {
        const dbs = await provider.getDatabases();
        await assert(dbs.includes('mydb'), `getDatabases()에 mydb 포함`);
        await assert(dbs.includes('postgres'), `getDatabases()에 postgres 포함`);
    } catch (e) { fail('getDatabases()', e); }

    // database 파라미터 없이 쿼리 — config.database로 동작
    try {
        const r = await provider.executeQuery('SELECT COUNT(*) as cnt FROM users');
        const cnt = Number(r.rows[0]?.cnt);
        await assert(cnt > 0, `database 파라미터 없이 쿼리 성공 — users ${cnt}행`);
    } catch (e) { fail('database 파라미터 없이 쿼리', e); }

    // 같은 DB 명시
    try {
        const r = await provider.executeQuery('SELECT COUNT(*) as cnt FROM users', 'mydb');
        const cnt = Number(r.rows[0]?.cnt);
        await assert(cnt > 0, `database='mydb' 명시 — users ${cnt}행`);
    } catch (e) { fail("database='mydb' 명시 쿼리", e); }

    await provider.disconnect();
}

async function testPostgresWithoutDatabase() {
    header('PostgreSQL — config.database 없는 경우');
    const provider = new PostgresProvider(postgresNoDb);

    try {
        await provider.connect();
        pass('config.database 없이 connect() 성공 (기본 postgres DB)');
    } catch (e) { fail('connect()', e); return; }

    // postgres DB에서 쿼리 (기본 DB)
    try {
        const r = await provider.executeQuery('SELECT current_database() as db');
        const currentDb = String(r.rows[0]?.db);
        await assert(currentDb === 'postgres', `기본 DB는 postgres — 현재 DB = ${currentDb}`);
    } catch (e) { fail('기본 DB 확인', e); }

    // mydb로 database 파라미터 전달 (PostgreSQL은 임시 연결 생성)
    try {
        const r = await provider.executeQuery('SELECT COUNT(*) as cnt FROM users', 'mydb');
        const cnt = Number(r.rows[0]?.cnt);
        await assert(cnt > 0, `database='mydb' 임시 연결로 쿼리 성공 — users ${cnt}행`);
    } catch (e) { fail('mydb 임시 연결 쿼리', e); }

    // getDatabases
    try {
        const dbs = await provider.getDatabases();
        await assert(dbs.includes('mydb'), `getDatabases()에 mydb 포함 — ${dbs.length}개`);
    } catch (e) { fail('getDatabases()', e); }

    await provider.disconnect();
}

// ── Redis Tests ──────────────────────────────────────────────

async function testRedis() {
    header('Redis — db 접두사 호환성');
    const provider = new RedisProvider(redisConfig);

    try {
        await provider.connect();
        pass('connect()');
    } catch (e) { fail('connect()', e); return; }

    // getDatabases → 'db0'~'db15'
    try {
        const dbs = await provider.getDatabases();
        await assert(dbs.length === 16, `getDatabases() — ${dbs.length}개`);
        await assert(dbs[0] === 'db0', `첫 번째: ${dbs[0]}`);
        await assert(dbs[15] === 'db15', `마지막: ${dbs[15]}`);
    } catch (e) { fail('getDatabases()', e); }

    // 'db0'에서 키 설정
    try {
        await provider.executeQuery('SET dbselect:test "hello"', 'db0');
        const r = await provider.executeQuery('GET dbselect:test', 'db0');
        const val = String(r.rows[0]?.value ?? r.rows[0]?.result ?? '');
        await assert(val.includes('hello'), `db0에서 SET/GET 성공 — value='${val}'`);
    } catch (e) { fail('db0 SET/GET', e); }

    // 'db1'로 전환 후 동일 키 조회 → 없어야 함 (다른 DB)
    try {
        await provider.executeQuery('SELECT 1'); // db1으로 전환
        const r = await provider.executeQuery('GET dbselect:test');
        const val = r.rows[0]?.value ?? r.rows[0]?.result;
        // db1에는 해당 키가 없으므로 null, 빈 값, 또는 '(nil)' 반환
        await assert(val === null || val === '' || val === 'nil' || val === '(nil)' || val === undefined,
            `db1에서 키 없음 확인 — value='${val}'`);
    } catch (e) { fail('db1에서 키 격리 확인', e); }

    // getDatabases() 결과의 'db' 접두사를 executeQuery에 그대로 전달해도 동작
    try {
        await provider.executeQuery('SET dbselect:test2 "world"', 'db0');
        const r = await provider.executeQuery('GET dbselect:test2', 'db0');
        const val = String(r.rows[0]?.value ?? r.rows[0]?.result ?? '');
        await assert(val.includes('world'), `'db0' 접두사 전달 정상 동작 — value='${val}'`);
        pass('🎯 Redis db 접두사 호환성 확인');
    } catch (e) { fail('db 접두사 호환성', e); }

    // 숫자만 전달 (기존 호환성)
    try {
        // '0'을 전달해도 동작해야 함
        const r = await provider.executeQuery('GET dbselect:test', '0');
        const val = String(r.rows[0]?.value ?? r.rows[0]?.result ?? '');
        await assert(val.includes('hello'), `숫자 '0' 직접 전달도 동작 — value='${val}'`);
    } catch (e) { fail('숫자 직접 전달', e); }

    // 정리
    try {
        await provider.executeQuery('DEL dbselect:test dbselect:test2', 'db0');
        pass('테스트 키 정리');
    } catch (e) { fail('키 정리', e); }

    await provider.disconnect();
}

// ── executeQuery와 database 파라미터 경계 테스트 ─────────────

async function testEdgeCases() {
    header('경계 케이스');
    const provider = new MySQLProvider(mysqlWithDb);

    try {
        await provider.connect();
        pass('connect()');
    } catch (e) { fail('connect()', e); return; }

    // undefined 전달 → config.database 사용
    try {
        await provider.executeQuery('SELECT DATABASE() as db', undefined);
        // undefined이면 USE 실행 안 함 → 이전 상태(config.database) 유지
        pass('database=undefined 전달 시 에러 없음');
    } catch (e) { fail('database=undefined', e); }

    // 빈 문자열 전달 → falsy이므로 USE 실행 안 함
    try {
        await provider.executeQuery('SELECT DATABASE() as db', '');
        pass("database='' 전달 시 에러 없음");
    } catch (e) { fail("database=''", e); }

    // 존재하지 않는 DB → 에러
    try {
        await provider.executeQuery('SELECT 1', 'nonexistent_database_xyz');
        fail('존재하지 않는 DB에서 쿼리 성공하면 안됨');
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await assert(
            msg.includes('Unknown database') || msg.includes('nonexistent'),
            `존재하지 않는 DB → 에러 정상 — ${msg.substring(0, 60)}`
        );
    }

    // 에러 후 복구: 다시 유효한 DB로 쿼리 가능
    try {
        const r = await provider.executeQuery('SELECT DATABASE() as db', 'mydb');
        const db = String(r.rows[0]?.db);
        await assert(db === 'mydb', `에러 후 복구 — 현재 DB = ${db}`);
    } catch (e) { fail('에러 후 복구', e); }

    // 특수문자 포함 DB 이름 시도 (SQL injection 방어)
    try {
        await provider.executeQuery('SELECT 1', "mydb`; DROP TABLE users; --");
        // 백틱으로 감싸져 있으므로 injection은 실패하고 에러 발생
        fail('SQL injection 시도가 성공하면 안됨');
    } catch {
        pass('SQL injection 시도 차단됨');
    }

    await provider.disconnect();
}

// ── Main ─────────────────────────────────────────────────────

async function main() {
    console.log('🐰 DBunny Database Select Integration Test');
    console.log(`   시작: ${new Date().toLocaleTimeString()}`);

    const tests = [
        { name: 'MySQL (with database)', fn: testMySQLWithDatabase },
        { name: 'MySQL (no database - 이슈)', fn: testMySQLWithoutDatabase },
        { name: 'MySQL (DB switch)', fn: testMySQLDatabaseSwitch },
        { name: 'PostgreSQL (with database)', fn: testPostgresWithDatabase },
        { name: 'PostgreSQL (no database)', fn: testPostgresWithoutDatabase },
        { name: 'Redis (db prefix)', fn: testRedis },
        { name: 'Edge Cases', fn: testEdgeCases },
    ];

    for (const t of tests) {
        try {
            await t.fn();
        } catch (e) {
            fail(`${t.name} — uncaught fatal error`, e);
        }
    }

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  RESULTS: ✅ ${totalPass} passed, ❌ ${totalFail} failed`);
    console.log(`${'═'.repeat(60)}`);

    if (failures.length > 0) {
        console.log('\n  Failures:');
        failures.forEach((f, i) => console.log(`    ${i + 1}. ${f}`));
    }

    console.log('');
    process.exit(totalFail > 0 ? 1 : 0);
}

main().catch(e => {
    console.error('Fatal error:', e);
    process.exit(1);
});
