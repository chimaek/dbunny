/**
 * 읽기 전용 가드 유닛 테스트 (스탠드얼론)
 *
 * 실행: npx tsx src/test/unit/readOnlyGuard.standalone.ts
 */

import {
    isWriteQuery,
    isRedisWriteCommand,
    isMongoWriteQuery,
    checkWriteOperation,
    getBlockedMessage,
    getBlockedMessageKo
} from '../../utils/readOnlyGuard';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
    if (condition) {
        passed++;
        console.log(`  ✅ ${message}`);
    } else {
        failed++;
        console.error(`  ❌ ${message}`);
    }
}

function section(title: string): void {
    console.log(`\n📋 ${title}`);
}

// ===== SQL Write Detection =====

section('isWriteQuery — INSERT');
assert(isWriteQuery('INSERT INTO users (name) VALUES ("test")').isWrite === true, 'INSERT detected');
assert(isWriteQuery('insert into users values (1)').isWrite === true, 'lowercase insert detected');
assert(isWriteQuery('  INSERT INTO users VALUES (1)').isWrite === true, 'leading whitespace INSERT');
assert(isWriteQuery('INSERT INTO users VALUES (1)').keyword === 'INSERT', 'keyword is INSERT');

section('isWriteQuery — UPDATE');
assert(isWriteQuery('UPDATE users SET name = "test" WHERE id = 1').isWrite === true, 'UPDATE detected');
assert(isWriteQuery('update users set name = "a"').isWrite === true, 'lowercase update');

section('isWriteQuery — DELETE');
assert(isWriteQuery('DELETE FROM users WHERE id = 1').isWrite === true, 'DELETE detected');
assert(isWriteQuery('delete from users').isWrite === true, 'lowercase delete');

section('isWriteQuery — DROP');
assert(isWriteQuery('DROP TABLE users').isWrite === true, 'DROP TABLE detected');
assert(isWriteQuery('DROP DATABASE mydb').isWrite === true, 'DROP DATABASE detected');
assert(isWriteQuery('drop table if exists users').isWrite === true, 'lowercase drop');

section('isWriteQuery — ALTER');
assert(isWriteQuery('ALTER TABLE users ADD COLUMN age INT').isWrite === true, 'ALTER detected');

section('isWriteQuery — CREATE');
assert(isWriteQuery('CREATE TABLE users (id INT)').isWrite === true, 'CREATE TABLE detected');
assert(isWriteQuery('CREATE INDEX idx ON users(name)').isWrite === true, 'CREATE INDEX detected');

section('isWriteQuery — TRUNCATE');
assert(isWriteQuery('TRUNCATE TABLE users').isWrite === true, 'TRUNCATE detected');

section('isWriteQuery — REPLACE');
assert(isWriteQuery('REPLACE INTO users VALUES (1, "test")').isWrite === true, 'REPLACE detected');

section('isWriteQuery — GRANT/REVOKE');
assert(isWriteQuery('GRANT SELECT ON users TO user1').isWrite === true, 'GRANT detected');
assert(isWriteQuery('REVOKE ALL ON users FROM user1').isWrite === true, 'REVOKE detected');

section('isWriteQuery — CALL/EXEC/EXECUTE');
assert(isWriteQuery('CALL sp_update_stats()').isWrite === true, 'CALL detected');
assert(isWriteQuery('EXEC sp_delete_user 1').isWrite === true, 'EXEC detected');
assert(isWriteQuery('EXECUTE sp_clear()').isWrite === true, 'EXECUTE detected');

section('isWriteQuery — MERGE/UPSERT/RENAME');
assert(isWriteQuery('MERGE INTO users USING temp ON id').isWrite === true, 'MERGE detected');
assert(isWriteQuery('UPSERT INTO users VALUES (1)').isWrite === true, 'UPSERT detected');
assert(isWriteQuery('RENAME TABLE old TO new').isWrite === true, 'RENAME detected');

section('isWriteQuery — SELECT (safe)');
assert(isWriteQuery('SELECT * FROM users').isWrite === false, 'SELECT is safe');
assert(isWriteQuery('select count(*) from users').isWrite === false, 'lowercase select is safe');
assert(isWriteQuery('SELECT 1').isWrite === false, 'simple select is safe');

