/**
 * connectionShare 유틸리티 스탠드얼론 유닛 테스트
 * 실행: npx tsx src/test/unit/connectionShare.standalone.ts
 */
import * as assert from 'assert';
import {
    stripSecrets,
    exportToJson,
    validateImportData,
    toConnectionConfig,
    createTemplate,
    templateToConnectionConfig,
    MAX_TEMPLATES,
} from '../../utils/connectionShare';
import { ConnectionConfig, ExportableConnectionConfig } from '../../types/database';

let totalPass = 0;
let totalFail = 0;

function pass(name: string): void {
    totalPass++;
    console.log(`  ✅ ${name}`);
}

function fail(name: string, error: unknown): void {
    totalFail++;
    console.log(`  ❌ ${name}: ${error}`);
}

function section(name: string): void {
    console.log(`\n── ${name} ──`);
}

// ── 테스트 데이터 ──

const mysqlConfig: ConnectionConfig = {
    id: 'test-1',
    name: 'Production MySQL',
    type: 'mysql',
    host: 'db.example.com',
    port: 3306,
    username: 'admin',
    password: 'super-secret-password',
    database: 'myapp',
    group: 'Production',
    readOnly: true,
    color: { id: 'red', hex: '#E74C3C', label: '운영' },
};

const pgConfigWithSSH: ConnectionConfig = {
    id: 'test-2',
    name: 'Staging PostgreSQL',
    type: 'postgres',
    host: 'pg.staging.com',
    port: 5432,
    username: 'pguser',
    password: 'pg-password',
    database: 'staging_db',
    ssh: {
        host: 'bastion.example.com',
        port: 22,
        username: 'sshuser',
        password: 'ssh-password',
        privateKey: '/path/to/key',
        passphrase: 'key-passphrase',
    },
};

const sqliteConfig: ConnectionConfig = {
    id: 'test-3',
    name: 'Local SQLite',
    type: 'sqlite',
    host: 'localhost',
    port: 0,
    username: '',
    database: '/path/to/db.sqlite',
};

const h2Config: ConnectionConfig = {
    id: 'test-4',
    name: 'H2 Dev',
    type: 'h2',
    host: 'localhost',
    port: 5435,
    username: 'sa',
    password: 'h2pass',
    h2Mode: { protocol: 'tcp', dbType: 'mem', dbPath: 'testdb' },
};

let idCounter = 100;
function mockGenerateId(): string {
    return `mock-id-${idCounter++}`;
}

// ===== Tests =====

section('stripSecrets');

try {
    const result = stripSecrets(mysqlConfig);
    assert.strictEqual(result.name, 'Production MySQL');
    assert.strictEqual(result.type, 'mysql');
    assert.strictEqual(result.host, 'db.example.com');
    assert.strictEqual(result.port, 3306);
    assert.strictEqual(result.username, 'admin');
    assert.strictEqual(result.database, 'myapp');
    assert.strictEqual(result.group, 'Production');
    assert.strictEqual(result.readOnly, true);
    assert.deepStrictEqual(result.color, { id: 'red', hex: '#E74C3C', label: '운영' });
    assert.strictEqual((result as unknown as Record<string, unknown>).password, undefined);
    assert.strictEqual((result as unknown as Record<string, unknown>).id, undefined);
    pass('MySQL — 비밀번호/ID 제거, 나머지 보존');
} catch (e) { fail('MySQL — 비밀번호/ID 제거', e); }

try {
    const result = stripSecrets(pgConfigWithSSH);
    assert.ok(result.ssh);
    assert.strictEqual(result.ssh.host, 'bastion.example.com');
    assert.strictEqual(result.ssh.port, 22);
    assert.strictEqual(result.ssh.username, 'sshuser');
    assert.strictEqual((result.ssh as unknown as Record<string, unknown>).password, undefined);
    assert.strictEqual((result.ssh as unknown as Record<string, unknown>).privateKey, undefined);
    assert.strictEqual((result.ssh as unknown as Record<string, unknown>).passphrase, undefined);
    pass('SSH — 비밀번호/키/패스프레이즈 제거');
} catch (e) { fail('SSH secrets stripped', e); }

