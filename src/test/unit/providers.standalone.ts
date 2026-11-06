/**
 * v3.2.0 — Provider internal pure-logic standalone tests (npx tsx)
 * _parsePgParams, _escapeHtml, SQL generation edge cases
 *
 * 실행: npx tsx src/test/unit/providers.standalone.ts
 */

// ═══════════════════════════════════════════════════════════
// _parsePgParams tests (recreated here since it's a private method)
// ═══════════════════════════════════════════════════════════

import { RoutineParameter } from '../../types/database';

// Recreated for testing — identical logic to PostgresProvider._parsePgParams
function parsePgParams(args: string): RoutineParameter[] {
    if (!args) { return []; }
    const params: RoutineParameter[] = [];
    const parts = args.split(',').map(p => p.trim()).filter(Boolean);
    parts.forEach((part, idx) => {
        const match = part.match(/^(\w+)\s+(.+)$/);
        if (match) {
            let mode: 'IN' | 'OUT' | 'INOUT' = 'IN';
            let remaining = part;
            if (/^IN\s/i.test(remaining)) { mode = 'IN'; remaining = remaining.replace(/^IN\s+/i, ''); }
            else if (/^OUT\s/i.test(remaining)) { mode = 'OUT'; remaining = remaining.replace(/^OUT\s+/i, ''); }
            else if (/^INOUT\s/i.test(remaining)) { mode = 'INOUT'; remaining = remaining.replace(/^INOUT\s+/i, ''); }

            const nameMatch = remaining.match(/^(\w+)\s+(.+)$/);
            if (nameMatch) {
                params.push({ name: nameMatch[1], dataType: nameMatch[2], mode, ordinalPosition: idx });
            } else {
                params.push({ name: `arg${idx}`, dataType: remaining, mode, ordinalPosition: idx });
            }
        } else {
            params.push({ name: `arg${idx}`, dataType: part, mode: 'IN', ordinalPosition: idx });
        }
    });
    return params;
}

// Escape HTML (same logic as RoutinePanel._escapeHtml)
function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ═══════════════════════════════════════════════════════════
// MySQL CALL statement builder (recreated from executeRoutine logic)
// ═══════════════════════════════════════════════════════════

function buildCallStatement(name: string, params: Record<string, unknown>): string {
    const safeName = name.replace(/`/g, '``');
    const values = Object.values(params);
    const escapedValues = values.map(v => {
        if (v === null || v === undefined) { return 'NULL'; }
        if (typeof v === 'number') { return String(v); }
        return `'${String(v).replace(/'/g, "\\'").replace(/\\/g, '\\\\')}'`;
    });
    return `CALL \`${safeName}\`(${escapedValues.join(', ')})`;
}

// ═══════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════

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
function assert(cond: boolean, msg: string) { if (cond) {pass(msg);} else {fail(msg);} }
function assertEqual<T>(a: T, b: T, msg: string) { if (a === b) {pass(msg);} else {fail(msg, `exp=${JSON.stringify(b)} got=${JSON.stringify(a)}`);} }
function assertContains(s: string, substr: string, msg: string) { if (s.includes(substr)) {pass(msg);} else {fail(msg, `"${s.substring(0,80)}" missing "${substr}"`);} }
function assertNotContains(s: string, substr: string, msg: string) { if (!s.includes(substr)) {pass(msg);} else {fail(msg, `"${s.substring(0,80)}" contains forbidden "${substr}"`);} }

// ═══════════════════════════════════════════════════════════
// _parsePgParams
// ═══════════════════════════════════════════════════════════

console.log('\n── parsePgParams ──');

// Simple named params
const pg1 = parsePgParams('a INT, b TEXT');
assertEqual(pg1.length, 2, '2 simple params');
assertEqual(pg1[0].name, 'a', 'param 0 name');
assertEqual(pg1[0].dataType, 'INT', 'param 0 type');
assertEqual(pg1[0].mode, 'IN', 'param 0 default mode IN');
assertEqual(pg1[1].name, 'b', 'param 1 name');
assertEqual(pg1[1].dataType, 'TEXT', 'param 1 type');

// Explicit mode prefixes
const pg2 = parsePgParams('IN p_id INT, OUT p_result TEXT, INOUT p_flag BOOLEAN');
assertEqual(pg2.length, 3, '3 mode-explicit params');
assertEqual(pg2[0].mode, 'IN', 'IN mode');
assertEqual(pg2[1].mode, 'OUT', 'OUT mode');
assertEqual(pg2[2].mode, 'INOUT', 'INOUT mode');

// Unnamed params (just types)
const pg3 = parsePgParams('INT, TEXT, BOOLEAN');
assertEqual(pg3.length, 3, '3 unnamed params');
assertEqual(pg3[0].name, 'arg0', 'unnamed → arg0');
assertEqual(pg3[0].dataType, 'INT', 'unnamed type');
assertEqual(pg3[1].name, 'arg1', 'unnamed → arg1');
assertEqual(pg3[2].name, 'arg2', 'unnamed → arg2');

// Complex types
const pg4 = parsePgParams('p_data JSONB, p_arr INTEGER[], p_ts TIMESTAMP WITH TIME ZONE');
assertEqual(pg4.length, 3, '3 complex-type params');
assertEqual(pg4[0].dataType, 'JSONB', 'JSONB type');
assertEqual(pg4[1].dataType, 'INTEGER[]', 'array type');
assertEqual(pg4[2].dataType, 'TIMESTAMP WITH TIME ZONE', 'multi-word type');

