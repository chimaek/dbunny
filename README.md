# DBunny - VS Code Database Extension

> "Hop into your databases!"

DBunny is a fast and friendly database management extension for VS Code. Connect to MySQL, PostgreSQL, SQLite, MongoDB, and Redis - all from your favorite editor.

## Features

- **Multi-Database Support**: Connect to MySQL, PostgreSQL, SQLite, MongoDB, and Redis
- **Quick Query Execution**: Execute SQL queries with syntax highlighting
- **Schema Explorer**: Browse databases, tables, and columns in a tree view
- **Query History**: Track and reuse your previously executed queries
- **SSH Tunneling**: Securely connect to remote databases through SSH
- **Internationalization**: Supports English and Korean

## Installation

1. Open VS Code
2. Go to Extensions (Ctrl+Shift+X)
3. Search for "DBunny"
4. Click Install

## Quick Start

1. Click the DBunny icon in the Activity Bar
2. Click the + button to add a new connection
3. Select your database type and enter connection details
4. Connect and start querying!

## Supported Databases

| Database | Status |
|----------|--------|
| MySQL | Supported |
| PostgreSQL | Supported |
| SQLite | Supported |
| MongoDB | Supported |
| Redis | Supported |

## Commands

- `DBunny: Add Connection` - Add a new database connection
- `DBunny: Execute Query` - Execute the current SQL query
- `DBunny: New Query` - Open a new query editor
- `DBunny: Refresh` - Refresh the connection tree

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `dbunny.queryTimeout` | 30000 | Query timeout in milliseconds |
| `dbunny.maxResults` | 1000 | Maximum number of result rows |
| `dbunny.language` | auto | Interface language (auto/en/ko) |

## Security

- Passwords are encrypted using AES-256-GCM
- Encryption keys are stored in VS Code's secure storage
- SSH tunneling for secure remote connections

## Development

```bash
# Clone the repository
git clone https://github.com/yourusername/dbunny.git
cd dbunny

# Install dependencies
npm install

# Compile and watch
npm run watch

# Run tests
npm test
```

## License

MIT

---

**Happy querying!**
