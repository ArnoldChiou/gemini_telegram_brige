# Gemini CLI Telegram Bridge

這個專案讓你的 Gemini CLI 具備發送訊息到 Telegram 的能力。

## 快速開始

### 1. 準備 Telegram Bot
1. 在 Telegram 找 `@BotFather` 建立機器人，取得 `Token`。
2. 找 `@userinfobot` 取得你的 `Chat ID`。

### 2. 設定環境變數
將 `.env.example` 複製為 `.env` 並填入資料：
```bash
cp .env.example .env
```

### 3. 啟動伺服器
```bash
npm install
node server.js
```

### 4. 在 Gemini CLI 註冊
將 `telegram-agent.md` 移動（或連結）到 Gemini 的代理目錄：
*   **Windows**: `%USERPROFILE%\.gemini\agents\telegram.md`
*   **指令**: 
    ```bash
    mkdir -Force ~\.gemini\agents
    cp .\telegram-agent.md ~\.gemini\agents\telegram.md
    ```

### 5. 設定驗證 Token
在你的系統環境變數或 `.bashrc` / `profile.ps1` 中設定：
```powershell
$env:TELEGRAM_BRIDGE_TOKEN="你在 .env 設定的 A2A_AUTH_TOKEN"
```

### 6. 測試
在 Gemini CLI 輸入：
> invoke_agent telegram "哈囉，這是一則來自 CLI 的測試訊息"
