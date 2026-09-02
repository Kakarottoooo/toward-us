# Toward Us：Multi-principal Relationship Agent

更新日期：2026-09-02

这份文档是 Toward Us 新产品方向、P0 实现、Consent Kernel、Relationship Graph、API、状态机、migration、安全边界与路线图的事实入口。运行时代码与自动化测试优先于文档；代码变化后应同步维护本文。

## 1. 产品方向与文案

中文主定位：

> 属于两个人的共同关系 Agent。帮助你们一起沟通、决定、计划、记住，并把说过的话真正做到。

English positioning:

> A shared relationship agent for two people. It helps you communicate, decide, plan, remember, and follow through together.

西班牙语：

> Un agente de relación compartido para dos personas. Les ayuda a comunicarse, decidir, planear, recordar y cumplir juntos.

第二句原则是：“它属于你们两个人，但任何一方都不能单独控制它。” 产品不是裁判、关系评分器、监控工具或替双方作决定的机器人。AI 可以拆解观点、指出行为问题、产生方案并提醒执行，但不能猜测动机、宣布谁赢、替任何一方批准或把私密表达变成共同事实。

## 2. 当前事实状态

| 层级 | 状态 | 当前能力 |
| --- | --- | --- |
| P0 | **implemented** | 红蓝 Relationship Home、私密 Agent 对话与实时语音、显式分享边界、对话生成决定/计划、纪念日、私人/共同提醒、共同清单、私人惊喜与揭晓、Joint Decision、可共享摘要、方案、私密评价、Agreement 双批准、Commitment、Outcome Review、通知中心、审计事件、SSE 刷新 |
| 原调解产品 | **preserved** | 正式账号、伴侣绑定、两设备/同设备、文字与实时语音、说话人锁定、私人/共同反馈、共同 AI 追问、双确认归档、历史、无账号 demo、二维码/深链 |
| P1 Memories | **designed but not implemented** | Home 保留真实空状态；没有伪造回忆、memory API 或数据库表 |
| P1 Check-ins / Companion | **feature flagged off; not implemented** | 不显示伪可用入口；没有关系分数、惩罚或“宠物因冲突受伤”机制 |
| P2 Calendar / Safe Share / money protocol | **feature flagged off; designed only** | 没有第三方授权、后台同步、坐标保存或财务自动执行 |
| P3 intimacy matching | **feature flagged off; designed only** | 没有高敏感问卷或匹配 UI |
| 原生后台位置 | **future native-only** | Web/PWA 不宣称可靠后台定位；必须在独立安全评审后做原生能力 |

服务端 `/api/relationship/home` 返回 `capabilities`，当前只有 `p0RelationshipAgent=true`，其余标志均为 `false`。

## 3. 修改前架构与本次深化

修改前是一个单源部署：React/TypeScript/Vite 前端与 Express API 同源；随机 `HttpOnly` Cookie session；scrypt 密码；本地 JSON 与 PostgreSQL 两个 Store Adapter；正式房间和 demo 房间；SSE 通知客户端重新读取房间；OpenAI Responses API 使用 `store:false`，无密钥时使用本地复盘；原始音频不落盘。

本次没有拆微服务。新增了三个有深度的 Module，并复用原身份/关系边界：

1. `relationship-domain.mjs`：Consent Kernel、per-user projection、共同 Agent context builder、Home 聚合和日期计算。
2. `relationship-router.mjs`：P0 状态机与窄 API Interface；所有 mutation 从 session 推导用户。
3. `src/features/*`：Relationship Home、Milestones、Lists、Decisions、Notifications；旧 `Prototype.tsx` 只把正式 dashboard 接到新 Module。

这条 Seam 保持旧调解房间语义不变，复用身份和 `relationship_members`，并让新长期对象不再塞回 room JSON。JSON/PostgreSQL 通过同一 Store Interface 提供一致行为。

## 4. Consent Kernel 与三个空间

- **personal/private**：只有 owner 可读；允许 Private Agent 使用时 `aiAccessScope=private`。
- **shared relationship**：双方可读；只有显式 `aiAccessScope=joint` 的内容才可能进入 Shared Agent。
- **public/external**：P0 不存在把关系数据公开发布的路径。

交互原则是：“对话是输入，结构化对象是 AI 的输出，用户只负责纠正、确认与授权。” 新决定和计划默认不要求填写 SaaS 表单；表单只保留在“手动编辑（备用）”中。

潜在共同决定先进入 `privateAgentThreads`。不只内容私密，**话题存在本身也私密**：对方看不到 thread、标题、数量、SSE 事件或通知。用户可以继续和自己的 Agent 澄清观点；只有本人执行 `share-decision` 后，服务端才创建 shared issue、本人 private perspective 与 confirmed shareable summary，并第一次通知对方。对方随后在自己独立的 private thread 中思考，再自行分享摘要。共享 Agent 在两份 confirmed summary 之前不能生成方案，Agreement 仍要求双方批准同一版本。

每个 Graph record 都带有：`relationshipId`、`createdByUserId`、`ownerUserId`、`visibility`、`aiAccessScope`、`approvalPolicy`、`status`、`version`、时间戳、过期/撤回/归档字段和 `provenance`。

