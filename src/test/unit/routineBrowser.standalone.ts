/**
 * v3.2.0 Routine Browser — standalone unit tests (npx tsx)
 * Pure logic only, no vscode dependency.
 *
 * 실행: npx tsx src/test/unit/routineBrowser.standalone.ts
 */

import {
    parseRoutineParams,
    generateDropSQL,
    formatRoutineSource,
    getRoutineBadge,
    getRoutineIconId,
    supportsRoutines,
} from '../../utils/routineBrowser';

let totalPass = 0;
let totalFail = 0;
const failures: string[] = [];

function pass(msg: string) { totalPass++; console.log(`  ✅ ${msg}`); }
function fail(msg: string, detail?: string) {
    totalFail++;
    const d = detail ? ` — ${detail}` : '';
    console.log(`  ❌ ${msg}${d}`);
    failures.push(`${msg}${d}`);
}
function assert(cond: boolean, msg: string) { if (cond) pass(msg); else fail(msg); }
function assertEqual<T>(a: T, b: T, msg: string) { if (a === b) pass(msg); else fail(msg, `exp=${JSON.stringify(b)} got=${JSON.stringify(a)}`); }
function assertContains(s: string, substr: string, msg: string) { if (s.includes(substr)) pass(msg); else fail(msg, `"${s.substring(0,80)}" missing "${substr}"`); }
function assertNotContains(s: string, substr: string, msg: string) { if (!s.includes(substr)) pass(msg); else fail(msg, `"${s.substring(0,80)}" contains forbidden "${substr}"`); }

// ══════════════════════════════════════════════════
// parseRoutineParams — MySQL
// ══════════════════════════════════════════════════

console.log('\n── parseRoutineParams (MySQL) ──');

const sp1 = parseRoutineParams(
    'CREATE PROCEDURE proc1(IN p_id INT, OUT p_name VARCHAR(100), INOUT p_flag TINYINT)',
    'mysql'
);
assertEqual(sp1.length, 3, 'detects 3 params');
assertEqual(sp1[0].name, 'p_id', 'param 0 name');
assertEqual(sp1[0].mode, 'IN', 'param 0 mode IN');
assertEqual(sp1[1].mode, 'OUT', 'param 1 mode OUT');
assertEqual(sp1[2].mode, 'INOUT', 'param 2 mode INOUT');

const sp2 = parseRoutineParams(
    'CREATE PROCEDURE proc2(IN p_big DECIMAL(10,2), IN p_text VARCHAR(255))',
    'mysql'
);
assertEqual(sp2.length, 2, 'DECIMAL + VARCHAR params');
assertEqual(sp2[0].dataType, 'DECIMAL(10,2)', 'DECIMAL type parsed');

const sp3 = parseRoutineParams(
    'CREATE PROCEDURE proc3() BEGIN SELECT 1; END',
    'mysql'
);
assertEqual(sp3.length, 0, 'empty parens → 0 params');

const sp4 = parseRoutineParams('', 'mysql');
assertEqual(sp4.length, 0, 'empty string → 0 params');

// Avoid false positive on BEGIN (word boundary test)
const sp5 = parseRoutineParams(
    'CREATE PROCEDURE no_params() BEGIN SELECT NOW(); END',
    'mysql'
);
assertEqual(sp5.length, 0, 'BEGIN not matched as param');

// Complex type with spaces
const sp6 = parseRoutineParams(
    'CREATE PROCEDURE sp6(IN p_data JSON, IN p_flag ENUM("a","b"))',
    'mysql'
);
assert(sp6.length > 0, 'ENUM type detected');
const hasJson = sp6.some(p => p.dataType === 'JSON');
assert(hasJson, 'JSON type parsed');

// ══════════════════════════════════════════════════
// parseRoutineParams — PostgreSQL
// ══════════════════════════════════════════════════

console.log('\n── parseRoutineParams (PostgreSQL) ──');

const pp1 = parseRoutineParams(
    'CREATE FUNCTION fn_add(a INT, b INT) RETURNS INT AS $$ BEGIN RETURN a + b; END; $$ LANGUAGE plpgsql',
    'postgres'
);
assertEqual(pp1.length, 2, 'PG: 2 params');
assertEqual(pp1[0].name, 'a', 'PG: param 0 name');
assertEqual(pp1[0].dataType, 'INT', 'PG: param 0 type');

const pp2 = parseRoutineParams(
    'CREATE FUNCTION fn_concat(IN p_first TEXT, IN p_last TEXT) RETURNS TEXT AS $$ BEGIN RETURN p_first || p_last; END; $$ LANGUAGE plpgsql',
    'postgres'
);
assertEqual(pp2.length, 2, 'PG: IN mode explicit');
assertEqual(pp2[0].mode, 'IN', 'PG: mode IN');

const pp3 = parseRoutineParams(
    'CREATE FUNCTION fn_out(OUT p_result INT) RETURNS INT AS $$ BEGIN p_result := 42; END; $$ LANGUAGE plpgsql',
    'postgres'
);
assert(pp3.length > 0, 'PG: OUT param detected');
if (pp3.length > 0) assertEqual(pp3[0].mode, 'OUT', 'PG: mode OUT');

// ══════════════════════════════════════════════════
// generateDropSQL — all DB + type combos
// ══════════════════════════════════════════════════

