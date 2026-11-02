# 本机内测指南（创始人自用）

目标：不开任何付费账号、不上线，只在你自己的电脑和安卓手机上，把"私聊 → 发给 TA → 起草约定 → 双方批准 → 承诺 → 到点提醒 → 复盘"整条闭环走一遍。所有命令都在仓库根目录用 PowerShell 执行。

## 1. 启动本机服务器

```powershell
$env:OPENAI_API_KEY = "<你的 key>"                       # AI 回复和语音都靠它；服务器不读 .env，只认当前终端的环境变量
$env:TOWARD_US_DATA_FILE = "$HOME\toward-us-dogfood.json" # 测试数据单独放，不碰 data\ 里的文件
$env:REMINDER_RUN_SECRET = [guid]::NewGuid().ToString("N") # 至少 32 位；第 4 步触发提醒要用
$env:REMINDER_RUN_SECRET                                  # 打印出来记下，后面 curl 要填
npm run dev:full
```

- 看到 `Toward Us is running on http://127.0.0.1:5173` 即可。端口默认 `5173`，用 `PORT` 改。
- 启动日志里 `AI mediation: ready` 表示 key 生效；写 `local fallback` 说明没拿到 `OPENAI_API_KEY`，AI 只有占位回复。
- **必须是开发模式**（`npm run dev:full`），不要用 `npm start` 或设 `NODE_ENV=production`，否则 Cookie 带 `Secure`，`http://` 下登录不了。
- **每次启动服务器都必须设 `TOWARD_US_DATA_FILE`**：新开的终端里不会保留，不设就会写进仓库里真正的 `data\toward-us.local.json`。
- 改了环境变量要重启；停掉用 Ctrl+C。想要日志文件：`npm run dev:full 2>&1 | tee ./dev.log`。

## 2. 两个账号，配对

同一个浏览器里 Cookie 是共用的，所以两个人要分开：

- 浏览器 A 用 `http://localhost:5173`，浏览器 B（或另一个浏览器、无痕窗口）用 `http://127.0.0.1:5173`（不同的源，Cookie 互不影响）；或者 A 在电脑上，B 用安卓 App（见第 5 节）。
- 各自用不同邮箱注册（随便填，不会发邮件）；密码要 10–128 个字符。
- A 进入"我们俩"页签，点"生成邀请链接"，复制链接（形如 `http://localhost:5173/?invite=XXXXXXXX`）。B 登录后打开该链接，或点"我有邀请码"输入邀请码。配对成功后"我们俩"会打开。
- 注意：邀请链接的域名要和 B 能访问的一致。B 用 `127.0.0.1` 时，把链接里的 `localhost` 改成 `127.0.0.1`。

## 3. 走一遍核心闭环

1. A 在 **只有我** 里说一句难开口的话（也可以点麦克风说）。Agent 整理出一个 TA 听得进去的版本。
2. A 看过、确认，点 **发送给 TA**，这句话（只有确认过的原文）才进入 **我们俩**；B 在"我们俩"里能看到。
3. 在 **我们俩** 里任何一方写 `@彼此`（或点 `@Agent` 按钮；`彼此`、`Toward Us`、`@toward`、`@agent` 任何一个都会叫醒它），让 Agent 起草约定，例如"帮我们定下来：每周日晚上一起做饭"。
4. 出现"Agent 起草的约定"卡片：A、B **各自**批准同一个版本，约定才生效。
5. 约定生效后，在决策页里 **安排具体承诺**：写做什么、谁负责、到期时间、复盘时间，勾选确认。要快点看到提醒，就把到期时间设成现在后的 2–3 分钟（复盘时间不能早于到期时间）。负责这条承诺的人都确认过，它才算生效；负责人是对方的话，要让对方在自己那边也确认一次。
6. **到点提醒**：本机没有定时器，需要手动戳一下：

   ```powershell
   curl.exe -s -X POST http://localhost:5173/api/internal/reminders/run -H "Authorization: Bearer <REMINDER_RUN_SECRET>" -H "Content-Type: application/json" -d "{}"
   ```

   到期的承诺和到点的复盘，会以一条通知出现在"我们俩"里（AI 不发言）。接口返回 `"configured":false` 是正常的——说明没配浏览器推送，只会在"我们俩"里提醒。

7. **复盘**：到复盘时间后再戳一次上面的命令，两个人各自在复盘卡片里写自己的感受（默认只有自己可见），两人都提交后才形成共同结果。

每周看使用数据（同一个密钥）：

```powershell
curl.exe -s "http://localhost:5173/api/internal/usage?weeks=4" -H "Authorization: Bearer <REMINDER_RUN_SECRET>"
```

## 4. 隐私页

登录后进"隐私与我的账号"，最上面一栏写明了内容会经过哪些服务商（OpenAI、Apple/Sendblue、Google Firebase/Apple），以及"我们俩"里的话两人都看得到；删除账号后，你在"我们俩"里发过的话会留给伴侣（目前的实现，以后可以改）。

## 5. 安卓手机

按 `mobile/README.md` 的"连本机开发服务器试用"做：

