import * as assert from 'assert';
import { compareResults, computeDiff, diffToMarkdown, diffToJson } from '../../utils/resultDiff';
import { QueryResult } from '../../types/database';

// ============================================================
// Result Diff Unit Tests — v3.1.0
// DB 연결 없이 순수 diff 계산 로직만 테스트
// ============================================================

function makeResult(rows: Record<string, unknown>[], fields: { name: string; type: string }[]): QueryResult {
    return { rows, fields, rowCount: rows.length, executionTime: 0 };
}

suite('Result Diff — duplicate key contract', () => {
    const fields = [{ name: 'id', type: 'int' }, { name: 'name', type: 'text' }];

    test('같은 키의 모든 원본 행과 양쪽 인덱스를 보존한다', () => {
        const left = makeResult([{ id: 1, name: 'first' }, { id: 1, name: 'second' }, { id: 2, name: 'unique' }], fields);
        const right = makeResult([{ id: 1, name: 'other' }], fields);
        const before = JSON.stringify({ left, right });
        const result = compareResults(left, right, ['id']);
        assert.strictEqual(result.kind, 'ambiguous');
        if (result.kind !== 'ambiguous') { assert.fail('Duplicate keys must not produce a normal diff'); }
        assert.strictEqual(result.left, left);
        assert.strictEqual(result.right, right);
        assert.strictEqual(result.left.rows.length, 3);
        assert.deepStrictEqual(result.duplicates, [{ key: { id: 1 }, leftRowIndexes: [0, 1], rightRowIndexes: [0] }]);
        assert.strictEqual(JSON.stringify({ left, right }), before);
        assert.ok(!('diff' in result));
    });

    test('오른쪽만 중복인 키와 왼쪽에 없는 키도 감지한다', () => {
        const result = compareResults(makeResult([{ id: 1, name: 'left' }], fields), makeResult([{ id: 2, name: 'a' }, { id: 2, name: 'b' }], fields), ['id']);
        assert.strictEqual(result.kind, 'ambiguous');
        if (result.kind !== 'ambiguous') { assert.fail('Expected ambiguous result'); }
        assert.deepStrictEqual(result.duplicates, [{ key: { id: 2 }, leftRowIndexes: [], rightRowIndexes: [0, 1] }]);
    });

    test('양쪽 여러 중복 그룹을 자동 감지한 키로 구분한다', () => {
        const left = makeResult([{ id: 1, name: 'a' }, { id: 2, name: 'b' }, { id: 1, name: 'c' }], fields);
        const right = makeResult([{ id: 2, name: 'x' }, { id: 2, name: 'y' }, { id: 1, name: 'z' }], fields);
        const result = compareResults(left, right);
        assert.strictEqual(result.kind, 'ambiguous');
        if (result.kind !== 'ambiguous') { assert.fail('Expected ambiguous result'); }
        assert.deepStrictEqual(result.keyColumns, ['id']);
        assert.deepStrictEqual(result.duplicates, [
            { key: { id: 1 }, leftRowIndexes: [0, 2], rightRowIndexes: [2] },
            { key: { id: 2 }, leftRowIndexes: [1], rightRowIndexes: [0, 1] }
        ]);
    });

    test('동일한 두 결과의 중복 행을 정상 비교로 축약하지 않는다', () => {
        const data = makeResult([{ id: 1, name: 'first' }, { id: 1, name: 'second' }], fields);
        const result = compareResults(data, data, []);
        assert.strictEqual(result.kind, 'ambiguous');
        if (result.kind !== 'ambiguous') { assert.fail('Expected ambiguous result'); }
        assert.deepStrictEqual(result.duplicates[0].leftRowIndexes, [0, 1]);
        assert.deepStrictEqual(result.duplicates[0].rightRowIndexes, [0, 1]);
    });

    test('공통 컬럼 전체로 비교할 때도 동일 행의 중복을 감지한다', () => {
        const data = makeResult([{ value: null }, { value: null }], [{ name: 'value', type: 'text' }]);
        const result = compareResults(data, makeResult([], data.fields));
        assert.strictEqual(result.kind, 'ambiguous');
        if (result.kind !== 'ambiguous') { assert.fail('Expected ambiguous result'); }
        assert.deepStrictEqual(result.keyColumns, ['value']);
        assert.deepStrictEqual(result.duplicates, [{ key: { value: null }, leftRowIndexes: [0, 1], rightRowIndexes: [] }]);
    });

    test('유일 키는 기존 추가·삭제·변경·동일 결과를 유지한다', () => {
        const left = makeResult([{ id: 1, name: 'old' }, { id: 2, name: 'removed' }, { id: 4, name: 'same' }], fields);
        const right = makeResult([{ id: 1, name: 'new' }, { id: 3, name: 'added' }, { id: 4, name: 'same' }], fields);
        const result = compareResults(left, right);
        assert.strictEqual(result.kind, 'diff');
        if (result.kind !== 'diff') { assert.fail('Expected normal diff'); }
        assert.deepStrictEqual(result.diff.summary, { totalLeft: 3, totalRight: 3, added: 1, removed: 1, modified: 1, unchanged: 1 });
        assert.deepStrictEqual(result.diff.rows.map(row => row.status), ['removed', 'modified', 'unchanged', 'added']);
    });

    test('빈 결과는 정상적인 빈 diff를 반환한다', () => {
        const result = compareResults(makeResult([], fields), makeResult([], fields));
        assert.strictEqual(result.kind, 'diff');
        if (result.kind !== 'diff') { assert.fail('Expected normal diff'); }
        assert.deepStrictEqual(result.diff.rows, []);
        assert.strictEqual(result.diff.summary.unchanged, 0);
    });
});

