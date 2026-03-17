/**
 * 연결별 컬러 코딩 유닛 테스트
 * 실행: npx tsx src/test/unit/connectionColor.standalone.ts
 */
import assert from 'assert';
import {
    ConnectionColor,
    CONNECTION_COLOR_PRESETS,
    ConnectionConfig,
} from '../../types/database';

// ── Helpers ──────────────────────────────────────────────

let totalPass = 0;
let totalFail = 0;

function pass(name: string): void {
    totalPass++;
    console.log(`  ✅ ${name}`);
}

function fail(name: string, err: unknown): void {
    totalFail++;
    console.error(`  ❌ ${name}: ${err}`);
}

function section(name: string): void {
    console.log(`\n── ${name} ──`);
}

// ── 1. CONNECTION_COLOR_PRESETS 구조 검증 ──

section('프리셋 컬러 기본 구조');

try {
    assert(Array.isArray(CONNECTION_COLOR_PRESETS), '배열이어야 함');
    pass('CONNECTION_COLOR_PRESETS는 배열');
} catch (e) { fail('배열 검증', e); }

try {
    assert(CONNECTION_COLOR_PRESETS.length === 8, `8개 프리셋 기대, 실제: ${CONNECTION_COLOR_PRESETS.length}`);
    pass('프리셋 8개');
} catch (e) { fail('프리셋 개수', e); }

try {
    const ids = CONNECTION_COLOR_PRESETS.map(c => c.id);
    const expected = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'gray'];
    assert.deepStrictEqual(ids, expected, `ID 목록 불일치`);
    pass('프리셋 ID 순서: red→orange→yellow→green→blue→purple→pink→gray');
} catch (e) { fail('프리셋 ID 순서', e); }

// ── 2. 프리셋 컬러 필드 검증 ──

section('프리셋 컬러 필드 유효성');

