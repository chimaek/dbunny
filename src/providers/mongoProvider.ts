import { MongoClient, Db } from 'mongodb';
import { DatabaseConnection, ConnectionConfig, QueryResult, ColumnInfo } from '../types/database';

/**
 * MongoDB database provider
 */
export class MongoDBProvider implements DatabaseConnection {
    private client: MongoClient | null = null;
    private db: Db | null = null;

    constructor(public config: ConnectionConfig) {}

    async connect(): Promise<void> {
        try {
            const uri = this.buildConnectionUri();
            this.client = new MongoClient(uri, {
                connectTimeoutMS: 10000,
                serverSelectionTimeoutMS: 10000
            });

            await this.client.connect();
            this.db = this.client.db(this.config.database || 'admin');

            // Test connection
            await this.db.command({ ping: 1 });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            throw new Error(`Failed to connect to MongoDB: ${message}`);
        }
    }

    async disconnect(): Promise<void> {
        if (this.client) {
            await this.client.close();
            this.client = null;
            this.db = null;
        }
    }

    async executeQuery(query: string, database?: string): Promise<QueryResult> {
        if (!this.client) {
            throw new Error('Not connected to database');
        }

        try {
            const startTime = Date.now();

            // Use specified database or default
            const targetDb = database ? this.client.db(database) : this.db;
            if (!targetDb) {
                throw new Error('No database selected');
            }

            // Try parsing as JSON command first, then fall back to Shell syntax
            let command: Record<string, unknown>;
            const trimmed = query.trim();

            if (trimmed.startsWith('{')) {
                command = JSON.parse(trimmed);
            } else {
                command = this.parseShellQuery(trimmed);
            }

            const result = await targetDb.command(command);
            const executionTime = Date.now() - startTime;

            const rows = Array.isArray(result.cursor?.firstBatch)
                ? result.cursor.firstBatch
                : [result];

            const fields = rows.length > 0
                ? Object.keys(rows[0]).map(name => ({
                    name,
                    type: typeof rows[0][name],
                    table: undefined
                }))
                : [];

            return {
                rows,
                fields,
                rowCount: rows.length,
                executionTime
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            throw new Error(`Query execution failed: ${message}`);
        }
    }

    /**
     * Parse MongoDB Shell syntax into a runCommand-compatible JSON object.
     *
     * Supported patterns:
     *   db.collection.find({filter})
     *   db.collection.find({filter}).limit(N)
     *   db.collection.insertOne({doc})
     *   db.collection.insertMany([docs])
     *   db.collection.updateOne({filter}, {update})
     *   db.collection.updateMany({filter}, {update})
     *   db.collection.deleteOne({filter})
     *   db.collection.deleteMany({filter})
     *   db.collection.countDocuments({filter})
     *   db.collection.aggregate([pipeline])
     */
    private parseShellQuery(query: string): Record<string, unknown> {
        // Match: db.collectionName.method(args)  with optional .limit(N)/.sort(...)
        const shellPattern = /^db\.(\w+)\.(\w+)\(([\s\S]*)\)$/;
        const match = query.replace(/;\s*$/, '').match(shellPattern);

        if (!match) {
            throw new Error(
                'Invalid query format. Use JSON: {"find": "collection", "filter": {}} ' +
                'or Shell: db.collection.find({})'
            );
        }

        const collection = match[1];
        const method = match[2];
        const argsStr = match[3].trim();

        // Parse chained methods like .limit(100) .sort({...})
        let mainArgs = argsStr;
        let limit: number | undefined;
        let sort: Record<string, unknown> | undefined;

        // Extract .limit(N) and .sort({...}) if chained after the closing paren
        const chainPattern = /\)\s*\.(limit|sort)\(([^)]+)\)/g;
        const fullQuery = query.replace(/;\s*$/, '');
        let chainMatch;
        while ((chainMatch = chainPattern.exec(fullQuery)) !== null) {
            if (chainMatch[1] === 'limit') {
                limit = parseInt(chainMatch[2].trim(), 10);
            } else if (chainMatch[1] === 'sort') {
                try { sort = JSON.parse(chainMatch[2].trim()); } catch { /* ignore */ }
            }
        }

