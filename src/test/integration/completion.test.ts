/**
 * DBunny v2.0.0 — SQL 자동완성 고도화 통합 테스트
 *
 * Docker Compose DB (MySQL, PostgreSQL)의 실제 스키마/FK를 사용하여
 * 별칭 인식, JOIN FK 제안, 서브쿼리 컨텍스트, 다중 테이블 컬럼 구분을 검증
 *
 * 실행법: npx tsx src/test/integration/completion.test.ts
 *
 * 사전 요구사항:
 *   docker compose up -d
 */

import { ConnectionConfig, DatabaseConnection } from '../../types/database';
import { MySQLProvider } from '../../providers/mysqlProvider';
import { PostgresProvider } from '../../providers/postgresProvider';
import { parseSQL } from '../../utils/sqlParser';

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

// ── 공통 자동완성 시뮬레이션 ─────────────────────────────────

/**
 * completionProvider 로직을 DB 연결로 시뮬레이션
 * (vscode API 없이 핵심 로직만 검증)
 */
async function simulateCompletion(
    connection: DatabaseConnection,
    sql: string,
    cursorPos?: number,
): Promise<{
    context: string;
    alias?: string;
    tables: string[];
    columns: string[];
    fkSuggestions: string[];
}> {
    const pos = cursorPos ?? sql.length;
    const result = parseSQL(sql, pos);

    const columns: string[] = [];
    const fkSuggestions: string[] = [];

    const ctx = result.cursorContext;

    if (ctx.type === 'ALIAS_DOT') {
        // 별칭의 실제 테이블에서 컬럼 조회
        const tableName = result.aliasMap.get(ctx.alias.toLowerCase());
        if (tableName) {
            const schema = await connection.getTableSchema(tableName);
            columns.push(...schema.map(c => c.name));
        }
    }

    if (ctx.type === 'JOIN_ON') {
        // FK 기반 JOIN 조건 제안
        const joinTable = ctx.joinTable;
        const joinAlias = joinTable.alias || joinTable.table;

        if (connection.getForeignKeys) {
            // 정방향: JOIN 테이블의 FK → FROM 테이블 참조
            const joinFKs = await connection.getForeignKeys(joinTable.table);
            for (const fk of joinFKs) {
                const referencedRef = result.tables.find(
                    t => t.table.toLowerCase() === fk.referencedTable.toLowerCase()
                );
                if (referencedRef) {
                    const refAlias = referencedRef.alias || referencedRef.table;
                    fkSuggestions.push(
                        `${joinAlias}.${fk.columnName} = ${refAlias}.${fk.referencedColumn}`
                    );
                }
            }

            // 역방향: FROM 테이블의 FK → JOIN 테이블 참조
            for (const ref of result.tables) {
                if (ref.table.toLowerCase() === joinTable.table.toLowerCase()) { continue; }
                const refFKs = await connection.getForeignKeys(ref.table);
                const refAlias = ref.alias || ref.table;
                for (const fk of refFKs) {
                    if (fk.referencedTable.toLowerCase() === joinTable.table.toLowerCase()) {
                        fkSuggestions.push(
                            `${refAlias}.${fk.columnName} = ${joinAlias}.${fk.referencedColumn}`
                        );
                    }
                }
            }
        }
    }

    if (ctx.type === 'SELECT_COLUMNS' || ctx.type === 'WHERE') {
        // 모든 참조된 테이블의 컬럼
        for (const ref of result.tables) {
            const schema = await connection.getTableSchema(ref.table);
            const prefix = ref.alias || ref.table;
            columns.push(...schema.map(c => `${prefix}.${c.name}`));
        }
    }

    return {
        context: ctx.type,
        alias: ctx.type === 'ALIAS_DOT' ? (ctx as any).alias : undefined,
        tables: result.tables.map(t => t.table),
        columns,
        fkSuggestions,
    };
}

// ── MySQL 자동완성 테스트 ────────────────────────────────────