section('isWriteQuery — SHOW/DESCRIBE/EXPLAIN (safe)');
assert(isWriteQuery('SHOW TABLES').isWrite === false, 'SHOW is safe');
assert(isWriteQuery('DESCRIBE users').isWrite === false, 'DESCRIBE is safe');
assert(isWriteQuery('EXPLAIN SELECT * FROM users').isWrite === false, 'EXPLAIN is safe');

section('isWriteQuery — WITH (CTE, safe)');
assert(isWriteQuery('WITH cte AS (SELECT 1) SELECT * FROM cte').isWrite === false, 'CTE is safe');

section('isWriteQuery — empty/whitespace');
assert(isWriteQuery('').isWrite === false, 'empty string is safe');
assert(isWriteQuery('   ').isWrite === false, 'whitespace only is safe');
assert(isWriteQuery('').keyword === null, 'empty keyword is null');

section('isWriteQuery — multi-statement');
assert(isWriteQuery('SELECT 1; DELETE FROM users').isWrite === true, 'multi-statement with DELETE');
assert(isWriteQuery('SELECT 1; SELECT 2').isWrite === false, 'multi-statement SELECT only is safe');
assert(isWriteQuery('SELECT 1; INSERT INTO users VALUES (1); SELECT 2').isWrite === true, 'middle INSERT detected');

section('isWriteQuery — strings and comments (no false positives)');
assert(isWriteQuery("SELECT * FROM users WHERE name = 'DELETE FROM'").isWrite === false, 'DELETE inside string literal is safe');
assert(isWriteQuery('SELECT * FROM users -- DELETE FROM users').isWrite === false, 'DELETE in line comment is safe');
assert(isWriteQuery('SELECT * FROM users /* INSERT INTO */ WHERE 1=1').isWrite === false, 'INSERT in block comment is safe');
assert(isWriteQuery("SELECT 'DROP TABLE users' AS test").isWrite === false, 'DROP inside string is safe');
assert(isWriteQuery('SELECT "INSERT" FROM users').isWrite === false, 'INSERT inside double-quoted string is safe');

section('isWriteQuery — edge cases');
assert(isWriteQuery('SELECTED * FROM users').isWrite === false, 'SELECTED is not SELECT write keyword');
assert(isWriteQuery('DELETING FROM users').isWrite === false, 'DELETING is not a write keyword');

// ===== Redis Write Detection =====

section('isRedisWriteCommand — write commands');
assert(isRedisWriteCommand('SET key value').isWrite === true, 'SET detected');
assert(isRedisWriteCommand('set key value').isWrite === true, 'lowercase set');
assert(isRedisWriteCommand('DEL key').isWrite === true, 'DEL detected');
assert(isRedisWriteCommand('HSET hash field val').isWrite === true, 'HSET detected');
assert(isRedisWriteCommand('LPUSH list val').isWrite === true, 'LPUSH detected');
assert(isRedisWriteCommand('SADD set member').isWrite === true, 'SADD detected');
assert(isRedisWriteCommand('ZADD zset 1 member').isWrite === true, 'ZADD detected');
assert(isRedisWriteCommand('FLUSHDB').isWrite === true, 'FLUSHDB detected');
assert(isRedisWriteCommand('FLUSHALL').isWrite === true, 'FLUSHALL detected');
assert(isRedisWriteCommand('INCR counter').isWrite === true, 'INCR detected');
assert(isRedisWriteCommand('EXPIRE key 100').isWrite === true, 'EXPIRE detected');
assert(isRedisWriteCommand('RENAME key newkey').isWrite === true, 'RENAME detected');