try {
    const result = stripSecrets(sqliteConfig);
    assert.strictEqual(result.database, '/path/to/db.sqlite');
    assert.strictEqual(result.username, '');
    assert.strictEqual(result.ssh, undefined);
    assert.strictEqual(result.group, undefined);
    pass('SQLite — 선택 필드 없으면 미포함');
} catch (e) { fail('SQLite optional fields', e); }

try {
    const result = stripSecrets(h2Config);
    assert.deepStrictEqual(result.h2Mode, { protocol: 'tcp', dbType: 'mem', dbPath: 'testdb' });
    pass('H2 — h2Mode 보존');
} catch (e) { fail('H2 h2Mode preserved', e); }

try {
    const configWithOptions: ConnectionConfig = {
        ...mysqlConfig,
        options: { connectTimeout: 5000, ssl: true },
    };
    const result = stripSecrets(configWithOptions);
    assert.deepStrictEqual(result.options, { connectTimeout: 5000, ssl: true });
    pass('options 필드 보존');
} catch (e) { fail('options preserved', e); }

try {
    const configNoOptionals: ConnectionConfig = {
        id: 'bare',
        name: 'Bare',
        type: 'mysql',
        host: 'localhost',
        port: 3306,
        username: 'root',
    };
    const result = stripSecrets(configNoOptionals);
    assert.strictEqual(result.database, undefined);
    assert.strictEqual(result.group, undefined);
    assert.strictEqual(result.color, undefined);
    assert.strictEqual(result.readOnly, undefined);
    assert.strictEqual(result.ssh, undefined);
    assert.strictEqual(result.h2Mode, undefined);
    assert.strictEqual(result.options, undefined);
    pass('최소 설정 — 선택 필드 미포함');
} catch (e) { fail('minimal config', e); }

section('exportToJson');

try {
    const json = exportToJson([mysqlConfig]);
    const parsed = JSON.parse(json);
    assert.ok(parsed.dbunny);
    assert.strictEqual(parsed.dbunny.version, '2.5.0');
    assert.ok(parsed.dbunny.exportedAt);
    assert.strictEqual(parsed.dbunny.connections.length, 1);
    assert.strictEqual(parsed.dbunny.connections[0].name, 'Production MySQL');
    assert.strictEqual(parsed.dbunny.connections[0].password, undefined);
    pass('단일 연결 JSON 내보내기');
} catch (e) { fail('single export', e); }

try {
    const json = exportToJson([mysqlConfig, pgConfigWithSSH, sqliteConfig]);
    const parsed = JSON.parse(json);
    assert.strictEqual(parsed.dbunny.connections.length, 3);
    pass('다중 연결 JSON 내보내기');
} catch (e) { fail('multi export', e); }

try {
    const json = exportToJson([]);
    const parsed = JSON.parse(json);
    assert.strictEqual(parsed.dbunny.connections.length, 0);
    pass('빈 배열 내보내기');
} catch (e) { fail('empty export', e); }

try {
    const json = exportToJson([mysqlConfig]);
    const parsed = JSON.parse(json);
    // 내보낸 JSON에 비밀번호 관련 필드 없음
    const conn = parsed.dbunny.connections[0];
    assert.strictEqual('password' in conn, false);
    assert.strictEqual('id' in conn, false);
    pass('JSON에 비밀번호/ID 없음');
} catch (e) { fail('no secrets in JSON', e); }

section('validateImportData');

try {
    const result = validateImportData('not json');
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors[0].includes('Invalid JSON'));
    pass('잘못된 JSON 거부');
} catch (e) { fail('invalid JSON', e); }

try {
    const result = validateImportData('{}');
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors[0].includes('dbunny'));
    pass('dbunny 래퍼 없음 거부');
} catch (e) { fail('missing dbunny wrapper', e); }

try {
    const result = validateImportData('{"dbunny": {}}');
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors[0].includes('connections'));
    pass('connections 배열 없음 거부');
} catch (e) { fail('missing connections array', e); }

