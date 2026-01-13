# Changelog

All notable changes to the DBunny extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.7.0] - 2026-01-13

### Added

- **H2 Database Support**: Connect to H2 databases via PostgreSQL wire protocol
  - Requires H2 server mode: `java -cp h2*.jar org.h2.tools.Server -tcp -tcpAllowOthers -pg -pgAllowOthers -pgPort 5435 -ifNotExists`
  - Default port: 5435
  - Full support for queries, schema browsing, and table operations
  - **Database Modes**:
    - In-Memory (Volatile): Data stored in memory only
    - Embedded (File): Persistent file-based storage
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