1. 手机打开 USB 调试，数据线连电脑，`& $adb devices` 能看到设备（`$adb` 是 `E:\CodexData\toolchains\android\platform-tools\adb.exe`）。
2. `& $adb reverse tcp:5173 tcp:5173`——这样手机里的 `localhost:5173` 就是电脑的服务器，**麦克风才能用**（局域网 IP 不是安全环境，语音打不开）。
3. 在 `mobile` 目录设 `TOWARD_US_APP_URL = "http://localhost:5173"`，`npm run check:android` 打包，`adb install -r` 安装。
4. 拔线、手机重启或 adb 重启后要重新执行 `adb reverse`；电脑上的 `npm run dev:full` 必须一直开着。

手机当 B，电脑浏览器当 A，就是最接近真实使用的配置。

## 6. iMessage：现在能做什么、以后要什么

没有 Sendblue 账号时，iMessage 部分**不会真发任何消息**，服务器把"本来要发的消息"写进一个文件，你用模拟来的入站消息就能看到整个流程：

```powershell
$env:OPENAI_API_KEY = "<你的 key>"
$env:TOWARD_US_DATA_FILE = "$HOME\toward-us-dogfood.json"   # 必设，同第 1 节同一个路径，否则会落到仓库的 data 里
$env:REMINDER_RUN_SECRET = "<第 1 节的那个值>"
$env:SENDBLUE_WEBHOOK_SECRET = "<任意非空字符串>"
$env:SENDBLUE_DRYRUN_FILE = "$HOME\sendblue-dryrun.jsonl"   # "本来要发的消息"会逐行追加到这里
$env:TOWARD_US_BASE_URL = "http://localhost:5173"          # 绑定链接里的域名
npm run dev:full
```

另开一个终端模拟某个号码发来一条 iMessage：

```powershell
curl.exe -s -X POST http://localhost:5173/api/channels/sendblue/webhook -H "Content-Type: application/json" -H "sb-signing-secret: <SENDBLUE_WEBHOOK_SECRET>" -d '{"message_handle":"t1","from_number":"+15551230001","service":"iMessage","content":"你好"}'
```

`message_handle` 每次要换一个新值（重复的会被当成已处理）。`SENDBLUE_DRYRUN_FILE` 里会出现一行，内容是三语欢迎语加绑定链接（`/m/xxxx`）。在已登录的浏览器里打开它，确认绑定这个号码；之后再用同一个号码发消息，回复同样写进这个文件。

以后真接 Sendblue 时需要（都是环境变量，缺任何一个就保持上面的"只写文件"模式）：

- `SENDBLUE_API_KEY`、`SENDBLUE_API_SECRET`、`SENDBLUE_FROM_NUMBER`：三个都有才会真发。
- `SENDBLUE_WEBHOOK_SECRET`：Sendblue 后台把 webhook 指到 `https://<你的公网域名>/api/channels/sendblue/webhook/<这个密钥>`。需要公网 HTTPS 地址，本机 localhost 收不到。
- `TOWARD_US_BASE_URL`：绑定链接用的公网地址。
- `SENDBLUE_GROUPS_ENABLED=true`：套餐支持群聊后才开，"我们俩"才会镜像成情侣 iMessage 群。

推送有两种，都是缺配置就不推、也不报错：

- **浏览器推送**：要同时设 `VAPID_PUBLIC_KEY`、`VAPID_PRIVATE_KEY`、`VAPID_SUBJECT`（`https://...` 或 `mailto:...`）。
- **App 推送**（安卓 / iPhone，经 Firebase Cloud Messaging）：代码已经接好，设 `FCM_SERVICE_ACCOUNT_JSON`（Firebase 项目的服务账号 JSON 全文）就会真发。但它要先有 Firebase 项目；iPhone 还要把 Apple 的 APNs 密钥传到 Firebase、并在 iOS 工程里接入 Firebase Messaging SDK 把 APNs token 换成 FCM token（等 Apple 团队开通后在 Mac 上做；在那之前 iPhone 拿到的原始 APNs token 会被网页端拒收，不会注册），安卓打包时要把 Firebase 下载的 `google-services.json` 放进 `mobile/android/app/`（已在 .gitignore 里，不进仓库）。**在这之前 App 推送是关的**：服务器启动时会打印 `Native push: off`，`reminders/run` 返回 `"nativeConfigured":false`，App 也不会弹通知权限。
  - 开了以后：个人提醒按 iMessage → App 推送 → 浏览器推送 三个渠道都发；App 推送的文案和浏览器推送一样模糊，不带提醒名称，点开进对话首页。
  - "我们俩"里一方发了消息、而你们没有 iMessage 群时，另一方的手机会收到一条"TA 在'我们俩'里说了话"，同一个人 10 分钟内最多一条，点开直接进"我们俩"。
  - App 里登录后会问一次通知权限；"我的提醒"里也有"开启此手机通知"按钮。退出登录会注销这台手机。

## 7. 现在做不到的

- **iPhone App**：要等 Apple 公司开发者团队开通，Windows 上也编不了 iOS（见 `mobile/README.md` 的 iPhone 一节）。伴侣如果用 iPhone，现在只能用手机浏览器或等 iMessage 打通。
- **线上环境**：不部署、不上 Render、不发 TestFlight。所有数据只在你电脑上的那个 JSON 文件里。
- **真 iMessage / App 推送**：真 iMessage 要等 Sendblue 账号；App 推送功能已完成，但要等 Firebase 项目（iPhone 还要 Apple 团队的 APNs 密钥），在那之前只能用上面的模拟。
- **定时自动提醒**：本机没有调度器，到点要手动戳 `reminders/run`。
