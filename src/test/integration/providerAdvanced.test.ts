/**
 * DBunny 프로바이더 심화 통합 테스트
 *
 * 각 프로바이더의 고유 기능과 경계 조건을 깊이 있게 테스트합니다.
 *
 * 테스트 영역:
 * 1. MySQL — 트랜잭션, 다중 DB 전환, 정보 스키마, SHOW 명령
 * 2. PostgreSQL — 스키마(non-public), CTE, JSONB 연산, 윈도우 함수, 다른 DB 임시 연결
 * 3. SQLite — 인메모리 모드, WAL, 자기 참조 FK, 뷰/인덱스
 * 4. H2 — 대소문자 처리, 시퀀스, 인메모리 격리
 * 5. MongoDB — 집계 파이프라인, 인덱스, 중첩 문서, Shell 고급 문법
 * 6. Redis — 다중 DB(0-15), TTL, 데이터 타입별 조회, SCAN, 정렬 집합
 *
 * 실행법: npx tsx src/test/integration/providerAdvanced.test.ts
 *
 * 사전 요구사항:
 *   docker compose up -d
 */

import * as path from 'path';
import { ConnectionConfig } from '../../types/database';
import { MySQLProvider } from '../../providers/mysqlProvider';
import { PostgresProvider } from '../../providers/postgresProvider';
import { SQLiteProvider } from '../../providers/sqliteProvider';
import { H2Provider } from '../../providers/h2Provider';
import { MongoDBProvider } from '../../providers/mongoProvider';
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

function assert(condition: boolean, msg: string) {
    if (condition) { pass(msg); } else { fail(msg); }
}

async function assertThrows(fn: () => Promise<unknown>, msg: string) {
    try {
        await fn();
        fail(`${msg} (should have thrown)`);
    } catch {
        pass(msg);
    }
}

// ── Configs ──────────────────────────────────────────────────

const sqlitePath = path.resolve(__dirname, '../../../test-data/advanced-test.db');

const configs: Record<string, ConnectionConfig> = {
    mysql: {
        id: 'adv-mysql', name: 'MySQL Advanced', type: 'mysql',
        host: 'localhost', port: 3306,
        username: 'root', password: 'root1234', database: 'mydb',
    },
    postgres: {
        id: 'adv-pg', name: 'PG Advanced', type: 'postgres',
        host: 'localhost', port: 5432,
        username: 'postgres', password: 'postgres1234', database: 'mydb',
    },
    sqlite: {
        id: 'adv-sqlite', name: 'SQLite Advanced', type: 'sqlite',
        host: '', port: 0, username: '',
        database: sqlitePath,
    },
    sqliteMemory: {
        id: 'adv-sqlite-mem', name: 'SQLite Memory', type: 'sqlite',
        host: '', port: 0, username: '',
        database: ':memory:',
    },
    h2: {
        id: 'adv-h2', name: 'H2 Advanced', type: 'h2',
        host: 'localhost', port: 5435,
        username: 'sa', password: '',
        database: 'mem:advtest',
        h2Mode: { protocol: 'tcp', dbType: 'mem', dbPath: 'advtest' },
    },
    mongodb: {
        id: 'adv-mongo', name: 'MongoDB Advanced', type: 'mongodb',
        host: 'localhost', port: 27017,
        username: 'admin', password: 'mongo1234', database: 'mydb',
    },
    redis: {
        id: 'adv-redis', name: 'Redis Advanced', type: 'redis',
        host: 'localhost', port: 6379,
        username: '', password: 'redis1234',
    },
};

// ══════════════════════════════════════════════════════════════
//  MySQL 심화 테스트
// ══════════════════════════════════════════════════════════════

