/**
 * v3.0.0 — 차트 데이터 빌더
 * QueryResult → 차트 렌더링용 데이터 변환
 * 순수 SVG 기반 (외부 라이브러리 없음)
 */

import { QueryResult, FieldInfo } from '../types/database';

// ── 타입 ───────────────────────────────────────────

export type ChartType = 'bar' | 'pie' | 'line';

export interface ChartDataPoint {
    label: string;
    value: number;
    color: string;
}

export interface ChartConfig {
    type: ChartType;
    title: string;
    labelColumn: string;
    valueColumn: string;
    data: ChartDataPoint[];
}

// ── 상수 ───────────────────────────────────────────

/** 차트 색상 팔레트 */
export const CHART_COLORS = [
    '#4fc3f7', '#81c784', '#ffb74d', '#e57373', '#ba68c8',
    '#4dd0e1', '#aed581', '#ffd54f', '#ff8a65', '#ce93d8',
    '#26c6da', '#c5e1a5', '#ffe082', '#ffab91', '#b39ddb',
    '#29b6f6', '#9ccc65', '#ffca28', '#ff7043', '#ab47bc',
];

/** 최대 데이터 포인트 수 */
export const MAX_DATA_POINTS = 50;

// ── 유틸리티 ───────────────────────────────────────

/** 숫자 타입 여부 */
export function isNumericField(type: string): boolean {
    const t = type.toLowerCase();
    return t.includes('int') || t.includes('decimal') || t.includes('numeric')
        || t.includes('float') || t.includes('double') || t.includes('real')
        || t.includes('money') || t === 'serial' || t === 'bigserial'
        || t.includes('number');
}

/** 날짜/시간 타입 여부 */
export function isDateField(type: string): boolean {
    const t = type.toLowerCase();
    return t.includes('date') || t.includes('time') || t.includes('timestamp');
}

/** 숫자 컬럼 목록 */
export function getNumericColumns(fields: FieldInfo[]): FieldInfo[] {
    return fields.filter(f => isNumericField(f.type));
}

/** 라벨 후보 컬럼 (문자열/날짜) */
export function getLabelColumns(fields: FieldInfo[]): FieldInfo[] {
    return fields.filter(f => !isNumericField(f.type) || isDateField(f.type));
}

/** 차트 타입 자동 추천 */
export function suggestChartType(
    result: QueryResult,
    labelColumn: string,
    valueColumn: string,
    fields: FieldInfo[]
): ChartType {
    const labelField = fields.find(f => f.name === labelColumn);
    const distinctLabels = new Set(result.rows.map(r => String(r[labelColumn] ?? ''))).size;

    // 날짜 컬럼이면 라인 차트
    if (labelField && isDateField(labelField.type)) {
        return 'line';
    }

    // 고유값 10개 이하 → 파이 차트
    if (distinctLabels <= 10) {
        return 'pie';
    }

    // 기본 → 막대 차트
    return 'bar';
}

// ── 데이터 변환 ────────────────────────────────────

/**
 * QueryResult → ChartDataPoint 배열 변환
 */
export function buildChartData(
    result: QueryResult,
    labelColumn: string,
    valueColumn: string,
    aggregation: 'raw' | 'sum' | 'count' | 'avg' = 'raw'
): ChartDataPoint[] {
    if (result.rows.length === 0) { return []; }

    let data: ChartDataPoint[];

    if (aggregation === 'raw') {
        // 원본 데이터 그대로
        data = result.rows.slice(0, MAX_DATA_POINTS).map((row, i) => ({
            label: row[labelColumn] !== null && row[labelColumn] !== undefined
                ? String(row[labelColumn]) : `(row ${i + 1})`,
            value: Number(row[valueColumn]) || 0,
            color: CHART_COLORS[i % CHART_COLORS.length],
        }));
    } else {
        // 그룹별 집계
        const groups = new Map<string, number[]>();
        for (const row of result.rows) {
            const label = row[labelColumn] !== null && row[labelColumn] !== undefined
                ? String(row[labelColumn]) : '(null)';
            const val = Number(row[valueColumn]) || 0;
            if (!groups.has(label)) { groups.set(label, []); }
            groups.get(label)!.push(val);
        }

        const entries: { label: string; value: number }[] = [];
        for (const [label, values] of groups) {
            let aggVal: number;
            switch (aggregation) {
                case 'sum':
                    aggVal = values.reduce((a, b) => a + b, 0);
                    break;
                case 'count':
                    aggVal = values.length;
                    break;
                case 'avg':
                    aggVal = values.reduce((a, b) => a + b, 0) / values.length;
                    break;
                default:
                    aggVal = values[0];
            }
            entries.push({ label, value: Math.round(aggVal * 100) / 100 });
        }

        // 값 내림차순 정렬 후 상위 N개
        entries.sort((a, b) => b.value - a.value);
        data = entries.slice(0, MAX_DATA_POINTS).map((e, i) => ({
            ...e,
            color: CHART_COLORS[i % CHART_COLORS.length],
        }));
    }

    return data;
}

