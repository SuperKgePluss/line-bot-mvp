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
        note TEXT,
        sourceMessageId TEXT,
        sourceTxnIndex INTEGER,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`);

// =====================
// SAFE MIGRATION
// =====================
function ensureColumnExists(tableName, columnName, columnDefinition) {
    const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
    const hasColumn = columns.some(col => col.name === columnName);

    if (!hasColumn) {
        db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition}`);
        console.log(`✅ Added column ${columnName} to ${tableName}`);
    }
}

ensureColumnExists('transactions', 'note', 'TEXT');

db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_message_dedup
    ON transactions (sourceMessageId, sourceTxnIndex)
`);

// =====================
// ANALYTICS HELPERS
// =====================

// รายการล่าสุด
function getRecentTransactions(userId, limit = 20) {
    const stmt = db.prepare(`
        SELECT id, userId, type, amount, category, note, sourceMessageId, sourceTxnIndex, createdAt
        FROM transactions
        WHERE userId = ?
        ORDER BY datetime(createdAt) DESC, id DESC
        LIMIT ?
    `);

    return stmt.all(userId, limit);
}

// summary วันนี้
function getTodaySummary(userId) {
    const stmt = db.prepare(`
        SELECT type, SUM(amount) as total
        FROM transactions
        WHERE userId = ?
          AND DATE(datetime(createdAt, '+7 hours')) = DATE('now', '+7 hours')
        GROUP BY type
    `);

    const rows = stmt.all(userId);

    let income = 0;
    let expense = 0;

    rows.forEach(row => {
        if (row.type === 'income') income = row.total || 0;
        if (row.type === 'expense') expense = row.total || 0;
    });

    return {
        income,
        expense,
        balance: income - expense
    };
}

// สรุปตามหมวดหมู่ของวันนี้
function getTodayCategorySummary(userId) {
    const stmt = db.prepare(`
        SELECT
            category,
            type,
            COUNT(*) as count,
            SUM(amount) as total
        FROM transactions
        WHERE userId = ?
          AND DATE(datetime(createdAt, '+7 hours')) = DATE('now', '+7 hours')
        GROUP BY category, type
        ORDER BY total DESC
    `);

    return stmt.all(userId);
}

// สรุปรายวันย้อนหลัง
function getDailySummary(userId, limitDays = 7) {
    const stmt = db.prepare(`
        SELECT
            DATE(datetime(createdAt, '+7 hours')) as date,
            SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END) as income,
            SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END) as expense
        FROM transactions
        WHERE userId = ?
        GROUP BY DATE(datetime(createdAt, '+7 hours'))
        ORDER BY date DESC
        LIMIT ?
    `);

    const rows = stmt.all(userId, limitDays);

    return rows.map(row => ({
        date: row.date,
        income: row.income || 0,
        expense: row.expense || 0,
        balance: (row.income || 0) - (row.expense || 0)
    }));
}

// สรุปรายเดือนย้อนหลัง
function getMonthlySummary(userId, limitMonths = 6) {
    const stmt = db.prepare(`
        SELECT *
        FROM (
            SELECT
                strftime('%Y-%m', datetime(createdAt, '+7 hours')) as month,
                SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END) as income,
                SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END) as expense
            FROM transactions
            WHERE userId = ?
            GROUP BY strftime('%Y-%m', datetime(createdAt, '+7 hours'))
            ORDER BY month DESC
            LIMIT ?
        )
        ORDER BY month ASC
    `);

    const rows = stmt.all(userId, limitMonths);

    return rows.map(row => ({
        month: row.month,
        income: row.income || 0,
        expense: row.expense || 0,
        balance: (row.income || 0) - (row.expense || 0)
    }));
}

// ลบเฉพาะข้อมูลของ user ปัจจุบันใน "วันนี้"
function deleteTodayTransactionsByUser(userId) {
    const stmt = db.prepare(`
        DELETE FROM transactions
        WHERE userId = ?
          AND DATE(datetime(createdAt, '+7 hours')) = DATE('now', '+7 hours')
    `);

    const result = stmt.run(userId);

    return {
        deletedCount: result.changes || 0
    };
}

module.exports = {
    db,
    getRecentTransactions,
    getTodaySummary,
    getTodayCategorySummary,
    getDailySummary,
    getMonthlySummary,
    deleteTodayTransactionsByUser
};