suite('Result Diff — computeDiff', () => {

    test('두 결과가 동일한 경우 (모두 unchanged)', () => {
        const left = makeResult(
            [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }],
            [{ name: 'id', type: 'int' }, { name: 'name', type: 'varchar' }]
        );
        const right = makeResult(
            [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }],
            [{ name: 'id', type: 'int' }, { name: 'name', type: 'varchar' }]
        );

        const diff = computeDiff(left, right, ['id']);

        assert.strictEqual(diff.summary.added, 0);
        assert.strictEqual(diff.summary.removed, 0);
        assert.strictEqual(diff.summary.modified, 0);
        assert.strictEqual(diff.summary.unchanged, 2);
        assert.strictEqual(diff.rows.length, 2);
    });

    test('행 추가 (added 감지)', () => {
        const left = makeResult(
            [{ id: 1, name: 'Alice' }],
            [{ name: 'id', type: 'int' }, { name: 'name', type: 'varchar' }]
        );
        const right = makeResult(
            [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }, { id: 3, name: 'Carol' }],
            [{ name: 'id', type: 'int' }, { name: 'name', type: 'varchar' }]
        );

        const diff = computeDiff(left, right, ['id']);

        assert.strictEqual(diff.summary.added, 2);
        assert.strictEqual(diff.summary.removed, 0);
        assert.strictEqual(diff.summary.modified, 0);
        assert.strictEqual(diff.summary.unchanged, 1);

        const addedRows = diff.rows.filter(r => r.status === 'added');
        assert.strictEqual(addedRows.length, 2);
        assert.strictEqual(addedRows[0].rightRow?.['name'], 'Bob');
    });

    test('행 삭제 (removed 감지)', () => {
        const left = makeResult(
            [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }, { id: 3, name: 'Carol' }],
            [{ name: 'id', type: 'int' }, { name: 'name', type: 'varchar' }]
        );
        const right = makeResult(
            [{ id: 1, name: 'Alice' }],
            [{ name: 'id', type: 'int' }, { name: 'name', type: 'varchar' }]
        );

        const diff = computeDiff(left, right, ['id']);

        assert.strictEqual(diff.summary.added, 0);
        assert.strictEqual(diff.summary.removed, 2);
        assert.strictEqual(diff.summary.unchanged, 1);

        const removedRows = diff.rows.filter(r => r.status === 'removed');
        assert.strictEqual(removedRows.length, 2);
    });

    test('행 수정 (modified 감지, 셀 단위 비교)', () => {
        const left = makeResult(
            [{ id: 1, name: 'Alice', email: 'alice@old.com' }],
            [{ name: 'id', type: 'int' }, { name: 'name', type: 'varchar' }, { name: 'email', type: 'varchar' }]
        );
        const right = makeResult(
            [{ id: 1, name: 'Alice', email: 'alice@new.com' }],
            [{ name: 'id', type: 'int' }, { name: 'name', type: 'varchar' }, { name: 'email', type: 'varchar' }]
        );

        const diff = computeDiff(left, right, ['id']);

        assert.strictEqual(diff.summary.modified, 1);
        assert.strictEqual(diff.summary.unchanged, 0);

        const modRow = diff.rows.find(r => r.status === 'modified');
        assert.ok(modRow);

        const emailCell = modRow!.cells.find(c => c.column === 'email');
        assert.ok(emailCell);
        assert.strictEqual(emailCell!.changed, true);
        assert.strictEqual(emailCell!.leftValue, 'alice@old.com');
        assert.strictEqual(emailCell!.rightValue, 'alice@new.com');

        const nameCell = modRow!.cells.find(c => c.column === 'name');
        assert.ok(nameCell);
        assert.strictEqual(nameCell!.changed, false);
    });

    test('복합 변경 (추가+삭제+수정 혼합)', () => {
        const left = makeResult(
            [
                { id: 1, name: 'Alice' },
                { id: 2, name: 'Bob' },
                { id: 3, name: 'Charlie' }
            ],
            [{ name: 'id', type: 'int' }, { name: 'name', type: 'varchar' }]
        );
        const right = makeResult(
            [
                { id: 1, name: 'Alice Updated' },
                { id: 2, name: 'Bob' },
                { id: 4, name: 'Dave' }
            ],
            [{ name: 'id', type: 'int' }, { name: 'name', type: 'varchar' }]
        );

        const diff = computeDiff(left, right, ['id']);

        assert.strictEqual(diff.summary.modified, 1);
        assert.strictEqual(diff.summary.removed, 1);
        assert.strictEqual(diff.summary.added, 1);
        assert.strictEqual(diff.summary.unchanged, 1);
    });

    test('빈 결과 비교', () => {
        const empty = makeResult([], [{ name: 'id', type: 'int' }]);

        const diff = computeDiff(empty, empty, ['id']);

        assert.strictEqual(diff.summary.totalLeft, 0);
        assert.strictEqual(diff.summary.totalRight, 0);
        assert.strictEqual(diff.summary.added, 0);
        assert.strictEqual(diff.summary.removed, 0);
        assert.strictEqual(diff.summary.modified, 0);
        assert.strictEqual(diff.summary.unchanged, 0);
    });

    test('왼쪽 빈 결과 → 모두 added', () => {
        const empty = makeResult([], [{ name: 'id', type: 'int' }]);
        const right = makeResult([{ id: 1 }], [{ name: 'id', type: 'int' }]);

        const diff = computeDiff(empty, right, ['id']);

        assert.strictEqual(diff.summary.added, 1);
        assert.strictEqual(diff.summary.removed, 0);
    });

    test('오른쪽 빈 결과 → 모두 removed', () => {
        const left = makeResult([{ id: 1 }], [{ name: 'id', type: 'int' }]);
        const empty = makeResult([], [{ name: 'id', type: 'int' }]);

        const diff = computeDiff(left, empty, ['id']);

        assert.strictEqual(diff.summary.added, 0);
        assert.strictEqual(diff.summary.removed, 1);
    });

    test('키 컬럼 지정 시 해당 컬럼으로만 식별', () => {
        const left = makeResult(
            [{ code: 'A', val: 1 }, { code: 'B', val: 2 }],
            [{ name: 'code', type: 'varchar' }, { name: 'val', type: 'int' }]
        );
        const right = makeResult(
            [{ code: 'A', val: 10 }, { code: 'B', val: 2 }],
            [{ name: 'code', type: 'varchar' }, { name: 'val', type: 'int' }]
        );

        const diff = computeDiff(left, right, ['code']);

        assert.strictEqual(diff.summary.modified, 1);
        assert.strictEqual(diff.summary.unchanged, 1);
        assert.deepStrictEqual(diff.keyColumns, ['code']);
    });

    test('키 컬럼 자동 감지 (id 컬럼)', () => {
        const left = makeResult(
            [{ id: 1, name: 'Alice' }],
            [{ name: 'id', type: 'int' }, { name: 'name', type: 'varchar' }]
        );
        const right = makeResult(
            [{ id: 1, name: 'Bob' }],
            [{ name: 'id', type: 'int' }, { name: 'name', type: 'varchar' }]
        );

        const diff = computeDiff(left, right);

        assert.strictEqual(diff.summary.modified, 1);
        assert.ok(diff.keyColumns.includes('id'));
    });

    test('컬럼이 다른 결과 병합', () => {
        const left = makeResult(
            [{ id: 1, name: 'Alice' }],
            [{ name: 'id', type: 'int' }, { name: 'name', type: 'varchar' }]
        );
        const right = makeResult(
            [{ id: 1, email: 'alice@co.kr' }],
            [{ name: 'id', type: 'int' }, { name: 'email', type: 'varchar' }]
        );

        const diff = computeDiff(left, right, ['id']);

        assert.ok(diff.columns.includes('name'));
        assert.ok(diff.columns.includes('email'));
        assert.strictEqual(diff.columns.length, 3);
    });

    test('NULL 값 비교', () => {
        const left = makeResult(
            [{ id: 1, name: null }],
            [{ name: 'id', type: 'int' }, { name: 'name', type: 'varchar' }]
        );
        const right = makeResult(
            [{ id: 1, name: 'Alice' }],
            [{ name: 'id', type: 'int' }, { name: 'name', type: 'varchar' }]
        );

        const diff = computeDiff(left, right, ['id']);

        assert.strictEqual(diff.summary.modified, 1);
        const nameCell = diff.rows[0].cells.find(c => c.column === 'name');
        assert.strictEqual(nameCell!.changed, true);
        assert.strictEqual(nameCell!.leftValue, null);
        assert.strictEqual(nameCell!.rightValue, 'Alice');
    });

    test('대규모 데이터 (1000행) 성능', () => {
        const leftRows = Array.from({ length: 1000 }, (_, i) => ({ id: i, val: i }));
        const rightRows = Array.from({ length: 1000 }, (_, i) => ({
            id: i, val: i === 500 ? 999 : i
        }));

        const left = makeResult(leftRows, [{ name: 'id', type: 'int' }, { name: 'val', type: 'int' }]);
        const right = makeResult(rightRows, [{ name: 'id', type: 'int' }, { name: 'val', type: 'int' }]);

        const start = Date.now();
        const diff = computeDiff(left, right, ['id']);
        const elapsed = Date.now() - start;

        assert.strictEqual(diff.summary.modified, 1);
        assert.strictEqual(diff.summary.unchanged, 999);
        assert.ok(elapsed < 1000, `Diff took ${elapsed}ms, should be under 1000ms`);
    });

    test('정렬 순서: removed → modified → unchanged → added', () => {
        const left = makeResult(
            [{ id: 1, v: 'a' }, { id: 2, v: 'b' }, { id: 3, v: 'c' }],
            [{ name: 'id', type: 'int' }, { name: 'v', type: 'varchar' }]
        );
        const right = makeResult(
            [{ id: 1, v: 'a-mod' }, { id: 2, v: 'b' }, { id: 4, v: 'new' }],
            [{ name: 'id', type: 'int' }, { name: 'v', type: 'varchar' }]
        );

        const diff = computeDiff(left, right, ['id']);

        const statuses = diff.rows.map(r => r.status);
        const removedIdx = statuses.indexOf('removed');
        const modifiedIdx = statuses.indexOf('modified');
        const unchangedIdx = statuses.indexOf('unchanged');
        const addedIdx = statuses.indexOf('added');

        assert.ok(removedIdx < modifiedIdx, 'removed before modified');
        assert.ok(modifiedIdx < unchangedIdx, 'modified before unchanged');
        assert.ok(unchangedIdx < addedIdx, 'unchanged before added');
    });
});

