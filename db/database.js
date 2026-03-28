const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'finance.db');
const db = new Database(dbPath);

console.log('✅ Connected to SQLite database');

db.exec(`
    CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userId TEXT NOT NULL,
        type TEXT NOT NULL,
        amount REAL NOT NULL,
        category TEXT,
        sourceMessageId TEXT,
        sourceTxnIndex INTEGER,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`);

db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_message_dedup
    ON transactions (sourceMessageId, sourceTxnIndex)
`);

module.exports = db;