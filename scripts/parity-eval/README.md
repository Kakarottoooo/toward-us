# Pinky 对标评测

## 第四轮外部题入口（2026-11-11）

`node scripts/parity-eval/run.mjs --cases-file scripts/parity-eval/examples.json --label round4-examples --concurrency 1 --budget-file work/task18/model-budget.json`

JSON根对象为`{version:1,purpose:"examples"或"holdout",createdAt:"实际UTC创建时间",cases:[...]}`，完整占位示例见`examples.json`。题目沿用练习题的`id/layer/title/probe/expect/completion`；`history`追加虚构问答，`notes`追加本人笔记，`reminders`按`owner:me/partner`分别保留，`shared`按`speaker:me/partner,day,text`写入共同对话。`day`为相对天数，`paired`声明两个虚构参与者，`people`声明私人卡片名。`screenshot:{title,messages:[{speaker,time,text}]}`渲染成PNG，产品和两个对手均读同一图片，不给对手额外转写。所有资料仅在隔离本地账号中造数，不能指向dogfood或data目录。

`writes:[{collection,mode:"created"或"updated",count,fields:{...}}]`在回答前后真实存储快照上检查：该集合新增/更新数和字段匹配数都必须等于count，重复写入也失败；字段用精确值，`$me/$partner`代表对应账号，`{date:N}`为题目UTC日期偏移，时间及时区须明确写出。支持reminders、memories、checkins、spaces、spaceItems、agreements。题目的expect/completion/writes只供评委或机器检查，不传给产品和对手。示例报告`excludedFromScores:true`且没有得分汇总；不得作为新题成绩。

外部题与练习题共用真实HTTP、资料投影、原始答案归档和Codex先评的批量盲评；若复用对手，仍核对原始语料、可见资料和图片哈希。所有运行均启用120 Claude内部轮次/40 Codex调用守卫；同一任务各批必须传同一个budget-file。CLI超时/退出错误保留已读输出，结算num_turns；缺失则按整笔预留计入，不单独终止整轮。额度错误立即停止且不重试。

本节覆盖下方旧门槛：每层对两个对手均须8/8；有争议不计不输。练习题和代码冻结后由Claude新建的当轮留出题都须满分，单次练习满分不代表产品达标。manifest记录外部文件哈希及声明的createdAt；创建时间必须由Claude的独立文件证据核对，不能信任自填字段。冻结提交与实际UTC冻结时间记入任务报告。

只评测，不改产品行为。不需要 dogfood、真实账号、密钥或付费 API。必须在独立工作区运行；需要已经登录订阅的 `claude` 与 `codex` CLI，以及现有依赖。模型、图片、文件和存储调用均使用本机临时虚构账号；不发真实消息、不登录外部真实账号。

```powershell
node --test scripts/parity-eval/score.test.mjs
node scripts/parity-eval/run.mjs --label pilot --only tool-reminder-once,memory-recall-paired-advice,interaction-screenshot-apology
node scripts/parity-eval/run.mjs --label baseline
node scripts/parity-eval/run.mjs --label after --compare E:/absolute/path/report.json
node scripts/parity-eval/run.mjs --label round1 --concurrency 1 --reuse-opponents E:/absolute/path/reviewed/report.json
# 仅用于修正旧版漏掉聊天卡片的基线；完整运行结束后执行，不再次生成产品/对手答案。
node scripts/parity-eval/review-baseline.mjs E:/absolute/path/report.json
```

先 3 题再全量，全量最多两遍。默认同时跑 2 题，`--concurrency` 最大 3；运行时不要改同一工作区代码。每层 8 题，共 40 题；记忆题复用已有事实与问答，省略长历史填充，因此不代表多年记忆压测。语音题只测转写后的文本，不是 ASR 或通话验收；图片用 sharp 生成可重复的虚构截图/海报，文件走实际导入 API。

输出在 `work/parity-eval/<label>-<UTC>/`：冻结 manifest（代码提交、场景哈希、选择范围、随机种子）、每题可见资料/原始答案/评委判断、`report.json` 和 `report.md`，以及可供排查的虚构存储。目录不提交，不自动删除，绝不能用递归强删工作区清理共享 node_modules 联接。

`review-baseline` 保留原报告，复制本轮虚构存储后通过真实权限投影和只读 API 恢复聊天可见卡片；只补评答案确有新增可见内容的题，写入 `reviewed/`。修正来源哈希、代码版本、原判决、补评用量和隐私误报纠正均保留。恢复的是结束时状态，因此该补评不能冒充原时刻的浏览器录像；本语料每题账号隔离，提醒和约定没有随后编辑。新 `run` 已直接保存可见卡片，正常新基线不需要此补评。

