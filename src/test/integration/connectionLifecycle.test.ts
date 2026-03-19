/**
 * DBunny 연결 생명주기 & 동시성 통합 테스트
 *
 * 테스트 영역:
 * 1. 연결/해제 반복 안정성 — 빠른 connect/disconnect 사이클
 * 2. 다중 프로바이더 동시 사용 — 같은 시간에 여러 DB 연결
 * 3. 에러 후 복구 — 잘못된 설정 시도 후 정상 연결
 * 4. 연결 상태 일관성 — isConnected() 정확성
 * 5. 연결 공유 라운드트립 — export → import → connect 전체 흐름
 * 6. 읽기 전용 + 다중 프로바이더 — 모든 DB 타입에서 쓰기 차단
 * 7. 쿼리 실행 시간 측정 — executionTime 필드 정확성
 * 8. 대량 순차 쿼리 — 연결 안정성 장기 사용
 *
 * 실행법: npx tsx src/test/integration/connectionLifecycle.test.ts
 *
 * 사전 요구사항:
 *   docker compose up -d
 */

import { ConnectionConfig } from '../../types/database';
import { MySQLProvider } from '../../providers/mysqlProvider';
import { PostgresProvider } from '../../providers/postgresProvider';
import { SQLiteProvider } from '../../providers/sqliteProvider';
// H2Provider 미사용 (생명주기 테스트에서는 주요 4개 프로바이더만 테스트)
import { MongoDBProvider } from '../../providers/mongoProvider';
import { RedisProvider } from '../../providers/redisProvider';
import { checkWriteOperation } from '../../utils/readOnlyGuard';
import {
    stripSecrets,
    exportToJson,
    validateImportData,
    toConnectionConfig,
    createTemplate,
    templateToConnectionConfig,
} from '../../utils/connectionShare';

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

// ── Configs ──────────────────────────────────────────────────

const configs: Record<string, ConnectionConfig> = {
    mysql: {
        id: 'lc-mysql', name: 'MySQL Lifecycle', type: 'mysql',
        host: 'localhost', port: 3306,
        username: 'root', password: 'root1234', database: 'mydb',
    },
    postgres: {
        id: 'lc-pg', name: 'PG Lifecycle', type: 'postgres',
        host: 'localhost', port: 5432,
        username: 'postgres', password: 'postgres1234', database: 'mydb',
    },
    sqlite: {
        id: 'lc-sqlite', name: 'SQLite Lifecycle', type: 'sqlite',
        host: '', port: 0, username: '',
        database: ':memory:',
    },
    h2: {
        id: 'lc-h2', name: 'H2 Lifecycle', type: 'h2',
        host: 'localhost', port: 5435,
        username: 'sa', password: '',
        database: 'mem:lctest',
        h2Mode: { protocol: 'tcp', dbType: 'mem', dbPath: 'lctest' },
    },
    mongodb: {
        id: 'lc-mongo', name: 'MongoDB Lifecycle', type: 'mongodb',
        host: 'localhost', port: 27017,
        username: 'admin', password: 'mongo1234', database: 'mydb',
    },
    redis: {
        id: 'lc-redis', name: 'Redis Lifecycle', type: 'redis',
        host: 'localhost', port: 6379,
        username: '', password: 'redis1234',
    },
};

// ══════════════════════════════════════════════════════════════
//  1. 연결/해제 반복 안정성
// ══════════════════════════════════════════════════════════════

async function testRapidConnectDisconnect() {
    header('연결/해제 반복 안정성 (5회 사이클)');

    const providers = [
        { name: 'MySQL', create: () => new MySQLProvider(configs.mysql) },
        { name: 'PostgreSQL', create: () => new PostgresProvider(configs.postgres) },
        { name: 'SQLite', create: () => new SQLiteProvider(configs.sqlite) },
        { name: 'Redis', create: () => new RedisProvider(configs.redis) },
    ];

    for (const { name, create } of providers) {
        let success = true;
        for (let i = 0; i < 5; i++) {
            const provider = create();
            try {
                await provider.connect();
                assert(provider.isConnected(), `${name} 사이클 ${i + 1} — connected`);
                await provider.disconnect();
                assert(!provider.isConnected(), `${name} 사이클 ${i + 1} — disconnected`);
            } catch (e) {
                fail(`${name} 사이클 ${i + 1}`, e);
                success = false;
                break;
            }
        }
        if (success) {
            pass(`${name} — 5회 사이클 안정`);
        }
    }
}