async function testMySQLCompletion() {
    header('MySQL — SQL 자동완성 고도화 (v2.0.0)');
    const provider = new MySQLProvider(configs.mysql);

    try {
        await provider.connect();
        pass('connect()');
    } catch (e) { fail('connect()', e); return; }

    // 1. 별칭(Alias) 인식
    header('  1. 별칭(Alias) 인식');
    try {
        const res = await simulateCompletion(provider, 'SELECT u. FROM users u', 'SELECT u.'.length);
        await assert(res.context === 'ALIAS_DOT', `컨텍스트: ALIAS_DOT (got ${res.context})`);
        await assert(res.columns.includes('id'), `u. → users.id 제안됨`);
        await assert(res.columns.includes('name'), `u. → users.name 제안됨`);
        await assert(res.columns.includes('email'), `u. → users.email 제안됨`);
    } catch (e) { fail('별칭 인식', e); }

    // 2. JOIN ON FK 기반 자동 제안
    header('  2. JOIN ON FK 기반 자동 제안');
    try {
        const sql = 'SELECT * FROM users u JOIN posts p ON ';
        const res = await simulateCompletion(provider, sql);
        await assert(res.context === 'JOIN_ON', `컨텍스트: JOIN_ON (got ${res.context})`);
        await assert(res.fkSuggestions.length >= 1, `FK 제안 ${res.fkSuggestions.length}개`);
        // posts.user_id → users.id
        const hasFKSuggestion = res.fkSuggestions.some(
            s => s.includes('user_id') && s.includes('id')
        );
        await assert(hasFKSuggestion, `FK: posts.user_id = users.id 제안 (got: ${res.fkSuggestions.join(', ')})`);
    } catch (e) { fail('JOIN ON FK', e); }

    // comments → posts FK
    try {
        const sql = 'SELECT * FROM posts p JOIN comments c ON ';
        const res = await simulateCompletion(provider, sql);
        const hasFKSuggestion = res.fkSuggestions.some(
            s => s.includes('post_id') && s.includes('id')
        );
        await assert(hasFKSuggestion, `FK: comments.post_id = posts.id 제안 (got: ${res.fkSuggestions.join(', ')})`);
    } catch (e) { fail('JOIN ON FK (comments→posts)', e); }

    // 3. 서브쿼리 컨텍스트 인식
    header('  3. 서브쿼리 컨텍스트 인식');
    try {
        const sql = 'SELECT * FROM (SELECT p. FROM posts p) sub';
        const cursorPos = 'SELECT * FROM (SELECT p.'.length;
        const res = await simulateCompletion(provider, sql, cursorPos);
        await assert(res.context === 'ALIAS_DOT', `서브쿼리 내 ALIAS_DOT (got ${res.context})`);
        await assert(res.columns.includes('title'), `서브쿼리 내 p. → posts.title 제안`);
        await assert(res.columns.includes('user_id'), `서브쿼리 내 p. → posts.user_id 제안`);
    } catch (e) { fail('서브쿼리 컨텍스트', e); }

    // 4. 다중 테이블 참조 시 컬럼 자동 구분
    header('  4. 다중 테이블 컬럼 구분');
    try {
        const sql = 'SELECT  FROM users u, posts p';
        const cursorPos = 'SELECT '.length;
        const res = await simulateCompletion(provider, sql, cursorPos);
        await assert(res.tables.length >= 2, `참조 테이블: ${res.tables.length}개`);
        // 접두사가 포함된 컬럼
        const hasUserCol = res.columns.some(c => c.startsWith('u.'));
        const hasPostCol = res.columns.some(c => c.startsWith('p.'));
        await assert(hasUserCol, `u.* 컬럼 포함`);
        await assert(hasPostCol, `p.* 컬럼 포함`);
    } catch (e) { fail('다중 테이블 컬럼 구분', e); }

    try {
        await provider.disconnect();
        pass('disconnect()');
    } catch (e) { fail('disconnect()', e); }
}