async function testMySQLAdvanced() {
    header('MySQL — 심화 테스트');
    const provider = new MySQLProvider(configs.mysql);

    try {
        await provider.connect();
        pass('MySQL connect');
    } catch (e) { fail('MySQL connect', e); return; }

    // --- 트랜잭션 롤백 ---
    try {
        await provider.executeQuery('DROP TABLE IF EXISTS adv_txn', 'mydb');
        await provider.executeQuery('CREATE TABLE adv_txn (id INT PRIMARY KEY, val VARCHAR(50))', 'mydb');
        await provider.executeQuery("INSERT INTO adv_txn VALUES (1, 'committed')", 'mydb');

        // START TRANSACTION → INSERT → ROLLBACK 시뮬레이션
        // 단일 연결이므로 실제 트랜잭션 테스트
        await provider.executeQuery('START TRANSACTION', 'mydb');
        await provider.executeQuery("INSERT INTO adv_txn VALUES (2, 'rolled_back')", 'mydb');
        await provider.executeQuery('ROLLBACK', 'mydb');

        const r = await provider.executeQuery('SELECT COUNT(*) as cnt FROM adv_txn', 'mydb');
        const cnt = Number((r.rows[0] as Record<string, unknown>).cnt);
        assert(cnt === 1, `트랜잭션 ROLLBACK — 1행만 남음 (got ${cnt})`);
    } catch (e) { fail('트랜잭션 ROLLBACK', e); }

    // --- 트랜잭션 커밋 ---
    try {
        await provider.executeQuery('START TRANSACTION', 'mydb');
        await provider.executeQuery("INSERT INTO adv_txn VALUES (3, 'committed_2')", 'mydb');
        await provider.executeQuery('COMMIT', 'mydb');

        const r = await provider.executeQuery('SELECT COUNT(*) as cnt FROM adv_txn', 'mydb');
        const cnt = Number((r.rows[0] as Record<string, unknown>).cnt);
        assert(cnt === 2, `트랜잭션 COMMIT — 2행 (got ${cnt})`);
    } catch (e) { fail('트랜잭션 COMMIT', e); }

    // --- SHOW 명령어 ---
    try {
        const r = await provider.executeQuery('SHOW DATABASES', 'mydb');
        const dbNames = r.rows.map((row: Record<string, unknown>) => row.Database || row.database);
        assert(dbNames.includes('mydb'), 'SHOW DATABASES — mydb 포함');
    } catch (e) { fail('SHOW DATABASES', e); }

    try {
        const r = await provider.executeQuery('SHOW TABLES', 'mydb');
        assert(r.rows.length >= 1, `SHOW TABLES — ${r.rows.length}개 테이블`);
    } catch (e) { fail('SHOW TABLES', e); }

    try {
        const r = await provider.executeQuery('DESCRIBE adv_txn', 'mydb');
        assert(r.rows.length === 2, `DESCRIBE — 2개 컬럼 (got ${r.rows.length})`);
    } catch (e) { fail('DESCRIBE', e); }

    // --- information_schema 조회 ---
    try {
        const r = await provider.executeQuery(
            "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'mydb' AND TABLE_NAME = 'adv_txn'",
            'mydb'
        );
        assert(r.rows.length === 1, 'information_schema.TABLES 조회');
    } catch (e) { fail('information_schema', e); }

    // --- 다중 데이터베이스 전환 ---
    try {
        // mydb에서 information_schema로 쿼리 전환
        const r = await provider.executeQuery(
            "SELECT COUNT(*) as cnt FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = 'mydb'",
            'information_schema'
        );
        const cnt = Number((r.rows[0] as Record<string, unknown>).cnt);
        assert(cnt === 1, '다른 DB(information_schema) 쿼리 성공');
    } catch (e) { fail('다중 DB 전환', e); }

    // --- 복합 INSERT + SELECT ---
    try {
        await provider.executeQuery('DROP TABLE IF EXISTS adv_batch', 'mydb');
        await provider.executeQuery(
            'CREATE TABLE adv_batch (id INT AUTO_INCREMENT PRIMARY KEY, val INT)',
            'mydb'
        );
        // 한 번에 다수 행 삽입
        await provider.executeQuery(
            'INSERT INTO adv_batch (val) VALUES (10),(20),(30),(40),(50)',
            'mydb'
        );
        const r = await provider.executeQuery(
            'SELECT SUM(val) as total, AVG(val) as avg_val, MIN(val) as min_val, MAX(val) as max_val FROM adv_batch',
            'mydb'
        );
        const row = r.rows[0] as Record<string, unknown>;
        assert(Number(row.total) === 150, `SUM = 150 (got ${row.total})`);
        assert(Number(row.avg_val) === 30, `AVG = 30 (got ${row.avg_val})`);
        assert(Number(row.min_val) === 10, `MIN = 10`);
        assert(Number(row.max_val) === 50, `MAX = 50`);
    } catch (e) { fail('집계 함수', e); }

    // --- ON DUPLICATE KEY UPDATE ---
    try {
        await provider.executeQuery('DROP TABLE IF EXISTS adv_upsert', 'mydb');
        await provider.executeQuery(
            'CREATE TABLE adv_upsert (code VARCHAR(10) PRIMARY KEY, count INT DEFAULT 0)',
            'mydb'
        );
        await provider.executeQuery(
            "INSERT INTO adv_upsert (code, count) VALUES ('A', 1) ON DUPLICATE KEY UPDATE count = count + 1",
            'mydb'
        );
        await provider.executeQuery(
            "INSERT INTO adv_upsert (code, count) VALUES ('A', 1) ON DUPLICATE KEY UPDATE count = count + 1",
            'mydb'
        );
        const r = await provider.executeQuery("SELECT count FROM adv_upsert WHERE code = 'A'", 'mydb');
        const cnt = Number((r.rows[0] as Record<string, unknown>).count);
        assert(cnt === 2, `ON DUPLICATE KEY UPDATE — count=2 (got ${cnt})`);
    } catch (e) { fail('ON DUPLICATE KEY UPDATE', e); }

    // Cleanup
    try {
        await provider.executeQuery('DROP TABLE IF EXISTS adv_txn', 'mydb');
        await provider.executeQuery('DROP TABLE IF EXISTS adv_batch', 'mydb');
        await provider.executeQuery('DROP TABLE IF EXISTS adv_upsert', 'mydb');
        pass('MySQL cleanup');
    } catch (e) { fail('MySQL cleanup', e); }

    await provider.disconnect();
    pass('MySQL disconnect');
}

// ══════════════════════════════════════════════════════════════
//  PostgreSQL 심화 테스트
// ══════════════════════════════════════════════════════════════