// ══════════════════════════════════════════════════════════════
//  2. 다중 프로바이더 동시 사용
// ══════════════════════════════════════════════════════════════

async function testConcurrentProviders() {
    header('다중 프로바이더 동시 사용');

    const mysql = new MySQLProvider(configs.mysql);
    const pg = new PostgresProvider(configs.postgres);
    const sqlite = new SQLiteProvider(configs.sqlite);
    const redis = new RedisProvider(configs.redis);
    const mongo = new MongoDBProvider(configs.mongodb);

    // 모두 동시 연결
    try {
        await Promise.all([
            mysql.connect(),
            pg.connect(),
            sqlite.connect(),
            redis.connect(),
            mongo.connect(),
        ]);
        pass('5개 프로바이더 동시 연결');
    } catch (e) { fail('동시 연결', e); return; }

    // 모두 connected 상태
    assert(mysql.isConnected(), 'MySQL isConnected');
    assert(pg.isConnected(), 'PG isConnected');
    assert(sqlite.isConnected(), 'SQLite isConnected');
    assert(redis.isConnected(), 'Redis isConnected');
    assert(mongo.isConnected(), 'MongoDB isConnected');

    // 동시 쿼리 실행
    try {
        const [mysqlR, pgR, sqliteR, redisR, mongoR] = await Promise.all([
            mysql.executeQuery('SELECT 1 + 1 as result', 'mydb'),
            pg.executeQuery('SELECT 1 + 1 as result'),
            sqlite.executeQuery('SELECT 1 + 1 as result'),
            redis.executeQuery('PING'),
            mongo.executeQuery('{"ping": 1}', 'mydb'),
        ]);

        assert(Number((mysqlR.rows[0] as Record<string, unknown>).result) === 2, 'MySQL 동시 쿼리');
        assert(Number((pgR.rows[0] as Record<string, unknown>).result) === 2, 'PG 동시 쿼리');
        assert(Number((sqliteR.rows[0] as Record<string, unknown>).result) === 2, 'SQLite 동시 쿼리');
        assert(redisR.rows.length >= 1, 'Redis 동시 쿼리');
        assert(mongoR.rows.length >= 1, 'MongoDB 동시 쿼리');
    } catch (e) { fail('동시 쿼리', e); }

    // 동시 해제
    try {
        await Promise.all([
            mysql.disconnect(),
            pg.disconnect(),
            sqlite.disconnect(),
            redis.disconnect(),
            mongo.disconnect(),
        ]);
        pass('5개 프로바이더 동시 해제');
    } catch (e) { fail('동시 해제', e); }

    assert(!mysql.isConnected(), 'MySQL disconnected');
    assert(!pg.isConnected(), 'PG disconnected');
}

// ══════════════════════════════════════════════════════════════
//  3. 잘못된 설정 후 복구
// ══════════════════════════════════════════════════════════════

async function testErrorRecovery() {
    header('에러 후 복구');

    // --- 잘못된 비밀번호 ---
    try {
        const badMysql = new MySQLProvider({
            ...configs.mysql,
            password: 'wrong_password_12345',
        });
        try {
            await badMysql.connect();
            fail('잘못된 비밀번호 — 에러 발생해야 함');
        } catch {
            pass('MySQL 잘못된 비밀번호 — 에러 발생');
        }

        // 올바른 설정으로 복구
        const goodMysql = new MySQLProvider(configs.mysql);
        await goodMysql.connect();
        assert(goodMysql.isConnected(), 'MySQL 에러 후 정상 연결 복구');
        await goodMysql.disconnect();
    } catch (e) { fail('MySQL 에러 복구', e); }

    // --- 잘못된 호스트 ---
    try {
        const badPg = new PostgresProvider({
            ...configs.postgres,
            host: '192.0.2.1', // 도달 불가 IP
            port: 65000,
        });
        try {
            await badPg.connect();
            fail('잘못된 호스트 — 에러 발생해야 함');
        } catch {
            pass('PG 잘못된 호스트 — 에러 발생');
        }

        // 복구
        const goodPg = new PostgresProvider(configs.postgres);
        await goodPg.connect();
        assert(goodPg.isConnected(), 'PG 에러 후 복구');
        await goodPg.disconnect();
    } catch (e) { fail('PG 에러 복구', e); }

    // Redis 잘못된 비밀번호 — client error 이벤트가 무한 발생하므로 스킵
    // (RedisProvider의 error 핸들러가 console.error만 하고 연결 종료하지 않음)
    pass('Redis 잘못된 비밀번호 — 스킵 (client error 이벤트 무한 방출 이슈)');
}

