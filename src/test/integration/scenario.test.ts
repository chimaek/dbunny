/**
 * DBunny 사용자 시나리오 통합 테스트
 *
 * 실제 사용자 워크플로우를 시뮬레이션하여 기능 간 연동을 검증합니다.
 *
 * 시나리오:
 * 1. DBA가 프로덕션 DB를 읽기 전용으로 연결하여 모니터링
 * 2. 개발자가 파라미터화된 쿼리로 반복 조회
 * 3. QA가 쿼리 결과를 핀으로 고정하여 배포 전후 비교
 * 4. 팀원이 여러 DB를 동시에 사용하는 멀티탭 시나리오
 *
 * 실행법: npx tsx src/test/integration/scenario.test.ts
 *
 * 사전 요구사항:
 *   docker compose up -d
 */

import { ConnectionConfig } from '../../types/database';
import { MySQLProvider } from '../../providers/mysqlProvider';
import { PostgresProvider } from '../../providers/postgresProvider';
import { checkWriteOperation } from '../../utils/readOnlyGuard';
import {
    extractParameters,
    substituteParameters,
    hasParameters,
    getUniqueParameterNames,
    createEmptyConnectionData
} from '../../utils/queryParameter';
import {
    createDefaultTabPinState,
    pinResult,
    renamePinLabel,
    selectPinnedResult,
    toggleCompareMode,
    unpinResult,
    getPinDisplayName,
    clearAllPins,
    PinnedResult,
    TabPinState
} from '../../utils/resultPin';

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
    id: 'scenario-mysql', name: 'MySQL Dev', type: 'mysql',
    host: 'localhost', port: 3306,
    username: 'root', password: 'root1234', database: 'mydb',
};

const mysqlReadOnlyConfig: ConnectionConfig = {
    ...mysqlConfig,
    id: 'scenario-mysql-ro', name: 'MySQL Production',
    readOnly: true,
};

const pgConfig: ConnectionConfig = {
    id: 'scenario-pg', name: 'PostgreSQL Dev', type: 'postgres',
    host: 'localhost', port: 5432,
    username: 'postgres', password: 'postgres1234', database: 'mydb',
};

// ── 시나리오 1: DBA 프로덕션 모니터링 ────────────────────

async function scenario1_DBAMonitoring() {
    header('시나리오 1: DBA 프로덕션 DB 읽기 전용 모니터링');

    const provider = new MySQLProvider(mysqlReadOnlyConfig);

    try {
        await provider.connect();
        pass('프로덕션 DB 읽기 전용 연결');

        // Step 1: 연결 설정 확인
        assert(provider.config.readOnly === true, 'readOnly 모드 활성');

        // Step 2: 서버 상태 조회 (안전 쿼리)
        const safeQueries = [
            { q: 'SHOW PROCESSLIST', desc: '프로세스 목록' },
            { q: 'SHOW STATUS LIKE "Threads_connected"', desc: '연결 스레드 수' },
            { q: 'SHOW VARIABLES LIKE "max_connections"', desc: '최대 연결 수' },
            { q: 'SELECT COUNT(*) AS cnt FROM information_schema.tables WHERE table_schema = "mydb"', desc: '테이블 수 조회' },
        ];

        for (const { q, desc } of safeQueries) {
            const check = checkWriteOperation(q, 'mysql');
            assert(check.isWrite === false, `안전 쿼리 허용: ${desc}`);
            const result = await provider.executeQuery(q);
            assert(result.rows.length > 0, `${desc} 실행 성공`);
        }

        // Step 3: 위험 쿼리 차단 확인 (실제 실행 전 가드에서 차단)
        const dangerousQueries = [
            'DROP TABLE users',
            'TRUNCATE TABLE users',
            'DELETE FROM users',
            'UPDATE users SET name = "hacked"',
        ];

        for (const dq of dangerousQueries) {
            const check = checkWriteOperation(dq, 'mysql');
            assert(check.isWrite === true, `위험 쿼리 차단: ${dq.substring(0, 30)}`);
        }

        // Step 4: 읽기 전용에서 데이터 분석
        const analysisResult = await provider.executeQuery(`
            SELECT table_name, table_rows
            FROM information_schema.tables
            WHERE table_schema = 'mydb' AND table_type = 'BASE TABLE'
            ORDER BY table_rows DESC
        `);
        assert(analysisResult.rows.length >= 0, '테이블 분석 쿼리 성공');

        pass('DBA 모니터링 시나리오 완료');

    } catch (err) {
        fail('DBA 모니터링 오류', err);
    } finally {
        await provider.disconnect();
    }
}

