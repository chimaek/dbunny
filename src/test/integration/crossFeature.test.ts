/**
 * DBunny 기능 간 연동 통합 테스트
 *
 * 읽기 전용 모드 + 파라미터화된 쿼리 + 결과 핀 + SQL 파서가
 * 함께 동작할 때의 정합성을 검증합니다.
 *
 * 실행법: npx tsx src/test/integration/crossFeature.test.ts
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
} from '../../utils/queryParameter';
import {
    createDefaultTabPinState,
    pinResult,
    selectPinnedResult,
    toggleCompareMode,
    getPinDisplayName,
    TabPinState
} from '../../utils/resultPin';
import {
    parseSQL,
    extractTableReferences,
    extractJoinClauses
} from '../../utils/sqlParser';

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
    id: 'cross-mysql', name: 'MySQL Cross', type: 'mysql',
    host: 'localhost', port: 3306,
    username: 'root', password: 'root1234', database: 'mydb',
};

const pgConfig: ConnectionConfig = {
    id: 'cross-pg', name: 'PG Cross', type: 'postgres',
    host: 'localhost', port: 5432,
    username: 'postgres', password: 'postgres1234', database: 'mydb',
};

// ── 읽기 전용 + 파라미터 쿼리 ────────────────────────────

async function testReadOnlyWithParameters() {
    header('읽기 전용 + 파라미터화된 쿼리');

    const mysql = new MySQLProvider({
        ...mysqlConfig,
        id: 'cross-ro-param',
        readOnly: true,
    });

    try {
        await mysql.connect();
        pass('읽기 전용 연결');

        // 파라미터가 있는 SELECT 쿼리 — 읽기 전용에서 허용
        const template = 'SELECT * FROM users WHERE id = {{user_id}} LIMIT {{limit}}';

        // Step 1: 파라미터 추출
        const params = extractParameters(template);
        assert(params.length === 2, '파라미터 2개 추출');

        // Step 2: 치환
        const query = substituteParameters(template, { user_id: '1', limit: '5' });
        assert(!hasParameters(query), '파라미터 치환 완료');

        // Step 3: 읽기 전용 가드 검사
        const check = checkWriteOperation(query, 'mysql');
        assert(check.isWrite === false, 'SELECT 파라미터 쿼리는 읽기');

        // Step 4: 실행
        const result = await mysql.executeQuery(query);
        assert(result.rows.length >= 0, '파라미터 쿼리 실행 성공');

        // 파라미터가 있는 INSERT 쿼리 — 읽기 전용에서 차단
        const writeTemplate = 'INSERT INTO users (name) VALUES ({{name}})';
        const writeQuery = substituteParameters(writeTemplate, { name: "'test'" });
        const writeCheck = checkWriteOperation(writeQuery, 'mysql');
        assert(writeCheck.isWrite === true, 'INSERT 파라미터 쿼리는 쓰기 → 차단');

        pass('읽기 전용 + 파라미터 테스트 완료');

    } catch (err) {
        fail('읽기 전용 + 파라미터 오류', err);
    } finally {
        await mysql.disconnect();
    }
}

// ── 파라미터 쿼리 + 결과 핀 ──────────────────────────────

async function testParameterWithPinning() {
    header('파라미터 쿼리 + 결과 핀');

    const pg = new PostgresProvider(pgConfig);

    try {
        await pg.connect();
        pass('PostgreSQL 연결');

        // 테이블 준비
        await pg.executeQuery('DROP TABLE IF EXISTS cross_sales');
        await pg.executeQuery(`
            CREATE TABLE cross_sales (
                id SERIAL PRIMARY KEY,
                region VARCHAR(20),
                product VARCHAR(50),
                amount NUMERIC(10,2)
            )
        `);
        await pg.executeQuery(`
            INSERT INTO cross_sales (region, product, amount) VALUES
            ('Seoul', 'Widget A', 100), ('Seoul', 'Widget B', 200),
            ('Busan', 'Widget A', 150), ('Busan', 'Widget B', 50),
            ('Daejeon', 'Widget A', 75), ('Daejeon', 'Widget C', 300)
        `);
        pass('판매 데이터 준비');

        // Step 1: 지역별 파라미터 쿼리 실행 + 핀
        let pinState: TabPinState = createDefaultTabPinState();

        const template = 'SELECT product, SUM(amount) AS total FROM cross_sales WHERE region = {{region}} GROUP BY product ORDER BY total DESC';

        const regions = [
            { name: 'Seoul', var: "$$Seoul$$" },
            { name: 'Busan', var: "$$Busan$$" },
        ];

        for (const reg of regions) {
            const query = substituteParameters(template, { region: reg.var });
            const result = await pg.executeQuery(query);

            pinState = pinResult(pinState, {
                query,
                columns: ['product', 'total'],
                rows: result.rows,
                rowCount: result.rows.length,
                executionTime: 2,
                executedAt: new Date().toISOString(),
                connectionName: 'PG Cross',
                databaseName: 'mydb',
                label: `${reg.name} 매출`,
            });
        }

        assert(pinState.pinnedResults.length === 2, '2개 지역 결과 핀 고정');

        // Step 2: 나란히 비교
        const seoulPin = pinState.pinnedResults.find(p => p.label === 'Seoul 매출')!;
        const busanPin = pinState.pinnedResults.find(p => p.label === 'Busan 매출')!;

        pinState = selectPinnedResult(pinState, seoulPin.id);
        pinState = toggleCompareMode(pinState, busanPin.id);
        assert(pinState.compareMode === 'side-by-side', 'Seoul vs Busan 비교');

        // Step 3: 데이터 비교
        const seoulTotal = seoulPin.rows.reduce((sum: number, r: Record<string, unknown>) => sum + Number(r.total), 0);
        const busanTotal = busanPin.rows.reduce((sum: number, r: Record<string, unknown>) => sum + Number(r.total), 0);
        assert(seoulTotal === 300, 'Seoul 총 매출 = 300');
        assert(busanTotal === 200, 'Busan 총 매출 = 200');
        assert(seoulTotal > busanTotal, 'Seoul 매출 > Busan 매출');

        // Step 4: 핀 라벨에서 표시명 확인
        assert(getPinDisplayName(seoulPin) === 'Seoul 매출', '핀 표시명: Seoul 매출');

        await pg.executeQuery('DROP TABLE IF EXISTS cross_sales');
        pass('파라미터 + 핀 테스트 완료');

    } catch (err) {
        fail('파라미터 + 핀 오류', err);
    } finally {
        await pg.disconnect();
    }
}

// ── SQL 파서 + 실제 DB 자동완성 검증 ────────────────────

async function testSQLParserWithRealDB() {
    header('SQL 파서 + 실제 DB 테이블/컬럼 검증');

    const mysql = new MySQLProvider(mysqlConfig);

    try {
        await mysql.connect();
        pass('MySQL 연결');

        // Step 1: 실제 테이블 목록 가져오기
        const tables = await mysql.getTables('mydb');
        assert(tables.length > 0, `테이블 ${tables.length}개 존재`);

        // Step 2: SQL 파서로 쿼리 분석 → 테이블이 실제 존재하는지 검증
        const sql = 'SELECT u.name FROM users u WHERE u.';
        const parseResult = parseSQL(sql, sql.length);

        assert(parseResult.cursorContext.type === 'ALIAS_DOT', '커서 컨텍스트: ALIAS_DOT');
        if (parseResult.cursorContext.type === 'ALIAS_DOT') {
            assert(parseResult.cursorContext.alias === 'u', 'alias: u');
        }

        // aliasMap에서 테이블 이름 확인
        const resolvedTable = parseResult.aliasMap.get('u');
        assert(resolvedTable === 'users', 'u → users 매핑');

        // 실제 테이블이 존재하는지 확인
        assert(tables.includes('users'), 'users 테이블 실제 존재');

        // Step 3: 실제 컬럼 목록으로 자동완성 시뮬레이션
        const columns = await mysql.getTableSchema('users');
        assert(columns.length > 0, `users 테이블 컬럼 ${columns.length}개`);

        const columnNames = columns.map(c => c.name);
        assert(columnNames.includes('id'), 'id 컬럼 존재');
        assert(columnNames.includes('name'), 'name 컬럼 존재');

        // Step 4: JOIN 쿼리 파서 + FK 검증
        if (tables.includes('posts')) {
            const joinSql = 'SELECT * FROM users u JOIN posts p ON ';
            const joinResult = parseSQL(joinSql, joinSql.length);

            assert(joinResult.cursorContext.type === 'JOIN_ON', 'JOIN ON 컨텍스트');
            assert(joinResult.joins.length === 1, 'JOIN 1개 감지');
            assert(joinResult.joins[0].table.table === 'posts', 'JOIN 테이블: posts');

            // FK 기반 자동완성 검증
            const fks = await mysql.getForeignKeys('posts');
            if (fks.length > 0) {
                const userFk = fks.find(f => f.referencedTable === 'users');
                if (userFk) {
                    pass(`FK 발견: posts.${userFk.columnName} → users.${userFk.referencedColumn}`);
                } else {
                    pass('posts 테이블에 users 참조 FK 없음 (스키마에 따라 다름)');
                }
            }
        }

        // Step 5: extractTableReferences로 다중 테이블 추출
        const multiSql = 'SELECT * FROM users u, posts p WHERE u.id = p.user_id';
        const refs = extractTableReferences(multiSql);
        assert(refs.length === 2, '다중 테이블 2개 추출');

        // Step 6: extractJoinClauses
        const joinClauseSql = 'SELECT * FROM users u INNER JOIN posts p ON u.id = p.user_id LEFT JOIN comments c ON p.id = c.post_id';
        const joins = extractJoinClauses(joinClauseSql);
        assert(joins.length === 2, '2개 JOIN 절 추출');
        assert(joins[0].type === 'INNER JOIN', '첫 번째: INNER JOIN');
        assert(joins[1].type === 'LEFT JOIN', '두 번째: LEFT JOIN');

        pass('SQL 파서 + 실제 DB 테스트 완료');

    } catch (err) {
        fail('SQL 파서 + 실제 DB 오류', err);
    } finally {
        await mysql.disconnect();
    }
}

// ── 읽기 전용 + 핀 + 파라미터 전체 워크플로우 ──────────

async function testFullWorkflow() {
    header('전체 워크플로우: 읽기 전용 + 파라미터 + 핀 + 파서');

    const mysql = new MySQLProvider({
        ...mysqlConfig,
        id: 'cross-full',
        name: 'Production MySQL',
        readOnly: true,
    });

    try {
        await mysql.connect();
        pass('프로덕션 DB 읽기 전용 연결');

        // 시나리오: DBA가 프로덕션 DB를 읽기 전용으로 연결하여
        //          파라미터화된 쿼리로 분석하고 결과를 핀으로 비교

        // Step 1: 파라미터 템플릿 작성
        const template = 'SELECT COUNT(*) AS cnt FROM information_schema.tables WHERE table_schema = {{schema}}';
        assert(hasParameters(template), '템플릿에 파라미터 존재');

        // Step 2: SQL 파서로 구조 분석
        const cursorPos = 'SELECT COUNT(*) AS cnt FROM information_schema.tables WHERE '.length;
        const parseResult = parseSQL(template, cursorPos);
        assert(parseResult.cursorContext.type === 'WHERE', '커서: WHERE 절');

        // Step 3: 읽기 전용 가드 검사
        const query = substituteParameters(template, { schema: "'mydb'" });
        const guard = checkWriteOperation(query, 'mysql');
        assert(guard.isWrite === false, '분석 쿼리는 읽기 → 허용');

        // Step 4: 쿼리 실행 + 결과 핀
        const result = await mysql.executeQuery(query);
        assert(result.rows.length === 1, '쿼리 실행 성공');

        let pinState: TabPinState = createDefaultTabPinState();
        pinState = pinResult(pinState, {
            query,
            columns: ['cnt'],
            rows: result.rows,
            rowCount: result.rows.length,
            executionTime: 3,
            executedAt: new Date().toISOString(),
            connectionName: 'Production MySQL',
            databaseName: 'information_schema',
            label: 'mydb 테이블 수',
        });

        // Step 5: 다른 스키마도 조회 + 핀
        const query2 = substituteParameters(template, { schema: "'information_schema'" });
        const result2 = await mysql.executeQuery(query2);
        pinState = pinResult(pinState, {
            query: query2,
            columns: ['cnt'],
            rows: result2.rows,
            rowCount: result2.rows.length,
            executionTime: 2,
            executedAt: new Date().toISOString(),
            connectionName: 'Production MySQL',
            databaseName: 'information_schema',
            label: 'info_schema 테이블 수',
        });

        assert(pinState.pinnedResults.length === 2, '2개 스키마 결과 핀');

        // Step 6: 비교
        const pin1 = pinState.pinnedResults.find(p => p.label === 'mydb 테이블 수')!;
        const pin2 = pinState.pinnedResults.find(p => p.label === 'info_schema 테이블 수')!;

        pinState = selectPinnedResult(pinState, pin1.id);
        pinState = toggleCompareMode(pinState, pin2.id);
        assert(pinState.compareMode === 'side-by-side', '스키마 간 비교');

        const mydbCount = Number(pin1.rows[0].cnt);
        const infoCount = Number(pin2.rows[0].cnt);
        assert(mydbCount > 0, `mydb 테이블 수: ${mydbCount}`);
        assert(infoCount > 0, `information_schema 테이블 수: ${infoCount}`);
        assert(infoCount > mydbCount, 'information_schema가 더 많은 테이블 보유');

        // Step 7: 쓰기 시도 차단 확인
        const writeAttempt = 'DROP TABLE users';
        const writeGuard = checkWriteOperation(writeAttempt, 'mysql');
        assert(writeGuard.isWrite === true, '프로덕션 DB DROP 시도 차단');

        pass('전체 워크플로우 테스트 완료');

    } catch (err) {
        fail('전체 워크플로우 오류', err);
    } finally {
        await mysql.disconnect();
    }
}

// ── Main ─────────────────────────────────────────────────

async function main() {
    console.log('\n🔗 DBunny 기능 간 연동 통합 테스트\n');

    await testReadOnlyWithParameters();
    await testParameterWithPinning();
    await testSQLParserWithRealDB();
    await testFullWorkflow();

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
