import {
    ConnectionConfig,
    ExportableConnectionConfig,
    ConnectionExportEnvelope,
    ConnectionTemplate,
    DatabaseType,
} from '../types/database';

// 지원되는 DB 타입 목록
const SUPPORTED_TYPES: DatabaseType[] = ['mysql', 'postgres', 'sqlite', 'mongodb', 'redis', 'h2'];

/**
 * ConnectionConfig → ExportableConnectionConfig 변환 (비밀번호 제거)
 */
export function stripSecrets(config: ConnectionConfig): ExportableConnectionConfig {
    const exported: ExportableConnectionConfig = {
        name: config.name,
        type: config.type,
        host: config.host,
        port: config.port,
        username: config.username,
    };

    if (config.database) { exported.database = config.database; }
    if (config.group) { exported.group = config.group; }
    if (config.h2Mode) { exported.h2Mode = config.h2Mode; }
    if (config.readOnly !== undefined) { exported.readOnly = config.readOnly; }
    if (config.color) { exported.color = config.color; }
    if (config.options && Object.keys(config.options).length > 0) {
        exported.options = config.options;
    }

    // SSH — 비밀번호/키/패스프레이즈 제외
    if (config.ssh) {
        exported.ssh = {
            host: config.ssh.host,
            port: config.ssh.port,
            username: config.ssh.username,
        };
    }

    return exported;
}

/**
 * 연결 설정을 JSON 봉투 형식으로 직렬화
 */
export function exportToJson(configs: ConnectionConfig[]): string {
    const exportable = configs.map(stripSecrets);
    const envelope: ConnectionExportEnvelope = {
        dbunny: {
            version: '2.5.0',
            exportedAt: new Date().toISOString(),
            connections: exportable,
        },
    };
    return JSON.stringify(envelope, null, 2);
}

/**
 * 가져오기 데이터 유효성 검사 결과
 */
export interface ImportValidationResult {
    valid: boolean;
    connections: ExportableConnectionConfig[];
    errors: string[];
}

/**
 * JSON 문자열을 파싱하고 유효성 검사
 */
export function validateImportData(jsonString: string): ImportValidationResult {
    const errors: string[] = [];

    // JSON 파싱
    let data: unknown;
    try {
        data = JSON.parse(jsonString);
    } catch {
        return { valid: false, connections: [], errors: ['Invalid JSON format'] };
    }

    // 봉투 구조 확인
    if (!data || typeof data !== 'object') {
        return { valid: false, connections: [], errors: ['Invalid data structure'] };
    }

    const envelope = data as Record<string, unknown>;

    // dbunny 키 확인
    if (!envelope.dbunny || typeof envelope.dbunny !== 'object') {
        return { valid: false, connections: [], errors: ['Missing "dbunny" wrapper — not a DBunny export file'] };
    }

    const dbunnyData = envelope.dbunny as Record<string, unknown>;

    if (!Array.isArray(dbunnyData.connections)) {
        return { valid: false, connections: [], errors: ['Missing "connections" array'] };
    }

    const connections: ExportableConnectionConfig[] = [];

    for (let i = 0; i < dbunnyData.connections.length; i++) {
        const conn = dbunnyData.connections[i] as Record<string, unknown>;
        const connErrors = validateSingleConnection(conn, i);
        if (connErrors.length > 0) {
            errors.push(...connErrors);
        } else {
            connections.push(conn as unknown as ExportableConnectionConfig);
        }
    }

    return {
        valid: errors.length === 0 && connections.length > 0,
        connections,
        errors,
    };
}

/**
 * 단일 연결 설정 유효성 검사
 */
function validateSingleConnection(conn: Record<string, unknown>, index: number): string[] {
    const errors: string[] = [];
    const prefix = `connections[${index}]`;

    if (!conn.name || typeof conn.name !== 'string') {
        errors.push(`${prefix}: "name" is required (string)`);
    }
    if (!conn.type || typeof conn.type !== 'string' || !SUPPORTED_TYPES.includes(conn.type as DatabaseType)) {
        errors.push(`${prefix}: "type" must be one of ${SUPPORTED_TYPES.join(', ')}`);
    }
    if (!conn.host || typeof conn.host !== 'string') {
        errors.push(`${prefix}: "host" is required (string)`);
    }
    if (typeof conn.port !== 'number' || conn.port < 0 || conn.port > 65535) {
        errors.push(`${prefix}: "port" must be a number (0-65535)`);
    }
    if (conn.username === undefined || typeof conn.username !== 'string') {
        errors.push(`${prefix}: "username" is required (string)`);
    }

    return errors;
}

/**
 * ExportableConnectionConfig → 새 ConnectionConfig 변환 (ID 자동 생성)
 */
export function toConnectionConfig(
    exported: ExportableConnectionConfig,
    generateId: () => string
): ConnectionConfig {
    const config: ConnectionConfig = {
        id: generateId(),
        name: exported.name,
        type: exported.type,
        host: exported.host,
        port: exported.port,
        username: exported.username,
    };

    if (exported.database) { config.database = exported.database; }
    if (exported.group) { config.group = exported.group; }
    if (exported.h2Mode) { config.h2Mode = exported.h2Mode; }
    if (exported.readOnly !== undefined) { config.readOnly = exported.readOnly; }
    if (exported.color) { config.color = exported.color; }
    if (exported.options) { config.options = exported.options; }

    if (exported.ssh) {
        config.ssh = {
            host: exported.ssh.host,
            port: exported.ssh.port,
            username: exported.ssh.username,
        };
    }

    return config;
}

// ===== Template 관리 =====

/** 최대 템플릿 개수 */
export const MAX_TEMPLATES = 50;

/**
 * ConnectionConfig → ConnectionTemplate 변환
 */
export function createTemplate(
    config: ConnectionConfig,
    templateName: string,
    description: string | undefined,
    generateId: () => string
): ConnectionTemplate {
    return {
        id: generateId(),
        name: templateName,
        description,
        config: stripSecrets(config),
        createdAt: new Date().toISOString(),
    };
}

/**
 * 템플릿 → 새 ConnectionConfig 변환 (비밀번호 없이)
 */
export function templateToConnectionConfig(
    template: ConnectionTemplate,
    generateId: () => string
): ConnectionConfig {
    return toConnectionConfig(template.config, generateId);
}
