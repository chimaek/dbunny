# Changelog

All notable changes to the DBunny extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.6.0] - 2026-03-22

### Added

- **Data Import**: Import CSV, JSON, and Excel (.xlsx) files directly into database tables
  - File format auto-detection based on extension
  - CSV parsing with PapaParse (handles quoted fields, multiline, BOM)
  - JSON array of objects import with auto-header extraction
  - Excel import via SheetJS (first sheet)
- **Column Mapping Preview**: Visual column mapping interface in WebView panel
  - Auto-suggests mappings based on column name similarity
  - Manual column reassignment via dropdown selectors
  - Data preview table with first 50 rows
- **Conflict Handling Options**: Three strategies for duplicate key conflicts
  - Skip: INSERT IGNORE / ON CONFLICT DO NOTHING
  - Overwrite: ON DUPLICATE KEY UPDATE / ON CONFLICT DO UPDATE
  - Upsert: MERGE INTO (H2) / INSERT OR REPLACE (SQLite)
  - Database-specific SQL generation for MySQL, PostgreSQL, SQLite, H2
- **Import Progress**: Real-time progress display for large files
  - Progress bar with batch-level updates
  - Live counters: inserted / skipped / failed
  - Error list with row numbers and messages (up to 100 errors)
- **Data Import Utility** (`src/utils/dataImport.ts`): File parsing, SQL generation, batch import with conflict strategies
- **Data Import Panel** (`src/webview/DataImportPanel.ts`): WebView panel with column mapping, preview, and progress UI
- Read-only mode protection: blocks import on read-only connections
- Context menu: "Import Data" available on SQL table items (regular and favorite)

### Dependencies

- Added `xlsx` (SheetJS) for Excel file parsing
- Added `papaparse` for robust CSV parsing

## [2.5.0] - 2026-03-20

### Added

- **Connection Duplication**: One-click clone of existing connections via context menu
  - Preserves all settings including encrypted password, group, color, and read-only mode
  - Automatically appends "(Copy)" to the duplicated connection name
- **Connection Export**: Export connection settings as JSON (passwords excluded)
  - Single connection export via context menu
  - Export all connections via explorer title menu
  - `.dbunny.json` envelope format with version and timestamp metadata
- **Connection Import**: Import shared connection settings from JSON files
  - Schema validation with detailed error messages
  - Supports all 6 database types (MySQL, PostgreSQL, SQLite, MongoDB, Redis, H2)
  - Automatic ID generation for imported connections
- **Connection Templates**: Save and reuse connection configurations for teams
  - Save any connection as a template (passwords stripped)
  - Create new connections from templates with QuickPick selection
  - Template management (create/delete) with max 50 templates
  - Pre-fills connection form with template values
- **Connection Share Utility** (`src/utils/connectionShare.ts`): Export/import/validation functions with `ExportableConnectionConfig` and `ConnectionTemplate` types
- **Tests**: 36 unit tests (stripSecrets, exportToJson, validateImportData, toConnectionConfig, createTemplate, round-trip, edge cases)

### Fixed

- **Database Context Bug**: Queries now execute on the correct database when using the query button from tree view
  - Previously, clicking the query button on a specific database (e.g., "trading") would run queries on the connection's default database instead
  - Added `selectedDatabase` state to `ConnectionManager` — auto-set on connect, cleared on disconnect
  - Tree view selection (`onDidChangeSelection`) automatically updates the active database context
  - Affects all query execution paths: Execute Query, CodeLens Run Query, and EXPLAIN
  - All 6 providers (MySQL, PostgreSQL, SQLite, H2, MongoDB, Redis) already support the `database` parameter

## [2.4.0] - 2026-03-17

### Added

- **Connection Color Coding**: Assign colors to connections for visual environment distinction
  - **8 Preset Colors**: Red (Production), Orange (Staging), Yellow (Testing), Green (Development), Blue (Local), Purple (Analytics), Pink, Gray
  - **Color Picker UI**: Circular color swatches in connection add/edit form with custom label input
  - **Tree View Indicator**: Connection icon color and color dot in the sidebar tree view
  - **Tab Color Bar**: Thin color bar on the left side of query tabs showing connection color
  - **Connection Badge**: Colored connection badge in the query editor toolbar
  - **Status Bar Color**: Connection color and label displayed in VS Code status bar
  - **Production Warning Banner**: Red "PRODUCTION — Be careful with your queries" banner for red-colored connections