console.log('\n── generateDropSQL ──');

const typeCombos: Array<[string, string, string]> = [
    ['procedure', 'mysql', 'DROP PROCEDURE'],
    ['function', 'mysql', 'DROP FUNCTION'],
    ['view', 'mysql', 'DROP VIEW'],
    ['trigger', 'mysql', 'DROP TRIGGER'],
    ['procedure', 'postgres', 'DROP PROCEDURE'],
    ['function', 'postgres', 'DROP FUNCTION'],
    ['view', 'postgres', 'DROP VIEW'],
    ['trigger', 'postgres', 'DROP TRIGGER'],
    ['view', 'sqlite', 'DROP VIEW'],
    ['trigger', 'sqlite', 'DROP TRIGGER'],
    ['view', 'h2', 'DROP VIEW'],
    ['trigger', 'h2', 'DROP TRIGGER'],
];
for (const [type, dbType, expectedKeyword] of typeCombos) {
    const sql = generateDropSQL('test_name', type as any, dbType);
    assertContains(sql, expectedKeyword, `${dbType} ${type}: contains ${expectedKeyword}`);
    assertContains(sql, 'test_name', `${dbType} ${type}: contains name`);
    assertContains(sql, 'IF EXISTS', `${dbType} ${type}: has IF EXISTS`);
}

// ══════════════════════════════════════════════════
// formatRoutineSource — HTML safety + keyword highlighting
// ══════════════════════════════════════════════════

console.log('\n── formatRoutineSource ──');

const f1 = formatRoutineSource('SELECT * FROM users', 'mysql');
assertContains(f1, '<span class="kw">', 'has keyword spans');
assertContains(f1, '<pre><code>', 'wraps in pre code');

const f2 = formatRoutineSource('<script>alert("xss")</script>', 'mysql');
assertNotContains(f2, '<script>', 'XSS: script tag escaped');
assertContains(f2, '&lt;script&gt;', 'XSS: script tag HTML-encoded');

const f3 = formatRoutineSource('DROP TABLE users; -- comment', 'mysql');
assertContains(f3, '<span class="kw">DROP</span>', 'DROP keyword highlighted');

const f4 = formatRoutineSource('', 'mysql');
assertContains(f4, '<code></code>', 'empty → empty code block');

const f5 = formatRoutineSource('CREATE OR REPLACE VIEW vw_test AS SELECT 1', 'postgres');
assertContains(f5, '<span class="kw">CREATE</span>', 'CREATE highlighted');
assertContains(f5, '<span class="kw">VIEW</span>', 'VIEW highlighted');

// ══════════════════════════════════════════════════
// getRoutineBadge
// ══════════════════════════════════════════════════

console.log('\n── getRoutineBadge ──');
assertEqual(getRoutineBadge('procedure'), 'P', 'procedure → P');
assertEqual(getRoutineBadge('function'), 'F', 'function → F');
assertEqual(getRoutineBadge('view'), 'V', 'view → V');
assertEqual(getRoutineBadge('trigger'), 'T', 'trigger → T');
// All badges are single chars and distinct
const allTypes: ('procedure' | 'function' | 'view' | 'trigger')[] = ['procedure', 'function', 'view', 'trigger'];
const badges = new Set(allTypes.map(t => getRoutineBadge(t)));
assertEqual(badges.size, 4, 'all badges are distinct');

// ══════════════════════════════════════════════════
// getRoutineIconId
// ══════════════════════════════════════════════════

console.log('\n── getRoutineIconId ──');
assertEqual(typeof getRoutineIconId('procedure'), 'string', 'procedure → string');
assertEqual(typeof getRoutineIconId('function'), 'string', 'function → string');
assertEqual(typeof getRoutineIconId('view'), 'string', 'view → string');
assertEqual(typeof getRoutineIconId('trigger'), 'string', 'trigger → string');
assert(getRoutineIconId('procedure').length > 0, 'icon id not empty');
// All IDs are valid VS Code product icon IDs
const iconIds = new Set(allTypes.map(t => getRoutineIconId(t)));
assertEqual(iconIds.size, 4, 'all icon ids are distinct');

// ══════════════════════════════════════════════════
// supportsRoutines
// ══════════════════════════════════════════════════

console.log('\n── supportsRoutines ──');
assert(supportsRoutines('mysql'), 'mysql supported');
assert(supportsRoutines('postgres'), 'postgres supported');
assert(supportsRoutines('sqlite'), 'sqlite supported');
assert(supportsRoutines('h2'), 'h2 supported');
assert(!supportsRoutines('mongodb'), 'mongodb NOT supported');
assert(!supportsRoutines('redis'), 'redis NOT supported');
assert(!supportsRoutines(''), 'empty string NOT supported');
assert(!supportsRoutines('oracle'), 'unknown DB NOT supported');

// ══════════════════════════════════════════════════
// Summary
// ══════════════════════════════════════════════════

console.log(`\n${'═'.repeat(60)}`);
console.log(`  Total: ${totalPass + totalFail} | ✅ Passed: ${totalPass} | ❌ Failed: ${totalFail}`);
if (failures.length > 0) {
    console.log(`\n  Failed:`);
    failures.forEach(f => console.log(`    - ${f}`));
}
console.log(`${'═'.repeat(60)}`);
process.exit(totalFail > 0 ? 1 : 0);
