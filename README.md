# Gemini CLI Telegram Bridge

這個專案讓你的 Gemini CLI 具備發送訊息到 Telegram 的能力，並提供一個強大的遠端操作介面。

## 🌟 核心功能

*   **雙向溝通**：在 Telegram 直接輸入文字即可觸發 Gemini 任務。
*   **代碼塊優化**：自動處理 Markdown 代碼塊並轉譯為 Telegram 原生格式。
*   **長訊息處理**：自動分割超過 4000 字元的訊息，確保資訊完整。
*   **螢幕截圖**：使用 `/screenshot` 指令即時查看電腦畫面。
*   **任務控制**：使用 `/stop` 隨時中止執行中的任務。
*   **安全防護**：防止 PowerShell 指令注入，確保遠端執行安全。
*   **穩定性**：支援優雅關閉（Graceful Shutdown），避免孤兒程序。

## 快速開始

### 1. 準備 Telegram Bot
1. 在 Telegram 找 `@BotFather` 建立機器人，取得 `Token`。
2. 找 `@userinfobot` 取得你的 `Chat ID`。

### 2. 設定環境變數
第一次執行時，系統會引導你進行互動式設定。你也可以手動編輯 `.env`：
```text
TELEGRAM_BOT_TOKEN=你的Token
TELEGRAM_CHAT_ID=你的ChatID
A2A_AUTH_TOKEN=自訂安全金鑰
PORT=3000
```

### 3. 啟動伺服器
```bash
npm install
npm start
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
在你的系統環境變數中設定：
```powershell
$env:TELEGRAM_BRIDGE_TOKEN="你的 A2A_AUTH_TOKEN"
```

### 6. 使用指令
在 Telegram 中，你可以點擊選單或輸入：
*   `/help` - 顯示完整使用說明。
*   `/stop` - 終止當前任務。
*   `/screenshot` - 擷取螢幕。
*   直接輸入任何問題與 Gemini 對話。
