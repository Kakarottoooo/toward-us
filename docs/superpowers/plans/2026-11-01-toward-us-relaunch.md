# Toward Us 重启（App + iMessage）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal：** 在旧版 toward-us 上加两个入口：iMessage（私聊 + 三人群）和手机 App（默认是对话，旧功能都在"全部功能"里），让"难开口的话 → 我们俩 → 双批准约定 → 提醒 → 复盘"这个闭环在两个入口里都能走完。

**Architecture：**
- 闭环和所有规则只在服务端实现一次，放在入口无关的领域函数里。
- HTTP 路由、Sendblue webhook、App 对话界面都只是很薄的入口，调用同一批函数。
- 新增一个关系级的"我们俩"对话对象（`togetherConversations`），iMessage 群和 App 的"我们俩"频道都读写它。

**Tech Stack：** Node 22、Express 5、PostgreSQL 或本地 JSON（两个 Store Adapter）、OpenAI（`gpt-5.4`，`store:false`）、React 19 + Vite、Capacitor 8（照 Onegent `mobile/` 的版本）、Sendblue REST API、Firebase Cloud Messaging HTTP v1。

**Spec：** `docs/superpowers/specs/2026-11-01-toward-us-relaunch-design.md`；创始人原话见 `docs/founder-voice.md`。两份都要读。

## Global Constraints

- **测试**：不新写测试（创始人 11-01："不写测试，只认真机验证"）。每个任务都必须保持以下命令通过：`npm run check:runtime`、`npm run test:app`、`npm run build`。改动共同决定或约定的任务，还要跑 `npm run test:relationship`。新行为一律用本地 HTTP 探针（`curl`）和真机验收来证明。
- **受保护文件不动**：`src/App.tsx`、`src/main.tsx`、`src/styles.css`、`src/mobile/`、`public/assets/iphone|android|status/`、`vite.config.ts`、`worker/index.js`、`scripts/prepare-sites-build.mjs`。App 界面只改 `src/Prototype.tsx`、`src/features/**`、`src/*.css`。
- **隐私**：私人内容只有本人能看。只有本人看过最终文本并确认的那一版才能进"我们俩"。约定必须双方批准同一个 `version`。共同 Agent 的上下文只由服务端拼装，任何私人 thread 或 assistant session 都不能进去。
- **Agent 在群里开口的条件**：只在下面三种情况由代码判定后开口，不交给模型决定：
  - 被叫到：消息里出现 `彼此`、`Toward`、`@agent`，或者直接回复 Agent 的上一条；
  - 有正事：贴出待批准的约定、到点提醒、复盘到期；
  - 转达某一方已经确认分享的话。
  两人聊天或吵架时，Agent 不插话、不评论。
- **语言**：所有新文案都要有 zh / en / es 三种，中文和英文做验收。非中文界面不出现"彼此"。
- **iMessage**：只认 iMessage 来的消息；SMS 来的消息每天最多回一条固定提示，不接到 Agent（照 Onegent 的做法）。同一时间每对情侣最多一个待批准约定。
- **部署**：Render 维持免费层，不升级。所有新密钥只放在 Render 密钥库或 GitHub secret，不进仓库。
- **开销**：任何付费开通之前，都先把价格报给创始人。

## Review Focus

1. **同一个手机号被第二个账号绑定，或者用户换了号码**：拒绝第二次绑定，原绑定不变；换号必须先在 App 里解绑。归 Task 5。
2. **Sendblue 重复投递或乱序**：按 `message_handle` 去重，同一条消息只处理一次。归 Task 7。
3. **群里有人回"同意"时，约定刚好改了版本，或者有不止一个待批准约定**：不批准，回复让对方看最新版本或去 App 里点批准。归 Task 9。
4. **私聊内容进入共同 Agent**：私聊里埋一个秘密词，群里和 App 的"我们俩"任何回复都不能出现它。归 Task 2 和 Task 8。
5. **关系解除后，iMessage 群还在**：Agent 对这个 `group_id` 不再回应，App 里显示已断开。归 Task 9。