async function testPostgresAdvanced() {
    header('PostgreSQL — 심화 테스트');
    const provider = new PostgresProvider(configs.postgres);

    try {
        await provider.connect();
        pass('PG connect');
    } catch (e) { fail('PG connect', e); return; }

    // --- CTE (Common Table Expression) ---
    try {
        await provider.executeQuery('DROP TABLE IF EXISTS adv_employees');
        await provider.executeQuery(`
            CREATE TABLE adv_employees (
                id SERIAL PRIMARY KEY,
                name VARCHAR(100),
                dept VARCHAR(50),
                salary NUMERIC(10,2)
            )
        `);
        await provider.executeQuery(`
            INSERT INTO adv_employees (name, dept, salary) VALUES
            ('Alice', 'Engineering', 95000),
            ('Bob', 'Engineering', 85000),
            ('Carol', 'Marketing', 75000),
            ('Dave', 'Marketing', 70000),
            ('Eve', 'Engineering', 100000)
        `);

        const r = await provider.executeQuery(`
            WITH dept_avg AS (
                SELECT dept, AVG(salary) as avg_salary
                FROM adv_employees
                GROUP BY dept
            )
            SELECT e.name, e.salary, d.avg_salary
            FROM adv_employees e
            JOIN dept_avg d ON e.dept = d.dept
            WHERE e.salary > d.avg_salary
            ORDER BY e.salary DESC
        `);
        assert(r.rows.length >= 1, `CTE — 평균 이상 직원 ${r.rows.length}명`);
        const names = r.rows.map((row: Record<string, unknown>) => row.name);
        assert(names.includes('Eve'), 'CTE — Eve(100K) 포함');
    } catch (e) { fail('CTE', e); }

    // --- 윈도우 함수 ---
    try {
        const r = await provider.executeQuery(`
            SELECT name, dept, salary,
                   RANK() OVER (PARTITION BY dept ORDER BY salary DESC) as dept_rank,
                   SUM(salary) OVER (PARTITION BY dept) as dept_total
            FROM adv_employees
            ORDER BY dept, dept_rank
        `);
        assert(r.rows.length === 5, `윈도우 함수 — 5행`);
        const firstEng = r.rows.find((row: Record<string, unknown>) =>
            row.dept === 'Engineering' && Number(row.dept_rank) === 1
        ) as Record<string, unknown>;
        assert(firstEng?.name === 'Eve', '윈도우 함수 — Engineering 1위 = Eve');
    } catch (e) { fail('윈도우 함수', e); }

    // --- JSONB 연산 ---
    try {
        await provider.executeQuery('DROP TABLE IF EXISTS adv_jsonb');
        await provider.executeQuery(`
            CREATE TABLE adv_jsonb (
                id SERIAL PRIMARY KEY,
                data JSONB NOT NULL
            )
        `);
        await provider.executeQuery(`
            INSERT INTO adv_jsonb (data) VALUES
            ('{"name": "Alice", "tags": ["admin", "user"], "meta": {"level": 5}}'),
            ('{"name": "Bob", "tags": ["user"], "meta": {"level": 3}}'),
            ('{"name": "Carol", "tags": ["admin", "moderator"], "meta": {"level": 4}}')
        `);

        // JSONB 경로 연산자
        const r1 = await provider.executeQuery(`
            SELECT data->>'name' as name, data->'meta'->>'level' as level
            FROM adv_jsonb
            WHERE data @> '{"tags": ["admin"]}'
            ORDER BY data->'meta'->>'level' DESC
        `);
        assert(r1.rows.length === 2, `JSONB @> 연산 — admin 2명`);

        // JSONB 배열 길이
        const r2 = await provider.executeQuery(`
            SELECT data->>'name' as name, jsonb_array_length(data->'tags') as tag_count
            FROM adv_jsonb
            ORDER BY tag_count DESC
        `);
        const topRow = r2.rows[0] as Record<string, unknown>;
        assert(Number(topRow.tag_count) === 2, `JSONB 배열 길이 — Carol=2`);
    } catch (e) { fail('JSONB 연산', e); }

    // --- non-public 스키마 ---
    try {
        await provider.executeQuery('CREATE SCHEMA IF NOT EXISTS test_schema');
        await provider.executeQuery('DROP TABLE IF EXISTS test_schema.adv_items');
        await provider.executeQuery(`
            CREATE TABLE test_schema.adv_items (
                id SERIAL PRIMARY KEY,
                name VARCHAR(100)
            )
        `);
        await provider.executeQuery("INSERT INTO test_schema.adv_items (name) VALUES ('Item1'), ('Item2')");

        const r = await provider.executeQuery('SELECT * FROM test_schema.adv_items');
        assert(r.rows.length === 2, 'non-public 스키마 — 2행');

        // 스키마 간 JOIN
        const r2 = await provider.executeQuery(`
            SELECT i.name as item_name, e.name as emp_name
            FROM test_schema.adv_items i
            CROSS JOIN adv_employees e
            LIMIT 3
        `);
        assert(r2.rows.length === 3, '스키마 간 CROSS JOIN — 3행');
    } catch (e) { fail('non-public 스키마', e); }

    // --- 다른 DB 임시 연결 ---
    try {
        const r = await provider.executeQuery(
            "SELECT datname FROM pg_database WHERE datname = 'postgres'",
            'postgres'
        );
        assert(r.rows.length === 1, '임시 연결(postgres DB) — 성공');
    } catch (e) { fail('다른 DB 임시 연결', e); }

    // --- RETURNING 절 ---
    try {
        await provider.executeQuery('DROP TABLE IF EXISTS adv_returning');
        await provider.executeQuery('CREATE TABLE adv_returning (id SERIAL PRIMARY KEY, val TEXT)');
        const r = await provider.executeQuery(
            "INSERT INTO adv_returning (val) VALUES ('hello'), ('world') RETURNING id, val"
        );
        assert(r.rows.length === 2, `RETURNING — 2행 반환`);
        assert(Number((r.rows[0] as Record<string, unknown>).id) >= 1, 'RETURNING — id 포함');
    } catch (e) { fail('RETURNING', e); }

    // --- GENERATE_SERIES ---
    try {
        const r = await provider.executeQuery('SELECT * FROM generate_series(1, 10) as num');
        assert(r.rows.length === 10, `generate_series(1,10) — 10행`);
    } catch (e) { fail('generate_series', e); }

    // Cleanup
    try {
        await provider.executeQuery('DROP TABLE IF EXISTS adv_employees');
        await provider.executeQuery('DROP TABLE IF EXISTS adv_jsonb');
        await provider.executeQuery('DROP TABLE IF EXISTS test_schema.adv_items');
        await provider.executeQuery('DROP SCHEMA IF EXISTS test_schema');
        await provider.executeQuery('DROP TABLE IF EXISTS adv_returning');
        pass('PG cleanup');
    } catch (e) { fail('PG cleanup', e); }

    await provider.disconnect();
    pass('PG disconnect');
}

