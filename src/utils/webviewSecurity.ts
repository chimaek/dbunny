/// <reference lib="dom" />
import { randomBytes } from 'crypto';
import type { Webview } from 'vscode';

export function createNonce(): string { return randomBytes(24).toString('base64'); }

export function serializeForWebview(value: unknown): string {
    return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

/** HTML 데이터 속성에 JSON 인자를 넣는다. 따옴표가 포함된 컬럼명·값도 코드가 되지 않는다. */
export function webviewArgument(value: unknown): string {
    return JSON.stringify(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function webviewArgumentScript(): string {
    return `const webviewArgument = (${webviewArgument.toString()});`;
}

/** 스크립트는 소스 템플릿에서 부여한 nonce만 허용한다. 입력 HTML에 nonce를 자동 부여하지 않는다. */
export function secureWebviewHtml(html: string, webview: Webview, nonce: string): string {
    const policy = `default-src 'none'; script-src 'nonce-${nonce}'; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} data:; font-src ${webview.cspSource}; form-action 'none'; base-uri 'none';`;
    const meta = `<meta http-equiv="Content-Security-Policy" content="${policy}">`;
    return /<head>/i.test(html) ? html.replace(/<head>/i, `<head>${meta}`) : `<!DOCTYPE html><html><head>${meta}</head><body>${html}</body></html>`;
}

/**
 * 기존 HTML 이벤트 표현식을 실행 가능한 속성 대신 데이터로 전달한다.
 * eval/Function 없이 허용한 콜백과 제한된 인자만 해석하여 CSP 아래에서 동작한다.
 * 이 함수는 브라우저로 직렬화되므로 외부 변수에 의존하지 않는다.
 */
export function installWebviewHandlers(
    callbacks: Record<string, (...args: any[]) => unknown>,
    getValues: () => Record<string, any> = () => ({})
): void {
    const split = (source: string, separator: string): string[] => {
        const parts: string[] = [];
        let start = 0, quote = '', depth = 0;
        for (let i = 0; i < source.length; i++) {
            const c = source[i];
            if (quote) {
                if (c === '\\') { i++; }
                else if (c === quote) { quote = ''; }
            } else if (c === "'" || c === '"') { quote = c; }
            else if (c === '(' || c === '[') { depth++; }
            else if (c === ')' || c === ']') { depth--; }
            else if (c === separator && depth === 0) { parts.push(source.slice(start, i).trim()); start = i + 1; }
        }
        parts.push(source.slice(start).trim());
        return parts.filter(Boolean);
    };
    const read = (source: string, element: HTMLElement, event: Event): any => {
        const value = source.trim();
        if (value === 'this') { return element; }
        if (value === 'event') { return event; }
        if (value === 'this.value') { return (element as HTMLInputElement).value; }
        if (value === 'this.checked') { return (element as HTMLInputElement).checked; }
        if (value === 'null') { return null; }
        if (value === 'true' || value === 'false') { return value === 'true'; }
        if (/^-?\d+(\.\d+)?$/.test(value)) { return Number(value); }
        if (/^'(?:[^'\\]|\\.)*'$/.test(value)) {
            return value.slice(1, -1).replace(/\\([\\'"nrt])/g, (_match, c: string) => (({ n: '\n', r: '\r', t: '\t' } as Record<string, string>)[c] || c));
        }
        if (/^"(?:[^"\\]|\\.)*"$/.test(value)) { return JSON.parse(value); }
        const numeric = value.match(/^(parseInt|parseFloat)\((.*)\)$/);
        if (numeric) { return numeric[1] === 'parseInt' ? parseInt(read(numeric[2], element, event), 10) : parseFloat(read(numeric[2], element, event)); }
        const indexed = value.match(/^(\w+)\[(\d+)\]\[('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")\]$/);
        if (indexed) {
            const values = getValues();
            if (Object.prototype.hasOwnProperty.call(values, indexed[1])) {
                return values[indexed[1]]?.[Number(indexed[2])]?.[read(indexed[3], element, event)];
            }
        }
        throw new Error('Unsupported Webview event argument');
    };
    for (const type of ['click', 'dblclick', 'change', 'input', 'keydown']) {
        document.addEventListener(type, event => {
            let element = event.target instanceof Element ? event.target.closest<HTMLElement>(`[data-dbunny-${type}]`) : null;
            while (element) {
                let source = element.getAttribute(`data-dbunny-${type}`) || '';
                if (source.startsWith('if(event.target===this)')) {
                    source = event.target === element ? source.slice('if(event.target===this)'.length) : '';
                }
                if (source.startsWith("if(event.key==='Enter')")) {
                    source = (event as KeyboardEvent).key === 'Enter' ? source.slice("if(event.key==='Enter')".length) : '';
                }
                try {
                    for (const statement of split(source, ';')) {
                        if (statement === 'event.stopPropagation()') { event.stopPropagation(); continue; }
                        const call = statement.match(/^(\w+)\((.*)\)$/);
                        if (!call || !Object.prototype.hasOwnProperty.call(callbacks, call[1])) {
                            throw new Error('Unsupported Webview callback');
                        }
                        callbacks[call[1]](...split(call[2], ',').map(arg => read(arg, element!, event)));
                    }
                } catch { console.error('DBunny blocked an invalid Webview event'); }
                if (event.cancelBubble) { break; }
                element = element.parentElement?.closest<HTMLElement>(`[data-dbunny-${type}]`) || null;
            }
        });
    }
}

/** 콜백 이름은 개발자가 정한 목록만 사용한다. 사용자 입력은 실행 코드로 만들지 않는다. */
export function webviewEventScript(callbacks: string[], values: string[] = []): string {
    const names = [...callbacks, ...values];
    if (names.some(name => !/^[a-zA-Z_$][\w$]*$/.test(name))) { throw new Error('Invalid Webview callback name'); }
    return `(${installWebviewHandlers.toString()})({${callbacks.join(',')}}, () => ({${values.join(',')}}));`;
}
