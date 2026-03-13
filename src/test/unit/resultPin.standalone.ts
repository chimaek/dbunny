/**
 * 결과 고정(Pin) 스탠드얼론 테스트 — vscode 의존성 없이 실행 가능
 *
 * 실행법: npx tsx src/test/unit/resultPin.standalone.ts
 */

import {
    PinnedResult,
    MAX_PINNED_RESULTS,
    generatePinId,
    createDefaultTabPinState,
    pinResult,
    unpinResult,
    renamePinLabel,
    selectPinnedResult,
    toggleCompareMode,
    formatTimestamp,
    getPinDisplayName,
    clearAllPins
} from '../../utils/resultPin';

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

// ── 테스트 데이터 생성 헬퍼 ────────────────────────────

function createMockResult(overrides?: Partial<Omit<PinnedResult, 'id'>>): Omit<PinnedResult, 'id'> {
    return {
        query: 'SELECT * FROM users',
        columns: ['id', 'name', 'email'],
        rows: [
            { id: 1, name: 'Alice', email: 'alice@test.com' },
            { id: 2, name: 'Bob', email: 'bob@test.com' }
        ],
        rowCount: 2,
        executionTime: 15,
        executedAt: '2026-03-14T10:30:45.000Z',
        connectionName: 'MySQL Test',
        databaseName: 'mydb',
        ...overrides
    };
}

// ── generatePinId ──────────────────────────────────

header('generatePinId');

const id1 = generatePinId();
const id2 = generatePinId();
assert(id1.startsWith('pin-'), `ID가 'pin-' 접두사로 시작: ${id1}`);
assert(id1 !== id2, '두 ID가 서로 다름');
assert(id1.length > 10, `ID 길이가 충분함: ${id1.length}`);

// ── createDefaultTabPinState ────────────────────────

header('createDefaultTabPinState');

const defaultState = createDefaultTabPinState();
assertEqual(defaultState.pinnedResults, [], '기본 pinnedResults는 빈 배열');
assertEqual(defaultState.activeResultId, null, '기본 activeResultId는 null');
assertEqual(defaultState.compareMode, 'single', '기본 compareMode는 single');
assertEqual(defaultState.compareTargetId, null, '기본 compareTargetId는 null');

// ── pinResult ─────────────────────────────────────

header('pinResult');

let state = createDefaultTabPinState();

// 첫 번째 핀 추가
state = pinResult(state, createMockResult());
assertEqual(state.pinnedResults.length, 1, '핀 1개 추가됨');
assert(state.pinnedResults[0].id.startsWith('pin-'), '핀 ID가 생성됨');
assertEqual(state.pinnedResults[0].query, 'SELECT * FROM users', '쿼리 보존됨');
assertEqual(state.pinnedResults[0].columns, ['id', 'name', 'email'], '컬럼 보존됨');
assertEqual(state.pinnedResults[0].rowCount, 2, 'rowCount 보존됨');
assertEqual(state.pinnedResults[0].executionTime, 15, 'executionTime 보존됨');
assertEqual(state.pinnedResults[0].connectionName, 'MySQL Test', 'connectionName 보존됨');
assertEqual(state.pinnedResults[0].databaseName, 'mydb', 'databaseName 보존됨');

// 두 번째 핀 추가 (최신이 앞에)
state = pinResult(state, createMockResult({ query: 'SELECT COUNT(*) FROM posts' }));
assertEqual(state.pinnedResults.length, 2, '핀 2개');
assertEqual(state.pinnedResults[0].query, 'SELECT COUNT(*) FROM posts', '최신 핀이 앞에 위치');
assertEqual(state.pinnedResults[1].query, 'SELECT * FROM users', '이전 핀이 뒤에 위치');

// 최대 개수 제한 테스트
let maxState = createDefaultTabPinState();
for (let i = 0; i < MAX_PINNED_RESULTS + 5; i++) {
    maxState = pinResult(maxState, createMockResult({ query: `SELECT ${i}` }));
}
assertEqual(maxState.pinnedResults.length, MAX_PINNED_RESULTS, `최대 ${MAX_PINNED_RESULTS}개로 제한됨`);
assertEqual(maxState.pinnedResults[0].query, `SELECT ${MAX_PINNED_RESULTS + 4}`, '최신 항목이 앞에');

// ── unpinResult ───────────────────────────────────

header('unpinResult');

let unpinState = createDefaultTabPinState();
unpinState = pinResult(unpinState, createMockResult({ query: 'Q1' }));
unpinState = pinResult(unpinState, createMockResult({ query: 'Q2' }));
unpinState = pinResult(unpinState, createMockResult({ query: 'Q3' }));