---

### Task 0：查部署现状和开销价格（只读，不改代码）

- [ ] **Step 1**：用 `curl -sS https://<Render 域名>/api/health` 确认服务和数据库是否还活着。Render 免费 Postgres 有到期期限，9 月建的库可能已经过期。如果已过期，按 `render.yaml` 重建一个免费库，这不算升级；同时把"免费库会再次到期"这个风险报给创始人。
- [ ] **Step 2**：查价格，一次性报给创始人：
  - Sendblue 支持群聊和 webhook 的套餐价格，以及群聊 beta 怎么申请；
  - Apple Developer Program；
  - Google Play 开发者注册；
  - Firebase 是否免费。

  同时确认 Onegent 的 Apple 和 Google 开发者账号能否共用。
- **完成标准**：创始人回复批准，开销项才能开通。Task 1–6 和 Task 11 不依赖这些账号，可以先做。

### Task 1：把约定的状态变化抽成入口无关的函数

**Files：**
- Create：`server/agreement-actions.mjs`
- Modify：`server/relationship-router.mjs:174-197`。approve、reject、request-change 三个路由改成调用新函数，行为不变。

**Interfaces：**
- Produces：
  - `approveAgreement(tx, { agreementId: string, version: number, userId: string, context }) -> { agreement, approvedCount: number, requiredCount: number }`
  - `rejectAgreement(tx, { agreementId, version, userId }) -> { agreement }`
  - `requestAgreementChange(tx, { agreementId, version, userId }) -> { agreement }`

  报错时抛出带 `statusCode` 和 `code` 的错误，`code` 沿用 `DECISION_ERRORS` 的 key。

- [ ] **Step 1**：把 `relationship-router.mjs` 第 174–195 行的批准逻辑原样移进 `approveAgreement`，包括确定性 approval ID 和"全员批准同一版本才激活"。reject 和 request-change 从 `decisionState` 抽出同样的函数。
- [ ] **Step 2**：跑 `npm run test:app` 和 `npm run test:relationship`，预期全部 PASS，结果和改动前一致。
- [ ] **Step 3**：提交 `refactor: agreement transitions callable from any channel`。

### Task 2："我们俩"共同对话和轻量约定路径

**Files：**
- Create：`server/together-domain.mjs`（上下文构建、开口判定）、`server/together-router.mjs`
- Modify：
  - `server/relationship-domain.mjs:4-12`：`GRAPH_COLLECTIONS` 加 `togetherConversations`；
  - `server/postgres-store.mjs`：表映射加 `togetherConversations: "together_conversations"`，用和其他图谱表相同的 additive migration；
  - `server/mediator.mjs`：新增 `continueTogether`；
  - `server/app.mjs:663`：挂载 router。

**Interfaces：**
- Produces：
  - 记录：每个 relationship 一条 `togetherConversations`，字段为 `visibility:"shared"`、`aiAccessScope:"joint"`、`messages:[{ id, role:"member"|"agent", actorUserId|null, source:"app"|"imessage"|"relay", kind:"text"|"relay"|"agreement_card"|"reminder"|"review", text, refs, handle|null, replyTo|null, createdAt }]`。`replyTo` 只在入口提供时填写，比如 App 里点了"回复"；Sendblue 不提供就填 null。
  - `buildTogetherContext(snapshot, relationshipId) -> { messages, activeAgreements, openCommitments, pendingAgreement|null }`。只读 `togetherConversations`、`agreements`、`commitments` 和双方授权的 memories，**不读** `privateAgentThreads`、`perspectives`、`evaluations` 或私人 reminders。
  - `shouldAgentSpeak(message, { agentLastMessageId }) -> boolean`。判定被叫到：匹配 `/彼此|toward|@agent/i`，或者 `replyTo === agentLastMessageId`。
  - `appendTogetherMessage(tx, { relationshipId, actorUserId|null, source, kind, text, handle|null, refs }) -> { conversation, message }`。按 `handle` 幂等。
  - `draftAgreementFromTogether(tx, { relationshipId, userId }) -> agreement`。新建 `status:"awaiting_approvals"`、`approvalPolicy:"both"`、`sourceTogetherId`、`proposalId:null`。不要求双方摘要，这就是轻量路径（决定 #11）。如果已有待批准约定，抛 409 `one_pending_agreement`。
  - HTTP 接口：
    - `GET /api/together`
    - `POST /api/together/messages {text, itemId}`
    - `POST /api/together/agreements/draft`
    - `POST /api/together/agreements/:id/approve|reject|request-change {version}`，内部调用 Task 1 的函数。
  - 事件：`emit(record, "together.updated")`，只带 `{eventType, objectId, version}`。

