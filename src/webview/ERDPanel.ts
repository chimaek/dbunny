import * as vscode from 'vscode';
import { TableERDInfo } from '../types/database';
import { I18n } from '../utils/i18n';

/**
 * Webview panel for displaying ERD (Entity Relationship Diagram)
 */
export class ERDPanel {
    public static currentPanel: ERDPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];

    private constructor(
        panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri,
        private i18n: I18n
    ) {
        this._panel = panel;
        this._extensionUri = extensionUri;

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'exportSVG':
                        await this._handleExportSVG(message.svg);
                        break;
                    case 'exportPNG':
                        await this._handleExportPNG(message.dataUrl);
                        break;
                }
            },
            null,
            this._disposables
        );
    }

    /**
     * Create or show the ERD panel
     */
    public static createOrShow(
        extensionUri: vscode.Uri,
        i18n: I18n
    ): ERDPanel {
        const column = vscode.ViewColumn.One;

        if (ERDPanel.currentPanel) {
            ERDPanel.currentPanel._panel.reveal(column);
            return ERDPanel.currentPanel;
        }

        const panel = vscode.window.createWebviewPanel(
            'dbunnyERD',
            'ERD Diagram',
            column,
            {
                enableScripts: true,
                localResourceRoots: [extensionUri],
                retainContextWhenHidden: true
            }
        );

        ERDPanel.currentPanel = new ERDPanel(panel, extensionUri, i18n);
        return ERDPanel.currentPanel;
    }

    /**
     * Update the ERD with table data
     */
    public updateERD(tables: TableERDInfo[], databaseName: string): void {
        this._panel.webview.html = this._getHtmlContent(tables, databaseName);
    }

    /**
     * Show loading state
     */
    public showLoading(): void {
        this._panel.webview.html = this._getLoadingHtml();
    }

    private async _handleExportSVG(svgContent: string): Promise<void> {
        const uri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(`erd_diagram_${Date.now()}.svg`),
            filters: {
                'SVG Files': ['svg'],
                'All Files': ['*']
            }
        });

        if (!uri) { return; }

        await vscode.workspace.fs.writeFile(uri, Buffer.from(svgContent, 'utf8'));
        vscode.window.showInformationMessage(this.i18n.t('erd.exportedSVG', { path: uri.fsPath }));
    }

    private async _handleExportPNG(dataUrl: string): Promise<void> {
        const uri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(`erd_diagram_${Date.now()}.png`),
            filters: {
                'PNG Files': ['png'],
                'All Files': ['*']
            }
        });

        if (!uri) { return; }

        // Convert data URL to buffer
        const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');

        await vscode.workspace.fs.writeFile(uri, buffer);
        vscode.window.showInformationMessage(this.i18n.t('erd.exportedPNG', { path: uri.fsPath }));
    }

    private _getHtmlContent(tables: TableERDInfo[], databaseName: string): string {
        const tablesJson = JSON.stringify(tables);

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ERD Diagram - ${this._escapeHtml(databaseName)}</title>
    <style>
        :root {
            --bg-color: var(--vscode-editor-background);
            --text-color: var(--vscode-foreground);
            --border-color: var(--vscode-panel-border);
            --table-bg: var(--vscode-editorWidget-background);
            --table-header-bg: var(--vscode-sideBarSectionHeader-background);
            --pk-color: #f0ad4e;
            --fk-color: #5bc0de;
            --relation-color: #28a745;
        }

        * { box-sizing: border-box; margin: 0; padding: 0; }

        body {
            font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
            background: var(--bg-color);
            color: var(--text-color);
            overflow: hidden;
            height: 100vh;
        }

        .toolbar {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            height: 48px;
            background: var(--vscode-titleBar-activeBackground);
            border-bottom: 1px solid var(--border-color);
            display: flex;
            align-items: center;
            padding: 0 16px;
            gap: 12px;
            z-index: 1000;
        }

        .toolbar-title {
            font-size: 14px;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .toolbar-title .icon {
            font-size: 18px;
        }

        .toolbar-spacer {
            flex: 1;
        }

        .toolbar-btn {
            padding: 6px 12px;
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: 1px solid var(--border-color);
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
            display: flex;
            align-items: center;
            gap: 6px;
            transition: background 0.15s;
        }

        .toolbar-btn:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }

        .toolbar-btn.primary {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border-color: var(--vscode-button-background);
        }

        .toolbar-btn.primary:hover {
            background: var(--vscode-button-hoverBackground);
        }

        .zoom-controls {
            display: flex;
            align-items: center;
            gap: 4px;
            margin-left: 12px;
        }

        .zoom-btn {
            width: 28px;
            height: 28px;
            border-radius: 4px;
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: 1px solid var(--border-color);
            cursor: pointer;
            font-size: 16px;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .zoom-btn:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }

        .zoom-level {
            font-size: 12px;
            min-width: 50px;
            text-align: center;
        }

        .canvas-container {
            position: absolute;
            top: 48px;
            left: 0;
            right: 0;
            bottom: 0;
            overflow: auto;
            cursor: grab;
        }

        .canvas-container:active {
            cursor: grabbing;
        }

        #erdCanvas {
            position: relative;
            min-width: 100%;
            min-height: 100%;
        }

        .table-node {
            position: absolute;
            background: var(--table-bg);
            border: 1px solid var(--border-color);
            border-radius: 6px;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
            min-width: 180px;
            max-width: 280px;
            cursor: move;
            user-select: none;
            transition: box-shadow 0.15s;
        }

        .table-node:hover {
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
        }

        .table-node.dragging {
            z-index: 100;
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
        }

        .table-header {
            background: var(--table-header-bg);
            padding: 10px 12px;
            border-radius: 6px 6px 0 0;
            border-bottom: 1px solid var(--border-color);
            font-weight: 600;
            font-size: 13px;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .table-header .icon {
            font-size: 14px;
        }

        .table-columns {
            padding: 6px 0;
            max-height: 300px;
            overflow-y: auto;
        }

        .column-row {
            padding: 4px 12px;
            font-size: 12px;
            display: flex;
            align-items: center;
            gap: 8px;
            font-family: var(--vscode-editor-font-family, monospace);
        }

        .column-row:hover {
            background: var(--vscode-list-hoverBackground);
        }

        .column-key {
            font-size: 10px;
            font-weight: bold;
            padding: 1px 4px;
            border-radius: 3px;
            min-width: 20px;
            text-align: center;
        }

        .column-key.pk {
            background: var(--pk-color);
            color: #000;
        }

        .column-key.fk {
            background: var(--fk-color);
            color: #000;
        }

        .column-name {
            flex: 1;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .column-type {
            color: var(--vscode-descriptionForeground);
            font-size: 11px;
        }

        /* SVG for relations */
        #relationsSvg {
            position: absolute;
            top: 0;
            left: 0;
            pointer-events: none;
            overflow: visible;
        }

        .relation-line {
            fill: none;
            stroke: var(--relation-color);
            stroke-width: 2;
        }

        .relation-marker {
            fill: var(--relation-color);
        }

        /* Legend */
        .legend {
            position: fixed;
            bottom: 16px;
            right: 16px;
            background: var(--table-bg);
            border: 1px solid var(--border-color);
            border-radius: 6px;
            padding: 12px;
            font-size: 12px;
            z-index: 100;
        }

        .legend-title {
            font-weight: 600;
            margin-bottom: 8px;
        }

        .legend-item {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 4px;
        }

        .legend-color {
            width: 16px;
            height: 16px;
            border-radius: 3px;
        }

        .legend-color.pk { background: var(--pk-color); }
        .legend-color.fk { background: var(--fk-color); }
        .legend-color.relation { background: var(--relation-color); }

        /* Stats */
        .stats {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            display: flex;
            gap: 16px;
        }

        .stat-item {
            display: flex;
            align-items: center;
            gap: 4px;
        }

        /* Empty state */
        .empty-state {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: calc(100vh - 48px);
            color: var(--vscode-descriptionForeground);
        }

        .empty-state .icon {
            font-size: 64px;
            margin-bottom: 16px;
            opacity: 0.5;
        }

        .empty-state .message {
            font-size: 16px;
        }
    </style>
</head>
<body>
    <div class="toolbar">
        <div class="toolbar-title">
            <span class="icon">🗂️</span>
            <span>ERD - ${this._escapeHtml(databaseName)}</span>
        </div>
        <div class="stats">
            <div class="stat-item">
                <span>📊</span>
                <span id="tableCount">0 tables</span>
            </div>
            <div class="stat-item">
                <span>🔗</span>
                <span id="relationCount">0 relations</span>
            </div>
        </div>
        <div class="toolbar-spacer"></div>
        <div class="zoom-controls">
            <button class="zoom-btn" onclick="zoomOut()" title="Zoom Out">−</button>
            <span class="zoom-level" id="zoomLevel">100%</span>
            <button class="zoom-btn" onclick="zoomIn()" title="Zoom In">+</button>
            <button class="zoom-btn" onclick="resetZoom()" title="Reset Zoom">↺</button>
        </div>
        <button class="toolbar-btn" onclick="autoLayout()" title="Auto arrange tables">
            <span>📐</span> Auto Layout
        </button>
        <button class="toolbar-btn" onclick="exportSVG()" title="Export as SVG">
            <span>📄</span> SVG
        </button>
        <button class="toolbar-btn primary" onclick="exportPNG()" title="Export as PNG">
            <span>🖼️</span> PNG
        </button>
    </div>

    <div class="canvas-container" id="canvasContainer">
        <div id="erdCanvas">
            <svg id="relationsSvg"></svg>
        </div>
    </div>

    <div class="legend">
        <div class="legend-title">Legend</div>
        <div class="legend-item">
            <div class="legend-color pk"></div>
            <span>Primary Key</span>
        </div>
        <div class="legend-item">
            <div class="legend-color fk"></div>
            <span>Foreign Key</span>
        </div>
        <div class="legend-item">
            <div class="legend-color relation"></div>
            <span>Relationship</span>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        const tables = ${tablesJson};
        let zoom = 1;
        let tablePositions = {};
        let isDragging = false;
        let dragTarget = null;
        let dragOffset = { x: 0, y: 0 };
        let isPanning = false;
        let panStart = { x: 0, y: 0 };
        let scrollStart = { x: 0, y: 0 };

        // Initialize
        document.addEventListener('DOMContentLoaded', () => {
            initERD();
        });

        function initERD() {
            const canvas = document.getElementById('erdCanvas');
            const container = document.getElementById('canvasContainer');

            if (tables.length === 0) {
                canvas.innerHTML = \`
                    <div class="empty-state">
                        <span class="icon">📭</span>
                        <span class="message">No tables found in this database</span>
                    </div>
                \`;
                return;
            }

            // Calculate initial positions using grid layout
            const positions = calculateGridLayout(tables);
            tablePositions = positions;

            // Create table nodes
            tables.forEach((table, index) => {
                const node = createTableNode(table, positions[table.name]);
                canvas.appendChild(node);
            });

            // Update stats
            document.getElementById('tableCount').textContent = tables.length + ' tables';
            const totalFKs = tables.reduce((sum, t) => sum + t.foreignKeys.length, 0);
            document.getElementById('relationCount').textContent = totalFKs + ' relations';

            // Draw relations
            drawRelations();

            // Setup pan functionality
            setupPanning(container);

            // Update canvas size
            updateCanvasSize();
        }

        function calculateGridLayout(tables) {
            const positions = {};
            const cols = Math.ceil(Math.sqrt(tables.length));
            const cellWidth = 280;
            const cellHeight = 350;
            const padding = 50;

            tables.forEach((table, index) => {
                const col = index % cols;
                const row = Math.floor(index / cols);
                positions[table.name] = {
                    x: padding + col * cellWidth,
                    y: padding + row * cellHeight
                };
            });

            return positions;
        }

        function createTableNode(table, position) {
            const node = document.createElement('div');
            node.className = 'table-node';
            node.id = 'table-' + table.name;
            node.style.left = position.x + 'px';
            node.style.top = position.y + 'px';

            const fkColumns = new Set(table.foreignKeys.map(fk => fk.columnName));

            let columnsHtml = table.columns.map(col => {
                let keyBadge = '';
                if (col.primaryKey) {
                    keyBadge = '<span class="column-key pk">PK</span>';
                } else if (fkColumns.has(col.name)) {
                    keyBadge = '<span class="column-key fk">FK</span>';
                } else {
                    keyBadge = '<span class="column-key"></span>';
                }

                return \`
                    <div class="column-row" data-column="\${escapeHtml(col.name)}">
                        \${keyBadge}
                        <span class="column-name">\${escapeHtml(col.name)}</span>
                        <span class="column-type">\${escapeHtml(col.type)}</span>
                    </div>
                \`;
            }).join('');

            node.innerHTML = \`
                <div class="table-header">
                    <span class="icon">📋</span>
                    <span>\${escapeHtml(table.name)}</span>
                </div>
                <div class="table-columns">
                    \${columnsHtml}
                </div>
            \`;

            // Drag functionality
            node.addEventListener('mousedown', (e) => {
                if (e.target.closest('.table-columns')) return;
                isDragging = true;
                dragTarget = node;
                node.classList.add('dragging');
                const rect = node.getBoundingClientRect();
                const container = document.getElementById('canvasContainer');
                dragOffset = {
                    x: e.clientX - rect.left + container.scrollLeft,
                    y: e.clientY - rect.top + container.scrollTop
                };
                e.preventDefault();
            });

            return node;
        }

        function drawRelations() {
            const svg = document.getElementById('relationsSvg');
            svg.innerHTML = '';

            // Create marker for arrow
            const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
            defs.innerHTML = \`
                <marker id="arrowhead" markerWidth="10" markerHeight="7"
                        refX="9" refY="3.5" orient="auto" class="relation-marker">
                    <polygon points="0 0, 10 3.5, 0 7" />
                </marker>
            \`;
            svg.appendChild(defs);

            tables.forEach(table => {
                table.foreignKeys.forEach(fk => {
                    const fromNode = document.getElementById('table-' + table.name);
                    const toNode = document.getElementById('table-' + fk.referencedTable);

                    if (!fromNode || !toNode) return;

                    const fromRect = fromNode.getBoundingClientRect();
                    const toRect = toNode.getBoundingClientRect();
                    const canvasRect = document.getElementById('erdCanvas').getBoundingClientRect();

                    // Calculate connection points
                    const fromX = parseInt(fromNode.style.left) + fromNode.offsetWidth;
                    const fromY = parseInt(fromNode.style.top) + fromNode.offsetHeight / 2;
                    const toX = parseInt(toNode.style.left);
                    const toY = parseInt(toNode.style.top) + toNode.offsetHeight / 2;

                    // Create path
                    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                    const midX = (fromX + toX) / 2;

                    const d = \`M \${fromX} \${fromY} C \${midX} \${fromY}, \${midX} \${toY}, \${toX} \${toY}\`;
                    path.setAttribute('d', d);
                    path.setAttribute('class', 'relation-line');
                    path.setAttribute('marker-end', 'url(#arrowhead)');

                    svg.appendChild(path);
                });
            });

            updateSvgSize();
        }

        function updateSvgSize() {
            const canvas = document.getElementById('erdCanvas');
            const svg = document.getElementById('relationsSvg');
            svg.setAttribute('width', canvas.scrollWidth);
            svg.setAttribute('height', canvas.scrollHeight);
        }

        function updateCanvasSize() {
            const canvas = document.getElementById('erdCanvas');
            let maxX = 0, maxY = 0;

            document.querySelectorAll('.table-node').forEach(node => {
                const right = parseInt(node.style.left) + node.offsetWidth + 100;
                const bottom = parseInt(node.style.top) + node.offsetHeight + 100;
                maxX = Math.max(maxX, right);
                maxY = Math.max(maxY, bottom);
            });

            canvas.style.width = maxX + 'px';
            canvas.style.height = maxY + 'px';
            updateSvgSize();
        }

        function setupPanning(container) {
            container.addEventListener('mousedown', (e) => {
                if (e.target === container || e.target.id === 'erdCanvas' || e.target.id === 'relationsSvg') {
                    isPanning = true;
                    panStart = { x: e.clientX, y: e.clientY };
                    scrollStart = { x: container.scrollLeft, y: container.scrollTop };
                    container.style.cursor = 'grabbing';
                }
            });
        }

        document.addEventListener('mousemove', (e) => {
            if (isDragging && dragTarget) {
                const container = document.getElementById('canvasContainer');
                const x = e.clientX - dragOffset.x + container.scrollLeft;
                const y = e.clientY - dragOffset.y + container.scrollTop;

                dragTarget.style.left = Math.max(0, x) + 'px';
                dragTarget.style.top = Math.max(0, y) + 'px';

                const tableName = dragTarget.id.replace('table-', '');
                tablePositions[tableName] = { x: Math.max(0, x), y: Math.max(0, y) };

                drawRelations();
                updateCanvasSize();
            }

            if (isPanning) {
                const container = document.getElementById('canvasContainer');
                const dx = panStart.x - e.clientX;
                const dy = panStart.y - e.clientY;
                container.scrollLeft = scrollStart.x + dx;
                container.scrollTop = scrollStart.y + dy;
            }
        });

        document.addEventListener('mouseup', () => {
            if (dragTarget) {
                dragTarget.classList.remove('dragging');
            }
            isDragging = false;
            dragTarget = null;
            isPanning = false;
            document.getElementById('canvasContainer').style.cursor = 'grab';
        });

        // Zoom functions
        function zoomIn() {
            zoom = Math.min(zoom + 0.1, 2);
            applyZoom();
        }

        function zoomOut() {
            zoom = Math.max(zoom - 0.1, 0.3);
            applyZoom();
        }

        function resetZoom() {
            zoom = 1;
            applyZoom();
        }

        function applyZoom() {
            const canvas = document.getElementById('erdCanvas');
            canvas.style.transform = \`scale(\${zoom})\`;
            canvas.style.transformOrigin = '0 0';
            document.getElementById('zoomLevel').textContent = Math.round(zoom * 100) + '%';
        }

        // Auto layout
        function autoLayout() {
            const positions = calculateGridLayout(tables);
            tablePositions = positions;

            tables.forEach(table => {
                const node = document.getElementById('table-' + table.name);
                if (node) {
                    node.style.left = positions[table.name].x + 'px';
                    node.style.top = positions[table.name].y + 'px';
                }
            });

            drawRelations();
            updateCanvasSize();
        }

        // Export functions
        function exportSVG() {
            const canvas = document.getElementById('erdCanvas');
            const clone = canvas.cloneNode(true);

            // Create SVG wrapper
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
            svg.setAttribute('width', canvas.scrollWidth);
            svg.setAttribute('height', canvas.scrollHeight);

            // Add styles
            const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
            style.textContent = \`
                .table-node { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
                .table-header { fill: #2d2d2d; font-weight: bold; }
                .column-row { font-size: 12px; }
                .pk { fill: #f0ad4e; }
                .fk { fill: #5bc0de; }
                .relation-line { fill: none; stroke: #28a745; stroke-width: 2; }
            \`;
            svg.appendChild(style);

            // Copy SVG relations
            const relationsSvg = document.getElementById('relationsSvg');
            svg.innerHTML += relationsSvg.innerHTML;

            // Convert table nodes to SVG elements
            document.querySelectorAll('.table-node').forEach(node => {
                const x = parseInt(node.style.left);
                const y = parseInt(node.style.top);
                const width = node.offsetWidth;
                const height = node.offsetHeight;

                const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
                g.setAttribute('transform', \`translate(\${x}, \${y})\`);

                // Background
                const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                rect.setAttribute('width', width);
                rect.setAttribute('height', height);
                rect.setAttribute('fill', '#1e1e1e');
                rect.setAttribute('stroke', '#3c3c3c');
                rect.setAttribute('rx', '6');
                g.appendChild(rect);

                // Header
                const headerRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                headerRect.setAttribute('width', width);
                headerRect.setAttribute('height', '36');
                headerRect.setAttribute('fill', '#2d2d2d');
                headerRect.setAttribute('rx', '6');
                g.appendChild(headerRect);

                // Table name
                const tableName = node.querySelector('.table-header span:last-child').textContent;
                const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                text.setAttribute('x', '12');
                text.setAttribute('y', '24');
                text.setAttribute('fill', 'white');
                text.setAttribute('font-weight', 'bold');
                text.setAttribute('font-size', '13');
                text.textContent = '📋 ' + tableName;
                g.appendChild(text);

                // Columns
                let columnY = 50;
                node.querySelectorAll('.column-row').forEach(col => {
                    const colName = col.querySelector('.column-name').textContent;
                    const colType = col.querySelector('.column-type').textContent;
                    const keyBadge = col.querySelector('.column-key');

                    if (keyBadge && keyBadge.textContent) {
                        const badge = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                        badge.setAttribute('x', '12');
                        badge.setAttribute('y', columnY - 10);
                        badge.setAttribute('width', '24');
                        badge.setAttribute('height', '14');
                        badge.setAttribute('fill', keyBadge.classList.contains('pk') ? '#f0ad4e' : '#5bc0de');
                        badge.setAttribute('rx', '3');
                        g.appendChild(badge);

                        const badgeText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                        badgeText.setAttribute('x', '16');
                        badgeText.setAttribute('y', columnY);
                        badgeText.setAttribute('fill', 'black');
                        badgeText.setAttribute('font-size', '9');
                        badgeText.setAttribute('font-weight', 'bold');
                        badgeText.textContent = keyBadge.textContent;
                        g.appendChild(badgeText);
                    }

                    const colText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                    colText.setAttribute('x', '44');
                    colText.setAttribute('y', columnY);
                    colText.setAttribute('fill', 'white');
                    colText.setAttribute('font-size', '12');
                    colText.textContent = colName;
                    g.appendChild(colText);

                    const typeText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                    typeText.setAttribute('x', width - 12);
                    typeText.setAttribute('y', columnY);
                    typeText.setAttribute('fill', '#888');
                    typeText.setAttribute('font-size', '11');
                    typeText.setAttribute('text-anchor', 'end');
                    typeText.textContent = colType;
                    g.appendChild(typeText);

                    columnY += 20;
                });

                svg.appendChild(g);
            });

            const svgString = new XMLSerializer().serializeToString(svg);
            vscode.postMessage({ command: 'exportSVG', svg: svgString });
        }

        function exportPNG() {
            const canvas = document.getElementById('erdCanvas');
            const htmlCanvas = document.createElement('canvas');
            const ctx = htmlCanvas.getContext('2d');

            htmlCanvas.width = canvas.scrollWidth * 2;
            htmlCanvas.height = canvas.scrollHeight * 2;
            ctx.scale(2, 2);

            // Background
            ctx.fillStyle = '#1e1e1e';
            ctx.fillRect(0, 0, canvas.scrollWidth, canvas.scrollHeight);

            // Draw relations
            tables.forEach(table => {
                table.foreignKeys.forEach(fk => {
                    const fromNode = document.getElementById('table-' + table.name);
                    const toNode = document.getElementById('table-' + fk.referencedTable);
                    if (!fromNode || !toNode) return;

                    const fromX = parseInt(fromNode.style.left) + fromNode.offsetWidth;
                    const fromY = parseInt(fromNode.style.top) + fromNode.offsetHeight / 2;
                    const toX = parseInt(toNode.style.left);
                    const toY = parseInt(toNode.style.top) + toNode.offsetHeight / 2;

                    ctx.strokeStyle = '#28a745';
                    ctx.lineWidth = 2;
                    ctx.beginPath();
                    ctx.moveTo(fromX, fromY);
                    const midX = (fromX + toX) / 2;
                    ctx.bezierCurveTo(midX, fromY, midX, toY, toX, toY);
                    ctx.stroke();

                    // Arrow
                    ctx.fillStyle = '#28a745';
                    ctx.beginPath();
                    ctx.moveTo(toX, toY);
                    ctx.lineTo(toX - 8, toY - 4);
                    ctx.lineTo(toX - 8, toY + 4);
                    ctx.closePath();
                    ctx.fill();
                });
            });

            // Draw tables
            document.querySelectorAll('.table-node').forEach(node => {
                const x = parseInt(node.style.left);
                const y = parseInt(node.style.top);
                const width = node.offsetWidth;
                const height = node.offsetHeight;

                // Box
                ctx.fillStyle = '#252526';
                ctx.strokeStyle = '#3c3c3c';
                ctx.lineWidth = 1;
                roundRect(ctx, x, y, width, height, 6);
                ctx.fill();
                ctx.stroke();

                // Header
                ctx.fillStyle = '#2d2d2d';
                roundRect(ctx, x, y, width, 36, 6, true);
                ctx.fill();

                // Table name
                const tableName = node.querySelector('.table-header span:last-child').textContent;
                ctx.fillStyle = 'white';
                ctx.font = 'bold 13px -apple-system, sans-serif';
                ctx.fillText('📋 ' + tableName, x + 12, y + 24);

                // Columns
                let colY = y + 50;
                node.querySelectorAll('.column-row').forEach(col => {
                    const colName = col.querySelector('.column-name').textContent;
                    const colType = col.querySelector('.column-type').textContent;
                    const keyBadge = col.querySelector('.column-key');

                    if (keyBadge && keyBadge.textContent) {
                        ctx.fillStyle = keyBadge.classList.contains('pk') ? '#f0ad4e' : '#5bc0de';
                        roundRect(ctx, x + 12, colY - 10, 24, 14, 3);
                        ctx.fill();

                        ctx.fillStyle = 'black';
                        ctx.font = 'bold 9px sans-serif';
                        ctx.fillText(keyBadge.textContent, x + 16, colY);
                    }

                    ctx.fillStyle = 'white';
                    ctx.font = '12px monospace';
                    ctx.fillText(colName, x + 44, colY);

                    ctx.fillStyle = '#888';
                    ctx.font = '11px monospace';
                    ctx.textAlign = 'right';
                    ctx.fillText(colType, x + width - 12, colY);
                    ctx.textAlign = 'left';

                    colY += 20;
                });
            });

            const dataUrl = htmlCanvas.toDataURL('image/png');
            vscode.postMessage({ command: 'exportPNG', dataUrl });
        }

        function roundRect(ctx, x, y, w, h, r, topOnly = false) {
            ctx.beginPath();
            ctx.moveTo(x + r, y);
            ctx.lineTo(x + w - r, y);
            ctx.quadraticCurveTo(x + w, y, x + w, y + r);
            if (topOnly) {
                ctx.lineTo(x + w, y + h);
                ctx.lineTo(x, y + h);
            } else {
                ctx.lineTo(x + w, y + h - r);
                ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
                ctx.lineTo(x + r, y + h);
                ctx.quadraticCurveTo(x, y + h, x, y + h - r);
            }
            ctx.lineTo(x, y + r);
            ctx.quadraticCurveTo(x, y, x + r, y);
            ctx.closePath();
        }

        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey || e.metaKey) {
                if (e.key === '=' || e.key === '+') {
                    e.preventDefault();
                    zoomIn();
                } else if (e.key === '-') {
                    e.preventDefault();
                    zoomOut();
                } else if (e.key === '0') {
                    e.preventDefault();
                    resetZoom();
                }
            }
        });

        // Mouse wheel zoom
        document.getElementById('canvasContainer').addEventListener('wheel', (e) => {
            if (e.ctrlKey) {
                e.preventDefault();
                if (e.deltaY < 0) {
                    zoomIn();
                } else {
                    zoomOut();
                }
            }
        });
    </script>
</body>
</html>`;
    }

    private _getLoadingHtml(): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Loading ERD...</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, sans-serif);
            color: var(--vscode-foreground);
            background: var(--vscode-editor-background);
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
        }
        .loading-container { text-align: center; }
        .bunny {
            font-size: 4rem;
            animation: hop 0.5s ease-in-out infinite alternate;
        }
        @keyframes hop {
            from { transform: translateY(0); }
            to { transform: translateY(-12px); }
        }
        .spinner-container { margin: 24px 0; }
        .spinner {
            width: 48px;
            height: 48px;
            border: 3px solid var(--vscode-panel-border);
            border-top-color: var(--vscode-progressBar-background, #007ACC);
            border-radius: 50%;
            animation: spin 0.8s linear infinite;
            margin: 0 auto;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        .message {
            color: var(--vscode-descriptionForeground);
            font-size: 16px;
        }
    </style>
</head>
<body>
    <div class="loading-container">
        <div class="bunny">🐰</div>
        <div class="spinner-container">
            <div class="spinner"></div>
        </div>
        <div class="message">Loading ERD diagram...</div>
    </div>
</body>
</html>`;
    }

    private _escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    public dispose(): void {
        ERDPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const disposable = this._disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }
}
