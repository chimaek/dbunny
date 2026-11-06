const { readdirSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const Mocha = require('mocha');

async function main() {
    const root = path.join(__dirname, '..', 'out', 'test', 'unit');
    const files = readdirSync(root);
    const mocha = new Mocha({ ui: 'tdd', timeout: 15000, reporter: 'spec' });
    for (const file of files.filter(file => file.endsWith('.test.js')).sort()) {
        mocha.addFile(path.join(root, file));
    }
    let failures = await new Promise(resolve => mocha.run(resolve));
    for (const file of files.filter(file => file.endsWith('.standalone.js')).sort()) {
        const result = spawnSync(process.execPath, [path.join(root, file)], { encoding: 'utf8', timeout: 30000 });
        if (result.status !== 0) {
            process.stderr.write(result.stdout || '');
            process.stderr.write(result.stderr || '');
            if (result.error) { console.error(result.error.message); }
            failures++;
        } else {
            console.log(`PASS ${file}`);
        }
    }
    if (failures > 0) { process.exitCode = 1; }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