- [ ] **Step 1**：实现上面的领域函数和路由。`continueTogether` 用 `buildTogetherContext` 的结果加安全规则做输入，输出 `{reply, draftAgreement|null}`。草稿用现有的 `agreementValues` 字段：`title`、`summary`、`terms`、`unresolvedPoints`。
- [ ] **Step 2**：消息进来后，只有 `shouldAgentSpeak` 返回 true，才调用模型回复。
- [ ] **Step 3（Review Focus 4）**：本地 `npm run dev:full`，建两个账号并配对。A 在私人 Agent 里写"秘密词 PINEAPPLE-42"；然后在"我们俩"里 @agent 问"我们最近聊了什么"。预期：回复和 `GET /api/together` 的结果里都没有 `PINEAPPLE-42`。
- [ ] **Step 4**：用 curl 走一遍：A 发消息 → @agent "帮我们定下来" → 起草约定 → A 批准 v1 → B 批准 v1。预期约定变成 `active`；B 批准的是 v0 时返回 409。
- [ ] **Step 5**：跑全局回归命令，然后提交 `feat: shared "together" conversation with light agreement path`。

### Task 3："只有我"里整理难开口的话，确认后发到"我们俩"

**Files：**
- Modify：
  - `server/assistant-agent.mjs`：`kind` 的 enum 加上 `partner_message`，只允许 `operation:"create"`，`fields.text` 是整理后给对方的文本；
  - `server/assistant-router.mjs`：增加 `share-confirm` 路由。

**Interfaces：**
- Consumes：`appendTogetherMessage`（Task 2）。
- Produces：
  - `partner_message` 的 create 不直接分享，只在 session 上保存草稿，并返回一张 `kind:"partner_message"` 卡片：`{ id, text, digest }`，其中 `digest = sha256(text)`。
  - `POST /api/assistant/sessions/:id/share-confirm {cardId, digest, confirm:true}`：校验 digest 和当前草稿一致后，调用 `appendTogetherMessage(kind:"relay", source:"relay", refs:[{ id: cardId }])`，并写一条 `consentEvents`（`partner_message.shared`）。重复确认按 cardId 幂等。
  - 修改草稿会产生新的 cardId 和新的 digest。

- [ ] **Step 1**：在 `assistantInstructions` 里加规则："用户想对伴侣说难开口的话时，先私下帮他理清，再给出对方听得进去的版本，用 `partner_message` 起草。不替用户猜动机，不评判对方。"
- [ ] **Step 2**：实现 share-confirm。未配对用户确认时，返回现有的 `activePair` 409 文案。
- [ ] **Step 3**：用 curl 验收：
  - 确认前，B 的 `GET /api/together` 里看不到这条话；
  - 确认后能看到，而且只能看到整理后的版本，看不到 A 的原话；
  - 拿旧 digest 去确认，返回 409。
- [ ] **Step 4**：跑回归，提交 `feat: draft hard-to-say messages privately and share only on confirm`。

### Task 4：Agent 主动开口（正事）

**Files：**
- Modify：
  - `server/together-domain.mjs`；
  - `server/reminder-service.mjs`：提醒到点时，对共同提醒追加一条 `kind:"reminder"` 消息；
  - `server/relationship-router.mjs`：复盘到期时追加一条 `kind:"review"`。

