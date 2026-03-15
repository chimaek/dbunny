/**
 * 암호화 서비스 스탠드얼론 테스트 — vscode 의존성 없이 실행 가능
 *
 * AES-256-GCM 암호화/복호화, SHA-256 해시, UUID 생성을 검증합니다.
 * vscode.ExtensionContext 의존성을 mock으로 대체하여 테스트합니다.
 *
 * 실행법: npx tsx src/test/unit/encryption.standalone.ts
 */

import * as crypto from 'crypto';

let totalPass = 0;
let totalFail = 0;
const failures: string[] = [];

function header(title: string) {
    console.log(`\n${'─'.repeat(50)}`);
    console.log(`  ${title}`);
    console.log(`${'─'.repeat(50)}`);
}

function pass(msg: string) {
    totalPass++;
    console.log(`  ✅ ${msg}`);
}

function fail(msg: string) {
    totalFail++;
    console.log(`  ❌ ${msg}`);
    failures.push(msg);
}

function assert(condition: boolean, msg: string) {
    if (condition) { pass(msg); } else { fail(msg); }
}

function assertEqual(actual: unknown, expected: unknown, msg: string) {
    const eq = JSON.stringify(actual) === JSON.stringify(expected);
    if (eq) { pass(msg); } else { fail(`${msg} — expected: ${JSON.stringify(expected)}, got: ${JSON.stringify(actual)}`); }
}

// ── AES-256-GCM 암호화/복호화 (EncryptionService 로직 재현) ──

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

// mock key storage
const secretStore: Record<string, string> = {};

async function getEncryptionKey(): Promise<Buffer> {
    let keyHex = secretStore['dbunny.encryptionKey'];
    if (!keyHex) {
        const key = crypto.randomBytes(32);
        keyHex = key.toString('hex');
        secretStore['dbunny.encryptionKey'] = keyHex;
    }
    return Buffer.from(keyHex, 'hex');
}

async function encrypt(plaintext: string): Promise<string> {
    const key = await getEncryptionKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();
    const result = { iv: iv.toString('hex'), authTag: authTag.toString('hex'), encrypted };
    return Buffer.from(JSON.stringify(result)).toString('base64');
}