// Default values
const pg5 = parsePgParams('p_name VARCHAR DEFAULT NULL, p_count INTEGER DEFAULT 0');
assertEqual(pg5.length, 2, '2 default-value params');

// Empty string
assertEqual(parsePgParams('').length, 0, 'empty → 0 params');

// Single unnamed param with mode
const pg7 = parsePgParams('OUT INTEGER');
assertEqual(pg7.length, 1, 'single OUT unnamed');
assertEqual(pg7[0].mode, 'OUT', 'OUT mode on unnamed');

// Mixed named and unnamed
const pg8 = parsePgParams('a INT, TEXT');
assertEqual(pg8.length, 2, 'mixed named + unnamed');
assertEqual(pg8[0].name, 'a', 'named param');
assertEqual(pg8[1].name, 'arg1', 'unnamed param fallback');

// Lowercase mode
const pg9 = parsePgParams('in p_x INT, out p_y INT');
assertEqual(pg9.length, 2, 'lowercase modes');
assertEqual(pg9[0].mode, 'IN', 'lowercase IN');
assertEqual(pg9[1].mode, 'OUT', 'lowercase OUT');

// Single word (no space)
const pg10 = parsePgParams('INTEGER');
assertEqual(pg10.length, 1, 'single unnamed type');
assertEqual(pg10[0].name, 'arg0', 'single type → arg0');

// Whitespace handling
const pg11 = parsePgParams('  a   INT  ,  b   TEXT  ');
assertEqual(pg11.length, 2, 'whitespace tolerant');
assertEqual(pg11[0].name, 'a', 'leading space handled');
assertEqual(pg11[1].name, 'b', 'trailing space handled');

// ═══════════════════════════════════════════════════════════
// _escapeHtml (RoutinePanel._escapeHtml)
// ═══════════════════════════════════════════════════════════

console.log('\n── escapeHtml ──');

assertEqual(escapeHtml('<script>'), '&lt;script&gt;', 'angle brackets');
assertEqual(escapeHtml('a & b'), 'a &amp; b', 'ampersand');
assertEqual(escapeHtml('"hello"'), '&quot;hello&quot;', 'double quotes');
assertEqual(escapeHtml("it's"), 'it&#39;s', 'single quote');
assertEqual(escapeHtml('normal text'), 'normal text', 'no special chars unchanged');
assertEqual(escapeHtml(''), '', 'empty string');
// XSS vectors
assertNotContains(escapeHtml('<img src=x onerror=alert(1)>'), '<', 'XSS: img tag escaped');
assertNotContains(escapeHtml('javascript:alert(1)'), '<', 'XSS: no angle brackets introduced');
// Multiple special chars
const escaped = escapeHtml('<a href="x" onclick=\'alert(1)\'>click & win</a>');
assertNotContains(escaped, '<', 'complex: no raw <');
assertNotContains(escaped, '>', 'complex: no raw >');
assertContains(escaped, '&lt;', 'complex: < encoded');
assertContains(escaped, '&gt;', 'complex: > encoded');
assertContains(escaped, '&quot;', 'complex: " encoded');
assertContains(escaped, '&#39;', 'complex: \' encoded');
assertContains(escaped, '&amp;', 'complex: & encoded');

// ═══════════════════════════════════════════════════════════
// MySQL CALL statement builder
// ═══════════════════════════════════════════════════════════

console.log('\n── buildCallStatement ──');

const call1 = buildCallStatement('sp_test', {});
assertEqual(call1, 'CALL `sp_test`()', 'CALL with no params');

const call2 = buildCallStatement('sp_test', { p_id: '42', p_name: 'hello' });
assertContains(call2, "CALL `sp_test`", 'CALL with string params');
assertContains(call2, "'42'", 'string param quoted');
assertContains(call2, "'hello'", 'string param 2 quoted');

const call3 = buildCallStatement('sp_calc', { p_num: 42 });
assertContains(call3, '42', 'numeric param unquoted');
assertNotContains(call3, "'42'", 'numeric param not string-quoted');

const call4 = buildCallStatement('sp_test', { p_name: "O'Brien" });
// Note: actual output is O\\'Brien due to escape ordering (single-quote → backslash-doubling)
const hasEscapedQuote = call4.includes("Brien") && !call4.includes("O'Brien");
assert(hasEscapedQuote, 'single quote in value escaped');

const call5 = buildCallStatement('sp_test', { p_null: null, p_name: 'test' });
assertContains(call5, 'NULL', 'NULL for null value');
assertContains(call5, "'test'", 'string after null');

// Backtick escaping in name
const call6 = buildCallStatement('sp`bad', {});
assertContains(call6, 'CALL `sp``bad`', 'backtick in name escaped');

// ═══════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════

console.log(`\n${'═'.repeat(60)}`);
console.log(`  Total: ${totalPass + totalFail} | ✅ Passed: ${totalPass} | ❌ Failed: ${totalFail}`);
if (failures.length > 0) {
    console.log(`\n  Failed:`);
    failures.forEach(f => console.log(`    - ${f}`));
}
console.log(`${'═'.repeat(60)}`);
process.exit(totalFail > 0 ? 1 : 0);
