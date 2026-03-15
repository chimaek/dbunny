/**
 * DBunny 엣지 케이스 통합 테스트
 *
 * 대용량 데이터, 특수문자, NULL 처리, 타입 변환, 에러 복구 등
 * 경계 상황에서의 동작을 검증합니다.
 *
 * 실행법: npx tsx src/test/integration/edgeCase.test.ts
 *
 * 사전 요구사항:
 *   docker compose up -d
 */

import { ConnectionConfig } from '../../types/database';
import { MySQLProvider } from '../../providers/mysqlProvider';
import { PostgresProvider } from '../../providers/postgresProvider';

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
    id: 'edge-mysql', name: 'MySQL Edge', type: 'mysql',
    host: 'localhost', port: 3306,
    username: 'root', password: 'root1234', database: 'mydb',
};

const pgConfig: ConnectionConfig = {
    id: 'edge-pg', name: 'PG Edge', type: 'postgres',
    host: 'localhost', port: 5432,
    username: 'postgres', password: 'postgres1234', database: 'mydb',
};

// ── 대용량 데이터 삽입/조회 ──────────────────────────────

async function testLargeDataSet() {
    header('대용량 데이터 삽입/조회');

    const mysql = new MySQLProvider(mysqlConfig);

    try {
        await mysql.connect();

        await mysql.executeQuery(`
            CREATE TABLE IF NOT EXISTS edge_large (
                id INT AUTO_INCREMENT PRIMARY KEY,
                data VARCHAR(500)
            )
        `);
        await mysql.executeQuery('TRUNCATE TABLE edge_large');

        // 500행 배치 삽입
        const batchSize = 100;
        for (let batch = 0; batch < 5; batch++) {
            const values = Array.from(
                { length: batchSize },
                (_, i) => `('row_${batch * batchSize + i}_${'x'.repeat(50)}')`
            ).join(',');
            await mysql.executeQuery(`INSERT INTO edge_large (data) VALUES ${values}`);
        }

        const countResult = await mysql.executeQuery('SELECT COUNT(*) AS cnt FROM edge_large');
        assert(Number(countResult.rows[0].cnt) === 500, '500행 삽입 확인');

        // 전체 조회
        const allResult = await mysql.executeQuery('SELECT * FROM edge_large ORDER BY id');
        assert(allResult.rows.length === 500, '500행 전체 조회');

        // LIMIT + OFFSET 페이징
        const page1 = await mysql.executeQuery('SELECT * FROM edge_large ORDER BY id LIMIT 50 OFFSET 0');
        const page2 = await mysql.executeQuery('SELECT * FROM edge_large ORDER BY id LIMIT 50 OFFSET 50');
        assert(page1.rows.length === 50, '페이지 1: 50행');
        assert(page2.rows.length === 50, '페이지 2: 50행');
        assert(page1.rows[0].id !== page2.rows[0].id, '페이지 간 데이터 다름');

        // 집계 쿼리
        const aggResult = await mysql.executeQuery(
            'SELECT MIN(id) AS min_id, MAX(id) AS max_id, COUNT(*) AS total FROM edge_large'
        );
        assert(Number(aggResult.rows[0].total) === 500, '집계: 총 500개');

        await mysql.executeQuery('DROP TABLE IF EXISTS edge_large');
        pass('대용량 데이터 테스트 완료');

    } catch (err) {
        fail('대용량 데이터 오류', err);
    } finally {
        await mysql.disconnect();
    }
}

// ── 특수문자 및 멀티바이트 ───────────────────────────────

