# Pinky 上架审核风险审计（2026-11-12）

对照的是 Apple 官网上的 **App Review Guidelines（页面标注 Last Updated: October 16, 2026）**，以及 App Store Connect 帮助里的截图规格和年龄分级定义，都是 2026-11-12 当天从 developer.apple.com 读的原文，不是凭记忆。

状态说明：✅ 已满足或已修好　⚠️ 还有风险，需要决定或等条件　⏳ 要等付费开发者账号

| 条款 | 状态 | 一句话结论 |
|---|---|---|
| 4.2 最低功能 / 2.5.2 远程网页外壳 | ⚠️ | 有原生功能撑着，但整个界面从远程加载，是剩下最大的风险 |
| 2.1 完整性（后端要开着、审核账号） | ⚠️ | 正式后端和审核账号是创始人决定 |
| 5.1.1(i) 隐私政策 | ✅ | 新增 `/privacy`、`/terms`、`/support`，App 内和注册页都有入口 |
| 5.1.1(v) App 内删除账号 | ✅ | 早已有，核对过实现 |
| 5.1.1(ii)(iii) 权限说明与最小化 | ✅ | 四个权限说明三语齐全；相册说明补上了人脸比对 |
| 5.1.2(i) 分享给第三方 AI 要明确同意 | ✅ | 新增注册时同意 + 老账号一次性同意页 + 设置里撤回 |
| 1.2 用户生成内容 | ✅（有残余风险） | 新增举报；屏蔽 = 退出关系；联系方式在支持页 |
| AI 生成内容说明 | ✅ | 描述、条款、同意页都写明由 AI 生成、可能出错 |
| 4.8 Sign in with Apple | ✅ 不适用 | 只有自家邮箱密码登录 |
| 3.1.1 App 内购买 | ✅（代码）⏳（商品） | iPhone 里不再出现 Stripe 和内测码；Apple 内购在 PR #111，等账号 |
| 2.3 年龄分级 | ✅ | 问卷答案见 `age-rating.md` |
| 出口合规 | ✅ | `ITSAppUsesNonExemptEncryption = false` |
| 隐私清单 `PrivacyInfo.xcprivacy` | ✅ | 已加入包内，Release 编译验证过 |
| 推送和后台模式 | ⏳ | iOS 推送还没接 APNs，等账号；没有任何后台模式 |
| 2.1 离线 / 出错 | ✅ | 离线页 + 断网提示条 |
| 4.3 垃圾 App（约会类饱和） | ✅ 低风险 | Pinky 不是陌生人约会，不做配对 |

修复对应的 PR：#186（iPhone 外壳，已合并）、#188（网页端合规）。

---

## 4.2 最低功能、2.5.2 自包含 —— ⚠️ 最大的剩余风险

**原文要点**：4.2 "should include features, content, and UI that elevate it beyond a repackaged website"；2.5.2 不得 "download, install, or execute code which introduces or changes features or functionality of the app"。

**证据**：`mobile/scripts/config.mjs` 让 App 一打开就加载 `server.url`（远程网站），所有界面都是网页；`mobile/README.md` 第一段也写明"很薄的原生外壳"。

**对我们有利的事实**（写进审核备注）：
- 原生代码真的在做事：`SceneDelegate.swift` 里的 `PinkyPhotosPlugin` 用 Vision 在手机上找"你们俩的合照"（人脸只在本机比对）、读相册时间地点；从微信/WhatsApp/文件"分享到 Pinky"导入聊天记录（`CFBundleDocumentTypes` + `ChatImportUploader`）；麦克风实时语音；PR #111 里还有桌面小组件和 StoreKit。
- 它是一个账号制的双人服务，不是网页剪辑或链接合集。

**残余风险**：审核员看到的 UI 全部来自网页，仍可能被 4.2 或 2.5.2 拒。被拒时的退路（按成本从低到高）：
1. 回复审核时强调上面的原生功能，附录屏（零成本，先做这个）。
2. 把前端打进安装包（`webDir` 用 `dist/client`），只把 API 放在服务器上。要改登录 Cookie（跨域 `capacitor://localhost` → 服务器），工作量约 2–3 天，单独一个 PR。

**本次已修**：正式包不能再指向 Tailscale 内测地址（`npm run sync:release` 会拒绝 `*.ts.net`、`http://`、`localhost`、IP）；连不上服务器时显示包内自带的离线页，不白屏。

## 2.1 App 完整性 —— ⚠️ 等创始人决定

