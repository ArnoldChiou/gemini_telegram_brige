require('dotenv').config();
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');

const ENV_PATH = path.join(__dirname, '.env');
const LOG_PATH = path.join(__dirname, 'bridge.log');

// --- 日誌工具 ---
function log(message, level = 'INFO') {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${level}] ${message}\n`;
    console.log(logMessage.trim());
    try {
        fs.appendFileSync(LOG_PATH, logMessage, 'utf8');
    } catch (err) {
        console.error('無法寫入日誌:', err.message);
    }
}

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
    fs.writeFileSync(ENV_PATH, envContent, 'utf8');
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

    log('🤖 Telegram Bot 已啟動，等待指令...');

    // --- 安全發送訊息函數 (支援長訊息分割) ---
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

            // 4. 美化列表符號
            html = html.replace(/^\*\s+/gm, '• ');

            // 5. 處理超過 4000 字元的訊息
            const MAX_LENGTH = 4000;
            if (html.length > MAX_LENGTH) {
                const chunks = [];
                for (let i = 0; i < html.length; i += MAX_LENGTH) {
                    chunks.push(html.substring(i, i + MAX_LENGTH));
                }
                for (const chunk of chunks) {
                    await bot.sendMessage(chatId, chunk, { parse_mode: 'HTML' });
                }
            } else {
                await bot.sendMessage(chatId, html, { parse_mode: 'HTML' });
            }
        } catch (error) {
            log(`Telegram HTML 發送失敗: ${error.message}`, 'ERROR');
            try {
                // 如果 HTML 失敗，嘗試純文字
                if (text.length > 4000) {
                    for (let i = 0; i < text.length; i += 4000) {
                        await bot.sendMessage(chatId, text.substring(i, i + 4000));
                    }
                } else {
                    await bot.sendMessage(chatId, text);
                }
            } catch (e) {
                log(`最終發送失敗: ${e.message}`, 'ERROR');
            }
        }
    }

    bot.on('message', async (msg) => {
        const chatId = msg.chat.id;
        const text = msg.text;

        if (!text) return;
        if (chatId.toString() !== DEFAULT_CHAT_ID.toString()) {
            log(`攔截到未授權的使用者訊息 (Chat ID: ${chatId})`, 'WARN');
            return;
        }

        log(`[Telegram 指令]: ${text}`);

        if (text === '/start' || text === '/help') {
            const helpMsg = `
🌟 **Gemini CLI Telegram Bridge** 🌟

