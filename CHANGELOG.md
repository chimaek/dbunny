# Changelog

All notable changes to the DBunny extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2025-01-05

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

### Changed
- Tree view now displays groups at root level
- Improved connection tooltips with group information

## [1.0.0] - 2025-01-06

### Added
- Initial release
- Multi-database support (MySQL, PostgreSQL, SQLite, MongoDB, Redis)
- Connection management with encrypted password storage
- Query execution with result display
- Schema explorer with tree view
- Query history tracking
- SSH tunneling support
- Internationalization (English/Korean)
