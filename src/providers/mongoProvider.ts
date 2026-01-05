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

    async executeQuery(query: string): Promise<QueryResult> {
        if (!this.db) {
            throw new Error('Not connected to database');
        }

        try {
            const startTime = Date.now();

            // Parse the query as JSON command
            const command = JSON.parse(query);
            const result = await this.db.command(command);
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
        const { host, port, username, password, database } = this.config;
        const auth = username && password
            ? `${encodeURIComponent(username)}:${encodeURIComponent(password)}@`
            : '';

        return `mongodb://${auth}${host}:${port || 27017}/${database || 'admin'}`;
    }

    private getMongoType(value: unknown): string {
        if (value === null) return 'null';
        if (Array.isArray(value)) return 'array';
        if (value instanceof Date) return 'date';
        if (typeof value === 'object' && '_bsontype' in (value as object)) {
            return (value as { _bsontype: string })._bsontype;
        }
        return typeof value;
    }
}