- **Connection Color Types** (`ConnectionColor`, `CONNECTION_COLOR_PRESETS`): Color configuration and preset definitions in `src/types/database.ts`
- **Tests**: 66 unit tests (color presets, mapping, badge styles, edge cases) + 20 integration tests (real DB connections with color, multi-connection, backward compatibility)

## [2.3.0] - 2026-03-16

### Added

- **Read-Only Mode**: Lock connections to prevent accidental write operations on production databases
  - **Write Query Detection**: Blocks INSERT, UPDATE, DELETE, DROP, ALTER, CREATE, TRUNCATE, REPLACE, RENAME, GRANT, REVOKE, MERGE, UPSERT, CALL, EXEC, EXECUTE (16 SQL keywords)
  - **Redis Write Guard**: Blocks SET, DEL, HSET, LPUSH, SADD, ZADD, FLUSHDB, FLUSHALL, and 50+ other write commands
  - **MongoDB Write Guard**: Blocks insertOne, updateMany, deleteOne, drop, bulkWrite, and other write methods
  - **Connection Form Toggle**: Read-only mode checkbox in connection add/edit form
  - **Tree View Lock Icon**: 🔒 icon on read-only connections with inline toggle button
  - **Query Editor Banner**: Warning banner when editing on a read-only connection
  - **Table Editor Block**: INSERT/UPDATE/DELETE operations blocked in table editor
  - **Emergency Unlock**: Modal confirmation dialog to disable read-only mode
  - **False Positive Prevention**: Write keywords inside string literals and comments are ignored
- **Read-Only Guard Utility** (`src/utils/readOnlyGuard.ts`): SQL/Redis/MongoDB write operation detection with string/comment stripping
- **Tests**: 104 unit tests (read-only guard) + 76 integration tests (MySQL, PostgreSQL, Redis, MongoDB read-only workflows)

## [2.2.0] - 2026-03-13

### Added

- **Result Pinning**: Pin query results to keep them while executing new queries
  - **Pin Button**: Click "📌 Pin" in results header to save the current result
  - **Pin Tab Bar**: Switch between pinned results and current result via tab bar with timestamps
  - **Side-by-Side Compare**: View two results side-by-side for comparison (e.g., before/after data changes)
  - **Pin Labels**: Rename pinned results with custom labels for easy identification
  - **Max 20 Pins**: Oldest pins are automatically removed when limit is reached
- **Result Pin Utility** (`src/utils/resultPin.ts`): Immutable state management for pinned results, compare mode, and label operations
- **Tests**: 77 unit tests (result pin utility) + 62 integration tests (MySQL + PostgreSQL pin workflows, overflow, before/after comparison)

## [2.1.0] - 2026-03-12

### Added

- **Query Parameters**: `{{variable}}` placeholder syntax for parameterized queries
  - **Placeholder Extraction**: Parse `{{variable_name}}` from SQL, supporting Korean variable names (`{{사용자_ID}}`)
  - **Variable Input Dialog**: Modal dialog before query execution to enter parameter values
  - **Variable Set Save/Reuse**: Save named variable sets per connection, load with one click
  - **Environment Profiles**: dev/staging/prod profiles with per-environment variable values
  - **String Literal & Comment Awareness**: Placeholders inside quotes (`'{{ignore}}'`) or comments (`-- {{ignore}}`) are ignored
- **Query Parameter Utility** (`src/utils/queryParameter.ts`): New parser for extracting, validating, and substituting `{{variable}}` placeholders
- **Tests**: 61 unit tests (query parameter parser) + 30 integration tests (MySQL + PostgreSQL with Docker)

## [2.0.0] - 2026-03-10

### Added

- **SQL Autocomplete Enhancement**: Complete rewrite of SQL completion engine
  - **Alias Recognition**: `SELECT u.` from `users u` → suggests `users` columns (id, name, email, ...)
  - **FK-based JOIN ON Suggestions**: `JOIN posts p ON ` → suggests `p.user_id = u.id` based on foreign key relationships (both forward and reverse FK lookup)
  - **Subquery Context Awareness**: Parenthesis depth tracking — autocomplete works correctly inside subqueries
  - **Multi-table Column Disambiguation**: When multiple tables are referenced, columns are suggested with alias prefix (`u.name`, `p.title`)
