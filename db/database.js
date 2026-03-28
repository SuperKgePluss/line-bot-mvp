const sqlite3 = require('sqlite3').verbose();

// เชื่อม DB (ถ้ายังไม่มีไฟล์จะสร้างให้เลย)
const db = new sqlite3.Database('./db/finance.db', (err) => {
    if (err) {
        console.error('❌ DB Error:', err.message);
    } else {
        console.log('✅ Connected to SQLite database');
    }
});

// สร้าง table
db.serialize(() => {
    db.run(`
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

    db.run(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_message_dedup
        ON transactions (sourceMessageId, sourceTxnIndex)
    `);
});

module.exports = db;