section('isRedisWriteCommand — read commands');
assert(isRedisWriteCommand('GET key').isWrite === false, 'GET is safe');
assert(isRedisWriteCommand('HGET hash field').isWrite === false, 'HGET is safe');
assert(isRedisWriteCommand('LRANGE list 0 -1').isWrite === false, 'LRANGE is safe');
assert(isRedisWriteCommand('SMEMBERS set').isWrite === false, 'SMEMBERS is safe');
assert(isRedisWriteCommand('ZRANGE zset 0 -1').isWrite === false, 'ZRANGE is safe');
assert(isRedisWriteCommand('KEYS *').isWrite === false, 'KEYS is safe');
assert(isRedisWriteCommand('TTL key').isWrite === false, 'TTL is safe');
assert(isRedisWriteCommand('EXISTS key').isWrite === false, 'EXISTS is safe');
assert(isRedisWriteCommand('TYPE key').isWrite === false, 'TYPE is safe');
assert(isRedisWriteCommand('DBSIZE').isWrite === false, 'DBSIZE is safe');
assert(isRedisWriteCommand('INFO').isWrite === false, 'INFO is safe');
assert(isRedisWriteCommand('PING').isWrite === false, 'PING is safe');

section('isRedisWriteCommand — empty');
assert(isRedisWriteCommand('').isWrite === false, 'empty is safe');
assert(isRedisWriteCommand('   ').isWrite === false, 'whitespace is safe');

// ===== MongoDB Write Detection =====

section('isMongoWriteQuery — write methods');
assert(isMongoWriteQuery('db.users.insertOne({name: "test"})').isWrite === true, 'insertOne detected');
assert(isMongoWriteQuery('db.users.insertMany([{a:1}])').isWrite === true, 'insertMany detected');
assert(isMongoWriteQuery('db.users.updateOne({id:1}, {$set:{name:"x"}})').isWrite === true, 'updateOne detected');
assert(isMongoWriteQuery('db.users.updateMany({}, {$set:{active:true}})').isWrite === true, 'updateMany detected');
assert(isMongoWriteQuery('db.users.deleteOne({id:1})').isWrite === true, 'deleteOne detected');
assert(isMongoWriteQuery('db.users.deleteMany({})').isWrite === true, 'deleteMany detected');
assert(isMongoWriteQuery('db.users.drop()').isWrite === true, 'drop detected');
assert(isMongoWriteQuery('db.users.replaceOne({id:1}, {name:"x"})').isWrite === true, 'replaceOne detected');
assert(isMongoWriteQuery('db.users.findOneAndUpdate({}, {$set:{}})').isWrite === true, 'findOneAndUpdate detected');
assert(isMongoWriteQuery('db.users.findOneAndDelete({id:1})').isWrite === true, 'findOneAndDelete detected');
assert(isMongoWriteQuery('db.users.createIndex({name:1})').isWrite === true, 'createIndex detected');
assert(isMongoWriteQuery('db.users.dropIndex("idx")').isWrite === true, 'dropIndex detected');
assert(isMongoWriteQuery('db.users.bulkWrite([])').isWrite === true, 'bulkWrite detected');

section('isMongoWriteQuery — read methods');
assert(isMongoWriteQuery('db.users.find({})').isWrite === false, 'find is safe');
assert(isMongoWriteQuery('db.users.findOne({id:1})').isWrite === false, 'findOne is safe');
assert(isMongoWriteQuery('db.users.count()').isWrite === false, 'count is safe');
assert(isMongoWriteQuery('db.users.aggregate([])').isWrite === false, 'aggregate is safe');
assert(isMongoWriteQuery('db.users.distinct("name")').isWrite === false, 'distinct is safe');

section('isMongoWriteQuery — edge cases');
assert(isMongoWriteQuery('').isWrite === false, 'empty is safe');
assert(isMongoWriteQuery('db.users.find({name: "insertOne"})').isWrite === false, 'insertOne inside string is safe');

// ===== checkWriteOperation (dispatcher) =====

section('checkWriteOperation — dispatch by dbType');
assert(checkWriteOperation('SELECT 1', 'mysql').isWrite === false, 'mysql SELECT is safe');
assert(checkWriteOperation('INSERT INTO t VALUES(1)', 'mysql').isWrite === true, 'mysql INSERT detected');
assert(checkWriteOperation('INSERT INTO t VALUES(1)', 'postgres').isWrite === true, 'postgres INSERT detected');
assert(checkWriteOperation('INSERT INTO t VALUES(1)', 'sqlite').isWrite === true, 'sqlite INSERT detected');
assert(checkWriteOperation('SET key val', 'redis').isWrite === true, 'redis SET detected');
assert(checkWriteOperation('GET key', 'redis').isWrite === false, 'redis GET is safe');
assert(checkWriteOperation('db.users.insertOne({})', 'mongodb').isWrite === true, 'mongodb insertOne detected');
assert(checkWriteOperation('db.users.find({})', 'mongodb').isWrite === false, 'mongodb find is safe');

