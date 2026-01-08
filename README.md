# DBunny - VS Code Database Extension

> "Hop into your databases!"

A fast and friendly database management extension for VS Code.

![DBunny](https://files.chimaek.net/api/public/dl/wcwMPDWj?inline=true)

## Supported Databases

- MySQL
- PostgreSQL
- SQLite
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
| New Query | `Ctrl+Shift+Q` | `Cmd+Shift+Q` |
| Execute Query | `Ctrl+Enter` / `F5` | `Cmd+Enter` / `F5` |
| Multi-Tab Query | `Ctrl+Shift+T` | `Cmd+Shift+T` |
| Add Connection | `Ctrl+Shift+D` | `Cmd+Shift+D` |
| Format SQL | `Shift+Alt+F` | `Shift+Option+F` |
| Execution Plan | `Ctrl+Shift+E` | `Cmd+Shift+E` |
| Save Query | `Ctrl+Shift+S` | `Cmd+Shift+S` |

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
- No data sent to external servers

## License

See [LICENSE](LICENSE) file.

---

**Happy querying!**
