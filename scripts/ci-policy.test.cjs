const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { classifyFiles, changedFiles, makePlan } = require('./ci-plan.cjs');
const { getTestVersions } = require('./test-versions.cjs');
const { checkResults } = require('./ci-result.cjs');

test('Documentation-only and empty diffs skip expensive jobs', () => {
    for (const files of [[], ['README.md'], ['docs/design.md', 'CHANGELOG.md', 'CONTRIBUTING.md']]) {
        assert.deepEqual(classifyFiles(files), { code: false, database: false, full: false });
    }
});
test('Unit tests, locale resources and images keep the Linux package check', () => {
    for (const file of ['src/test/unit/resultPin.test.ts', 'src/test/host/connectionSecurity.test.ts', 'src/locales/ko.json', 'resources/bunny.svg']) {
        assert.deepEqual(classifyFiles([file]), { code: true, database: false, full: false });
    }
});
test('Queries, commands, UI SQL, DB fixtures and integration tests select real DB verification', () => {
    for (const file of ['src/utils/dataImport.ts', 'src/commands/index.ts', 'src/webview/RowInsertPanel.ts', 'src/providers/h2Provider.ts', 'src/test/integration/routine.test.ts', 'docker-compose.yml', 'docker-init/mysql/init.sql']) {
        assert.deepEqual(classifyFiles([file]), { code: true, database: true, full: false });
    }
});
test('Environment-sensitive changes retain every platform and supported version', () => {
    for (const file of ['package.json', 'package-lock.json', '.github/workflows/ci.yml', '.vscodeignore', '.gitignore', '.vscode-test.mjs', 'tsconfig.json', 'esbuild.js', 'scripts/verify-vsix.cjs', 'src/providers/postgresProvider.ts', 'src/providers/mysqlProvider.ts', 'src/providers/sqliteProvider.ts', 'src/managers/connectionManager.ts', 'src/utils/credentialStore.ts']) {
        assert.deepEqual(classifyFiles([file]), { code: true, database: true, full: true }, file);
    }
});
test('Unknown paths and unavailable comparisons select full verification', () => {
    for (const files of [undefined, null, ['new-build-system/config.json'], ['README.md', 'package.json']]) {
        assert.deepEqual(classifyFiles(files), { code: true, database: true, full: true });
    }
});
test('Release tags and explicit full requests cannot be reduced to documentation-only checks', () => {
    for (const options of [{ ref: 'refs/tags/v3.2.0' }, { forceFull: true }]) {
        assert.deepEqual(makePlan({ eventName: 'push', files: ['README.md'], ...options }), { code: true, database: true, full: true });
    }
});
test('Manual quick verification includes Linux and real databases', () => {
    assert.deepEqual(makePlan({ eventName: 'workflow_dispatch' }), { code: true, database: true, full: false });
    assert.deepEqual(makePlan({ eventName: 'unknown' }), { code: true, database: true, full: true });
});
test('A complete push range and both sides of a rename are inspected', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dbunny-ci-policy-'));
    const git = (...args) => execFileSync('git', args, { cwd: directory, encoding: 'utf8' }).trim();
    const commit = message => { git('add', '.'); git('-c', 'user.name=Test Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', message); };
    try {
        git('init');
        fs.mkdirSync(path.join(directory, 'src/utils'), { recursive: true });
        fs.writeFileSync(path.join(directory, 'src/utils/readOnlyGuard.ts'), 'export const policy = true;\n');
        commit('initial');
        const base = git('rev-parse', 'HEAD');
        fs.mkdirSync(path.join(directory, 'docs'));
        git('mv', 'src/utils/readOnlyGuard.ts', 'docs/policy.md');
        commit('move source');
        fs.writeFileSync(path.join(directory, 'README.md'), 'docs\n');
        commit('docs');
        const files = changedFiles(base, directory);
        assert.ok(files.includes('src/utils/readOnlyGuard.ts'));
        assert.ok(files.includes('docs/policy.md'));
        assert.ok(files.includes('README.md'));
        assert.strictEqual(classifyFiles(files).full, true);
    } finally {
        assert.strictEqual(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
        assert.ok(path.basename(directory).startsWith('dbunny-ci-policy-'));
        fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
});
test('Single-version users keep the old CLI behavior', () => {
    assert.deepEqual(getTestVersions({}), ['stable']);
    assert.deepEqual(getTestVersions({ VSCODE_TEST_VERSION: '1.85.0' }), ['1.85.0']);
});
test('One installed harness can verify both versions without duplicate launches', () => {
    assert.deepEqual(getTestVersions({ VSCODE_TEST_VERSIONS: '["1.85.0","stable","stable"]', VSCODE_TEST_VERSION: 'insiders' }), ['1.85.0', 'stable']);
    for (const value of ['[]', '{}', '[null]', '["bad-version"]', 'invalid']) {
        assert.throws(() => getTestVersions({ VSCODE_TEST_VERSIONS: value }));
    }
});
const results = (flags, values = {}) => ({
    plan: { result: 'success', outputs: flags },
    build: { result: 'success' }, compatibility: { result: 'skipped' }, integration: { result: 'skipped' }, ...values
});
test('A stable result gate succeeds for docs, quick and full verification', () => {
    assert.match(checkResults(results({ code: 'false', database: 'false', full: 'false' }, { build: { result: 'skipped' } })), /passed/);
    assert.match(checkResults(results({ code: 'true', database: 'false', full: 'false' })), /passed/);
    assert.match(checkResults(results({ code: 'true', database: 'true', full: 'true' }, { integration: { result: 'success' }, compatibility: { result: 'success' } })), /passed/);
});
test('Missing, skipped, failed or cancelled required checks fail the final result', () => {
    for (const state of ['failure', 'cancelled', 'skipped', undefined]) {
        assert.throws(() => checkResults(results({ code: 'true', database: 'false', full: 'false' }, { build: { result: state } })));
    }
    assert.throws(() => checkResults(results({ code: 'true', database: 'true', full: 'false' })));
    assert.throws(() => checkResults(results({ code: 'true', database: 'false', full: 'true' })));
    assert.throws(() => checkResults(results({ code: 'false' })));
    assert.throws(() => checkResults(results({}, { plan: { result: 'failure' } })));
});