**原文**："include demo account info (and turn on your back-end service!)"。

**证据**：`render.yaml` 里的 `toward-us-private-beta.onrender.com` 现在连不上（2026-11-12 `curl /api/health` 超时，免费实例已休眠/停用）；创始人手机用的是这台电脑上的 `https://node.tail3f720f.ts.net`，只有登录了 Tailscale 的设备能打开，审核员打不开。

**要做的**：选正式后端（见清单"需要你决定"），部署后用 `TOWARD_US_APP_URL=https://<正式域名> npm run sync:release` 打正式包；按 `review-notes.md` 建两个审核账号。

## 5.1.1 数据收集与存储 —— ✅

- **(i) 隐私政策**：新增 `server/legal.mjs`，公开页面 `/privacy`、`/terms`、`/support`，中英西三语，写清收集什么、怎么用、第三方（OpenAI、Anthropic、托管商、推送、Resend、Sendblue、Apple/Stripe）、保留与删除、怎么撤回同意。入口：注册页按钮上方、设置 → 帮助与条款。联系邮箱和运营主体从环境变量 `PINKY_SUPPORT_EMAIL`、`PINKY_OPERATOR` 读，**创始人要填**。
- **(ii) 权限说明**：`Info.plist` 和三个 `InfoPlist.strings` 都有麦克风、相册、相机、语音识别四项，中英西齐全（之前相机、语音识别只有英文）；相册说明加上"找你们俩的合照（人脸只在手机上比对，不会上传）"。`tests/mobile-shell.test.mjs` 检查每个权限三语都在。
- **(iii) 最小化**：选照片用系统选择器（`PHPickerViewController`）；只有"连接相册"和"找合照"才申请整库读取，且在用户点了之后才问。
- **(v) 删除账号**：设置 → 危险操作 → 删除账号，输入密码确认；服务器 `DELETE /api/privacy/account` 会退出关系、删私人内容和私人照片/导入记录文件、删会话和手机号绑定、匿名化账号（`server/store.mjs` `deleteAccount`，Postgres 版同样）。审核员能在 App 里自己完成。

## 5.1.2 数据使用与分享 —— ✅（本次重点修复）

**原文**："You must clearly disclose where personal data will be shared with third parties, including with third-party AI, and obtain explicit permission before doing so."

**修复前**：用户的文字、语音、照片发给 OpenAI / Anthropic，App 里只在一个设置子页写了"由 AI 服务处理"，没有点名、没有同意。

**修复后**（PR #188）：
- 注册页按钮正上方写明"Pinky 用第三方 AI（OpenAI、Anthropic）……点‘创建账号’即表示你同意"，服务器记录同意时间和同意事件；
- 在这之前注册的账号，登录后先看到"开始前，确认一件事"，不同意就退出登录；同意之前不会自动同步相册；
- 设置 → AI 与数据处理方：点名 OpenAI、Anthropic，显示同意日期，可以撤回（撤回后回到同意页）；
- 不做广告、不追踪：`PrivacyInfo.xcprivacy` 里 `NSPrivacyTracking = false`，没有追踪域名，不需要 ATT 弹窗。

**残余**：服务器端还没有在每个 AI 调用前检查同意（目前靠界面拦截 + 注册时记录）。审核看的是界面，够用；建议后续在服务器 AI 入口加一道检查（不在本次范围，避免碰回复链路）。

## 1.2 用户生成内容 —— ✅（有残余风险）

**原文**：需要过滤、举报并及时处理、屏蔽、公开联系方式。

- **举报**（新增）：设置 → 举报或求助，可选"TA 发的内容 / Pinky 的回复 / 其他问题"，进团队队列、标为紧急、不经模型分类（`server/feedback-router.mjs`）。`npm run feedback` 能看到。**创始人要承诺 24 小时内处理**（条款和支持页都这么写了）。
- **屏蔽**：设置 → 退出当前关系，立即生效，不需要对方同意；对方不能再看到你或发消息。
- **联系方式**：`/support` 页面（填好 `PINKY_SUPPORT_EMAIL` 后显示邮箱）。
- **过滤**：内容只在两个互相邀请的人之间，不是公开社区；AI 回复由 OpenAI/Anthropic 自带安全策略，私聊里遇到危险会先给求助热线（`docs/features.zh-CN.md` 已有）。
- **残余**：没有对伴侣之间消息做自动过滤。私密双人空间一般不会因此被拒；如果审核员追问，回复说明双人邀请制 + 举报 + 一键退出。