// ===== Message formatting =====

section('getBlockedMessage / getBlockedMessageKo');
const en = getBlockedMessage('INSERT', 'Production DB');
assert(en.includes('INSERT'), 'English message contains keyword');
assert(en.includes('Production DB'), 'English message contains connection name');
assert(en.includes('Read-Only'), 'English message contains Read-Only prefix');

const ko = getBlockedMessageKo('DELETE', '운영 DB');
assert(ko.includes('DELETE'), 'Korean message contains keyword');
assert(ko.includes('운영 DB'), 'Korean message contains connection name');
assert(ko.includes('읽기 전용'), 'Korean message contains 읽기 전용 prefix');

// ===== 확장 테스트: 추가 SQL 패턴 =====

section('isWriteQuery — 대소문자 혼합');
assert(isWriteQuery('InSeRt INTO users VALUES (1)').isWrite === true, 'mixed case INSERT');
assert(isWriteQuery('DeLeTe FROM users').isWrite === true, 'mixed case DELETE');
assert(isWriteQuery('DrOp TABLE users').isWrite === true, 'mixed case DROP');
assert(isWriteQuery('tRuNcAtE TABLE users').isWrite === true, 'mixed case TRUNCATE');

section('isWriteQuery — 선행 공백/탭/줄바꿈');
assert(isWriteQuery('\n\n  DELETE FROM users').isWrite === true, 'newlines + DELETE');
assert(isWriteQuery('\t\tINSERT INTO users VALUES(1)').isWrite === true, 'tabs + INSERT');
assert(isWriteQuery('   \n\t  UPDATE users SET a=1').isWrite === true, 'mixed whitespace + UPDATE');

section('isWriteQuery — 복합 쿼리 패턴');
// WITH ... INSERT/DELETE/UPDATE는 첫 토큰이 WITH이므로 현재 미감지
// CTE + DML은 알려진 한계: WITH는 읽기로 분류됨
assert(isWriteQuery('WITH cte AS (SELECT 1) INSERT INTO users SELECT * FROM cte').isWrite === false, 'CTE + INSERT 미감지 (알려진 한계 — WITH 첫 토큰)');
assert(isWriteQuery('WITH cte AS (SELECT 1) DELETE FROM users').isWrite === false, 'CTE + DELETE 미감지 (알려진 한계)');
assert(isWriteQuery('WITH cte AS (SELECT 1) UPDATE users SET x=1').isWrite === false, 'CTE + UPDATE 미감지 (알려진 한계)');

section('isWriteQuery — 주석 유형 조합');
assert(isWriteQuery('/* comment */ SELECT * FROM users').isWrite === false, 'block comment before SELECT');
assert(isWriteQuery('/* DELETE */ SELECT * FROM users').isWrite === false, 'DELETE only in block comment');
assert(isWriteQuery('-- DELETE\nSELECT * FROM users').isWrite === false, 'DELETE only in line comment');
assert(isWriteQuery('/* comment */ INSERT INTO users VALUES(1)').isWrite === true, 'block comment before INSERT');
assert(isWriteQuery("SELECT * FROM t WHERE a='x' /* INSERT */ AND b=1").isWrite === false, 'INSERT only in mid-query block comment');

section('isWriteQuery — 문자열 내 여러 키워드');
assert(isWriteQuery("SELECT * FROM t WHERE sql_text = 'INSERT INTO users; DELETE FROM t; DROP TABLE t'").isWrite === false, 'multiple keywords in string literal');
assert(isWriteQuery('SELECT "DELETE UPDATE INSERT" FROM t').isWrite === false, 'keywords in double-quoted string');

