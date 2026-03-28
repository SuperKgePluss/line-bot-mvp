require('dotenv').config();

const express = require('express');
const line = require('@line/bot-sdk');
const {
    db,
    getTodaySummary,
    getRecentTransactions,
    getTodayCategorySummary,
    getDailySummary
} = require('./db/database');

const app = express();

const config = {
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    channelSecret: process.env.LINE_CHANNEL_SECRET
};

if (!process.env.LINE_CHANNEL_ACCESS_TOKEN || !process.env.LINE_CHANNEL_SECRET) {
    console.error('❌ Missing LINE env variables');
    process.exit(1);
}

const client = new line.Client(config);
const PORT = process.env.PORT || 3000;

// =====================
// CATEGORY MAP
// =====================
const CATEGORY_MAP = {
    "อาหาร": ["ข้าว", "กาแฟ", "น้ำ", "ขนม", "อาหาร", "ก๋วยเตี๋ยว"],
    "เสื้อผ้า": ["เสื้อ", "กางเกง", "รองเท้า"],
    "ยาและค่ารักษา": ["ยา", "หมอ", "โรงพยาบาล"],
    "ที่อยู่อาศัย": ["ค่าไฟ", "ค่าน้ำ", "ค่าเช่า"],
    "รายการผ่อนชำระ": ["ผ่อน", "หนี้", "บัตรเครดิต", "netflix"],
};

// =====================
// WEBHOOK
// =====================
app.post('/webhook', line.middleware(config), async (req, res) => {
    try {
        const events = req.body.events || [];

        await Promise.all(
            events.map(async (event) => {
                try {
                    await handleEvent(event);
                } catch (eventError) {
                    console.error('❌ event processing error:', eventError);
                }
            })
        );

        res.status(200).end();
    } catch (error) {
        console.error('❌ webhook error:', error);
        res.status(500).end();
    }
});

// =====================
// CLASSIFY CATEGORY
// =====================
function classifyCategory(text) {
    for (let category in CATEGORY_MAP) {
        const keywords = CATEGORY_MAP[category];

        for (let keyword of keywords) {
            if (text.includes(keyword)) {
                return category;
            }
        }
    }
    return "อื่นๆ";
}

// =====================
// PARSE MESSAGE HELPERS
// =====================
function normalizeText(text) {
    return text
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .replace(/บาทถ้วน/g, ' บาท')
        .replace(/บาท/g, ' บาท ')
        .replace(/,\s*/g, ',')
        .trim();
}

function detectType(text) {
    if (/(ขาย|รายรับ|รับมา|ได้เงิน|ได้มา|โอนเข้า|เข้า)/.test(text)) {
        return "income";
    }

    if (/(ซื้อ|รายจ่าย|จ่าย|ค่า|โอนออก|เสีย|หมดไป)/.test(text)) {
        return "expense";
    }

    return null;
}