**Interfaces：**
- Produces：`announceInTogether(tx, { relationshipId, kind: "agreement_card"|"reminder"|"review", refs, text }) -> message`。新约定草稿、约定版本变化、约定生效时，也调用它贴出 `agreement_card`，`text` 里带全文和 `v{version}`。

- [ ] **Step 1**：实现 `announceInTogether`，接到上面三处。
- [ ] **Step 2**：curl 验收：
  - 创建约定 → together 里出现 `agreement_card`；
  - 用 `POST /api/internal/reminders/run` 触发一条到点的共同提醒 → together 里出现 `reminder`。
- [ ] **Step 3**：跑回归，提交 `feat: agent speaks in together only for agreements, reminders and reviews`。

### Task 5：手机号身份绑定

**Files：**
- Create：`server/phone-identity.mjs`
- Modify：
  - `server/store.mjs` 和 `server/postgres-store.mjs`：新增 `user_phones` 表，`phone` 列唯一，`user_id` 列唯一；
  - `server/app.mjs`：挂载 `/m/:code` 页面和接口。

**Interfaces：**
- Produces：
  - Store 方法：`bindPhone(userId, phoneE164)` 在号码已被别人占用时抛 409 `phone_taken`；`getUserIdByPhone(phoneE164) -> string|null`；`getPhoneForUser(userId) -> string|null`；`unbindPhone(userId)`。
  - `createPhoneLink(store, phoneE164) -> { code, url }`：12 位小写字母数字码，30 分钟有效，一次性使用。
  - `GET /m/:code`：已登录就直接绑定；未登录就跳转到登录，带 `?next=/m/:code`。
  - `POST /api/phone/unbind`。
  - 销户和退出关系时调用 `unbindPhone`。

- [ ] **Step 1**：实现以上功能，照 Onegent `social_agent/sendblue.py` 中的 `link_for`、`open_link`、`bind`。
- [ ] **Step 2（Review Focus 1）**：curl 验收：A 绑定 +1555…01 成功；B 再绑同一个号码返回 409，A 的绑定不变。
- [ ] **Step 3**：跑回归，提交 `feat: bind a verified phone number to an account via one-time link`。

### Task 6：功能使用记录（成功标准）

**Files：**
- Create：`server/usage.mjs`
- Modify：在 Task 2、3、5、7 的入口处调用。

**Interfaces：**
- Produces：
  - `recordUsage(store, { userId, relationshipId|null, action, channel: "app"|"imessage"|"web" })`：写进 `productEvents`，**只记动作名，不记内容**。
  - `action` 取值：`private_message`、`partner_message_shared`、`together_message`、`agreement_drafted`、`agreement_approved`、`commitment_completed`、`review_submitted`，以及旧功能的入口名，比如 `mediation_started`、`list_item_added`。
  - `GET /api/internal/usage?weeks=4`：用 `Authorization: Bearer $REMINDER_RUN_SECRET` 保护，返回 `[{ relationshipId, week, activeMembers: 0|1|2, actions: { [action]: count } }]`。

- [ ] **Step 1**：实现以上功能。旧功能的入口只在 router 层加一行 `recordUsage`。
- [ ] **Step 2**：curl 验收：两人各发一条消息后，接口返回 `activeMembers: 2`，结果里没有任何消息文本。
- [ ] **Step 3**：跑回归，提交 `feat: content-free weekly usage per couple`。

### Task 7：Sendblue 接入和私聊

**依赖：** Task 0 的号码和套餐已批准。

**Files：**
- Create：`server/sendblue.mjs`、`server/channels/imessage.mjs`
- Modify：`server/app.mjs` 挂载 webhook；`.env.example` 加变量名。

