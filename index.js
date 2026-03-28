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
    try {
        if (event.type !== 'message' || event.message.type !== 'text') {
            return null;
        }

        const sourceMessageId = event.message.id;
        const userId = event.source?.userId;
        const text = event.message.text.trim();

        if (!userId) {
            console.error('❌ Missing userId in event source');
            return null;
        }

        const isSummaryRequest = text.includes("สรุป");

        // 🔹 parse
        const parsedList = parseMessage(text);

        let totalIncome = 0;
        let totalExpense = 0;

        parsedList.forEach(tx => {
            if (tx.type === "income") totalIncome += tx.amount;
            if (tx.type === "expense") totalExpense += tx.amount;
        });

        // 🔹 save (await จริง)
        if (parsedList.length > 0) {
            await Promise.all(
                parsedList.map((tx, index) =>
                    saveTransaction(userId, tx, sourceMessageId, index)
                )
            );
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

        // 🔹 summary
        if (isSummaryRequest) {
            const summary = await getTodaySummaryAsync(userId);

            replyText += `📊 สรุปวันนี้

💰 รายรับทั้งหมด: ${formatAmount(summary.income)} บาท
💸 รายจ่ายทั้งหมด: ${formatAmount(summary.expense)} บาท
📦 คงเหลือ: ${formatAmount(summary.balance)} บาท${summary.balance < 0 ? ' ⚠️' : ''}`;
        }

        // กันกรณีข้อความว่าง
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
    res.send('LINE Bot Ready');
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});