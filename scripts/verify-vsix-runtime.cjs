const path = require('node:path');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');

async function main() {
    const extension = path.resolve(process.argv[2]);
    const runtimeRequire = createRequire(path.join(extension, 'package.json'));
    for (const driver of ['mysql2', 'pg', 'mongodb', 'redis', 'ssh2']) { runtimeRequire(driver); }
    const SQL = await runtimeRequire('sql.js')();
    const database = new SQL.Database();
    try { assert.equal(database.exec('SELECT 1 AS value')[0].values[0][0], 1); }
    finally { database.close(); }
    console.log('Packaged drivers and SQLite WASM verified in isolated process');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