**Interfaces：**
- Env：`SENDBLUE_API_KEY`、`SENDBLUE_API_SECRET`、`SENDBLUE_FROM_NUMBER`、`SENDBLUE_WEBHOOK_SECRET`、`SENDBLUE_GROUPS_ENABLED`（默认 `false`）。
- Produces：
  - `sendblue.send(phone, text)`；
  - `sendblue.sendGroup({ groupId|null, numbers }, text) -> { groupId }`；
  - `sendblue.isIMessage(phone) -> boolean`。

  以上都对应 Sendblue 文档里的端点：`/api/send-message`、`/api/send-group-message`、群成员修改，以及判断号码是否是 iMessage 的接口。端点名动手时再按官方文档核对。
- Webhook：`POST /api/channels/sendblue/webhook`，按 Sendblue 文档校验签名。文档里没有签名机制的话，就用 `SENDBLUE_WEBHOOK_SECRET` 作为 URL 的路径段。
- `handleInbound(message)` 的处理顺序：
  1. 按 `message_handle` 去重；
  2. `is_outbound` 的消息丢弃；
  3. `service !== "iMessage"` 的按 SMS 规则处理；
  4. 有 `group_id` 的交给 Task 9；
  5. 剩下的是私聊：未绑定的号码发 `createPhoneLink` 的链接；已绑定的，找到或新建这个用户 `channel:"imessage"` 的 assistant session，调用现有的 append 逻辑，回复和卡片用纯文本发回去。
- 私聊里确认分享：`partner_message` 卡片以纯文本发出，末尾附一句"回复'发送'就交给 TA，回复别的我再改"（en：`send`，es：`enviar`）。30 分钟内回复完全一致的词，就以当时卡片的 digest 调用 share-confirm。回复任何其他内容都作为继续修改。

- [ ] **Step 1**：实现以上功能。
- [ ] **Step 2（Review Focus 2）**：用 curl 把同一个 webhook 负载连发两次。预期：assistant session 里只多了一条用户消息，只回了一次。
- [ ] **Step 3**：真机验收（创始人的 iPhone）：
  - 新号码发消息 → 收到绑定链接 → 登录 → 再发"明天晚上八点提醒我买花" → 收到确认，App 和网页的提醒列表里也能看到；
  - 发"我想跟 TA 说其实我最近很累" → 收到整理后的版本 → 回复"发送" → 伴侣在 App 的"我们俩"里看到整理后的版本。
- [ ] **Step 4**：跑回归，提交 `feat: private iMessage agent through a dedicated Sendblue number`。

### Task 8：iMessage 回复里的隐私检查

**Files：** 不新增文件。这是对 Task 7 和 Task 9 的验收任务。

- [ ] **Step 1（Review Focus 4）**：真机验收：A 在 iMessage 私聊里提到"PINEAPPLE-42"，然后在三人群里 @彼此 问"你知道我们最近怎么了吗"。预期：群里的回复不包含这个词，也不暗示 A 私下说过什么。
- [ ] **Step 2**：把结果记进 PR 描述。不通过就回到 Task 2，修 `buildTogetherContext`。

### Task 9：三人群和"我们俩"双向同步

**依赖：** Sendblue 群聊开通。没开通时保持 `SENDBLUE_GROUPS_ENABLED=false`，这个任务暂缓，App 的"我们俩"照常工作（决定 #12）。

**Files：**
- Modify：`server/channels/imessage.mjs`、`server/together-domain.mjs`、`server/relationship-domain.mjs`（relationship 上加 `imessageGroupId`）。

**Interfaces：**
- `ensureCoupleGroup(tx, relationshipId)` 只在以下条件全部满足时建群：
  - 两人都绑定了手机号；
  - 两人的号码都是 iMessage；
  - 开关已打开；
  - 关系上还没有 `imessageGroupId`。

  建群方式是用 `sendGroup` 给两人发一句开场白，三语按创建者的语言，然后保存 `groupId`。只要有一方是安卓，就不建群（设计判断 #8）。
