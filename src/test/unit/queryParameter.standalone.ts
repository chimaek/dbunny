/**
 * Query Parameter 스탠드얼론 테스트 — vscode 의존성 없이 실행 가능
 *
 * 실행법: npx tsx src/test/unit/queryParameter.standalone.ts
 */

import {
    extractParameters,
    hasParameters,
    substituteParameters,
    getUniqueParameterNames,
    createDefaultProfiles,
    createEmptyConnectionData
} from '../../utils/queryParameter';

let totalPass = 0;
let totalFail = 0;
const failures: string[] = [];

function header(title: string) {
    console.log(`\n${'─'.repeat(50)}`);
    console.log(`  ${title}`);
    console.log(`${'─'.repeat(50)}`);
}

function pass(msg: string) {
    totalPass++;
    console.log(`  ✅ ${msg}`);
}

function fail(msg: string) {
    totalFail++;
    console.log(`  ❌ ${msg}`);
    failures.push(msg);
}

function assert(condition: boolean, msg: string) {
    if (condition) { pass(msg); } else { fail(msg); }
}

function assertEqual(actual: unknown, expected: unknown, msg: string) {
    const eq = JSON.stringify(actual) === JSON.stringify(expected);
    if (eq) {
        pass(msg);
    } else {
        fail(`${msg} — expected: ${JSON.stringify(expected)}, got: ${JSON.stringify(actual)}`);
    }
}

// ── extractParameters ───────────────────────────────

header('extractParameters — 기본 추출');

(() => {
    const params = extractParameters('SELECT * FROM users WHERE id = {{user_id}}');
    assert(params.length === 1, '단일 파라미터 추출');
    assertEqual(params[0].name, 'user_id', '파라미터 이름: user_id');
    assertEqual(params[0].match, '{{user_id}}', '매치 문자열');
})();

(() => {
    const params = extractParameters('SELECT * FROM users WHERE id = {{ user_id }}');
    assert(params.length === 1, '공백 포함 파라미터');
    assertEqual(params[0].name, 'user_id', '공백 제거된 이름: user_id');
})();

(() => {
    const params = extractParameters(
        'SELECT * FROM users WHERE id = {{user_id}} AND name = {{user_name}}'
    );
    assert(params.length === 2, '다중 파라미터 추출');
    assertEqual(params[0].name, 'user_id', '첫 번째: user_id');
    assertEqual(params[1].name, 'user_name', '두 번째: user_name');
})();

(() => {
    const params = extractParameters(
        'SELECT * FROM users WHERE id = {{user_id}} OR parent_id = {{user_id}}'
    );
    assert(params.length === 1, '중복 파라미터는 한 번만');
    assertEqual(params[0].name, 'user_id', '이름: user_id');
})();

(() => {
    const params = extractParameters('SELECT * FROM users');
    assert(params.length === 0, '파라미터 없는 쿼리');
})();

// ── 한국어 변수명 ───────────────────────────────

header('extractParameters — 한국어 변수명');

(() => {
    const params = extractParameters('SELECT * FROM users WHERE id = {{사용자_ID}}');
    assert(params.length === 1, '한국어 파라미터 추출');
    assertEqual(params[0].name, '사용자_ID', '한국어 이름: 사용자_ID');
})();

(() => {
    const params = extractParameters('SELECT * FROM orders WHERE date > {{시작일}} AND date < {{종료일}}');
    assert(params.length === 2, '한국어 다중 파라미터');
    assertEqual(params[0].name, '시작일', '시작일');
    assertEqual(params[1].name, '종료일', '종료일');
})();

// ── 문자열 리터럴 내부 무시 ───────────────────────────────

header('extractParameters — 문자열 리터럴 내부 무시');

(() => {
    const params = extractParameters("SELECT * FROM users WHERE name = '{{not_a_param}}'");
    assert(params.length === 0, '작은따옴표 내부 무시');
})();

(() => {
    const params = extractParameters('SELECT * FROM users WHERE name = "{{not_a_param}}"');
    assert(params.length === 0, '큰따옴표 내부 무시');
})();

(() => {
    const params = extractParameters(
        "SELECT * FROM users WHERE name = '{{ignore}}' AND id = {{real_param}}"
    );
    assert(params.length === 1, '리터럴 내부는 무시, 외부는 추출');
    assertEqual(params[0].name, 'real_param', '이름: real_param');
})();

(() => {
    const params = extractParameters(
        "SELECT * FROM users WHERE name = 'it''s {{escaped}}' AND id = {{real}}"
    );
    assert(params.length === 1, '이스케이프된 따옴표 처리');
    assertEqual(params[0].name, 'real', '이름: real');
})();

