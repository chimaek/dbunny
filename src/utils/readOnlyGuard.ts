/**
 * 읽기 전용 모드 가드 유틸리티
 *
 * v2.3.0 — 프로덕션 DB 안전 잠금. 쓰기 쿼리를 감지하여 차단합니다.
 */

/** 쓰기 작업으로 분류되는 SQL 키워드 */
const WRITE_KEYWORDS = [
    'INSERT',
    'UPDATE',
    'DELETE',
    'DROP',
    'ALTER',
    'CREATE',
    'TRUNCATE',
    'REPLACE',
    'RENAME',
    'GRANT',
    'REVOKE',
    'MERGE',
    'UPSERT',
    'CALL',
    'EXEC',
    'EXECUTE', 'COPY', 'LOAD', 'DO', 'SET', 'RESET', 'ATTACH', 'DETACH',
    'VACUUM', 'REINDEX', 'COMMENT', 'LOCK', 'UNLOCK', 'INTO'
] as const;

/** Redis 쓰기 명령어 */
const REDIS_WRITE_COMMANDS = [
    'SET', 'SETNX', 'SETEX', 'PSETEX', 'MSET', 'MSETNX', 'SETRANGE',
    'APPEND', 'INCR', 'INCRBY', 'INCRBYFLOAT', 'DECR', 'DECRBY',
    'DEL', 'UNLINK', 'EXPIRE', 'EXPIREAT', 'PEXPIRE', 'PEXPIREAT', 'PERSIST',
    'RENAME', 'RENAMENX', 'MOVE', 'COPY',
    'HSET', 'HSETNX', 'HMSET', 'HDEL', 'HINCRBY', 'HINCRBYFLOAT',
    'LPUSH', 'LPUSHX', 'RPUSH', 'RPUSHX', 'LPOP', 'RPOP', 'LREM', 'LSET', 'LTRIM', 'LINSERT',
    'SADD', 'SREM', 'SPOP', 'SMOVE', 'SDIFFSTORE', 'SINTERSTORE', 'SUNIONSTORE',
    'ZADD', 'ZREM', 'ZINCRBY', 'ZPOPMIN', 'ZPOPMAX', 'ZRANGESTORE', 'ZDIFFSTORE', 'ZINTERSTORE', 'ZUNIONSTORE',
    'FLUSHDB', 'FLUSHALL',
    'XADD', 'XDEL', 'XTRIM',
    'RESTORE', 'SORT',
    'PFADD', 'PFMERGE'
] as const;

/** MongoDB 쓰기 메서드 */
const MONGODB_WRITE_METHODS = [
    'insert', 'insertOne', 'insertMany',
    'update', 'updateOne', 'updateMany',
    'delete', 'deleteOne', 'deleteMany',
    'remove', 'drop',
    'replaceOne',
    'findOneAndUpdate', 'findOneAndReplace', 'findOneAndDelete',
    'bulkWrite',
    'createIndex', 'dropIndex', 'dropIndexes',
    'rename',
    'createCollection', 'dropCollection'
] as const;

/** 쿼리 차단 결과 */
export interface WriteCheckResult {
    /** 쓰기 쿼리 여부 */
    isWrite: boolean;
    /** 감지된 쓰기 키워드 */
    keyword: string | null;
}

/**
 * SQL 문자열 리터럴과 주석을 제거하여 실제 SQL 구문만 남깁니다.
 * 문자열 내부의 키워드가 오탐지되는 것을 방지합니다.
 */
