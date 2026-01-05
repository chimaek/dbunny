# DBunny - VS Code Database Extension

> "Hop into your databases!"

DBunny is a fast and friendly database management extension for VS Code. Connect to MySQL, PostgreSQL, SQLite, MongoDB, and Redis - all from your favorite editor.

![DBunny](resources/bunny-icon.png)

## Features

- **Multi-Database Support**: MySQL, PostgreSQL, SQLite, MongoDB, Redis
- **Visual Table Editor**: Edit table data directly with GUI (SQL databases)
- **Smart Query Editor**: Database-specific syntax hints and examples
- **Schema Explorer**: Browse databases, tables, and columns in tree view
- **Query History**: Track and reuse previously executed queries
- **SSH Tunneling**: Secure remote database connections
- **Responsive UI**: Adapts to VS Code font size settings
- **Bilingual**: English and Korean support

## Quick Start

### 1. Add Connection

1. Click the **DBunny** icon in the Activity Bar (left sidebar)
2. Click the **+** button at the top of the panel
3. Select your database type
4. Enter connection details (host, port, username, password)
5. Click **Save & Connect**

### 2. Browse Database

Once connected, the tree view shows:

```text
Connection Name (Connected)
├── database_name
│   ├── table1
│   │   ├── id (INT) [PK]
│   │   ├── name (VARCHAR)
│   │   └── created_at (DATETIME)
│   └── table2
└── another_database
```

### 3. Execute Queries

**Create a new query:**

- Click the **New Query** button, or
- Press `Ctrl+Shift+Q` (`Cmd+Shift+Q` on Mac)

**Execute query:**

- Press `Ctrl+Enter` (`Cmd+Enter` on Mac), or
- Press `F5`

**Partial execution:**

- Select the SQL you want to run
- Press `Ctrl+Enter` to execute only the selection

## Database-Specific Usage

### MySQL / PostgreSQL / SQLite

**Query Examples:**

```sql
-- Select all records
SELECT * FROM users;

-- Join tables
SELECT u.name, o.total
FROM users u
JOIN orders o ON u.id = o.user_id;

-- Insert data
INSERT INTO users (name, email) VALUES ('John', 'john@example.com');
```

**Table Editor:**

- Right-click on a table → **Edit Table Data**
- View, insert, update, and delete rows with GUI
- Changes are executed immediately

### MongoDB

**Query Examples:**

```javascript
// Find documents
db.users.find({ status: "active" })

// Find with projection
db.users.find({ age: { $gt: 25 } }, { name: 1, email: 1 })

// Insert document
db.users.insertOne({ name: "John", email: "john@example.com" })

// Update document
db.users.updateOne({ _id: id }, { $set: { status: "inactive" } })

// Aggregate
db.orders.aggregate([
  { $match: { status: "completed" } },
  { $group: { _id: "$userId", total: { $sum: "$amount" } } }
])
```

### Redis

**Available Commands:**

```bash
# Key-Value Operations
GET key                    # Get string value
SET key value              # Set string value
DEL key                    # Delete key
KEYS *                     # List all keys
TTL key                    # Get time-to-live
EXPIRE key seconds         # Set expiration

# Hash Operations
HGET key field             # Get hash field
HSET key field value       # Set hash field
HGETALL key                # Get all hash fields
HDEL key field             # Delete hash field

# List Operations
LPUSH key value            # Push to left
RPUSH key value            # Push to right
LRANGE key 0 -1            # Get all list items
LPOP key                   # Pop from left
RPOP key                   # Pop from right

# Set Operations
SADD key member            # Add to set
SMEMBERS key               # Get all members
SCARD key                  # Count members
SREM key member            # Remove from set

# Sorted Set Operations
ZADD key score member      # Add with score
ZRANGE key 0 -1            # Get all by rank
ZRANGEBYSCORE key min max  # Get by score range

# Database Operations
SELECT 0                   # Switch to database 0 (0-15)
DBSIZE                     # Get key count
FLUSHDB                    # Clear current database
```

**View Key Data:**

- Click the **eye** icon next to a key
- Automatically detects key type and shows appropriate data

## Keyboard Shortcuts

| Shortcut | Mac | Action |
|----------|-----|--------|
| `Ctrl+Shift+Q` | `Cmd+Shift+Q` | New Query |
| `Ctrl+Shift+D` | `Cmd+Shift+D` | Add Connection |
| `Ctrl+Enter` | `Cmd+Enter` | Execute Query |
| `F5` | `F5` | Execute Query |

## Query Results

Query results are displayed in a table with:

- **Column sorting**: Click column headers to sort
- **Copy cell**: Click cell to copy value
- **Export**: Export results to CSV or JSON
- **Row count**: Total rows and execution time

## Query History

- All executed queries are saved automatically
- Click a history item to copy the query
- Clear history with the trash icon

## SSH Tunneling

Connect to remote databases through SSH:

1. Enable **SSH Tunnel** in connection settings
2. Enter SSH host, port, and credentials
3. Choose authentication method:
   - Password
   - Private Key (with optional passphrase)

## Settings

Access via `File > Preferences > Settings > DBunny`

| Setting | Default | Description |
|---------|---------|-------------|
| `dbunny.queryTimeout` | 30000 | Query timeout (ms) |
| `dbunny.maxResults` | 1000 | Max result rows |
| `dbunny.language` | auto | UI language (auto/en/ko) |

## Tips & Tricks

1. **Quick table preview**: Double-click a table in the tree view
2. **Multi-statement execution**: Separate queries with semicolons
3. **Comment out SQL**: Use `--` for single-line or `/* */` for multi-line
4. **Redis key inspection**: The tree shows up to 100 keys per database

## Troubleshooting

**Connection failed:**

- Check host, port, and credentials
- Verify database server is running
- Check firewall settings

**SSH tunnel failed:**

- Verify SSH credentials
- Check if SSH server allows tunneling
- Try with password instead of key

**Query timeout:**

- Increase `dbunny.queryTimeout` in settings
- Optimize your query with indexes

## Security

- Passwords encrypted with AES-256-GCM
- Encryption keys stored in VS Code secure storage
- No data sent to external servers

## License

MIT

---

**Happy querying!**