function cleanItemText(text) {
    return text
        .replace(/(ขาย|ซื้อ|ได้|จ่าย|ค่า|รายรับ|รายจ่าย|บาท|แล้ว|และ|กับ|จากนั้น|เอาไป)/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function formatAmount(amount) {
    return Number(amount || 0).toLocaleString('en-US');
}

function requireUserId(res, userId) {
    if (!userId) {
        res.status(400).json({
            error: 'Missing userId'
        });
        return false;
    }
    return true;
}

// =====================
// PARSE MESSAGE
// =====================
function parseMessage(text) {
    const normalized = normalizeText(text);

    // ตัดคำสั่งที่ไม่ใช่ transaction ออกก่อน เช่น "สรุป"
    const cleaned = normalized
        .replace(/สรุปวันนี้|สรุปรายวัน|สรุป/g, ' ')
        .trim();

    // หาเลขทุกตัวในข้อความ เช่น 70, 50, 3,000
    const amountRegex = /(\d[\d,]*(?:\.\d+)?)/g;
    const matches = [...cleaned.matchAll(amountRegex)];

    if (matches.length === 0) {
        return [];
    }

    const results = [];
    let lastType = null;

    for (let i = 0; i < matches.length; i++) {
        const match = matches[i];
        const amountRaw = match[1];
        const amount = parseFloat(amountRaw.replace(/,/g, ''));

        if (!amount || amount <= 0) continue;

        const amountStart = match.index;
        const amountEnd = amountStart + amountRaw.length;

        const prevAmountEnd = i === 0 ? 0 : matches[i - 1].index + matches[i - 1][1].length;
        const nextAmountStart = i === matches.length - 1 ? cleaned.length : matches[i + 1].index;

        // ข้อความก่อนจำนวนนี้ = context หลักของ transaction
        const leftContext = cleaned.slice(prevAmountEnd, amountStart).trim();

        // ข้อความหลังจำนวนนี้จนถึงก่อนจำนวนถัดไป
        const rightContext = cleaned.slice(amountEnd, nextAmountStart).trim();

        // ใช้ข้อความก่อนหน้าเป็นหลัก เพราะ pattern ไทยมักเป็น "ซื้อกาแฟ 70"
        let rawText = cleanItemText(leftContext);

        // ถ้าก่อนหน้าไม่มีข้อความเลย ลองใช้ข้อความหลัง
        if (!rawText) {
            rawText = cleanItemText(rightContext);
        }

        // หา type จาก context ก่อน
        let type = detectType(leftContext);

        // ถ้ายังไม่เจอ ลองจาก rawText
        if (!type) {
            type = detectType(rawText);
        }

        // ถ้ายังไม่เจอ ใช้ type ล่าสุด
        if (!type && lastType) {
            type = lastType;
        }

        // ถ้ายังไม่เจอจริง ๆ และข้อความดูคล้ายรายการซื้อ ให้ default เป็น expense
        if (!type && rawText) {
            type = "expense";
        }

        if (type) {
            lastType = type;
        }

        const category = classifyCategory(rawText || "อื่นๆ");

        results.push({
            type,
            amount,
            category,
            note: rawText || "ไม่ระบุ"
        });
    }

    return results.filter(tx => tx.type && tx.amount > 0);
}

// =====================
// SAVE TRANSACTION
// =====================
function saveTransaction(userId, tx, sourceMessageId, sourceTxnIndex) {
    const { type, amount, category, note } = tx;

    if (!userId || !type || !amount || amount <= 0) {
        return Promise.reject(new Error('Invalid transaction data'));
    }

    if (!sourceMessageId && sourceMessageId !== null) {
        return Promise.reject(new Error('Missing sourceMessageId'));
    }

    return new Promise((resolve, reject) => {
        try {
            const stmt = db.prepare(`
                INSERT INTO transactions (
                    userId,
                    type,
                    amount,
                    category,
                    note,
                    sourceMessageId,
                    sourceTxnIndex
                )
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `);

            const result = stmt.run(
                userId,
                type,
                amount,
                category,
                note || 'ไม่ระบุ',
                sourceMessageId,
                sourceTxnIndex
            );

            resolve({
                id: result.lastInsertRowid,
                changes: result.changes
            });
        } catch (err) {
            reject(err);
        }
    });
}

// =====================
// SUMMARY
// =====================
function getTodaySummaryAsync(userId) {
    return Promise.resolve(getTodaySummary(userId));
}

// =====================
// HANDLE EVENT
// =====================
async function handleEvent(event) {
    let userId = null;
    let sourceMessageId = null;

    try {
        if (event.type !== 'message' || event.message.type !== 'text') {
            return null;
        }

        sourceMessageId = event.message.id;
        userId = event.source?.userId;
        const text = event.message.text.trim();

        console.log('[INCOMING]', {
            userId,
            sourceMessageId,
            text
        });

        if (!userId) {
            console.error('❌ Missing userId in event source');
            return null;
        }

        const isSummaryRequest = text.includes("สรุป");

        const parsedList = parseMessage(text);

        console.log('[PARSED]', parsedList);

        let totalIncome = 0;
        let totalExpense = 0;

        parsedList.forEach(tx => {
            if (tx.type === "income") totalIncome += tx.amount;
            if (tx.type === "expense") totalExpense += tx.amount;
        });

        if (parsedList.length > 0) {
            await Promise.all(
                parsedList.map((tx, index) =>
                    saveTransaction(userId, tx, sourceMessageId, index)
                )
            );
        }

        if (parsedList.length > 0) {
            console.log('[SAVED]', {
                count: parsedList.length,
                totalIncome,
                totalExpense
            });
        }

        let replyText = "";

        if (parsedList.length === 0) {
            if (!isSummaryRequest) {
                replyText = "❌ ไม่เข้าใจ ลองพิมพ์:\nขาย 3000\nซื้อกาแฟ 100";
            }
        } else {
            replyText = "✅ บันทึกเรียบร้อย\n\n📊 รายการล่าสุด\n";

            if (totalIncome > 0) {
                replyText += `📈 รายรับ: ${formatAmount(totalIncome)} บาท\n`;
            }

            if (totalExpense > 0) {
                replyText += `📉 รายจ่าย: ${formatAmount(totalExpense)} บาท\n`;
            }

            replyText += "\n";
        }

        if (isSummaryRequest) {
            const summary = await getTodaySummaryAsync(userId);

            console.log('[SUMMARY]', summary);

            replyText += `📊 สรุปวันนี้

💰 รายรับทั้งหมด: ${formatAmount(summary.income)} บาท
💸 รายจ่ายทั้งหมด: ${formatAmount(summary.expense)} บาท
📦 คงเหลือ: ${formatAmount(summary.balance)} บาท${summary.balance < 0 ? ' ⚠️' : ''}`;
        }

        if (!replyText.trim()) {
            replyText = "❌ ไม่เข้าใจ ลองพิมพ์:\nขาย 3000\nซื้อกาแฟ 100";
        }

        return await client.replyMessage(event.replyToken, {
            type: 'text',
            text: replyText
        });

    } catch (error) {
        console.error('❌ handleEvent error:', error);

        const isDuplicate =
            error && error.message && error.message.includes('UNIQUE constraint failed');

        if (isDuplicate) {
            console.log('[DUPLICATE]', {
                userId,
                sourceMessageId
            });
        }

        try {
            return await client.replyMessage(event.replyToken, {
                type: 'text',
                text: isDuplicate
                    ? '⚠️ ข้อความนี้ถูกบันทึกไปแล้ว'
                    : '⚠️ ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง'
            });
        } catch (replyError) {
            console.error('❌ replyMessage error:', replyError);
            return null;
        }
    }
}

// =====================
// SERVER
// =====================
app.get('/', (req, res) => {
    res.send('LINE Bot Ready | Debug endpoints: /debug/recent, /debug/category-summary, /debug/daily-summary');
});

app.get('/debug/recent', (req, res) => {
    try {
        const { userId } = req.query;
        const limit = Number(req.query.limit || 20);

        if (!requireUserId(res, userId)) return;

        const safeLimit = Math.min(Math.max(limit, 1), 100);
        const rows = getRecentTransactions(userId, safeLimit);

        res.json({
            ok: true,
            count: rows.length,
            items: rows
        });
    } catch (error) {
        console.error('❌ /debug/recent error:', error);
        res.status(500).json({
            ok: false,
            error: 'Internal server error'
        });
    }
});

app.get('/debug/category-summary', (req, res) => {
    try {
        const { userId } = req.query;

        if (!requireUserId(res, userId)) return;

        const rows = getTodayCategorySummary(userId);

        res.json({
            ok: true,
            count: rows.length,
            items: rows
        });
    } catch (error) {
        console.error('❌ /debug/category-summary error:', error);
        res.status(500).json({
            ok: false,
            error: 'Internal server error'
        });
    }
});

app.get('/debug/daily-summary', (req, res) => {
    try {
        const { userId } = req.query;
        const days = Number(req.query.days || 7);

        if (!requireUserId(res, userId)) return;

        const safeDays = Math.min(Math.max(days, 1), 90);
        const rows = getDailySummary(userId, safeDays);

        res.json({
            ok: true,
            count: rows.length,
            items: rows
        });
    } catch (error) {
        console.error('❌ /debug/daily-summary error:', error);
        res.status(500).json({
            ok: false,
            error: 'Internal server error'
        });
    }
});

app.get('/dashboard', (req, res) => {
    const { userId } = req.query;

    if (!userId) {
        return res.send(`
            <html>
                <head>
                    <title>Dashboard</title>
                    <meta name="viewport" content="width=device-width, initial-scale=1" />
                    <style>
                        body {
                            font-family: Arial, sans-serif;
                            padding: 24px;
                            background: #f6f7fb;
                            color: #222;
                        }
                        .box {
                            max-width: 720px;
                            margin: 40px auto;
                            background: white;
                            padding: 24px;
                            border-radius: 16px;
                            box-shadow: 0 4px 18px rgba(0,0,0,0.08);
                        }
                        .error {
                            color: #b00020;
                            font-weight: bold;
                        }
                        code {
                            background: #f1f1f1;
                            padding: 2px 6px;
                            border-radius: 6px;
                        }
                    </style>
                </head>
                <body>
                    <div class="box">
                        <h1>📊 Finance Dashboard</h1>
                        <p class="error">Missing userId</p>
                        <p>ให้เปิดด้วยรูปแบบ:</p>
                        <p><code>/dashboard?userId=YOUR_USER_ID</code></p>
                    </div>
                </body>
            </html>
        `);
    }

    res.send(`
        <html>
            <head>
                <title>Dashboard</title>
                <meta name="viewport" content="width=device-width, initial-scale=1" />
                <style>
                    * {
                        box-sizing: border-box;
                    }
                    body {
                        font-family: Arial, sans-serif;
                        margin: 0;
                        background: #f6f7fb;
                        color: #222;
                    }
                    .container {
                        max-width: 1100px;
                        margin: 0 auto;
                        padding: 24px;
                    }
                    .header {
                        background: white;
                        border-radius: 16px;
                        padding: 24px;
                        box-shadow: 0 4px 18px rgba(0,0,0,0.08);
                        margin-bottom: 20px;
                    }
                    .sub {
                        color: #666;
                        margin-top: 8px;
                    }
                    .user {
                        margin-top: 12px;
                        font-size: 14px;
                        color: #444;
                    }
                    .toolbar {
                        margin-bottom: 20px;
                        display: flex;
                        gap: 12px;
                        align-items: center;
                        flex-wrap: wrap;
                    }
                    .toolbar select,
                    .toolbar button {
                        padding: 10px 12px;
                        border: 1px solid #ddd;
                        border-radius: 10px;
                        background: white;
                        font-size: 14px;
                    }
                    .toolbar button {
                        cursor: pointer;
                    }
                    .cards {
                        display: grid;
                        grid-template-columns: repeat(3, 1fr);
                        gap: 16px;
                        margin-bottom: 20px;
                    }
                    .card {
                        background: white;
                        border-radius: 16px;
                        padding: 20px;
                        box-shadow: 0 4px 18px rgba(0,0,0,0.08);
                    }
                    .card-label {
                        color: #777;
                        font-size: 14px;
                        margin-bottom: 10px;
                    }
                    .card-value {
                        font-size: 28px;
                        font-weight: bold;
                    }
                    .chart-grid {
                        display: grid;
                        grid-template-columns: 2fr 1fr;
                        gap: 20px;
                        margin-bottom: 20px;
                    }
                    .section {
                        background: white;
                        border-radius: 16px;
                        padding: 20px;
                        box-shadow: 0 4px 18px rgba(0,0,0,0.08);
                    }
                    .section h2 {
                        margin-top: 0;
                        margin-bottom: 16px;
                    }
                    .chart-placeholder {
                        min-height: 280px;
                        border: 2px dashed #d9dce3;
                        border-radius: 12px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        color: #888;
                        background: #fafbff;
                        text-align: center;
                        padding: 20px;
                    }
                    .table-wrap {
                        overflow-x: auto;
                    }
                    table {
                        width: 100%;
                        border-collapse: collapse;
                    }
                    th, td {
                        text-align: left;
                        padding: 12px 10px;
                        border-bottom: 1px solid #eee;
                        font-size: 14px;
                    }
                    th {
                        background: #fafafa;
                    }
                    .muted {
                        color: #888;
                    }
                    @media (max-width: 900px) {
                        .cards {
                            grid-template-columns: 1fr;
                        }
                        .chart-grid {
                            grid-template-columns: 1fr;
                        }
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <h1>📊 Finance Dashboard</h1>
                        <div class="sub">LINE OA Chatbot รายรับ–รายจ่าย</div>
                        <div class="user">userId: ${userId}</div>
                    </div>

                    <div class="toolbar">
                        <label for="days">ช่วงเวลา:</label>
                        <select id="days">
                            <option value="7">ย้อนหลัง 7 วัน</option>
                            <option value="14">ย้อนหลัง 14 วัน</option>
                            <option value="30">ย้อนหลัง 30 วัน</option>
                        </select>
                        <button type="button" id="reloadBtn">รีโหลดข้อมูล</button>
                    </div>

                    <div class="cards">
                        <div class="card">
                            <div class="card-label">รายรับรวม</div>
                            <div class="card-value" id="incomeValue">0 บาท</div>
                        </div>
                        <div class="card">
                            <div class="card-label">รายจ่ายรวม</div>
                            <div class="card-value" id="expenseValue">0 บาท</div>
                        </div>
                        <div class="card">
                            <div class="card-label">คงเหลือ</div>
                            <div class="card-value" id="balanceValue">0 บาท</div>
                        </div>
                    </div>

                    <div class="chart-grid">
                        <div class="section">
                            <h2>Daily Summary</h2>
                            <div class="chart-placeholder">
                                พื้นที่สำหรับ Daily Chart
                            </div>
                        </div>

                        <div class="section">
                            <h2>Category Summary</h2>
                            <div class="chart-placeholder">
                                พื้นที่สำหรับ Category Chart
                            </div>
                        </div>
                    </div>

                    <div class="section">
                        <h2>Recent Transactions</h2>
                        <div class="table-wrap">
                            <table>
                                <thead>
                                    <tr>
                                        <th>วันที่</th>
                                        <th>ประเภท</th>
                                        <th>หมวดหมู่</th>
                                        <th>โน้ต</th>
                                        <th>จำนวน</th>
                                    </tr>
                                </thead>
                                <tbody id="recentTableBody">
                                    <tr>
                                        <td colspan="5" class="muted">กำลังโหลดข้อมูล...</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
                <script>
    const userId = ${JSON.stringify(userId)};

    function formatCurrency(value) {
        return Number(value || 0).toLocaleString('en-US') + ' บาท';
    }

    function formatType(type) {
        if (type === 'income') return 'รายรับ';
        if (type === 'expense') return 'รายจ่าย';
        return type || '-';
    }

    async function fetchJson(url) {
        const res = await fetch(url);
        if (!res.ok) {
            throw new Error('HTTP ' + res.status);
        }
        return res.json();
    }

    function renderRecentTable(items) {
        const tbody = document.getElementById('recentTableBody');

        if (!items || items.length === 0) {
            tbody.innerHTML =
                '<tr>' +
                    '<td colspan="5" class="muted">ยังไม่มีรายการ</td>' +
                '</tr>';
            return;
        }

        tbody.innerHTML = items.map(function(item) {
            return (
                '<tr>' +
                    '<td>' + (item.createdAt || '-') + '</td>' +
                    '<td>' + formatType(item.type) + '</td>' +
                    '<td>' + (item.category || '-') + '</td>' +
                    '<td>' + (item.note || '-') + '</td>' +
                    '<td>' + formatCurrency(item.amount) + '</td>' +
                '</tr>'
            );
        }).join('');
    }

    async function loadRecentTransactions() {
        const tbody = document.getElementById('recentTableBody');

        try {
            tbody.innerHTML =
                '<tr>' +
                    '<td colspan="5" class="muted">กำลังโหลดข้อมูล...</td>' +
                '</tr>';

            const data = await fetchJson(
                '/debug/recent?userId=' + encodeURIComponent(userId) + '&limit=20'
            );

            renderRecentTable(data.items || []);
        } catch (error) {
            console.error('loadRecentTransactions error:', error);

            tbody.innerHTML =
                '<tr>' +
                    '<td colspan="5" class="muted">โหลดข้อมูลไม่สำเร็จ</td>' +
                '</tr>';
        }
    }

    function renderSummary(items) {
        const income = items.reduce((sum, item) => sum + Number(item.income || 0), 0);
        const expense = items.reduce((sum, item) => sum + Number(item.expense || 0), 0);
        const balance = income - expense;

        document.getElementById('incomeValue').textContent = formatCurrency(income);
        document.getElementById('expenseValue').textContent = formatCurrency(expense);
        document.getElementById('balanceValue').textContent = formatCurrency(balance);
    }

    async function loadSummary() {
        try {
            const days = document.getElementById('days').value;

            const data = await fetchJson(
                '/debug/daily-summary?userId=' + encodeURIComponent(userId) + '&days=' + days
            );

            renderSummary(data.items || []);
        } catch (error) {
            console.error('loadSummary error:', error);
        }
    }

    document.getElementById('reloadBtn').addEventListener('click', function() {
        loadRecentTransactions();
        loadSummary();
    });

    loadRecentTransactions();
    loadSummary();
                </script>
            </body>
        </html>
    `);
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});