## AI 生成内容 —— ✅

App Store 描述、使用条款、同意页都写明"Pinky 的回复由 AI 生成，可能出错，不是心理咨询或医疗建议"；聊天里 Pinky 的消息一直以 Pinky 身份出现，不冒充真人。

## 4.8 登录服务 —— ✅ 不适用

**证据**：`server/app.mjs` 只有 `/api/auth/register`、`/api/auth/login`（邮箱 + 密码）；`grep` 全部 `src`、`server` 没有 Google / 微信 / Facebook 登录。原文："Another login service is not required if your app exclusively uses your company's own account setup and sign-in systems."

## 3.1.1 App 内购买 —— ✅（代码）/ ⏳（商品要等账号）

**原文**："Apps may not use their own mechanisms to unlock content or functionality, such as license keys…"；美国区以外不能在 App 里引导去外部付款。

**修复前**：iPhone App 里没有 StoreKit 插件时，会员和装扮会退回到 Stripe 网页付款；内测码输入框也在，可以解锁 90 天会员。

**修复后**（PR #188）：在 iPhone App 里不再出现 Stripe 结账、"管理或取消订阅"（Stripe 门户）、内测码输入框；没有 StoreKit 时购买按钮置灰，写"付款功能还在准备"。网页版照旧。

**等账号**：PR #111（StoreKit 桥 + 小组件）不要合并，等付费账号；在 App Store Connect 建商品（id 见 `docs/payments.zh-CN.md`），首版是否带内购是决定项（见清单）。

## 2.3 年龄分级 —— ✅

问卷逐项答案见 `age-rating.md`。按 Apple 的新分级（4+/9+/13+/16+/18+），如实回答后算出来大约 13+；条款要求 18 岁以上，建议在 App Store Connect 里把分级手动提高到 18+，和条款一致。

## 出口合规 —— ✅

只用系统 HTTPS（URLSession / WKWebView），没有自己的加密算法。`Info.plist` 已写 `ITSAppUsesNonExemptEncryption = false`，上传后不会再问。详见 `export-compliance.md`。

## 隐私清单 —— ✅

`mobile/ios/App/App/PrivacyInfo.xcprivacy`：不追踪；收集类型与 `privacy-nutrition-label.md` 一致；App 自己的代码没有调用需要理由的 API（required-reason API），Capacitor 和 Cordova 框架自带各自的清单。Mac 上 Release 编译后包里三份清单都在，`plutil -lint` 通过。

## 推送和后台模式 —— ⏳

- 代码里有 `@capacitor/push-notifications`，但 iOS 还没接 APNs/Firebase（`mobile/README.md`），也没有 `aps-environment` 授权。免费个人团队不能开推送能力，所以现在加授权会让签名失败。**等付费账号**后：开 Push Notifications 能力、加 `App.entitlements`、接 Firebase Messaging 或直接 APNs。上传时如果看到 "Missing Push Notification Entitlement" 的邮件警告，属于这一项。
- 通知权限只在登录后、用户点"开启此手机通知"时才问，不强制（符合 5.1.2 "不能要求开启推送才能用"）。
- 没有任何 `UIBackgroundModes`，不需要说明。

## 2.1 离线与出错 —— ✅

- 打开时连不上服务器：显示包内离线页（中英西，按手机语言），每 10 秒和联网时自动重试，连上自动回到 App。Mac 模拟器实测：先指向不存在的地址看到离线页，起本地服务后自动回来。
- 用着用着断网：顶部出现"没有网络连接，联网后会自动恢复"。

## 其他检查

- **iPad**：改成只支持 iPhone、只竖屏（界面本来就是手机布局），不用准备 iPad 截图，审核员在 iPad 上会以 iPhone 兼容模式运行。
- **2.3.8 元数据适合所有年龄**：截图只用虚构人物和日常内容。
- **4.3 垃圾 App**：Pinky 不是陌生人约会/配对，是情侣和个人的关系助手，风险低。
- **5.1.1(ix) 受监管领域**：经期记录属于健康话题但不是医疗服务，个人开发者可以提交。
- **账号前置**：Pinky 的核心是账号制双人空间，需要登录合理（5.1.1(v)）。

## 顺手发现、不在本次范围的问题

- `chat-import.test.mjs` 里 "Windows PC imports iMessage" 一项在 Windows 本机失败（换行符），Linux CI 通过。