suite('Result Diff — diffToMarkdown', () => {

    test('마크다운 출력에 요약 포함', () => {
        const left = makeResult([{ id: 1 }], [{ name: 'id', type: 'int' }]);
        const right = makeResult([{ id: 1 }, { id: 2 }], [{ name: 'id', type: 'int' }]);
        const diff = computeDiff(left, right, ['id']);

        const md = diffToMarkdown(diff, 'before', 'after');

        assert.ok(md.includes('before'));
        assert.ok(md.includes('after'));
        assert.ok(md.includes('Added'));
        assert.ok(md.includes('1'));
    });

    test('변경 없음 메시지', () => {
        const same = makeResult([{ id: 1 }], [{ name: 'id', type: 'int' }]);
        const diff = computeDiff(same, same, ['id']);

        const md = diffToMarkdown(diff, 'a', 'b');
        assert.ok(md.includes('No differences found'));
    });
});

suite('Result Diff — diffToJson', () => {

    test('JSON 출력에 summary 포함', () => {
        const left = makeResult([{ id: 1 }], [{ name: 'id', type: 'int' }]);
        const right = makeResult([{ id: 2 }], [{ name: 'id', type: 'int' }]);
        const diff = computeDiff(left, right, ['id']);

        const json = diffToJson(diff);
        const parsed = JSON.parse(json);

        assert.ok(parsed.summary);
        assert.strictEqual(parsed.summary.removed, 1);
        assert.strictEqual(parsed.summary.added, 1);
        assert.ok(Array.isArray(parsed.changes));
    });
});
