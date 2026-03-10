/**
 * Query Parameter — v2.1.0 쿼리 파라미터 기능
 *
 * 기능:
 * - {{변수명}} 플레이스홀더 추출
 * - 변수 값 치환
 * - 연결별 변수 세트 저장/재사용
 * - 환경별(dev/staging/prod) 변수 프로필
 */

/** 변수 세트: 이름-값 쌍 */
export interface VariableSet {
    /** 변수 세트 이름 (예: "기본 변수") */
    name: string;
    /** 변수 이름 → 값 매핑 */
    variables: Record<string, string>;
}

/** 환경 프로필: 특정 환경(dev/staging/prod)의 변수 세트 */
export interface EnvironmentProfile {
    /** 프로필 이름 (예: "dev", "staging", "prod") */
    name: string;
    /** 변수 이름 → 값 매핑 */
    variables: Record<string, string>;
}

/** 연결별 저장 데이터 */
export interface ConnectionVariableData {
    /** 변수 세트 목록 */
    variableSets: VariableSet[];
    /** 환경 프로필 목록 */
    profiles: EnvironmentProfile[];
    /** 마지막으로 사용한 변수 세트 이름 */
    lastUsedSet?: string;
    /** 마지막으로 사용한 환경 프로필 이름 */
    lastUsedProfile?: string;
}

/** 파라미터 추출 결과 */
export interface ExtractedParameter {
    /** 변수 이름 (중괄호 제외) */
    name: string;
    /** 원본 매치 문자열 (예: "{{user_id}}") */
    match: string;
    /** 쿼리 내 시작 인덱스 */
    startIndex: number;
    /** 쿼리 내 끝 인덱스 */
    endIndex: number;
}

// {{변수명}} 패턴 — 공백 허용, 중첩 불허
const PARAM_REGEX = /\{\{\s*([a-zA-Z_\u3131-\u318E\uAC00-\uD7A3][a-zA-Z0-9_\u3131-\u318E\uAC00-\uD7A3]*)\s*\}\}/g;

/**
 * 쿼리에서 {{변수명}} 플레이스홀더를 추출
 * 문자열 리터럴(따옴표) 내부의 플레이스홀더는 무시
 */
export function extractParameters(query: string): ExtractedParameter[] {
    const results: ExtractedParameter[] = [];
    const seen = new Set<string>();

    // 문자열 리터럴 영역 계산 (따옴표 내부 무시)
    const stringRanges = getStringLiteralRanges(query);

    let match: RegExpExecArray | null;
    const regex = new RegExp(PARAM_REGEX.source, 'g');

    while ((match = regex.exec(query)) !== null) {
        const startIndex = match.index;
        const endIndex = startIndex + match[0].length;

        // 문자열 리터럴 내부면 무시
        if (isInsideStringLiteral(startIndex, stringRanges)) {
            continue;
        }

        const name = match[1].trim();
        if (!seen.has(name)) {
            seen.add(name);
            results.push({
                name,
                match: match[0],
                startIndex,
                endIndex
            });
        }
    }

    return results;
}

/**
 * 쿼리에 파라미터({{변수명}})가 포함되어 있는지 확인
 */
export function hasParameters(query: string): boolean {
    const stringRanges = getStringLiteralRanges(query);
    const regex = new RegExp(PARAM_REGEX.source, 'g');
    let match: RegExpExecArray | null;

    while ((match = regex.exec(query)) !== null) {
        if (!isInsideStringLiteral(match.index, stringRanges)) {
            return true;
        }
    }
    return false;
}

/**
 * 쿼리의 {{변수명}}을 실제 값으로 치환
 * 문자열 리터럴 내부의 플레이스홀더는 치환하지 않음
 */
export function substituteParameters(
    query: string,
    values: Record<string, string>
): string {
    const stringRanges = getStringLiteralRanges(query);

    return query.replace(
        new RegExp(PARAM_REGEX.source, 'g'),
        (fullMatch, varName, offset) => {
            // 문자열 리터럴 내부면 원본 유지
            if (isInsideStringLiteral(offset, stringRanges)) {
                return fullMatch;
            }
            const name = varName.trim();
            return name in values ? values[name] : fullMatch;
        }
    );
}

/**
 * 고유한 파라미터 이름 목록 추출 (순서 보존)
 */
export function getUniqueParameterNames(query: string): string[] {
    return extractParameters(query).map(p => p.name);
}

/**
 * 기본 환경 프로필 3개 생성
 */
export function createDefaultProfiles(): EnvironmentProfile[] {
    return [
        { name: 'dev', variables: {} },
        { name: 'staging', variables: {} },
        { name: 'prod', variables: {} }
    ];
}

/**
 * 빈 연결별 변수 데이터 생성
 */
export function createEmptyConnectionData(): ConnectionVariableData {
    return {
        variableSets: [],
        profiles: createDefaultProfiles()
    };
}

// ===== 내부 유틸리티 =====

/** 문자열 리터럴 범위 (시작, 끝 인덱스) */
interface StringRange {
    start: number;
    end: number;
}

/**
 * SQL 문자열 리터럴 범위를 계산 (작은따옴표, 큰따옴표)
 * 이스케이프된 따옴표('', \') 처리
 */
function getStringLiteralRanges(query: string): StringRange[] {
    const ranges: StringRange[] = [];
    let i = 0;

    while (i < query.length) {
        const ch = query[i];

        if (ch === "'" || ch === '"') {
            const quote = ch;
            const start = i;
            i++;

            while (i < query.length) {
                if (query[i] === '\\') {
                    // 백슬래시 이스케이프 — 다음 문자 건너뛰기
                    i += 2;
                    continue;
                }
                if (query[i] === quote) {
                    // 연속 따옴표 이스케이프 ('' or "")
                    if (i + 1 < query.length && query[i + 1] === quote) {
                        i += 2;
                        continue;
                    }
                    break;
                }
                i++;
            }

            ranges.push({ start, end: i });
            i++;
        } else if (ch === '-' && i + 1 < query.length && query[i + 1] === '-') {
            // 한줄 주석 — 줄 끝까지 건너뛰기
            const start = i;
            while (i < query.length && query[i] !== '\n') {
                i++;
            }
            ranges.push({ start, end: i });
        } else if (ch === '/' && i + 1 < query.length && query[i + 1] === '*') {
            // 블록 주석 — */ 까지 건너뛰기
            const start = i;
            i += 2;
            while (i < query.length) {
                if (query[i] === '*' && i + 1 < query.length && query[i + 1] === '/') {
                    i += 2;
                    break;
                }
                i++;
            }
            ranges.push({ start, end: i });
        } else {
            i++;
        }
    }

    return ranges;
}

/**
 * 주어진 인덱스가 문자열 리터럴 내부인지 확인
 */
function isInsideStringLiteral(index: number, ranges: StringRange[]): boolean {
    return ranges.some(r => index > r.start && index < r.end);
}