const pinToRemove = unpinState.pinnedResults[1]; // Q2
unpinState = unpinResult(unpinState, pinToRemove.id);
assertEqual(unpinState.pinnedResults.length, 2, '핀 해제 후 2개');
assert(unpinState.pinnedResults.every(p => p.id !== pinToRemove.id), '삭제된 핀 없음');

// 활성 핀이 삭제되면 초기화
let activeUnpinState = createDefaultTabPinState();
activeUnpinState = pinResult(activeUnpinState, createMockResult({ query: 'Active' }));
const activePin = activeUnpinState.pinnedResults[0];
activeUnpinState = selectPinnedResult(activeUnpinState, activePin.id);
assertEqual(activeUnpinState.activeResultId, activePin.id, '활성 핀 설정됨');

activeUnpinState = unpinResult(activeUnpinState, activePin.id);
assertEqual(activeUnpinState.activeResultId, null, '활성 핀 삭제 시 null로 초기화');

// 비교 대상이 삭제되면 초기화
let compareUnpinState = createDefaultTabPinState();
compareUnpinState = pinResult(compareUnpinState, createMockResult({ query: 'A' }));
compareUnpinState = pinResult(compareUnpinState, createMockResult({ query: 'B' }));
const compareTarget = compareUnpinState.pinnedResults[1];
compareUnpinState = toggleCompareMode(compareUnpinState, compareTarget.id);
assertEqual(compareUnpinState.compareMode, 'side-by-side', '비교 모드 활성');
assertEqual(compareUnpinState.compareTargetId, compareTarget.id, '비교 대상 설정됨');

compareUnpinState = unpinResult(compareUnpinState, compareTarget.id);
assertEqual(compareUnpinState.compareMode, 'single', '비교 대상 삭제 시 single로 복귀');
assertEqual(compareUnpinState.compareTargetId, null, '비교 대상 null로 초기화');

// 존재하지 않는 ID 삭제 시도
const beforeCount = unpinState.pinnedResults.length;
unpinState = unpinResult(unpinState, 'nonexistent-id');
assertEqual(unpinState.pinnedResults.length, beforeCount, '존재하지 않는 ID는 무시');

// ── renamePinLabel ────────────────────────────────

header('renamePinLabel');

let renameState = createDefaultTabPinState();
renameState = pinResult(renameState, createMockResult());
const pinToRename = renameState.pinnedResults[0];

renameState = renamePinLabel(renameState, pinToRename.id, 'My Custom Label');
assertEqual(renameState.pinnedResults[0].label, 'My Custom Label', '라벨 변경됨');

// 빈 문자열로 라벨 지우기
renameState = renamePinLabel(renameState, pinToRename.id, '');
assertEqual(renameState.pinnedResults[0].label, '', '빈 문자열 라벨');

// 존재하지 않는 ID
renameState = renamePinLabel(renameState, 'nonexistent', 'Test');
assertEqual(renameState.pinnedResults.length, 1, '존재하지 않는 ID 무시');

// ── selectPinnedResult ────────────────────────────

header('selectPinnedResult');

let selectState = createDefaultTabPinState();
selectState = pinResult(selectState, createMockResult());
const pinToSelect = selectState.pinnedResults[0];

selectState = selectPinnedResult(selectState, pinToSelect.id);
assertEqual(selectState.activeResultId, pinToSelect.id, '핀 결과 선택됨');

selectState = selectPinnedResult(selectState, null);
assertEqual(selectState.activeResultId, null, 'null로 선택 해제');

// ── toggleCompareMode ────────────────────────────

header('toggleCompareMode');

let cmpState = createDefaultTabPinState();
cmpState = pinResult(cmpState, createMockResult({ query: 'Left' }));
cmpState = pinResult(cmpState, createMockResult({ query: 'Right' }));
const rightPin = cmpState.pinnedResults[1];

// single → side-by-side
cmpState = toggleCompareMode(cmpState, rightPin.id);
assertEqual(cmpState.compareMode, 'side-by-side', 'side-by-side 모드로 전환');
assertEqual(cmpState.compareTargetId, rightPin.id, '비교 대상 설정됨');

// side-by-side → single (targetId를 null로)
cmpState = toggleCompareMode(cmpState, null);
assertEqual(cmpState.compareMode, 'single', 'single 모드로 복귀');
assertEqual(cmpState.compareTargetId, null, '비교 대상 초기화');

// 다른 대상으로 비교 전환
cmpState = toggleCompareMode(cmpState, rightPin.id);
const leftPin = cmpState.pinnedResults[0];
cmpState = toggleCompareMode(cmpState, leftPin.id);
assertEqual(cmpState.compareMode, 'side-by-side', '여전히 side-by-side');
assertEqual(cmpState.compareTargetId, leftPin.id, '비교 대상 변경됨');