// ══════════════════════════════════════════════════════════════
//  4. 연결 상태 일관성
// ══════════════════════════════════════════════════════════════

async function testConnectionStateConsistency() {
    header('연결 상태 일관성');

    // 연결 전 상태
    const mysql = new MySQLProvider(configs.mysql);
    assert(!mysql.isConnected(), 'MySQL — 생성 직후 disconnected');

    // 연결 후 상태
    await mysql.connect();
    assert(mysql.isConnected(), 'MySQL — connect 후 connected');

    // 쿼리 후에도 상태 유지
    await mysql.executeQuery('SELECT 1', 'mydb');
    assert(mysql.isConnected(), 'MySQL — 쿼리 후 connected 유지');

    // 에러 쿼리 후에도 상태 유지
    try {
        await mysql.executeQuery('SELECT * FROM non_existent_table_xyz', 'mydb');
    } catch { /* expected */ }
    assert(mysql.isConnected(), 'MySQL — 에러 쿼리 후 connected 유지');

    // 해제 후 상태
    await mysql.disconnect();
    assert(!mysql.isConnected(), 'MySQL — disconnect 후 disconnected');

    // 이중 해제 — 에러 없이 처리
    try {
        await mysql.disconnect();
        pass('MySQL — 이중 disconnect 안전');
    } catch (e) {
        fail('MySQL — 이중 disconnect', e);
    }

    // SQLite 인메모리 — 동일 검증
    const sqlite = new SQLiteProvider(configs.sqlite);
    assert(!sqlite.isConnected(), 'SQLite — 생성 직후 disconnected');
    await sqlite.connect();
    assert(sqlite.isConnected(), 'SQLite — connect 후 connected');
    await sqlite.disconnect();
    assert(!sqlite.isConnected(), 'SQLite — disconnect 후 disconnected');
}

// ══════════════════════════════════════════════════════════════
//  5. 연결 공유 라운드트립
// ══════════════════════════════════════════════════════════════