for (const preset of CONNECTION_COLOR_PRESETS) {
    try {
        assert(typeof preset.id === 'string' && preset.id.length > 0, 'id 비어있음');
        assert(typeof preset.hex === 'string' && /^#[0-9A-Fa-f]{6}$/.test(preset.hex), `유효하지 않은 hex: ${preset.hex}`);
        assert(typeof preset.label === 'string' && preset.label.length > 0, 'label 비어있음');
        assert(typeof preset.labelEn === 'string' && preset.labelEn.length > 0, 'labelEn 비어있음');
        pass(`프리셋 ${preset.id}: hex=${preset.hex}, label=${preset.label}`);
    } catch (e) { fail(`프리셋 ${preset.id} 필드`, e); }
}

// ── 3. 프리셋 ID 유니크 검증 ──

section('프리셋 ID 유니크');

try {
    const ids = CONNECTION_COLOR_PRESETS.map(c => c.id);
    const uniqueIds = new Set(ids);
    assert(ids.length === uniqueIds.size, '중복 ID 존재');
    pass('모든 프리셋 ID 고유');
} catch (e) { fail('ID 유니크', e); }

// ── 4. hex 값 유니크 검증 ──

section('프리셋 hex 유니크');

try {
    const hexes = CONNECTION_COLOR_PRESETS.map(c => c.hex);
    const uniqueHexes = new Set(hexes);
    assert(hexes.length === uniqueHexes.size, '중복 hex 존재');
    pass('모든 프리셋 hex 고유');
} catch (e) { fail('hex 유니크', e); }

// ── 5. ConnectionColor 인터페이스 사용 ──

section('ConnectionColor 인터페이스');

try {
    const color: ConnectionColor = { id: 'red', hex: '#E74C3C' };
    assert(color.id === 'red', 'id');
    assert(color.hex === '#E74C3C', 'hex');
    assert(color.label === undefined, 'label은 optional');
    pass('라벨 없는 ConnectionColor');
} catch (e) { fail('라벨 없는 ConnectionColor', e); }

try {
    const color: ConnectionColor = { id: 'green', hex: '#27AE60', label: '개발' };
    assert(color.label === '개발', 'label');
    pass('라벨 있는 ConnectionColor');
} catch (e) { fail('라벨 있는 ConnectionColor', e); }

try {
    const color: ConnectionColor = { id: 'custom', hex: '#FF00FF', label: 'Custom Color' };
    assert(color.id === 'custom', '커스텀 id');
    pass('커스텀 색상 ID 허용');
} catch (e) { fail('커스텀 색상', e); }

// ── 6. ConnectionConfig에 color 필드 통합 ──

section('ConnectionConfig + color 필드');

try {
    const config: ConnectionConfig = {
        id: 'test-1',
        name: 'Production DB',
        type: 'postgres',
        host: 'prod.example.com',
        port: 5432,
        username: 'admin',
        color: { id: 'red', hex: '#E74C3C', label: '운영' }
    };
    assert(config.color?.id === 'red', 'color.id');
    assert(config.color?.hex === '#E74C3C', 'color.hex');
    assert(config.color?.label === '운영', 'color.label');
    pass('ConnectionConfig에 color 포함');
} catch (e) { fail('config + color', e); }

try {
    const config: ConnectionConfig = {
        id: 'test-2',
        name: 'Local DB',
        type: 'mysql',
        host: 'localhost',
        port: 3306,
        username: 'root',
    };
    assert(config.color === undefined, 'color 미지정');
    pass('color 없는 ConnectionConfig (하위 호환)');
} catch (e) { fail('config without color', e); }

try {
    const config: ConnectionConfig = {
        id: 'test-3',
        name: 'Staging DB',
        type: 'postgres',
        host: 'staging.example.com',
        port: 5432,
        username: 'admin',
        readOnly: true,
        color: { id: 'orange', hex: '#E67E22', label: '스테이징' }
    };
    assert(config.readOnly === true, 'readOnly');
    assert(config.color?.id === 'orange', 'color.id');
    pass('readOnly + color 동시 설정');
} catch (e) { fail('readOnly + color 동시', e); }

// ── 7. 프리셋에서 환경별 색상 조회 ──

section('환경별 프리셋 조회');

try {
    const prod = CONNECTION_COLOR_PRESETS.find(c => c.id === 'red');
    assert(prod !== undefined, 'red 존재');
    assert(prod!.label.includes('운영'), '운영 라벨');
    assert(prod!.labelEn.includes('Production'), 'Production 라벨');
    pass('운영 환경 = red');
} catch (e) { fail('운영 프리셋', e); }

try {
    const dev = CONNECTION_COLOR_PRESETS.find(c => c.id === 'green');
    assert(dev !== undefined, 'green 존재');
    assert(dev!.label.includes('개발'), '개발 라벨');
    pass('개발 환경 = green');
} catch (e) { fail('개발 프리셋', e); }

try {
    const staging = CONNECTION_COLOR_PRESETS.find(c => c.id === 'orange');
    assert(staging !== undefined, 'orange 존재');
    assert(staging!.label.includes('스테이징'), '스테이징 라벨');
    pass('스테이징 환경 = orange');
} catch (e) { fail('스테이징 프리셋', e); }

try {
    const local = CONNECTION_COLOR_PRESETS.find(c => c.id === 'blue');
    assert(local !== undefined, 'blue 존재');
    assert(local!.label.includes('로컬'), '로컬 라벨');
    pass('로컬 환경 = blue');
} catch (e) { fail('로컬 프리셋', e); }

// ── 8. 컬러 기반 운영 환경 감지 ──

section('운영 환경 감지 로직');

function isProductionColor(color?: ConnectionColor): boolean {
    return color?.id === 'red';
}

try {
    assert(isProductionColor({ id: 'red', hex: '#E74C3C' }) === true, 'red=운영');
    pass('red는 운영 환경');
} catch (e) { fail('red 감지', e); }

try {
    assert(isProductionColor({ id: 'green', hex: '#27AE60' }) === false, 'green≠운영');
    pass('green은 운영 아님');
} catch (e) { fail('green 감지', e); }

try {
    assert(isProductionColor(undefined) === false, 'undefined≠운영');
    pass('color 없으면 운영 아님');
} catch (e) { fail('undefined 감지', e); }

try {
    assert(isProductionColor({ id: 'orange', hex: '#E67E22' }) === false, 'orange≠운영');
    pass('orange는 운영 아님');
} catch (e) { fail('orange 감지', e); }

// ── 9. 컬러 맵 생성 로직 (WebView에서 사용) ──

section('컬러 맵 생성');

function buildColorMap(connections: { id: string; color: ConnectionColor | null }[]): Record<string, ConnectionColor> {
    return Object.fromEntries(
        connections.filter(c => c.color).map(c => [c.id, c.color!])
    );
}

try {
    const map = buildColorMap([
        { id: 'conn-1', color: { id: 'red', hex: '#E74C3C' } },
        { id: 'conn-2', color: null },
        { id: 'conn-3', color: { id: 'green', hex: '#27AE60', label: '개발' } },
    ]);
    assert(Object.keys(map).length === 2, '2개만 포함');
    assert(map['conn-1'].id === 'red', 'conn-1 red');
    assert(map['conn-3'].label === '개발', 'conn-3 label');
    assert(!('conn-2' in map), 'null 연결 제외');
    pass('컬러 맵 필터링');
} catch (e) { fail('컬러 맵', e); }

try {
    const map = buildColorMap([]);
    assert(Object.keys(map).length === 0, '빈 맵');
    pass('빈 연결 목록 → 빈 맵');
} catch (e) { fail('빈 맵', e); }

try {
    const map = buildColorMap([
        { id: 'a', color: null },
        { id: 'b', color: null },
    ]);
    assert(Object.keys(map).length === 0, '모두 null → 빈 맵');
    pass('모든 연결 color 없음 → 빈 맵');
} catch (e) { fail('모두 null', e); }

// ── 10. 아이콘 색상 매핑 (트리뷰 로직) ──

section('트리뷰 아이콘 색상 매핑');

const iconColorMap: Record<string, string> = {
    red: 'charts.red',
    orange: 'charts.orange',
    yellow: 'charts.yellow',
    green: 'charts.green',
    blue: 'charts.blue',
    purple: 'charts.purple',
    pink: 'charts.pink',
    gray: 'descriptionForeground',
};

function getIconColor(color?: ConnectionColor, readOnly?: boolean): string {
    if (color) {
        return iconColorMap[color.id] || (readOnly ? 'charts.yellow' : 'charts.green');
    }
    return readOnly ? 'charts.yellow' : 'charts.green';
}

try {
    assert(getIconColor({ id: 'red', hex: '#E74C3C' }) === 'charts.red', 'red→charts.red');
    pass('red → charts.red');
} catch (e) { fail('red 매핑', e); }

try {
    assert(getIconColor({ id: 'blue', hex: '#3498DB' }) === 'charts.blue', 'blue→charts.blue');
    pass('blue → charts.blue');
} catch (e) { fail('blue 매핑', e); }

try {
    assert(getIconColor({ id: 'gray', hex: '#95A5A6' }) === 'descriptionForeground', 'gray→descriptionForeground');
    pass('gray → descriptionForeground');
} catch (e) { fail('gray 매핑', e); }

try {
    assert(getIconColor(undefined, false) === 'charts.green', '기본=green');
    pass('color 없음 → charts.green');
} catch (e) { fail('기본 green', e); }

try {
    assert(getIconColor(undefined, true) === 'charts.yellow', 'readOnly=yellow');
    pass('color 없음 + readOnly → charts.yellow');
} catch (e) { fail('readOnly yellow', e); }

try {
    // 커스텀 ID는 매핑에 없음 → readOnly 기반 fallback
    assert(getIconColor({ id: 'custom', hex: '#123456' }, true) === 'charts.yellow', 'custom+readOnly=yellow');
    pass('커스텀 ID + readOnly → charts.yellow fallback');
} catch (e) { fail('커스텀 fallback', e); }

try {
    assert(getIconColor({ id: 'custom', hex: '#123456' }, false) === 'charts.green', 'custom+rw=green');
    pass('커스텀 ID + readWrite → charts.green fallback');
} catch (e) { fail('커스텀 fallback rw', e); }

// ── 11. 상태 바 텍스트 생성 ──

section('상태 바 텍스트 생성');

function buildStatusBarText(name: string, color?: ConnectionColor): string {
    const colorLabel = color?.label;
    const colorDot = color ? '●' : '';
    const nameDisplay = colorLabel ? `${colorLabel}: ${name}` : name;
    return `$(database) ${colorDot} DBunny: ${nameDisplay}`;
}

try {
    const text = buildStatusBarText('prod-db', { id: 'red', hex: '#E74C3C', label: '운영' });
    assert(text.includes('●'), '색상 점 포함');
    assert(text.includes('운영: prod-db'), '라벨: 이름 형식');
    pass('운영 라벨 상태 바 텍스트');
} catch (e) { fail('운영 상태바', e); }

try {
    const text = buildStatusBarText('local-db');
    assert(!text.includes('●'), '색상 점 없음');
    assert(text.includes('DBunny: local-db'), '이름만');
    pass('색상 없는 상태 바 텍스트');
} catch (e) { fail('무색상 상태바', e); }

try {
    const text = buildStatusBarText('dev-db', { id: 'green', hex: '#27AE60' });
    assert(text.includes('●'), '점 있음');
    assert(text.includes('DBunny: dev-db'), '라벨 없으면 이름만');
    assert(!text.includes(': dev-db:'), '이중 콜론 없음');
    pass('라벨 없는 색상 상태 바');
} catch (e) { fail('라벨없는 상태바', e); }

// ── 12. tooltip에 컬러 정보 포함 ──

section('tooltip 컬러 정보');

function buildTooltipLines(config: Partial<ConnectionConfig>): string[] {
    const lines: string[] = [];
    lines.push(`Name: ${config.name}`);
    if (config.readOnly) {lines.push('Mode: Read-Only 🔒');}
    if (config.color) {
        const label = config.color.label || config.color.id;
        lines.push(`Color: ${label}`);
    }
    return lines;
}

try {
    const lines = buildTooltipLines({ name: 'test', color: { id: 'red', hex: '#E74C3C', label: '운영' } });
    assert(lines.includes('Color: 운영'), '컬러 라벨');
    pass('tooltip에 컬러 라벨 포함');
} catch (e) { fail('tooltip 라벨', e); }

try {
    const lines = buildTooltipLines({ name: 'test', color: { id: 'blue', hex: '#3498DB' } });
    assert(lines.includes('Color: blue'), '라벨 없으면 ID');
    pass('tooltip에 컬러 ID fallback');
} catch (e) { fail('tooltip ID fallback', e); }

try {
    const lines = buildTooltipLines({ name: 'test' });
    assert(!lines.some(l => l.startsWith('Color:')), '컬러 없으면 Color 줄 없음');
    pass('color 없는 tooltip');
} catch (e) { fail('tooltip no color', e); }

try {
    const lines = buildTooltipLines({ name: 'test', readOnly: true, color: { id: 'red', hex: '#E74C3C', label: '운영' } });
    assert(lines.includes('Mode: Read-Only 🔒'), 'readOnly');
    assert(lines.includes('Color: 운영'), 'color');
    pass('readOnly + color tooltip');
} catch (e) { fail('readOnly + color tooltip', e); }

// ── 13. 연결 배지 스타일 생성 ──

section('연결 배지 스타일');

function buildBadgeStyle(color?: ConnectionColor): string {
    if (!color) {return '';}
    return `background:${color.hex}22;color:${color.hex};border:1px solid ${color.hex}44`;
}

try {
    const style = buildBadgeStyle({ id: 'red', hex: '#E74C3C' });
    assert(style.includes('#E74C3C22'), 'background 알파');
    assert(style.includes('color:#E74C3C'), '텍스트 색상');
    assert(style.includes('#E74C3C44'), 'border 알파');
    pass('빨간 배지 스타일');
} catch (e) { fail('빨간 배지', e); }

try {
    const style = buildBadgeStyle(undefined);
    assert(style === '', '빈 스타일');
    pass('color 없으면 빈 스타일');
} catch (e) { fail('빈 배지 스타일', e); }

try {
    const style = buildBadgeStyle({ id: 'green', hex: '#27AE60', label: '개발' });
    assert(style.includes('#27AE60'), '색상 포함');
    pass('초록 배지 스타일');
} catch (e) { fail('초록 배지', e); }

// ── 14. 모든 프리셋에 대한 아이콘 매핑 커버리지 ──

section('프리셋 전체 아이콘 매핑 커버리지');

for (const preset of CONNECTION_COLOR_PRESETS) {
    try {
        const color = getIconColor({ id: preset.id, hex: preset.hex });
        assert(typeof color === 'string' && color.length > 0, '매핑 존재');
        pass(`${preset.id} → ${color}`);
    } catch (e) { fail(`${preset.id} 매핑`, e); }
}

// ── 15. 다양한 DB 타입과 컬러 조합 ──

section('DB 타입별 컬러 조합');

const dbTypes = ['mysql', 'postgres', 'sqlite', 'mongodb', 'redis', 'h2'] as const;
for (const dbType of dbTypes) {
    try {
        const config: ConnectionConfig = {
            id: `${dbType}-prod`,
            name: `${dbType} Production`,
            type: dbType,
            host: 'prod.example.com',
            port: 5432,
            username: 'admin',
            color: { id: 'red', hex: '#E74C3C', label: '운영' }
        };
        assert(config.type === dbType, 'type');
        assert(config.color?.id === 'red', 'color');
        pass(`${dbType} + red 컬러`);
    } catch (e) { fail(`${dbType} + color`, e); }
}

// ── 16. 엣지 케이스 ──

section('엣지 케이스');

try {
    const color: ConnectionColor = { id: '', hex: '#000000' };
    assert(color.id === '', '빈 ID 허용');
    pass('빈 color ID');
} catch (e) { fail('빈 ID', e); }

try {
    const color: ConnectionColor = { id: 'red', hex: '#E74C3C', label: '' };
    assert(color.label === '', '빈 라벨 허용');
    pass('빈 color label');
} catch (e) { fail('빈 라벨', e); }

try {
    const color: ConnectionColor = { id: 'red', hex: '#E74C3C', label: '🔴 운영 서버' };
    assert(color.label!.includes('🔴'), '이모지 포함');
    pass('이모지 라벨');
} catch (e) { fail('이모지 라벨', e); }

try {
    const color: ConnectionColor = { id: 'custom', hex: '#ABCDEF', label: 'Very Long Label That Exceeds Normal Length' };
    assert(color.label!.length > 30, '긴 라벨');
    pass('긴 라벨');
} catch (e) { fail('긴 라벨', e); }

try {
    // XSS 시도 라벨
    const color: ConnectionColor = { id: 'red', hex: '#E74C3C', label: '<script>alert(1)</script>' };
    assert(color.label!.includes('<script>'), '스크립트 태그는 문자열로만 저장');
    pass('XSS 라벨 (문자열로만 저장됨)');
} catch (e) { fail('XSS 라벨', e); }

// ── Summary ──
console.log(`\n${'═'.repeat(50)}`);
console.log(`총 ${totalPass + totalFail}개 테스트: ✅ ${totalPass} 통과, ❌ ${totalFail} 실패`);
if (totalFail > 0) {process.exit(1);}
