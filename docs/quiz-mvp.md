# KenEyeCue 第一印象被低估測驗 MVP

> 狀態：可上線（模擬付款模式）｜最後更新：2026-09-11

## 這是什麼

陌生人從「看到貼文 → 私訊 Cue我 → 董事會遊戲（7 關）→ 出結果 → 免費送出資料 → 看報告預覽 → 付 NT$499 解鎖完整版」的入口網頁。

> 入口是《董事會遊戲》（main PR #6）。原本的 5 維度測驗頁面已被取代，文案保留在 `docs/第一印象五維度_結果文案_v1.0.md` 作內容資產。

**付費模式是「結果式付費」**：先把報告做出來給對方看，看到內容之後才決定要不要付錢。付款是流程的最後一步，不是第一步。

- 董事會遊戲玩完，結果頁（`quiz/result.html`）的按鈕是 **免費取得你的完整報告**，不是付款
- 進 `submit.html` 時董事會資料（前 3 角色＋四血條）一起帶進案件，後台看得到、webhook 也帶
- 免費送出 7 題情境問卷、正面照、聯絡方式 → 案件轉 `submitted`
- Ken 寫完報告，透過 `POST /api/admin/report` 交件（preview ＋ full）→ 案件轉 `preview_ready`
- 對方在報告頁看得到 **preview**，要看 **full** 才需要付 NT$499

### 案件狀態機

| 狀態 | 意思 |
|------|------|
| `open` | 案件已建立，問卷／照片還沒收齊 |
| `submitted` | 問卷＋照片收齊，等 Ken 分析 |
| `preview_ready` | 報告寫好了，對方可看預覽、可付款 |
| `atm_pending` | ATM 虛擬帳號已產生，尚未入帳 |
| `paid` | 已付款，完整報告解鎖 |

### 付費邊界（重要）

完整報告 `full` **只有 `status === 'paid'` 時才會離開伺服器**。未付款時 `/api/report` 的回應完全不帶 `full` 欄位——不是靠前端隱藏。`test/paywall.test.js` 守著這條。

每個案件有一組 48 字元的隨機 `token`（與 main 一致），報告與付款網址都要帶；錯 token 一律回 404，不告訴你案件存不存在（防列舉）。照片檔名另帶 16 字元隨機後綴——照片會在**未付款**的情況下累積，檔名必須猜不到，否則靠訂單號就能翻到別人的臉；也不用 token 當後綴，免得從 `/uploads/` 網址洩漏它。

### 舊訂單（token 上線前）

沒有 `token` 的舊訂單**憑訂單號即可存取**，永遠不補 token：那些客戶唯一拿過的憑證就是 `success.html?order=ID`，補 token 反而把他們鎖在門外。舊的 `pending` 對應到 `open`。後台明細會標 `legacy`，報告連結不帶 `token=`。這個集合是凍結的（新訂單一律有 token），暴露面就是以前本來就有的，只會變少。

### 靜態檔白名單

`DATA_DIR` 沒設時 `orders.json` 就在專案根目錄，和靜態檔同一個地方。所以只服務 `index/firstimpression/enroll/report.html` 與 `quiz/` 底下正規檔名的頁面／資源，其餘（`orders.json`、`.env`、`server.js`、`test/`、`docs/`）一律 404。`test/public-content.test.js` 另外守著公開頁面不得出現品牌禁用語。

## 檔案結構

```
quiz/
  index.html      董事會遊戲（7 關情境）
  result.html     遊戲結果：前 3 角色、四血條、收藏；CTA → submit.html
  submit.html     免費送件：7 題問卷＋正面照＋聯絡方式（帶董事會資料建案件）
  report.html     報告頁：製作中／預覽＋付費牆／完整報告
  checkout.html   NT$499 結帳頁（替既有案件付款；15 分鐘內重複送出要先確認）
  success.html    付款完成頁（輪詢等綠界通知；ATM 顯示虛擬帳號）
  admin.html      Ken 的交報告後台
  quiz.css        品牌樣式（深炭黑 / 象牙白 / 暖金）
  quiz-logic.js   董事會計分引擎；quiz-data.js 角色與題目；track.js 埋點
lib/ecpay.js      綠界 CheckMacValue 純函式（已用官方範例驗證）
server.js         零依賴 Node 伺服器（靜態檔 + 案件／付款／後台 API）
test/             自動測試（計分、公開內容禁用語、ECPay 簽章、API 流程、付費邊界）
```

## 付款（綠界 ECPay）

- 環境變數 `ECPAY_MERCHANT_ID` / `ECPAY_HASH_KEY` / `ECPAY_HASH_IV` 三個都填 → 真實金流
- 留空 → **模擬付款模式**（可完整測試流程，不會真的扣款）
- CheckMacValue 演算法已對齊綠界官方 PHP SDK，並用官方文件範例驗證通過
- 回傳驗證：簽章、金額（NT$499）、訂單存在性，全部通過才標記已付款
- 每次付款嘗試用一組新的 `MerchantTradeNo`（取消後重試才不會被綠界擋成重複）；最新開出的那筆是 `activePaymentRef`

### 重複付款

伺服器擋不住「兩個分頁各送一次綠界表單」：綠界先扣款才通知我們。所以規則是**第一筆成功的算數**；已付款之後再收到成功回傳，會 ack 綠界（不 ack 會一直重送）、不覆蓋、不重發 `order.paid`，記進 `duplicatePayments`，發 `order.duplicate_payment` 並 LINE 通知你去綠界後台退款。報告頁會告訴客戶「多的那筆會退」；後台明細列出要退的那筆。已付款之後 `/api/order` 回 409。結帳頁在送出前記時間戳，15 分鐘內再送要先確認——這是唯一能提前擋的點。