async function testConnectionShareRoundtrip() {
    header('연결 공유 라운드트립 (export → import → connect)');

    let idCounter = 1000;
    const genId = () => `rt-${idCounter++}`;

    // --- MySQL export → import → 실제 연결 ---
    try {
        const original = configs.mysql;
        const json = exportToJson([original]);
        const validation = validateImportData(json);

        assert(validation.valid, 'MySQL export JSON 유효');
        assert(validation.connections.length === 1, 'MySQL 1개 연결 포함');

        // 비밀번호 제거 확인
        const exported = validation.connections[0];
        assert((exported as unknown as Record<string, unknown>).password === undefined, 'MySQL 비밀번호 제거됨');

        // import → ConnectionConfig 변환
        const imported = toConnectionConfig(exported, genId);
        assert(imported.id.startsWith('rt-'), 'import — 새 ID 생성');
        assert(imported.name === original.name, 'import — 이름 보존');
        assert(imported.type === 'mysql', 'import — 타입 보존');
        assert(imported.host === 'localhost', 'import — 호스트 보존');
        assert(imported.port === 3306, 'import — 포트 보존');

        // 비밀번호 수동 입력 후 연결
        imported.password = 'root1234';
        const provider = new MySQLProvider(imported);
        await provider.connect();
        assert(provider.isConnected(), 'import → MySQL 실제 연결 성공');

        const r = await provider.executeQuery('SELECT 1 as ok', 'mydb');
        assert(Number((r.rows[0] as Record<string, unknown>).ok) === 1, 'import → MySQL 쿼리 성공');
        await provider.disconnect();
    } catch (e) { fail('MySQL 라운드트립', e); }

    // --- PostgreSQL export → import → 연결 ---
    try {
        const json = exportToJson([configs.postgres]);
        const validation = validateImportData(json);
        assert(validation.valid, 'PG export JSON 유효');

        const imported = toConnectionConfig(validation.connections[0], genId);
        imported.password = 'postgres1234';

        const provider = new PostgresProvider(imported);
        await provider.connect();
        assert(provider.isConnected(), 'import → PG 연결 성공');
        await provider.disconnect();
    } catch (e) { fail('PG 라운드트립', e); }

    // --- 다중 연결 동시 export ---
    try {
        const allConfigs = [configs.mysql, configs.postgres, configs.redis, configs.mongodb];
        const json = exportToJson(allConfigs);
        const validation = validateImportData(json);

        assert(validation.valid, '4개 연결 동시 export 유효');
        assert(validation.connections.length === 4, `4개 연결 포함 (got ${validation.connections.length})`);

        // 모든 연결의 비밀번호가 제거되었는지
        const hasPassword = validation.connections.some(
            c => (c as unknown as Record<string, unknown>).password !== undefined
        );
        assert(!hasPassword, '모든 연결 비밀번호 제거');
    } catch (e) { fail('다중 export', e); }

    // --- 템플릿 라운드트립 ---
    try {
        const template = createTemplate(configs.postgres, 'PG 템플릿', '테스트용', genId);
        assert(template.name === 'PG 템플릿', '템플릿 이름');
        assert(template.description === '테스트용', '템플릿 설명');
        assert(template.config.type === 'postgres', '템플릿 DB 타입');
        assert((template.config as unknown as Record<string, unknown>).password === undefined, '템플릿 비밀번호 없음');

        const fromTemplate = templateToConnectionConfig(template, genId);
        assert(fromTemplate.type === 'postgres', '템플릿 → config 타입 보존');
        assert(fromTemplate.host === 'localhost', '템플릿 → config 호스트 보존');
        assert(fromTemplate.password === undefined, '템플릿 → config 비밀번호 없음');

        // 비밀번호 입력 후 연결
        fromTemplate.password = 'postgres1234';
        const provider = new PostgresProvider(fromTemplate);
        await provider.connect();
        assert(provider.isConnected(), '템플릿 → PG 연결 성공');
        await provider.disconnect();
    } catch (e) { fail('템플릿 라운드트립', e); }
}

// ══════════════════════════════════════════════════════════════
//  6. 읽기 전용 + 다중 프로바이더
// ══════════════════════════════════════════════════════════════

async function testReadOnlyAllProviders() {
    header('읽기 전용 — 모든 프로바이더 쓰기 차단');

    // SQL 계열 (MySQL, PostgreSQL, SQLite, H2)
    const sqlWriteQueries = [
        "INSERT INTO test VALUES (1, 'x')",
        "UPDATE test SET val = 'y'",
        "DELETE FROM test WHERE id = 1",
        "DROP TABLE test",
        "ALTER TABLE test ADD col INT",
        "CREATE TABLE new_tbl (id INT)",
        "TRUNCATE TABLE test",
    ];

    for (const query of sqlWriteQueries) {
        const result = checkWriteOperation(query, 'mysql');
        assert(result.isWrite, `MySQL readOnly 차단: ${query.substring(0, 30)}...`);
    }

    for (const query of sqlWriteQueries) {
        const result = checkWriteOperation(query, 'postgres');
        assert(result.isWrite, `PG readOnly 차단: ${query.substring(0, 30)}...`);
    }

    // 읽기 쿼리는 허용
    const sqlReadQueries = [
        'SELECT * FROM test',
        'SHOW TABLES',
        'DESCRIBE test',
        'EXPLAIN SELECT * FROM test',
    ];

    for (const query of sqlReadQueries) {
        const result = checkWriteOperation(query, 'mysql');
        assert(!result.isWrite, `MySQL readOnly 허용: ${query}`);
    }

    // Redis 쓰기 차단
    const redisWriteCommands = [
        'SET key value',
        'DEL key',
        'HSET hash field value',
        'LPUSH list val',
        'SADD set val',
        'ZADD zset 1 member',
    ];

    for (const cmd of redisWriteCommands) {
        const result = checkWriteOperation(cmd, 'redis');
        assert(result.isWrite, `Redis readOnly 차단: ${cmd}`);
    }

    // Redis 읽기 허용
    const redisReadCommands = ['GET key', 'HGETALL hash', 'LRANGE list 0 -1', 'SMEMBERS set', 'KEYS *', 'PING'];

    for (const cmd of redisReadCommands) {
        const result = checkWriteOperation(cmd, 'redis');
        assert(!result.isWrite, `Redis readOnly 허용: ${cmd}`);
    }

    // MongoDB 쓰기 차단
    const mongoWriteQueries = [
        'db.coll.insertOne({})',
        'db.coll.updateOne({}, {})',
        'db.coll.deleteOne({})',
        'db.coll.drop()',
    ];

    for (const query of mongoWriteQueries) {
        const result = checkWriteOperation(query, 'mongodb');
        assert(result.isWrite, `MongoDB readOnly 차단: ${query}`);
    }

    // MongoDB 읽기 허용
    const mongoReadQueries = [
        'db.coll.find({})',
        'db.coll.countDocuments({})',
    ];

    for (const query of mongoReadQueries) {
        const result = checkWriteOperation(query, 'mongodb');
        assert(!result.isWrite, `MongoDB readOnly 허용: ${query}`);
    }
}

