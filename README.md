# DBunny - VS Code Database Extension

> "Hop into your databases!"

![DBunny Demo](resources/demo.gif)

**[English](#english)** | **[한국어](#한국어)**

---

## English

A fast and friendly database management extension for VS Code. Connect to 6 different databases, write queries, visualize schemas, and manage your data — all without leaving the editor.

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

- **Encrypted Storage** — Passwords secured with AES-256-GCM, keys stored in VS Code SecretStorage
- **Connection Grouping** — Organize into folders (dev / staging / prod)
- **SSH Tunneling** — Connect to remote databases through SSH tunnel (local TCP server based)
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
- **MongoDB Shell Syntax** — `db.collection.find()` style commands with chaining (`.limit()`, `.sort()`)
- **Query Parameters** — `{{variable}}` placeholder syntax with pre-execution input dialog
  - Save/load named variable sets per connection
  - Environment profiles (dev / staging / prod)
  - String literal and comment awareness (ignores placeholders inside quotes)

#### Query Results

- **Result Pinning** — Pin query results to keep them while running new queries
  - Side-by-side comparison of two results (before/after data changes)
  - Pin tab bar with timestamps and custom labels
  - Up to 20 pinned results per query tab
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

- **Mock Data Generator** — Generate test data with various types (names, emails, dates, numbers, etc.)
- **DB Migration** — Version-managed UP/DOWN scripts with rollback and SQL export
- **Copy Table Schema** — Copy CREATE TABLE statement to clipboard

#### Monitoring

- **Real-time Monitor** — View active processes and server status dashboard (MySQL / PostgreSQL)
- **Process Management** — Kill long-running queries directly from the monitor
- **Auto-refresh** — Configurable refresh intervals

#### Security

- AES-256-GCM password encryption
- SQL injection prevention with parameterized queries and validated identifiers
- XSS prevention with HTML escaping in all WebView panels
- Content Security Policy headers on all WebViews
- Redis destructive commands (`FLUSHDB`, `FLUSHALL`) blocked
- No data sent to external servers

### Quick Start

1. Click the **DBunny** icon in the Activity Bar
2. Click **+** to add a new connection
3. Select database type and enter credentials
4. Click **Save & Connect**

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

**Right-click on tables:**

- Edit Table Data
- Copy Table Schema
- Show ERD Diagram
- Generate Mock Data
- Query Execution Plan

**Right-click on connections:**

- Show Real-time Monitor
- Compare Schema
- DB Migration

### Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `dbunny.queryTimeout` | 30000 | Query timeout in milliseconds |
| `dbunny.maxResults` | 1000 | Maximum result rows returned |
| `dbunny.language` | auto | UI language (auto / en / ko) |

### Testing

```bash
# Start test DB containers (MySQL, PostgreSQL, MongoDB, Redis, H2)
docker compose up -d

# Run integration tests (121 tests across 6 DBs)
npx tsx src/test/integration/run-all.ts

# SQL autocomplete integration tests (MySQL + PostgreSQL)
npx tsx src/test/integration/completion.test.ts

# Query parameter integration tests (MySQL + PostgreSQL)
npx tsx src/test/integration/queryParameter.test.ts

# Result pinning integration tests (MySQL + PostgreSQL)
npx tsx src/test/integration/resultPin.test.ts

# SQL parser unit tests (no DB required)
npx tsx src/test/unit/sqlParser.standalone.ts

# Query parameter unit tests (no DB required)
npx tsx src/test/unit/queryParameter.standalone.ts

# Result pinning unit tests (no DB required)
npx tsx src/test/unit/resultPin.standalone.ts

# Unit tests
npm test
```

### Upcoming Features

See [ROADMAP.md](ROADMAP.md) for the full version-by-version plan.

---

## 한국어

VS Code에서 6종의 데이터베이스를 연결하고, 쿼리를 작성하고, 스키마를 시각화하고, 데이터를 관리할 수 있는 빠르고 친근한 확장 프로그램입니다.

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

- **암호화 저장** — AES-256-GCM으로 비밀번호 암호화, VS Code SecretStorage에 키 저장
- **연결 그룹화** — 폴더별 정리 (dev / staging / prod)
- **SSH 터널링** — SSH 터널을 통한 원격 데이터베이스 연결 (로컬 TCP 서버 기반)
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

#### 쿼리 편집기

- **멀티탭 쿼리 에디터** — 탭별 연결 할당, 여러 쿼리를 동시에 작업 (Ctrl+Alt+T)
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
- **MongoDB Shell 문법** — `db.collection.find()` 스타일 명령어, 체이닝 지원 (`.limit()`, `.sort()`)
- **쿼리 파라미터** — `{{변수명}}` 플레이스홀더 문법, 실행 전 입력 다이얼로그
  - 연결별 변수 세트 저장 및 재사용
  - 환경 프로필 (dev / staging / prod)
  - 문자열 리터럴/주석 내부 플레이스홀더 무시

#### 쿼리 결과

- **결과 고정(Pinning)** — 쿼리 결과를 핀으로 고정하여 새 쿼리 실행 시에도 보관
  - 나란히 보기로 두 결과 비교 (변경 전/후 데이터 비교)
  - 핀 탭 바 — 타임스탬프와 사용자 지정 라벨로 관리
  - 쿼리 탭당 최대 20개 핀 지원
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

- **목 데이터 생성기** — 이름, 이메일, 날짜, 숫자 등 다양한 타입의 테스트 데이터 생성
- **DB 마이그레이션** — 버전 관리 기반 UP/DOWN 스크립트, 롤백 및 SQL 내보내기
- **테이블 스키마 복사** — CREATE TABLE 구문을 클립보드에 복사

#### 모니터링

- **실시간 모니터** — 활성 프로세스 및 서버 상태 대시보드 (MySQL / PostgreSQL)
- **프로세스 관리** — 모니터에서 장시간 실행 쿼리 직접 종료
- **자동 새로고침** — 설정 가능한 갱신 주기

#### 보안

- AES-256-GCM 비밀번호 암호화
- 파라미터화된 쿼리 및 식별자 검증으로 SQL 인젝션 방지
- 모든 WebView 패널에서 HTML 이스케이핑으로 XSS 방지
- 모든 WebView에 Content Security Policy 헤더 적용
- Redis 파괴적 명령어 (`FLUSHDB`, `FLUSHALL`) 차단
- 외부 서버로 데이터 전송 없음

### 빠른 시작

1. Activity Bar에서 **DBunny** 아이콘 클릭
2. **+** 버튼으로 새 연결 추가
3. 데이터베이스 유형 선택 후 인증 정보 입력
4. **Save & Connect** 클릭

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

**테이블 우클릭:**

- 테이블 데이터 편집
- 테이블 스키마 복사
- ERD 다이어그램 표시
- 목 데이터 생성
- 쿼리 실행 계획

**연결 우클릭:**

- 실시간 모니터 표시
- 스키마 비교
- DB 마이그레이션

### 설정

| 설정 | 기본값 | 설명 |
|------|--------|------|
| `dbunny.queryTimeout` | 30000 | 쿼리 타임아웃 (밀리초) |
| `dbunny.maxResults` | 1000 | 최대 결과 행 수 |
| `dbunny.language` | auto | UI 언어 (auto / en / ko) |

### 테스트

```bash
# 테스트용 DB 컨테이너 실행 (MySQL, PostgreSQL, MongoDB, Redis, H2)
docker compose up -d

# 통합 테스트 실행 (6개 DB 대상 121개 테스트)
npx tsx src/test/integration/run-all.ts

# SQL 자동완성 통합 테스트 (MySQL + PostgreSQL)
npx tsx src/test/integration/completion.test.ts

# 쿼리 파라미터 통합 테스트 (MySQL + PostgreSQL)
npx tsx src/test/integration/queryParameter.test.ts

# 결과 고정(Pin) 통합 테스트 (MySQL + PostgreSQL)
npx tsx src/test/integration/resultPin.test.ts

# SQL 파서 유닛 테스트 (DB 불필요)
npx tsx src/test/unit/sqlParser.standalone.ts

# 쿼리 파라미터 유닛 테스트 (DB 불필요)
npx tsx src/test/unit/queryParameter.standalone.ts

# 결과 고정(Pin) 유닛 테스트 (DB 불필요)
npx tsx src/test/unit/resultPin.standalone.ts

# 단위 테스트
npm test
```

### 추가 예정 기능

버전별 상세 계획은 [ROADMAP.md](ROADMAP.md)를 참조하세요.

---

## License / 라이선스

See [LICENSE](https://files.chimaek.net/api/public/dl/53IQI0eG?inline=true) file.
[LICENSE](https://files.chimaek.net/api/public/dl/53IQI0eG?inline=true) 파일을 참조하세요.

---

**Happy querying!**