try {
    const json = exportToJson([mysqlConfig]);
    const result = validateImportData(json);
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.connections.length, 1);
    assert.strictEqual(result.errors.length, 0);
    pass('유효한 내보내기 데이터 검증 통과');
} catch (e) { fail('valid export validates', e); }

try {
    const json = JSON.stringify({
        dbunny: {
            version: '2.5.0',
            connections: [{ name: 'Test' }], // host, type, port 누락
        },
    });
    const result = validateImportData(json);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('type')));
    assert.ok(result.errors.some(e => e.includes('host')));
    assert.ok(result.errors.some(e => e.includes('port')));
    pass('필수 필드 누락 검증');
} catch (e) { fail('missing required fields', e); }

try {
    const json = JSON.stringify({
        dbunny: {
            version: '2.5.0',
            connections: [{
                name: 'Test',
                type: 'oracle', // 지원하지 않는 타입
                host: 'localhost',
                port: 1521,
                username: 'test',
            }],
        },
    });
    const result = validateImportData(json);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('type')));
    pass('지원하지 않는 DB 타입 거부');
} catch (e) { fail('unsupported db type', e); }

try {
    const json = JSON.stringify({
        dbunny: {
            version: '2.5.0',
            connections: [{
                name: 'Test',
                type: 'mysql',
                host: 'localhost',
                port: 99999, // 범위 초과
                username: 'test',
            }],
        },
    });
    const result = validateImportData(json);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('port')));
    pass('포트 범위 초과 거부');
} catch (e) { fail('port out of range', e); }

try {
    const json = JSON.stringify({
        dbunny: {
            version: '2.5.0',
            connections: [
                { name: 'Good', type: 'mysql', host: 'localhost', port: 3306, username: 'root' },
                { name: 'Bad' }, // 필수 필드 누락
            ],
        },
    });
    const result = validateImportData(json);
    // 일부만 유효하면 invalid
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.connections.length, 1); // 유효한 것만
    assert.ok(result.errors.length > 0);
    pass('부분 유효 — 유효한 연결만 수집, 전체는 invalid');
} catch (e) { fail('partial validity', e); }

try {
    const json = JSON.stringify({
        dbunny: {
            version: '2.5.0',
            connections: [{
                name: 'Full',
                type: 'postgres',
                host: 'pg.example.com',
                port: 5432,
                username: 'pguser',
                database: 'mydb',
                group: 'Dev',
                readOnly: true,
                color: { id: 'green', hex: '#27AE60' },
                ssh: { host: 'bastion', port: 22, username: 'sshuser' },
            }],
        },
    });
    const result = validateImportData(json);
    assert.strictEqual(result.valid, true);
    const conn = result.connections[0];
    assert.strictEqual(conn.database, 'mydb');
    assert.strictEqual(conn.group, 'Dev');
    assert.strictEqual(conn.readOnly, true);
    assert.ok(conn.ssh);
    pass('모든 선택 필드 포함 유효성 검증');
} catch (e) { fail('full config validation', e); }

try {
    const json = JSON.stringify({
        dbunny: {
            version: '2.5.0',
            connections: [{
                name: 'SQLite',
                type: 'sqlite',
                host: 'localhost',
                port: 0,
                username: '',
                database: '/tmp/test.db',
            }],
        },
    });
    const result = validateImportData(json);
    assert.strictEqual(result.valid, true);
    pass('SQLite (port 0, 빈 username) 유효');
} catch (e) { fail('sqlite valid', e); }

try {
    const result = validateImportData('null');
    assert.strictEqual(result.valid, false);
    pass('null 입력 거부');
} catch (e) { fail('null input', e); }

try {
    const result = validateImportData('"just a string"');
    assert.strictEqual(result.valid, false);
    pass('문자열 입력 거부');
} catch (e) { fail('string input', e); }

section('toConnectionConfig');

