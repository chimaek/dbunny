/** Compose와 공유하는 전용 테스트 포트. 사용자 DB의 기본 포트로 연결하지 않는다. */
const ports = { mysql: 23306, postgres: 25432, mongodb: 27027, redis: 26379, h2: 25435 };
export function testPort(type: keyof typeof ports): number {
    const value = Number(process.env[`DBUNNY_TEST_${type.toUpperCase()}_PORT`] || ports[type]);
    if (!Number.isInteger(value) || value < 1 || value > 65535) { throw new Error(`Invalid test port: ${type}`); }
    return value;
}
