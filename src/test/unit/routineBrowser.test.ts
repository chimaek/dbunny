import * as assert from 'assert';
import {
    parseRoutineParams,
    generateDropSQL,
    formatRoutineSource,
    getRoutineIconId,
    getRoutineBadge,
    supportsRoutines,
} from '../../utils/routineBrowser';

suite('Routine Browser Unit Tests', () => {

    suite('parseRoutineParams', () => {
        test('MySQL IN param', () => {
            const params = parseRoutineParams(
                'CREATE PROCEDURE sp_test(IN p_id INT, IN p_name VARCHAR(255))',
                'mysql'
            );
            assert.strictEqual(params.length, 2);
            assert.strictEqual(params[0].name, 'p_id');
            assert.strictEqual(params[0].dataType, 'INT');
            assert.strictEqual(params[0].mode, 'IN');
            assert.strictEqual(params[1].name, 'p_name');
            assert.strictEqual(params[1].dataType, 'VARCHAR(255)');
        });

        test('MySQL OUT param', () => {
            const params = parseRoutineParams(
                'CREATE PROCEDURE sp_calc(IN p_x INT, OUT p_result INT)',
                'mysql'
            );
            assert.strictEqual(params.length, 2);
            assert.strictEqual(params[1].mode, 'OUT');
        });

        test('MySQL no params', () => {
            const params = parseRoutineParams(
                'CREATE PROCEDURE sp_simple() BEGIN SELECT 1; END',
                'mysql'
            );
            assert.strictEqual(params.length, 0);
        });

        test('PostgreSQL function params', () => {
            const params = parseRoutineParams(
                'CREATE FUNCTION fn_add(a INT, b INT) RETURNS INT AS $$ BEGIN RETURN a + b; END; $$ LANGUAGE plpgsql',
                'postgres'
            );
            assert.strictEqual(params.length, 2);
            assert.strictEqual(params[0].name, 'a');
            assert.strictEqual(params[0].dataType, 'INT');
            assert.strictEqual(params[1].name, 'b');
            assert.strictEqual(params[1].dataType, 'INT');
        });

        test('empty source', () => {
            assert.strictEqual(parseRoutineParams('', 'mysql').length, 0);
        });
    });

    suite('generateDropSQL', () => {
        test('MySQL procedure', () => {
            const sql = generateDropSQL('sp_test', 'procedure', 'mysql');
            assert.ok(sql.includes('DROP PROCEDURE'));
            assert.ok(sql.includes('sp_test'));
        });

        test('PostgreSQL function', () => {
            const sql = generateDropSQL('fn_test', 'function', 'postgres');
            assert.ok(sql.includes('DROP FUNCTION'));
            assert.ok(sql.includes('fn_test'));
        });

        test('MySQL view', () => {
            const sql = generateDropSQL('vw_test', 'view', 'mysql');
            assert.ok(sql.includes('DROP VIEW'));
        });

        test('H2 view with double quotes', () => {
            const sql = generateDropSQL('VW_TEST', 'view', 'h2');
            assert.ok(sql.includes('DROP VIEW'));
            assert.ok(sql.includes('"VW_TEST"'));
        });

        test('trigger', () => {
            const sql = generateDropSQL('trg_test', 'trigger', 'mysql');
            assert.ok(sql.includes('DROP TRIGGER'));
        });
    });

    suite('formatRoutineSource', () => {
        test('escapes HTML entities', () => {
            const result = formatRoutineSource('<script>alert(1)</script>', 'mysql');
            assert.ok(result.includes('&lt;script&gt;'));
            assert.ok(!result.includes('<script>'));
        });

        test('highlights SQL keywords', () => {
            const result = formatRoutineSource('CREATE PROCEDURE test() BEGIN SELECT 1; END', 'mysql');
            assert.ok(result.includes('class="kw"'));
        });

        test('empty source returns empty code block', () => {
            const result = formatRoutineSource('', 'mysql');
            assert.ok(result.includes('<code></code>'));
        });
    });

    suite('getRoutineBadge', () => {
        test('procedure returns P', () => assert.strictEqual(getRoutineBadge('procedure'), 'P'));
        test('function returns F', () => assert.strictEqual(getRoutineBadge('function'), 'F'));
        test('view returns V', () => assert.strictEqual(getRoutineBadge('view'), 'V'));
        test('trigger returns T', () => assert.strictEqual(getRoutineBadge('trigger'), 'T'));
    });

    suite('supportsRoutines', () => {
        test('mysql supported', () => assert.ok(supportsRoutines('mysql')));
        test('postgres supported', () => assert.ok(supportsRoutines('postgres')));
        test('sqlite supported', () => assert.ok(supportsRoutines('sqlite')));
        test('h2 supported', () => assert.ok(supportsRoutines('h2')));
        test('mongodb not supported', () => assert.ok(!supportsRoutines('mongodb')));
        test('redis not supported', () => assert.ok(!supportsRoutines('redis')));
    });

    suite('getRoutineIconId', () => {
        test('returns string icon id for each type', () => {
            assert.strictEqual(typeof getRoutineIconId('procedure'), 'string');
            assert.strictEqual(typeof getRoutineIconId('function'), 'string');
            assert.strictEqual(typeof getRoutineIconId('view'), 'string');
            assert.strictEqual(typeof getRoutineIconId('trigger'), 'string');
        });
    });
});
