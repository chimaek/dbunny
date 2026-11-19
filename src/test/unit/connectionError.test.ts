import * as assert from 'assert';
import { classifyConnectionError } from '../../utils/connectionError';

suite('Connection error classification', () => {
    test('classifies structured driver codes even if the description is localized', () => {
        assert.strictEqual(classifyConnectionError({ code: '28P01', message: '로그인 실패' }), 'authentication');
        assert.strictEqual(classifyConnectionError({ code: 'ER_ACCESS_DENIED_ERROR' }), 'authentication');
        assert.strictEqual(classifyConnectionError({ code: 18 }), 'authentication');
        assert.strictEqual(classifyConnectionError({ code: 'ERR_SOCKET_BAD_PORT' }), 'address');
        assert.strictEqual(classifyConnectionError({ code: 'ETIMEDOUT' }), 'timeout');
    });

    test('classifies authentication failures wrapped by providers', () => {
        assert.strictEqual(classifyConnectionError(new Error("Failed to connect to PostgreSQL: password authentication failed for user 'fixture'")), 'authentication');
        assert.strictEqual(classifyConnectionError(new Error('Failed to connect to Redis: WRONGPASS invalid username-password pair')), 'authentication');
    });

    test('separates endpoint and timeout failures in provider errors', () => {
        assert.strictEqual(classifyConnectionError(new Error('Failed to connect to MongoDB: getaddrinfo ENOTFOUND db.invalid')), 'address');
        assert.strictEqual(classifyConnectionError(new Error('Failed to connect to MySQL: connect ECONNREFUSED 127.0.0.1:1')), 'address');
        assert.strictEqual(classifyConnectionError(new Error('Failed to connect to PostgreSQL: timeout expired')), 'timeout');
        assert.strictEqual(classifyConnectionError({ name: 'ConnectionTimeoutError' }), 'timeout');
    });

    test('keeps SSH failures distinct from the underlying network failure', () => {
        assert.strictEqual(classifyConnectionError(new Error('Failed to connect to MySQL: SSH connection failed: connect ECONNREFUSED 127.0.0.1:1')), 'ssh');
        assert.strictEqual(classifyConnectionError({ level: 'client-authentication', code: '28P01' }), 'ssh');
    });

    test('returns only a fixed category even when the input contains credentials', () => {
        const fixture = 'local-test-value';
        const error = new Error(`Failed to connect to MongoDB: Authentication failed for mongodb://fixture:${fixture}@db.invalid/demo`);
        assert.strictEqual(classifyConnectionError(error), 'authentication');
        assert.strictEqual(classifyConnectionError(`mongodb://fixture:${fixture}@db.invalid/db?note=ECONNREFUSED`), 'unknown');
    });

    test('leaves unfamiliar or invalid inputs unclassified', () => {
        assert.strictEqual(classifyConnectionError(new Error('certificate has expired')), 'unknown');
        assert.strictEqual(classifyConnectionError(new Error('Column named timeout expired is not available')), 'unknown');
        assert.strictEqual(classifyConnectionError(null), 'unknown');
        assert.strictEqual(classifyConnectionError({ code: { value: '28P01' }, message: 12 }), 'unknown');
    });
});
