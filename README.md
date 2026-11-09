# DBunny - VS Code Database Extension

> "Hop into your databases!"

![DBunny Demo](https://raw.githubusercontent.com/chimaek/dbunny/v3.2.0/resources/demo.gif)

**[English](#english)** | **[한국어](#한국어)**

---

## English

A fast and friendly database management extension for VS Code. Connect to 6 different databases, write queries, visualize schemas, and manage your data — all without leaving the editor.

### v3.2.0 release — 2026-11-09

- Browse SQL routines and inspect their source and parameters.
- Keep DB/SSH credentials in SecretStorage and enforce shared read-only checks.
- Fix PostgreSQL SSH database switching and clarify manual migration-script records.
- [Full changelog](https://github.com/chimaek/dbunny/blob/v3.2.0/CHANGELOG.md) · [Publication time and release record](https://github.com/chimaek/dbunny/releases/tag/v3.2.0)

### Supported Databases

| Database | Port | Driver |
|----------|------|--------|
| MySQL | 3306 | mysql2 |
| PostgreSQL | 5432 | pg |
| SQLite | - | sql.js (WebAssembly) |
| H2 | 5435 | pg (PostgreSQL wire protocol) |
| MongoDB | 27017 | mongodb |
| Redis | 6379 | redis |

### Features

#### Connection Management

- **Credential Storage** — Database and SSH credentials stored in VS Code SecretStorage with automatic migration
- **Connection Grouping** — Organize into folders (dev / staging / prod)
- **SSH Tunneling (MySQL / PostgreSQL)** — Connect through a local TCP forwarding tunnel
- **Schema Explorer** — Browse databases, tables, and columns in a tree view
- **Table Favorites** — Star frequently used tables for quick access
- **Read-Only Mode** — Lock connections to prevent accidental writes on production databases
  - Blocks INSERT, UPDATE, DELETE, DROP, ALTER, CREATE, TRUNCATE, and more
  - Redis/MongoDB write command detection
  - Lock icon (🔒) in tree view, warning banner in query editor
  - Emergency unlock with modal confirmation dialog
- **Connection Color Coding** — Assign colors to visually distinguish environments
  - 8 preset colors: Red (Production), Orange (Staging), Green (Development), Blue (Local), and more
  - Color indicator in tree view, tab bar, connection badge, and status bar
  - Production warning banner for red-colored connections
  - Custom labels per connection (e.g., "Production", "Dev")
- **Connection Duplication & Sharing** — Clone, export, import, and template connections
  - One-click duplication with all settings preserved
  - Export as `.dbunny.json` (passwords excluded) for sharing with team members
  - Import shared connection files with validation
  - Save connections as reusable templates (up to 50)
- **Data Import** — Import CSV, JSON, and Excel (.xlsx) files directly into tables
  - Column mapping preview with auto-suggested mappings
  - Conflict handling: Skip / Overwrite / Upsert
  - Progress bar with real-time inserted/skipped/failed counters
- **Excel Export** — Export table data and query results as `.xlsx` files
  - Single table or multi-sheet export (all tables per database)
  - Column type row with PK, NOT NULL, DEFAULT annotations
  - Auto-adjusted column widths
- **Row Insert Form** — Form-based row insertion with field names and types
  - Column constraint auto-detection (NOT NULL, DEFAULT, FK badges)
  - FK reference value dropdown selection
  - CSV paste bulk insert with preview
- **Data Statistics Panel** — Per-column statistics dashboard
  - Min / Max / Avg, NULL ratio, distinct count
  - Top frequent values with visual bar chart
- **Simple Charts** — SVG-based chart visualization for query results
  - Bar, Pie, and Line charts with aggregation options (Sum / Count / Avg)
  - Auto chart type suggestion based on data characteristics

#### Query Editor

- **Multi-Tab Query Editor** — Open multiple query tabs with per-tab connection assignment (Ctrl+Alt+T)
- **SQL Autocomplete** — Schema-aware suggestions for tables, columns, and keywords
  - Alias recognition (`SELECT u.` → suggests `users` columns)
  - FK-based JOIN ON suggestions
  - Subquery context awareness
  - Multi-table column disambiguation with prefix (`u.name`, `p.title`)
- **SQL CodeLens** — Inline "Run Query" button above each SQL statement
- **SQL Formatter** — Auto-format SQL with keyword uppercase and proper indentation (Shift+Alt+F)
- **Query Execution Plan** — EXPLAIN support for MySQL, PostgreSQL, SQLite (Ctrl+Alt+E)
- **Query History** — Track and reuse previously executed queries
- **Query Bookmarks** — Save frequently used queries with categories
- **MongoDB Shell-Style Commands** — `db.collection.find()` style commands with `.limit()` / `.sort()`. Arguments use JSON syntax with quoted keys; JavaScript expressions are not evaluated.
- **Query Parameters** — `{{variable}}` placeholder syntax with pre-execution input dialog
  - Save/load named variable sets per connection
  - Environment profiles (dev / staging / prod)
  - String literal and comment awareness (ignores placeholders inside quotes)

#### Query Results

- **Result Pinning** — Pin query results to keep them while running new queries
  - Side-by-side comparison of two results (before/after data changes)
  - Pin tab bar with timestamps and custom labels
  - Up to 20 pinned results per query tab
- **Query Result Diff** — Compare two query results with row-level diff
  - Added / Removed / Modified row detection with color markers (+, -, ~)
  - Cell-level change highlighting for modified rows
  - Automatic key column detection (id, _id, code, etc.)
  - Status filter: All / Added / Removed / Modified / Unchanged
  - Export diff report as Markdown or JSON
- **Inline Cell Editing** — Double-click to edit, Tab/Enter to navigate, Ctrl+S to save
- **Cell Expand View** — View long text and JSON with syntax highlighting in a modal
- **Multi-Row Selection** — Ctrl+Click to select, Delete to remove, Ctrl+C to copy
- **Result Filtering** — Global search (Ctrl+F) and per-column filter with value selection
- **Column Management** — Hide/show columns, drag-and-drop reorder, settings saved per query
- **Sorting** — Click column header for ascending/descending, NULL value handling
- **Export** — CSV and JSON export respecting column visibility and filters

#### Visualization

- **ERD Diagram** — Visualize table relationships with foreign key connections
  - 4 layouts: Grid, Relationship, Hierarchical, Circular
  - Orthogonal line routing to prevent overlapping
  - Drag & drop positioning with smooth animations
  - Export to SVG and PNG
- **Visual Table Editor** — GUI-based data editing with pending changes highlight
- **Schema Compare** — Side-by-side schema diff with Markdown report export

#### Development Tools

- **Routine Browser** — Browse procedures, functions, views and triggers, including source and parameters (capabilities vary by database)

- **Mock Data Generator** — Generate test data with various types (names, emails, dates, numbers, etc.)
- **DB Migration** — Version-managed UP/DOWN scripts, SQL export, and manual application/rollback records (SQL is not executed automatically)
- **Copy Table Schema** — Copy CREATE TABLE statement to clipboard

#### Monitoring

- **Real-time Monitor** — View active processes and server status dashboard (MySQL / PostgreSQL)
- **Process Management** — Terminate supported server processes when the connection is writable and the account has permission
- **Auto-refresh** — Configurable refresh intervals

#### Security

- DB and SSH credentials kept in VS Code SecretStorage
- Parameterized metadata queries and identifier escaping/validation in supported operations
- HTML escaping and safer serialization for Webview content
- Webview Content Security Policy with nonce-protected scripts and delegated events
- Redis destructive commands (`FLUSHDB`, `FLUSHALL`) blocked
- No telemetry or analytics collection; connections use configured database and SSH endpoints
- Read-only checks cover every entry point and CTE writes. Use database read-only roles for permission enforcement.

### Quick Start

1. Click the **DBunny** icon in the Activity Bar
2. Click **+** to add a new connection
3. Select database type and enter credentials
4. Save the connection.
5. In **Connections**, click **Connect** (the plug icon) next to the saved connection.

### SQLite Example and Compatibility

Requires VS Code 1.85 or later. Runs in a desktop or remote Node.js Extension Host; browser-only vscode.dev is not supported. H2 requires an H2 server with its PostgreSQL protocol enabled.

For a server-free example, add a SQLite connection with database `:memory:` and run `SELECT 1 AS value;`. The result is one row with `value = 1`. In-memory data is discarded on disconnect; choose a file path for persistence.

### Keyboard Shortcuts

| Action | Windows / Linux | Mac |
|--------|-----------------|-----|
| Execute Query | `Ctrl+Enter` / `F5` | `Cmd+Enter` / `F5` |
| New Query | `Ctrl+Alt+N` | `Cmd+Option+N` |
| Multi-Tab Query | `Ctrl+Alt+T` | `Cmd+Option+T` |
| Add Connection | `Ctrl+Alt+D` | `Cmd+Option+D` |
| Save Query | `Ctrl+Alt+S` | `Cmd+Option+S` |
| Execution Plan | `Ctrl+Alt+E` | `Cmd+Option+E` |
| Format SQL | `Shift+Alt+F` | `Shift+Option+F` |
| Search Results | `Ctrl+F` | `Cmd+F` |

### Context Menu

**Connection:** Connect, edit/delete, toggle read-only, organize groups, duplicate/export, or save a template.

**Database:** Open a query, show ERD, manage migration scripts, open supported monitoring, or export data.

**SQL table:** Edit data, copy CREATE TABLE, compare schema, generate mock data, import/export rows, insert a row, or view statistics/charts.

Use the SQL editor and the execution-plan shortcut for EXPLAIN. Available actions depend on the database type.

### Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `dbunny.queryTimeout` | 30000 | Query timeout in milliseconds |
| `dbunny.maxResults` | 1000 | Maximum result rows returned |
| `dbunny.language` | auto | UI language (auto / en / ko) |

Result previews use `dbunny.maxResults`. Single SELECT/CTE reads are bounded at the SQL server; other results are capped before display. Timeouts use PostgreSQL/H2 server limits, MySQL SELECT execution limits plus its client timeout, and MongoDB maxTimeMS. SQLite synchronous execution and Redis commands do not have a server query timeout. Exports use returned rows; increase the limit for larger exports.

Read-only mode helps prevent accidental writes. PostgreSQL also uses server read-only transactions for bounded queries. Use a database account with read-only privileges for production access; SQL classification cannot determine every custom function's effects.

### Testing

Use Node.js 24 LTS. See [Contributing](https://github.com/chimaek/dbunny/blob/v3.2.0/CONTRIBUTING.md) for unit, Extension Host, Docker integration and VSIX tests. See [Publishing](https://github.com/chimaek/dbunny/blob/v3.2.0/docs/PUBLISHING.md) for release tags and OIDC setup.

### Upcoming Features

See [ROADMAP.md](https://github.com/chimaek/dbunny/blob/v3.2.0/ROADMAP.md) for the full version-by-version plan.

---

## 한국어

VS Code에서 6종의 데이터베이스를 연결하고, 쿼리를 작성하고, 스키마를 시각화하고, 데이터를 관리할 수 있는 빠르고 친근한 확장 프로그램입니다.

### v3.2.0 릴리스 — 2026-11-09

- SQL 루틴을 탐색하고 소스·파라미터를 확인할 수 있습니다.
- DB·SSH 인증정보를 SecretStorage에 보관하고 공통 실행 경계에서 읽기 전용을 검사합니다.
- PostgreSQL SSH 연결의 DB 전환을 수정하고, 마이그레이션 스크립트는 수동 작업 기록임을 명확히 했습니다.
- [전체 변경 이력](https://github.com/chimaek/dbunny/blob/v3.2.0/CHANGELOG.md) · [실제 게시 시각과 릴리스 기록](https://github.com/chimaek/dbunny/releases/tag/v3.2.0)

### 지원 데이터베이스

| 데이터베이스 | 포트 | 드라이버 |
|-------------|------|----------|
| MySQL | 3306 | mysql2 |
| PostgreSQL | 5432 | pg |
| SQLite | - | sql.js (WebAssembly) |
| H2 | 5435 | pg (PostgreSQL 와이어 프로토콜) |
| MongoDB | 27017 | mongodb |
| Redis | 6379 | redis |

### 기능

#### 연결 관리

- **인증정보 저장** — DB·SSH 비밀번호와 개인키를 VS Code SecretStorage에 보관하고 기존 저장값을 자동 이전
- **연결 그룹화** — 폴더별 정리 (dev / staging / prod)
- **SSH 터널링 (MySQL / PostgreSQL)** — 로컬 TCP 포워딩 터널을 통한 원격 연결
- **스키마 탐색기** — 트리 뷰로 데이터베이스, 테이블, 컬럼 탐색
- **테이블 즐겨찾기** — 별표로 자주 사용하는 테이블 상단 고정
- **읽기 전용 모드** — 프로덕션 DB 보호를 위한 쓰기 쿼리 차단
  - INSERT, UPDATE, DELETE, DROP, ALTER, CREATE, TRUNCATE 등 차단
  - Redis/MongoDB 쓰기 명령어 감지
  - 트리뷰 잠금 아이콘 (🔒), 쿼리 에디터 경고 배너
  - 긴급 해제 확인 다이얼로그
- **연결별 컬러 코딩** — 환경별 색상으로 연결을 시각적으로 구분
  - 8가지 프리셋 색상: 빨강(운영), 주황(스테이징), 초록(개발), 파랑(로컬) 등
  - 트리뷰, 탭 바, 연결 배지, 상태 바에 컬러 인디케이터
  - 운영(빨강) 연결 시 경고 배너 표시
  - 연결별 사용자 지정 라벨 (예: "운영", "개발")
- **연결 복제 및 공유** — 복제, 내보내기, 가져오기, 템플릿 기능
  - 원클릭 연결 복제 (모든 설정 보존)
  - `.dbunny.json`으로 내보내기 (비밀번호 제외) — 팀원과 공유
  - 공유받은 연결 파일 가져오기 (유효성 검증 포함)
  - 재사용 가능한 연결 템플릿 저장 (최대 50개)
- **데이터 가져오기** — CSV, JSON, Excel(.xlsx) 파일을 테이블에 직접 가져오기
  - 컬럼 매핑 미리보기 — 자동 매핑 제안 + 수동 변경
  - 충돌 처리: 건너뛰기 / 덮어쓰기 / Upsert
  - 진행률 바 + 삽입/건너뜀/실패 실시간 카운트
- **Excel 내보내기** — 테이블 데이터 및 쿼리 결과를 `.xlsx` 파일로 내보내기
  - 단일 테이블 또는 멀티시트 내보내기 (데이터베이스 전체)
  - 컬럼 타입 행 — PK, NOT NULL, DEFAULT 표시
  - 컬럼 너비 자동 조정
- **행 삽입 폼** — 필드명과 타입이 표시되는 폼 기반 행 삽입
  - 컬럼 제약 조건 자동 감지 (NOT NULL, DEFAULT, FK 배지)
  - FK 참조 값 드롭다운 선택
  - CSV 붙여넣기 일괄 삽입 + 미리보기
- **데이터 통계 패널** — 컬럼별 통계 대시보드
  - 최솟값 / 최댓값 / 평균, NULL 비율, 고유값 수
  - 상위 빈출값 바 차트
- **간단한 차트** — 쿼리 결과 SVG 차트 시각화
  - 막대, 파이, 라인 차트 + 집계 옵션 (합계 / 개수 / 평균)
  - 데이터 특성 기반 차트 유형 자동 추천

#### 쿼리 편집기

- **멀티탭 쿼리 에디터** — 탭별로 연결을 선택하고 여러 쿼리를 정리 (Ctrl+Alt+T)
- **SQL 자동완성** — 스키마 인식 기반 테이블, 컬럼, 키워드 자동 제안
  - 별칭(Alias) 인식 (`SELECT u.` → `users` 컬럼 제안)
  - FK 기반 JOIN ON 자동 제안
  - 서브쿼리 컨텍스트 인식
  - 다중 테이블 컬럼 구분 (`u.name`, `p.title` 접두사 포함)
- **SQL CodeLens** — 각 SQL 구문 위에 인라인 "Run Query" 버튼 표시
- **SQL 포매터** — 키워드 대문자화, 자동 들여쓰기 (Shift+Alt+F)
- **쿼리 실행 계획** — MySQL, PostgreSQL, SQLite EXPLAIN 지원 (Ctrl+Alt+E)
- **쿼리 히스토리** — 이전 실행 쿼리 추적 및 재사용
- **쿼리 북마크** — 카테고리별 자주 사용하는 쿼리 저장
- **MongoDB Shell 스타일 명령** — `db.collection.find()`와 `.limit()` / `.sort()` 지원. 인자는 키를 따옴표로 감싼 JSON 문법을 사용하며 JavaScript 표현식은 실행하지 않습니다.
- **쿼리 파라미터** — `{{변수명}}` 플레이스홀더 문법, 실행 전 입력 다이얼로그
  - 연결별 변수 세트 저장 및 재사용
  - 환경 프로필 (dev / staging / prod)
  - 문자열 리터럴/주석 내부 플레이스홀더 무시

#### 쿼리 결과

- **결과 고정(Pinning)** — 쿼리 결과를 핀으로 고정하여 새 쿼리 실행 시에도 보관
  - 나란히 보기로 두 결과 비교 (변경 전/후 데이터 비교)
  - 핀 탭 바 — 타임스탬프와 사용자 지정 라벨로 관리
  - 쿼리 탭당 최대 20개 핀 지원
- **쿼리 결과 비교(Diff)** — 두 쿼리 결과를 행 단위로 비교
  - 추가 / 삭제 / 변경 행 감지 및 색상 마커 (+, -, ~)
  - 변경 행의 셀 단위 하이라이트
  - 키 컬럼 자동 감지 (id, _id, code 등)
  - 상태별 필터: 전체 / 추가 / 삭제 / 변경 / 동일
  - 비교 리포트를 마크다운 또는 JSON으로 내보내기
- **인라인 셀 편집** — 더블클릭으로 수정, Tab/Enter로 이동, Ctrl+S로 저장
- **셀 확장 뷰** — 긴 텍스트와 JSON을 구문 강조 모달로 표시
- **멀티행 선택** — Ctrl+Click으로 선택, Delete로 삭제, Ctrl+C로 복사
- **결과 필터링** — 전체 검색 (Ctrl+F) 및 컬럼별 값 선택 필터
- **컬럼 관리** — 숨기기/표시, 드래그앤드롭 순서 변경, 쿼리별 설정 저장
- **정렬** — 컬럼 헤더 클릭으로 오름/내림차순, NULL 값 처리
- **내보내기** — 컬럼 가시성과 필터를 반영한 CSV, JSON 내보내기

#### 시각화

- **ERD 다이어그램** — FK 기반 테이블 관계 시각화
  - 4가지 레이아웃: Grid, Relationship, Hierarchical, Circular
  - 직교선 라우팅으로 테이블 겹침 방지
  - 드래그앤드롭 배치, 부드러운 애니메이션
  - SVG, PNG 내보내기
- **비주얼 테이블 편집기** — 변경 사항 하이라이트가 있는 GUI 기반 데이터 편집
- **스키마 비교** — 나란히 비교하는 스키마 Diff 뷰, Markdown 리포트 내보내기

#### 개발 도구

- **루틴 브라우저** — 저장 프로시저·함수·뷰·트리거 탐색, 소스·파라미터 확인 (지원 범위는 DB별로 다름)

- **목 데이터 생성기** — 이름, 이메일, 날짜, 숫자 등 다양한 타입의 테스트 데이터 생성
- **DB 마이그레이션** — UP/DOWN 스크립트 버전 관리·SQL 내보내기·수동 적용/롤백 상태 기록 (SQL 자동 실행은 지원하지 않음)
- **테이블 스키마 복사** — CREATE TABLE 구문을 클립보드에 복사

#### 모니터링

- **실시간 모니터** — 활성 프로세스 및 서버 상태 대시보드 (MySQL / PostgreSQL)
- **프로세스 관리** — 쓰기 가능한 연결에서 DB 계정 권한이 허용하는 서버 프로세스 종료
- **자동 새로고침** — 설정 가능한 갱신 주기

#### 보안

- DB·SSH 인증정보를 VS Code SecretStorage에 보관
- 지원되는 작업에 파라미터화된 메타데이터 쿼리와 식별자 이스케이핑·검증 적용
- Webview 콘텐츠에 HTML 이스케이핑과 안전한 직렬화 적용
- Webview CSP, nonce 스크립트와 이벤트 위임 사용
- Redis 파괴적 명령어 (`FLUSHDB`, `FLUSHALL`) 차단
- 텔레메트리·분석 데이터 수집 없음. 사용자가 설정한 DB·SSH 서버와 통신
- 모든 실행 경로에 읽기 전용 검사 적용, CTE 쓰기·관리 명령 차단. 권한 통제에는 DB 읽기 전용 계정을 함께 사용

### 빠른 시작

1. Activity Bar에서 **DBunny** 아이콘 클릭
2. **+** 버튼으로 새 연결 추가
3. 데이터베이스 유형 선택 후 인증 정보 입력
4. 연결을 저장합니다.
5. **Connections** 목록에서 저장한 연결 옆의 **Connect**(플러그 아이콘)를 클릭합니다.

### SQLite 예제와 호환 범위

VS Code 1.85 이상이 필요하며 데스크톱 또는 원격 Node.js Extension Host에서 실행됩니다. 순수 웹 환경의 vscode.dev는 지원하지 않습니다. H2는 PostgreSQL 프로토콜을 활성화한 H2 서버가 필요합니다.

서버 없이 시작하려면 SQLite 연결의 데이터베이스에 `:memory:`를 입력하고 새 쿼리에서 `SELECT 1 AS value;`를 실행하세요. `value = 1`인 한 행이 나옵니다. 메모리 DB는 연결 해제 시 사라지며, 보관하려면 파일 경로를 선택해야 합니다.

### 키보드 단축키

| 동작 | Windows / Linux | Mac |
|------|-----------------|-----|
| 쿼리 실행 | `Ctrl+Enter` / `F5` | `Cmd+Enter` / `F5` |
| 새 쿼리 | `Ctrl+Alt+N` | `Cmd+Option+N` |
| 멀티탭 쿼리 | `Ctrl+Alt+T` | `Cmd+Option+T` |
| 연결 추가 | `Ctrl+Alt+D` | `Cmd+Option+D` |
| 쿼리 저장 | `Ctrl+Alt+S` | `Cmd+Option+S` |
| 실행 계획 | `Ctrl+Alt+E` | `Cmd+Option+E` |
| SQL 정렬 | `Shift+Alt+F` | `Shift+Option+F` |
| 결과 검색 | `Ctrl+F` | `Cmd+F` |

### 컨텍스트 메뉴

**연결:** 연결하기, 편집·삭제, 읽기 전용 전환, 그룹 관리, 복제·내보내기, 템플릿 저장.

**데이터베이스:** 새 쿼리, ERD, 마이그레이션 스크립트 관리, 지원되는 모니터링, 데이터 내보내기.

**SQL 테이블:** 데이터 편집, CREATE TABLE 복사, 스키마 비교, 목 데이터, 가져오기·내보내기, 행 삽입, 통계·차트.

실행 계획은 SQL 편집기와 실행 계획 단축키에서 확인합니다. DB 종류에 따라 사용할 수 있는 작업이 다릅니다.

### 설정

| 설정 | 기본값 | 설명 |
|------|--------|------|
| `dbunny.queryTimeout` | 30000 | 쿼리 타임아웃 (밀리초) |
| `dbunny.maxResults` | 1000 | 최대 결과 행 수 |
| `dbunny.language` | auto | UI 언어 (auto / en / ko) |

조회 결과는 `dbunny.maxResults`를 따릅니다. 단일 SELECT/CTE는 SQL 서버에서 행 수를 제한하며, 다른 결과도 표시 전에 제한합니다. timeout은 PostgreSQL·H2 서버 설정, MySQL SELECT 실행 제한과 클라이언트 제한, MongoDB maxTimeMS에 적용됩니다. 동기 실행 SQLite와 Redis 명령에는 서버 쿼리 timeout이 적용되지 않습니다. 내보내기도 반환된 행을 사용하므로 필요하면 제한을 늘리세요.

읽기 전용 모드는 실수로 쓰기 작업을 실행하는 것을 막는 기능입니다. PostgreSQL의 제한 조회에는 서버 읽기 전용 트랜잭션 설정도 적용합니다. 사용자 정의 함수의 모든 부작용을 SQL 분류만으로 판단할 수는 없으므로, 운영 환경에는 DB 자체의 읽기 전용 계정을 사용하세요.

### 테스트

개발 환경은 Node.js 24 LTS입니다. 단위·Extension Host·Docker 통합·VSIX 검증은 [개발 가이드](https://github.com/chimaek/dbunny/blob/v3.2.0/CONTRIBUTING.md), 릴리스 태그와 OIDC 설정은 [게시 가이드](https://github.com/chimaek/dbunny/blob/v3.2.0/docs/PUBLISHING.md)를 참고하세요.

### 추가 예정 기능

버전별 상세 계획은 [ROADMAP.md](https://github.com/chimaek/dbunny/blob/v3.2.0/ROADMAP.md)를 참조하세요.

---

## License / 라이선스

See [LICENSE](https://github.com/chimaek/dbunny/blob/v3.2.0/LICENSE) file.
[LICENSE](https://github.com/chimaek/dbunny/blob/v3.2.0/LICENSE) 파일을 참조하세요.

---

**Happy querying!**
