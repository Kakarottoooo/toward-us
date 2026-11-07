# 收费怎么开通（给创始人的操作清单）

代码已经做好，下面这些需要你本人在各自后台操作（账号、密钥只能你来设，Claude 不碰）。没设好之前：网页上的付款按钮是灰的，iPhone App 里 Apple 付款要等正式开发者账号。

## 网页付款：Stripe

1. 注册 Stripe（先用测试模式）。
2. 在 Stripe 后台建一个 Webhook，地址：`https://<你的域名>/api/membership/stripe/webhook`，勾选事件：
   `checkout.session.completed`、`customer.subscription.created`、`customer.subscription.updated`、`customer.subscription.deleted`。
3. 在服务器环境变量里设：
   - `STRIPE_SECRET_KEY`（`sk_test_…` 或正式的 `sk_live_…`）
   - `STRIPE_WEBHOOK_SECRET`（上一步 Webhook 的 `whsec_…`）
   - 可选：`STRIPE_PRICE_MONTHLY`、`STRIPE_PRICE_YEARLY`（在 Stripe 建好的价格 id；不设就按 $9.99/月、$59.99/年 直接收）
4. 在 Stripe 后台打开 Customer portal（会员自己取消订阅用）。
5. 重启服务器，“设置 → Pinky 会员”里的按钮就能点了。

## iPhone 付款：Apple 内购

1. 需要正式的 Apple 开发者账号（$99/年）；现在的免费个人团队不能用内购。
2. 在 App Store Connect 建商品（id 要完全一样）：
   - 自动续期订阅，放在同一个订阅组“Pinky 会员”：`us.toward.pinky.member.monthly`（$9.99）、`us.toward.pinky.member.yearly`（$59.99）
   - 非消耗型：`us.toward.pinky.outfit.bow`、`.crown`、`.scarf`、`.glasses`、`.flower`、`.santa`（各 $1.99）
3. App Store Connect → App 信息 → App Store 服务器通知 V2，地址填：`https://<你的域名>/api/membership/apple/notifications`（续费、退款会自动同步）。
4. 如果正式 Bundle ID 不是 `us.toward.app`，在服务器设 `APPLE_BUNDLE_IDS`（逗号分隔）。

## 怎么判断谁是会员

- 一个人付款，两个人都是会员；付款人退出关系或到期（多给一天宽限），两个人都回到免费版。
- 只认 Stripe 签名的回调和 Apple 签名的交易（追到 Apple Root CA - G3）。开发服务器上还认 Xcode 的测试交易，正式服务器不认。
- 你自己的账号可以继续用 `AI_PAID_USERS` 设成付费额度，不用付钱。
- 免费和会员每天的 AI 额度在 `server/ai-budget.mjs` 的 `AI_CAPS`，看 `/api/internal/ai-usage` 几天后再定。
