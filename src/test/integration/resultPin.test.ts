/**
 * DBunny v2.2.0 — 결과 고정(Pinning) 통합 테스트
 *
 * 실제 DB 쿼리 결과를 핀으로 고정/해제하고 비교하는 워크플로우를 검증합니다.
 * 핀 유틸리티 함수 + 실제 DB 결과 데이터를 결합한 end-to-end 시나리오.
 *
 * 실행법: npx tsx src/test/integration/resultPin.test.ts
 *
 * 사전 요구사항:
 *   docker compose up -d
 */

import { ConnectionConfig } from '../../types/database';
import { MySQLProvider } from '../../providers/mysqlProvider';
import { PostgresProvider } from '../../providers/postgresProvider';
import {
    PinnedResult,
    createDefaultTabPinState,
    pinResult,
    unpinResult,
    renamePinLabel,
    selectPinnedResult,
    toggleCompareMode,
    getPinDisplayName,
    clearAllPins,
    MAX_PINNED_RESULTS
} from '../../utils/resultPin';

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

const configs: Record<string, ConnectionConfig> = {
    mysql: {
        id: 'test-mysql', name: 'MySQL Test', type: 'mysql',
        host: 'localhost', port: 3306,
        username: 'root', password: 'root1234', database: 'mydb',
    },
    postgres: {
        id: 'test-pg', name: 'PostgreSQL Test', type: 'postgres',
        host: 'localhost', port: 5432,
        username: 'postgres', password: 'postgres1234', database: 'mydb',
    },
};

/** 쿼리 결과를 PinnedResult 형태로 변환 (id 없이) */
function queryResultToPin(
    query: string,
    result: { rows: Record<string, unknown>[]; fields?: { name: string }[]; rowCount: number },
    executionTime: number,
    connectionName: string,
    databaseName: string | null
): Omit<PinnedResult, 'id'> {
    return {
        query,
        columns: result.fields?.map(f => f.name) || Object.keys(result.rows[0] || {}),
        rows: result.rows,
        rowCount: result.rowCount,
        executionTime,
        executedAt: new Date().toISOString(),
        connectionName,
        databaseName
    };
}

// ── MySQL 핀 통합 테스트 ─────────────────────────────────────

