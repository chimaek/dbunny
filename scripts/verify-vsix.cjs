const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createRequire } = require('node:module');
const assert = require('node:assert/strict');
const yauzl = require('yauzl');
const { runTests } = require('@vscode/test-electron');

async function extract(archive, directory) {
    return new Promise((resolve, reject) => {
        yauzl.open(archive, { lazyEntries: true }, (error, zip) => {
            if (error) { reject(error); return; }
            zip.on('error', reject);
            zip.on('end', resolve);
            zip.on('entry', entry => {
                const target = path.resolve(directory, entry.fileName);
                if (!target.startsWith(directory + path.sep)) { reject(new Error('Invalid archive path')); zip.close(); return; }
                if (/(^|\/)(test-data|test-results|docker-init|scripts)\/|\.db$|\.map$|\.log$|docker-compose\.yml$|resources\/(demo\.gif|bunny\.jpeg|bunny-icon2\.png)$/.test(entry.fileName)) {
                    reject(new Error(`Development file included in VSIX: ${entry.fileName}`)); zip.close(); return;
                }
                if (entry.fileName.endsWith('/')) { fs.mkdirSync(target, { recursive: true }); zip.readEntry(); return; }
                fs.mkdirSync(path.dirname(target), { recursive: true });
                zip.openReadStream(entry, (streamError, stream) => {
                    if (streamError) { reject(streamError); return; }
                    const output = fs.createWriteStream(target);
                    output.on('error', reject);
                    stream.on('error', reject);
                    output.on('close', () => zip.readEntry());
                    stream.pipe(output);
                });
            });
            zip.readEntry();
        });
    });
}
async function main() {
    const archive = path.resolve(process.argv[2] || 'dbunny.vsix');
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dbunny-vsix-'));
    try {
        await extract(archive, directory);
        const extension = path.join(directory, 'extension');
        const manifest = JSON.parse(fs.readFileSync(path.join(extension, 'package.json'), 'utf8'));
        assert.equal(manifest.publisher, 'chimaek');
        assert.equal(manifest.name, 'dbunny');
        for (const file of ['dist/extension.js', 'src/locales/en.json', 'src/locales/ko.json', 'resources/bunny-icon.png']) {
            assert.ok(fs.existsSync(path.join(extension, file)), `Required runtime file: ${file}`);
        }
        const runtimeRequire = createRequire(path.join(extension, 'package.json'));
        for (const driver of ['mysql2', 'pg', 'mongodb', 'redis', 'ssh2']) { runtimeRequire(driver); }
        const SQL = await runtimeRequire('sql.js')();
        const database = new SQL.Database();
        try { assert.equal(database.exec('SELECT 1 AS value')[0].values[0][0], 1); }
        finally { database.close(); }
        await runTests({
            version: process.env.VSCODE_TEST_VERSION || 'stable',
            extensionDevelopmentPath: extension,
            extensionTestsPath: path.resolve(__dirname, '../out/test/suite/index.js'),
            launchArgs: ['--disable-extensions', '--skip-welcome', '--skip-release-notes']
        });
        console.log(`Verified packaged runtime, SQLite WASM, locales and activation: ${manifest.publisher}.${manifest.name}@${manifest.version}`);
    } finally {
        // 삭제 대상은 이 실행에서 만든 임시 디렉터리로만 제한한다.
        assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
        assert.ok(path.basename(directory).startsWith('dbunny-vsix-'));
        fs.rmSync(directory, { recursive: true, force: true });
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