- 群里来的消息：用发送者号码找到 `actorUserId`，号码不属于这对情侣的直接忽略；然后调用 `appendTogetherMessage(source:"imessage")`，`shouldAgentSpeak` 为 true 时才回复。
- 群里的批准：消息内容完全等于 `同意`、`agree` 或 `de acuerdo` 时：
  - 恰好有一个待批准约定 → 调用 `approveAgreement`，`version` 用最后一次贴出的 `agreement_card` 上的版本；
  - 版本已变 → 回复"约定刚改过，最新是 vN，请看上面的新版本"；
  - 没有待批准约定 → 不回应。
- 从 App 往群里发：`together.updated` 事件里，`source:"app"` 的成员消息以"{名字}：{内容}"转发到群，Agent 消息原样转发。来自 iMessage 的消息不再回发到群，避免循环。
- 关系解除或销户时，清掉 `imessageGroupId`。之后这个 `group_id` 来的消息一律忽略（Review Focus 5）。

- [ ] **Step 1**：实现以上功能。
- [ ] **Step 2（Review Focus 3）**：真机验收：
  - 群里贴出约定 v1 → A 在 App 里请求修改，约定变成 v2 → B 在群里回"同意"。预期：收到"最新是 v2"的回复，约定没有生效；
  - 两人都回"同意" v2 → 约定生效，群里贴出"已生效"。
- [ ] **Step 3**：真机验收同步：A 在 App 的"我们俩"里发一句话 → 群里出现"A：…"；B 在群里回一句 → A 的 App 里出现这句话。
- [ ] **Step 4（Review Focus 5）**：A 在 App 里退出关系后，B 在群里 @彼此，预期没有回应。
- [ ] **Step 5**：跑回归，提交 `feat: couple iMessage group mirrors the together conversation`。

### Task 10：提醒走 iMessage

**Files：** Modify `server/reminder-service.mjs:173-230`

- [ ] **Step 1**：投递时：
  - 个人提醒：本人绑定了 iMessage 就发私聊；
  - 共同提醒：有 `imessageGroupId` 就发群，同时走 Task 4 的 `announceInTogether`；
  - 原来的网页推送保留。

  每个渠道各自去重，`dedupeKey` 加上渠道后缀。
- [ ] **Step 2**：真机验收：设一个 3 分钟后的个人提醒，到点后 iPhone 收到 iMessage。
- [ ] **Step 3（Render 免费层）**：`.github/workflows/reminders.yml` 已经每 5 分钟请求一次服务，会顺带保活。在 PR 里记录一次休眠后的实际首条回复延迟，作为是否升级的依据。
- [ ] **Step 4**：跑回归，提交 `feat: deliver reminders over iMessage`。

### Task 11：App 默认对话界面

**Files：**
- Create：`src/features/conversation/ConversationHome.tsx`、`src/features/conversation/conversation.css`
- Modify：`src/Prototype.tsx`：登录后默认 `screen` 改为 `"conversation"`，并加一个"全部功能"入口，跳到现有的 `DashboardScreen`。

**Interfaces：**
- Consumes：
  - 现有 `/api/assistant/sessions*`（"只有我"）；
  - Task 2 的 `/api/together*`（"我们俩"）；
  - Task 3 的 share-confirm；
  - 现有 `/api/relationship/events` SSE 用来刷新；
  - 现有 `VoiceAssistant` 的实时语音能力。
- 界面结构：
  - 顶部两个分段：`只有我 / 我们俩`（en：`Just me / Us`，es：`Solo yo / Nosotros`）；
  - 中间是消息流，卡片就地显示：`partner_message` 卡带"发送给 TA"和"再改改"，`agreement_card` 带"批准 v{n}"和"要改"；
  - 底部输入框用 `KeyboardTextarea`，加一个语音按钮；
  - 右上角是"全部功能"。

  未配对时，"我们俩"分段显示邀请伴侣的入口（复用 `PairingScreen` 的邀请链接）。

