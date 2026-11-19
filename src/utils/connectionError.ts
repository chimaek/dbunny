/** 원본 오류와 독립적으로 화면이나 로그에 전달할 수 있는 고정 분류값. */
export type ConnectionErrorKind = 'authentication' | 'address' | 'timeout' | 'ssh' | 'unknown';

const codeKinds = new Map<string | number, ConnectionErrorKind>([
    ['28P01', 'authentication'],
    ['28000', 'authentication'],
    ['ER_ACCESS_DENIED_ERROR', 'authentication'],
    [18, 'authentication'], // MongoDB AuthenticationFailed
    ['NOAUTH', 'authentication'],
    ['WRONGPASS', 'authentication'],
    ['ENOTFOUND', 'address'],
    ['EAI_AGAIN', 'address'],
    ['ECONNREFUSED', 'address'],
    ['EHOSTUNREACH', 'address'],
    ['ENETUNREACH', 'address'],
    ['ERR_SOCKET_BAD_PORT', 'address'],
    ['ETIMEDOUT', 'timeout'],
    ['ESOCKETTIMEDOUT', 'timeout'],
    ['ERR_SOCKET_CONNECTION_TIMEOUT', 'timeout'],
    ['PROTOCOL_SEQUENCE_TIMEOUT', 'timeout']
]);

// 일부 provider가 드라이버 오류를 새 Error로 감싸므로, 알려진 메시지 접두사도 확인한다.
const messageKinds: readonly [ConnectionErrorKind, RegExp][] = [
    ['ssh', /^(?:SSH (?:connection|tunnel)|All configured authentication methods failed\b|Timed out while waiting for handshake\b)/i],
    ['authentication', /^(?:Access denied for user\b|password authentication failed\b|authentication failed\b|wrong user name or password\b|(?:NOAUTH|WRONGPASS)\b)/i],
    ['timeout', /^(?:connect\s+)?(?:ETIMEDOUT|ESOCKETTIMEDOUT|ERR_SOCKET_CONNECTION_TIMEOUT|timeout expired|connection timeout|connection timed out)\b/i],
    ['address', /^(?:(?:connect|getaddrinfo)\s+)?(?:ENOTFOUND|EAI_AGAIN|ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|ERR_SOCKET_BAD_PORT)\b/i]
];

/** 연결 실패 원인만 반환한다. 메시지·주소·자격증명은 반환하거나 기록하지 않는다. */
export function classifyConnectionError(error: unknown): ConnectionErrorKind {
    const details = typeof error === 'object' && error !== null
        ? error as { code?: unknown; level?: unknown; message?: unknown; name?: unknown }
        : undefined;
    if (typeof details?.level === 'string' && /^client-(?:ssh|authentication|timeout|socket)$/.test(details.level)) {
        return 'ssh';
    }

    const rawMessage = typeof error === 'string' ? error : details?.message;
    const message = typeof rawMessage === 'string'
        ? rawMessage.slice(0, 1024).trimStart().replace(/^Failed to connect to (?:MySQL|PostgreSQL|MongoDB|Redis|H2|SQLite):\s*/i, '')
        : '';
    // SSH 터널 단계의 실패는 내부의 주소·인증·타임아웃과 구분한다.
    const [sshKind, sshMessage] = messageKinds[0];
    if (sshMessage.test(message)) { return sshKind; }

    const code = details?.code;
    if (typeof code === 'string' || typeof code === 'number') {
        const kind = codeKinds.get(code);
        if (kind) { return kind; }
    }

    for (const [kind, pattern] of messageKinds.slice(1)) {
        if (pattern.test(message)) { return kind; }
    }
    if (details?.name === 'ConnectionTimeoutError' || details?.name === 'MongoNetworkTimeoutError') {
        return 'timeout';
    }
    return 'unknown';
}