ATM 同理：已經有一組未過期的虛擬帳號時不開第二筆（回 409 並帶回現有帳號）；被取代的舊嘗試晚到的取號通知，不能蓋掉現行那筆的帳號。

## 啟動

```bash
node server.js          # 預設 http://localhost:3000
npm test                # 跑全部測試
```

## 部署（Railway）

```bash
# 設定環境變數
PORT=3000
BASE_URL=https://<你的網域>          # 綠界回傳與付款完成跳轉用
ECPAY_MERCHANT_ID=                   # 留空 = 模擬付款
ECPAY_HASH_KEY=
ECPAY_HASH_IV=
ADMIN_TOKEN=                         # 後台唯一的門
LINE_CHANNEL_ACCESS_TOKEN=           # LINE 成交通知（選填）
KEN_LINE_USER_ID=
LINE_NOTIFY_ON_DEMO=0                # 模擬付款也推 LINE（測試用）
```

## 上線前需要 Ken 提供的

1. **綠界商戶**：MerchantID / HashKey / HashIV（申請後填入即啟用真實收款）
2. **`ADMIN_TOKEN`**：沒設定的話 `/api/admin/report` 回 503，報告交不進去，案件會卡在 `submitted`
3. **LINE 關鍵字回覆**：在 LINE 官方帳號後台設定「Cue我」→ 測驗網址（不用寫程式）
4. **交報告的方式**：用後台 `/quiz/admin.html`（見下節）

## 交報告：後台

`/quiz/admin.html`。貼上 `ADMIN_TOKEN` 就進得去，token 只存在該分頁的 sessionStorage，關掉即失效。

1. **待處理佇列** — 預設只列 `submitted` 與 `open` 的案件，可切換顯示全部
2. **點進案件** — 看得到 7 題作答（顯示題目原文，不是 `q1`／`q2`）、正面照、董事會角色與血條、聯絡方式；舊訂單會標「無存取碼，憑編號開啟」；有重複付款會列出要退的那筆
3. **寫兩段** — 預覽段（免費看得到）與完整報告（付費後解鎖）
4. **送出後** — 直接給你可複製的報告連結（新案件帶 token；舊訂單只有編號），貼給對方即可

後台端點（都需要 `x-admin-token`）：

| 端點 | 用途 |
|---|---|
| `GET /api/admin/cases` | 待處理佇列（`?all=1` 列全部） |
| `GET /api/admin/case/:id` | 單一案件明細＋報告連結 |
| `POST /api/admin/report` | 交報告 |

也可以不用介面，直接打 API：

```bash
curl -X POST "$BASE_URL/api/admin/report" \
  -H "Content-Type: application/json" \
  -H "x-admin-token: $ADMIN_TOKEN" \
  -d '{"orderId":"KC...","preview":"先給看的一段","full":"完整報告"}'
```

> `ADMIN_TOKEN` 是整個後台唯一的門。它等於可以讀到所有客戶的作答與照片，請用夠長的隨機字串，不要重複使用其他地方的密碼。

## 結果式付費的取捨

人工分析發生在收錢**之前**，所以跑單就是白做。

限制方式：同一個聯絡方式最多只能有 `MAX_OPEN_PER_CONTACT`（預設 2）件**還沒付款**的案件同時在跑，超過時 `/api/delivery` 回 429。比對前會把聯絡方式正規化（去空白、轉小寫），避免同一人用大小寫或空白繞過。案件付款後名額就釋出。


照片上傳在結果式付費之後移到了付款之前，而且不需要聯絡方式就能做——任何人都能「開案件 → 拿 token → 傳照片」重複灌爆持久磁碟，`MAX_OPEN_PER_CONTACT` 擋不到（那要先經過 `/api/delivery`）。所以另外加了三道：

| 設定 | 預設 | 作用 |
|:--|:--|:--|
| `MAX_CASES_PER_IP_HOUR` | 10 | 同一 IP 每小時能開幾件 |
| `MAX_UPLOADS_PER_IP_HOUR` | 10 | 同一 IP 每小時能傳幾張 |
| `MAX_UNPAID_PHOTO_BYTES` | 200MB | 未付款照片的總量上限，到頂回 507 |

> 這三道跟 `MAX_OPEN_PER_CONTACT` 一樣是**成本上限，不是身分驗證**。Railway 在 proxy 後面，只剩 `X-Forwarded-For` 可用，而它是可以偽造的。目的是讓隨手灌爆的成本變高，不是擋得住有心人。要真的擋住得先有帳號或驗證機制。

另外，案件一旦離開 `open`（問卷與照片都收齊了），**換成不同的**作答、聯絡方式或照片會回 409——報告可能已經照舊的輸入寫好、甚至交出去了，這時改輸入不會重新排隊，只會讓後台看到的資料跟已交出的報告對不起來。**一模一樣的重送**則當成功處理（回 200 帶 `repeat: true`）：那是上傳成功但回應掉了、前端在重試，不能讓人卡在表單上。舊流程先付款、還沒補資料的 `paid` 案件，欄位還空著就收得進來。

這只是成本上限，不是身分驗證——聯絡方式是自填的，換一個就能再開。要更嚴格得先有帳號或驗證機制，那是另一個層級的東西。
