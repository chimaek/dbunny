import * as assert from 'assert';
import * as net from 'net';
import { generateKeyPairSync } from 'crypto';
import { Server, Connection } from 'ssh2';
import { PostgresProvider } from '../../providers/postgresProvider';
import { testPort } from './testConfig';

/** 실제 SSH 채널을 거쳐 서로 다른 PostgreSQL DB와 메타데이터를 조회한다. */
async function main() {
    const key = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs1', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
    const server = new Server({ hostKeys: [key.privateKey] });
    const clients = new Set<Connection>();
    const sockets = new Set<net.Socket>();
    let forwarded = 0;
    server.on('connection', client => {
        clients.add(client);
        client.once('close', () => clients.delete(client));
        client.on('error', () => undefined);
        client.on('authentication', context => {
            if (context.method === 'password' && context.password === 'test-tunnel') { context.accept(); }
            else { context.reject(); }
        });
        client.on('ready', () => client.on('tcpip', (accept, reject, info) => {
            assert.strictEqual(info.destIP, 'only-inside-tunnel.invalid');
            const upstream = net.connect(testPort('postgres'), '127.0.0.1');
            sockets.add(upstream);
            upstream.once('close', () => sockets.delete(upstream));
            upstream.once('error', () => reject());
            upstream.once('connect', () => {
                forwarded++;
                const stream = accept();
                stream.pipe(upstream).pipe(stream);
                stream.on('close', () => upstream.destroy());
                upstream.on('error', () => stream.destroy());
            });
        }));
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as net.AddressInfo).port;
    const provider = new PostgresProvider({ id: 'ssh-test', name: 'SSH test', type: 'postgres', host: 'only-inside-tunnel.invalid', port: testPort('postgres'), username: 'postgres', password: 'postgres1234', database: 'mydb', ssh: { host: '127.0.0.1', port, username: 'test', password: 'test-tunnel' } });
    try {
        await provider.connect();
        assert.strictEqual((await provider.executeQuery('SELECT current_database() AS db', 'postgres')).rows[0].db, 'postgres');
        await provider.getTableSchema('no_such_table', 'postgres');
        assert.ok(forwarded >= 3, 'Initial and both temporary connection paths use SSH forwarding');
        console.log('PASS SSH: initial connection, database switching and parameterized metadata all use the real tunnel');
    } finally {
        await provider.disconnect();
        for (const socket of sockets) { socket.destroy(); }
        for (const client of clients) { client.end(); }
        await new Promise<void>(resolve => server.close(() => resolve()));
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