读取链固定为：`session user -> relationship_members -> object.relationship_id -> per-user projection`。

前端提交的创建者、owner、relationship id 不被信任。私人对象的存在、数量、标题、预算、备注和内容不会投影给伴侣。SSE 只发送 `{eventType, objectId, version}`；私人事件只写给 owner 的连接。

### Shared Agent context builder

`buildJointDecisionContext` 只加入当前 shared issue、双方分别确认且 `aiAccessScope=joint` 的 shareable summaries、已生效 agreements、相关 commitments 和安全规则。它不接收 raw perspective、private notes、private evaluation 或 private reminder。自动测试在私人 perspective 中放入 secret token，并断言模型 context 不包含它。

Private Agent 与 Shared Agent 走不同函数和不同输入路径：`continuePrivateAgentThread` 只处理 owner 的私密 thread；`summarizePerspective` 保留给手动备用流程；`generateDecisionOptions` 只接受服务端 builder 的结果。OpenAI 调用均设置 `store:false`。私密语音复用 Realtime 转录，但 transcript 只提交回 owner-only thread，原始音频不落盘。

## 5. Relationship Graph 与数据库

| Collection | PostgreSQL table |
| --- | --- |
| privateAgentThreads | `private_agent_threads` |
| milestones / reminders | `relationship_milestones` / `reminders` |
| lists / listItems | `shared_lists` / `shared_list_items` |
| issues / perspectives / summaries | `relationship_issues` / `issue_perspectives` / `shareable_summaries` |
| proposals / evaluations | `decision_proposals` / `proposal_evaluations` |
| agreements / approvals | `agreements` / `agreement_approvals` |
| commitments | `commitments` |
| outcomes / outcomeResponses | `outcome_reviews` / `outcome_review_responses` |
| notifications | `notifications` |
| consentEvents / productEvents | `consent_events` / `product_events` |

各表用规范化公共列保存关系、owner、visibility、status、version、due/review/expiry 和索引字段，功能细节放在 `data jsonb`。每张表都有 relationship/status/created、owner、due、review、expiry 索引与外键。Local JSON 使用 `relationshipGraph` 下同名 collection，Store Interface 相同。

Migration 位于 `server/postgres-store.mjs` 的启动 migration：只 `create table/index if not exists`，additive、幂等、向后兼容，不删除旧数据、不改 room payload 语义。生产首次部署新 commit 时自动执行；当前没有破坏性 backfill。

## 6. P0 状态机

### Joint Decision

`private exploring (invisible to partner) -> owner explicitly shares -> collecting_perspectives -> confirmed summaries (2) -> evaluating -> private evaluations (2 per selected proposal) -> agreement_pending`

- 开始私密思考不会创建 shared issue，也不会通知伴侣。
- `share-decision` 是唯一从未共享 thread 创建或加入 shared issue 的边界。
- Perspective 原文是 private；Private Agent 先生成 shareable summary draft。
- 本人确认后才变为 `confirmed + joint`。
- 两份 confirmed summary 之前 Shared Agent 不能生成方案。
- 每人只能为一个 proposal 提交自己的 private evaluation。
- 所选 proposal 有双方独立评价之前，服务端拒绝创建 Agreement。

### Agreement

`awaiting_approvals(vN) -> active`；任何一方可 `reject -> cancelled` 或 `request-change -> draft`。

- 两个不同 principal 必须批准完全相同的 `version`。
- 修改要求提交当前 version；不匹配返回 409。
- 修改产生 `vN+1`，旧 approval 因版本不匹配自动失效。
- approval 使用确定性 ID，PostgreSQL 主键承担并发幂等保护。
- 前端提交 `active` 不生效；只有服务端状态机能激活。

### Commitment

`active -> completed` 或 `active -> renegotiation_requested`。

- 只能引用同一 relationship 中已生效 Agreement。
- owner 可以是 member A、member B 或 both；双方 owner 需要两人分别完成。
- 修改需要 creator、active 状态和精确 version。
- 完成转换在 PostgreSQL 行锁内执行；只创建一个确定性 Outcome Review。

### Outcome Review

`pending (reviewAt reached) -> two private responses -> completed`。

- 每人只能提交自己的 response，单方 response 不能形成共同结果。
- learned pattern 只有在双方完成、都允许学习、结果未恶化且提交完全相同的 candidate 时才记录；finalizer 不能单方面改写内容。

## 7. API

所有路由要求正式登录和已完成的双人关系：

