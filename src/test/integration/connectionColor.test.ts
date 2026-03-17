/**
 * 연결별 컬러 코딩 통합 테스트 — 실제 DB 연결에 color 설정을 적용하여 검증
 *
 * 실행: npx tsx src/test/integration/connectionColor.test.ts
 * 사전 요구: docker compose up -d
 */

import { ConnectionConfig, ConnectionColor, CONNECTION_COLOR_PRESETS } from '../../types/database';
import { MySQLProvider } from '../../providers/mysqlProvider';
import { PostgresProvider } from '../../providers/postgresProvider';
import { checkWriteOperation } from '../../utils/readOnlyGuard';

// ── Helpers ──────────────────────────────────────────────

let totalPass = 0;
let totalFail = 0;
const failures: string[] = [];

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

function header(title: string) {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  ${title}`);
    console.log(`${'═'.repeat(60)}`);
}

// ── DB 설정 ──

const mysqlConfig: ConnectionConfig = {
    id: 'color-mysql',
    name: 'MySQL Production',
    type: 'mysql',
    host: 'localhost',
    port: 3306,
    username: 'root',
    password: 'root1234',
    database: 'mydb',
    color: { id: 'red', hex: '#E74C3C', label: '운영' }
};

const pgConfig: ConnectionConfig = {
    id: 'color-pg',
    name: 'PostgreSQL Dev',
    type: 'postgres',
    host: 'localhost',
    port: 5432,
    username: 'postgres',
    password: 'postgres1234',
    database: 'mydb',
    color: { id: 'green', hex: '#27AE60', label: '개발' }
};

const pgReadOnlyConfig: ConnectionConfig = {
    ...pgConfig,
    id: 'color-pg-ro',
    name: 'PostgreSQL Staging ReadOnly',
    readOnly: true,
    color: { id: 'orange', hex: '#E67E22', label: '스테이징' }
};

// ── 테스트 ──

async function main() {
    header('1. MySQL — 운영(빨강) 연결 컬러 + 쿼리 실행');

    const mysql = new MySQLProvider(mysqlConfig);
    try {
        await mysql.connect();
        pass('MySQL 운영 연결 성공');

        // config.color가 올바르게 전달되는지 확인
        if (mysql.config.color?.id === 'red' && mysql.config.color?.hex === '#E74C3C') {
            pass('MySQL config.color 전달 확인 (red)');
        } else {
            fail('MySQL config.color 불일치');
        }

        if (mysql.config.color?.label === '운영') {
            pass('MySQL config.color.label = 운영');
        } else {
            fail('MySQL config.color.label 불일치');
        }

        // 쿼리 실행이 color 설정과 무관하게 정상 동작
        const result = await mysql.executeQuery('SELECT 1 AS ping');
        if (result.rows.length === 1) {
            pass('MySQL 운영 연결 쿼리 정상 실행');
        } else {
            fail('쿼리 결과 비정상');
        }

        await mysql.disconnect();
        pass('MySQL 연결 해제');
    } catch (e) {
        fail('MySQL 운영 테스트', e);
        try { await mysql.disconnect(); } catch { /* ignore */ }
    }

    header('2. PostgreSQL — 개발(초록) 연결 컬러 + 쿼리 실행');

    const pg = new PostgresProvider(pgConfig);
    try {
        await pg.connect();
        pass('PostgreSQL 개발 연결 성공');

        if (pg.config.color?.id === 'green') {
            pass('PostgreSQL config.color = green');
        } else {
            fail('PostgreSQL config.color 불일치');
        }

        const result = await pg.executeQuery('SELECT 1 AS ping');
        if (result.rows.length === 1) {
            pass('PostgreSQL 개발 연결 쿼리 정상 실행');
        } else {
            fail('쿼리 결과 비정상');
        }

        await pg.disconnect();
        pass('PostgreSQL 연결 해제');
    } catch (e) {
        fail('PostgreSQL 개발 테스트', e);
        try { await pg.disconnect(); } catch { /* ignore */ }
    }

    header('3. PostgreSQL — 스테이징(주황) + readOnly 조합');

    const pgRo = new PostgresProvider(pgReadOnlyConfig);
    try {
        await pgRo.connect();
        pass('PostgreSQL 스테이징 readOnly 연결 성공');

        if (pgRo.config.color?.id === 'orange' && pgRo.config.readOnly === true) {
            pass('color=orange + readOnly=true 동시 설정');
        } else {
            fail('color + readOnly 동시 설정 불일치');
        }

        // readOnly guard가 color와 무관하게 동작
        const writeCheck = checkWriteOperation('DROP TABLE users', 'postgres');
        if (writeCheck.isWrite === true) {
            pass('readOnly guard는 color와 무관하게 정상 동작');
        } else {
            fail('readOnly guard 동작 이상');
        }

        const readCheck = checkWriteOperation('SELECT 1', 'postgres');
        if (readCheck.isWrite === false) {
            pass('SELECT는 readOnly에서도 허용');
        } else {
            fail('SELECT 차단됨');
        }

        await pgRo.disconnect();
        pass('PostgreSQL 스테이징 연결 해제');
    } catch (e) {
        fail('PostgreSQL 스테이징 테스트', e);
        try { await pgRo.disconnect(); } catch { /* ignore */ }
    }

    header('4. 다중 연결 — 서로 다른 컬러로 동시 연결');

    const mysql2 = new MySQLProvider({
        ...mysqlConfig,
        id: 'color-mysql-dev',
        name: 'MySQL Dev',
        color: { id: 'blue', hex: '#3498DB', label: '로컬' }
    });

    const pg2 = new PostgresProvider({
        ...pgConfig,
        id: 'color-pg-prod',
        name: 'PostgreSQL Prod',
        color: { id: 'red', hex: '#E74C3C', label: '운영' }
    });

    try {
        await mysql2.connect();
        await pg2.connect();
        pass('MySQL(파랑) + PostgreSQL(빨강) 동시 연결');

        // 각각의 컬러가 독립적으로 유지되는지
        if (mysql2.config.color?.id === 'blue' && pg2.config.color?.id === 'red') {
            pass('컬러가 연결별로 독립 유지');
        } else {
            fail('컬러 혼선');
        }

        // 양쪽 모두 쿼리 실행 가능
        const [r1, r2] = await Promise.all([
            mysql2.executeQuery('SELECT 1 AS ping'),
            pg2.executeQuery('SELECT 1 AS ping')
        ]);
        if (r1.rows.length === 1 && r2.rows.length === 1) {
            pass('양쪽 모두 쿼리 정상');
        } else {
            fail('동시 쿼리 실패');
        }

        await mysql2.disconnect();
        await pg2.disconnect();
        pass('양쪽 연결 해제');
    } catch (e) {
        fail('다중 연결 테스트', e);
        try { await mysql2.disconnect(); } catch { /* ignore */ }
        try { await pg2.disconnect(); } catch { /* ignore */ }
    }

    header('5. color 없는 연결 — 하위 호환성');

    const mysqlNoColor = new MySQLProvider({
        ...mysqlConfig,
        id: 'no-color',
        name: 'MySQL No Color',
        color: undefined
    });

    try {
        await mysqlNoColor.connect();
        pass('color 없는 연결 성공');

        if (mysqlNoColor.config.color === undefined) {
            pass('config.color가 undefined');
        } else {
            fail('config.color가 undefined가 아님');
        }

        const result = await mysqlNoColor.executeQuery('SELECT 1 AS ping');
        if (result.rows.length === 1) {
            pass('color 없는 연결 쿼리 정상');
        } else {
            fail('쿼리 실패');
        }

        await mysqlNoColor.disconnect();
        pass('연결 해제');
    } catch (e) {
        fail('하위 호환성 테스트', e);
        try { await mysqlNoColor.disconnect(); } catch { /* ignore */ }
    }

    header('6. 운영 환경 감지 시나리오');

    // 운영 환경(red)일 때 경고 배너를 표시해야 하는 로직 시뮬레이션
    const configs: ConnectionConfig[] = [
        { ...mysqlConfig, id: 'c1', color: { id: 'red', hex: '#E74C3C' } },
        { ...pgConfig, id: 'c2', color: { id: 'green', hex: '#27AE60' } },
        { ...pgConfig, id: 'c3', color: undefined },
        { ...mysqlConfig, id: 'c4', color: { id: 'orange', hex: '#E67E22' } },
    ];

    const prodConnections = configs.filter(c => c.color?.id === 'red');
    if (prodConnections.length === 1 && prodConnections[0].id === 'c1') {
        pass('운영 연결만 정확히 필터링');
    } else {
        fail('운영 필터링 오류');
    }

    const nonProdConnections = configs.filter(c => c.color?.id !== 'red');
    if (nonProdConnections.length === 3) {
        pass('비운영 연결 3개 필터링');
    } else {
        fail('비운영 필터링 오류');
    }

    header('7. 모든 프리셋 컬러로 연결 생성');

    for (const preset of CONNECTION_COLOR_PRESETS) {
        const config: ConnectionConfig = {
            ...mysqlConfig,
            id: `preset-${preset.id}`,
            name: `MySQL ${preset.labelEn}`,
            color: { id: preset.id, hex: preset.hex, label: preset.label }
        };

        if (config.color?.id === preset.id && config.color?.hex === preset.hex) {
            pass(`프리셋 ${preset.id} config 생성`);
        } else {
            fail(`프리셋 ${preset.id} config 실패`);
        }
    }

    header('8. 연결 정보 전달 형식 검증 (WebView용)');

    // _sendConnections에서 전달하는 형식 시뮬레이션
    const connInfos = [
        { id: 'c1', name: 'Prod', type: 'mysql', isConnected: true, readOnly: false, color: { id: 'red', hex: '#E74C3C', label: '운영' } as ConnectionColor },
        { id: 'c2', name: 'Dev', type: 'postgres', isConnected: true, readOnly: false, color: null as ConnectionColor | null },
        { id: 'c3', name: 'Staging', type: 'postgres', isConnected: false, readOnly: true, color: { id: 'orange', hex: '#E67E22' } as ConnectionColor },
    ];

    // colorMap 구성
    const colorMap: Record<string, ConnectionColor> = {};
    connInfos.forEach(c => { if (c.color) {colorMap[c.id] = c.color;} });

    if (Object.keys(colorMap).length === 2) {
        pass('colorMap에 color 있는 연결만 포함 (2개)');
    } else {
        fail('colorMap 크기 불일치');
    }

    if (colorMap['c1']?.id === 'red' && colorMap['c3']?.id === 'orange') {
        pass('colorMap 정확한 매핑');
    } else {
        fail('colorMap 매핑 오류');
    }

    // readOnlyMap 구성
    const readOnlyMap: Record<string, boolean> = {};
    connInfos.forEach(c => { readOnlyMap[c.id] = !!c.readOnly; });

    if (readOnlyMap['c1'] === false && readOnlyMap['c3'] === true) {
        pass('readOnlyMap은 color와 독립적');
    } else {
        fail('readOnlyMap 오류');
    }

    // 운영 경고 배너 표시 판단
    if (colorMap['c1']?.id === 'red') {
        pass('c1 연결은 운영 경고 배너 표시 대상');
    } else {
        fail('운영 배너 판단 오류');
    }

    if (colorMap['c3']?.id !== 'red') {
        pass('c3 연결은 운영 경고 배너 비표시');
    } else {
        fail('비운영 배너 판단 오류');
    }

    // ── Summary ──

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  연결별 컬러 코딩 통합 테스트 완료`);
    console.log(`  총 ${totalPass + totalFail}개: ✅ ${totalPass} 통과, ❌ ${totalFail} 실패`);
    if (failures.length > 0) {
        console.log('\n  실패 목록:');
        failures.forEach(f => console.log(`    - ${f}`));
    }
    console.log(`${'═'.repeat(60)}`);
    if (totalFail > 0) {process.exit(1);}
}

main().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
});