// ── SVG 렌더링 ─────────────────────────────────────

/**
 * 막대 차트 SVG
 */
export function renderBarChart(data: ChartDataPoint[], width: number = 600, height: number = 300): string {
    if (data.length === 0) { return '<p>No data</p>'; }

    const padding = { top: 20, right: 20, bottom: 60, left: 60 };
    const chartW = width - padding.left - padding.right;
    const chartH = height - padding.top - padding.bottom;

    const maxVal = Math.max(...data.map(d => d.value), 1);
    const barWidth = Math.max(Math.min(chartW / data.length - 4, 40), 4);
    const gap = (chartW - barWidth * data.length) / (data.length + 1);

    let bars = '';
    let labels = '';
    for (let i = 0; i < data.length; i++) {
        const x = padding.left + gap + i * (barWidth + gap);
        const barH = (data[i].value / maxVal) * chartH;
        const y = padding.top + chartH - barH;

        bars += `<rect x="${x}" y="${y}" width="${barWidth}" height="${barH}" fill="${data[i].color}" rx="2">
            <title>${escSvg(data[i].label)}: ${data[i].value}</title></rect>`;

        // 라벨 (회전)
        const labelX = x + barWidth / 2;
        const labelY = padding.top + chartH + 8;
        const truncLabel = data[i].label.length > 10 ? data[i].label.substring(0, 9) + '…' : data[i].label;
        labels += `<text x="${labelX}" y="${labelY}" text-anchor="end" transform="rotate(-45, ${labelX}, ${labelY})" font-size="10" fill="currentColor">${escSvg(truncLabel)}</text>`;
    }

    // Y축 눈금
    let yAxis = '';
    const ticks = 5;
    for (let i = 0; i <= ticks; i++) {
        const val = Math.round((maxVal / ticks) * i * 100) / 100;
        const y = padding.top + chartH - (i / ticks) * chartH;
        yAxis += `<line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" stroke="currentColor" opacity="0.15"/>`;
        yAxis += `<text x="${padding.left - 8}" y="${y + 4}" text-anchor="end" font-size="10" fill="currentColor" opacity="0.6">${formatNum(val)}</text>`;
    }

    return `<svg width="100%" viewBox="0 0 ${width} ${height}" style="max-width:${width}px">
        ${yAxis}${bars}${labels}
    </svg>`;
}

/**
 * 파이 차트 SVG
 */