// ── PostgreSQL 자동완성 테스트 ───────────────────────────────

async function testPostgresCompletion() {
    header('PostgreSQL — SQL 자동완성 고도화 (v2.0.0)');
    const provider = new PostgresProvider(configs.postgres);

    try {
        await provider.connect();
        pass('connect()');
    } catch (e) { fail('connect()', e); return; }

    // 1. 별칭 인식
    header('  1. 별칭(Alias) 인식');
    try {
        const res = await simulateCompletion(provider, 'SELECT u. FROM users u', 'SELECT u.'.length);
        await assert(res.context === 'ALIAS_DOT', `컨텍스트: ALIAS_DOT`);
        await assert(res.columns.includes('id'), `u. → users.id 제안됨`);
        await assert(res.columns.includes('name'), `u. → users.name 제안됨`);
    } catch (e) { fail('별칭 인식', e); }

    // 2. JOIN ON FK 기반 제안
    header('  2. JOIN ON FK 기반 자동 제안');
    try {
        const sql = 'SELECT * FROM users u JOIN posts p ON ';
        const res = await simulateCompletion(provider, sql);
        await assert(res.context === 'JOIN_ON', `컨텍스트: JOIN_ON`);
        await assert(res.fkSuggestions.length >= 1, `FK 제안 ${res.fkSuggestions.length}개`);
        const hasFKSuggestion = res.fkSuggestions.some(
            s => s.includes('user_id') && s.includes('id')
        );
        await assert(hasFKSuggestion, `FK: posts.user_id = users.id 제안 (got: ${res.fkSuggestions.join(', ')})`);
    } catch (e) { fail('JOIN ON FK', e); }

    // post_tags 다중 FK
    try {
        const sql = 'SELECT * FROM posts p JOIN post_tags pt ON ';
        const res = await simulateCompletion(provider, sql);
        const hasFKSuggestion = res.fkSuggestions.some(
            s => s.includes('post_id')
        );
        await assert(hasFKSuggestion, `FK: post_tags.post_id = posts.id 제안 (got: ${res.fkSuggestions.join(', ')})`);
    } catch (e) { fail('JOIN ON FK (post_tags→posts)', e); }

    // 3. 서브쿼리
    header('  3. 서브쿼리 컨텍스트 인식');
    try {
        const sql = 'SELECT * FROM (SELECT p. FROM posts p) sub';
        const cursorPos = 'SELECT * FROM (SELECT p.'.length;
        const res = await simulateCompletion(provider, sql, cursorPos);
        await assert(res.context === 'ALIAS_DOT', `서브쿼리 내 ALIAS_DOT`);
        await assert(res.columns.includes('title'), `서브쿼리 내 p. → posts.title`);
    } catch (e) { fail('서브쿼리 컨텍스트', e); }

    // 4. 다중 테이블
    header('  4. 다중 테이블 컬럼 구분');
    try {
        const sql = 'SELECT  FROM users u, posts p';
        const cursorPos = 'SELECT '.length;
        const res = await simulateCompletion(provider, sql, cursorPos);
        const hasUserCol = res.columns.some(c => c.startsWith('u.'));
        const hasPostCol = res.columns.some(c => c.startsWith('p.'));
        await assert(hasUserCol && hasPostCol, `u.*, p.* 컬럼 구분 제안`);
    } catch (e) { fail('다중 테이블 컬럼 구분', e); }

    try {
        await provider.disconnect();
        pass('disconnect()');
    } catch (e) { fail('disconnect()', e); }
}

// ── Main ─────────────────────────────────────────────────────

async function main() {
    console.log('🐰 DBunny v2.0.0 — SQL 자동완성 고도화 통합 테스트');
    console.log(`   시작: ${new Date().toLocaleTimeString()}`);

    const tests = [
        { name: 'MySQL', fn: testMySQLCompletion },
        { name: 'PostgreSQL', fn: testPostgresCompletion },
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
