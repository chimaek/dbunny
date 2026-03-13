/**
 * DBunny v2.1.0 — 쿼리 파라미터 통합 테스트
 *
 * Docker Compose DB (MySQL, PostgreSQL)에서 {{변수}} 치환 후 실제 쿼리 실행 검증
 *
 * 실행법: npx tsx src/test/integration/queryParameter.test.ts
 *
 * 사전 요구사항:
 *   docker compose up -d
 */

import { ConnectionConfig, DatabaseConnection } from '../../types/database';
import { MySQLProvider } from '../../providers/mysqlProvider';
import { PostgresProvider } from '../../providers/postgresProvider';
import {
    hasParameters,
    substituteParameters,
    getUniqueParameterNames
} from '../../utils/queryParameter';

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

// ── 테스트 실행 ──────────────────────────────────────────────

async function runTestsForDB(dbName: string, connection: DatabaseConnection) {
    header(`${dbName} — 파라미터 치환 후 쿼리 실행`);

    try {
        await connection.connect();
        pass(`${dbName} 연결 성공`);
    } catch (err) {
        fail(`${dbName} 연결 실패`, err);
        return;
    }

    try {
        // ── 테스트 테이블 생성 ──
        await connection.executeQuery(`
            CREATE TABLE IF NOT EXISTS param_test_users (
                id INT PRIMARY KEY,
                name VARCHAR(100),
                status VARCHAR(20),
                score INT
            )
        `);

        // 기존 데이터 삭제 후 삽입
        await connection.executeQuery('DELETE FROM param_test_users');
        await connection.executeQuery(`
            INSERT INTO param_test_users (id, name, status, score) VALUES
            (1, 'Alice', 'active', 95),
            (2, 'Bob', 'inactive', 80),
            (3, 'Charlie', 'active', 70),
            (4, 'Diana', 'active', 60),
            (5, 'Eve', 'inactive', 90)
        `);
        pass('테스트 테이블 및 데이터 준비');

        // ── 1. 단일 파라미터 치환 ──
        {
            const query = "SELECT * FROM param_test_users WHERE status = {{status}}";
            if (hasParameters(query)) {
                const substituted = substituteParameters(query, { status: "'active'" });
                const result = await connection.executeQuery(substituted);
                if (result.rows.length === 3) {
                    pass('단일 파라미터: status=active → 3행');
                } else {
                    fail(`단일 파라미터: expected 3 rows, got ${result.rows.length}`);
                }
            } else {
                fail('단일 파라미터: hasParameters가 false 반환');
            }
        }

        // ── 2. 다중 파라미터 치환 ──
        {
            const query = "SELECT * FROM param_test_users WHERE status = {{status}} AND score > {{min_score}}";
            const params = getUniqueParameterNames(query);
            if (params.length === 2 && params[0] === 'status' && params[1] === 'min_score') {
                pass('다중 파라미터 추출: status, min_score');
            } else {
                fail(`다중 파라미터 추출 실패: ${JSON.stringify(params)}`);
            }

            const substituted = substituteParameters(query, { status: "'active'", min_score: '60' });
            const result = await connection.executeQuery(substituted);
            if (result.rows.length === 2) {
                pass('다중 파라미터: active & score>60 → 2행 (Alice, Charlie)');
            } else {
                fail(`다중 파라미터: expected 2 rows, got ${result.rows.length}`);
            }
        }

        // ── 3. 같은 파라미터 여러 번 사용 ──
        {
            const query = "SELECT * FROM param_test_users WHERE score > {{threshold}} OR (score = {{threshold}} AND status = 'active')";
            const params = getUniqueParameterNames(query);
            if (params.length === 1 && params[0] === 'threshold') {
                pass('중복 파라미터: threshold 1개만 추출');
            } else {
                fail(`중복 파라미터 실패: ${JSON.stringify(params)}`);
            }

            const substituted = substituteParameters(query, { threshold: '90' });
            const result = await connection.executeQuery(substituted);
            // score > 90 → Alice(95), score = 90 AND active → 없음(Eve는 inactive) → 1행
            if (result.rows.length === 1) {
                pass('중복 파라미터 치환: score>90 OR (score=90 AND active) → 1행 (Alice)');
            } else {
                fail(`중복 파라미터: expected 1 row, got ${result.rows.length}`);
            }
        }

        // ── 4. 문자열 리터럴 내부 파라미터 무시 ──
        {
            const query = "SELECT * FROM param_test_users WHERE name = '{{not_param}}' OR id = {{real_id}}";
            const params = getUniqueParameterNames(query);
            if (params.length === 1 && params[0] === 'real_id') {
                pass('문자열 리터럴 내부 무시: real_id만 추출');
            } else {
                fail(`리터럴 무시 실패: ${JSON.stringify(params)}`);
            }

            const substituted = substituteParameters(query, { real_id: '1' });
            const result = await connection.executeQuery(substituted);
            if (result.rows.length === 1) {
                pass('리터럴 내부 무시 후 실행: id=1 → 1행');
            } else {
                fail(`리터럴 무시 쿼리: expected 1 rows, got ${result.rows.length}`);
            }
        }

        // ── 5. LIMIT 파라미터 ──
        {
            const query = "SELECT * FROM param_test_users ORDER BY id LIMIT {{limit_count}}";
            const substituted = substituteParameters(query, { limit_count: '2' });
            const result = await connection.executeQuery(substituted);
            if (result.rows.length === 2) {
                pass('LIMIT 파라미터: limit_count=2 → 2행');
            } else {
                fail(`LIMIT 파라미터: expected 2 rows, got ${result.rows.length}`);
            }
        }

        // ── 6. INSERT 파라미터 ──
        {
            const query = "INSERT INTO param_test_users (id, name, status, score) VALUES ({{id}}, {{name}}, {{status}}, {{score}})";
            const params = getUniqueParameterNames(query);
            if (params.length === 4) {
                pass('INSERT 파라미터: 4개 추출');
            } else {
                fail(`INSERT 파라미터: expected 4, got ${params.length}`);
            }

            const substituted = substituteParameters(query, {
                id: '100',
                name: "'TestUser'",
                status: "'active'",
                score: '55'
            });
            await connection.executeQuery(substituted);
            const check = await connection.executeQuery('SELECT * FROM param_test_users WHERE id = 100');
            if (check.rows.length === 1) {
                pass('INSERT 파라미터 치환 후 삽입 성공');
            } else {
                fail('INSERT 파라미터 치환 후 삽입 실패');
            }
        }

        // ── 7. UPDATE 파라미터 ──
        {
            const query = "UPDATE param_test_users SET score = {{new_score}} WHERE id = {{target_id}}";
            const substituted = substituteParameters(query, { new_score: '99', target_id: '100' });
            await connection.executeQuery(substituted);
            const check = await connection.executeQuery('SELECT score FROM param_test_users WHERE id = 100');
            const score = check.rows[0]?.score;
            if (Number(score) === 99) {
                pass('UPDATE 파라미터 치환 후 수정 성공');
            } else {
                fail(`UPDATE 파라미터: expected score 99, got ${score}`);
            }
        }

        // ── 8. DELETE 파라미터 ──
        {
            const query = "DELETE FROM param_test_users WHERE id = {{del_id}}";
            const substituted = substituteParameters(query, { del_id: '100' });
            await connection.executeQuery(substituted);
            const check = await connection.executeQuery('SELECT * FROM param_test_users WHERE id = 100');
            if (check.rows.length === 0) {
                pass('DELETE 파라미터 치환 후 삭제 성공');
            } else {
                fail('DELETE 파라미터 치환 후 삭제 실패');
            }
        }

        // ── 정리 ──
        await connection.executeQuery('DROP TABLE IF EXISTS param_test_users');
        pass('테스트 테이블 정리');

    } catch (err) {
        fail(`${dbName} 테스트 중 예외 발생`, err);
    } finally {
        try { await connection.disconnect(); } catch { /* ignore */ }
    }
}

// ── Main ──────────────────────────────────────────────────

async function main() {
    console.log('\n🐰 DBunny v2.1.0 — 쿼리 파라미터 통합 테스트');
    console.log('━'.repeat(60));

    // MySQL
    try {
        const mysql = new MySQLProvider(configs.mysql);
        await runTestsForDB('MySQL', mysql);
    } catch (err) {
        fail('MySQL 전체 실패', err);
    }

    // PostgreSQL
    try {
        const postgres = new PostgresProvider(configs.postgres);
        await runTestsForDB('PostgreSQL', postgres);
    } catch (err) {
        fail('PostgreSQL 전체 실패', err);
    }

    // ── 결과 출력 ──
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  Total: ${totalPass + totalFail} | ✅ Pass: ${totalPass} | ❌ Fail: ${totalFail}`);
    console.log(`${'═'.repeat(60)}`);

    if (totalFail > 0) {
        console.log('\n  Failed tests:');
        failures.forEach(f => console.log(`    - ${f}`));
        process.exit(1);
    }
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
