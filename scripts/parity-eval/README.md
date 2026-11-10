# Pinky 对标评测

只评测，不改产品行为。不需要 dogfood、真实账号、密钥或付费 API。必须在独立工作区运行；需要已经登录订阅的 `claude` 与 `codex` CLI，以及现有依赖。模型、图片、文件和存储调用均使用本机临时虚构账号；不发真实消息、不登录外部真实账号。

```powershell
node --test scripts/parity-eval/score.test.mjs
node scripts/parity-eval/run.mjs --label pilot --only tool-reminder-once,memory-recall-paired-advice,interaction-screenshot-apology
node scripts/parity-eval/run.mjs --label baseline
node scripts/parity-eval/run.mjs --label after --compare E:/absolute/path/report.json
```

先 3 题再全量，全量最多两遍。默认同时跑 2 题，`--concurrency` 最大 3；运行时不要改同一工作区代码。每层 8 题，共 40 题；记忆题复用已有事实与问答，省略长历史填充，因此不代表多年记忆压测。语音题只测转写后的文本，不是 ASR 或通话验收；图片用 sharp 生成可重复的虚构截图/海报，文件走实际导入 API。

输出在 `work/parity-eval/<label>-<UTC>/`：冻结 manifest（代码提交、场景哈希、选择范围、随机种子）、每题可见资料/原始答案/评委判断、`report.json` 和 `report.md`，以及可供排查的虚构存储。目录不提交，不自动删除，绝不能用递归强删工作区清理共享 node_modules 联接。

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
