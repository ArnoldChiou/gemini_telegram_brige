require('dotenv').config();
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');

const ENV_PATH = path.join(__dirname, '.env');

async function ensureConfig() {
    if (fs.existsSync(ENV_PATH) && process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID && process.env.A2A_AUTH_TOKEN) {
        return;
    }
    console.log('--- 🚀 第一次使用：Telegram Bridge 初始化設定 ---');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const question = (query) => new Promise((resolve) => rl.question(query, resolve));
    const botToken = await question('請輸入 Telegram Bot Token: ');
    const chatId = await question('請輸入 Telegram Chat ID: ');
    const a2aToken = await question('請設定一個 A2A 安全金鑰: ');
    const envContent = `TELEGRAM_BOT_TOKEN=${botToken}\nTELEGRAM_CHAT_ID=${chatId}\nA2A_AUTH_TOKEN=${a2aToken}\nPORT=3000`;
    fs.writeFileSync(ENV_PATH, envContent);
    console.log('✅ 設定已儲存！');
    rl.close();
    require('dotenv').config({ path: ENV_PATH });
}

async function startServer() {
    await ensureConfig();

    const app = express();
    app.use(express.json());

    const PORT = process.env.PORT || 3000;
    const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const DEFAULT_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

    const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
    let activeProcess = null;

    console.log('🤖 Telegram Bot 已啟動，等待指令...');

    // --- 安全發送訊息函數 (解決 Telegram 解析脆弱的問題) ---
    async function safeSend(chatId, text) {
        try {
            if (!text || !text.trim()) return;
            
            // 1. 先進行 HTML 轉義
            let html = text
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');

            // 2. 美化標題：將 ### 標題 或 ## 標題 轉化為粗體
            html = html.replace(/^#+\s+(.*)$/gm, '<b>$1</b>');

            // 3. 轉換粗體 **text** -> <b>text</b>
            html = html.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');
            
            // 4. 美化列表符號 (將開頭的 * 換成更漂亮的圓點)
            html = html.replace(/^\*\s+/gm, '• ');

            await bot.sendMessage(chatId, html, { parse_mode: 'HTML' });
        } catch (error) {
            console.error('❌ Telegram HTML 發送失敗，嘗試純文字:', error.message);
            try {
                await bot.sendMessage(chatId, text);
            } catch (e) {
                console.error('❌ 最終發送失敗:', e.message);
            }
        }
    }

    bot.on('message', async (msg) => {
        const chatId = msg.chat.id;
        const text = msg.text;

        if (chatId.toString() !== DEFAULT_CHAT_ID.toString()) return;

        console.log(`📩 [Telegram 收到指令]: ${text}`);

        if (text === '/stop') {
            if (activeProcess) {
                activeProcess.kill();
                await safeSend(chatId, '🛑 已終止目前的 Gemini 任務。');
            }
            return;
        }

        if (activeProcess) {
            activeProcess.stdin.write(text + '\n');
            return;
        }

        await bot.sendMessage(chatId, `Gemini 處理中...`);
        
        const rgPath = path.join(__dirname, 'node_modules', '.bin');
        const env = { ...process.env, NO_COLOR: "1", TERM: "dumb" };
        if (fs.existsSync(rgPath)) {
            env.PATH = `${rgPath}${path.delimiter}${process.env.PATH}`;
        }

        const sessionsPath = path.join(__dirname, '.gemini', 'sessions');
        const resumeFlag = fs.existsSync(sessionsPath) ? '--resume latest' : '';
        const userHome = process.env.USERPROFILE || process.env.HOME;
        const globalGeminiPath = path.join(userHome, '.gemini');

        activeProcess = spawn('powershell.exe', [
            '-NoProfile', 
            '-Command', 
            `$OutputEncoding = [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $env:NO_COLOR=1; $env:TERM='dumb'; gemini ${resumeFlag} --approval-mode yolo --skip-trust --include-directories "${globalGeminiPath}" --prompt "${text.replace(/"/g, '`"')}"`
        ], { env, cwd: __dirname });

        let outputBuffer = '';

        activeProcess.stdout.on('data', (data) => {
            const str = data.toString();
            outputBuffer += str;
            if (str.includes('?')) {
                safeSend(chatId, outputBuffer);
                outputBuffer = '';
            }
        });

        activeProcess.stderr.on('data', (data) => {
            const errStr = data.toString();
            const noise = ['256-color support', 'TERM=dumb', 'Visual rendering will be limited', 'Ripgrep is not available', 'DeprecationWarning', 'node --trace-deprecation'];
            if (!noise.some(msg => errStr.includes(msg))) {
                safeSend(chatId, `⚠️ ${errStr}`);
            }
        });

        activeProcess.on('close', (code) => {
            if (outputBuffer.trim()) {
                safeSend(chatId, outputBuffer);
            }
            if (code !== 0 && code !== null) {
                safeSend(chatId, `🏁 任務異常結束 (Code: ${code})`);
            }
            outputBuffer = '';
            activeProcess = null;
        });
    });

    const authenticate = (req, res, next) => {
        const authHeader = req.headers.authorization;
        if (authHeader === `Bearer ${process.env.A2A_AUTH_TOKEN}`) return next();
        res.status(401).json({ error: 'Unauthorized' });
    };

    app.get('/.well-known/agent.json', (req, res) => {
        res.json({
            name: "telegram",
            description: "Telegram Bridge Agent",
            capabilities: { task: { url: `http://${req.get('host')}/v1/task`, method: "POST" } }
        });
    });

    app.post('/v1/task', authenticate, async (req, res) => {
        const { prompt } = req.body;
        if (prompt) await safeSend(DEFAULT_CHAT_ID, `[Gemini CLI 轉發]:\n${prompt}`);
        res.json({ status: 'success' });
    });

    app.listen(PORT, () => console.log(`✅ 伺服器運行於 port ${PORT}`));
}

startServer();