try {
    const exported: ExportableConnectionConfig = {
        name: 'Test MySQL',
        type: 'mysql',
        host: 'localhost',
        port: 3306,
        username: 'root',
        database: 'testdb',
        group: 'Dev',
        readOnly: false,
        color: { id: 'blue', hex: '#3498DB' },
    };
    const config = toConnectionConfig(exported, mockGenerateId);
    assert.ok(config.id.startsWith('mock-id-'));
    assert.strictEqual(config.name, 'Test MySQL');
    assert.strictEqual(config.type, 'mysql');
    assert.strictEqual(config.host, 'localhost');
    assert.strictEqual(config.port, 3306);
    assert.strictEqual(config.username, 'root');
    assert.strictEqual(config.database, 'testdb');
    assert.strictEqual(config.group, 'Dev');
    assert.strictEqual(config.readOnly, false);
    assert.strictEqual(config.password, undefined);
    pass('ExportableConfig → ConnectionConfig 변환');
} catch (e) { fail('toConnectionConfig basic', e); }

try {
    const exported: ExportableConnectionConfig = {
        name: 'SSH PG',
        type: 'postgres',
        host: 'pg.example.com',
        port: 5432,
        username: 'pguser',
        ssh: { host: 'bastion', port: 22, username: 'sshuser' },
    };
    const config = toConnectionConfig(exported, mockGenerateId);
    assert.ok(config.ssh);
    assert.strictEqual(config.ssh!.host, 'bastion');
    assert.strictEqual(config.ssh!.password, undefined);
    assert.strictEqual(config.ssh!.privateKey, undefined);
    pass('SSH 필드 변환 (비밀번호 없이)');
} catch (e) { fail('toConnectionConfig SSH', e); }

try {
    const exported: ExportableConnectionConfig = {
        name: 'H2',
        type: 'h2',
        host: 'localhost',
        port: 5435,
        username: 'sa',
        h2Mode: { protocol: 'ssl', dbType: 'file', dbPath: '/data/h2' },
    };
    const config = toConnectionConfig(exported, mockGenerateId);
    assert.deepStrictEqual(config.h2Mode, { protocol: 'ssl', dbType: 'file', dbPath: '/data/h2' });
    pass('H2 모드 변환');
} catch (e) { fail('toConnectionConfig H2', e); }

try {
    // 각 호출마다 고유 ID 생성
    const exported: ExportableConnectionConfig = {
        name: 'Test',
        type: 'mysql',
        host: 'localhost',
        port: 3306,
        username: 'root',
    };
    const config1 = toConnectionConfig(exported, mockGenerateId);
    const config2 = toConnectionConfig(exported, mockGenerateId);
    assert.notStrictEqual(config1.id, config2.id);
    pass('매번 고유 ID 생성');
} catch (e) { fail('unique IDs', e); }

section('createTemplate');

try {
    const template = createTemplate(mysqlConfig, 'Team Production', '운영 DB 템플릿', mockGenerateId);
    assert.ok(template.id.startsWith('mock-id-'));
    assert.strictEqual(template.name, 'Team Production');
    assert.strictEqual(template.description, '운영 DB 템플릿');
    assert.ok(template.createdAt);
    assert.strictEqual(template.config.name, 'Production MySQL');
    assert.strictEqual((template.config as unknown as Record<string, unknown>).password, undefined);
    pass('템플릿 생성 — 비밀번호 제거');
} catch (e) { fail('createTemplate', e); }

try {
    const template = createTemplate(pgConfigWithSSH, 'SSH PG Template', undefined, mockGenerateId);
    assert.strictEqual(template.description, undefined);
    assert.ok(template.config.ssh);
    assert.strictEqual((template.config.ssh as unknown as Record<string, unknown>).password, undefined);
    pass('설명 없는 SSH 템플릿');
} catch (e) { fail('template no description', e); }

section('templateToConnectionConfig');

try {
    const template = createTemplate(mysqlConfig, 'Test Template', 'desc', mockGenerateId);
    const config = templateToConnectionConfig(template, mockGenerateId);
    assert.ok(config.id.startsWith('mock-id-'));
    assert.notStrictEqual(config.id, template.id);
    assert.strictEqual(config.name, 'Production MySQL');
    assert.strictEqual(config.type, 'mysql');
    assert.strictEqual(config.password, undefined);
    pass('템플릿 → ConnectionConfig 변환');
} catch (e) { fail('templateToConnectionConfig', e); }