        // If chained methods exist, extract just the main method args
        const mainMethodMatch = fullQuery.match(/^db\.\w+\.\w+\(([\s\S]*?)\)(?:\s*\.(?:limit|sort)\()?/);
        if (mainMethodMatch) {
            mainArgs = mainMethodMatch[1].trim();
        }

        switch (method) {
            case 'find': {
                const cmd: Record<string, unknown> = { find: collection };
                if (mainArgs) {
                    // find({filter}, {projection}) — split on top-level comma between objects
                    const parts = this.splitTopLevelArgs(mainArgs);
                    if (parts[0]) { try { cmd.filter = JSON.parse(parts[0]); } catch { cmd.filter = {}; } }
                    if (parts[1]) { try { cmd.projection = JSON.parse(parts[1]); } catch { /* ignore */ } }
                } else {
                    cmd.filter = {};
                }
                if (limit !== undefined) { cmd.limit = limit; }
                if (sort) { cmd.sort = sort; }
                return cmd;
            }
            case 'findOne': {
                const cmd: Record<string, unknown> = { find: collection, limit: 1 };
                if (mainArgs) { try { cmd.filter = JSON.parse(mainArgs); } catch { cmd.filter = {}; } }
                else { cmd.filter = {}; }
                return cmd;
            }
            case 'insertOne': {
                const doc = mainArgs ? JSON.parse(mainArgs) : {};
                return { insert: collection, documents: [doc] };
            }
            case 'insertMany': {
                const docs = mainArgs ? JSON.parse(mainArgs) : [];
                return { insert: collection, documents: docs };
            }
            case 'updateOne':
            case 'updateMany': {
                const parts = this.splitTopLevelArgs(mainArgs);
                const filter = parts[0] ? JSON.parse(parts[0]) : {};
                const update = parts[1] ? JSON.parse(parts[1]) : {};
                const multi = method === 'updateMany';
                return { update: collection, updates: [{ q: filter, u: update, multi }] };
            }
            case 'deleteOne':
            case 'deleteMany': {
                const filter = mainArgs ? JSON.parse(mainArgs) : {};
                const limitVal = method === 'deleteOne' ? 1 : 0;
                return { delete: collection, deletes: [{ q: filter, limit: limitVal }] };
            }
            case 'countDocuments':
            case 'count': {
                const filter = mainArgs ? JSON.parse(mainArgs) : {};
                return { count: collection, query: filter };
            }
            case 'aggregate': {
                const pipeline = mainArgs ? JSON.parse(mainArgs) : [];
                return { aggregate: collection, pipeline, cursor: {} };
            }
            case 'drop': {
                return { drop: collection };
            }
            default:
                throw new Error(`Unsupported MongoDB method: ${method}. Supported: find, findOne, insertOne, insertMany, updateOne, updateMany, deleteOne, deleteMany, countDocuments, aggregate, drop`);
        }
    }

    /**
     * Split arguments at top-level commas (not inside braces/brackets).
     */
    private splitTopLevelArgs(str: string): string[] {
        const parts: string[] = [];
        let depth = 0;
        let current = '';

        for (const ch of str) {
            if (ch === '{' || ch === '[') { depth++; }
            else if (ch === '}' || ch === ']') { depth--; }
            else if (ch === ',' && depth === 0) {
                parts.push(current.trim());
                current = '';
                continue;
            }
            current += ch;
        }
        if (current.trim()) { parts.push(current.trim()); }
        return parts;
    }

    async getDatabases(): Promise<string[]> {
        if (!this.client) {
            throw new Error('Not connected');
        }

        const admin = this.client.db('admin');
        const result = await admin.command({ listDatabases: 1 });
        return result.databases.map((db: { name: string }) => db.name);
    }

    async getTables(database: string): Promise<string[]> {
        if (!this.client) {
            throw new Error('Not connected');
        }

        const db = this.client.db(database);
        const collections = await db.listCollections().toArray();
        return collections.map(col => col.name);
    }

    async getTableSchema(table: string): Promise<ColumnInfo[]> {
        if (!this.db) {
            throw new Error('Not connected');
        }

        // MongoDB is schemaless, so we sample documents to infer schema
        const collection = this.db.collection(table);
        const sample = await collection.findOne();

        if (!sample) {
            return [];
        }

        return Object.entries(sample).map(([name, value]) => ({
            name,
            type: this.getMongoType(value),
            nullable: true,
            primaryKey: name === '_id',
            defaultValue: undefined
        }));
    }

    isConnected(): boolean {
        return this.client !== null;
    }

    private buildConnectionUri(): string {
        const { host, port, username, password, database, options } = this.config;
        const auth = username && password
            ? `${encodeURIComponent(username)}:${encodeURIComponent(password)}@`
            : '';

        const authSource = (options?.authSource as string) || (auth ? 'admin' : '');
        const query = authSource ? `?authSource=${encodeURIComponent(authSource)}` : '';

        return `mongodb://${auth}${host}:${port || 27017}/${database || 'admin'}${query}`;
    }

    private getMongoType(value: unknown): string {
        if (value === null) {return 'null';}
        if (Array.isArray(value)) {return 'array';}
        if (value instanceof Date) {return 'date';}
        if (typeof value === 'object' && '_bsontype' in (value as object)) {
            return (value as { _bsontype: string })._bsontype;
        }
        return typeof value;
    }
}