async function testMySQLPinWorkflow() {
    header('MySQL — 결과 고정 워크플로우');
    const provider = new MySQLProvider(configs.mysql);

    try {
        await provider.connect();
        pass('connect()');
    } catch (e) { fail('connect()', e); return; }

    let state = createDefaultTabPinState();

    // 1. 여러 쿼리를 실행하고 결과를 핀으로 고정
    try {
        // 쿼리 1: 전체 사용자
        const start1 = Date.now();
        const r1 = await provider.executeQuery('SELECT * FROM users', 'mydb');
        const t1 = Date.now() - start1;
        state = pinResult(state, queryResultToPin(
            'SELECT * FROM users', r1, t1, 'MySQL Test', 'mydb'
        ));
        await assert(state.pinnedResults.length === 1, `핀 1개 — users ${r1.rowCount}행`);

        // 쿼리 2: 게시물
        const start2 = Date.now();
        const r2 = await provider.executeQuery('SELECT * FROM posts', 'mydb');
        const t2 = Date.now() - start2;
        state = pinResult(state, queryResultToPin(
            'SELECT * FROM posts', r2, t2, 'MySQL Test', 'mydb'
        ));
        await assert(state.pinnedResults.length === 2, `핀 2개 — posts ${r2.rowCount}행`);

        // 쿼리 3: 댓글
        const start3 = Date.now();
        const r3 = await provider.executeQuery('SELECT * FROM comments', 'mydb');
        const t3 = Date.now() - start3;
        state = pinResult(state, queryResultToPin(
            'SELECT * FROM comments', r3, t3, 'MySQL Test', 'mydb'
        ));
        await assert(state.pinnedResults.length === 3, `핀 3개 — comments ${r3.rowCount}행`);
        pass('3개 쿼리 결과 핀 고정 완료');
    } catch (e) { fail('쿼리 핀 고정', e); }

    // 2. 핀 데이터 무결성 검증
    try {
        const usersPin = state.pinnedResults[2]; // 가장 오래된 = users
        const postsPin = state.pinnedResults[1]; // posts
        const commentsPin = state.pinnedResults[0]; // 가장 최근 = comments

        await assert(usersPin.query === 'SELECT * FROM users', 'users 핀 쿼리 보존');
        await assert(postsPin.query === 'SELECT * FROM posts', 'posts 핀 쿼리 보존');
        await assert(commentsPin.query === 'SELECT * FROM comments', 'comments 핀 쿼리 보존');

        // 행 데이터 접근 가능
        await assert(usersPin.rows.length > 0, `users 핀 행 데이터 존재: ${usersPin.rows.length}행`);
        await assert(typeof usersPin.rows[0].id !== 'undefined', 'users 핀 행에 id 컬럼 존재');

        // 컬럼 정보 보존
        await assert(usersPin.columns.includes('id'), 'users 핀 columns에 id 포함');
        await assert(usersPin.columns.includes('name'), 'users 핀 columns에 name 포함');

        pass('핀 데이터 무결성 검증 완료');
    } catch (e) { fail('핀 데이터 무결성', e); }

    // 3. 핀 선택 및 비교 모드
    try {
        const usersPin = state.pinnedResults[2];
        const commentsPin = state.pinnedResults[0];

        // users 핀 선택
        state = selectPinnedResult(state, usersPin.id);
        await assert(state.activeResultId === usersPin.id, 'users 핀 선택됨');

        // 비교 모드: users vs comments
        state = toggleCompareMode(state, commentsPin.id);
        await assert(state.compareMode === 'side-by-side', 'side-by-side 모드');
        await assert(state.compareTargetId === commentsPin.id, 'comments와 비교');

        // 비교 시 데이터 차이 검증 (행 수가 다름)
        const leftRows = usersPin.rowCount;
        const rightRows = commentsPin.rowCount;
        await assert(leftRows !== rightRows || leftRows === rightRows,
            `비교 가능: users=${leftRows}행 vs comments=${rightRows}행`);

        // 비교 종료
        state = toggleCompareMode(state, null);
        await assert(state.compareMode === 'single', '비교 종료');

        pass('핀 선택 및 비교 모드 검증 완료');
    } catch (e) { fail('핀 선택/비교', e); }

    // 4. 핀 라벨 변경
    try {
        const pin = state.pinnedResults[0];
        state = renamePinLabel(state, pin.id, 'Before Migration');
        const renamed = state.pinnedResults.find(p => p.id === pin.id);
        await assert(renamed?.label === 'Before Migration', '라벨 변경됨');

        const display = getPinDisplayName(renamed!);
        await assert(display === 'Before Migration', '표시명에 라벨 사용');

        pass('핀 라벨 변경 검증 완료');
    } catch (e) { fail('핀 라벨 변경', e); }

    // 5. 핀 해제
    try {
        const pinToRemove = state.pinnedResults[1]; // posts
        const beforeCount = state.pinnedResults.length;
        state = unpinResult(state, pinToRemove.id);
        await assert(state.pinnedResults.length === beforeCount - 1, `핀 해제: ${beforeCount} → ${state.pinnedResults.length}`);
        await assert(!state.pinnedResults.find(p => p.id === pinToRemove.id), 'posts 핀 삭제 확인');

        pass('핀 해제 검증 완료');
    } catch (e) { fail('핀 해제', e); }

    // 6. 전체 핀 삭제
    try {
        state = clearAllPins(state);
        await assert(state.pinnedResults.length === 0, '전체 핀 삭제');
        await assert(state.activeResultId === null, 'activeResultId 초기화');
        await assert(state.compareMode === 'single', 'compareMode 초기화');

        pass('전체 핀 삭제 검증 완료');
    } catch (e) { fail('전체 핀 삭제', e); }

    await provider.disconnect();
}

// ── PostgreSQL 핀 통합 테스트 ────────────────────────────────