- [ ] **Step 1**：实现。样式遵守 AGENTS.md：米白连续底面，入口文字够大、对比度够。
- [ ] **Step 2**：在浏览器 393px 和 1280px 两种宽度下验收：两个分段能切换、卡片按钮可用、"全部功能"能进入旧首页并返回、三种语言切换后都没有混入别的语言。
- [ ] **Step 3**：跑 `npm run check:runtime && npm run build && npm run test:relationship`。旧首页的用例如果因为默认页面变了而失败，只改用例的入口步骤（先点"全部功能"），不改断言。然后提交 `feat: conversation-first home with the full UI one tap away`。

### Task 12：Capacitor 外壳

**Files：** Create `mobile/`，结构照 Onegent `mobile/`：`package.json`（Capacitor 版本和 Onegent 一致）、`capacitor.config.json`、`scripts/check-native.mjs`、`ios/`、`android/`、`assets/`。

**决定：**
- `appId: "us.toward.app"`（Bundle ID 动手前在开发者账号里确认可用），`appName: "Toward Us"`。
- 内测版用 `server.url` 指向线上 HTTPS 域名，这样现有的 `HttpOnly` Cookie 会话不用改（这是我的判断）。公开上架前再评估要不要像 Onegent 那样把前端打包进安装包。
- 麦克风权限说明写三语。iOS 用 Info.plist `NSMicrophoneUsageDescription`，Android 用 `RECORD_AUDIO`。

- [ ] **Step 1**：生成工程，`npm run check:android` 编出 Debug APK。iOS 要在 Mac 上跑 `npm run check:ios`。
- [ ] **Step 2**：真机验收：
  - 安卓装上 APK → 登录 → 默认是对话界面 → 语音输入能用 → 杀掉进程后重开仍然保持登录；
  - iPhone 用 TestFlight 包做同样的检查。
- [ ] **Step 3**：提交 `feat: Capacitor shell for iPhone and Android test builds`。

### Task 13：原生推送（FCM 统一投递）

**依赖：** Firebase 项目，并把 APNs 密钥上传到 Firebase。

**Files：**
- Create：`server/native-push.mjs`
- Modify：`server/reminder-router.mjs` 加设备注册；`server/reminder-service.mjs` 加一个投递渠道；`mobile/` 加 `@capacitor/push-notifications`。

**Interfaces：**
- `POST /api/push/native-devices {token, platform:"ios"|"android"}`，`DELETE` 用于退出登录时注销设备。
- `sendNative(token, { title, body, url })` 走 FCM HTTP v1，环境变量 `FCM_SERVICE_ACCOUNT_JSON`。推送文案保持模糊，不含私人内容，和现有网页推送规则一致。
- 投递顺序：
  - 个人提醒：先 iMessage，再原生推送，再网页推送；
  - "我们俩"有新消息时：没加入 iMessage 群的那一方收到原生推送。

- [ ] **Step 1**：实现以上功能。
- [ ] **Step 2**：真机验收：安卓和 iPhone 各设一个 3 分钟后的提醒，锁屏时能收到；点开通知直接进对话界面。
- [ ] **Step 3**：跑回归，提交 `feat: native push for app-only members`。

### Task 14：内测发放

- [ ] **Step 1**：隐私设置页和隐私政策里加上："私聊内容会经过 Apple（iMessage）、Sendblue 和 OpenAI 处理"，三语。
- [ ] **Step 2**：部署到 Render，跑 `npm run verify:deploy`。
- [ ] **Step 3**：创始人自己和伴侣完整走一次闭环：
  1. 私聊说难开口的话；
  2. 确认后发到"我们俩"；
  3. 群里 @彼此 起草约定；
  4. 双方回"同意"；
  5. 承诺到点收到提醒；
  6. 两人各自复盘。

  第 1–4 步至少要有一步在 iMessage 里完成，另一些在 App 里完成。
- [ ] **Step 4**：给 5–10 对情侣发 TestFlight 和安卓内测包。每周看一次 `GET /api/internal/usage?weeks=4`。第 4 周的门槛是"至少 4 对情侣两个人都在每周用"。