async function testSpecialCharacters() {
    header('특수문자 및 멀티바이트 문자');

    const pg = new PostgresProvider(pgConfig);

    try {
        await pg.connect();

        await pg.executeQuery('DROP TABLE IF EXISTS edge_special');
        await pg.executeQuery(`
            CREATE TABLE edge_special (
                id SERIAL PRIMARY KEY,
                label TEXT,
                description TEXT
            )
        `);

        // 다양한 특수문자
        const testCases: Array<{ label: string; value: string; desc: string }> = [
            { label: 'korean', value: '한국어 테스트 문자열', desc: '한국어' },
            { label: 'japanese', value: 'テスト日本語', desc: '일본어' },
            { label: 'chinese', value: '测试中文', desc: '중국어' },
            { label: 'emoji', value: '🐰🔒💾✅❌', desc: '이모지' },
            { label: 'newlines', value: 'line1\nline2\nline3', desc: '줄바꿈' },
            { label: 'tabs', value: 'col1\tcol2\tcol3', desc: '탭' },
            { label: 'backslash', value: 'path\\to\\file', desc: '백슬래시' },
            { label: 'html', value: '<script>alert("xss")</script>', desc: 'HTML 태그' },
            { label: 'sql_chars', value: "it''s a test; DROP TABLE --", desc: 'SQL 특수문자' },
            { label: 'long_text', value: '가'.repeat(1000), desc: '1000자 한국어' },
        ];

        for (const tc of testCases) {
            await pg.executeQuery(
                `INSERT INTO edge_special (label, description) VALUES ('${tc.label}', $$${tc.value}$$)`
            );
        }

        // 삽입 확인
        const totalResult = await pg.executeQuery('SELECT COUNT(*) AS cnt FROM edge_special');
        assert(Number(totalResult.rows[0].cnt) === testCases.length, `${testCases.length}개 특수문자 행 삽입`);

        // 각 값 검증
        for (const tc of testCases) {
            const result = await pg.executeQuery(
                `SELECT description FROM edge_special WHERE label = '${tc.label}'`
            );
            assert(result.rows.length === 1, `${tc.desc} 조회 성공`);

            const stored = String(result.rows[0].description);
            if (tc.label === 'long_text') {
                assert(stored.length === 1000, `${tc.desc}: 길이 1000 보존`);
            } else if (tc.label === 'sql_chars') {
                assert(stored.includes("''"), `${tc.desc}: 이스케이프된 따옴표 보존`);
            }
        }

        await pg.executeQuery('DROP TABLE IF EXISTS edge_special');
        pass('특수문자 테스트 완료');

    } catch (err) {
        fail('특수문자 오류', err);
    } finally {
        await pg.disconnect();
    }
}

// ── NULL 처리 심화 ──────────────────────────────────────

async function testNullHandling() {
    header('NULL 처리 심화');

    const mysql = new MySQLProvider(mysqlConfig);

    try {
        await mysql.connect();

        await mysql.executeQuery(`
            CREATE TABLE IF NOT EXISTS edge_null (
                id INT AUTO_INCREMENT PRIMARY KEY,
                str_col VARCHAR(100),
                int_col INT,
                float_col FLOAT,
                date_col DATE,
                bool_col BOOLEAN
            )
        `);
        await mysql.executeQuery('TRUNCATE TABLE edge_null');

        // 모든 컬럼이 NULL인 행
        await mysql.executeQuery(
            'INSERT INTO edge_null (str_col, int_col, float_col, date_col, bool_col) VALUES (NULL, NULL, NULL, NULL, NULL)'
        );

        // 일부만 NULL
        await mysql.executeQuery(
            `INSERT INTO edge_null (str_col, int_col) VALUES ('partial', NULL)`
        );

        // 빈 문자열 (NULL이 아님)
        await mysql.executeQuery(
            `INSERT INTO edge_null (str_col, int_col) VALUES ('', 0)`
        );

        // NULL 조회
        const nullResult = await mysql.executeQuery('SELECT * FROM edge_null WHERE str_col IS NULL');
        assert(nullResult.rows.length === 1, 'NULL str_col 행 조회');
        assert(nullResult.rows[0].str_col === null, 'str_col === null');
        assert(nullResult.rows[0].int_col === null, 'int_col === null');
        assert(nullResult.rows[0].float_col === null, 'float_col === null');
        assert(nullResult.rows[0].date_col === null, 'date_col === null');

        // 빈 문자열 vs NULL
        const emptyResult = await mysql.executeQuery(`SELECT * FROM edge_null WHERE str_col = ''`);
        assert(emptyResult.rows.length === 1, '빈 문자열 조회');
        assert(emptyResult.rows[0].str_col === '', '빈 문자열 보존');
        assert(emptyResult.rows[0].int_col === 0, '0과 NULL 구분');

        // COALESCE
        const coalesceResult = await mysql.executeQuery(
            `SELECT COALESCE(str_col, 'DEFAULT') AS val FROM edge_null WHERE str_col IS NULL`
        );
        assert(coalesceResult.rows[0].val === 'DEFAULT', 'COALESCE 동작');

        // NULL 집계
        const aggResult = await mysql.executeQuery(
            'SELECT COUNT(*) AS total, COUNT(int_col) AS non_null FROM edge_null'
        );
        assert(Number(aggResult.rows[0].total) === 3, '전체 3행');
        assert(Number(aggResult.rows[0].non_null) === 1, 'int_col NOT NULL: 1행');

        await mysql.executeQuery('DROP TABLE IF EXISTS edge_null');
        pass('NULL 처리 테스트 완료');

    } catch (err) {
        fail('NULL 처리 오류', err);
    } finally {
        await mysql.disconnect();
    }
}

