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

// =====================
// SYSTEM MESSAGES
// =====================
const WELCOME_MESSAGE = `
👋 สวัสดีครับ ระบบบันทึกรายรับ-รายจ่าย

พิมพ์แบบนี้ได้เลย:
- ซื้อปุ๋ย 500
- ขายผัก 3000

📊 ดูสรุป:
พิมพ์ "สรุป"

📱 เปิด Dashboard:
พิมพ์ "แดชบอร์ด"

❓ วิธีใช้:
พิมพ์ "ช่วยเหลือ"
`;

const HELP_MESSAGE = `
📘 วิธีใช้งาน

✏️ บันทึก:
- ซื้อปุ๋ย 500
- ขายไข่ 1200

📌 หลายรายการ:
ซื้อปุ๋ย 500
ซื้ออาหารไก่ 300

📊 สรุป:
พิมพ์ "สรุป"

📱 Dashboard:
พิมพ์ "แดชบอร์ด"
`;

const PARSE_ERROR_MESSAGE = `
❌ ไม่เข้าใจข้อความ

ลองพิมพ์:
- ซื้อปุ๋ย 500
- ขายผัก 3000

❓ พิมพ์ "ช่วยเหลือ"
`;

// =====================
// COMMAND HELPERS
// =====================
function isHelpCommand(text) {
    return ['ช่วยเหลือ', 'เมนู', 'help'].includes(text.toLowerCase());
}

function isSummaryCommand(text) {
    return text.includes('สรุป');
}

function isDashboardCommand(text) {
    return ['แดชบอร์ด', 'dashboard'].includes(text.toLowerCase());
}

function getDashboardUrl(userId) {
    return `${process.env.BASE_URL}/dashboard`;
}

function formatDashboardMessage(userId) {
    const url = getDashboardUrl(userId);
    return `📊 เปิด Dashboard:\n${url}`;
}

const { renderDashboardPage } = require('./views/dashboard');

const app = express();

