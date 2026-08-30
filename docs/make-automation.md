# Make 自動化設定 — 成交通知

> 目標：有人付錢的那一刻，你 5 秒內就知道；名單自動進 Google Sheets。

## 1. 在 Make 建立 Webhook 情境

1. 登入 make.com → 新增 Scenario
2. 第一個模組選 **Webhooks → Custom Webhook** → Add
3. 建立後會拿到一個網址（長得像 `https://hook.make.com/xxx`）
4. 把網址填進 `.env` 的 `MAKE_WEBHOOK_URL`，重啟 server

## 2. 情境接法（Router 分流）

```
Webhook → Router（依 event 分流）
           ├─ order.paid       → LINE 通知你 ＋ Google Sheets 新增一列
           ├─ order.created    → Google Sheets 新增一列（潛在名單）
           └─ order.atm_pending→ LINE 通知你（ATM 帳號已開，等轉帳）
```

## 3. Webhook 收到的資料（payload）

| 欄位 | 說明 |
|:--|:--|
| `event` | `order.created` / `order.paid` / `order.atm_pending` |

> `order.created` 的**時機**在結果式付費之後變了：現在是對方**送出免費問卷並留下聯絡方式**時就發，不再是進到結帳時。事件名稱維持不變，既有的 router 不用動；payload 多了 `contact`。
>
> 刻意不在建立案件（開啟 `submit.html`）時就發——那會把「開了頁面又關掉」也記成一筆名單。
| `orderId` | 訂單編號（如 `KC20260820225801137`） |
| `amount` | 金額（499） |
| `result` | 測驗維度（soft / hard / tired / fierce / scattered） |
| `method` | 付款方式（Credit / ATM / DEMO） |
| `tradeNo` | 綠界交易序號 |
| `bankCode` / `vAccount` / `expireDate` | ATM 虛擬帳號資料（僅 atm_pending） |
| `sentAt` | 事件時間（ISO） |

## 4. LINE 通知範例

用 **LINE Messaging API** 模組（用你 LINE 官方帳號的 Channel Access Token），傳送文字：

```
【KenEyeCue 成交通知】💰
訂單：{{orderId}}
金額：NT${{amount}}
測驗：{{result}}
方式：{{method}}
時間：{{sentAt}}
→ 準備交付（問卷＋照片＋48h 報告）
```

Router 分支裡也可以加 **Google Sheets → Add a Row**，欄位建議：
`時間 | 訂單編號 | event | 金額 | 測驗維度 | 付款方式`

## 5. 情境排程

- 把 Scenario 的 Schedule 設為 **Immediately as data arrives**（Webhook 情境預設即是）
- 每個情境每月 OPS 用量很小，會員額度內可以多開幾個情境（見下）

## 6. 後續可加的情境（等第一條跑穩再開）

| 情境 | 觸發 | 做的事 |
|:--|:--|:--|
| 每日跟進提醒 | Daily 20:45 | 讀 Google Sheets，找出「今天該跟進」的名單，LINE 提醒你 |
| 課程交付自動化 | order.paid | 自動寄 Email（問卷連結＋照片上傳） |
| 澳洲日報 | Daily | 收集當日成交數，算 5 個 KPI 數字回報 |