// ── 에러 복구 ────────────────────────────────────────────

async function testErrorRecovery() {
    header('에러 복구');

    const mysql = new MySQLProvider(mysqlConfig);

    try {
        await mysql.connect();

        // 1. 존재하지 않는 테이블 조회
        try {
            await mysql.executeQuery('SELECT * FROM nonexistent_table_xyz');
            fail('존재하지 않는 테이블 에러 없음');
        } catch (err) {
            const msg = err instanceof Error ? err.message : '';
            assert(msg.length > 0, '존재하지 않는 테이블 에러 발생');
        }

        // 에러 후에도 연결 유지
        assert(mysql.isConnected(), '에러 후 연결 유지');

        // 정상 쿼리 가능
        const result = await mysql.executeQuery('SELECT 1 AS ok');
        assert(result.rows[0].ok === 1, '에러 후 정상 쿼리 성공');

        // 2. 잘못된 SQL 문법
        try {
            await mysql.executeQuery('SELEC * FORM users');
            fail('잘못된 문법 에러 없음');
        } catch {
            pass('잘못된 SQL 문법 에러 발생');
        }

        assert(mysql.isConnected(), '문법 에러 후 연결 유지');

        // 3. 제약 조건 위반
        await mysql.executeQuery(`
            CREATE TABLE IF NOT EXISTS edge_constraint (
                id INT PRIMARY KEY,
                name VARCHAR(50) UNIQUE NOT NULL
            )
        `);
        await mysql.executeQuery('TRUNCATE TABLE edge_constraint');
        await mysql.executeQuery(`INSERT INTO edge_constraint VALUES (1, 'unique_name')`);

        // 중복 키
        try {
            await mysql.executeQuery(`INSERT INTO edge_constraint VALUES (1, 'other_name')`);
            fail('중복 키 에러 없음');
        } catch {
            pass('중복 키 제약 조건 위반 에러');
        }

        // UNIQUE 위반
        try {
            await mysql.executeQuery(`INSERT INTO edge_constraint VALUES (2, 'unique_name')`);
            fail('UNIQUE 에러 없음');
        } catch {
            pass('UNIQUE 제약 조건 위반 에러');
        }

        // NOT NULL 위반
        try {
            await mysql.executeQuery(`INSERT INTO edge_constraint VALUES (3, NULL)`);
            fail('NOT NULL 에러 없음');
        } catch {
            pass('NOT NULL 제약 조건 위반 에러');
        }

        // 모든 에러 후에도 정상 동작
        const finalResult = await mysql.executeQuery('SELECT COUNT(*) AS cnt FROM edge_constraint');
        assert(Number(finalResult.rows[0].cnt) === 1, '제약 위반 후 데이터 무결성 유지');

        await mysql.executeQuery('DROP TABLE IF EXISTS edge_constraint');
        pass('에러 복구 테스트 완료');

    } catch (err) {
        fail('에러 복구 오류', err);
    } finally {
        await mysql.disconnect();
    }
}

// ── 타입 변환 검증 ──────────────────────────────────────

