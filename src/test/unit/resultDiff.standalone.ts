/**
 * 쿼리 결과 비교(Diff) 스탠드얼론 테스트 — vscode 의존성 없이 실행 가능
 *
 * 실행법: npx tsx src/test/unit/resultDiff.standalone.ts
 */

import { computeDiff, diffToMarkdown, diffToJson } from '../../utils/resultDiff';
import { QueryResult } from '../../types/database';

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

function makeResult(rows: Record<string, unknown>[], fields: { name: string; type: string }[]): QueryResult {
    return { rows, fields, rowCount: rows.length, executionTime: 0 };
}

// ── 동일한 결과 ──────────────────────────────────

header('동일한 결과 (모두 unchanged)');

{
    const left = makeResult(
        [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }],
        [{ name: 'id', type: 'int' }, { name: 'name', type: 'varchar' }]
    );
    const right = makeResult(
        [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }],
        [{ name: 'id', type: 'int' }, { name: 'name', type: 'varchar' }]
    );

    const diff = computeDiff(left, right, ['id']);
    assertEqual(diff.summary.added, 0, 'added = 0');
    assertEqual(diff.summary.removed, 0, 'removed = 0');
    assertEqual(diff.summary.modified, 0, 'modified = 0');
    assertEqual(diff.summary.unchanged, 2, 'unchanged = 2');
}

// ── 행 추가 ──────────────────────────────────

header('행 추가 (added 감지)');

{
    const left = makeResult(
        [{ id: 1, name: 'Alice' }],
        [{ name: 'id', type: 'int' }, { name: 'name', type: 'varchar' }]
    );
    const right = makeResult(
        [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }, { id: 3, name: 'Carol' }],
        [{ name: 'id', type: 'int' }, { name: 'name', type: 'varchar' }]
    );

    const diff = computeDiff(left, right, ['id']);
    assertEqual(diff.summary.added, 2, 'added = 2');
    assertEqual(diff.summary.removed, 0, 'removed = 0');
    assertEqual(diff.summary.unchanged, 1, 'unchanged = 1');

    const addedRows = diff.rows.filter(r => r.status === 'added');
    assertEqual(addedRows.length, 2, 'added 행 2개');
}

// ── 행 삭제 ──────────────────────────────────

header('행 삭제 (removed 감지)');

{
    const left = makeResult(
        [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }, { id: 3, name: 'Carol' }],
        [{ name: 'id', type: 'int' }, { name: 'name', type: 'varchar' }]
    );
    const right = makeResult(
        [{ id: 1, name: 'Alice' }],
        [{ name: 'id', type: 'int' }, { name: 'name', type: 'varchar' }]
    );

    const diff = computeDiff(left, right, ['id']);
    assertEqual(diff.summary.removed, 2, 'removed = 2');
    assertEqual(diff.summary.unchanged, 1, 'unchanged = 1');
}

// ── 행 수정 ──────────────────────────────────

header('행 수정 (modified 감지, 셀 단위)');

{
    const left = makeResult(
        [{ id: 1, name: 'Alice', email: 'alice@old.com' }],
        [{ name: 'id', type: 'int' }, { name: 'name', type: 'varchar' }, { name: 'email', type: 'varchar' }]
    );
    const right = makeResult(
        [{ id: 1, name: 'Alice', email: 'alice@new.com' }],
        [{ name: 'id', type: 'int' }, { name: 'name', type: 'varchar' }, { name: 'email', type: 'varchar' }]
    );

    const diff = computeDiff(left, right, ['id']);
    assertEqual(diff.summary.modified, 1, 'modified = 1');

    const modRow = diff.rows.find(r => r.status === 'modified');
    assert(modRow !== undefined, 'modified 행 존재');

    const emailCell = modRow!.cells.find(c => c.column === 'email');
    assert(emailCell !== undefined, 'email 셀 존재');
    assertEqual(emailCell!.changed, true, 'email 셀 changed = true');
    assertEqual(emailCell!.leftValue, 'alice@old.com', 'email leftValue');
    assertEqual(emailCell!.rightValue, 'alice@new.com', 'email rightValue');

    const nameCell = modRow!.cells.find(c => c.column === 'name');
    assertEqual(nameCell!.changed, false, 'name 셀 changed = false');
}

// ── 복합 변경 ──────────────────────────────────

header('복합 변경 (추가+삭제+수정 혼합)');

{
    const left = makeResult(
        [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }, { id: 3, name: 'Charlie' }],
        [{ name: 'id', type: 'int' }, { name: 'name', type: 'varchar' }]
    );
    const right = makeResult(
        [{ id: 1, name: 'Alice Updated' }, { id: 2, name: 'Bob' }, { id: 4, name: 'Dave' }],
        [{ name: 'id', type: 'int' }, { name: 'name', type: 'varchar' }]
    );

    const diff = computeDiff(left, right, ['id']);
    assertEqual(diff.summary.modified, 1, 'modified = 1');
    assertEqual(diff.summary.removed, 1, 'removed = 1');
    assertEqual(diff.summary.added, 1, 'added = 1');
    assertEqual(diff.summary.unchanged, 1, 'unchanged = 1');
}