async function decrypt(ciphertext: string): Promise<string> {
    const key = await getEncryptionKey();
    const data = JSON.parse(Buffer.from(ciphertext, 'base64').toString('utf8'));
    const iv = Buffer.from(data.iv, 'hex');
    const authTag = Buffer.from(data.authTag, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(data.encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}

function hash(text: string): string {
    return crypto.createHash('sha256').update(text).digest('hex');
}

function generateId(): string {
    return crypto.randomUUID();
}

// ── Tests ─────────────────────────────────────────────

header('generateId — UUID 생성');

(() => {
    const id = generateId();
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    assert(uuidRegex.test(id), `유효한 UUID 형식: ${id}`);
})();

(() => {
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) {
        ids.add(generateId());
    }
    assertEqual(ids.size, 1000, '1000개 UUID 모두 고유');
})();

(() => {
    const id = generateId();
    assert(id.length === 36, `UUID 길이 36: ${id.length}`);
    assert(id.split('-').length === 5, 'UUID 5개 세그먼트');
})();

// ── hash ──

header('hash — SHA-256 해시');

(() => {
    const h = hash('hello');
    assertEqual(h.length, 64, 'SHA-256 해시 길이 64 (hex)');
    assert(/^[0-9a-f]+$/.test(h), '해시는 hex 문자열');
})();

(() => {
    const h1 = hash('password123');
    const h2 = hash('password123');
    assertEqual(h1, h2, '동일 입력 → 동일 해시');
})();

(() => {
    const h1 = hash('password1');
    const h2 = hash('password2');
    assert(h1 !== h2, '다른 입력 → 다른 해시');
})();

(() => {
    const h = hash('');
    assertEqual(h.length, 64, '빈 문자열도 유효한 해시');
    assertEqual(h, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', '빈 문자열 SHA-256');
})();

(() => {
    const h = hash('한국어 비밀번호 🔑');
    assertEqual(h.length, 64, '유니코드/이모지 문자열 해시 가능');
})();

(() => {
    const longStr = 'a'.repeat(100000);
    const h = hash(longStr);
    assertEqual(h.length, 64, '긴 문자열 해시 가능');
})();

// ── encrypt/decrypt ──

header('encrypt/decrypt — AES-256-GCM 암호화/복호화');

(async () => {
    // 기본 암호화/복호화
    const plaintext = 'my-secret-password';
    const encrypted = await encrypt(plaintext);
    assert(encrypted !== plaintext, '암호문은 평문과 다름');
    assert(encrypted.length > 0, '암호문 비어있지 않음');

    const decrypted = await decrypt(encrypted);
    assertEqual(decrypted, plaintext, '복호화 결과 = 원본 평문');
})().then(async () => {
    // 빈 문자열
    const encrypted = await encrypt('');
    const decrypted = await decrypt(encrypted);
    assertEqual(decrypted, '', '빈 문자열 암호화/복호화');
}).then(async () => {
    // 한국어 + 특수문자
    const text = '데이터베이스 비밀번호: p@ss!w0rd#$%^&*()';
    const encrypted = await encrypt(text);
    const decrypted = await decrypt(encrypted);
    assertEqual(decrypted, text, '한국어+특수문자 암호화/복호화');
}).then(async () => {
    // 이모지 포함
    const text = '🐰 DBunny 🔒 Secret';
    const encrypted = await encrypt(text);
    const decrypted = await decrypt(encrypted);
    assertEqual(decrypted, text, '이모지 포함 문자열 암호화/복호화');
}).then(async () => {
    // JSON 문자열
    const json = JSON.stringify({ host: 'localhost', password: 'root1234', port: 3306 });
    const encrypted = await encrypt(json);
    const decrypted = await decrypt(encrypted);
    assertEqual(decrypted, json, 'JSON 문자열 암호화/복호화');
    const parsed = JSON.parse(decrypted);
    assertEqual(parsed.password, 'root1234', 'JSON 파싱 결과 올바름');
}).then(async () => {
    // 같은 평문이라도 매번 다른 암호문 (IV가 다르므로)
    const text = 'same-plaintext';
    const enc1 = await encrypt(text);
    const enc2 = await encrypt(text);
    assert(enc1 !== enc2, '같은 평문도 매번 다른 암호문 (랜덤 IV)');

    // 둘 다 올바르게 복호화
    const dec1 = await decrypt(enc1);
    const dec2 = await decrypt(enc2);
    assertEqual(dec1, text, '첫 번째 암호문 복호화 성공');
    assertEqual(dec2, text, '두 번째 암호문 복호화 성공');
}).then(async () => {
    // 긴 문자열
    const longText = 'x'.repeat(10000);
    const encrypted = await encrypt(longText);
    const decrypted = await decrypt(encrypted);
    assertEqual(decrypted, longText, '10000자 문자열 암호화/복호화');
}).then(async () => {
    // 암호문 구조 검증
    const encrypted = await encrypt('test');
    const decoded = JSON.parse(Buffer.from(encrypted, 'base64').toString('utf8'));
    assert('iv' in decoded, '암호문에 iv 필드 존재');
    assert('authTag' in decoded, '암호문에 authTag 필드 존재');
    assert('encrypted' in decoded, '암호문에 encrypted 필드 존재');
    assertEqual(decoded.iv.length, 32, 'IV는 16바이트(32 hex chars)');
    assertEqual(decoded.authTag.length, 32, 'authTag는 16바이트(32 hex chars)');
}).then(async () => {
    // 변조된 암호문 → 복호화 실패
    const encrypted = await encrypt('sensitive-data');
    const decoded = JSON.parse(Buffer.from(encrypted, 'base64').toString('utf8'));
    // authTag 변조
    decoded.authTag = '0'.repeat(32);
    const tampered = Buffer.from(JSON.stringify(decoded)).toString('base64');
    try {
        await decrypt(tampered);
        fail('변조된 암호문은 복호화 실패해야 함');
    } catch {
        pass('변조된 암호문 복호화 시 에러 발생');
    }
}).then(async () => {
    // encrypted 데이터 변조
    const encrypted = await encrypt('original');
    const decoded = JSON.parse(Buffer.from(encrypted, 'base64').toString('utf8'));
    decoded.encrypted = 'ff'.repeat(decoded.encrypted.length / 2);
    const tampered = Buffer.from(JSON.stringify(decoded)).toString('base64');
    try {
        await decrypt(tampered);
        fail('데이터 변조된 암호문은 복호화 실패해야 함');
    } catch {
        pass('데이터 변조 시 인증 실패');
    }
}).then(async () => {
    // 잘못된 base64
    try {
        await decrypt('not-valid-base64!!!');
        fail('잘못된 base64는 복호화 실패해야 함');
    } catch {
        pass('잘못된 base64 입력 시 에러 발생');
    }
}).then(async () => {
    // 키 일관성 검증: 동일 세션에서 암호화한 것을 복호화 가능
    const items = ['password1', 'password2', 'password3'];
    const encrypted = await Promise.all(items.map(i => encrypt(i)));
    const decrypted = await Promise.all(encrypted.map(e => decrypt(e)));
    for (let i = 0; i < items.length; i++) {
        assertEqual(decrypted[i], items[i], `다중 암호화/복호화 [${i}]`);
    }
}).then(() => {
    // ── 결과 출력 ──
    console.log(`\n${'═'.repeat(50)}`);
    console.log(`  RESULTS: ✅ ${totalPass} passed, ❌ ${totalFail} failed`);
    console.log(`${'═'.repeat(50)}`);

    if (failures.length > 0) {
        console.log('\n  Failures:');
        failures.forEach((f, i) => console.log(`    ${i + 1}. ${f}`));
    }

    console.log('');
    process.exit(totalFail > 0 ? 1 : 0);
});