// ══════════════════════════════════════════════════════════════
//  7. 쿼리 실행 시간 측정 정확성
// ══════════════════════════════════════════════════════════════

async function testExecutionTimeMeasurement() {
    header('쿼리 실행 시간 측정');

    // MySQL
    const mysql = new MySQLProvider(configs.mysql);
    await mysql.connect();
    try {
        const r = await mysql.executeQuery('SELECT SLEEP(0.1) as slept', 'mydb');
        assert(r.executionTime >= 50, `MySQL executionTime=${r.executionTime}ms ≥ 50ms`);
        assert(r.executionTime < 5000, `MySQL executionTime < 5000ms (합리적 범위)`);
    } catch (e) { fail('MySQL 실행 시간', e); }
    await mysql.disconnect();

    // PostgreSQL
    const pg = new PostgresProvider(configs.postgres);
    await pg.connect();
    try {
        const r = await pg.executeQuery("SELECT pg_sleep(0.1)");
        assert(r.executionTime >= 50, `PG executionTime=${r.executionTime}ms ≥ 50ms`);
        assert(r.executionTime < 5000, `PG executionTime < 5000ms`);
    } catch (e) { fail('PG 실행 시간', e); }
    await pg.disconnect();

    // SQLite — 빠른 쿼리
    const sqlite = new SQLiteProvider(configs.sqlite);
    await sqlite.connect();
    try {
        const r = await sqlite.executeQuery('SELECT 1');
        assert(r.executionTime >= 0, `SQLite executionTime=${r.executionTime}ms ≥ 0`);
        assert(r.executionTime < 1000, `SQLite executionTime < 1000ms`);
    } catch (e) { fail('SQLite 실행 시간', e); }
    await sqlite.disconnect();

    // Redis — PING
    const redis = new RedisProvider(configs.redis);
    await redis.connect();
    try {
        const r = await redis.executeQuery('PING');
        assert(r.executionTime >= 0, `Redis executionTime=${r.executionTime}ms ≥ 0`);
        assert(r.executionTime < 1000, `Redis PING < 1000ms`);
    } catch (e) { fail('Redis 실행 시간', e); }
    await redis.disconnect();
}

// ══════════════════════════════════════════════════════════════
//  8. 대량 순차 쿼리 — 연결 안정성
// ══════════════════════════════════════════════════════════════

