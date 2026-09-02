# Toward Us / 彼此

面向恋人和夫妻的 **Multi-principal Relationship Agent**：属于两个人，帮助双方一起沟通、决定、计划、记住并履行承诺，同时不允许任何一方单独控制共同 Agent。原有 AI 调解、实时语音、扫码 demo 与长期复盘完整保留。

同一个公网网址会按设备自适应：电脑打开是完整宽屏网站与工作台，手机打开是无设备外壳的全屏移动体验；两端共享同一套账号、邀请、房间与历史数据。

## 已实现

- 新 Relationship Home：等待双方、即将到来、正在执行与站内通知；
- 共同纪念日、双方各自的私人提醒、共同提醒；
- Shared Lists / Wishlists，以及对伴侣完全不可见、可由 owner 揭晓的 Private Surprise；
- Joint Decision：双方私密观点、分别确认的可共享摘要、共同 AI 方案、双方私密评价；
- 独立 Agreement/Approval/Commitment/Outcome Review 对象；同版本双批准、双完成与共同复盘由服务端状态机保证；
- Consent Kernel、provenance、per-user projection、最小 SSE payload；共同 Agent context 只由服务端从获准信息构建；
- 邮箱和密码注册/登录，密码使用 scrypt 加盐哈希；
- 服务器端会话与 `HttpOnly`、`SameSite=Lax` Cookie，浏览器不保存身份令牌；
- 八位伴侣邀请码和邀请链接，一位用户只能属于一个共同空间；
- 所有房间、消息、AI 私下反馈与历史查询都验证当前账号是否属于同一伴侣关系；
- 两台设备和同一台设备两种调解模式；
- 简体中文、English、Español 三套完整界面；非中文模式只显示英文品牌名，不混入中文副标或界面文字；
- 文字、双说话人录音转录、三级安全提醒与真实 AI 结构化调解；
- 私下反馈只返回当前登录者自己的内容；
- 只有双方分别确认，调解才归档为共同复盘；
- 共同复盘列表、共识/分歧摘要、完整调解详情与原始表达；
- 本地 JSON 持久化和生产 PostgreSQL 适配器；
- Render Blueprint、自动 HTTPS 入口、HTTP→HTTPS 跳转、HSTS、安全头、健康检查和部署后 fail-closed 探针；
- `/demo` 无登录快速体验：同一台手机或两台手机扫码加入、双方录音/转录同意、文字/语音表达、AI 私下与共同反馈；
- 临时邀请 15 分钟内可加入，转录和分析最多保留 1 小时，原始音频不落盘；
- 远程邀请默认调用手机系统分享面板发送温和文案和 `/j/{房间码}` 深链，复制链接、二维码和房间码依次作为备用；
- 两位访客都注册并分别确认后，临时复盘可原子转换为正式共同空间和共同历史。
- 1440px 桌面网站、393px 手机全屏界面和中间尺寸平板共用一套响应式前端；正式产品不显示演示用手机边框、状态栏或机型选择器。

## 本地启动

要求 Node.js 22。

```powershell
npm install
npm run dev:full
```

打开 `http://127.0.0.1:5173/` 使用正式空间，或打开 `http://127.0.0.1:5173/demo` 直接创建无需登录的扫码体验。正式空间首次使用时创建两个账号：账号 A 生成伴侣邀请，账号 B 接受邀请，之后双方进入同一共同空间。

本地数据默认写入 `data/toward-us.local.json`。可通过 `TOWARD_US_DATA_FILE` 指定其他位置。原始音频只在请求内存中处理，不写入文件；文字、转录和调解结果会持久化。

## 环境变量

复制 `.env.example` 的变量名到本机或托管平台的密钥存储，不要把真实值写进仓库。

- `OPENAI_API_KEY`：可选；未配置时文字和本地复盘仍工作，语音转录不可用；
- `OPENAI_MODEL`：默认 `gpt-5.4`；
- `OPENAI_REALTIME_MODEL`：实时语音会话模型，默认 `gpt-realtime`；
- `OPENAI_TRANSCRIBE_MODEL`：实时输入转录模型，默认 `gpt-live-transcribe`；
- `DATABASE_URL`：可选；存在时使用 PostgreSQL，不存在时使用本地 JSON；
- `DB_POOL_SIZE`：PostgreSQL 连接池大小，默认 5；
- `PORT`：本地默认 5173。
- `TOWARD_US_DATA_FILE`：可选的本地 JSON 数据路径；
- `TOWARD_US_BASE_URL`：部署后验证脚本使用的 HTTPS 地址。

## 验证

```powershell
npm run check:runtime
npm run test:app
npm run test:relationship
npm run test:demo
npm run build
npx playwright test --config playwright.beta.config.ts
npx playwright test tests/responsive-site.spec.ts
npm run test:sites
```

部署后设置目标地址并执行：

```powershell
$env:TOWARD_US_BASE_URL = "https://你的域名"
npm run verify:deploy
```

探针会验证 HTTPS、HSTS、PostgreSQL 健康状态、匿名身份为空，以及未登录正式房间请求必须返回 `401`。快速体验使用独立的一小时 `HttpOnly` 能力 Cookie，公开预览接口只暴露加入所需的最少元数据，不返回参与者表达或分析。

## HTTPS + PostgreSQL 部署

根目录的 `render.yaml` 定义一个 Node Web Service 和一个仅允许内部网络访问的 PostgreSQL。Render 会为 Web Service 提供 HTTPS；服务端在生产模式下把非 HTTPS 请求重定向到 HTTPS。

实际创建云资源仍需要：

1. 将此目录放入 GitHub、GitLab 或 Bitbucket 仓库；
2. 在 Render 中导入 `render.yaml`；
3. 在 Render 的密钥界面设置 `OPENAI_API_KEY`；
4. 部署完成后运行 `npm run verify:deploy`。

GitHub Actions 会在每次推送和 Pull Request 上运行后端测试、生产构建和 Sites 路由测试。生产部署仍需在 Render 中导入 `render.yaml` 并在密钥存储中配置 `OPENAI_API_KEY`。

## 尚未声称完成

- 邮箱所有权验证、忘记密码和 MFA；
- 用户自助导出、删除、数据保留期限与备份恢复演练；
- 录音同意记录、隐私政策、未成年人规则和目标市场法律审查；
- 实时边说边调解与危机人工升级；
- 生产负载、渗透测试和多地区容灾。

新方向、P0 实现、Consent Kernel、Relationship Graph、状态机、API、migration、Safe Share/Companion 设计边界与真实状态矩阵见 [docs/multi-principal-relationship-agent.zh-CN.md](./docs/multi-principal-relationship-agent.zh-CN.md)。原产品和技术介绍见 [docs/product-and-technology-overview.zh-CN.md](./docs/product-and-technology-overview.zh-CN.md)；逐项历史产品逻辑见 [docs/product-design.zh-CN.md](./docs/product-design.zh-CN.md)；视觉验收见 [design-qa.md](./design-qa.md)。公开仓库不会包含真实伴侣数据或私人争执记录。
