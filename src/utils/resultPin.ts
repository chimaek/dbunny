/**
 * 쿼리 결과 고정(Pinning) 유틸리티
 *
 * v2.2.0 — 쿼리 실행 결과를 고정하여 보관하고 비교할 수 있는 기능을 제공합니다.
 */

/** 고정된 쿼리 결과 */
export interface PinnedResult {
    /** 고유 ID */
    id: string;
    /** 실행한 쿼리 */
    query: string;
    /** 컬럼 이름 목록 */
    columns: string[];
    /** 결과 행 데이터 */
    rows: Record<string, unknown>[];
    /** 총 행 수 */
    rowCount: number;
    /** 실행 시간 (ms) */
    executionTime: number;
    /** 실행 시각 (ISO 문자열) */
    executedAt: string;
    /** 사용자 지정 라벨 */
    label?: string;
    /** 연결 이름 */
    connectionName: string;
    /** 데이터베이스 이름 */
    databaseName: string | null;
}

/** 결과 비교 뷰 모드 */
export type CompareMode = 'single' | 'side-by-side';

/** 탭별 핀 상태 */
export interface TabPinState {
    /** 고정된 결과 목록 */
    pinnedResults: PinnedResult[];
    /** 현재 선택된 핀 결과 ID (null이면 최신 결과 표시) */
    activeResultId: string | null;
    /** 비교 모드 */
    compareMode: CompareMode;
    /** 비교 대상 핀 결과 ID */
    compareTargetId: string | null;
}

/** 최대 핀 개수 (메모리 보호) */
export const MAX_PINNED_RESULTS = 20;

/** 고유 핀 ID 생성 */
export function generatePinId(): string {
    return `pin-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
}

/** 기본 핀 상태 생성 */
export function createDefaultTabPinState(): TabPinState {
    return {
        pinnedResults: [],
        activeResultId: null,
        compareMode: 'single',
        compareTargetId: null
    };
}

/** 결과를 핀으로 고정 */
export function pinResult(
    state: TabPinState,
    result: Omit<PinnedResult, 'id'>
): TabPinState {
    const pinned: PinnedResult = {
        ...result,
        id: generatePinId()
    };

    const pinnedResults = [pinned, ...state.pinnedResults];

    // 최대 개수 초과 시 오래된 항목 제거
    if (pinnedResults.length > MAX_PINNED_RESULTS) {
        pinnedResults.splice(MAX_PINNED_RESULTS);
    }

    return {
        ...state,
        pinnedResults
    };
}

/** 핀 해제 (삭제) */
export function unpinResult(state: TabPinState, pinId: string): TabPinState {
    const pinnedResults = state.pinnedResults.filter(p => p.id !== pinId);

    // 삭제된 핀이 현재 활성이었다면 초기화
    let activeResultId = state.activeResultId;
    let compareTargetId = state.compareTargetId;
    let compareMode = state.compareMode;

    if (activeResultId === pinId) {
        activeResultId = null;
    }
    if (compareTargetId === pinId) {
        compareTargetId = null;
        compareMode = 'single';
    }

    return { pinnedResults, activeResultId, compareMode, compareTargetId };
}

/** 핀 라벨 변경 */
export function renamePinLabel(state: TabPinState, pinId: string, label: string): TabPinState {
    const pinnedResults = state.pinnedResults.map(p =>
        p.id === pinId ? { ...p, label } : p
    );
    return { ...state, pinnedResults };
}

/** 핀 결과 선택 */
export function selectPinnedResult(state: TabPinState, pinId: string | null): TabPinState {
    return { ...state, activeResultId: pinId };
}

/** 비교 모드 토글 */
export function toggleCompareMode(state: TabPinState, targetId: string | null): TabPinState {
    if (state.compareMode === 'side-by-side' && targetId === null) {
        return { ...state, compareMode: 'single', compareTargetId: null };
    }
    return { ...state, compareMode: 'side-by-side', compareTargetId: targetId };
}

/** 타임스탬프를 읽기 쉬운 형식으로 변환 */
export function formatTimestamp(isoString: string): string {
    const date = new Date(isoString);
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const seconds = date.getSeconds().toString().padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
}

/** 핀 결과의 표시 이름 생성 */
export function getPinDisplayName(pin: PinnedResult): string {
    if (pin.label) {
        return pin.label;
    }
    const time = formatTimestamp(pin.executedAt);
    const queryPreview = pin.query.trim().substring(0, 30).replace(/\n/g, ' ');
    return `${time} — ${queryPreview}${pin.query.length > 30 ? '...' : ''}`;
}

/** 모든 핀 결과 삭제 */
export function clearAllPins(state: TabPinState): TabPinState {
    return createDefaultTabPinState();
}