- **SQL Parser Utility** (`src/utils/sqlParser.ts`): New parser that extracts table references, aliases, JOIN clauses, and cursor context from SQL text
  - Supports: `FROM`, `JOIN` (all types), `UPDATE`, `INSERT INTO`, schema-qualified names, `AS` keyword
  - String literal stripping to avoid false positives
  - Reserved keyword filtering
- **Tests**: 55 unit tests (SQL parser) + 28 integration tests (MySQL + PostgreSQL with Docker)

## [1.9.0] - 2026-03-01

### Security

- **SQL Injection Prevention**: All SQL providers now use parameterized queries or validated identifiers
  - MySQL: `getForeignKeys` uses `execute()` with `?` placeholders instead of string interpolation
  - PostgreSQL: `getTableSchema`, `getForeignKeys` use `$1` parameterized queries via new `executeQueryOnDatabaseParameterized` method
  - H2: `getTables`, `getTableSchema`, `getForeignKeys` use validated string interpolation with `UPPER()` for case-insensitive matching (H2's PG protocol does not support `$1` parameterized queries for INFORMATION_SCHEMA)
  - SQLite: Added identifier validation (`/^[\w.]+$/`) for `getTableSchema`, `getCreateTableStatement`, `getForeignKeys`
- **SSH Tunnel Fix**: Completely rewritten SSH tunnel implementation for MySQL and PostgreSQL
  - Previous implementation was non-functional (forwarded stream was discarded)
  - Now creates a local TCP server that properly bridges traffic through the SSH tunnel
  - DB client connects to `127.0.0.1:<dynamic_port>` which tunnels through SSH to the remote DB
- **XSS Prevention**: Fixed cross-site scripting vulnerabilities in webview panels
  - `ConnectionFormPanel`: Added `_escapeHtml` method; all config values (`name`, `host`, `username`, `database`, `id`, `type`, SSH fields, H2 fields) are now properly escaped before HTML insertion
  - `QueryTabPanel`: `formatValue()` now escapes HTML via `escapeHtml()` to prevent malicious DB content from executing scripts
- **Redis**: Blocked destructive `FLUSHDB` and `FLUSHALL` commands with descriptive error messages
- **Redis**: Fixed URL credential encoding using `encodeURIComponent()` to handle special characters in passwords

### Fixed

- **Extension Lifecycle**: `deactivate()` now properly cleans up active database connections and disposes event emitters
  - Added `dispose()` method to `ConnectionManager` for proper resource cleanup
  - Event listener disposables are now tracked in `context.subscriptions`
- **SQLite**: Database file writes now use atomic write pattern (temp file + rename) to prevent corruption on crash
- **SQLite**: `connect()` now creates new database files when the specified path doesn't exist
- **MySQL/PostgreSQL/H2**: `disconnect()` now wraps close operations in try/catch to prevent unhandled errors
- **H2Provider**: Now properly exported from `providers/index.ts`
- **H2Provider**: Fixed `getTableSchema` query — H2 v2.x uses `INDEXES` + `INDEX_COLUMNS` instead of `PRIMARY_KEY` column
- **H2Provider**: Fixed `getForeignKeys` — H2 v2.x uses `REFERENTIAL_CONSTRAINTS` + `KEY_COLUMN_USAGE` instead of `CROSS_REFERENCES`
- **H2Provider**: Fixed metadata queries for PG protocol mode (lowercase schema/table names, `BASE TABLE` type)
- **H2Provider**: Added `error` event handler to PG client to prevent uncaught exceptions
- **MongoDB**: Added `authSource=admin` to connection URI for proper authentication when connecting to non-admin databases
- **MongoDB**: Fixed tree view collection preview not showing data — `executeQuery` now receives `databaseName` from tree item context
- **ConnectionManager**: `getSupportedTypes()` now includes `'h2'`

### Added

- **MongoDB Shell Syntax**: Support for `db.collection.method()` style MongoDB Shell commands
  - Supported methods: `find`, `findOne`, `insertOne`, `insertMany`, `updateOne`, `updateMany`, `deleteOne`, `deleteMany`, `countDocuments`, `aggregate`, `drop`
  - Chaining methods: `.limit(N)`, `.sort({...})`
  - Existing JSON runCommand format remains supported
- **Docker Test Environment**: Docker Compose environment for testing
  - MySQL 8.0, PostgreSQL 16, MongoDB 7, Redis 7, H2 containers
  - Seed data scripts (`docker-init/`) — auto-creates tables/collections (users, posts, etc.) for MySQL, PostgreSQL, MongoDB
- Comprehensive unit test suite covering all database providers, connection manager, and encryption service
- Integration test suite (`src/test/integration/run-all.ts`) — 121 test cases across 6 DB providers with live Docker containers

## [1.8.1] - 2026-01-15

### Fixed

- **MySQL**: Fixed "This command is not supported in the prepared statement protocol yet" error when previewing table data
  - Changed from `execute()` to `query()` method to support SHOW, DESCRIBE commands

### Changed

- **Keyboard Shortcuts**: Changed all shortcuts to use `Alt/Option` instead of `Shift` to avoid conflicts with VS Code and system shortcuts
  - New Query: `Ctrl+Shift+Q` → `Ctrl+Alt+N` (Mac: `Cmd+Option+N`)
  - Add Connection: `Ctrl+Shift+D` → `Ctrl+Alt+D` (Mac: `Cmd+Option+D`)
  - Save Query: `Ctrl+Shift+S` → `Ctrl+Alt+S` (Mac: `Cmd+Option+S`)
  - Execution Plan: `Ctrl+Shift+E` → `Ctrl+Alt+E` (Mac: `Cmd+Option+E`)
  - Multi-Tab Query: `Ctrl+Shift+T` → `Ctrl+Alt+T` (Mac: `Cmd+Option+T`)

## [1.8.0] - 2026-01-13

### Added

- **H2 Database Support**: Connect to H2 databases via PostgreSQL wire protocol
  - Requires H2 server mode: `java -cp h2*.jar org.h2.tools.Server -tcp -tcpAllowOthers -pg -pgAllowOthers -pgPort 5435 -ifNotExists`
  - Default port: 5435
  - Full support for queries, schema browsing, and table operations
  - **Database Modes**:
    - In-Memory (Volatile): Data stored in memory only
    - Embedded (File): Persistent file-based storage
  - Built-in connection guide with step-by-step instructions

## [1.7.0] - 2026-01-11

### Added

- **SQLite File Picker**: Browse and select SQLite database files
  - File picker dialog for easy database selection
  - Support for both absolute and relative paths
- **PostgreSQL Schema Support**: Full support for non-public schemas
  - Tables from non-public schemas displayed with `schema.table` format
  - Schema-qualified table names in all operations
  - Fixed "relation does not exist" error for non-public schemas

### Changed

- **SQLite Provider**: Migrated from better-sqlite3 to sql.js
  - Pure JavaScript/WebAssembly implementation
  - Better compatibility with VS Code extension environment
  - No native module compilation required

### Fixed

- Fixed empty CREATE TABLE statement when copying schema from non-public schemas
- Fixed column loading for tables in non-public schemas
- Fixed table data editing for schema-qualified table names

## [1.6.0] - 2026-01-11

### Added

- **Inline Cell Editing**: Edit query results directly
  - Double-click cell to edit value
  - Tab/Enter to navigate between cells
  - Escape to cancel edit
  - Pending changes highlighted in yellow
  - Save/Discard all changes buttons
  - Ctrl+S to save, Ctrl+Z to discard changes
- **Cell Expand View**: View long content in modal
  - Expand button on cells with long text or JSON
  - JSON syntax highlighting in expanded view
  - Copy content from modal
  - Escape or click overlay to close
- **Table Favorites**: Star frequently used tables
  - Click star icon to toggle favorite
  - Favorites shown at top of table list
  - Yellow star icon for favorite tables
  - Favorites saved per connection/database
- **Multi-Row Selection**: Select multiple rows for operations
  - Ctrl+Click row number to toggle selection
  - Delete key to delete selected rows
  - Ctrl+C to copy selected rows
- **Result Filtering**: Filter and search query results
  - Global search across all columns (Ctrl+F)
  - Per-column filter dropdown with value selection
  - Search highlighting in results
  - Filter status indicator showing filtered row count
- **Column Management**: Control column visibility and order
  - Hide/show specific columns
  - Drag-and-drop column reordering
  - Show All / Hide All quick actions
  - Column settings saved per query
- **Extended Sorting**: Enhanced sorting capabilities
  - Click column header to sort (ascending/descending)
  - Sort indicator showing current sort state
  - Null value handling in sort order
- **Export Improvements**: Export only visible columns
  - CSV/JSON export respects column visibility
  - Filtered data export support

## [1.5.1] - 2026-01-08

### Added

- execute example gif

## [1.5.0] - 2026-01-08

### Added

- **ERD Multiple Layouts**: Choose from 4 different layout styles
  - Grid Layout: Simple grid arrangement
  - Relationship Layout: Connected tables placed closer together
  - Hierarchical Layout: Parent tables at top, child tables below
  - Circular Layout: Tables arranged in a circle
- **ERD Orthogonal Line Routing**: Relationship lines avoid overlapping with tables
  - Smart path calculation based on table positions
  - Multiple relations offset to prevent line overlap
- **ERD Animations**: Smooth transition when switching layouts
- **ERD Line Hover Effects**: Highlight relationship lines on hover with tooltip

### Changed

- Improved table spacing in all ERD layouts
- Enhanced relationship line visibility with start/end markers

## [1.4.0] - 2026-01-08

### Fixed

- **PostgreSQL Dynamic Database Support**: ERD now works correctly with any selected database
  - Fixed issue where ERD only queried the initially connected database
  - Added temporary connection creation for cross-database queries
  - Updated `getTables`, `getTableSchema`, `getForeignKeys` to use correct database
- **MySQL Dynamic Database Support**: Improved database-aware schema queries

### Changed

- Database interface updated to support optional database parameter
- Improved PostgreSQL queries using `pg_catalog` for better reliability

## [1.3.0] - 2026-01-08

### Added

- **Multi-Tab Query Editor**: Open multiple query editors simultaneously
  - Tab-based query editor interface
  - Per-tab connection assignment
  - Switch between tabs easily (Ctrl+T to create, Ctrl+W to close)
  - Tab renaming with double-click
  - Keyboard shortcuts (Ctrl+Enter to execute)
  - SQL formatting per tab
  - Query results displayed inline

## [1.2.0] - 2026-01-07

### Added

- **DB Migration**: Manage database schema migrations
  - Create, edit, and delete migrations
  - Version management with timestamps
  - Apply and rollback migrations
  - UP/DOWN script editing
  - Export migrations to SQL files
- **Real-time Monitoring**: Monitor database performance in real-time
  - Active process list with query details
  - Server status dashboard (uptime, connections, queries)
  - Auto-refresh with configurable intervals
  - Process termination (KILL)
  - Support for MySQL and PostgreSQL

### Changed

- License changed from MIT to proprietary license

## [1.1.0] - 2025-01-06

### Added

- **Query Bookmark**: Save and organize frequently used queries with categories
  - Save queries with name, description, and category
  - Quick access from sidebar
  - Edit and delete saved queries
- **SQL Formatter**: Auto-format SQL queries (Shift+Alt+F)
  - Support for MySQL, PostgreSQL, SQLite syntax
  - Keyword uppercase, proper indentation
- **Copy Table Schema**: Copy CREATE TABLE statement to clipboard
  - Right-click on table in explorer
  - Works with MySQL, PostgreSQL, SQLite
- **Query Execution Plan**: View EXPLAIN results
  - MySQL: `EXPLAIN`
  - PostgreSQL: `EXPLAIN ANALYZE`
  - SQLite: `EXPLAIN QUERY PLAN`
  - Shortcut: Ctrl+Shift+E (Cmd+Shift+E on Mac)
- **Connection Grouping**: Organize connections into folders
  - Create groups (dev/staging/prod)
  - Move connections between groups
  - Rename and delete groups
- **ERD Diagram**: Visual entity relationship diagram
  - Table relationship visualization
  - Foreign key connections with arrows
  - Drag and drop table positioning
  - Zoom and pan controls
  - Export to SVG and PNG formats
  - Auto layout feature
- **Schema Compare**: Compare table schemas side by side
  - Visual diff with left-only, right-only, modified columns
  - Difference highlighting
  - Export comparison report to Markdown
- **Mock Data Generator**: Generate test data for tables
  - Multiple generators (names, emails, dates, numbers, etc.)
  - Customizable options per column
  - Preview data before generating
  - Export to SQL INSERT statements

### Changed

- Tree view now displays groups at root level
- Improved connection tooltips with group information

## [1.0.0] - 2025-01-05

### Added

- Initial release
- Multi-database support (MySQL, PostgreSQL, SQLite, MongoDB, Redis)
- Connection management with encrypted password storage
- Query execution with result display
- Schema explorer with tree view
- Query history tracking
- SSH tunneling support
- Internationalization (English/Korean)