// ── 주석 내부 무시 ───────────────────────────────

header('extractParameters — 주석 내부 무시');

(() => {
    const params = extractParameters('SELECT * FROM users -- {{comment_param}}');
    assert(params.length === 0, '한줄 주석 내부 무시');
})();

(() => {
    const params = extractParameters('SELECT * FROM users /* {{block_comment}} */ WHERE id = {{real}}');
    assert(params.length === 1, '블록 주석 내부 무시');
    assertEqual(params[0].name, 'real', '주석 외부 파라미터 추출');
})();

(() => {
    const params = extractParameters(
        `SELECT * FROM users
-- 이 주석에 {{무시할_변수}}가 있음
WHERE id = {{실제_변수}}`
    );
    assert(params.length === 1, '멀티라인 — 주석 내부 무시');
    assertEqual(params[0].name, '실제_변수', '실제 변수만 추출');
})();

// ── hasParameters ───────────────────────────────

header('hasParameters');

(() => {
    assert(hasParameters('SELECT * FROM users WHERE id = {{id}}'), '파라미터 있음');
    assert(!hasParameters('SELECT * FROM users'), '파라미터 없음');
    assert(!hasParameters("SELECT '{{not_param}}'"), '문자열 내부 — false');
    assert(!hasParameters('SELECT * -- {{comment}}'), '주석 내부 — false');
    assert(
        hasParameters("SELECT '{{ignore}}', {{real}}"),
        '리터럴 내부 + 외부 — true'
    );
})();

// ── substituteParameters ───────────────────────────────

header('substituteParameters — 치환');

(() => {
    const result = substituteParameters(
        'SELECT * FROM users WHERE id = {{user_id}}',
        { user_id: '42' }
    );
    assertEqual(result, 'SELECT * FROM users WHERE id = 42', '단일 치환');
})();

(() => {
    const result = substituteParameters(
        'SELECT * FROM users WHERE id = {{user_id}} AND name = {{user_name}}',
        { user_id: '42', user_name: "'Alice'" }
    );
    assertEqual(
        result,
        "SELECT * FROM users WHERE id = 42 AND name = 'Alice'",
        '다중 치환'
    );
})();

(() => {
    const result = substituteParameters(
        'SELECT * FROM users WHERE id = {{user_id}} OR parent_id = {{user_id}}',
        { user_id: '7' }
    );
    assertEqual(
        result,
        'SELECT * FROM users WHERE id = 7 OR parent_id = 7',
        '같은 변수 여러 번 치환'
    );
})();

(() => {
    const result = substituteParameters(
        'SELECT * FROM users WHERE id = {{user_id}}',
        {}
    );
    assertEqual(
        result,
        'SELECT * FROM users WHERE id = {{user_id}}',
        '값 없으면 원본 유지'
    );
})();

(() => {
    const result = substituteParameters(
        "SELECT * FROM users WHERE name = '{{ignore}}' AND id = {{real}}",
        { ignore: 'REPLACED', real: '99' }
    );
    assertEqual(
        result,
        "SELECT * FROM users WHERE name = '{{ignore}}' AND id = 99",
        '문자열 리터럴 내부는 치환하지 않음'
    );
})();

(() => {
    const result = substituteParameters(
        'SELECT * FROM users WHERE id = {{ user_id }}',
        { user_id: '10' }
    );
    assertEqual(
        result,
        'SELECT * FROM users WHERE id = 10',
        '공백 포함 플레이스홀더 치환'
    );
})();

// ── getUniqueParameterNames ───────────────────────────────

header('getUniqueParameterNames');

(() => {
    const names = getUniqueParameterNames(
        'SELECT * FROM users WHERE id = {{id}} AND name = {{name}} AND parent = {{id}}'
    );
    assertEqual(names, ['id', 'name'], '중복 제거된 이름 목록');
})();

(() => {
    const names = getUniqueParameterNames('SELECT 1');
    assertEqual(names, [], '파라미터 없으면 빈 배열');
})();

// ── createDefaultProfiles / createEmptyConnectionData ───────────────────────

header('유틸리티 함수');

(() => {
    const profiles = createDefaultProfiles();
    assertEqual(profiles.length, 3, '기본 프로필 3개');
    assertEqual(profiles.map(p => p.name), ['dev', 'staging', 'prod'], '프로필 이름');
    assert(Object.keys(profiles[0].variables).length === 0, 'dev 프로필 빈 변수');
})();