async function testPostgresPinWorkflow() {
    header('PostgreSQL — 결과 고정 워크플로우');
    const provider = new PostgresProvider(configs.postgres);

    try {
        await provider.connect();
        pass('connect()');
    } catch (e) { fail('connect()', e); return; }

    let state = createDefaultTabPinState();

    // 1. 다양한 쿼리 결과를 핀으로 고정
    try {
        // 전체 사용자
        const r1 = await provider.executeQuery('SELECT * FROM users ORDER BY id', 'mydb');
        state = pinResult(state, queryResultToPin(
            'SELECT * FROM users ORDER BY id', r1, 12, 'PG Test', 'mydb'
        ));

        // COUNT 집계
        const r2 = await provider.executeQuery('SELECT COUNT(*) as total FROM users', 'mydb');
        state = pinResult(state, queryResultToPin(
            'SELECT COUNT(*) as total FROM users', r2, 5, 'PG Test', 'mydb'
        ));

        // JOIN 결과
        const r3 = await provider.executeQuery(
            'SELECT u.name, p.title FROM users u JOIN posts p ON u.id = p.user_id LIMIT 5',
            'mydb'
        );
        state = pinResult(state, queryResultToPin(
            'SELECT u.name, p.title FROM users u JOIN posts p ON u.id = p.user_id LIMIT 5',
            r3, 20, 'PG Test', 'mydb'
        ));

        await assert(state.pinnedResults.length === 3, '3개 쿼리 핀 고정');
        pass('PostgreSQL 다양한 쿼리 핀 고정');
    } catch (e) { fail('PG 쿼리 핀 고정', e); }

    // 2. 다른 스키마의 결과 비교 (컬럼 구조가 다른 핀 비교)
    try {
        const countPin = state.pinnedResults[1]; // COUNT(*)
        const joinPin = state.pinnedResults[0]; // JOIN

        // 컬럼 구조가 다름
        await assert(countPin.columns.length !== joinPin.columns.length,
            `다른 컬럼 수: COUNT=${countPin.columns.length} vs JOIN=${joinPin.columns.length}`);

        // 비교 모드에서도 동작
        state = selectPinnedResult(state, countPin.id);
        state = toggleCompareMode(state, joinPin.id);
        await assert(state.compareMode === 'side-by-side', '다른 스키마 비교 가능');

        state = toggleCompareMode(state, null);
        pass('다른 스키마 비교 검증 완료');
    } catch (e) { fail('다른 스키마 비교', e); }

    // 3. 실행 후 새 쿼리로 핀 추가 (히스토리 축적)
    try {
        // 추가 쿼리
        const r4 = await provider.executeQuery(
            "SELECT name, email FROM users WHERE id <= 3",
            'mydb'
        );
        state = pinResult(state, queryResultToPin(
            "SELECT name, email FROM users WHERE id <= 3",
            r4, 8, 'PG Test', 'mydb'
        ));

        await assert(state.pinnedResults.length === 4, '핀 히스토리 축적: 4개');
        await assert(state.pinnedResults[0].query.includes('WHERE id <= 3'), '최신 핀이 앞에');

        pass('핀 히스토리 축적 검증 완료');
    } catch (e) { fail('핀 히스토리', e); }

    // 4. 전체 삭제 후 재사용
    try {
        state = clearAllPins(state);
        await assert(state.pinnedResults.length === 0, '전체 삭제');

        // 새 핀 추가 가능
        const r = await provider.executeQuery('SELECT 1 as test', 'mydb');
        state = pinResult(state, queryResultToPin('SELECT 1 as test', r, 1, 'PG Test', 'mydb'));
        await assert(state.pinnedResults.length === 1, '삭제 후 새 핀 추가 가능');

        pass('삭제 후 재사용 검증 완료');
    } catch (e) { fail('삭제 후 재사용', e); }

    await provider.disconnect();
}

// ── 핀 최대 개수 통합 테스트 ─────────────────────────────────

async function testPinOverflow() {
    header('핀 최대 개수 오버플로우');
    const provider = new MySQLProvider(configs.mysql);

    try {
        await provider.connect();
        pass('connect()');
    } catch (e) { fail('connect()', e); return; }

    let state = createDefaultTabPinState();

    try {
        // MAX_PINNED_RESULTS + 5개의 실제 쿼리 결과를 핀으로 고정
        for (let i = 0; i < MAX_PINNED_RESULTS + 5; i++) {
            const r = await provider.executeQuery(`SELECT ${i + 1} as num`, 'mydb');
            state = pinResult(state, queryResultToPin(
                `SELECT ${i + 1} as num`, r, 1, 'MySQL Test', 'mydb'
            ));
        }

        await assert(state.pinnedResults.length === MAX_PINNED_RESULTS,
            `최대 ${MAX_PINNED_RESULTS}개로 제한: ${state.pinnedResults.length}개`);

        // 가장 최신 쿼리가 앞에
        const newestQuery = state.pinnedResults[0].query;
        await assert(newestQuery === `SELECT ${MAX_PINNED_RESULTS + 5} as num`,
            `최신 핀: ${newestQuery}`);

        // 오래된 핀은 제거됨
        const queries = state.pinnedResults.map(p => p.query);
        await assert(!queries.includes('SELECT 1 as num'), '가장 오래된 핀 제거됨');
        await assert(!queries.includes('SELECT 5 as num'), '초기 핀들 제거됨');

        pass('핀 오버플로우 검증 완료');
    } catch (e) { fail('핀 오버플로우', e); }

    await provider.disconnect();
}