section('왕복 테스트 (export → import → config)');

try {
    const json = exportToJson([mysqlConfig, pgConfigWithSSH, sqliteConfig, h2Config]);
    const result = validateImportData(json);
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.connections.length, 4);

    const configs = result.connections.map(c => toConnectionConfig(c, mockGenerateId));
    assert.strictEqual(configs.length, 4);

    // 각 config의 ID가 모두 다른지
    const ids = new Set(configs.map(c => c.id));
    assert.strictEqual(ids.size, 4);

    // 원본 이름 보존
    assert.strictEqual(configs[0].name, 'Production MySQL');
    assert.strictEqual(configs[1].name, 'Staging PostgreSQL');
    assert.strictEqual(configs[2].name, 'Local SQLite');
    assert.strictEqual(configs[3].name, 'H2 Dev');

    // 비밀번호 없음
    configs.forEach(c => assert.strictEqual(c.password, undefined));

    pass('export → validate → toConfig 왕복 성공');
} catch (e) { fail('round-trip', e); }

section('MAX_TEMPLATES 상수');

try {
    assert.strictEqual(MAX_TEMPLATES, 50);
    pass('MAX_TEMPLATES = 50');
} catch (e) { fail('MAX_TEMPLATES', e); }

section('엣지 케이스');

try {
    // 특수문자가 포함된 연결 이름
    const config: ConnectionConfig = {
        id: 'special',
        name: 'Test <script>alert("xss")</script>',
        type: 'mysql',
        host: 'localhost',
        port: 3306,
        username: 'root',
    };
    const json = exportToJson([config]);
    const result = validateImportData(json);
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.connections[0].name, 'Test <script>alert("xss")</script>');
    pass('특수문자/HTML 포함 이름 보존');
} catch (e) { fail('special chars in name', e); }

try {
    // 한국어 이름
    const config: ConnectionConfig = {
        id: 'korean',
        name: '운영 데이터베이스 🐰',
        type: 'postgres',
        host: 'db.운영.kr',
        port: 5432,
        username: '관리자',
    };
    const json = exportToJson([config]);
    const result = validateImportData(json);
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.connections[0].name, '운영 데이터베이스 🐰');
    assert.strictEqual(result.connections[0].host, 'db.운영.kr');
    assert.strictEqual(result.connections[0].username, '관리자');
    pass('한국어/이모지 이름 보존');
} catch (e) { fail('korean names', e); }

try {
    // 빈 connections 배열
    const json = JSON.stringify({ dbunny: { version: '2.5.0', connections: [] } });
    const result = validateImportData(json);
    assert.strictEqual(result.valid, false); // 빈 배열은 invalid
    assert.strictEqual(result.connections.length, 0);
    pass('빈 connections 배열 → invalid');
} catch (e) { fail('empty connections array', e); }

try {
    // readOnly가 명시적으로 false인 경우
    const config: ConnectionConfig = {
        id: 'readonly-false',
        name: 'ReadOnly False',
        type: 'mysql',
        host: 'localhost',
        port: 3306,
        username: 'root',
        readOnly: false,
    };
    const result = stripSecrets(config);
    assert.strictEqual(result.readOnly, false);
    pass('readOnly=false 명시적 보존');
} catch (e) { fail('readOnly false preserved', e); }

try {
    // options가 빈 객체인 경우
    const config: ConnectionConfig = {
        id: 'empty-opts',
        name: 'Empty Opts',
        type: 'mysql',
        host: 'localhost',
        port: 3306,
        username: 'root',
        options: {},
    };
    const result = stripSecrets(config);
    assert.strictEqual(result.options, undefined); // 빈 객체는 제거
    pass('빈 options 객체 제거');
} catch (e) { fail('empty options removed', e); }

// ── 결과 ──
console.log(`\n${'═'.repeat(50)}`);
console.log(`connectionShare 테스트 결과: ${totalPass} passed, ${totalFail} failed (total ${totalPass + totalFail})`);
console.log('═'.repeat(50));
process.exit(totalFail > 0 ? 1 : 0);
