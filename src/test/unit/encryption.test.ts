import * as assert from 'assert';

suite('Encryption Service Unit Tests', () => {
    test('Should generate unique IDs', () => {
        const ids = new Set<string>();
        for (let i = 0; i < 100; i++) {
            ids.add(crypto.randomUUID());
        }
        assert.strictEqual(ids.size, 100);
    });

    test('ID format should be valid UUID', () => {
        const id = crypto.randomUUID();
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        assert.ok(uuidRegex.test(id));
    });
});
