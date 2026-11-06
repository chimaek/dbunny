const net = require('node:net');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { testPort } = require('../out/test/integration/testConfig');

function probe(port) {
    return new Promise(resolve => {
        const socket = net.connect({ host: '127.0.0.1', port });
        socket.setTimeout(1000);
        socket.once('connect', () => { socket.destroy(); resolve(true); });
        socket.once('error', () => { socket.destroy(); resolve(false); });
        socket.once('timeout', () => { socket.destroy(); resolve(false); });
    });
}
async function main() {
    const deadline = Date.now() + 120000;
    while (!(await Promise.all(['mysql', 'postgres', 'mongodb', 'redis', 'h2'].map(type => probe(testPort(type))))).every(Boolean)) {
        if (Date.now() >= deadline) { throw new Error('Test databases did not become ready within 120 seconds'); }
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    const folder = path.resolve(__dirname, '../out/test/integration');
    const logs = path.resolve(__dirname, '../test-results/integration');
    fs.mkdirSync(logs, { recursive: true });
    const files = ['run-all.js', ...fs.readdirSync(folder).filter(file => file.endsWith('.test.js')).sort()];
    const failures = [];
    for (const file of files) {
        const result = spawnSync(process.execPath, [path.join(folder, file)], { encoding: 'utf8', timeout: 180000, maxBuffer: 8 * 1024 * 1024 });
        const output = (result.stdout || '') + (result.stderr || '');
        fs.writeFileSync(path.join(logs, file + '.log'), output);
        if (result.status !== 0) {
            failures.push(file);
            console.error(`FAIL ${file}: ${result.error?.message || result.status}\n${output.slice(-7000)}`);
        } else {
            const summary = output.match(/RESULTS:.*|\d+ passed.*|\d+ 통과.*/g)?.slice(-1)[0] || 'completed';
            console.log(`PASS ${file}: ${summary}`);
        }
    }
    console.log(`Integration suites: ${files.length - failures.length}/${files.length} passed. Logs: ${logs}`);
    if (failures.length) { throw new Error(`Failed integration suites: ${failures.join(', ')}`); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