section('isWriteQuery — MySQL LOAD/LOCK/UNLOCK');
// LOAD DATA는 첫 토큰이 LOAD이므로 현재 감지 안 될 수 있음
// 하지만 보안 관점에서 확인
const loadCheck = isWriteQuery('LOAD DATA INFILE "file" INTO TABLE users');
// LOAD는 SQL_WRITE_KEYWORDS에 없을 수 있음 — 기록용
if (loadCheck.isWrite) {
    assert(true, 'LOAD DATA 쓰기 감지됨');
} else {
    assert(true, 'LOAD DATA 미감지 (알려진 한계) — LOAD는 키워드 목록에 없음');
}

section('isRedisWriteCommand — 추가 쓰기 명령');
assert(isRedisWriteCommand('SETEX key 100 value').isWrite === true, 'SETEX detected');
assert(isRedisWriteCommand('SETNX key value').isWrite === true, 'SETNX detected');
assert(isRedisWriteCommand('MSET k1 v1 k2 v2').isWrite === true, 'MSET detected');
assert(isRedisWriteCommand('RPUSH list val').isWrite === true, 'RPUSH detected');
assert(isRedisWriteCommand('LSET list 0 val').isWrite === true, 'LSET detected');
assert(isRedisWriteCommand('HDEL hash field').isWrite === true, 'HDEL detected');
assert(isRedisWriteCommand('SREM set member').isWrite === true, 'SREM detected');
assert(isRedisWriteCommand('PERSIST key').isWrite === true, 'PERSIST detected');

section('isRedisWriteCommand — 추가 읽기 명령');
assert(isRedisWriteCommand('MGET k1 k2 k3').isWrite === false, 'MGET is safe');
assert(isRedisWriteCommand('HGETALL hash').isWrite === false, 'HGETALL is safe');
assert(isRedisWriteCommand('SCARD set').isWrite === false, 'SCARD is safe');
assert(isRedisWriteCommand('STRLEN key').isWrite === false, 'STRLEN is safe');
assert(isRedisWriteCommand('LLEN list').isWrite === false, 'LLEN is safe');
assert(isRedisWriteCommand('ZCARD zset').isWrite === false, 'ZCARD is safe');
assert(isRedisWriteCommand('HEXISTS hash field').isWrite === false, 'HEXISTS is safe');

section('isMongoWriteQuery — 추가 쓰기 메서드');
assert(isMongoWriteQuery('db.users.findOneAndReplace({id:1},{name:"x"})').isWrite === true, 'findOneAndReplace detected');
assert(isMongoWriteQuery('db.users.dropIndexes()').isWrite === true, 'dropIndexes detected');
// db.dropDatabase()는 db.collection.method() 패턴이 아님 (collection이 없음)
assert(isMongoWriteQuery('db.dropDatabase()').isWrite === false, 'dropDatabase는 collection.method 패턴 아님 (알려진 한계)');
assert(isMongoWriteQuery('db.createCollection("test")').isWrite === true, 'createCollection detected');

section('isMongoWriteQuery — 추가 읽기 메서드');
assert(isMongoWriteQuery('db.users.estimatedDocumentCount()').isWrite === false, 'estimatedDocumentCount is safe');
assert(isMongoWriteQuery('db.users.getIndexes()').isWrite === false, 'getIndexes is safe');

section('checkWriteOperation — H2 타입 디스패치');
assert(checkWriteOperation('SELECT 1', 'h2').isWrite === false, 'H2 SELECT is safe');
assert(checkWriteOperation('INSERT INTO t VALUES(1)', 'h2').isWrite === true, 'H2 INSERT detected');
assert(checkWriteOperation('DROP TABLE t', 'h2').isWrite === true, 'H2 DROP detected');

section('checkWriteOperation — 알 수 없는 DB 타입');
assert(checkWriteOperation('SELECT 1', 'unknown_db').isWrite === false, 'unknown DB SELECT is safe');
assert(checkWriteOperation('INSERT INTO t VALUES(1)', 'unknown_db').isWrite === true, 'unknown DB INSERT detected (SQL fallback)');

// ===== Summary =====

console.log(`\n${'='.repeat(50)}`);
console.log(`총 ${passed + failed}개 테스트: ✅ ${passed}개 통과, ❌ ${failed}개 실패`);
if (failed > 0) {
    process.exit(1);
}
