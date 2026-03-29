function renderDashboardPage(liffId) {
    if (!liffId) {
        return `
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
                        <p class="error">Missing LIFF ID</p>
                        <p>กรุณาตั้งค่า LIFF_ID ใน server</p>
                    </div>
                </body>
            </html>
        `;
    }

    return `
        <html>
            <head>
                <title>Dashboard</title>
                <meta name="viewport" content="width=device-width, initial-scale=1" />
                <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
                <script src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script>
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
                        <div class="user" id="userText">กำลังโหลด user...</div>
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
                            <canvas id="dailyChart" height="120"></canvas>
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
                    const LIFF_ID = ${JSON.stringify(liffId)};
                    let currentUserId = null;
                    let dailyChart = null;

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
                                '/debug/recent?userId=' + encodeURIComponent(currentUserId) + '&limit=20'
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
                                '/debug/daily-summary?userId=' + encodeURIComponent(currentUserId) + '&days=' + days
                            );

                            const items = data.items || [];

                            renderSummary(items);
                            renderDailyChart(items);
                        } catch (error) {
                            console.error('loadSummary error:', error);
                        }
                    }

                    function renderDailyChart(items) {
                        const canvas = document.getElementById('dailyChart');
                        if (!canvas) return;

                        const sortedItems = (items || []).slice().reverse();

                        const labels = sortedItems.map(function(item) {
                            return item.date || '-';
                        });

                        const incomeData = sortedItems.map(function(item) {
                            return Number(item.income || 0);
                        });

                        const expenseData = sortedItems.map(function(item) {
                            return Number(item.expense || 0);
                        });

                        if (dailyChart) {
                            dailyChart.destroy();
                        }

                        dailyChart = new Chart(canvas, {
                            type: 'bar',
                            data: {
                                labels: labels,
                                datasets: [
                                    {
                                        label: 'รายรับ',
                                        data: incomeData
                                    },
                                    {
                                        label: 'รายจ่าย',
                                        data: expenseData
                                    }
                                ]
                            },
                            options: {
                                responsive: true,
                                maintainAspectRatio: true,
                                plugins: {
                                    legend: {
                                        position: 'top'
                                    }
                                },
                                scales: {
                                    y: {
                                        beginAtZero: true
                                    }
                                }
                            }
                        });
                    }

                    async function initDashboard() {
                        try {
                            await liff.init({ liffId: LIFF_ID });

                            if (!liff.isLoggedIn()) {
                                liff.login();
                                return;
                            }

                            const context = liff.getContext();
                            currentUserId = context && context.userId ? context.userId : null;

                            if (!currentUserId) {
                                document.getElementById('userText').textContent = 'ไม่พบ userId จาก LIFF';
                                return;
                            }

                            document.getElementById('userText').textContent = 'userId: ' + currentUserId;

                            await loadRecentTransactions();
                            await loadSummary();
                        } catch (error) {
                            console.error('initDashboard error:', error);
                            document.getElementById('userText').textContent = 'โหลด LIFF ไม่สำเร็จ';
                        }
                    }

                    document.getElementById('reloadBtn').addEventListener('click', function() {
                        loadRecentTransactions();
                        loadSummary();
                    });

                    document.getElementById('days').addEventListener('change', function() {
                        loadSummary();
                    });

                    initDashboard();
                </script>
            </body>
        </html>
    `;
}

module.exports = {
    renderDashboardPage
};