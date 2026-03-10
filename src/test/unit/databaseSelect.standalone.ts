/**
 * Database Select 유닛 테스트 — vscode 의존성 없이 실행 가능
 *
 * 쿼리 탭에서 데이터베이스 선택 기능의 핵심 로직을 검증합니다.
 * - Redis 'db' 접두사 파싱
 * - 데이터베이스 파라미터 fallback 체인
 * - QueryTab 인터페이스 필드 검증
 *
 * 실행법: npx tsx src/test/unit/databaseSelect.standalone.ts
 */

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
    if (eq) {
        pass(msg);
    } else {
        fail(`${msg} — expected: ${JSON.stringify(expected)}, got: ${JSON.stringify(actual)}`);
    }
}

// ── Redis 'db' 접두사 파싱 테스트 ────────────────────────

header('Redis database 접두사 파싱');

// Redis executeQuery 내부의 파싱 로직을 시뮬레이션
function parseRedisDbIndex(database: string): number {
    const cleaned = database.replace(/^db/i, '');
    return parseInt(cleaned);
}

// 기본 형식: getDatabases()가 반환하는 'db0'~'db15'
assert(parseRedisDbIndex('db0') === 0, "parseRedisDbIndex('db0') === 0");
assert(parseRedisDbIndex('db1') === 1, "parseRedisDbIndex('db1') === 1");
assert(parseRedisDbIndex('db15') === 15, "parseRedisDbIndex('db15') === 15");

// 대소문자 혼합
assert(parseRedisDbIndex('DB0') === 0, "parseRedisDbIndex('DB0') === 0 (대문자)");
assert(parseRedisDbIndex('Db5') === 5, "parseRedisDbIndex('Db5') === 5 (혼합 대소문자)");

// 숫자만 전달된 경우 (기존 호환성)
assert(parseRedisDbIndex('0') === 0, "parseRedisDbIndex('0') === 0 (숫자만)");
assert(parseRedisDbIndex('7') === 7, "parseRedisDbIndex('7') === 7 (숫자만)");
assert(parseRedisDbIndex('15') === 15, "parseRedisDbIndex('15') === 15 (숫자만)");

// 유효하지 않은 값
assert(isNaN(parseRedisDbIndex('abc')), "parseRedisDbIndex('abc') === NaN (유효하지 않음)");
assert(isNaN(parseRedisDbIndex('')), "parseRedisDbIndex('') === NaN (빈 문자열)");

// 범위 검증 로직 (Redis executeQuery에서 사용)
function isValidRedisDb(database: string): boolean {
    const cleaned = database.replace(/^db/i, '');
    const dbIndex = parseInt(cleaned);
    return !isNaN(dbIndex) && dbIndex >= 0 && dbIndex <= 15;
}

assert(isValidRedisDb('db0'), "isValidRedisDb('db0') === true");
assert(isValidRedisDb('db15'), "isValidRedisDb('db15') === true");
assert(!isValidRedisDb('db16'), "isValidRedisDb('db16') === false (범위 초과)");
assert(!isValidRedisDb('db-1'), "isValidRedisDb('db-1') === false (음수)");
assert(!isValidRedisDb('dbxyz'), "isValidRedisDb('dbxyz') === false (숫자 아님)");

// ── 데이터베이스 fallback 체인 테스트 ────────────────────────

header('Database fallback 체인');

// _executeQuery 내부 로직 시뮬레이션
function resolveDatabaseName(
    tabDatabaseName: string | null,
    configDatabase: string | undefined
): string | undefined {
    const database = tabDatabaseName || configDatabase;
    return database || undefined;
}

// 탭에서 선택된 DB가 우선
assertEqual(
    resolveDatabaseName('mydb', 'defaultdb'),
    'mydb',
    '탭 선택 DB 우선: mydb'
);

// 탭에 DB가 없으면 config.database 사용
assertEqual(
    resolveDatabaseName(null, 'defaultdb'),
    'defaultdb',
    'config.database fallback: defaultdb'
);

// 둘 다 없으면 undefined
assertEqual(
    resolveDatabaseName(null, undefined),
    undefined,
    '둘 다 없으면 undefined'
);

// 빈 문자열 처리 (falsy → fallback)
assertEqual(
    resolveDatabaseName(null, ''),
    undefined,
    "config.database가 빈 문자열이면 undefined"
);

// ── QueryTab 인터페이스 필드 검증 ────────────────────────

header('QueryTab 인터페이스 구조');

// QueryTab 생성 시 기본값 검증
interface MockQueryTab {
    id: string;
    name: string;
    query: string;
    connectionId: string | null;
    connectionName: string;
    databaseName: string | null;
    databases: string[];
    results: unknown | null;
    isExecuting: boolean;
    error: string | null;
}

const newTab: MockQueryTab = {
    id: 'tab-123-1',
    name: 'Query 1',
    query: '-- Write your SQL query here\n\n',
    connectionId: null,
    connectionName: 'No Connection',
    databaseName: null,
    databases: [],
    results: null,
    isExecuting: false,
    error: null,
};

assertEqual(newTab.databaseName, null, '새 탭의 databaseName은 null');
assertEqual(newTab.databases, [], '새 탭의 databases는 빈 배열');
assertEqual(newTab.connectionId, null, '새 탭의 connectionId는 null');

// 연결 설정 후 탭 상태 시뮬레이션
const connectedTab: MockQueryTab = {
    ...newTab,
    connectionId: 'test-mysql',
    connectionName: 'MySQL Test',
    databaseName: 'mydb',
    databases: ['information_schema', 'mydb', 'mysql', 'performance_schema'],
};