// ── 빈 결과 ──────────────────────────────────

header('빈 결과 비교');

{
    const empty = makeResult([], [{ name: 'id', type: 'int' }]);
    const diff = computeDiff(empty, empty, ['id']);
    assertEqual(diff.summary.totalLeft, 0, 'totalLeft = 0');
    assertEqual(diff.summary.totalRight, 0, 'totalRight = 0');
    assertEqual(diff.rows.length, 0, 'rows.length = 0');
}

// ── 키 컬럼 자동 감지 ──────────────────────────────────

header('키 컬럼 자동 감지 (id 컬럼)');

{
    const left = makeResult(
        [{ id: 1, name: 'Alice' }],
        [{ name: 'id', type: 'int' }, { name: 'name', type: 'varchar' }]
    );
    const right = makeResult(
        [{ id: 1, name: 'Bob' }],
        [{ name: 'id', type: 'int' }, { name: 'name', type: 'varchar' }]
    );

    const diff = computeDiff(left, right);
    assertEqual(diff.summary.modified, 1, 'modified = 1');
    assert(diff.keyColumns.includes('id'), 'keyColumns에 id 포함');
}

// ── NULL 값 비교 ──────────────────────────────────

header('NULL 값 비교');

{
    const left = makeResult(
        [{ id: 1, name: null }],
        [{ name: 'id', type: 'int' }, { name: 'name', type: 'varchar' }]
    );
    const right = makeResult(
        [{ id: 1, name: 'Alice' }],
        [{ name: 'id', type: 'int' }, { name: 'name', type: 'varchar' }]
    );

    const diff = computeDiff(left, right, ['id']);
    assertEqual(diff.summary.modified, 1, 'null → 값 = modified');

    const nameCell = diff.rows[0].cells.find(c => c.column === 'name');
    assertEqual(nameCell!.changed, true, 'name 셀 changed = true');
    assertEqual(nameCell!.leftValue, null, 'leftValue = null');
    assertEqual(nameCell!.rightValue, 'Alice', 'rightValue = Alice');
}

// ── 대규모 데이터 성능 ──────────────────────────────────

header('대규모 데이터 (1000행) 성능');

{
    const leftRows = Array.from({ length: 1000 }, (_, i) => ({ id: i, val: i }));
    const rightRows = Array.from({ length: 1000 }, (_, i) => ({
        id: i, val: i === 500 ? 999 : i
    }));

    const left = makeResult(leftRows, [{ name: 'id', type: 'int' }, { name: 'val', type: 'int' }]);
    const right = makeResult(rightRows, [{ name: 'id', type: 'int' }, { name: 'val', type: 'int' }]);

    const start = Date.now();
    const diff = computeDiff(left, right, ['id']);
    const elapsed = Date.now() - start;

    assertEqual(diff.summary.modified, 1, '1000행 중 1개 modified');
    assertEqual(diff.summary.unchanged, 999, '999개 unchanged');
    assert(elapsed < 1000, `성능: ${elapsed}ms (1000ms 미만)`);
}

// ── diffToMarkdown ──────────────────────────────────

header('diffToMarkdown');

{
    const left = makeResult([{ id: 1 }], [{ name: 'id', type: 'int' }]);
    const right = makeResult([{ id: 1 }, { id: 2 }], [{ name: 'id', type: 'int' }]);
    const diff = computeDiff(left, right, ['id']);

    const md = diffToMarkdown(diff, 'before', 'after');
    assert(md.includes('before'), '마크다운에 before 포함');
    assert(md.includes('after'), '마크다운에 after 포함');
    assert(md.includes('Added'), '마크다운에 Added 포함');
}

// ── diffToJson ──────────────────────────────────

header('diffToJson');

{
    const left = makeResult([{ id: 1 }], [{ name: 'id', type: 'int' }]);
    const right = makeResult([{ id: 2 }], [{ name: 'id', type: 'int' }]);
    const diff = computeDiff(left, right, ['id']);

    const json = diffToJson(diff);
    const parsed = JSON.parse(json);
    assert(parsed.summary !== undefined, 'JSON에 summary 포함');
    assertEqual(parsed.summary.removed, 1, 'JSON removed = 1');
    assertEqual(parsed.summary.added, 1, 'JSON added = 1');
    assert(Array.isArray(parsed.changes), 'JSON에 changes 배열 포함');
}

// ── 결과 ──────────────────────────────────

console.log(`\n${'═'.repeat(50)}`);
console.log(`  결과: ✅ ${totalPass} 통과, ❌ ${totalFail} 실패`);
console.log(`${'═'.repeat(50)}`);

if (failures.length > 0) {
    console.log('\n실패 항목:');
    failures.forEach(f => console.log(`  - ${f}`));
    process.exit(1);
}