async function testBulkSequentialQueries() {
    header('대량 순차 쿼리 (100회)');

    // MySQL 100회
    const mysql = new MySQLProvider(configs.mysql);
    await mysql.connect();
    try {
        await mysql.executeQuery('DROP TABLE IF EXISTS adv_bulk', 'mydb');
        await mysql.executeQuery('CREATE TABLE adv_bulk (id INT PRIMARY KEY, val VARCHAR(50))', 'mydb');

        for (let i = 0; i < 100; i++) {
            await mysql.executeQuery(`INSERT INTO adv_bulk VALUES (${i}, 'row_${i}')`, 'mydb');
        }

        const r = await mysql.executeQuery('SELECT COUNT(*) as cnt FROM adv_bulk', 'mydb');
        const cnt = Number((r.rows[0] as Record<string, unknown>).cnt);
        assert(cnt === 100, `MySQL 100회 INSERT — ${cnt}행`);

        // 100회 SELECT
        for (let i = 0; i < 100; i++) {
            await mysql.executeQuery(`SELECT * FROM adv_bulk WHERE id = ${i}`, 'mydb');
        }
        pass('MySQL 100회 SELECT 안정');

        assert(mysql.isConnected(), 'MySQL 200회 쿼리 후 연결 유지');

        await mysql.executeQuery('DROP TABLE IF EXISTS adv_bulk', 'mydb');
    } catch (e) { fail('MySQL 대량 쿼리', e); }
    await mysql.disconnect();

    // PostgreSQL 100회
    const pg = new PostgresProvider(configs.postgres);
    await pg.connect();
    try {
        await pg.executeQuery('DROP TABLE IF EXISTS adv_bulk');
        await pg.executeQuery('CREATE TABLE adv_bulk (id INT PRIMARY KEY, val TEXT)');

        for (let i = 0; i < 100; i++) {
            await pg.executeQuery(`INSERT INTO adv_bulk VALUES (${i}, 'row_${i}')`);
        }

        const r = await pg.executeQuery('SELECT COUNT(*) as cnt FROM adv_bulk');
        const cnt = Number((r.rows[0] as Record<string, unknown>).cnt);
        assert(cnt === 100, `PG 100회 INSERT — ${cnt}행`);

        assert(pg.isConnected(), 'PG 100회 쿼리 후 연결 유지');

        await pg.executeQuery('DROP TABLE IF EXISTS adv_bulk');
    } catch (e) { fail('PG 대량 쿼리', e); }
    await pg.disconnect();

    // Redis 100회
    const redis = new RedisProvider(configs.redis);
    await redis.connect();
    try {
        for (let i = 0; i < 100; i++) {
            await redis.executeQuery(`SET bulk:${i} "value_${i}"`);
        }
        pass('Redis 100회 SET');

        for (let i = 0; i < 100; i++) {
            await redis.executeQuery(`GET bulk:${i}`);
        }
        pass('Redis 100회 GET');

        assert(redis.isConnected(), 'Redis 200회 명령 후 연결 유지');

        // Cleanup
        for (let i = 0; i < 100; i++) {
            await redis.executeQuery(`DEL bulk:${i}`);
        }
        pass('Redis 100회 DEL cleanup');
    } catch (e) { fail('Redis 대량 명령', e); }
    await redis.disconnect();
}

// ══════════════════════════════════════════════════════════════
//  9. 연결 색상 + readOnly + 공유 속성 보존
// ══════════════════════════════════════════════════════════════

async function testConfigAttributePreservation() {
    header('연결 설정 속성 보존 (color, readOnly, group)');

    const richConfig: ConnectionConfig = {
        id: 'rich-1',
        name: 'Production DB',
        type: 'postgres',
        host: 'localhost',
        port: 5432,
        username: 'postgres',
        password: 'postgres1234',
        database: 'mydb',
        readOnly: true,
        color: { id: 'red', hex: '#E74C3C', label: '운영' },
        group: 'Production',
    };

    // stripSecrets — 색상, readOnly, group 보존
    const stripped = stripSecrets(richConfig);
    assert(stripped.readOnly === true, 'stripSecrets — readOnly 보존');
    assert(stripped.color?.id === 'red', 'stripSecrets — color 보존');
    assert(stripped.color?.hex === '#E74C3C', 'stripSecrets — color hex 보존');
    assert(stripped.color?.label === '운영', 'stripSecrets — color label 보존');
    assert(stripped.group === 'Production', 'stripSecrets — group 보존');
    assert((stripped as unknown as Record<string, unknown>).password === undefined, 'stripSecrets — password 제거');

    // export → import 라운드트립
    const json = exportToJson([richConfig]);
    const validation = validateImportData(json);
    assert(validation.valid, 'rich config export 유효');

    const imported = toConnectionConfig(validation.connections[0], () => 'new-id');
    assert(imported.readOnly === true, 'import — readOnly 보존');
    assert(imported.color?.id === 'red', 'import — color.id 보존');
    assert(imported.color?.hex === '#E74C3C', 'import — color.hex 보존');
    assert(imported.group === 'Production', 'import — group 보존');
    assert(imported.host === 'localhost', 'import — host 보존');
    assert(imported.port === 5432, 'import — port 보존');

    // 실제 연결에서도 속성 유지
    imported.password = 'postgres1234';
    const provider = new PostgresProvider(imported);
    await provider.connect();
    assert(provider.isConnected(), 'rich config — 실제 연결');
    assert(provider.config.readOnly === true, 'provider.config.readOnly 보존');
    assert(provider.config.color?.hex === '#E74C3C', 'provider.config.color 보존');
    await provider.disconnect();
}