async function testTypeConversion() {
    header('타입 변환 검증');

    const pg = new PostgresProvider(pgConfig);

    try {
        await pg.connect();

        await pg.executeQuery('DROP TABLE IF EXISTS edge_types');
        await pg.executeQuery(`
            CREATE TABLE edge_types (
                id SERIAL PRIMARY KEY,
                int_val INTEGER,
                bigint_val BIGINT,
                numeric_val NUMERIC(20, 5),
                float_val DOUBLE PRECISION,
                bool_val BOOLEAN,
                text_val TEXT,
                date_val DATE,
                ts_val TIMESTAMP,
                json_val JSONB
            )
        `);

        // 다양한 타입 데이터 삽입
        await pg.executeQuery(`
            INSERT INTO edge_types (int_val, bigint_val, numeric_val, float_val, bool_val, text_val, date_val, ts_val, json_val) VALUES
            (2147483647, 9223372036854775807, 12345.67890, 3.141592653589793, true, 'hello', '2026-03-15', '2026-03-15 10:30:00', '{"key": "value"}')
        `);

        const result = await pg.executeQuery('SELECT * FROM edge_types WHERE id = 1');
        assert(result.rows.length === 1, '타입 테스트 행 조회');

        const row = result.rows[0];

        // 정수
        assert(Number(row.int_val) === 2147483647, 'INT 최대값 보존');

        // BIGINT (JavaScript에서 문자열로 올 수 있음)
        const bigVal = String(row.bigint_val);
        assert(bigVal === '9223372036854775807', 'BIGINT 값 보존');

        // NUMERIC 정밀도
        const numVal = Number(row.numeric_val);
        assert(Math.abs(numVal - 12345.6789) < 0.001, 'NUMERIC 정밀도 보존');

        // FLOAT
        const floatVal = Number(row.float_val);
        assert(Math.abs(floatVal - 3.14159265) < 0.0001, 'FLOAT 정밀도');

        // BOOLEAN
        assert(row.bool_val === true, 'BOOLEAN true 보존');

        // TEXT
        assert(row.text_val === 'hello', 'TEXT 값 보존');

        // DATE
        const dateStr = String(row.date_val);
        assert(dateStr.includes('2026'), 'DATE 연도 보존');

        // JSONB
        const jsonVal = typeof row.json_val === 'string' ? JSON.parse(row.json_val) : row.json_val;
        assert(jsonVal.key === 'value', 'JSONB 값 접근');

        // 경계값 테스트
        await pg.executeQuery(`
            INSERT INTO edge_types (int_val, float_val, bool_val) VALUES
            (0, 0.0, false),
            (-2147483648, -999999.99, false)
        `);

        const zeroResult = await pg.executeQuery('SELECT * FROM edge_types WHERE int_val = 0');
        assert(Number(zeroResult.rows[0].int_val) === 0, '0 값 보존');
        assert(zeroResult.rows[0].bool_val === false, 'false 보존');

        const negResult = await pg.executeQuery('SELECT * FROM edge_types WHERE int_val = -2147483648');
        assert(Number(negResult.rows[0].int_val) === -2147483648, 'INT 최소값 보존');

        await pg.executeQuery('DROP TABLE IF EXISTS edge_types');
        pass('타입 변환 테스트 완료');

    } catch (err) {
        fail('타입 변환 오류', err);
    } finally {
        await pg.disconnect();
    }
}

// ── JOIN 및 복합 쿼리 ──────────────────────────────────

