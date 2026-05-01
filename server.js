require('dotenv').config();
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');

const ENV_PATH = path.join(__dirname, '.env');
const LOG_FILE = path.join(__dirname, 'bridge.log');

// --- 日誌記錄函數 ---
function log(message, type = 'INFO') {
    const timestamp = new Date().toLocaleString();
    const logEntry = `[${timestamp}] [${type}] ${message}\n`;
    console.log(logEntry.trim());
    fs.appendFileSync(LOG_FILE, logEntry);
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

    // 設定指令選單
    bot.setMyCommands([
        { command: 'stop', description: '🛑 終止目前的 Gemini 任務' },
        { command: 'screenshot', description: '📸 擷取目前的螢幕畫面' },
        { command: 'help', description: '❓ 顯示使用說明' }
    ]).then(() => {
        console.log('✅ Telegram 指令選單已更新');
    }).catch((err) => {
        console.error('❌ Telegram 指令選單設定失敗:', err.message);
    });

    // --- 優雅關閉處理 ---
    const shutdown = async () => {
        console.log('\n🛑 正在關閉伺服器...');
        if (activeProcess) {
            console.log('⏳ 正在終止執行中的 Gemini 任務...');
            activeProcess.kill();
        }
        process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    console.log('🤖 Telegram Bot 已啟動，等待指令...');

    // --- 安全發送訊息函數 (解決 Telegram 解析脆弱的問題) ---
    async function safeSend(chatId, text) {
        if (!text || !text.trim()) return;

        const MAX_LENGTH = 3000; // 更保守的分段長度

        // 輔助函數：分割字串
        const splitText = (str, len) => {
            const chunks = [];
            for (let i = 0; i < str.length; i += len) {
                chunks.push(str.substring(i, i + len));
            }
            return chunks;
        };

        const sendChunks = async (chunks, options = {}) => {
            for (const chunk of chunks) {
                if (!chunk || !chunk.trim()) continue;
                try {
                    await bot.sendMessage(chatId, chunk, options);
                    // 如果訊息很多，增加延遲避免觸發 Telegram 頻率限制
                    if (chunks.length > 1) {
                        await new Promise(resolve => setTimeout(resolve, 800));
                    }
                } catch (err) {
                    if (options.parse_mode === 'HTML') {
                        // 如果 HTML 模式失敗（可能是標籤被截斷），嘗試不帶格式發送
                        await bot.sendMessage(chatId, chunk);
                    } else {
                        throw err;
                    }
                }
            }
        };

        try {
            // 1. 先處理代碼塊，避免裡面的符號被轉義後又被二次處理
            const codeBlocks = [];
            let processedText = text.replace(/```(\w*)\n([\s\S]*?)```/g, (match, lang, code) => {
                const placeholder = `__CODE_BLOCK_${codeBlocks.length}__`;
                const escapedCode = code
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;');
                codeBlocks.push(`<pre><code>${escapedCode}</code></pre>`);
                return placeholder;
            });

            // 2. 進行一般的 HTML 轉義 (針對非代碼塊部分)
            processedText = processedText
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');

            // 3. 基本 Markdown 轉換
            processedText = processedText.replace(/^#+\s+(.*)$/gm, '<b>$1</b>');
            processedText = processedText.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');
            processedText = processedText.replace(/\*(.*?)\*/g, '<i>$1</i>');
            processedText = processedText.replace(/_(.*?)_/g, '<i>$1</i>');
            processedText = processedText.replace(/`(.*?)`/g, '<code>$1</code>');
            processedText = processedText.replace(/^\*\s+/gm, '• ');

            // 4. 將代碼塊還原
            codeBlocks.forEach((htmlCode, index) => {
                processedText = processedText.replace(`__CODE_BLOCK_${index}__`, htmlCode);
            });

            // 5. 分段發送
            if (processedText.length > MAX_LENGTH) {
                const chunks = splitText(processedText, MAX_LENGTH);
                await sendChunks(chunks, { parse_mode: 'HTML' });
            } else {
                await bot.sendMessage(chatId, processedText, { parse_mode: 'HTML' });
            }
        } catch (error) {
            console.error('❌ safeSend 發生錯誤:', error.message);
            try {
                const chunks = splitText(text, MAX_LENGTH);
                await sendChunks(chunks);
            } catch (e) {
                console.error('❌ 最終發送失敗:', e.message);
            }
        }
    }

    bot.on('message', async (msg) => {
        const chatId = msg.chat.id;
        const text = msg.text;

        if (chatId.toString() !== DEFAULT_CHAT_ID.toString()) {
            log(`攔截到未授權的使用者訊息 (Chat ID: ${chatId})`, 'WARN');
            return;
        }

        if (!text) {
            log(`收到非文字訊息 (類型: ${Object.keys(msg).find(k => !['message_id', 'from', 'chat', 'date'].includes(k))})`, 'DEBUG');
            return;
        }

        log(`[Telegram 指令]: ${text}`);

        if (text === '/stop') {
            if (activeProcess) {
                activeProcess.kill();
                log('使用者要求終止任務');
                await safeSend(chatId, '🛑 已終止目前的 Gemini 任務。');
            }
            return;
        }

        if (text === '/screenshot') {
            await bot.sendMessage(chatId, '📸 正在擷取螢幕畫面...');
            const screenshotPath = path.join(__dirname, `screenshot_${Date.now()}.png`);
            const psCommand = `Add-Type -AssemblyName System.Windows.Forms, System.Drawing; $screen = [System.Windows.Forms.Screen]::PrimaryScreen; $bitmap = New-Object System.Drawing.Bitmap($screen.Bounds.Width, $screen.Bounds.Height); $graphics = [System.Drawing.Graphics]::FromImage($bitmap); $graphics.CopyFromScreen($screen.Bounds.X, $screen.Bounds.Y, 0, 0, $bitmap.Size); $bitmap.Save('${screenshotPath}', [System.Drawing.Imaging.ImageFormat]::Png); $graphics.Dispose(); $bitmap.Dispose();`;
            
            const ps = spawn('powershell.exe', ['-NoProfile', '-Command', psCommand]);
            ps.on('error', async (err) => {
                console.error('❌ PowerShell 啟動失敗:', err.message);
                await safeSend(chatId, `❌ 擷取失敗: 無法啟動 PowerShell (${err.message})`);
            });

            ps.on('close', async (code) => {
                if (code === 0 && fs.existsSync(screenshotPath)) {
                    try {
                        await bot.sendPhoto(chatId, screenshotPath, { caption: '🖥️ 目前的螢幕截圖' });
                        fs.unlinkSync(screenshotPath);
                    } catch (sendErr) {
                        console.error('❌ 截圖傳送失敗:', sendErr.message);
                        await safeSend(chatId, `❌ 截圖傳送失敗: ${sendErr.message}`);
                    }
                } else {
                    console.error(`❌ 螢幕擷取失敗，Exit Code: ${code}`);
                    await safeSend(chatId, `❌ 螢幕擷取失敗 (Code: ${code})。請確認是否在具有 GUI 的環境下執行。`);
                }
            });
            return;
        }

        if (text === '/help') {
            const helpMsg = `
<b>🤖 Gemini Telegram Bridge 使用說明</b>

• <b>直接輸入文字</b>：傳送給 Gemini 進行處理。
• <b>/stop</b>：終止目前正在執行的任務。
• <b>/screenshot</b>：擷取目前電腦螢幕畫面。
• <b>/help</b>：顯示此說明。

<i>注意：本服務預設開啟 YOLO 模式，Gemini 將自動執行指令。</i>`;
            await safeSend(chatId, helpMsg);
            return;
        }

        if (activeProcess) {
            activeProcess.stdin.write(text + '\n');
            return;
        }

        await bot.sendMessage(chatId, `Gemini 處理中...`);
        
        const PARENT_DIR = path.join(__dirname, '..');
        const rgPath = path.join(__dirname, 'node_modules', '.bin');
        const env = { ...process.env, NO_COLOR: "1", TERM: "dumb" };
        if (fs.existsSync(rgPath)) {
            env.PATH = `${rgPath}${path.delimiter}${process.env.PATH}`;
        }

        const sessionsPath = path.join(PARENT_DIR, '.gemini', 'sessions');
        const resumeFlag = fs.existsSync(sessionsPath) ? '--resume latest' : '';
        const userHome = process.env.USERPROFILE || process.env.HOME;
        const globalGeminiPath = path.join(userHome, '.gemini');

        // 安全地處理 PowerShell 特殊字元 (", $, `)
        const escapedPrompt = text
            .replace(/`/g, '``')
            .replace(/\$/g, '`$')
            .replace(/"/g, '`"');

        activeProcess = spawn('powershell.exe', [
            '-NoProfile', 
            '-Command', 
            `$OutputEncoding = [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $env:NO_COLOR=1; $env:TERM='dumb'; gemini ${resumeFlag} --approval-mode yolo --skip-trust --include-directories "${globalGeminiPath}" --prompt "${escapedPrompt}"`
        ], { env, cwd: PARENT_DIR });

        let outputBuffer = '';
        let lastSendTime = Date.now();

        activeProcess.stdout.on('data', (data) => {
            let str = data.toString();
            // 過濾 YOLO 模式警告訊息
            str = str.replace(/⚠️ YOLO mode is enabled\. All tool calls will be automatically approved\./g, '');
            
            outputBuffer += str;
            
            const currentTime = Date.now();
            // 每 2 秒發送一次，或者累積超過 2000 字元時發送，避免 buffer 過大
            if (str.includes('?') || outputBuffer.length > 2000 || (currentTime - lastSendTime > 2000 && outputBuffer.length > 50)) {
                safeSend(chatId, outputBuffer);
                outputBuffer = '';
                lastSendTime = currentTime;
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
                'YOLO mode is enabled'
            ];
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
        if (prompt) {
            log(`收到外部轉發任務: ${prompt.substring(0, 50)}...`);
            await safeSend(DEFAULT_CHAT_ID, `[Gemini CLI 轉發]:\n${prompt}`);
        }
        res.json({ status: 'success' });
    });

    app.listen(PORT, () => log(`伺服器運行於 port ${PORT}`));
}

startServer();
