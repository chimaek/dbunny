import * as path from 'path';
import Mocha from 'mocha';
import { glob } from 'glob';

export async function run(): Promise<void> {
    const mocha = new Mocha({
        ui: 'tdd',
        color: true,
        // CLI 검사와 같은 예산으로 새 프로필의 첫 활성화 시간을 허용한다.
        timeout: 20000
    });

    // Extension Host 전용 검사만 포함한다. 단위 검사는 별도 러너가 수행한다.
    const testsRoot = path.resolve(__dirname, '..');

    const files = await glob(['suite/**/*.test.js', 'host/**/*.test.js'], { cwd: testsRoot });

    files.forEach((f: string) => mocha.addFile(path.resolve(testsRoot, f)));

    return new Promise((resolve, reject) => {
        mocha.run((failures: number) => {
            if (failures > 0) {
                reject(new Error(`${failures} tests failed.`));
            } else {
                resolve();
            }
        });
    });
}