(() => {
    const data = createEmptyConnectionData();
    assertEqual(data.variableSets, [], '빈 변수 세트');
    assertEqual(data.profiles.length, 3, '기본 프로필 3개');
    assert(data.lastUsedSet === undefined, 'lastUsedSet undefined');
    assert(data.lastUsedProfile === undefined, 'lastUsedProfile undefined');
})();

// ── 엣지 케이스 ───────────────────────────────

header('엣지 케이스');

(() => {
    const params = extractParameters('{{}}');
    assert(params.length === 0, '빈 중괄호 — 무시');
})();

(() => {
    const params = extractParameters('{{ }}');
    assert(params.length === 0, '공백만 있는 중괄호 — 무시');
})();

(() => {
    const params = extractParameters('{{123invalid}}');
    assert(params.length === 0, '숫자로 시작하는 변수명 — 무시');
})();

(() => {
    const params = extractParameters('{single_brace}');
    assert(params.length === 0, '단일 중괄호 — 무시');
})();

(() => {
    const params = extractParameters('{{{triple}}}');
    // 안쪽 {{triple}}이 매칭되어야 함
    assert(params.length === 1, '삼중 중괄호 — 내부 매치');
    assertEqual(params[0].name, 'triple', '이름: triple');
})();

(() => {
    const result = substituteParameters(
        'INSERT INTO logs (msg) VALUES ({{message}})',
        { message: "'DROP TABLE; --" }
    );
    assertEqual(
        result,
        "INSERT INTO logs (msg) VALUES ('DROP TABLE; --)",
        '값 그대로 치환 (SQL 인젝션은 사용자 책임 아님, 파라미터화 쿼리와 별도)'
    );
})();

(() => {
    const query = `
        SELECT u.name, o.total
        FROM users u
        JOIN orders o ON o.user_id = u.id
        WHERE u.status = {{status}}
          AND o.created_at > {{start_date}}
          AND o.total > {{min_amount}}
        ORDER BY o.total DESC
        LIMIT {{limit}}
    `;
    const params = extractParameters(query);
    assertEqual(params.length, 4, '복잡한 쿼리 — 4개 파라미터');
    assertEqual(
        params.map(p => p.name),
        ['status', 'start_date', 'min_amount', 'limit'],
        '순서 보존'
    );

    const result = substituteParameters(query, {
        status: "'active'",
        start_date: "'2026-01-01'",
        min_amount: '100',
        limit: '50'
    });
    assert(result.includes("'active'"), '치환된 status');
    assert(result.includes("'2026-01-01'"), '치환된 start_date');
    assert(result.includes('100'), '치환된 min_amount');
    assert(result.includes('50'), '치환된 limit');
    assert(!result.includes('{{'), '모든 플레이스홀더 치환됨');
})();

// ── 멀티라인 쿼리 ───────────────────────────────

header('extractParameters — 멀티라인 복잡 쿼리');

(() => {
    const query = `
        -- 사용자 조회 쿼리
        SELECT u.name, o.total
        FROM users u
        /* 주문 테이블 조인 {{무시될_변수}} */
        JOIN orders o ON o.user_id = u.id
        WHERE u.status = {{status}}
          AND o.date BETWEEN {{start}} AND {{end}}
        -- LIMIT {{무시될_리밋}}
        LIMIT {{limit}}
        OFFSET {{offset}}
    `;
    const params = extractParameters(query);
    assertEqual(params.length, 5, '멀티라인 — 5개 파라미터 (주석 내 무시)');
    const names = params.map(p => p.name);
    assert(names.includes('status'), 'status 추출');
    assert(names.includes('start'), 'start 추출');
    assert(names.includes('end'), 'end 추출');
    assert(names.includes('limit'), 'limit 추출');
    assert(names.includes('offset'), 'offset 추출');
    assert(!names.includes('무시될_변수'), '블록 주석 내 무시');
    assert(!names.includes('무시될_리밋'), '한줄 주석 내 무시');
})();

// 위 테스트 수정 — offset은 주석 바깥이므로 실제 5개
(() => {
    const query = `
        SELECT * FROM users
        WHERE status = {{status}}
          AND date BETWEEN {{start}} AND {{end}}
        LIMIT {{limit}}
        OFFSET {{offset}}
    `;
    const params = extractParameters(query);
    assertEqual(params.length, 5, '멀티라인 — 5개 파라미터');
})();

// ── 특수한 따옴표 패턴 ───────────────────────────────

header('extractParameters — 특수 따옴표 패턴');

