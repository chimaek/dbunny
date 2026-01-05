import { createClient, RedisClientType } from 'redis';
import { DatabaseConnection, ConnectionConfig, QueryResult, ColumnInfo } from '../types/database';

/**
 * Redis database provider
 */
export class RedisProvider implements DatabaseConnection {
    private client: RedisClientType | null = null;

    constructor(public config: ConnectionConfig) {}

    async connect(): Promise<void> {
        try {
            const url = this.buildConnectionUrl();
            this.client = createClient({ url });

            this.client.on('error', (err) => {
                console.error('Redis Client Error:', err);
            });

            await this.client.connect();

            // Test connection
            await this.client.ping();
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            throw new Error(`Failed to connect to Redis: ${message}`);
        }
    }

    async disconnect(): Promise<void> {
        if (this.client) {
            await this.client.quit();
            this.client = null;
        }
    }

    async executeQuery(query: string): Promise<QueryResult> {
        if (!this.client) {
            throw new Error('Not connected to database');
        }

        try {
            const startTime = Date.now();
            const args = this.parseRedisCommand(query);
            const command = args[0].toUpperCase();
            const commandArgs = args.slice(1);

            let result: unknown;

            // Handle common Redis commands
            switch (command) {
                case 'PING':
                    result = await this.client.ping();
                    break;
                case 'SELECT': {
                    // Check if user is trying SQL-style SELECT query
                    if (commandArgs.length > 0 && (commandArgs[0] === '*' || commandArgs[0].toUpperCase() === 'FROM' || query.toUpperCase().includes('FROM'))) {
                        throw new Error('Redis does not support SQL queries. Use Redis commands like: KEYS *, GET key, HGETALL key, SMEMBERS key, LRANGE key 0 -1');
                    }
                    // Redis SELECT command for switching databases
                    const dbIndex = parseInt(commandArgs[0]);
                    if (isNaN(dbIndex) || dbIndex < 0 || dbIndex > 15) {
                        throw new Error('SELECT <db_index>: Switch database (0-15). Example: SELECT 0');
                    }
                    // Actually switch the database by reconnecting
                    await this.client.select(dbIndex);
                    result = `OK - Switched to database ${dbIndex}`;
                    break;
                }
                case 'GET':
                    result = await this.client.get(commandArgs[0]);
                    break;
                case 'SET':
                    result = await this.client.set(commandArgs[0], commandArgs[1]);
                    break;
                case 'MGET':
                    result = await this.client.mGet(commandArgs);
                    break;
                case 'MSET': {
                    const pairs: [string, string][] = [];
                    for (let i = 0; i < commandArgs.length; i += 2) {
                        pairs.push([commandArgs[i], commandArgs[i + 1]]);
                    }
                    result = await this.client.mSet(pairs);
                    break;
                }
                case 'DEL':
                    result = await this.client.del(commandArgs);
                    break;
                case 'EXISTS':
                    result = await this.client.exists(commandArgs);
                    break;
                case 'KEYS':
                    result = await this.client.keys(commandArgs[0] || '*');
                    break;
                case 'SCAN': {
                    const cursor = parseInt(commandArgs[0]) || 0;
                    const scanResult = await this.client.scan(cursor, { MATCH: commandArgs[2] || '*', COUNT: 100 });
                    result = { cursor: scanResult.cursor, keys: scanResult.keys };
                    break;
                }
                case 'HGET':
                    result = await this.client.hGet(commandArgs[0], commandArgs[1]);
                    break;
                case 'HGETALL':
                    result = await this.client.hGetAll(commandArgs[0]);
                    break;
                case 'HSET':
                    result = await this.client.hSet(commandArgs[0], commandArgs[1], commandArgs[2]);
                    break;
                case 'HDEL':
                    result = await this.client.hDel(commandArgs[0], commandArgs.slice(1));
                    break;
                case 'HKEYS':
                    result = await this.client.hKeys(commandArgs[0]);
                    break;
                case 'HVALS':
                    result = await this.client.hVals(commandArgs[0]);
                    break;
                case 'HLEN':
                    result = await this.client.hLen(commandArgs[0]);
                    break;
                case 'LPUSH':
                    result = await this.client.lPush(commandArgs[0], commandArgs.slice(1));
                    break;
                case 'RPUSH':
                    result = await this.client.rPush(commandArgs[0], commandArgs.slice(1));
                    break;
                case 'LPOP':
                    result = await this.client.lPop(commandArgs[0]);
                    break;
                case 'RPOP':
                    result = await this.client.rPop(commandArgs[0]);
                    break;
                case 'LRANGE':
                    result = await this.client.lRange(commandArgs[0], parseInt(commandArgs[1]), parseInt(commandArgs[2]));
                    break;
                case 'LLEN':
                    result = await this.client.lLen(commandArgs[0]);
                    break;
                case 'SADD':
                    result = await this.client.sAdd(commandArgs[0], commandArgs.slice(1));
                    break;
                case 'SREM':
                    result = await this.client.sRem(commandArgs[0], commandArgs.slice(1));
                    break;
                case 'SMEMBERS':
                    result = await this.client.sMembers(commandArgs[0]);
                    break;
                case 'SCARD':
                    result = await this.client.sCard(commandArgs[0]);
                    break;
                case 'SISMEMBER':
                    result = await this.client.sIsMember(commandArgs[0], commandArgs[1]);
                    break;
                case 'ZADD': {
                    const zaddScore = parseFloat(commandArgs[1]);
                    result = await this.client.zAdd(commandArgs[0], { score: zaddScore, value: commandArgs[2] });
                    break;
                }
                case 'ZRANGE':
                    result = await this.client.zRange(commandArgs[0], parseInt(commandArgs[1]), parseInt(commandArgs[2]));
                    break;
                case 'ZRANK':
                    result = await this.client.zRank(commandArgs[0], commandArgs[1]);
                    break;
                case 'ZCARD':
                    result = await this.client.zCard(commandArgs[0]);
                    break;
                case 'INFO':
                    result = await this.client.info(commandArgs[0]);
                    break;
                case 'DBSIZE':
                    result = await this.client.dbSize();
                    break;
                case 'FLUSHDB':
                    result = await this.client.flushDb();
                    break;
                case 'FLUSHALL':
                    result = await this.client.flushAll();
                    break;
                case 'TTL':
                    result = await this.client.ttl(commandArgs[0]);
                    break;
                case 'PTTL':
                    result = await this.client.pTTL(commandArgs[0]);
                    break;
                case 'EXPIRE':
                    result = await this.client.expire(commandArgs[0], parseInt(commandArgs[1]));
                    break;
                case 'PERSIST':
                    result = await this.client.persist(commandArgs[0]);
                    break;
                case 'TYPE':
                    result = await this.client.type(commandArgs[0]);
                    break;
                case 'RENAME':
                    result = await this.client.rename(commandArgs[0], commandArgs[1]);
                    break;
                case 'INCR':
                    result = await this.client.incr(commandArgs[0]);
                    break;
                case 'DECR':
                    result = await this.client.decr(commandArgs[0]);
                    break;
                case 'INCRBY':
                    result = await this.client.incrBy(commandArgs[0], parseInt(commandArgs[1]));
                    break;
                case 'DECRBY':
                    result = await this.client.decrBy(commandArgs[0], parseInt(commandArgs[1]));
                    break;
                case 'APPEND':
                    result = await this.client.append(commandArgs[0], commandArgs[1]);
                    break;
                case 'STRLEN':
                    result = await this.client.strLen(commandArgs[0]);
                    break;
                default:
                    throw new Error(`Unsupported Redis command: ${command}. Supported: PING, SELECT, GET, SET, MGET, MSET, DEL, EXISTS, KEYS, SCAN, HGET, HGETALL, HSET, HDEL, HKEYS, HVALS, HLEN, LPUSH, RPUSH, LPOP, RPOP, LRANGE, LLEN, SADD, SREM, SMEMBERS, SCARD, SISMEMBER, ZADD, ZRANGE, ZRANK, ZCARD, INFO, DBSIZE, FLUSHDB, FLUSHALL, TTL, PTTL, EXPIRE, PERSIST, TYPE, RENAME, INCR, DECR, INCRBY, DECRBY, APPEND, STRLEN`);
            }

            const executionTime = Date.now() - startTime;
            const rows = this.formatResult(result);

            return {
                rows,
                fields: rows.length > 0 ? Object.keys(rows[0]).map(name => ({
                    name,
                    type: 'string',
                    table: undefined
                })) : [],
                rowCount: rows.length,
                executionTime
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            throw new Error(`Query execution failed: ${message}`);
        }
    }

    async getDatabases(): Promise<string[]> {
        // Redis has numbered databases (0-15 by default)
        return Array.from({ length: 16 }, (_, i) => `db${i}`);
    }

    async getTables(_database: string): Promise<string[]> {
        if (!this.client) {
            throw new Error('Not connected');
        }

        // Get all keys as "tables"
        const keys = await this.client.keys('*');
        return keys.slice(0, 100); // Limit to first 100 keys
    }

    async getTableSchema(table: string): Promise<ColumnInfo[]> {
        if (!this.client) {
            throw new Error('Not connected');
        }

        const type = await this.client.type(table);

        return [{
            name: 'key',
            type: 'string',
            nullable: false,
            primaryKey: true,
            defaultValue: undefined
        }, {
            name: 'value',
            type,
            nullable: true,
            primaryKey: false,
            defaultValue: undefined
        }];
    }

    isConnected(): boolean {
        return this.client !== null;
    }

    private buildConnectionUrl(): string {
        const { host, port, username, password, database } = this.config;
        const auth = password
            ? (username ? `${username}:${password}@` : `:${password}@`)
            : '';
        const db = database ? `/${database}` : '';

        return `redis://${auth}${host}:${port || 6379}${db}`;
    }

    private parseRedisCommand(query: string): string[] {
        const args: string[] = [];
        let current = '';
        let inQuotes = false;
        let quoteChar = '';

        for (let i = 0; i < query.length; i++) {
            const char = query[i];

            if ((char === '"' || char === "'") && !inQuotes) {
                inQuotes = true;
                quoteChar = char;
            } else if (char === quoteChar && inQuotes) {
                inQuotes = false;
                quoteChar = '';
            } else if (char === ' ' && !inQuotes) {
                if (current) {
                    args.push(current);
                    current = '';
                }
            } else {
                current += char;
            }
        }

        if (current) {
            args.push(current);
        }

        return args;
    }

    private formatResult(result: unknown): Record<string, unknown>[] {
        if (result === null || result === undefined) {
            return [{ value: '(nil)' }];
        }

        if (Array.isArray(result)) {
            return result.map((item, index) => ({
                index: index + 1,
                value: String(item)
            }));
        }

        if (typeof result === 'object') {
            return Object.entries(result).map(([key, value]) => ({
                key,
                value: String(value)
            }));
        }

        return [{ value: String(result) }];
    }
}
