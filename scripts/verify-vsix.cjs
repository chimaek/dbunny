const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');
const yauzl = require('yauzl');
const { runTests } = require('@vscode/test-electron');
const { getTestVersions } = require('./test-versions.cjs');

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
    const versions = getTestVersions();
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
        // Windows는 로드한 .node 파일을 프로세스 종료까지 잠근다.
        // 드라이버/WASM을 자식 프로세스에서 검사하고 종료 후 임시 파일을 정리한다.
        const runtime = spawnSync(process.execPath, [path.join(__dirname, 'verify-vsix-runtime.cjs'), extension], {
            stdio: 'inherit', timeout: 30000
        });
        if (runtime.error) { throw runtime.error; }
        assert.equal(runtime.status, 0, 'Packaged driver/WASM verification failed');
        for (const version of versions) {
            await runTests({
                version,
                extensionDevelopmentPath: extension,
                extensionTestsPath: path.resolve(__dirname, '../out/test/suite/index.js'),
                launchArgs: ['--disable-extensions', '--skip-welcome', '--skip-release-notes']
            });
            console.log(`PASS packaged Extension Host: ${version}`);
        }
        console.log(`Verified packaged runtime, SQLite WASM, locales and activation: ${manifest.publisher}.${manifest.name}@${manifest.version}`);
    } finally {
        // 삭제 대상은 이 실행에서 만든 임시 디렉터리로만 제한한다.
        assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
        assert.ok(path.basename(directory).startsWith('dbunny-vsix-'));
        await fs.promises.rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
