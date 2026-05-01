---
kind: remote
name: telegram
description: 用於發送通知與接收 Telegram 反饋的橋接代理。
agent_card_url: http://localhost:3000/.well-known/agent.json
auth:
  type: http
  scheme: Bearer
  value: $TELEGRAM_BRIDGE_TOKEN
---

# Telegram 橋接代理
此代理允許 Gemini CLI 將訊息轉發至 Telegram。

## 使用方式
你可以叫 Gemini CLI：
- "invoke_agent telegram '測試訊息'"
- "把剛剛生成的代碼發送到 telegram"