// ── formatTimestamp ──────────────────────────────

header('formatTimestamp');

assertEqual(formatTimestamp('2026-03-14T10:30:45.000Z'), '19:30:45', 'UTC → 로컬 시간 변환 (KST+9)');
// 참고: 로컬 타임존에 따라 다를 수 있으므로 형식만 검증
const ts = formatTimestamp('2026-03-14T00:00:00.000Z');
assert(/^\d{2}:\d{2}:\d{2}$/.test(ts), `형식 HH:MM:SS 맞음: ${ts}`);

// ── getPinDisplayName ────────────────────────────

header('getPinDisplayName');

// 라벨이 있는 경우
const labeledPin: PinnedResult = {
    id: 'pin-1',
    query: 'SELECT * FROM users',
    columns: ['id'], rows: [], rowCount: 0,
    executionTime: 10,
    executedAt: '2026-03-14T10:30:45.000Z',
    connectionName: 'Test', databaseName: 'mydb',
    label: 'User Query'
};
assertEqual(getPinDisplayName(labeledPin), 'User Query', '라벨이 있으면 라벨 사용');

// 라벨이 없는 경우
const noLabelPin: PinnedResult = {
    ...labeledPin,
    label: undefined
};
const displayName = getPinDisplayName(noLabelPin);
assert(displayName.includes('SELECT * FROM users'), `쿼리 미리보기 포함: ${displayName}`);
assert(/\d{2}:\d{2}:\d{2}/.test(displayName), `타임스탬프 포함: ${displayName}`);

// 긴 쿼리 잘림
const longQueryPin: PinnedResult = {
    ...labeledPin,
    label: undefined,
    query: 'SELECT u.id, u.name, u.email, u.created_at FROM users u WHERE u.active = 1 ORDER BY u.name'
};
const longDisplay = getPinDisplayName(longQueryPin);
assert(longDisplay.includes('...'), `긴 쿼리는 ...으로 잘림: ${longDisplay}`);
assert(longDisplay.length < 100, `표시명 길이 제한: ${longDisplay.length}`);

// ── clearAllPins ─────────────────────────────────

header('clearAllPins');

let clearState = createDefaultTabPinState();
clearState = pinResult(clearState, createMockResult({ query: 'Q1' }));
clearState = pinResult(clearState, createMockResult({ query: 'Q2' }));
clearState = selectPinnedResult(clearState, clearState.pinnedResults[0].id);
clearState = toggleCompareMode(clearState, clearState.pinnedResults[1].id);

clearState = clearAllPins(clearState);
assertEqual(clearState.pinnedResults.length, 0, '모든 핀 삭제됨');
assertEqual(clearState.activeResultId, null, 'activeResultId 초기화');
assertEqual(clearState.compareMode, 'single', 'compareMode 초기화');
assertEqual(clearState.compareTargetId, null, 'compareTargetId 초기화');

// ── 복합 시나리오 ────────────────────────────────

header('복합 시나리오: 실제 워크플로우');

// 시나리오 1: 3개 쿼리 실행 후 첫 번째와 세 번째 비교
let workflow = createDefaultTabPinState();
workflow = pinResult(workflow, createMockResult({ query: 'SELECT * FROM users', executionTime: 10, rowCount: 5 }));
workflow = pinResult(workflow, createMockResult({ query: 'SELECT * FROM posts', executionTime: 20, rowCount: 10 }));
workflow = pinResult(workflow, createMockResult({ query: 'SELECT * FROM comments', executionTime: 5, rowCount: 3 }));

const commentsPin = workflow.pinnedResults[0]; // 가장 최근 = comments
const usersPin = workflow.pinnedResults[2]; // 가장 오래됨 = users

// comments 선택
workflow = selectPinnedResult(workflow, commentsPin.id);
assertEqual(workflow.activeResultId, commentsPin.id, '댓글 결과 선택');

// 비교 모드 시작: comments vs users
workflow = toggleCompareMode(workflow, usersPin.id);
assertEqual(workflow.compareMode, 'side-by-side', '나란히 보기 시작');
assertEqual(workflow.compareTargetId, usersPin.id, 'users와 비교');

// posts 핀 삭제 (비교 중이 아닌 핀)
const postsPin = workflow.pinnedResults[1];
workflow = unpinResult(workflow, postsPin.id);
assertEqual(workflow.pinnedResults.length, 2, 'posts 핀 삭제됨');
assertEqual(workflow.compareMode, 'side-by-side', '비교 모드 유지');
assertEqual(workflow.compareTargetId, usersPin.id, '비교 대상 유지');

// 비교 종료
workflow = toggleCompareMode(workflow, null);
assertEqual(workflow.compareMode, 'single', '비교 종료');