async function testComplexQueries() {
    header('JOIN 및 복합 쿼리');

    const mysql = new MySQLProvider(mysqlConfig);

    try {
        await mysql.connect();

        // 테스트 테이블 생성
        await mysql.executeQuery('DROP TABLE IF EXISTS edge_order_items');
        await mysql.executeQuery('DROP TABLE IF EXISTS edge_orders');
        await mysql.executeQuery('DROP TABLE IF EXISTS edge_customers');

        await mysql.executeQuery(`
            CREATE TABLE edge_customers (
                id INT PRIMARY KEY,
                name VARCHAR(50),
                tier VARCHAR(20)
            )
        `);
        await mysql.executeQuery(`
            CREATE TABLE edge_orders (
                id INT PRIMARY KEY,
                customer_id INT,
                total DECIMAL(10,2),
                FOREIGN KEY (customer_id) REFERENCES edge_customers(id)
            )
        `);
        await mysql.executeQuery(`
            CREATE TABLE edge_order_items (
                id INT PRIMARY KEY,
                order_id INT,
                product VARCHAR(50),
                qty INT,
                FOREIGN KEY (order_id) REFERENCES edge_orders(id)
            )
        `);

        // 데이터 삽입
        await mysql.executeQuery(`
            INSERT INTO edge_customers VALUES
            (1, 'Alice', 'gold'), (2, 'Bob', 'silver'), (3, 'Carol', 'gold')
        `);
        await mysql.executeQuery(`
            INSERT INTO edge_orders VALUES
            (1, 1, 100.00), (2, 1, 200.00), (3, 2, 50.00)
        `);
        await mysql.executeQuery(`
            INSERT INTO edge_order_items VALUES
            (1, 1, 'Widget', 2), (2, 1, 'Gadget', 1),
            (3, 2, 'Widget', 5), (4, 3, 'Gadget', 3)
        `);
        pass('3개 테이블 + FK 관계 생성');

        // INNER JOIN
        const innerResult = await mysql.executeQuery(`
            SELECT c.name, o.total
            FROM edge_customers c
            INNER JOIN edge_orders o ON c.id = o.customer_id
            ORDER BY o.total DESC
        `);
        assert(innerResult.rows.length === 3, 'INNER JOIN: 3행');

        // LEFT JOIN (Carol은 주문 없음)
        const leftResult = await mysql.executeQuery(`
            SELECT c.name, COALESCE(SUM(o.total), 0) AS total_spent
            FROM edge_customers c
            LEFT JOIN edge_orders o ON c.id = o.customer_id
            GROUP BY c.id, c.name
            ORDER BY total_spent DESC
        `);
        assert(leftResult.rows.length === 3, 'LEFT JOIN + GROUP BY: 3행');
        const carol = leftResult.rows.find((r: Record<string, unknown>) => r.name === 'Carol');
        assert(Number(carol?.total_spent) === 0, 'Carol 총 주문 = 0 (LEFT JOIN)');

        // 3중 JOIN
        const tripleResult = await mysql.executeQuery(`
            SELECT c.name, o.total, oi.product, oi.qty
            FROM edge_customers c
            JOIN edge_orders o ON c.id = o.customer_id
            JOIN edge_order_items oi ON o.id = oi.order_id
            ORDER BY c.name, o.id
        `);
        assert(tripleResult.rows.length === 4, '3중 JOIN: 4행');

        // 서브쿼리
        const subResult = await mysql.executeQuery(`
            SELECT name FROM edge_customers
            WHERE id IN (
                SELECT customer_id FROM edge_orders WHERE total > 75
            )
        `);
        assert(subResult.rows.length === 1, '서브쿼리: total > 75인 고객 1명');
        assert(subResult.rows[0].name === 'Alice', '서브쿼리: Alice');

        // HAVING
        const havingResult = await mysql.executeQuery(`
            SELECT c.name, COUNT(o.id) AS order_count
            FROM edge_customers c
            LEFT JOIN edge_orders o ON c.id = o.customer_id
            GROUP BY c.id, c.name
            HAVING order_count >= 2
        `);
        assert(havingResult.rows.length === 1, 'HAVING: 주문 2건 이상 1명');

        // FK 정보
        const fks = await mysql.getForeignKeys('edge_orders');
        assert(fks.length === 1, 'edge_orders FK 1개');
        assert(fks[0].referencedTable === 'edge_customers', 'FK → edge_customers');

        // 정리
        await mysql.executeQuery('DROP TABLE IF EXISTS edge_order_items');
        await mysql.executeQuery('DROP TABLE IF EXISTS edge_orders');
        await mysql.executeQuery('DROP TABLE IF EXISTS edge_customers');
        pass('복합 쿼리 테스트 완료');

    } catch (err) {
        fail('복합 쿼리 오류', err);
    } finally {
        await mysql.disconnect();
    }
}

// ── Main ─────────────────────────────────────────────────

async function main() {
    console.log('\n🔬 DBunny 엣지 케이스 통합 테스트\n');

    await testLargeDataSet();
    await testSpecialCharacters();
    await testNullHandling();
    await testErrorRecovery();
    await testTypeConversion();
    await testComplexQueries();

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