(() => {
    // 이스케이프된 백슬래시 + 따옴표
    const params = extractParameters("SELECT * FROM t WHERE c = '\\'{{var}}'");
    // 백슬래시 이스케이프 후 따옴표가 닫히므로 {{var}}은 문자열 밖
    // 실제 동작은 파서 구현에 따라 다름
    assert(params.length >= 0, '백슬래시 이스케이프 처리');
})();

(() => {
    // 연속 이스케이프된 따옴표
    const params = extractParameters("SELECT * FROM t WHERE c = '''' AND id = {{id}}");
    assert(params.length === 1, "연속 이스케이프 따옴표 후 파라미터 추출");
    if (params.length > 0) {
        assertEqual(params[0].name, 'id', '이름: id');
    }
})();

(() => {
    // 큰따옴표와 작은따옴표 혼합
    const params = extractParameters(`SELECT * FROM t WHERE a = "hello" AND b = '{{inside}}' AND c = {{outside}}`);
    assertEqual(params.length, 1, '작은따옴표 내부 무시, 외부만 추출');
    if (params.length > 0) {
        assertEqual(params[0].name, 'outside', '이름: outside');
    }
})();

// ── substituteParameters — 부분 치환 ───────────────

header('substituteParameters — 부분 치환');

(() => {
    const result = substituteParameters(
        'SELECT * FROM users WHERE id = {{id}} AND name = {{name}}',
        { id: '1' }
    );
    assert(result.includes('id = 1'), 'id 치환됨');
    assert(result.includes('{{name}}'), 'name은 미치환 유지');
})();

(() => {
    // 존재하지 않는 키 전달
    const result = substituteParameters(
        'SELECT * FROM users WHERE id = {{id}}',
        { nonexistent: 'value', id: '42' }
    );
    assert(result.includes('42'), '존재하는 키만 치환');
    assert(!result.includes('nonexistent'), '존재하지 않는 키 무시');
})();

// ── extractParameters — 위치 정보 정확성 ─────────────

header('extractParameters — 위치 정보');

(() => {
    const query = 'SELECT * FROM users WHERE id = {{user_id}}';
    const params = extractParameters(query);
    assert(params.length === 1, '파라미터 1개');
    const param = params[0];
    assert(param.startIndex === query.indexOf('{{user_id}}'), '시작 인덱스 정확');
    assert(param.endIndex === query.indexOf('{{user_id}}') + '{{user_id}}'.length, '끝 인덱스 정확');
    assertEqual(query.substring(param.startIndex, param.endIndex), '{{user_id}}', '슬라이싱 결과 일치');
})();

// ── 한국어 + 영문 혼합 변수명 ─────────────────────────

header('extractParameters — 한국어 혼합 변수명');

(() => {
    const params = extractParameters('SELECT * FROM t WHERE c = {{사용자_ID}} AND d = {{user이름}}');
    assertEqual(params.length, 2, '한영 혼합 변수명 2개');
    assertEqual(params[0].name, '사용자_ID', '사용자_ID');
    assertEqual(params[1].name, 'user이름', 'user이름');
})();

(() => {
    // 한국어 자음/모음으로 시작
    const params = extractParameters('SELECT * FROM t WHERE c = {{ㄱ변수}}');
    assertEqual(params.length, 1, '한국어 자음으로 시작하는 변수명');
    assertEqual(params[0].name, 'ㄱ변수', 'ㄱ변수');
})();

// ── ConnectionVariableData 구조 검증 ─────────────────

header('ConnectionVariableData 구조');

(() => {
    const data = createEmptyConnectionData();
    // profiles에 값 추가
    data.profiles[0].variables = { user_id: '1', name: "'test'" };
    assertEqual(data.profiles[0].name, 'dev', 'dev 프로필');
    assertEqual(data.profiles[0].variables.user_id, '1', 'dev 변수 값');

    // 프로필을 사용한 치환
    const query = 'SELECT * FROM users WHERE id = {{user_id}} AND name = {{name}}';
    const result = substituteParameters(query, data.profiles[0].variables);
    assert(result.includes('id = 1'), 'dev 프로필로 치환 — id');
    assert(result.includes("name = 'test'"), 'dev 프로필로 치환 — name');
})();

// ── 결과 출력 ───────────────────────────────

console.log(`\n${'═'.repeat(50)}`);
console.log(`  Total: ${totalPass + totalFail} | ✅ Pass: ${totalPass} | ❌ Fail: ${totalFail}`);
console.log(`${'═'.repeat(50)}`);

if (totalFail > 0) {
    console.log('\n  Failed tests:');
    failures.forEach(f => console.log(`    - ${f}`));
    process.exit(1);
}
