import * as assert from 'assert';
import * as path from 'path';
import { spawnSync } from 'child_process';

suite('Pinned result local time across time zones', () => {
    const cases = [
        ['UTC', '2026-03-14T10:30:45.000Z', '10:30:45'],
        ['Asia/Seoul', '2026-03-14T10:30:45.000Z', '19:30:45'],
        ['America/New_York', '2026-03-14T10:30:45.000Z', '06:30:45'],
        ['UTC', '2026-12-31T23:59:59.000Z', '23:59:59'],
        ['Asia/Seoul', '2026-12-31T23:59:59.000Z', '08:59:59'],
        ['America/New_York', '2026-12-31T23:59:59.000Z', '18:59:59']
    ];
    for (const [timezone, timestamp, expected] of cases) {
        test(`${timezone}: ${timestamp} displays ${expected}`, () => {
            // 실제 함수를 별도 프로세스에서 실행해 TZ 격리와 날짜 경계·DST 변환을 확인한다.
            const result = spawnSync(process.execPath, [
                '-e', 'const { formatTimestamp } = require(process.argv[1]); process.stdout.write(formatTimestamp(process.argv[2]));',
                path.resolve(__dirname, '../../utils/resultPin.js'), timestamp
            ], { env: { ...process.env, TZ: timezone }, encoding: 'utf8', timeout: 10000 });
            assert.strictEqual(result.status, 0, result.error?.message || result.stderr);
            assert.strictEqual(result.stdout, expected);
        });
    }
});