- 直接輸入文字：開始 Gemini 對話
- /stop：終止當前任務
- /screenshot：擷取目前電腦畫面
- /help：顯示此說明
            `;
            await safeSend(chatId, helpMsg);
            return;
        }

        if (text === '/stop') {
            if (activeProcess) {
                activeProcess.kill();
                await safeSend(chatId, '🛑 已終止目前的 Gemini 任務。');
            } else {
                await safeSend(chatId, '目前沒有執行中的任務。');
            }
            return;
        }

        if (text === '/screenshot') {
            await bot.sendMessage(chatId, '📸 正在擷取螢幕...');
            const tempImg = path.join(__dirname, `screenshot_${Date.now()}.png`);
            // 使用 PowerShell 擷取螢幕 (無需額外 package)
            const captureCmd = `chcp 65001 >$null; [Console]::OutputEncoding = [System.Text.Encoding]::UTF8;
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$Screen = [System.Windows.Forms.Screen]::PrimaryScreen
$Width = $Screen.Bounds.Width
$Height = $Screen.Bounds.Height
$Left = $Screen.Bounds.Left
$Top = $Screen.Bounds.Top
$Bitmap = New-Object System.Drawing.Bitmap $Width, $Height
$Graphics = [System.Drawing.Graphics]::FromImage($Bitmap)
$Graphics.CopyFromScreen($Left, $Top, 0, 0, $Bitmap.Size)
$Bitmap.Save("${tempImg.replace(/\\/g, '\\\\')}", [System.Drawing.Imaging.ImageFormat]::Png)
$Graphics.Dispose()
$Bitmap.Dispose()
            `;
            
            const ps = spawn('powershell.exe', ['-NoProfile', '-Command', captureCmd]);

            ps.on('close', async (code) => {
                if (code === 0 && fs.existsSync(tempImg)) {
                    await bot.sendPhoto(chatId, tempImg);
                    fs.unlinkSync(tempImg);
                } else {
                    await safeSend(chatId, '❌ 螢幕擷取失敗。');
                }
            });
            return;
        }

        if (activeProcess) {
            activeProcess.stdin.write(text + '\n');
            return;
        }

        await bot.sendMessage(chatId, `⏳ Gemini 處理中...`);

        const PARENT_DIR = path.join(__dirname, '..');
        const env = { ...process.env, NO_COLOR: "1", TERM: "dumb" };
        
        const sessionsPath = path.join(PARENT_DIR, '.gemini', 'sessions');
        const resumeFlag = fs.existsSync(sessionsPath) ? '--resume latest' : '';
        const userHome = process.env.USERPROFILE || process.env.HOME;
        const globalGeminiPath = path.join(userHome, '.gemini');

        // 遵循 GEMINI.md 規範，加入 chcp 65001
        const geminiCmd = `chcp 65001 >$null; $OutputEncoding = [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $env:NO_COLOR=1; $env:TERM='dumb'; gemini ${resumeFlag} --approval-mode yolo --skip-trust --include-directories "${globalGeminiPath}" --prompt "${text.replace(/"/g, '`"')}"`;

        activeProcess = spawn('powershell.exe', [
            '-NoProfile',
            '-Command',
            geminiCmd
        ], { env, cwd: PARENT_DIR });

        let outputBuffer = '';

        activeProcess.stdout.on('data', (data) => {
            let str = data.toString();
            
            // 過濾噪音訊息
            const noisePatterns = [
                /.*YOLO mode is enabled\. All tool calls will be automatically approved\..*\n?/g,
                /.*\[telegram\] Failed to load remote agent: Cannot read properties of undefined.*\n?/g
            ];
            noisePatterns.forEach(pattern => {
                str = str.replace(pattern, '');
            });

            if (!str) return;

            outputBuffer += str;
            // 如果看到問號，可能是 Gemini 在等待輸入，先發送目前的 buffer
            if (str.includes('?')) {
                safeSend(chatId, outputBuffer);
                outputBuffer = '';
            }
        });

        activeProcess.stderr.on('data', (data) => {
            const errStr = data.toString();
            const noise = [
                '256-color support',
                'TERM=dumb',
                'Visual rendering will be limited',
                'Ripgrep is not available',
                'DeprecationWarning',
                'node --trace-deprecation',
                'AttachConsole failed',
                'conpty_console_list_agent.js',
                'YOLO mode is enabled',
                'Failed to load remote agent'
            ];
            if (!noise.some(msg => errStr.includes(msg))) {
                log(`[Stderr] ${errStr}`, 'WARN');
                safeSend(chatId, `⚠️ ${errStr}`);
            }
        });

        activeProcess.on('close', (code) => {
            if (outputBuffer.trim()) {
                safeSend(chatId, outputBuffer);
            }
            if (code !== 0 && code !== null) {
                log(`任務異常結束 (Code: ${code})`, 'ERROR');
                safeSend(chatId, `🏁 任務完成或異常結束 (Code: ${code})`);
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
        if (prompt) {
            log(`[Gemini CLI 轉發]: ${prompt}`);
            await safeSend(DEFAULT_CHAT_ID, `<b>[Gemini CLI 轉發]</b>\n${prompt}`);
        }
        res.json({ status: 'success' });
    });

    app.listen(PORT, () => log(`✅ 伺服器運行於 port ${PORT}`));

    // 優雅關閉
    process.on('SIGINT', () => {
        log('收到 SIGINT，關閉伺服器...');
        if (activeProcess) activeProcess.kill();
        process.exit(0);
    });
}

startServer();