// 시나리오 2: 핀 라벨 지정 후 표시명 확인
workflow = renamePinLabel(workflow, commentsPin.id, 'Before Fix');
const renamed = workflow.pinnedResults.find(p => p.id === commentsPin.id);
assert(renamed !== undefined, '라벨 변경된 핀 존재');
assertEqual(renamed?.label, 'Before Fix', '라벨 적용됨');

// 시나리오 3: 모든 핀 삭제 후 새로 시작
workflow = clearAllPins(workflow);
assertEqual(workflow.pinnedResults.length, 0, '전체 삭제');

workflow = pinResult(workflow, createMockResult({ query: 'Fresh start' }));
assertEqual(workflow.pinnedResults.length, 1, '새 핀 추가 가능');
assertEqual(workflow.pinnedResults[0].query, 'Fresh start', '새 핀 쿼리 확인');

// ── MAX_PINNED_RESULTS 상수 ─────────────────────

header('MAX_PINNED_RESULTS 상수');

assertEqual(MAX_PINNED_RESULTS, 20, 'MAX_PINNED_RESULTS === 20');

// ── 데이터 무결성 ────────────────────────────────

header('데이터 무결성');

// pinResult는 원본 상태를 변경하지 않음 (불변성)
const original = createDefaultTabPinState();
const modified = pinResult(original, createMockResult());
assertEqual(original.pinnedResults.length, 0, '원본 상태 변경되지 않음');
assertEqual(modified.pinnedResults.length, 1, '새 상태에만 추가됨');

// unpinResult도 불변성 유지
const _beforeUnpin = { ...modified, pinnedResults: [...modified.pinnedResults] };
const afterUnpin = unpinResult(modified, modified.pinnedResults[0].id);
assertEqual(modified.pinnedResults.length, 1, '원본 상태 변경되지 않음 (unpin)');
assertEqual(afterUnpin.pinnedResults.length, 0, '새 상태에서만 삭제됨');

// rows 데이터 보존 (참조가 아닌 값)
const resultData = createMockResult();
const dataState = pinResult(createDefaultTabPinState(), resultData);
assertEqual(dataState.pinnedResults[0].rows.length, 2, '행 데이터 보존됨');
assertEqual(dataState.pinnedResults[0].rows[0], { id: 1, name: 'Alice', email: 'alice@test.com' }, '행 내용 보존됨');

// ── 엣지 케이스 ─────────────────────────────────

header('엣지 케이스');

// 빈 결과 핀
const emptyState = pinResult(createDefaultTabPinState(), createMockResult({
    rows: [],
    rowCount: 0,
    columns: []
}));
assertEqual(emptyState.pinnedResults[0].rows.length, 0, '빈 결과도 핀 가능');
assertEqual(emptyState.pinnedResults[0].columns.length, 0, '빈 컬럼 핀 가능');

// 한국어 쿼리
const koreanState = pinResult(createDefaultTabPinState(), createMockResult({
    query: 'SELECT * FROM 사용자 WHERE 이름 = "홍길동"'
}));
assert(koreanState.pinnedResults[0].query.includes('사용자'), '한국어 쿼리 보존');

// 특수문자 포함 쿼리
const specialState = pinResult(createDefaultTabPinState(), createMockResult({
    query: "SELECT * FROM users WHERE name LIKE '%O''Brien%'"
}));
assert(specialState.pinnedResults[0].query.includes("O''Brien"), '특수문자 쿼리 보존');

// databaseName이 null인 경우
const nullDbState = pinResult(createDefaultTabPinState(), createMockResult({
    databaseName: null
}));
assertEqual(nullDbState.pinnedResults[0].databaseName, null, 'null databaseName 보존');

// 매우 긴 쿼리
const longQuery = 'SELECT ' + Array.from({ length: 100 }, (_, i) => `col${i}`).join(', ') + ' FROM very_long_table';
const longState = pinResult(createDefaultTabPinState(), createMockResult({ query: longQuery }));
assertEqual(longState.pinnedResults[0].query, longQuery, '긴 쿼리 전체 보존');
const longDisplayName = getPinDisplayName(longState.pinnedResults[0]);
assert(longDisplayName.length < 100, `긴 쿼리의 표시명은 잘림: ${longDisplayName.length}자`);

// ── 결과 ────────────────────────────────────────────────

console.log(`\n${'═'.repeat(50)}`);
console.log(`  RESULTS: ✅ ${totalPass} passed, ❌ ${totalFail} failed`);
console.log(`${'═'.repeat(50)}`);

if (failures.length > 0) {
    console.log('\n  Failures:');
    failures.forEach((f, i) => console.log(`    ${i + 1}. ${f}`));
}

console.log('');
process.exit(totalFail > 0 ? 1 : 0);