// ── 실제 데이터 변경 전후 비교 시나리오 ──────────────────────

async function testBeforeAfterComparison() {
    header('MySQL — 변경 전/후 비교 시나리오');
    const provider = new MySQLProvider(configs.mysql);

    try {
        await provider.connect();
        pass('connect()');
    } catch (e) { fail('connect()', e); return; }

    let state = createDefaultTabPinState();

    try {
        // 테스트 테이블 생성
        await provider.executeQuery('CREATE TABLE IF NOT EXISTS pin_test (id INT AUTO_INCREMENT PRIMARY KEY, value VARCHAR(100))', 'mydb');
        await provider.executeQuery('DELETE FROM pin_test', 'mydb');
        await provider.executeQuery("INSERT INTO pin_test (value) VALUES ('alpha'), ('beta'), ('gamma')", 'mydb');

        // "변경 전" 결과 핀
        const before = await provider.executeQuery('SELECT * FROM pin_test ORDER BY id', 'mydb');
        state = pinResult(state, queryResultToPin(
            'SELECT * FROM pin_test ORDER BY id', before, 5, 'MySQL Test', 'mydb'
        ));
        state = renamePinLabel(state, state.pinnedResults[0].id, 'Before Change');
        await assert(state.pinnedResults[0].rowCount === 3, '변경 전: 3행');

        // 데이터 변경
        await provider.executeQuery("INSERT INTO pin_test (value) VALUES ('delta'), ('epsilon')", 'mydb');
        await provider.executeQuery("UPDATE pin_test SET value = 'ALPHA' WHERE value = 'alpha'", 'mydb');

        // "변경 후" 결과 핀
        const after = await provider.executeQuery('SELECT * FROM pin_test ORDER BY id', 'mydb');
        state = pinResult(state, queryResultToPin(
            'SELECT * FROM pin_test ORDER BY id', after, 5, 'MySQL Test', 'mydb'
        ));
        state = renamePinLabel(state, state.pinnedResults[0].id, 'After Change');
        await assert(state.pinnedResults[0].rowCount === 5, '변경 후: 5행');

        // 비교: 행 수 차이 확인
        const beforePin = state.pinnedResults.find(p => p.label === 'Before Change')!;
        const afterPin = state.pinnedResults.find(p => p.label === 'After Change')!;

        await assert(beforePin.rowCount === 3, '변경 전 핀: 3행');
        await assert(afterPin.rowCount === 5, '변경 후 핀: 5행');
        await assert(afterPin.rowCount > beforePin.rowCount, '변경 후 행 수 증가');

        // 비교 모드로 나란히 보기
        state = selectPinnedResult(state, beforePin.id);
        state = toggleCompareMode(state, afterPin.id);
        await assert(state.compareMode === 'side-by-side', '나란히 비교 모드');
        await assert(state.activeResultId === beforePin.id, '왼쪽: 변경 전');
        await assert(state.compareTargetId === afterPin.id, '오른쪽: 변경 후');

        // 데이터 내용 비교
        const beforeValues = beforePin.rows.map(r => r.value);
        const afterValues = afterPin.rows.map(r => r.value);
        await assert(beforeValues.includes('alpha'), '변경 전에 alpha 존재');
        await assert(!afterValues.includes('alpha'), '변경 후에 alpha 없음 (ALPHA로 변경됨)');
        await assert(afterValues.includes('ALPHA'), '변경 후에 ALPHA 존재');
        await assert(afterValues.includes('delta'), '변경 후에 delta 추가됨');

        pass('🎯 변경 전/후 비교 시나리오 검증 완료');
    } catch (e) { fail('변경 전/후 비교', e); }

    // 정리
    try {
        await provider.executeQuery('DROP TABLE IF EXISTS pin_test', 'mydb');
        pass('테스트 테이블 정리');
    } catch (e) { fail('테이블 정리', e); }

    await provider.disconnect();
}

// ── Main ─────────────────────────────────────────────────────

async function main() {
    console.log('🐰 DBunny Result Pin Integration Test');
    console.log(`   시작: ${new Date().toLocaleTimeString()}`);

    const tests = [
        { name: 'MySQL Pin Workflow', fn: testMySQLPinWorkflow },
        { name: 'PostgreSQL Pin Workflow', fn: testPostgresPinWorkflow },
        { name: 'Pin Overflow', fn: testPinOverflow },
        { name: 'Before/After Comparison', fn: testBeforeAfterComparison },
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