const config = {
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    channelSecret: process.env.LINE_CHANNEL_SECRET,
    httpConfig: {
        timeout: 10000 // 10 วินาที
    }
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
const CATEGORY_RULES = [
    {
        name: 'ต้นทุนผันแปร',
        priority: 1,
        triggers: ['ซื้อ', 'เติม', 'ใส่', 'ใช้', 'ลง', 'ทำ', 'เอาเข้า', 'ใช้ไป', 'หมดไป'],
        keywords: [
            'เมล็ด', 'เมล็ดพันธุ์', 'เมล็ดผัก', 'เมล็ดข้าว',
            'พันธุ์', 'พันธุ์พืช', 'พันธุ์สัตว์',
            'กล้า', 'ต้นกล้า', 'เพาะกล้า', 'ถาดเพาะ',
            'ลูกไก่', 'ลูกเป็ด', 'ลูกหมู', 'ลูกปลา', 'ลูกกุ้ง',
            'แม่พันธุ์', 'พ่อพันธุ์',

            'ปุ๋ย', 'ปุย', 'ปุ๋ยเคมี', 'ปุ๋ยคอก', 'ปุ๋ยอินทรีย์', 'ปุ๋ยหมัก',
            'ยูเรีย', '151515', '161616', '4600',
            'โดโลไมท์', 'ปูนขาว', 'ยิปซัม',
            'ขี้วัว', 'ขี้ไก่', 'ขี้หมู', 'มูลสัตว์',
            'แกลบ', 'แกลบดิบ', 'แกลบเผา', 'ฟาง', 'ขุยมะพร้าว',
            'ดิน', 'ดินปลูก', 'ปรับดิน', 'บำรุงดิน',

            'ยา', 'ยาแมลง', 'ยาหญ้า', 'ยาหนอน', 'ยาเชื้อ',
            'ยาฆ่าแมลง', 'ยาฆ่าหญ้า', 'ยาฆ่าเชื้อ',
            'พ่นยา', 'ฉีดยา',
            'สารเคมี', 'เคมี', 'ฮอร์โมน',
            'วัคซีน', 'ยาฉีด', 'เวชภัณฑ์',
            'ยาปฏิชีวนะ', 'ยาบำรุง', 'วิตามิน',

            'อาหารสัตว์', 'อาหารไก่', 'อาหารหมู', 'อาหารปลา', 'อาหารกุ้ง',
            'อาหารเม็ด', 'อาหารผง', 'อาหารข้น',
            'รำ', 'รำละเอียด', 'รำหยาบ',
            'ปลายข้าว', 'ข้าวโพด', 'กากถั่ว', 'กากมัน',
            'หัวอาหาร', 'อาหารสำเร็จรูป',

            'น้ำ', 'น้ำประปา', 'เติมน้ำ', 'สูบน้ำ', 'รดน้ำ',
            'ไฟ', 'ไฟฟ้า',
            'ปั๊ม', 'ปั๊มน้ำ', 'เครื่องสูบ',

            'น้ำมัน', 'เติมน้ำมัน', 'น้ำมันเครื่อง', 'น้ำมันดีเซล', 'เบนซิน',
            'น้ำมันเครื่องสูบ', 'น้ำมันรถไถ', 'น้ำมันเครื่องตัดหญ้า',

            'ขี้เลื่อย', 'รองพื้นคอก', 'แกลบรองพื้น',
            'ถุงอาหาร', 'ถุงปุ๋ย', 'เชือก', 'พลาสติกคลุมดิน'
        ],
        patterns: [
            /ซื้อ.*(เมล็ด|พันธุ์|ปุ๋ย|ยา|อาหาร|น้ำมัน)/,
            /เติม.*(น้ำ|น้ำมัน|อาหาร)/,
            /ใส่.*(ปุ๋ย|ยา)/,
            /(พ่น|ฉีด).*(ยา|เคมี)/,
            /ให้.*อาหาร/
        ]
    },
    {
        name: 'ค่าแรง',
        priority: 2,
        triggers: ['จ้าง', 'ใช้แรง', 'ให้คน', 'ทำ'],
        keywords: [
            'จ้าง', 'จ้างคน', 'จ้างแรงงาน', 'แรงงาน', 'คนงาน', 'ลูกน้อง',
            'ทำเอง', 'เจ้าของทำ', 'แรงตัวเอง',
            'รายวัน', 'รายชั่วโมง', 'เหมา',
            'จ้างปลูก', 'จ้างหว่าน', 'จ้างเกี่ยว', 'จ้างเก็บ',
            'จ้างจับหมู', 'จ้างจับไก่',
            'จ้างฉีด', 'จ้างพ่น',
            'ตัดหญ้า', 'ถอนหญ้า', 'ขุดดิน',
            'ล้างคอก', 'ทำความสะอาด'
        ],
        patterns: [
            /จ้าง.*/,
            /(ตัด|ถอน|ขุด|ล้าง|เก็บ).*(คน|จ้าง)/,
            /ทำเอง/
        ]
    },
    {
        name: 'ต้นทุนคงที่',
        priority: 3,
        triggers: ['ซื้อ', 'ลงทุน', 'สร้าง', 'ทำ', 'ติดตั้ง'],
        keywords: [
            'เครื่อง', 'เครื่องมือ', 'อุปกรณ์',
            'เครื่องพ่น', 'เครื่องตัดหญ้า', 'เครื่องสูบ', 'เครื่องไถ',
            'เครื่องบด', 'เครื่องผสมอาหาร',
            'รถไถ', 'รถเกี่ยว',

            'คอก', 'กรง', 'เล้าไก่', 'โรงเรือน',
            'โรงเรือนหมู', 'โรงเรือนไก่',
            'แทงค์น้ำ', 'ถังน้ำใหญ่',

            'ระบบน้ำ', 'ระบบไฟ',
            'ท่อ', 'สปริงเกอร์', 'น้ำหยด',

            'ติดตั้ง', 'ต่อเติม', 'ทำหลังคา', 'ทำพื้น'
        ],
        patterns: [
            /ซื้อ.*(เครื่อง|อุปกรณ์|รถ|คอก|โรงเรือน)/,
            /สร้าง.*(คอก|เล้า|โรงเรือน)/,
            /ติดตั้ง.*ระบบ/
        ]
    },
    {
        name: 'ค่าใช้จ่ายทั่วไป',
        priority: 4,
        triggers: ['ใช้', 'จ่าย', 'ทั่วไป', 'เบ็ดเตล็ด'],
        keywords: [
            'โทร', 'โทรศัพท์', 'เติมเงิน',
            'เน็ต', 'อินเทอร์เน็ต',
            'เดินทาง', 'ใช้รถ',
            'กิน', 'อาหารคน',
            'ของใช้', 'ของจุกจิก',
            'ขน', 'ขนส่ง', 'ส่งของ',
            'รถขน', 'รถบรรทุก',
            'ตลาด', 'แผง', 'เช่าที่', 'เช่าร้าน',
            'แพ็ค', 'บรรจุ', 'ถุง', 'กล่อง', 'ลัง',
            'โพสต์ขาย', 'โปรโมท', 'โฆษณา'
        ],
        patterns: [
            /(ส่ง|ขน).*(ของ)/,
            /(แพ็ค|บรรจุ).*(ของ)/,
            /(โพสต์|โปรโมท)/
        ]
    },
    {
        name: 'การเงิน / หนี้',
        priority: 5,
        triggers: ['กู้', 'ยืม', 'จ่าย', 'ผ่อน', 'คืน', 'โอน'],
        keywords: [
            'กู้', 'กู้เงิน', 'เงินกู้', 'ยืมเงิน',
            'ธนาคาร', 'ธกส', 'แบงค์',
            'จ่ายหนี้', 'ใช้หนี้', 'คืนหนี้', 'ปิดหนี้',
            'ผ่อน', 'งวด',
            'ดอก', 'ดอกเบี้ย',
            'เงินต้น',
            'ค่าปรับ', 'ค่าธรรมเนียม',
            'โอนเงิน', 'ส่งเงิน',
            'หนี้นอก', 'ดอกนอก'
        ],
        patterns: [
            /กู้.*/,
            /ผ่อน.*/,
            /จ่าย.*(หนี้|งวด|ดอก)/,
            /โอน.*เงิน/
        ]
    }
];

// =====================
// WEBHOOK
// =====================
app.post('/webhook', line.middleware(config), (req, res) => {
    const events = req.body.events || [];

    // ตอบ LINE ให้เร็วที่สุดก่อน
    res.status(200).end();

    Promise.all(
        events.map(async (event) => {
            try {
                await handleEvent(event);
            } catch (eventError) {
                console.error('❌ event processing error:', eventError);
            }
        })
    ).catch((error) => {
        console.error('❌ webhook background error:', error);
    });
});

// =====================
// CLASSIFY CATEGORY
// =====================
function classifyCategory(text) {
    const input = String(text || '').trim().toLowerCase();

    if (!input) return 'อื่นๆ';

    // 1. เช็ค pattern ก่อน (แม่นสุด)
    for (const rule of CATEGORY_RULES) {
        const matchedPattern = (rule.patterns || []).some((pattern) => pattern.test(input));
        if (matchedPattern) {
            return rule.name;
        }
    }

    // 2. trigger + keyword
    for (const rule of CATEGORY_RULES) {
        const hasTrigger = (rule.triggers || []).some((trigger) => input.includes(trigger));
        const hasKeyword = (rule.keywords || []).some((keyword) => input.includes(keyword));

        if (hasTrigger && hasKeyword) {
            return rule.name;
        }
    }

    // 3. keyword อย่างเดียว (fallback)
    for (const rule of CATEGORY_RULES) {
        const hasKeyword = (rule.keywords || []).some((keyword) => input.includes(keyword));
        if (hasKeyword) {
            return rule.name;
        }
    }

    return 'อื่นๆ';
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

function isLineNetworkTimeout(error) {
    return (
        error &&
        (
            error.code === 'ETIMEDOUT' ||
            error.code === 'ECONNRESET' ||
            error.code === 'ECONNABORTED' ||
            (error.message && error.message.includes('ETIMEDOUT'))
        )
    );
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

async function safeReply(replyToken, text) {
    return await client.replyMessage(replyToken, {
        type: 'text',
        text
    });
}

// =====================
// HANDLE EVENT
// =====================
async function handleEvent(event) {
    if (event.type === 'follow') {
        return safeReply(event.replyToken, WELCOME_MESSAGE);
    }

    let userId = null;
    let sourceMessageId = null;

    try {
        if (event.type !== 'message' || event.message.type !== 'text') {
            return null;
        }

        sourceMessageId = event.message.id;
        userId = event.source?.userId;
        const text = event.message.text.trim();

        // ===== COMMAND ROUTING =====
        if (isHelpCommand(text)) {
            return safeReply(event.replyToken, HELP_MESSAGE);
        }

        if (isDashboardCommand(text)) {
            return safeReply(event.replyToken, formatDashboardMessage(userId));
        }

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
                replyText = PARSE_ERROR_MESSAGE;
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

            replyText += `📊 สรุปรายการวันนี้

💰 รายรับทั้งหมด: ${formatAmount(summary.income)} บาท
💸 รายจ่ายทั้งหมด: ${formatAmount(summary.expense)} บาท
📦 คงเหลือ: ${formatAmount(summary.balance)} บาท${summary.balance < 0 ? ' ⚠️' : ''}`;
        }

        if (!replyText.trim()) {
            replyText = PARSE_ERROR_MESSAGE;
        }

        return await safeReply(event.replyToken, replyText);

    } catch (error) {
        console.error('❌ handleEvent error:', error);

        const isDuplicate =
            error && error.message && error.message.includes('UNIQUE constraint failed');

        if (isDuplicate) {
            console.log('[DUPLICATE]', {
                userId,
                sourceMessageId
            });

            try {
                return await safeReply(event.replyToken, '⚠️ ข้อความนี้ถูกบันทึกไปแล้ว');
            } catch (replyError) {
                console.error('❌ duplicate reply error:', replyError);
                return null;
            }
        }

        if (isLineNetworkTimeout(error)) {
            console.error('❌ LINE reply timeout - saved data may already exist');
            return null;
        }

        try {
            return await safeReply(event.replyToken, '⚠️ ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง');
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
    res.send(renderDashboardPage(process.env.LIFF_ID));
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});