// ── 시나리오 2: 개발자 파라미터화된 쿼리 ─────────────────

async function scenario2_DeveloperParameterizedQuery() {
    header('시나리오 2: 개발자 파라미터화된 쿼리 워크플로우');

    const mysql = new MySQLProvider(mysqlConfig);

    try {
        await mysql.connect();
        pass('개발 DB 연결');

        // Step 1: 테스트 데이터 준비
        await mysql.executeQuery(`
            CREATE TABLE IF NOT EXISTS scenario_orders (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT,
                product VARCHAR(100),
                amount DECIMAL(10,2),
                status VARCHAR(20),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        await mysql.executeQuery('DELETE FROM scenario_orders');
        await mysql.executeQuery(`
            INSERT INTO scenario_orders (user_id, product, amount, status) VALUES
            (1, 'Widget A', 29.99, 'completed'),
            (1, 'Widget B', 49.99, 'pending'),
            (2, 'Widget A', 29.99, 'completed'),
            (2, 'Widget C', 99.99, 'cancelled'),
            (3, 'Widget B', 49.99, 'completed')
        `);
        pass('테스트 데이터 준비 완료');

        // Step 2: 파라미터화된 쿼리 작성
        const templateQuery = `
            SELECT user_id, product, amount, status
            FROM scenario_orders
            WHERE status = {{status}}
              AND amount > {{min_amount}}
            ORDER BY amount DESC
            LIMIT {{limit}}
        `;

        // 파라미터 추출
        assert(hasParameters(templateQuery), '쿼리에 파라미터 존재');
        const paramNames = getUniqueParameterNames(templateQuery);
        assert(paramNames.length === 3, '3개 파라미터 추출');
        assert(paramNames.includes('status'), 'status 파라미터');
        assert(paramNames.includes('min_amount'), 'min_amount 파라미터');
        assert(paramNames.includes('limit'), 'limit 파라미터');

        // Step 3: 환경별 변수 프로필 사용
        const connData = createEmptyConnectionData();
        connData.profiles[0].variables = { status: "'completed'", min_amount: '0', limit: '10' }; // dev
        connData.profiles[2].variables = { status: "'completed'", min_amount: '50', limit: '5' }; // prod

        // dev 프로필로 실행
        const devQuery = substituteParameters(templateQuery, connData.profiles[0].variables);
        assert(!hasParameters(devQuery), 'dev 프로필 치환 완료');
        const devResult = await mysql.executeQuery(devQuery);
        assert(devResult.rows.length === 3, 'dev: completed 주문 3건');

        // prod 프로필로 실행 (min_amount > 50)
        const prodQuery = substituteParameters(templateQuery, connData.profiles[2].variables);
        const prodResult = await mysql.executeQuery(prodQuery);
        assert(prodResult.rows.length === 0, 'prod: amount > 50인 completed 주문 0건');

        // Step 4: 부분 치환 — 하나의 값만 넣고 나머지는 유지
        const partialQuery = substituteParameters(templateQuery, { status: "'pending'" });
        assert(partialQuery.includes('{{min_amount}}'), '부분 치환 — min_amount 유지');
        assert(partialQuery.includes("'pending'"), '부분 치환 — status 적용');

        // 정리
        await mysql.executeQuery('DROP TABLE IF EXISTS scenario_orders');
        pass('테스트 테이블 정리');

    } catch (err) {
        fail('개발자 파라미터 시나리오 오류', err);
    } finally {
        await mysql.disconnect();
    }
}

// ── 시나리오 3: QA 배포 전후 결과 비교 ──────────────────

async function scenario3_QACompareResults() {
    header('시나리오 3: QA 배포 전후 결과 비교');

    const pg = new PostgresProvider(pgConfig);

    try {
        await pg.connect();
        pass('PostgreSQL 연결');

        // Step 1: 테스트 테이블 준비
        await pg.executeQuery(`DROP TABLE IF EXISTS scenario_metrics`);
        await pg.executeQuery(`
            CREATE TABLE scenario_metrics (
                id SERIAL PRIMARY KEY,
                metric_name VARCHAR(50),
                value NUMERIC,
                measured_at TIMESTAMP DEFAULT NOW()
            )
        `);
        await pg.executeQuery(`
            INSERT INTO scenario_metrics (metric_name, value) VALUES
            ('response_time', 120),
            ('error_rate', 2.5),
            ('throughput', 1000),
            ('uptime', 99.9)
        `);
        pass('배포 전 메트릭 데이터 준비');

        // Step 2: "배포 전" 결과를 핀으로 고정
        const beforeQuery = 'SELECT metric_name, value FROM scenario_metrics ORDER BY metric_name';
        const beforeResult = await pg.executeQuery(beforeQuery);

        let pinState: TabPinState = createDefaultTabPinState();
        pinState = pinResult(pinState, {
            query: beforeQuery,
            columns: beforeResult.columns ?? ['metric_name', 'value'],
            rows: beforeResult.rows,
            rowCount: beforeResult.rows.length,
            executionTime: 5,
            executedAt: new Date().toISOString(),
            connectionName: 'PostgreSQL Dev',
            databaseName: 'mydb',
            label: 'Before Deploy',
        });
        assert(pinState.pinnedResults.length === 1, '배포 전 결과 핀 고정');

        const beforePin = pinState.pinnedResults[0];
        assert(getPinDisplayName(beforePin) === 'Before Deploy', '핀 라벨: Before Deploy');

        // Step 3: "배포" 시뮬레이션 — 데이터 변경
        await pg.executeQuery(`UPDATE scenario_metrics SET value = 80 WHERE metric_name = 'response_time'`);
        await pg.executeQuery(`UPDATE scenario_metrics SET value = 1.2 WHERE metric_name = 'error_rate'`);
        await pg.executeQuery(`UPDATE scenario_metrics SET value = 1500 WHERE metric_name = 'throughput'`);
        pass('배포 시뮬레이션 (메트릭 업데이트)');

        // Step 4: "배포 후" 결과를 핀으로 고정
        const afterResult = await pg.executeQuery(beforeQuery);
        pinState = pinResult(pinState, {
            query: beforeQuery,
            columns: afterResult.columns ?? ['metric_name', 'value'],
            rows: afterResult.rows,
            rowCount: afterResult.rows.length,
            executionTime: 3,
            executedAt: new Date().toISOString(),
            connectionName: 'PostgreSQL Dev',
            databaseName: 'mydb',
            label: 'After Deploy',
        });
        assert(pinState.pinnedResults.length === 2, '배포 후 결과 핀 추가');

        const afterPin = pinState.pinnedResults[0]; // 최신이 앞

        // Step 5: 나란히 비교 모드
        pinState = selectPinnedResult(pinState, afterPin.id);
        pinState = toggleCompareMode(pinState, beforePin.id);
        assert(pinState.compareMode === 'side-by-side', '나란히 비교 모드');
        assert(pinState.compareTargetId === beforePin.id, '비교 대상: Before Deploy');

        // Step 6: 데이터 비교 검증
        const beforeRows = beforePin.rows as Array<Record<string, unknown>>;
        const afterRows = afterPin.rows as Array<Record<string, unknown>>;

        const responseTimeBefore = Number(beforeRows.find(r => r.metric_name === 'response_time')?.value);
        const responseTimeAfter = Number(afterRows.find(r => r.metric_name === 'response_time')?.value);
        assert(responseTimeBefore === 120, '배포 전 response_time = 120');
        assert(responseTimeAfter === 80, '배포 후 response_time = 80');
        assert(responseTimeAfter < responseTimeBefore, '배포 후 응답 시간 개선');

        const errorBefore = Number(beforeRows.find(r => r.metric_name === 'error_rate')?.value);
        const errorAfter = Number(afterRows.find(r => r.metric_name === 'error_rate')?.value);
        assert(errorAfter < errorBefore, '배포 후 에러율 감소');

        // Step 7: 비교 종료 및 정리
        pinState = toggleCompareMode(pinState, null);
        assert(pinState.compareMode === 'single', '비교 종료');

        pinState = clearAllPins(pinState);
        assert(pinState.pinnedResults.length === 0, '모든 핀 정리');

        await pg.executeQuery('DROP TABLE IF EXISTS scenario_metrics');
        pass('QA 비교 시나리오 완료');

    } catch (err) {
        fail('QA 비교 시나리오 오류', err);
    } finally {
        await pg.disconnect();
    }
}

// ── 시나리오 4: 멀티탭 여러 DB 동시 사용 ─────────────────

async function scenario4_MultiTabMultiDB() {
    header('시나리오 4: 멀티탭 여러 DB 동시 사용');

    const mysql = new MySQLProvider(mysqlConfig);
    const pg = new PostgresProvider(pgConfig);

    try {
        // 두 DB 동시 연결
        await mysql.connect();
        await pg.connect();
        pass('MySQL + PostgreSQL 동시 연결');

        // Tab 1: MySQL 쿼리
        const mysqlResult = await mysql.executeQuery('SELECT 1 AS tab1_mysql');
        assert(mysqlResult.rows.length === 1, 'Tab 1 (MySQL): 쿼리 성공');

        // Tab 2: PostgreSQL 쿼리
        const pgResult = await pg.executeQuery('SELECT 1 AS tab2_pg');
        assert(pgResult.rows.length === 1, 'Tab 2 (PostgreSQL): 쿼리 성공');

        // Tab 1과 Tab 2 결과를 각각 핀으로 고정
        let pinState = createDefaultTabPinState();
        pinState = pinResult(pinState, {
            query: 'SELECT 1 AS tab1_mysql',
            columns: ['tab1_mysql'],
            rows: mysqlResult.rows,
            rowCount: 1,
            executionTime: 1,
            executedAt: new Date().toISOString(),
            connectionName: 'MySQL Dev',
            databaseName: 'mydb',
        });
        pinState = pinResult(pinState, {
            query: 'SELECT 1 AS tab2_pg',
            columns: ['tab2_pg'],
            rows: pgResult.rows,
            rowCount: 1,
            executionTime: 1,
            executedAt: new Date().toISOString(),
            connectionName: 'PostgreSQL Dev',
            databaseName: 'mydb',
        });
        assert(pinState.pinnedResults.length === 2, '두 DB 결과 모두 핀');

        // 각 핀의 connectionName이 다른지 확인
        const connNames = pinState.pinnedResults.map(p => p.connectionName);
        assert(connNames.includes('MySQL Dev'), 'MySQL 핀 존재');
        assert(connNames.includes('PostgreSQL Dev'), 'PostgreSQL 핀 존재');

        // 읽기 전용 모드 — MySQL은 readOnly, PostgreSQL은 아닌 시나리오
        const readOnlyMysql = new MySQLProvider(mysqlReadOnlyConfig);
        await readOnlyMysql.connect();

        // MySQL readOnly — 쓰기 차단
        const writeCheck = checkWriteOperation('INSERT INTO users VALUES(1, "test")', 'mysql');
        assert(writeCheck.isWrite === true, 'readOnly MySQL: INSERT 차단');

        // PostgreSQL — 쓰기 허용
        const pgWriteCheck = checkWriteOperation('INSERT INTO users VALUES(1, $$test$$)', 'postgres');
        assert(pgWriteCheck.isWrite === true, 'PostgreSQL: INSERT 감지 (readOnly 미적용이면 실행 가능)');

        // 각 연결 별 readOnly 설정 독립성
        assert(readOnlyMysql.config.readOnly === true, 'readOnly MySQL readOnly === true');
        assert(pg.config.readOnly !== true, 'PostgreSQL readOnly !== true');

        await readOnlyMysql.disconnect();
        pass('멀티탭 시나리오 완료');

    } catch (err) {
        fail('멀티탭 시나리오 오류', err);
    } finally {
        await mysql.disconnect();
        await pg.disconnect();
    }
}

// ── 시나리오 5: 데이터베이스 전환 워크플로우 ─────────────

async function scenario5_DatabaseSwitching() {
    header('시나리오 5: MySQL 데이터베이스 전환 워크플로우');

    const mysql = new MySQLProvider(mysqlConfig);

    try {
        await mysql.connect();
        pass('MySQL 연결');

        // Step 1: 사용 가능한 데이터베이스 목록 조회
        const databases = await mysql.getDatabases();
        assert(databases.length > 0, `데이터베이스 ${databases.length}개 발견`);
        assert(databases.includes('mydb'), 'mydb 존재');
        assert(databases.includes('information_schema'), 'information_schema 존재');

        // Step 2: mydb에서 쿼리
        const mydbResult = await mysql.executeQuery('SELECT COUNT(*) AS cnt FROM users', 'mydb');
        assert(mydbResult.rows.length === 1, 'mydb.users 조회 성공');
        const userCount = Number(mydbResult.rows[0].cnt);
        assert(userCount > 0, `사용자 ${userCount}명 존재`);

        // Step 3: information_schema로 전환
        const schemaResult = await mysql.executeQuery(
            `SELECT TABLE_NAME FROM TABLES WHERE TABLE_SCHEMA = 'mydb' LIMIT 5`,
            'information_schema'
        );
        assert(schemaResult.rows.length > 0, 'information_schema 전환 후 조회 성공');

        // Step 4: 다시 mydb로 복귀
        const backResult = await mysql.executeQuery('SELECT 1 AS test', 'mydb');
        assert(backResult.rows.length === 1, 'mydb 복귀 성공');

        // Step 5: 파라미터화된 쿼리 + DB 전환 조합
        const paramQuery = 'SELECT TABLE_NAME FROM TABLES WHERE TABLE_SCHEMA = {{schema}} LIMIT {{limit}}';
        const substituted = substituteParameters(paramQuery, { schema: "'mydb'", limit: '3' });
        const paramResult = await mysql.executeQuery(substituted, 'information_schema');
        assert(paramResult.rows.length > 0, '파라미터 쿼리 + DB 전환 조합 성공');

        pass('데이터베이스 전환 시나리오 완료');

    } catch (err) {
        fail('데이터베이스 전환 오류', err);
    } finally {
        await mysql.disconnect();
    }
}

// ── 시나리오 6: 연결 해제 후 재연결 워크플로우 ──────────

async function scenario6_ReconnectWorkflow() {
    header('시나리오 6: 연결 해제 후 재연결');

    const mysql = new MySQLProvider(mysqlConfig);

    try {
        // 첫 번째 연결
        await mysql.connect();
        assert(mysql.isConnected(), '첫 번째 연결 성공');

        const result1 = await mysql.executeQuery('SELECT 1 AS session1');
        assert(result1.rows.length === 1, '첫 세션 쿼리 성공');

        // 연결 해제
        await mysql.disconnect();
        assert(!mysql.isConnected(), '연결 해제됨');

        // 재연결
        await mysql.connect();
        assert(mysql.isConnected(), '재연결 성공');

        const result2 = await mysql.executeQuery('SELECT 2 AS session2');
        assert(result2.rows.length === 1, '두 번째 세션 쿼리 성공');

        // 핀 상태는 유지 (핀은 클라이언트 측)
        let pinState = createDefaultTabPinState();
        pinState = pinResult(pinState, {
            query: 'SELECT 1',
            columns: ['session1'],
            rows: result1.rows,
            rowCount: 1,
            executionTime: 1,
            executedAt: new Date().toISOString(),
            connectionName: 'MySQL Dev',
            databaseName: 'mydb',
        });
        // 재연결 후에도 핀 데이터 유지
        assert(pinState.pinnedResults.length === 1, '재연결 후에도 핀 데이터 유지');
        assert(pinState.pinnedResults[0].query === 'SELECT 1', '핀 쿼리 보존');

        pass('재연결 워크플로우 완료');

    } catch (err) {
        fail('재연결 오류', err);
    } finally {
        await mysql.disconnect();
    }
}

// ── Main ─────────────────────────────────────────────────

async function main() {
    console.log('\n🎬 DBunny 사용자 시나리오 통합 테스트\n');

    await scenario1_DBAMonitoring();
    await scenario2_DeveloperParameterizedQuery();
    await scenario3_QACompareResults();
    await scenario4_MultiTabMultiDB();
    await scenario5_DatabaseSwitching();
    await scenario6_ReconnectWorkflow();

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
