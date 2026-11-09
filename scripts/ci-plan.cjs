const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const allChecks = () => ({ code: true, database: true, full: true });
const isDocument = file => /^(docs\/|(?:README|CHANGELOG|ROADMAP|CONTRIBUTING)(?:\.[^/]*)?$|LICENSE(?:\.[^/]*)?$)/i.test(file);
const isEnvironmentChange = file => /^(?:\.github\/|scripts\/|package(?:-lock)?\.json$|(?:esbuild|eslint\.config)\.[^/]+$|tsconfig[^/]*\.json$|\.vscodeignore$|\.gitignore$|\.vscode-test\.mjs$)/.test(file)
    || /^src\/(?:extension\.ts$|managers\/|providers\/(?:mysql|postgres|sqlite)Provider\.ts$|utils\/(?:credentialStore|encryption|guardedConnection|readOnlyGuard|webviewSecurity)\.ts$)/.test(file);

function classifyFiles(files) {
    if (!Array.isArray(files) || files.some(file => typeof file !== 'string')) { return allChecks(); }
    const changed = files.filter(file => !isDocument(file));
    if (changed.length === 0) { return { code: false, database: false, full: false }; }
    if (changed.some(isEnvironmentChange)) { return allChecks(); }
    // 신규 빌드 경로나 알 수 없는 파일 종류는 전체 검증으로 처리한다.
    if (changed.some(file => !/^(?:src\/|resources\/|docker-init\/|docker-compose\.ya?ml$)/.test(file))) { return allChecks(); }
    return {
        code: true,
        database: changed.some(file => /^(?:docker-init\/|docker-compose\.ya?ml$|src\/(?!locales\/|test\/(?:unit|suite|host)\/))/.test(file)),
        full: false
    };
}

function changedFiles(base, cwd = process.cwd()) {
    if (!/^(?:[a-f\d]{40}|[a-f\d]{64})$/i.test(base || '') || /^0+$/.test(base)) { throw new Error('Missing comparison base'); }
    const options = { cwd, encoding: 'utf8', timeout: 20000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } };
    try { execFileSync('git', ['cat-file', '-e', `${base}^{commit}`], options); }
    catch { execFileSync('git', ['fetch', '--no-tags', '--depth=1', 'origin', base], options); }
    // rename의 이전 경로도 검사하여 코드가 문서 경로로 이동해도 검사를 생략하지 않는다.
    return execFileSync('git', ['diff', '--no-renames', '--name-only', '-z', base, 'HEAD'], options).split('\0').filter(Boolean);
}

function makePlan({ eventName, forceFull = false, ref = '', files }) {
    if (forceFull || ref.startsWith('refs/tags/')) { return allChecks(); }
    if (eventName === 'workflow_dispatch' || eventName === 'workflow_call') {
        return { code: true, database: true, full: false };
    }
    if (!['push', 'pull_request'].includes(eventName)) { return allChecks(); }
    return classifyFiles(files);
}

function main() {
    const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
    const eventName = process.env.GITHUB_EVENT_NAME;
    let files;
    if (['push', 'pull_request'].includes(eventName)) {
        try { files = changedFiles(eventName === 'pull_request' ? event.pull_request?.base?.sha : event.before); }
        catch { console.log('Change comparison unavailable; selecting full verification.'); }
    }
    const plan = makePlan({ eventName, files, ref: process.env.GITHUB_REF || '', forceFull: process.env.CI_FORCE_FULL === 'true' });
    const output = Object.entries(plan).map(([key, value]) => `${key}=${value}`).join('\n') + '\n';
    if (process.env.GITHUB_OUTPUT) { fs.appendFileSync(process.env.GITHUB_OUTPUT, output); }
    if (process.env.GITHUB_STEP_SUMMARY) {
        fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Verification plan\n- Linux checks: ${plan.code}\n- Database integration: ${plan.database}\n- All OS / minimum + stable: ${plan.full}\n`);
    }
    console.log(output.trim());
}
module.exports = { classifyFiles, changedFiles, makePlan };
if (require.main === module) { main(); }