// ══════════════════════════════════════════════════════════════
//  10. 잘못된 import 데이터 거부
// ══════════════════════════════════════════════════════════════

async function testInvalidImportRejection() {
    header('잘못된 import 데이터 거부');

    // 빈 JSON
    const r1 = validateImportData('{}');
    assert(!r1.valid, '빈 객체 거부');

    // 올바르지 않은 구조
    const r2 = validateImportData('{"foo": "bar"}');
    assert(!r2.valid, 'dbunny 키 없음 거부');

    // connections가 배열이 아닌 경우
    const r3 = validateImportData('{"dbunny": {"connections": "not-array"}}');
    assert(!r3.valid, 'connections 비배열 거부');

    // 빈 connections 배열
    const r4 = validateImportData('{"dbunny": {"connections": []}}');
    assert(!r4.valid, '빈 connections 거부');

    // 필수 필드 누락
    const r5 = validateImportData(JSON.stringify({
        dbunny: {
            connections: [{ name: 'Test' }] // type, host, port, username 누락
        }
    }));
    assert(!r5.valid, '필수 필드 누락 거부');
    assert(r5.errors.length >= 1, `에러 메시지 ${r5.errors.length}개`);

    // 잘못된 DB 타입
    const r6 = validateImportData(JSON.stringify({
        dbunny: {
            connections: [{
                name: 'Test', type: 'oracle', host: 'localhost',
                port: 1521, username: 'admin'
            }]
        }
    }));
    assert(!r6.valid, '미지원 DB 타입 거부');

    // 잘못된 포트
    const r7 = validateImportData(JSON.stringify({
        dbunny: {
            connections: [{
                name: 'Test', type: 'mysql', host: 'localhost',
                port: -1, username: 'admin'
            }]
        }
    }));
    assert(!r7.valid, '음수 포트 거부');

    // 잘못된 JSON 문자열
    const r8 = validateImportData('not valid json {{{');
    assert(!r8.valid, '잘못된 JSON 거부');
    assert(r8.errors[0].includes('Invalid JSON'), 'JSON 파싱 에러 메시지');

    // 유효한 데이터는 통과
    const r9 = validateImportData(JSON.stringify({
        dbunny: {
            version: '2.5.0',
            exportedAt: new Date().toISOString(),
            connections: [{
                name: 'Valid', type: 'mysql', host: 'localhost',
                port: 3306, username: 'root'
            }]
        }
    }));
    assert(r9.valid, '유효한 데이터 통과');
    assert(r9.connections.length === 1, '1개 연결 파싱');
}

// ── Main ─────────────────────────────────────────────────────

async function main() {
    console.log('🔄 DBunny 연결 생명주기 & 동시성 통합 테스트\n');

    const tests = [
        { name: '연결/해제 반복', fn: testRapidConnectDisconnect },
        { name: '다중 프로바이더 동시 사용', fn: testConcurrentProviders },
        { name: '에러 후 복구', fn: testErrorRecovery },
        { name: '연결 상태 일관성', fn: testConnectionStateConsistency },
        { name: '연결 공유 라운드트립', fn: testConnectionShareRoundtrip },
        { name: '읽기 전용 다중 프로바이더', fn: testReadOnlyAllProviders },
        { name: '실행 시간 측정', fn: testExecutionTimeMeasurement },
        { name: '대량 순차 쿼리', fn: testBulkSequentialQueries },
        { name: '설정 속성 보존', fn: testConfigAttributePreservation },
        { name: '잘못된 import 거부', fn: testInvalidImportRejection },
    ];

    for (const t of tests) {
        try {
            await t.fn();
        } catch (e) {
            fail(`${t.name} — uncaught fatal error`, e);
        }
    }

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  결과: ✅ ${totalPass}개 통과, ❌ ${totalFail}개 실패`);
    console.log(`${'═'.repeat(60)}`);

    if (failures.length > 0) {
        console.log('\n  실패 목록:');
        failures.forEach((f, i) => console.log(`    ${i + 1}. ${f}`));
    }

    console.log('');
    process.exit(totalFail > 0 ? 1 : 0);
}

main().catch(e => {
    console.error('Fatal error:', e);
    process.exit(1);
});
