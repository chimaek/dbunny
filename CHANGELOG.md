# Changelog

All notable changes to the DBunny extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
