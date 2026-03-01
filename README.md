# DBunny - VS Code Database Extension

> "Hop into your databases!"

A fast and friendly database management extension for VS Code.

![DBunny](https://files.chimaek.net/api/public/dl/wcwMPDWj?inline=true)

## Supported Databases

- MySQL
- PostgreSQL
- SQLite
- H2 (via PostgreSQL wire protocol)
- MongoDB
- Redis

## Key Features

### Database Management

- **Connection Manager**: Add, edit, delete connections with encrypted passwords
- **Connection Grouping**: Organize connections into folders (dev/staging/prod)
- **SSH Tunneling**: Secure remote database connections
- **Schema Explorer**: Browse databases, tables, and columns in tree view

### Query Tools

- **Query Editor**: Write and execute SQL with syntax highlighting
- **Multi-Tab Query**: Work with multiple query tabs simultaneously
- **Query History**: Track and reuse previously executed queries
- **Query Bookmarks**: Save frequently used queries with categories
- **SQL Formatter**: Auto-format SQL (Shift+Alt+F)
- **Execution Plan**: View EXPLAIN results (Ctrl+Shift+E)
- **Result Filtering**: Search and filter query results (Ctrl+F)
- **Column Management**: Hide, show, and reorder result columns

### Visualization

- **ERD Diagram**: Visualize table relationships
  - Multiple layouts: Grid, Relationship, Hierarchical, Circular
  - Drag & drop positioning
  - Export to SVG/PNG
- **Visual Table Editor**: Edit data directly with GUI

### Development Tools

- **Schema Compare**: Compare schemas between databases with diff view
- **Mock Data Generator**: Generate test data with various data types
- **DB Migration**: Create and manage database migrations
- **Copy Table Schema**: Copy CREATE TABLE statement

### Monitoring

- **Real-time Monitor**: View active processes and server status (MySQL/PostgreSQL)
- **Process Management**: Kill long-running queries

## Quick Start

1. Click **DBunny** icon in Activity Bar
2. Click **+** to add connection
3. Select database type and enter credentials
4. Click **Save & Connect**

## Keyboard Shortcuts

| Action | Windows/Linux | Mac |
|--------|---------------|-----|
| Execute Query | `Ctrl+Enter` / `F5` | `Cmd+Enter` / `F5` |
| New Query | `Ctrl+Alt+N` | `Cmd+Option+N` |
| Multi-Tab Query | `Ctrl+Alt+T` | `Cmd+Option+T` |
| Add Connection | `Ctrl+Alt+D` | `Cmd+Option+D` |
| Save Query | `Ctrl+Alt+S` | `Cmd+Option+S` |
| Execution Plan | `Ctrl+Alt+E` | `Cmd+Option+E` |
| Format SQL | `Shift+Alt+F` | `Shift+Option+F` |
| Search Results | `Ctrl+F` | `Cmd+F` |

## Context Menu

Right-click on tables:

- Edit Table Data
- Copy Table Schema
- Show ERD Diagram
- Generate Mock Data
- Query Execution Plan

Right-click on connections:

- Show Real-time Monitor
- Compare Schema
- DB Migration

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `dbunny.queryTimeout` | 30000 | Query timeout (ms) |
| `dbunny.maxResults` | 1000 | Max result rows |
| `dbunny.language` | auto | UI language (auto/en/ko) |

## Security

- Passwords encrypted with AES-256-GCM
- Encryption keys stored in VS Code secure storage
- SQL injection prevention with parameterized queries and validated identifiers
- XSS prevention in all WebView panels (HTML escaping)
- Redis destructive commands (`FLUSHDB`, `FLUSHALL`) blocked
- No data sent to external servers

## Testing

Docker Compose를 이용한 통합 테스트 환경을 제공합니다.

```bash
# 테스트용 DB 컨테이너 실행 (MySQL, PostgreSQL, MongoDB, Redis, H2)
docker compose up -d

# 통합 테스트 실행 (6개 DB 대상 121개 테스트)
npx tsx src/test/integration/run-all.ts
```

- 초기 시드 데이터 자동 생성 (`docker-init/`)
- 단위 테스트: `npm test`

## License

See [LICENSE](https://files.chimaek.net/api/public/dl/53IQI0eG?inline=true) file.

---

**Happy querying!**
