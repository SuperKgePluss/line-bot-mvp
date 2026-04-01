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
const { generateAIInsight } = require('./services/ai');

// =====================
// SYSTEM MESSAGES
// =====================
const WELCOME_MESSAGE = `
👋 สวัสดีครับ นี่คือระบบบันทึกรายรับ-รายจ่ายสำหรับเกษตรกร

ช่วยคุณ:
✅ บันทึกเงินเข้า-ออก ง่าย ๆ
✅ สรุปยอดอัตโนมัติ
✅ ดูภาพรวมผ่าน Dashboard

━━━━━━━━━━━

✏️ เริ่มใช้งานทันที:

ลองพิมพ์:
👉 ซื้อปุ๋ย 500
👉 ขายผัก 3000

━━━━━━━━━━━

📊 ดูสรุป:
พิมพ์ "สรุป"

📱 เปิด Dashboard:
พิมพ์ "แดชบอร์ด" หรือกดเมนูด้านล่าง

❓ วิธีใช้เพิ่มเติม:
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
❌ ไม่พบจำนวนเงินในข้อความ

ลองพิมพ์:
- ซื้อปุ๋ย 500 บาท
- ขายผัก ได้เงิน 3000 บาท

📌 ถ้ามีตัวเลขหลายตัว เช่น "300 กิโล 5000 บาท"
ระบบจะใช้ตัวเลขที่เป็น "บาท"
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

function isAIInsightCommand(text) {
    const t = text.toLowerCase().trim();

    return (
        t === 'วิเคราะห์' ||
        t === 'ขอคำแนะนำ' ||
        t === 'รายจ่ายเป็นยังไงบ้าง' ||
        t === 'ช่วยดูการเงินหน่อย' ||
        t === 'ช่วยดูการเงิน' ||
        t === 'insight'
    );
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

    for (const rule of CATEGORY_RULES) {
        const matchedPattern = (rule.patterns || []).some((pattern) => pattern.test(input));
        if (matchedPattern) {
            return rule.name;
        }
    }

    for (const rule of CATEGORY_RULES) {
        const hasTrigger = (rule.triggers || []).some((trigger) => input.includes(trigger));
        const hasKeyword = (rule.keywords || []).some((keyword) => input.includes(keyword));

        if (hasTrigger && hasKeyword) {
            return rule.name;
        }
    }

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
    const input = String(text || '').trim().toLowerCase();

    if (!input) return null;

    if (/(ขาย|รายรับ|รับมา|ได้เงิน|ได้มา|โอนเข้า|เงินเข้า|รับเงิน)/.test(input)) {
        return 'income';
    }

    if (/(ซื้อ|รายจ่าย|จ่าย|ค่า|ค่าส่ง|โอนออก|เสีย|หมดไป|ผ่อน|ชำระ)/.test(input)) {
        return 'expense';
    }

    return null;
}

function cleanItemText(text) {
    return String(text || '')
        .replace(/(รายรับ|รายจ่าย|บาทถ้วน|บาท|แล้ว|และ|กับ|จากนั้น|เอาไป|ได้เงิน|ได้มา|รับมา)/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

const NON_MONEY_UNITS = [
    'กิโล', 'กก', 'ก.ก.', 'กิโลกรัม', 'โล',
    'ตัว', 'ชิ้น', 'ถุง', 'ลัง', 'ฟอง', 'แพ็ค', 'แพก',
    'ไร่', 'งาน', 'เมตร', 'ม.', 'ลิตร', 'ตัน', 'กระสอบ',
    'ใบ', 'ขวด', 'กล่อง', 'ชุด', 'คัน', 'เครื่อง'
];

function escapeRegex(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isQuantityUnitAfterNumber(text, amountEnd) {
    const tail = text.slice(amountEnd, amountEnd + 20).trim();

    return NON_MONEY_UNITS.some((unit) => {
        const re = new RegExp(`^${escapeRegex(unit)}(?:\\b|\\s|$)`);
        return re.test(tail);
    });
}

function scoreAmountCandidate(fullText, amountStart, amountEnd, amount) {
    let score = 0;

    const left = fullText.slice(Math.max(0, amountStart - 30), amountStart);
    const right = fullText.slice(amountEnd, Math.min(fullText.length, amountEnd + 30));
    const around = `${left} ${right}`;

    if (/^(\s*)บาท\b/.test(right)) score += 100;
    if (/(ได้เงิน|ได้มา|รับมา|รับเงิน|ขาย)/.test(left)) score += 40;
    if (/(ซื้อ|จ่าย|ค่าส่ง|ค่า|ผ่อน|ชำระ|เติม)/.test(left)) score += 25;

    if (isQuantityUnitAfterNumber(fullText, amountEnd)) score -= 120;

    if (amount < 1000 && !/บาท/.test(around) && !/(ได้เงิน|ได้มา|รับมา|รับเงิน|ขาย|ซื้อ|จ่าย|ค่า|เติม|ผ่อน)/.test(left)) {
        score -= 20;
    }

    return score;
}

function findBestAmountMatch(text) {
    const amountRegex = /(\d[\d,]*(?:\.\d+)?)/g;
    const matches = [...text.matchAll(amountRegex)];

    if (matches.length === 0) return null;

    const candidates = matches
        .map((match) => {
            const amountRaw = match[1];
            const amount = parseFloat(amountRaw.replace(/,/g, ''));
            const start = match.index;
            const end = start + amountRaw.length;

            if (!amount || amount <= 0) return null;

            return {
                match,
                amountRaw,
                amount,
                start,
                end,
                score: scoreAmountCandidate(text, start, end, amount)
            };
        })
        .filter(Boolean)
        .sort((a, b) => b.score - a.score || b.amount - a.amount);

    if (candidates.length === 0) return null;

    const best = candidates[0];

    if (best.score < 0) {
        return null;
    }

    return best;
}

function formatAmount(amount) {
    return Number(amount || 0).toLocaleString('en-US');
}

function formatTypeLabel(type) {
    if (type === 'income') return 'รายรับ';
    if (type === 'expense') return 'รายจ่าย';
    return '-';
}

function formatTransactionLine(tx) {
    return `- ${tx.note || 'ไม่ระบุ'} | ${formatTypeLabel(tx.type)} | ${formatAmount(tx.amount)} บาท | ${tx.category || 'อื่นๆ'}`;
}

function formatSuccessReply(parsedList) {
    if (!parsedList || parsedList.length === 0) {
        return PARSE_ERROR_MESSAGE;
    }

    let totalIncome = 0;
    let totalExpense = 0;

    parsedList.forEach((tx) => {
        if (tx.type === 'income') totalIncome += tx.amount;
        if (tx.type === 'expense') totalExpense += tx.amount;
    });

    let message = `✅ บันทึกเรียบร้อย ${parsedList.length} รายการ\n\n📋 รายการที่บันทึก:\n`;

    message += parsedList
        .slice(0, 5)
        .map(formatTransactionLine)
        .join('\n');

    if (parsedList.length > 5) {
        message += `\n... และอีก ${parsedList.length - 5} รายการ`;
    }

    message += '\n\n📊 สรุปจากข้อความนี้\n';

    if (totalIncome > 0) {
        message += `📈 รายรับ: ${formatAmount(totalIncome)} บาท\n`;
    }

    if (totalExpense > 0) {
        message += `📉 รายจ่าย: ${formatAmount(totalExpense)} บาท\n`;
    }

    message += '\nพิมพ์ "สรุป" เพื่อดูภาพรวมวันนี้';

    return message;
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

function parseMessage(text) {
    const normalized = normalizeText(text);

    const cleaned = normalized
        .replace(/สรุปวันนี้|สรุปรายวัน|สรุป/g, ' ')
        .trim();

    if (!cleaned) {
        return [];
    }

    const lines = cleaned
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean);

    const inputLines = lines.length > 0 ? lines : [cleaned];
    const results = [];
    let lastType = null;

    for (const line of inputLines) {
        const best = findBestAmountMatch(line);

        if (!best) {
            continue;
        }

        const leftContext = line.slice(0, best.start).trim();

        let type = detectType(leftContext);

        if (!type) {
            type = detectType(line);
        }

        if (!type && lastType) {
            type = lastType;
        }

        if (!type && /(ซื้อ|ขาย|จ่าย|ได้เงิน|ได้มา|รับมา|รับเงิน|ค่า|เติม|ผ่อน|จ้าง)/.test(line)) {
            type = /(ขาย|ได้เงิน|ได้มา|รับมา|รับเงิน)/.test(line) ? 'income' : 'expense';
        }

        if (!type) {
            continue;
        }

        if (type) {
            lastType = type;
        }

        let note = cleanItemText(leftContext);
        note = note.replace(/(.+)\s+\1$/, '$1');
        if (!note) {
            note = cleanItemText(line.replace(best.amountRaw, ' '));
        }

        note = note
            .replace(/\s+/g, ' ')
            .trim();

        const category = classifyCategory(note || line || 'อื่นๆ');

        results.push({
            type,
            amount: best.amount,
            category,
            note: note || 'ไม่ระบุ'
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

        const isSummaryRequest = isSummaryCommand(text);

        if (isAIInsightCommand(text)) {
            const insight = await generateAIInsight(userId);
            return safeReply(event.replyToken, insight);
        }

        const parsedList = parseMessage(text);

        console.log('[PARSED]', parsedList);

        if (parsedList.length > 0) {
            await Promise.all(
                parsedList.map((tx, index) =>
                    saveTransaction(userId, tx, sourceMessageId, index)
                )
            );
        }

        if (parsedList.length > 0) {
            console.log('[SAVED]', {
                count: parsedList.length
            });
        }

        let replyText = '';

        if (parsedList.length === 0) {
            if (!isSummaryRequest) {
                replyText = PARSE_ERROR_MESSAGE;
            }
        } else {
            replyText = formatSuccessReply(parsedList) + '\n\n';
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
// ROOT
// =====================
app.get('/', (req, res) => {
    res.send('LINE Bot Ready');
});

// =====================
// PRODUCTION API FOR DASHBOARD
// =====================
app.get('/api/recent', (req, res) => {
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
        console.error('❌ /api/recent error:', error);
        res.status(500).json({
            ok: false,
            error: 'Internal server error'
        });
    }
});

app.get('/api/category-summary', (req, res) => {
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
        console.error('❌ /api/category-summary error:', error);
        res.status(500).json({
            ok: false,
            error: 'Internal server error'
        });
    }
});

app.get('/api/daily-summary', (req, res) => {
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
        console.error('❌ /api/daily-summary error:', error);
        res.status(500).json({
            ok: false,
            error: 'Internal server error'
        });
    }
});

// =====================
// DEBUG API
// =====================
if (process.env.ENABLE_DEBUG === 'true') {
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
}

app.get('/dashboard', (req, res) => {
    res.send(renderDashboardPage(process.env.LIFF_ID));
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});