- Home/SSE：`GET /api/relationship/home`、`GET /api/relationship/events`
- Private Agent：`GET|POST /api/private-agent/threads`、`GET /api/private-agent/threads/:id`、`POST /api/private-agent/threads/:id/messages|realtime|transcripts|share-decision|apply-plan`
- Milestones：`GET|POST /api/milestones`、`PATCH|DELETE /api/milestones/:id`、`POST /api/milestones/:id/reminders`
- Lists：`GET|POST /api/lists`、`POST /api/lists/:id/items`、`PATCH|DELETE /api/list-items/:id`、`POST /api/list-items/:id/reveal`
- Decisions：`GET|POST /api/issues`、`GET /api/issues/:id`、`POST /api/issues/:id/perspectives|shareable-summary|generate-options`、`POST /api/proposals/:id/evaluations`
- Agreements：`POST /api/agreements`、`PATCH /api/agreements/:id`、`POST /api/agreements/:id/approve|reject|request-change`
- Commitments：`POST /api/commitments`、`PATCH /api/commitments/:id`、`POST /api/commitments/:id/complete|renegotiate`
- Outcomes：`GET /api/outcome-reviews/due`、`POST /api/outcome-reviews/:id/responses|finalize`
- Notifications：`GET /api/notifications`、`POST /api/notifications/:id/read|dismiss`

错误码：400 输入，401 未登录，403 无权执行，404 对象不存在或跨关系不可见，409 状态/版本/双人条件不满足。

## 8. 通知

P0 只有站内通知。共同清单更新给另一位成员创建 owner-only notification，外部可见文案保持模糊，不包含礼物、争议、评价或私密摘要。`dedupeKey` 被保存；当前没有定时扫描器。未来引入 scheduler 前必须增加数据库唯一约束或幂等表。

## 9. Safe Share 安全规范（P2 设计，未实现）

位置共享必须由分享者本人显式发起，接收方不能启动；用途、接收者、精度、持续时间、到期时间和停止操作必须可见；分享者可随时单方面停止；默认最短期限并自动过期；停止/到期后接口不返回坐标；历史只保留模糊审计事件，不保留精确轨迹；不能静默续期、用于关系评分或喂给通用 Shared Agent。Web 只能做前台临时分享，可靠后台定位属于 future native-only。上线前需要威胁建模、滥用案例、法律审查和独立渗透测试。

## 10. Shared Companion 原则（P1 设计，未实现）

Companion 是双方共同完成善意行动的轻量表达，不是关系健康分、连续打卡、监控或惩罚系统。一方未登录、发生争执或没有提交内容都不能让 companion 生病、受伤或退化。一个来源事件最多产生一次成长事件，必须有 idempotency key。Companion 不读取私人内容，也不能诱导披露；系统没有 `relationship_score` 字段或 API。

## 11. 前端与可访问性

正式 dashboard 是响应式 Relationship Home：桌面顶部导航，手机底部导航；1280×900 与 393×852 双浏览器场景已通过。调解仍在原连续页面内。新表单有 label、loading/error/empty 状态；按钮和输入沿用全局 visible focus，样式尊重 `prefers-reduced-motion`。中文、English、Español 是完整界面语言；非中文品牌不显示“彼此”。

模块路径为 `src/features/relationship-home`、`milestones`、`lists`、`decisions`、`notifications` 和 `relationship`（API/types）。P0 没有为 agreements/commitments/outcomes 再造空壳页面，而是保持在 Decision Workspace 的同一纵向流程中。

## 12. 本地开发与验证

Node.js 22：

```powershell
npm install
npm run dev:full
```

正式产品：`http://127.0.0.1:5173/`；无账号 demo：`/demo`。无 `DATABASE_URL` 时写入本地 JSON；设置后使用 PostgreSQL。

```powershell
npm run check:runtime
npm run test:app
npm run test:relationship
npm run test:demo
npm run test:responsive
npm run build
npm run test:sites
```

`test:relationship` 使用两个隔离浏览器 context，覆盖桌面/手机、三语切换、红蓝 Home、对话生成计划、私密议题在分享前连“存在”都不泄漏、显式分享、伴侣独立私密思考、双方 summary/evaluation、Agreement 双批准和 Commitment 双完成。服务端测试另以 secret token 验证 owner-only thread 的列表、direct read、Home projection 与分享边界。

## 13. 生产部署与剩余风险

Render 使用现有单 Web Service + PostgreSQL Blueprint；新表由应用启动 migration 创建，不需要手工运行 SQL。必须在 Render secret store 中存在 `OPENAI_API_KEY` 才能使用真实模型/语音；没有时安全退回本地文字方案且语音不可用。部署后运行 `npm run verify:deploy` 验证 commit、HTTPS/HSTS、PostgreSQL、匿名身份与 fail-closed 边界。

剩余风险：

- PostgreSQL migration 有代码级与部署启动验证，但没有在本地临时 PostgreSQL 容器上跑完整 P0 流程。
- P0 reminder 只保存和展示，没有后台 scheduler/push delivery；时区用于记录，日期聚合以稳定 date-only noon UTC 计算，真正发通知时要使用 IANA timezone 调度。
- 通知尚无数据库级 dedupe 唯一索引，因为 P0 没有扫描器。
- 模型尚未做系统化红队评测、危机人工升级和目标市场法律审核。
- 前端主 bundle 超过 500 kB 建议阈值；下个性能里程碑应按 route/feature code split。
- 邮箱验证、忘记密码、MFA、自助导出/删除、保留策略和备份恢复演练仍未完成。

最优下一阶段不是马上堆 P1，而是先把 P0 在生产 PostgreSQL 上跑完双人验收，补定时 reminder/notification 的幂等调度，再依据真实使用决定 Memories 或 Check-ins 的优先级。