assertEqual(connectedTab.databaseName, 'mydb', '연결 후 databaseName 설정됨');
assert(connectedTab.databases.length === 4, '연결 후 databases 목록 로드됨');
assert(connectedTab.databases.includes('mydb'), 'databases에 mydb 포함');

// 연결 해제 시 탭 상태 초기화
const disconnectedTab: MockQueryTab = {
    ...connectedTab,
    connectionId: null,
    connectionName: 'No Connection',
    databaseName: null,
    databases: [],
};

assertEqual(disconnectedTab.databaseName, null, '연결 해제 후 databaseName 초기화');
assertEqual(disconnectedTab.databases, [], '연결 해제 후 databases 초기화');

// ── 데이터베이스 선택 시 드롭다운 동작 ────────────────────────

header('데이터베이스 드롭다운 동작');

// 데이터베이스 선택 시 상태 변경
function setDatabase(tab: MockQueryTab, databaseName: string | null): MockQueryTab {
    return { ...tab, databaseName: databaseName || null };
}

const tabWithMydb = setDatabase(connectedTab, 'mydb');
assertEqual(tabWithMydb.databaseName, 'mydb', "setDatabase('mydb') → databaseName === 'mydb'");

const tabWithInfoSchema = setDatabase(connectedTab, 'information_schema');
assertEqual(
    tabWithInfoSchema.databaseName,
    'information_schema',
    "setDatabase('information_schema') → 전환 가능"
);

const tabWithNull = setDatabase(connectedTab, null);
assertEqual(tabWithNull.databaseName, null, "setDatabase(null) → databaseName === null");

const tabWithEmpty = setDatabase(connectedTab, '');
assertEqual(tabWithEmpty.databaseName, null, "setDatabase('') → null로 변환");

// ── config.database 없이 연결한 경우 (원래 이슈 시나리오) ────────

header('"No database selected" 이슈 시나리오');

// config.database가 없는 연결 (이슈의 원인)
const noDatabaseConfig = {
    database: undefined as string | undefined,
};

// getDatabases() 결과에서 첫 번째 DB를 기본값으로 선택
const availableDatabases = ['information_schema', 'mydb', 'mysql', 'performance_schema'];

function resolveInitialDatabase(
    configDatabase: string | undefined,
    databases: string[]
): string | null {
    return configDatabase || databases[0] || null;
}

assertEqual(
    resolveInitialDatabase(noDatabaseConfig.database, availableDatabases),
    'information_schema',
    'config.database 없으면 첫 번째 DB(information_schema) 선택'
);

assertEqual(
    resolveInitialDatabase('mydb', availableDatabases),
    'mydb',
    'config.database 있으면 그것 사용'
);

assertEqual(
    resolveInitialDatabase(undefined, []),
    null,
    'DB 목록도 없으면 null'
);

// 실제 쿼리 실행 시 DB가 전달되는지 검증
const executeDbResolved = resolveDatabaseName('mydb', undefined);
assertEqual(executeDbResolved, 'mydb', '탭에서 선택한 DB가 쿼리에 전달됨');

const executeNoDb = resolveDatabaseName(null, undefined);
assertEqual(executeNoDb, undefined, 'DB 없으면 쿼리에 undefined 전달 (에러 발생 가능)');

// ── Redis getDatabases() 호환성 ────────────────────────

header('Redis getDatabases() 출력 호환성');

// getDatabases()가 반환하는 형식
const redisDatabases = Array.from({ length: 16 }, (_, i) => `db${i}`);
assertEqual(redisDatabases.length, 16, 'Redis getDatabases()는 16개 반환');
assertEqual(redisDatabases[0], 'db0', '첫 번째: db0');
assertEqual(redisDatabases[15], 'db15', '마지막: db15');

// 드롭다운에서 선택 후 executeQuery로 전달될 때 파싱 가능한지
for (const db of redisDatabases) {
    const index = parseRedisDbIndex(db);
    assert(!isNaN(index) && index >= 0 && index <= 15, `'${db}' → 유효한 인덱스 ${index}`);
}

// ── 프로바이더별 데이터베이스 파라미터 동작 요약 테스트 ────────

header('프로바이더별 database 파라미터 처리 패턴');

type DbHandlePattern = 'use' | 'temp_connection' | 'ignore' | 'select';

function describePattern(provider: string): DbHandlePattern {
    switch (provider) {
        case 'mysql': return 'use';           // USE `database`
        case 'postgres': return 'temp_connection'; // 임시 연결 생성
        case 'sqlite': return 'ignore';       // 단일 DB, 무시
        case 'h2': return 'ignore';           // 경고 로그, 무시
        case 'mongodb': return 'use';         // client.db(database)
        case 'redis': return 'select';        // SELECT index
        default: return 'ignore';
    }
}

assertEqual(describePattern('mysql'), 'use', 'MySQL: USE 문으로 전환');
assertEqual(describePattern('postgres'), 'temp_connection', 'PostgreSQL: 임시 연결 생성');
assertEqual(describePattern('sqlite'), 'ignore', 'SQLite: 무시 (단일 DB)');
assertEqual(describePattern('h2'), 'ignore', 'H2: 무시');
assertEqual(describePattern('mongodb'), 'use', 'MongoDB: client.db()로 전환');
assertEqual(describePattern('redis'), 'select', 'Redis: SELECT 명령으로 전환');

// ── 결과 ────────────────────────────────────────────────

console.log(`\n${'═'.repeat(50)}`);
console.log(`  RESULTS: ✅ ${totalPass} passed, ❌ ${totalFail} failed`);
console.log(`${'═'.repeat(50)}`);

if (failures.length > 0) {
    console.log('\n  Failures:');
    failures.forEach((f, i) => console.log(`    ${i + 1}. ${f}`));
}

console.log('');
process.exit(totalFail > 0 ? 1 : 0);
