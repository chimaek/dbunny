# DBunny - VS Code Database Extension

> "Hop into your databases!"

A fast and friendly database management extension for VS Code.
빠르고 친근한 VS Code 데이터베이스 관리 확장 프로그램입니다.

![DBunny](https://files.chimaek.net/api/public/dl/wcwMPDWj?inline=true)

## Supported Databases / 지원 데이터베이스

- MySQL
- PostgreSQL
- SQLite
- H2 (via PostgreSQL wire protocol)
- MongoDB
- Redis

## Key Features / 주요 기능

### Database Management / 데이터베이스 관리

- **Connection Manager**: Add, edit, delete connections with encrypted passwords
  커넥션 매니저: 암호화된 비밀번호로 연결 추가, 수정, 삭제
- **Connection Grouping**: Organize connections into folders (dev/staging/prod)
  커넥션 그룹: 폴더별 연결 정리 (dev/staging/prod)
- **SSH Tunneling**: Secure remote database connections
  SSH 터널링: 안전한 원격 데이터베이스 연결
- **Schema Explorer**: Browse databases, tables, and columns in tree view
  스키마 탐색기: 트리 뷰로 데이터베이스, 테이블, 컬럼 탐색

### Query Tools / 쿼리 도구

- **Query Editor**: Write and execute SQL with syntax highlighting
  쿼리 편집기: 구문 강조 기능으로 SQL 작성 및 실행
- **Multi-Tab Query**: Work with multiple query tabs simultaneously
  멀티탭 쿼리: 여러 쿼리 탭을 동시에 사용
- **Query History**: Track and reuse previously executed queries
  쿼리 히스토리: 이전 실행 쿼리 추적 및 재사용
- **Query Bookmarks**: Save frequently used queries with categories
  쿼리 북마크: 카테고리별 자주 사용하는 쿼리 저장
- **SQL Formatter**: Auto-format SQL (Shift+Alt+F)
  SQL 포매터: SQL 자동 정렬 (Shift+Alt+F)
- **Execution Plan**: View EXPLAIN results (Ctrl+Shift+E)
  실행 계획: EXPLAIN 결과 확인 (Ctrl+Shift+E)
- **Result Filtering**: Search and filter query results (Ctrl+F)
  결과 필터링: 쿼리 결과 검색 및 필터 (Ctrl+F)
- **Column Management**: Hide, show, and reorder result columns
  컬럼 관리: 결과 컬럼 숨기기, 표시, 순서 변경

### Visualization / 시각화

- **ERD Diagram**: Visualize table relationships
  ERD 다이어그램: 테이블 관계 시각화
  - Multiple layouts: Grid, Relationship, Hierarchical, Circular
    다양한 레이아웃: 그리드, 관계형, 계층형, 원형
  - Drag & drop positioning / 드래그 앤 드롭 배치
  - Export to SVG/PNG / SVG/PNG 내보내기
- **Visual Table Editor**: Edit data directly with GUI
  비주얼 테이블 편집기: GUI로 데이터 직접 편집

### Development Tools / 개발 도구

- **Schema Compare**: Compare schemas between databases with diff view
  스키마 비교: 데이터베이스 간 스키마 차이점 비교
- **Mock Data Generator**: Generate test data with various data types
  목 데이터 생성기: 다양한 데이터 타입의 테스트 데이터 생성
- **DB Migration**: Create and manage database migrations
  DB 마이그레이션: 데이터베이스 마이그레이션 생성 및 관리
- **Copy Table Schema**: Copy CREATE TABLE statement
  테이블 스키마 복사: CREATE TABLE 구문 복사

### Monitoring / 모니터링

- **Real-time Monitor**: View active processes and server status (MySQL/PostgreSQL)
  실시간 모니터: 활성 프로세스 및 서버 상태 확인 (MySQL/PostgreSQL)
- **Process Management**: Kill long-running queries
  프로세스 관리: 장시간 실행 쿼리 종료

## Quick Start / 빠른 시작

1. Click **DBunny** icon in Activity Bar
   Activity Bar에서 **DBunny** 아이콘 클릭
2. Click **+** to add connection
   **+** 버튼으로 연결 추가
3. Select database type and enter credentials
   데이터베이스 유형 선택 후 인증 정보 입력
4. Click **Save & Connect**
   **Save & Connect** 클릭

## Keyboard Shortcuts / 키보드 단축키

| Action | Windows/Linux | Mac |
|--------|---------------|-----|
| Execute Query / 쿼리 실행 | `Ctrl+Enter` / `F5` | `Cmd+Enter` / `F5` |
| New Query / 새 쿼리 | `Ctrl+Alt+N` | `Cmd+Option+N` |
| Multi-Tab Query / 멀티탭 쿼리 | `Ctrl+Alt+T` | `Cmd+Option+T` |
| Add Connection / 연결 추가 | `Ctrl+Alt+D` | `Cmd+Option+D` |
| Save Query / 쿼리 저장 | `Ctrl+Alt+S` | `Cmd+Option+S` |
| Execution Plan / 실행 계획 | `Ctrl+Alt+E` | `Cmd+Option+E` |
| Format SQL / SQL 정렬 | `Shift+Alt+F` | `Shift+Option+F` |
| Search Results / 결과 검색 | `Ctrl+F` | `Cmd+F` |

## Context Menu / 컨텍스트 메뉴

Right-click on tables: / 테이블 우클릭:

- Edit Table Data / 테이블 데이터 편집
- Copy Table Schema / 테이블 스키마 복사
- Show ERD Diagram / ERD 다이어그램 표시
- Generate Mock Data / 목 데이터 생성
- Query Execution Plan / 쿼리 실행 계획

Right-click on connections: / 연결 우클릭:

- Show Real-time Monitor / 실시간 모니터 표시
- Compare Schema / 스키마 비교
- DB Migration / DB 마이그레이션

## Settings / 설정

| Setting | Default | Description / 설명 |
|---------|---------|-------------|
| `dbunny.queryTimeout` | 30000 | Query timeout (ms) / 쿼리 타임아웃 (ms) |
| `dbunny.maxResults` | 1000 | Max result rows / 최대 결과 행 수 |
| `dbunny.language` | auto | UI language (auto/en/ko) / UI 언어 (auto/en/ko) |

## Security / 보안

- Passwords encrypted with AES-256-GCM
  AES-256-GCM으로 비밀번호 암호화
- Encryption keys stored in VS Code secure storage
  VS Code 보안 저장소에 암호화 키 저장
- SQL injection prevention with parameterized queries and validated identifiers
  파라미터화된 쿼리와 식별자 검증으로 SQL 인젝션 방지
- XSS prevention in all WebView panels (HTML escaping)
  모든 WebView 패널에서 XSS 방지 (HTML 이스케이핑)
- Redis destructive commands (`FLUSHDB`, `FLUSHALL`) blocked
  Redis 파괴적 명령어 (`FLUSHDB`, `FLUSHALL`) 차단
- No data sent to external servers
  외부 서버로 데이터 전송 없음

## Testing / 테스트

Integration test environment using Docker Compose.
Docker Compose를 이용한 통합 테스트 환경을 제공합니다.

```bash
# Start test DB containers (MySQL, PostgreSQL, MongoDB, Redis, H2)
# 테스트용 DB 컨테이너 실행 (MySQL, PostgreSQL, MongoDB, Redis, H2)
docker compose up -d

# Run integration tests (121 tests across 6 DBs)
# 통합 테스트 실행 (6개 DB 대상 121개 테스트)
npx tsx src/test/integration/run-all.ts
```

- Seed data auto-generated (`docker-init/`)
  초기 시드 데이터 자동 생성 (`docker-init/`)
- Unit tests: `npm test`
  단위 테스트: `npm test`

## License / 라이선스

See [LICENSE](https://files.chimaek.net/api/public/dl/53IQI0eG?inline=true) file.
[LICENSE](https://files.chimaek.net/api/public/dl/53IQI0eG?inline=true) 파일을 참조하세요.

---

**Happy querying!**
