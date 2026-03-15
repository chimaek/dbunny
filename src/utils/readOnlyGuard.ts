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
    'EXECUTE'
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
function stripStringsAndComments(query: string): string {
    // 순서: 블록 주석 → 라인 주석 → 문자열 리터럴
    return query
        .replace(/\/\*[\s\S]*?\*\//g, ' ')   // /* ... */
        .replace(/--[^\n]*/g, ' ')            // -- ...
        .replace(/'(?:[^'\\]|\\.)*'/g, "''")  // '...'
        .replace(/"(?:[^"\\]|\\.)*"/g, '""'); // "..."
}

/**
 * SQL 쿼리가 쓰기 작업인지 확인합니다.
 * 문자열 리터럴과 주석 내부의 키워드는 무시합니다.
 */
export function isWriteQuery(query: string): WriteCheckResult {
    const cleaned = stripStringsAndComments(query).trim();

    // 빈 쿼리
    if (!cleaned) {
        return { isWrite: false, keyword: null };
    }

    // 세미콜론으로 구분된 다중 쿼리 지원
    const statements = cleaned.split(';').filter(s => s.trim());

    for (const stmt of statements) {
        const trimmed = stmt.trim();
        // 첫 번째 의미 있는 토큰 추출
        const firstToken = trimmed.split(/\s+/)[0].toUpperCase();

        if (WRITE_KEYWORDS.includes(firstToken as typeof WRITE_KEYWORDS[number])) {
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

    if (REDIS_WRITE_COMMANDS.includes(firstToken as typeof REDIS_WRITE_COMMANDS[number])) {
        return { isWrite: true, keyword: firstToken };
    }

    return { isWrite: false, keyword: null };
}

/**
 * MongoDB 쿼리(Shell 문법)가 쓰기 작업인지 확인합니다.
 * 예: db.users.insertOne({...}), db.users.deleteMany({})
 */
export function isMongoWriteQuery(query: string): WriteCheckResult {
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
            return isWriteQuery(query);
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