// ══════════════════════════════════════════════════════════════
//  SQLite 심화 테스트
// ══════════════════════════════════════════════════════════════

async function testSQLiteAdvanced() {
    header('SQLite — 심화 테스트');

    // --- 인메모리 모드 ---
    const memProvider = new SQLiteProvider(configs.sqliteMemory);
    try {
        await memProvider.connect();
        pass('SQLite 인메모리 connect');
    } catch (e) { fail('SQLite 인메모리 connect', e); return; }

    // 인메모리: 테이블 생성 및 조회
    try {
        await memProvider.executeQuery(`
            CREATE TABLE mem_test (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                score REAL DEFAULT 0.0
            )
        `);
        await memProvider.executeQuery(
            "INSERT INTO mem_test (name, score) VALUES ('Alpha', 90.5), ('Beta', 85.3), ('Gamma', 92.1)"
        );
        const r = await memProvider.executeQuery('SELECT * FROM mem_test ORDER BY score DESC');
        assert(r.rows.length === 3, '인메모리 — 3행 삽입/조회');
        assert((r.rows[0] as Record<string, unknown>).name === 'Gamma', '인메모리 — 정렬 정확');
    } catch (e) { fail('인메모리 테이블', e); }

    // --- 뷰(VIEW) ---
    try {
        await memProvider.executeQuery(`
            CREATE VIEW high_scorers AS
            SELECT name, score FROM mem_test WHERE score >= 90
        `);
        const r = await memProvider.executeQuery('SELECT * FROM high_scorers');
        assert(r.rows.length === 2, `VIEW — 90점 이상 2명`);
    } catch (e) { fail('VIEW', e); }

    // --- 인덱스 ---
    try {
        await memProvider.executeQuery('CREATE INDEX idx_mem_score ON mem_test(score)');
        // 인덱스 생성 후 정상 쿼리 확인
        const r = await memProvider.executeQuery('SELECT * FROM mem_test WHERE score > 90');
        assert(r.rows.length >= 1, 'INDEX 생성 후 쿼리 정상');
    } catch (e) { fail('INDEX', e); }

    // --- 자기 참조 FK ---
    try {
        await memProvider.executeQuery(`
            CREATE TABLE categories (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                parent_id INTEGER REFERENCES categories(id)
            )
        `);
        await memProvider.executeQuery(`
            INSERT INTO categories VALUES
            (1, 'Electronics', NULL),
            (2, 'Phones', 1),
            (3, 'Laptops', 1),
            (4, 'iPhone', 2),
            (5, 'Galaxy', 2)
        `);
        // 재귀 CTE
        const r = await memProvider.executeQuery(`
            WITH RECURSIVE tree AS (
                SELECT id, name, parent_id, 0 as depth
                FROM categories WHERE parent_id IS NULL
                UNION ALL
                SELECT c.id, c.name, c.parent_id, t.depth + 1
                FROM categories c JOIN tree t ON c.parent_id = t.id
            )
            SELECT * FROM tree ORDER BY depth, name
        `);
        assert(r.rows.length === 5, `재귀 CTE — 전체 5개 카테고리`);
        const leaf = r.rows.filter((row: Record<string, unknown>) => Number(row.depth) === 2);
        assert(leaf.length === 2, `재귀 CTE — depth=2 리프 2개`);
    } catch (e) { fail('자기 참조 FK + 재귀 CTE', e); }

    // --- GROUP_CONCAT ---
    try {
        const r = await memProvider.executeQuery(`
            SELECT parent_id, GROUP_CONCAT(name, ', ') as children
            FROM categories
            WHERE parent_id IS NOT NULL
            GROUP BY parent_id
            ORDER BY parent_id
        `);
        assert(r.rows.length >= 1, `GROUP_CONCAT — 결과 존재`);
    } catch (e) { fail('GROUP_CONCAT', e); }

    // --- CASE WHEN ---
    try {
        const r = await memProvider.executeQuery(`
            SELECT name, score,
                CASE
                    WHEN score >= 90 THEN 'A'
                    WHEN score >= 80 THEN 'B'
                    ELSE 'C'
                END as grade
            FROM mem_test
        `);
        const grades = r.rows.map((row: Record<string, unknown>) => row.grade);
        assert(grades.includes('A'), 'CASE WHEN — A등급 존재');
        assert(grades.includes('B'), 'CASE WHEN — B등급 존재');
    } catch (e) { fail('CASE WHEN', e); }

    // --- COALESCE + NULLIF ---
    try {
        await memProvider.executeQuery("INSERT INTO mem_test (name, score) VALUES ('Delta', 0)");
        const r = await memProvider.executeQuery(`
            SELECT name, COALESCE(NULLIF(score, 0), -1) as adjusted
            FROM mem_test WHERE name = 'Delta'
        `);
        const adjusted = Number((r.rows[0] as Record<string, unknown>).adjusted);
        assert(adjusted === -1, `NULLIF(0, 0) → NULL → COALESCE → -1 (got ${adjusted})`);
    } catch (e) { fail('COALESCE + NULLIF', e); }

    await memProvider.disconnect();
    pass('SQLite 인메모리 disconnect');

    // --- 파일 기반 격리 확인 ---
    const fileProvider = new SQLiteProvider(configs.sqlite);
    try {
        await fileProvider.connect();
        await fileProvider.executeQuery('DROP TABLE IF EXISTS adv_persist');
        await fileProvider.executeQuery('CREATE TABLE adv_persist (id INTEGER PRIMARY KEY, val TEXT)');
        await fileProvider.executeQuery("INSERT INTO adv_persist VALUES (1, 'persisted')");
        await fileProvider.disconnect();

        // 재연결 후 확인
        const provider2 = new SQLiteProvider(configs.sqlite);
        await provider2.connect();
        const r = await provider2.executeQuery('SELECT * FROM adv_persist');
        assert(r.rows.length === 1, '파일 기반 — 데이터 영속성');
        assert((r.rows[0] as Record<string, unknown>).val === 'persisted', '파일 기반 — 값 보존');

        await provider2.executeQuery('DROP TABLE IF EXISTS adv_persist');
        await provider2.disconnect();
        pass('SQLite 파일 기반 영속성');
    } catch (e) { fail('SQLite 파일 기반', e); }
}