任务 08 的 `--reuse-opponents` 只读完整旧报告并核对语料哈希、逐题问题、可见资料及图片哈希；不相符就拒绝复用。Pinky 和两位评委重新运行，38 道未改流程题复用对手原答案，2 道约定题重新生成对手答案。原题的 `visible.now` 用作本次造数及产品请求的独立日历时间，计时继续推进且仅影响虚构评测进程，避免“明天”和旧记录日期漂移；网页搜索仍是当前搜索，不能宣称冻结了互联网。旧对手花费保存在 `originalCost`，不会重复计入本轮费用。

约定题保留原始提问和最初的草稿内容盲评，之后模拟已明确授权的用户操作：提出者点击“发给你们俩批准”，本人批准；重复本人批准仍不能代替伴侣；另一虚构账号独立登录并批准同一版本后才生效。每个阶段通过真实 HTTP 和用户投影存证，`agreementStages` 分步计分。失败不补写存储、不强行继续。模型没有代批权限，对手没有产品写权限，报告将可用初稿与实际流程完成分开；相对于旧基线的约定完成率变化包含补流程因素，不能全算成产品改进。

## 口径

- 同一问题、同一批当前提问者可见的虚构资料。伴侣私聊、另一人物范围的历史不发给对手；共享题不携带任何私密历史。对手不接收答案、评分要点或隐藏的隐私事实。图像对手只接收原图，不额外收到转写。
- Claude 对手和 Claude 评委各起独立 CLI；Codex 同样如此。双方均用本机订阅。Claude 使用 `sonnet` 别名；Pinky 保持产品现有模型路由，Codex 使用忽略用户配置后的 CLI 默认模型（无法解析实际模型时不声称具体型号）。Codex 代表 OpenAI 通用代理，不代表 ChatGPT 网页。
- 对手可网页搜索；不提供真实账号、产品写权限、云端电脑或系统命令工具。执行环境题仍发出实际请求，但本轮没有云端浏览器/测试登录服务；结果只能说明回答是否诚实，不能衡量对手完整产品的浏览器能力。
- 两位评委分别用不同随机顺序比较每个对手与 Pinky；只给统一结构的答案，去掉品牌名、调用元数据和数据库证据，执行结果另算。回答风格仍可能让评委猜到身份，因此是标签盲评，不宣称完全双盲。
- 只有两位均判输才算输；分歧单列。任一回答或评委调用失败记为待定，保留在分母但不计不输。达标线为每层各对手不输率 ≥80%，记忆 ≥90%，且至少 8 题、没有待定。这个相对门槛不能替代绝对任务完成率及 Muse 能力清单。
- 对手以直接可用结果评估；不凭口头承诺认定实际写入。Pinky 提醒检查日期/时间/周期/所属人；空间检查实际条目及双方可见性；约定检查同版本、待批准及不能代批；回忆引用调用真实定位接口；隐私题连续三问并检查伴侣被拒绝访问。主观内容完成要求四个判决均认可；机器执行失败或任一隐私违规覆盖主观通过。
- 成本沿用 `usageListeners`，保存每次可观测的 token、缓存 token 和 CLI 标价折算美元，区分准备和提问；对手、评分用量另列。产品现有图片读取及网页搜索没有 usage 事件，Pinky 总量因此只是部分覆盖。Codex 不返回美元时是未知，不是免费。订阅折算不是真实新增支出。
- `--compare` 保留题目选择与语料版本检查；不同题目不能解释为产品进步。同题单轮差异也未扣除模型噪声，只有独立重复运行才能估计噪声。

测试已由 `tests/memory-eval.test.mjs` 纳入既有 CI，不调用任何模型。无需改 CI、依赖或部署。


## 2026-11-11 省额度续跑

用户最新授权覆盖旧全量规则：`--economy --reuse-opponents <冻结report.json> --only <受影响题列表> --concurrency 1`。所有对手（含约定题）均复用冻结答案；仅 Codex 先评，判输或平才由 Claude 复核。没有调用的第二票不伪造；混合总表明确区分实测题与沿用题，严格完成按本轮实际票数报告，不与旧四票口径混同。`calls.jsonl` 记录所有产品、读图、搜索及评委 CLI 调用；额度错误立刻保存中间证据、终止本次评测的子进程和主进程，不重试。另有每次运行最多 120 次 Claude 调用的上限，避免异常循环消耗手机共用订阅；达到上限同样停止，不能自动再开一轮绕过它。