export function renderPieChart(data: ChartDataPoint[], size: number = 300): string {
    if (data.length === 0) { return '<p>No data</p>'; }

    const total = data.reduce((s, d) => s + d.value, 0);
    if (total === 0) { return '<p>All values are 0</p>'; }

    const cx = size / 2;
    const cy = size / 2;
    const r = size / 2 - 10;

    let startAngle = -Math.PI / 2;
    let slices = '';
    let legend = '';

    for (const d of data) {
        const pct = d.value / total;
        const endAngle = startAngle + pct * 2 * Math.PI;

        const x1 = cx + r * Math.cos(startAngle);
        const y1 = cy + r * Math.sin(startAngle);
        const x2 = cx + r * Math.cos(endAngle);
        const y2 = cy + r * Math.sin(endAngle);
        const largeArc = pct > 0.5 ? 1 : 0;

        if (pct > 0.001) {
            slices += `<path d="M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${largeArc},1 ${x2},${y2} Z" fill="${d.color}">
                <title>${escSvg(d.label)}: ${d.value} (${(pct * 100).toFixed(1)}%)</title></path>`;
        }

        legend += `<div style="display:flex;align-items:center;gap:6px;font-size:12px;">
            <span style="width:10px;height:10px;border-radius:2px;background:${d.color};display:inline-block;flex-shrink:0;"></span>
            <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:120px;" title="${escHtml(d.label)}">${escHtml(d.label)}</span>
            <span style="opacity:0.6;margin-left:auto;">${(pct * 100).toFixed(1)}%</span>
        </div>`;

        startAngle = endAngle;
    }

    return `<div style="display:flex;align-items:center;gap:20px;flex-wrap:wrap;">
        <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${slices}</svg>
        <div style="display:flex;flex-direction:column;gap:4px;">${legend}</div>
    </div>`;
}

/**
 * 라인 차트 SVG
 */
export function renderLineChart(data: ChartDataPoint[], width: number = 600, height: number = 300): string {
    if (data.length === 0) { return '<p>No data</p>'; }

    const padding = { top: 20, right: 20, bottom: 60, left: 60 };
    const chartW = width - padding.left - padding.right;
    const chartH = height - padding.top - padding.bottom;

    const maxVal = Math.max(...data.map(d => d.value), 1);
    const minVal = Math.min(...data.map(d => d.value), 0);
    const range = maxVal - minVal || 1;

    // 포인트 좌표
    const points = data.map((d, i) => ({
        x: padding.left + (i / Math.max(data.length - 1, 1)) * chartW,
        y: padding.top + chartH - ((d.value - minVal) / range) * chartH,
    }));

    // 라인
    const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');

    // 포인트 + 라벨
    let dots = '';
    let labels = '';
    const labelInterval = Math.max(1, Math.floor(data.length / 10));
    for (let i = 0; i < data.length; i++) {
        dots += `<circle cx="${points[i].x}" cy="${points[i].y}" r="3" fill="${CHART_COLORS[0]}">
            <title>${escSvg(data[i].label)}: ${data[i].value}</title></circle>`;

        if (i % labelInterval === 0 || i === data.length - 1) {
            const truncLabel = data[i].label.length > 10 ? data[i].label.substring(0, 9) + '…' : data[i].label;
            labels += `<text x="${points[i].x}" y="${padding.top + chartH + 16}" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.6" transform="rotate(-30, ${points[i].x}, ${padding.top + chartH + 16})">${escSvg(truncLabel)}</text>`;
        }
    }

    // Y축
    let yAxis = '';
    const ticks = 5;
    for (let i = 0; i <= ticks; i++) {
        const val = Math.round((minVal + (range / ticks) * i) * 100) / 100;
        const y = padding.top + chartH - (i / ticks) * chartH;
        yAxis += `<line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" stroke="currentColor" opacity="0.15"/>`;
        yAxis += `<text x="${padding.left - 8}" y="${y + 4}" text-anchor="end" font-size="10" fill="currentColor" opacity="0.6">${formatNum(val)}</text>`;
    }

    return `<svg width="100%" viewBox="0 0 ${width} ${height}" style="max-width:${width}px">
        ${yAxis}
        <path d="${pathD}" fill="none" stroke="${CHART_COLORS[0]}" stroke-width="2" stroke-linejoin="round"/>
        ${dots}${labels}
    </svg>`;
}

/**
 * ChartConfig → SVG HTML
 */
export function renderChart(config: ChartConfig): string {
    switch (config.type) {
        case 'bar': return renderBarChart(config.data);
        case 'pie': return renderPieChart(config.data);
        case 'line': return renderLineChart(config.data);
        default: return renderBarChart(config.data);
    }
}

// ── 내부 유틸 ──────────────────────────────────────

function escSvg(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatNum(n: number): string {
    if (Math.abs(n) >= 1000000) { return (n / 1000000).toFixed(1) + 'M'; }
    if (Math.abs(n) >= 1000) { return (n / 1000).toFixed(1) + 'K'; }
    return String(n);
}