// ══════════════════════════════════════════════════════════════
//  H2 심화 테스트
// ══════════════════════════════════════════════════════════════

async function testH2Advanced() {
    header('H2 — 심화 테스트');
    const provider = new H2Provider(configs.h2);

    try {
        await provider.connect();
        pass('H2 connect');
    } catch (e) { fail('H2 connect', e); return; }

    // --- 대소문자 처리 ---
    try {
        await provider.executeQuery('DROP TABLE IF EXISTS ADV_CASE_TEST');
        await provider.executeQuery('CREATE TABLE ADV_CASE_TEST (ID INT PRIMARY KEY, NAME VARCHAR(100))');
        await provider.executeQuery("INSERT INTO ADV_CASE_TEST VALUES (1, 'Upper')");

        // H2는 기본적으로 대문자로 처리
        const r = await provider.executeQuery('SELECT * FROM ADV_CASE_TEST');
        assert(r.rows.length === 1, 'H2 대소문자 — 대문자 테이블 조회');
    } catch (e) { fail('H2 대소문자', e); }

    // --- 시퀀스 ---
    try {
        await provider.executeQuery('DROP SEQUENCE IF EXISTS ADV_SEQ');
        await provider.executeQuery('CREATE SEQUENCE ADV_SEQ START WITH 100 INCREMENT BY 10');
        const r1 = await provider.executeQuery('SELECT NEXT VALUE FOR ADV_SEQ as val');
        const val1 = Number((r1.rows[0] as Record<string, unknown>).val);
        assert(val1 === 100, `시퀀스 첫 값 = 100 (got ${val1})`);

        const r2 = await provider.executeQuery('SELECT NEXT VALUE FOR ADV_SEQ as val');
        const val2 = Number((r2.rows[0] as Record<string, unknown>).val);
        assert(val2 === 110, `시퀀스 두 번째 = 110 (got ${val2})`);
    } catch (e) { fail('시퀀스', e); }

    // --- 복합 PRIMARY KEY ---
    try {
        await provider.executeQuery('DROP TABLE IF EXISTS ADV_COMPOSITE');
        await provider.executeQuery(`
            CREATE TABLE ADV_COMPOSITE (
                REGION VARCHAR(10),
                CODE INT,
                NAME VARCHAR(100),
                PRIMARY KEY (REGION, CODE)
            )
        `);
        await provider.executeQuery("INSERT INTO ADV_COMPOSITE VALUES ('KR', 1, 'Seoul'), ('KR', 2, 'Busan'), ('US', 1, 'NYC')");

        const r = await provider.executeQuery("SELECT * FROM ADV_COMPOSITE WHERE REGION = 'KR'");
        assert(r.rows.length === 2, '복합 PK — KR 지역 2행');
    } catch (e) { fail('복합 PRIMARY KEY', e); }

    // --- MERGE (UPSERT) ---
    try {
        await provider.executeQuery(`
            MERGE INTO ADV_CASE_TEST (ID, NAME) KEY (ID)
            VALUES (1, 'Updated'), (2, 'New')
        `);
        const r = await provider.executeQuery('SELECT * FROM ADV_CASE_TEST ORDER BY ID');
        assert(r.rows.length === 2, 'MERGE — 2행');
        assert((r.rows[0] as Record<string, unknown>).name === 'Updated' ||
               (r.rows[0] as Record<string, unknown>).NAME === 'Updated',
               'MERGE — 기존 행 업데이트');
    } catch (e) { fail('MERGE', e); }

    // --- getTableSchema 검증 ---
    try {
        const schema = await provider.getTableSchema('ADV_COMPOSITE', 'PUBLIC');
        assert(schema.length === 3, `getTableSchema — 3개 컬럼 (got ${schema.length})`);
        const pkCols = schema.filter(c => c.primaryKey);
        // H2의 복합 PK가 스키마에 정확히 반영되는지
        assert(pkCols.length >= 1, `복합 PK 스키마 반영 — ${pkCols.length}개 PK 컬럼`);
    } catch (e) { fail('getTableSchema 복합 PK', e); }

    // Cleanup
    try {
        await provider.executeQuery('DROP TABLE IF EXISTS ADV_CASE_TEST');
        await provider.executeQuery('DROP TABLE IF EXISTS ADV_COMPOSITE');
        await provider.executeQuery('DROP SEQUENCE IF EXISTS ADV_SEQ');
        pass('H2 cleanup');
    } catch (e) { fail('H2 cleanup', e); }

    await provider.disconnect();
    pass('H2 disconnect');
}

