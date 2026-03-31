const {
    getTodaySummary,
    getRecentTransactions,
    getTodayCategorySummary,
    getDailySummary
} = require('../db/database');

function formatCurrency(n) {
    return Number(n || 0).toLocaleString('en-US');
}

function buildInsightData(userId) {
    const todaySummary = getTodaySummary(userId);
    const daily = getDailySummary(userId, 7);
    const category = getTodayCategorySummary(userId);
    const recent = getRecentTransactions(userId, 15);

    return {
        todaySummary,
        daily,
        category,
        recent
    };
}

function hasEnoughData(data) {
    return data.recent && data.recent.length >= 3;
}

// 🔥 MOCK AI (ยังไม่ใช้ OpenAI)
function mockAIResponse(data) {
    const { todaySummary, category } = data;

    let topCategory = null;

    if (category && category.length > 0) {
        const expenseCats = category.filter(c => c.type === 'expense');
        if (expenseCats.length > 0) {
            topCategory = expenseCats[0].category;
        }
    }

    return `
📊 ภาพรวม
วันนี้คุณมีรายรับ ${formatCurrency(todaySummary.income)} บาท
รายจ่าย ${formatCurrency(todaySummary.expense)} บาท

${todaySummary.balance < 0 ? '⚠️ รายจ่ายมากกว่ารายรับ' : '✅ ยังมีเงินเหลือ'}

⚠️ สิ่งที่ควรระวัง
${topCategory ? `- หมวด ${topCategory} ใช้เงินค่อนข้างสูง` : '- ยังไม่มีข้อมูลหมวดชัดเจน'}

💡 คำแนะนำ
1. ควบคุมค่าใช้จ่ายหมวดหลัก
2. บันทึกรายรับเพิ่มให้ครบ
3. ตรวจสอบต้นทุนที่ลดได้
`.trim();
}

async function generateAIInsight(userId) {
    const data = buildInsightData(userId);

    if (!hasEnoughData(data)) {
        return '📊 ยังมีข้อมูลไม่เพียงพอสำหรับการวิเคราะห์\nลองบันทึกเพิ่มอีกสัก 2-3 รายการแล้วลองใหม่อีกครั้ง';
    }

    // 🚧 ตอนนี้ยังไม่เรียก OpenAI
    return mockAIResponse(data);
}

module.exports = {
    generateAIInsight
};