export function stripStringsAndComments(query: string, dbType = 'sql', keepIdentifiers = false): string {
    const mysql = dbType === 'mysql' || dbType === 'sql';
    const postgres = dbType === 'postgres' || dbType === 'sql';
    const strings = mysql ? "'(?:''|\\\\.|[^'\\\\])*'"
        : (postgres ? "\\b[Ee]'(?:''|\\\\.|[^'\\\\])*'|'(?:''|[^'])*'" : "'(?:''|[^'])*'");
    const patterns = [
        ...(postgres ? ['\\$(\\w*)\\$[\\s\\S]*?\\$\\1\\$'] : []),
        strings, '"(?:""|[^"])*"', '`(?:``|[^`])*`',
        ...(['sqlite', 'sql'].includes(dbType) ? ['\\[[^\\]]*\\]'] : []),
        '\\/\\*[\\s\\S]*?\\*\\/', '--[^\\r\\n]*', ...(mysql ? ['#[^\\r\\n]*'] : [])
    ];
    // 정규식 치환 순서 때문에 문자열 안의 주석 기호가 SQL을 숨기지 않도록 한 번에 읽는다.
    return query.replace(
        new RegExp(patterns.join('|'), 'g'),
        match => {
            if (keepIdentifiers && /^["`]/.test(match)) { return ' ' + match.slice(1, -1) + ' '; }
            // MySQL 실행 주석은 주석으로 버리면 안 된다.
            if (/^\/\*(?:!|M!)/i.test(match)) {
                return match.replace(/^\/\*(?:!|M!)\d*/i, prefix => ' '.repeat(prefix.length)).replace(/\*\/$/, '  ');
            }
            return ' '.repeat(match.length);
        }
    );
}

/**
 * SQL 쿼리가 쓰기 작업인지 확인합니다.
 * 문자열 리터럴과 주석 내부의 키워드는 무시합니다.
 */
export function isWriteQuery(query: string, dbType = 'sql'): WriteCheckResult {
    const cleaned = stripStringsAndComments(query, dbType).trim();
    // SELECT에도 상태 변경·세션 종료 함수가 들어갈 수 있다. 인용된 함수명도 검사한다.
    const functionSql = stripStringsAndComments(query, dbType, true);
    const sideEffect = functionSql.match(/\b(nextval|setval|set_config|pg_terminate_backend|pg_cancel_backend|pg_reload_conf|pg_rotate_logfile|pg_promote|pg_switch_wal|pg_advisory_(?:xact_)?lock(?:_shared)?|pg_try_advisory_(?:xact_)?lock(?:_shared)?|lo_create|lo_unlink|lo_import|lo_export|dblink_exec|get_lock|release_lock)\s*\(/i);
    if (sideEffect) { return { isWrite: true, keyword: sideEffect[1].toUpperCase() }; }

    // 빈 쿼리
    if (!cleaned) {
        return { isWrite: false, keyword: null };
    }

    // 세미콜론으로 구분된 다중 쿼리 지원
    const statements = cleaned.split(';').filter(s => s.trim());

    for (const stmt of statements) {
        const trimmed = stmt.trim();
        const tokens = trimmed.toUpperCase().match(/[A-Z_]+/g) || [];
        if (tokens[0] === 'SHOW' || tokens[0] === 'DESCRIBE' || tokens[0] === 'DESC') { continue; }
        // CTE 본문과 EXPLAIN ANALYZE 내부의 쓰기 작업도 검사한다.
        const writeToken = tokens.find(token => WRITE_KEYWORDS.includes(token as typeof WRITE_KEYWORDS[number]));
        if (writeToken) {
            return { isWrite: true, keyword: writeToken };
        }
        const firstToken = tokens[0];
        if (firstToken === 'PRAGMA') {
            const readPragmas = ['TABLE_INFO', 'TABLE_XINFO', 'FOREIGN_KEY_LIST', 'INDEX_INFO', 'INDEX_XINFO',
                'INDEX_LIST', 'DATABASE_LIST', 'COLLATION_LIST', 'COMPILE_OPTIONS', 'PRAGMA_LIST',
                'USER_VERSION', 'INTEGRITY_CHECK', 'QUICK_CHECK', 'FOREIGN_KEY_CHECK'];
            if (trimmed.includes('=') || !tokens.some(token => readPragmas.includes(token))) {
                return { isWrite: true, keyword: 'PRAGMA' };
            }
        } else if (firstToken && !['SELECT', 'WITH', 'SHOW', 'DESCRIBE', 'DESC', 'EXPLAIN', 'VALUES', 'TABLE'].includes(firstToken)) {
            // 알 수 없는 명령은 읽기 전용 연결에서 실행하지 않는다.
            return { isWrite: true, keyword: firstToken };
        }
    }

    return { isWrite: false, keyword: null };
}

/**
 * Redis 명령어가 쓰기 작업인지 확인합니다.
 */
export function isRedisWriteCommand(command: string): WriteCheckResult {
    const trimmed = command.trim();
    if (!trimmed) {
        return { isWrite: false, keyword: null };
    }

    const firstToken = trimmed.split(/\s+/)[0].toUpperCase();

    const readCommands = ['PING', 'SELECT', 'GET', 'MGET', 'EXISTS', 'KEYS', 'SCAN', 'HGET', 'HGETALL',
        'HKEYS', 'HVALS', 'HLEN', 'LRANGE', 'LLEN', 'SMEMBERS', 'SCARD', 'SISMEMBER', 'ZRANGE',
        'ZRANK', 'ZCARD', 'INFO', 'DBSIZE', 'TTL', 'PTTL', 'TYPE', 'STRLEN', 'HEXISTS'];
    if (REDIS_WRITE_COMMANDS.includes(firstToken as typeof REDIS_WRITE_COMMANDS[number]) || !readCommands.includes(firstToken)) {
        return { isWrite: true, keyword: firstToken };
    }

    return { isWrite: false, keyword: null };
}

/**
 * MongoDB 쿼리(Shell 문법)가 쓰기 작업인지 확인합니다.
 * 예: db.users.insertOne({...}), db.users.deleteMany({})
 */
export function isMongoWriteQuery(query: string): WriteCheckResult {
    const trimmed = query.trim();
    if (!trimmed) { return { isWrite: false, keyword: null }; }
    // JSON runCommand와 집계의 출력 단계도 포함한다.
    if (trimmed.startsWith('{')) {
        try {
            const command = JSON.parse(trimmed) as Record<string, unknown>;
            const name = Object.keys(command)[0];
            const readCommands = ['find', 'count', 'distinct', 'aggregate', 'explain', 'ping',
                'listDatabases', 'listCollections', 'collStats', 'dbStats'];
            if (!readCommands.includes(name) || /"\$(?:out|merge)"\s*:/.test(JSON.stringify(command))) {
                return { isWrite: true, keyword: name || 'UNKNOWN' };
            }
            if (name === 'explain') { return isMongoWriteQuery(JSON.stringify(command.explain)); }
            return { isWrite: false, keyword: null };
        } catch { return { isWrite: true, keyword: 'INVALID JSON' }; }
    }
    if (/['"]?\$(?:out|merge)['"]?\s*:/.test(trimmed)) {
        return { isWrite: true, keyword: 'aggregate output' };
    }
    const cleaned = stripStringsAndComments(query).trim();
    if (!cleaned) {
        return { isWrite: false, keyword: null };
    }

    for (const method of MONGODB_WRITE_METHODS) {
        // db.collection.method( 패턴 매칭
        const regex = new RegExp(`\\.${method}\\s*\\(`, 'i');
        if (regex.test(cleaned)) {
            return { isWrite: true, keyword: method };
        }
    }
    const method = trimmed.match(/^db\.\w+\.(\w+)\s*\(/)?.[1];
    if (method === 'aggregate') {
        try {
            const args = trimmed.replace(/;\s*$/, '').match(/^db\.\w+\.aggregate\(([\s\S]*)\)$/)?.[1];
            if (!args || /"\$(?:out|merge)"\s*:/.test(JSON.stringify(JSON.parse(args)))) {
                return { isWrite: true, keyword: 'aggregate output' };
            }
        } catch { return { isWrite: true, keyword: 'INVALID aggregate' }; }
    }
    if (!method || !['find', 'findOne', 'count', 'countDocuments', 'estimatedDocumentCount', 'getIndexes', 'distinct', 'aggregate'].includes(method)) {
        return { isWrite: true, keyword: method || 'UNKNOWN' };
    }
    return { isWrite: false, keyword: null };
}

/**
 * 데이터베이스 유형에 따라 쿼리의 쓰기 여부를 확인합니다.
 */
export function checkWriteOperation(
    query: string,
    dbType: string
): WriteCheckResult {
    switch (dbType) {
        case 'redis':
            return isRedisWriteCommand(query);
        case 'mongodb':
            return isMongoWriteQuery(query);
        default:
            return isWriteQuery(query, dbType);
    }
}

/**
 * 읽기 전용 모드에서 차단된 쿼리에 대한 사용자 메시지를 생성합니다.
 */
export function getBlockedMessage(keyword: string, connectionName: string): string {
    return `[Read-Only] "${keyword}" operation blocked on "${connectionName}". Disable read-only mode to execute write queries.`;
}

/**
 * 읽기 전용 모드에서 차단된 쿼리에 대한 한국어 메시지를 생성합니다.
 */
export function getBlockedMessageKo(keyword: string, connectionName: string): string {
    return `[읽기 전용] "${connectionName}" 연결에서 "${keyword}" 작업이 차단되었습니다. 쓰기 쿼리를 실행하려면 읽기 전용 모드를 해제하세요.`;
}