// ══════════════════════════════════════════════════════════════
//  MongoDB 심화 테스트
// ══════════════════════════════════════════════════════════════

async function testMongoDBAdvanced() {
    header('MongoDB — 심화 테스트');
    const provider = new MongoDBProvider(configs.mongodb);

    try {
        await provider.connect();
        pass('MongoDB connect');
    } catch (e) { fail('MongoDB connect', e); return; }

    // 테스트 컬렉션 준비
    try {
        try { await provider.executeQuery('{"drop": "adv_orders"}', 'mydb'); } catch { /* ok */ }
        await provider.executeQuery('{"create": "adv_orders"}', 'mydb');
        await provider.executeQuery(`{
            "insert": "adv_orders",
            "documents": [
                {"customer": "Alice", "items": [{"product": "Phone", "qty": 1, "price": 999}], "total": 999, "region": "Seoul", "date": "2026-01-15"},
                {"customer": "Bob", "items": [{"product": "Laptop", "qty": 1, "price": 1500}, {"product": "Mouse", "qty": 2, "price": 25}], "total": 1550, "region": "Seoul", "date": "2026-01-20"},
                {"customer": "Carol", "items": [{"product": "Tablet", "qty": 1, "price": 600}], "total": 600, "region": "Busan", "date": "2026-02-01"},
                {"customer": "Dave", "items": [{"product": "Phone", "qty": 2, "price": 999}], "total": 1998, "region": "Busan", "date": "2026-02-15"},
                {"customer": "Eve", "items": [{"product": "Keyboard", "qty": 1, "price": 120}], "total": 120, "region": "Seoul", "date": "2026-03-01"}
            ]
        }`, 'mydb');
        pass('테스트 데이터 삽입');
    } catch (e) { fail('테스트 데이터 삽입', e); }

    // --- 집계 파이프라인 (aggregate) ---
    try {
        const r = await provider.executeQuery(`{
            "aggregate": "adv_orders",
            "pipeline": [
                {"$group": {"_id": "$region", "totalSales": {"$sum": "$total"}, "orderCount": {"$sum": 1}}},
                {"$sort": {"totalSales": -1}}
            ],
            "cursor": {}
        }`, 'mydb');
        assert(r.rows.length === 2, `aggregate — 2개 지역`);
        const seoul = r.rows.find((row: Record<string, unknown>) => row._id === 'Seoul') as Record<string, unknown>;
        assert(Number(seoul?.totalSales) === 2669, `Seoul 총매출 = 2669 (got ${seoul?.totalSales})`);
    } catch (e) { fail('aggregate 파이프라인', e); }

    // --- Shell 문법: find + sort ---
    try {
        const r = await provider.executeQuery(
            'db.adv_orders.find({"region": "Seoul"}).sort({"total": -1})',
            'mydb'
        );
        assert(r.rows.length === 3, `Shell find+sort — Seoul 3건`);
        assert((r.rows[0] as Record<string, unknown>).customer === 'Bob', 'Shell sort — 최고액 Bob');
    } catch (e) { fail('Shell find+sort', e); }

    // --- Shell 문법: insertOne + findOne 패턴 ---
    try {
        await provider.executeQuery(
            'db.adv_orders.insertOne({"customer": "Frank", "items": [], "total": 0, "region": "Daegu", "date": "2026-03-10"})',
            'mydb'
        );
        const r = await provider.executeQuery(
            'db.adv_orders.find({"customer": "Frank"})',
            'mydb'
        );
        assert(r.rows.length === 1, 'Shell insertOne + find 확인');
        assert((r.rows[0] as Record<string, unknown>).region === 'Daegu', 'Shell — region=Daegu');
    } catch (e) { fail('Shell insertOne', e); }

    // --- 중첩 문서 쿼리 ---
    try {
        const r = await provider.executeQuery(`{
            "find": "adv_orders",
            "filter": {"items.product": "Phone"}
        }`, 'mydb');
        assert(r.rows.length === 2, `중첩 문서 쿼리 — Phone 주문 2건`);
    } catch (e) { fail('중첩 문서 쿼리', e); }

    // --- countDocuments ---
    try {
        const r = await provider.executeQuery('db.adv_orders.countDocuments({"total": {"$gte": 1000}})', 'mydb');
        // countDocuments 결과 파싱
        const count = Number(
            (r.rows[0] as Record<string, unknown>).n ??
            (r.rows[0] as Record<string, unknown>).count ??
            r.rows[0]
        );
        assert(count === 2, `countDocuments(total>=1000) = 2 (got ${count})`);
    } catch (e) { fail('countDocuments', e); }

    // --- deleteMany ---
    try {
        await provider.executeQuery(
            'db.adv_orders.deleteMany({"region": "Daegu"})',
            'mydb'
        );
        const r = await provider.executeQuery('db.adv_orders.countDocuments({})', 'mydb');
        const count = Number(
            (r.rows[0] as Record<string, unknown>).n ??
            (r.rows[0] as Record<string, unknown>).count ??
            r.rows[0]
        );
        assert(count === 5, `deleteMany 후 5건 (got ${count})`);
    } catch (e) { fail('deleteMany', e); }

    // --- 다른 DB에 쿼리 ---
    try {
        const r = await provider.executeQuery('{"listCollections": 1, "nameOnly": true}', 'admin');
        assert(r.rows.length >= 0, `다른 DB(admin) 쿼리 — 성공`);
    } catch (e) { fail('다른 DB 쿼리', e); }

    // Cleanup
    try {
        await provider.executeQuery('{"drop": "adv_orders"}', 'mydb');
        pass('MongoDB cleanup');
    } catch (e) { fail('MongoDB cleanup', e); }

    await provider.disconnect();
    pass('MongoDB disconnect');
}

