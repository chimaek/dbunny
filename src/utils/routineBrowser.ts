import { RoutineType, RoutineParameter } from '../types/database';

/**
 * 파라미터 파싱 — MySQL/PostgreSQL 파라미터 문자열에서 RoutineParameter[] 추출
 */
export function parseRoutineParams(source: string, dbType: string): RoutineParameter[] {
    const params: RoutineParameter[] = [];
    if (!source) { return params; }

    if (dbType === 'mysql') {
        // MySQL: IN p_id INT, OUT p_name VARCHAR(255)
        const paramRegex = /\b(IN|OUT|INOUT)\s+(\w+)\s+(\w+(?:\(\d+(?:\s*,\s*\d+)*\))?)/gi;
        let idx = 0;
        let match: RegExpExecArray | null;
        while ((match = paramRegex.exec(source)) !== null) {
            params.push({
                name: match[2],
                dataType: match[3],
                mode: match[1].toUpperCase() as 'IN' | 'OUT' | 'INOUT',
                ordinalPosition: idx++,
            });
        }
    } else if (dbType === 'postgres') {
        // PostgreSQL: p_id INT, p_name TEXT, INOUT p_result INT
        const match = source.match(/\(([\s\S]*?)\)\s*(?:RETURNS|AS|LANGUAGE)/i);
        if (match?.[1]) {
            const parts = match[1].split(',').map(p => p.trim()).filter(Boolean);
            parts.forEach((part, idx) => {
                let mode: 'IN' | 'OUT' | 'INOUT' = 'IN';
                let remaining = part;
                if (/^IN\s/i.test(remaining)) { remaining = remaining.replace(/^IN\s+/i, ''); }
                else if (/^OUT\s/i.test(remaining)) { mode = 'OUT'; remaining = remaining.replace(/^OUT\s+/i, ''); }
                else if (/^INOUT\s/i.test(remaining)) { mode = 'INOUT'; remaining = remaining.replace(/^INOUT\s+/i, ''); }
                const segs = remaining.split(/\s+/);
                if (segs.length >= 2) {
                    params.push({ name: segs[0], dataType: segs.slice(1).join(' '), mode, ordinalPosition: idx });
                }
            });
        }
    }
    return params;
}

/**
 * DROP SQL 생성 — DB별 올바른 DROP 문법
 */
export function generateDropSQL(name: string, type: RoutineType, dbType: string): string {
    switch (type) {
        case 'procedure':
            return dbType === 'postgres' ? `DROP PROCEDURE IF EXISTS ${name}` : `DROP PROCEDURE IF EXISTS \`${name}\``;
        case 'function':
            return dbType === 'postgres' ? `DROP FUNCTION IF EXISTS ${name}` : `DROP FUNCTION IF EXISTS \`${name}\``;
        case 'view':
            if (dbType === 'mysql') { return `DROP VIEW IF EXISTS \`${name}\``; }
            if (dbType === 'h2') { return `DROP VIEW IF EXISTS "${name}"`; }
            return `DROP VIEW IF EXISTS ${name}`;
        case 'trigger':
            if (dbType === 'mysql') { return `DROP TRIGGER IF EXISTS \`${name}\``; }
            if (dbType === 'h2') { return `DROP TRIGGER IF EXISTS "${name}"`; }
            return `DROP TRIGGER IF EXISTS ${name}`;
    }
}

/**
 * 소스코드를 HTML 키워드 강조하여 wrapping
 */
export function formatRoutineSource(source: string, _dbType: string): string {
    if (!source) { return '<pre><code></code></pre>'; }
    const escaped = source
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    const keywords = /\b(CREATE|PROCEDURE|FUNCTION|VIEW|TRIGGER|SELECT|FROM|WHERE|INSERT|UPDATE|DELETE|DROP|ALTER|BEGIN|END|DECLARE|SET|RETURNS|RETURN|LANGUAGE|AS|IN|OUT|INOUT|IF|ELSE|THEN|LOOP|CALL|EXECUTE|OR|REPLACE|DEFINER|SQL|SECURITY|INVOKER|DETERMINISTIC|CONTAINS|READS|MODIFIES|NO|TABLE|INTO|VALUES|JOIN|LEFT|RIGHT|INNER|ON|GROUP|BY|ORDER|HAVING|LIMIT|OFFSET|UNION|ALL|DISTINCT|CASE|WHEN|AND|NOT|NULL|IS|LIKE|BETWEEN|EXISTS|EXCEPT|INTERSECT|PRIMARY|KEY|FOREIGN|REFERENCES|INDEX|UNIQUE|CHECK|CONSTRAINT|DEFAULT|AUTO_INCREMENT|CASCADE)\b/gi;
    const highlighted = escaped.replace(keywords, '<span class="kw">$1</span>');
    return `<pre><code>${highlighted}</code></pre>`;
}

/**
 * 루틴 타입별 VS Code 아이콘
 */
export function getRoutineIconId(type: RoutineType): string {
    switch (type) {
        case 'procedure': return 'symbol-method';
        case 'function': return 'symbol-function';
        case 'view': return 'eye';
        case 'trigger': return 'zap';
    }
}

/**
 * 루틴 타입별 짧은 배지 라벨
 */
export function getRoutineBadge(type: RoutineType): string {
    switch (type) {
        case 'procedure': return 'P';
        case 'function': return 'F';
        case 'view': return 'V';
        case 'trigger': return 'T';
    }
}

/**
 * DB가 루틴 브라우저를 지원하는지 확인
 */
export function supportsRoutines(dbType: string): boolean {
    return ['mysql', 'postgres', 'sqlite', 'h2'].includes(dbType);
}