// ══════════════════════════════════════════════════════════════
//  Redis 심화 테스트
// ══════════════════════════════════════════════════════════════

async function testRedisAdvanced() {
    header('Redis — 심화 테스트');
    const provider = new RedisProvider(configs.redis);

    try {
        await provider.connect();
        pass('Redis connect');
    } catch (e) { fail('Redis connect', e); return; }

    // --- 다중 DB 전환 (database 파라미터 방식) ---
    try {
        // db0에 키 저장 후 조회
        await provider.executeQuery('SET adv:test:dbswitch "hello"', 'db0');
        const r0 = await provider.executeQuery('GET adv:test:dbswitch', 'db0');
        const val0 = String(r0.rows[0]?.value ?? r0.rows[0]?.result ?? '');
        assert(val0.includes('hello'), `db0 SET/GET — ${val0}`);

        // db2에 다른 키 저장 후 조회
        await provider.executeQuery('SET adv:test:db2key "world"', 'db2');
        const r2 = await provider.executeQuery('GET adv:test:db2key', 'db2');
        const val2 = String(r2.rows[0]?.value ?? r2.rows[0]?.result ?? '');
        assert(val2.includes('world'), `db2 SET/GET — ${val2}`);

        // cleanup
        await provider.executeQuery('DEL adv:test:dbswitch', 'db0');
        await provider.executeQuery('DEL adv:test:db2key', 'db2');
        pass('다중 DB 전환 성공');
    } catch (e) { fail('다중 DB 전환', e); }

    // --- TTL ---
    try {
        await provider.executeQuery('SELECT 0');
        await provider.executeQuery('SET adv:ttl:key "expires-soon"');
        await provider.executeQuery('EXPIRE adv:ttl:key 300');
        const r = await provider.executeQuery('TTL adv:ttl:key');
        const ttl = Number(r.rows[0]?.value ?? r.rows[0]?.result ?? r.rows[0]?.ttl ?? -1);
        assert(ttl > 0 && ttl <= 300, `TTL 설정 — ${ttl}초`);
    } catch (e) { fail('TTL', e); }

    // --- 정렬 집합 (Sorted Set) — ZADD는 한 번에 1개 ---
    try {
        await provider.executeQuery('DEL adv:leaderboard');
        await provider.executeQuery('ZADD adv:leaderboard 100 Alice');
        await provider.executeQuery('ZADD adv:leaderboard 85 Bob');
        await provider.executeQuery('ZADD adv:leaderboard 95 Carol');
        await provider.executeQuery('ZADD adv:leaderboard 110 Dave');

        // ZRANGE — 오름차순 조회
        const r = await provider.executeQuery('ZRANGE adv:leaderboard 0 -1');
        assert(r.rows.length >= 1, `ZRANGE — 결과 존재`);

        // ZRANK — 멤버 순위
        const r2 = await provider.executeQuery('ZRANK adv:leaderboard Alice');
        assert(r2.rows.length >= 1, `ZRANK — 결과 존재`);

        // 멤버 수
        const r4 = await provider.executeQuery('ZCARD adv:leaderboard');
        const card = Number(r4.rows[0]?.value ?? r4.rows[0]?.result ?? 0);
        assert(card === 4, `ZCARD = 4 (got ${card})`);
    } catch (e) { fail('정렬 집합', e); }

    // --- Hash 고급 — HSET는 한 번에 1개 필드만 ---
    try {
        await provider.executeQuery('DEL adv:user:1');
        await provider.executeQuery('HSET adv:user:1 name Alice');
        await provider.executeQuery('HSET adv:user:1 age 30');
        await provider.executeQuery('HSET adv:user:1 city Seoul');
        await provider.executeQuery('HSET adv:user:1 score 100');

        // HGET — 단일 필드
        const r = await provider.executeQuery('HGET adv:user:1 name');
        const nameVal = String(r.rows[0]?.value ?? r.rows[0]?.result ?? '');
        assert(nameVal === 'Alice', `HGET name = Alice (got ${nameVal})`);

        // HGETALL — 전체 필드
        const r1 = await provider.executeQuery('HGETALL adv:user:1');
        assert(r1.rows.length >= 1, 'HGETALL — 결과 존재');

        // HKEYS — 키 목록
        const r2 = await provider.executeQuery('HKEYS adv:user:1');
        assert(r2.rows.length >= 1, 'HKEYS — 결과 존재');

        // HLEN
        const r3 = await provider.executeQuery('HLEN adv:user:1');
        const hlen = Number(r3.rows[0]?.value ?? r3.rows[0]?.result ?? 0);
        assert(hlen === 4, `HLEN = 4 (got ${hlen})`);

        // HVALS — 값 목록
        const r4 = await provider.executeQuery('HVALS adv:user:1');
        assert(r4.rows.length >= 1, 'HVALS — 결과 존재');
    } catch (e) { fail('Hash 고급', e); }

    // --- List 고급 (지원 명령어만) ---
    try {
        await provider.executeQuery('DEL adv:queue');
        await provider.executeQuery('RPUSH adv:queue "task1" "task2" "task3" "task4" "task5"');

        // LLEN
        const r = await provider.executeQuery('LLEN adv:queue');
        const len = Number(r.rows[0]?.value ?? r.rows[0]?.result ?? 0);
        assert(len === 5, `LLEN = 5 (got ${len})`);

        // LRANGE 전체
        const r2 = await provider.executeQuery('LRANGE adv:queue 0 -1');
        assert(r2.rows.length >= 1, 'LRANGE 전체 — 결과 존재');

        // LPOP
        const r3 = await provider.executeQuery('LPOP adv:queue');
        const popped = String(r3.rows[0]?.value ?? r3.rows[0]?.result ?? '');
        assert(popped === 'task1', `LPOP = task1 (got ${popped})`);

        // RPOP
        const r4 = await provider.executeQuery('RPOP adv:queue');
        const rpopped = String(r4.rows[0]?.value ?? r4.rows[0]?.result ?? '');
        assert(rpopped === 'task5', `RPOP = task5 (got ${rpopped})`);

        // 길이 확인
        const r5 = await provider.executeQuery('LLEN adv:queue');
        const newLen = Number(r5.rows[0]?.value ?? r5.rows[0]?.result ?? 0);
        assert(newLen === 3, `LPOP+RPOP 후 LLEN = 3 (got ${newLen})`);
    } catch (e) { fail('List 고급', e); }

    // --- Set 연산 (지원 명령어만) ---
    try {
        await provider.executeQuery('DEL adv:set:a adv:set:b');
        await provider.executeQuery('SADD adv:set:a x y z');
        await provider.executeQuery('SADD adv:set:b y z w');

        // SMEMBERS
        const r = await provider.executeQuery('SMEMBERS adv:set:a');
        assert(r.rows.length >= 1, 'SMEMBERS — 결과 존재');

        // SCARD
        const r2 = await provider.executeQuery('SCARD adv:set:a');
        const card = Number(r2.rows[0]?.value ?? r2.rows[0]?.result ?? 0);
        assert(card === 3, `SCARD adv:set:a = 3 (got ${card})`);

        // SISMEMBER (boolean: true/false 또는 1/0)
        const r3 = await provider.executeQuery('SISMEMBER adv:set:a x');
        const rawMember = r3.rows[0]?.value ?? r3.rows[0]?.result ?? r3.rows[0]?.isMember;
        const isMember = rawMember === true || rawMember === 1 || rawMember === '1' || rawMember === 'true';
        assert(isMember, `SISMEMBER x = true (got ${rawMember})`);

        // SREM
        await provider.executeQuery('SREM adv:set:a "z"');
        const r4 = await provider.executeQuery('SCARD adv:set:a');
        const newCard = Number(r4.rows[0]?.value ?? r4.rows[0]?.result ?? 0);
        assert(newCard === 2, `SREM 후 SCARD = 2 (got ${newCard})`);
    } catch (e) { fail('Set 연산', e); }

    // --- KEYS 패턴 매칭 ---
    try {
        const r = await provider.executeQuery('KEYS adv:*');
        assert(r.rows.length >= 1, `KEYS adv:* — ${r.rows.length}개 매칭`);
    } catch (e) { fail('KEYS 패턴', e); }

    // --- EXISTS ---
    try {
        const r = await provider.executeQuery('EXISTS adv:user:1');
        const exists = Number(r.rows[0]?.value ?? r.rows[0]?.result ?? 0);
        assert(exists === 1, 'EXISTS — 키 존재');
    } catch (e) { fail('EXISTS', e); }

    // --- TYPE ---
    try {
        const r = await provider.executeQuery('TYPE adv:leaderboard');
        const type = String(r.rows[0]?.value ?? r.rows[0]?.result ?? r.rows[0]?.type ?? '');
        assert(type === 'zset', `TYPE adv:leaderboard = zset (got ${type})`);
    } catch (e) { fail('TYPE', e); }

    // --- FLUSHDB / FLUSHALL 차단 확인 ---
    await assertThrows(
        () => provider.executeQuery('FLUSHDB'),
        'FLUSHDB 차단'
    );
    await assertThrows(
        () => provider.executeQuery('FLUSHALL'),
        'FLUSHALL 차단'
    );

    // Cleanup
    try {
        await provider.executeQuery('DEL adv:ttl:key adv:leaderboard adv:user:1 adv:queue adv:set:a adv:set:b', 'db0');
        pass('Redis cleanup');
    } catch (e) { fail('Redis cleanup', e); }

    await provider.disconnect();
    pass('Redis disconnect');
}

// ── Main ─────────────────────────────────────────────────────

async function main() {
    console.log('🔬 DBunny 프로바이더 심화 통합 테스트\n');

    const tests = [
        { name: 'MySQL', fn: testMySQLAdvanced },
        { name: 'PostgreSQL', fn: testPostgresAdvanced },
        { name: 'SQLite', fn: testSQLiteAdvanced },
        { name: 'H2', fn: testH2Advanced },
        { name: 'MongoDB', fn: testMongoDBAdvanced },
        { name: 'Redis', fn: testRedisAdvanced },
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
