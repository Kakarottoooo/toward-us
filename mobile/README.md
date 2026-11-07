# Pinky 手机 App 外壳（Capacitor 8）

这是一个很薄的原生外壳：App 打开后直接加载网站（`server.url`），界面、登录、语音都是现有网页，没有重写。这样现有的 `HttpOnly` Cookie 登录不用改；网站更新后 App 里立即生效，不需要重新装包。公开上架前再评估要不要把前端打进安装包。

- App ID：`us.toward.app`，名字：`Pinky`。Bundle ID 正式占用前要在开发者账号里确认可用。
- 权限：麦克风和通知（`@capacitor/push-notifications`，经 Firebase Cloud Messaging）。通知权限只在登录后、或在「我的提醒」点「开启此手机通知」时问，而且只有服务器配了 `FCM_SERVICE_ACCOUNT_JSON` 才会问。安卓打包前把 Firebase 的 `google-services.json` 放进 `android/app/`（不进仓库；没有它也能编译，只是推送不可用）。iPhone 还缺 Firebase Messaging SDK（AppDelegate 里把 APNs token 换成 FCM token），要等 Apple 团队和 Mac。
  - iOS：`NSMicrophoneUsageDescription`，中英西三语说明。
  - Android：`RECORD_AUDIO`（会弹窗问用户）和 `MODIFY_AUDIO_SETTINGS`（必需，不弹窗）。原因：网页调用麦克风时，Capacitor 8.5.3 的 WebView 桥会同时申请这两项，只要有一项没在清单里声明就直接拒绝录音，所以少了它语音输入永远打不开。
- 加载哪个网址在**打包时**决定：环境变量 `TOWARD_US_APP_URL`，不设时默认 `https://toward-us-private-beta.onrender.com`（取自 `render.yaml` 的服务名，**实际域名还要确认**；不对就改 `scripts/config.mjs` 里的 `DEFAULT_URL`）。换网址就要重新打包、重新安装。
- 只有网址是 `http://` 时才允许明文流量（本地试用）；默认的 HTTPS 包不允许。
- iOS 图标已换成 Pinky；安卓图标和两边的启动图还是 Capacitor 默认的。

## 安卓：编出 APK

需要 Node.js 22、JDK 21、Android SDK 36。本机已装好：JDK 在 `E:\CodexData\toolchains\jdk-21`，SDK 在 `E:\CodexData\toolchains\android`（协议已接受）。在 PowerShell 里：

```powershell
cd mobile
npm ci --ignore-scripts
$env:JAVA_HOME = "E:\CodexData\toolchains\jdk-21"
$env:ANDROID_HOME = "E:\CodexData\toolchains\android"
npm run check:android
```

成功后 APK 在 `mobile\android\app\build\outputs\apk\debug\app-debug.apk`（约 4 MB，Debug 签名，只能自己装，不能上架）。Gradle 缓存在 `mobile\native-check\gradle`。第一次要下载 Gradle 和依赖，约 3 分钟。

`npm run android` 会同步后打开 Android Studio，需要图形界面时再用。

## 安装到安卓手机

**方式一：USB（推荐）**

1. 手机：设置 → 关于手机 → 连点「版本号」7 次打开开发者选项；在开发者选项里打开「USB 调试」。
2. 用数据线连电脑，手机上点「允许 USB 调试」。
3. 电脑上：

```powershell
& "E:\CodexData\toolchains\android\platform-tools\adb.exe" devices
& "E:\CodexData\toolchains\android\platform-tools\adb.exe" install -r mobile\android\app\build\outputs\apk\debug\app-debug.apk
```

`-r` 表示覆盖安装，保留登录状态。

**方式二：传文件**

把 `app-debug.apk` 用微信文件传输、网盘或数据线拷到手机，在手机文件管理里点开它，按提示允许「安装未知应用」后安装。

## 连本机开发服务器试用（dogfooding）

### 先启动本机服务器（开发模式）

在仓库根目录：

```powershell
$env:OPENAI_API_KEY = "<你的 key>"   # 语音转文字需要；服务器不读 .env 文件，只认当前终端的环境变量
npm run dev:full
```

- 端口是 `5173`（`PORT` 可改），监听 `0.0.0.0`，开发模式下页面由 Vite 中间件提供，不用先 `npm run build`。
- **必须用开发模式**：不要用 `npm start`，也不要设 `NODE_ENV=production`。生产模式下服务器会把所有非 HTTPS 请求重定向到 `https://`，登录 Cookie 也会带 `Secure`，在 `http://` 下登录不了。开发模式下 Cookie 不带 `Secure`，`http://localhost` 和局域网 IP 都能登录，不需要额外环境变量。
- 本地数据写在 `data/toward-us.local.json`（或 `TOWARD_US_DATA_FILE` 指定的位置）。

### 推荐：USB + adb reverse（语音能用）

手机用 USB 连电脑（已打开 USB 调试）。`adb reverse` 让手机上的 `localhost:5173` 直接转到电脑的 `5173`。`localhost` 在浏览器规则里算安全环境，**麦克风可以用**；也不经过 Wi-Fi，不用管 Windows 防火墙。

```powershell
$adb = "E:\CodexData\toolchains\android\platform-tools\adb.exe"
& $adb devices
& $adb reverse tcp:5173 tcp:5173

cd mobile
$env:JAVA_HOME = "E:\CodexData\toolchains\jdk-21"
$env:ANDROID_HOME = "E:\CodexData\toolchains\android"
$env:TOWARD_US_APP_URL = "http://localhost:5173"
npm run check:android
& $adb install -r android\app\build\outputs\apk\debug\app-debug.apk
Remove-Item Env:TOWARD_US_APP_URL   # 用完清掉，否则下一个包还指着本机
```

- 这个包只指向 `http://localhost:5173`，打包一次后反复用即可，不用每次重打。
- 拔掉数据线、手机重启或 adb 重启后，`adb reverse` 会失效，要重新执行 `& $adb reverse tcp:5173 tcp:5173`（可用 `& $adb reverse --list` 查看）。没转发时 App 会白屏或报无法连接。
- 手机必须连着电脑、电脑上的 `npm run dev:full` 必须在跑。

### 备选：同一 Wi-Fi 的局域网 IP（语音不能用）

不插线也能试，但 **`http://<电脑 IP>` 不是安全环境，手机网页拿不到麦克风，只能验登录和文字**。做法：电脑上 `ipconfig` 找到和手机同一 Wi-Fi 的 IPv4（比如 `192.168.1.23`），先用手机浏览器打开 `http://192.168.1.23:5173` 确认能访问（打不开通常是 Windows 防火墙没给 Node 放行「专用网络」），再把上面命令里的 `TOWARD_US_APP_URL` 换成 `http://192.168.1.23:5173` 打包安装，不需要 `adb reverse`。

## 真机验收清单

装好后逐项看：登录 → 默认是对话界面 → 语音输入能用（第一次会弹麦克风权限，中文系统显示中文）→ 从最近任务里划掉 App 再打开，仍然是登录状态。

## iPhone

iOS 工程已生成在 `ios/`，麦克风说明有中英西三语，但 **Windows 上不能编译 iOS，这一版没有编过**。等 Apple 公司开发者团队开通后，在 Mac 上：

```sh
cd mobile
npm ci --ignore-scripts
npm run check:ios   # 无签名的模拟器编译
npm run ios         # 打开 Xcode，选自己的 Signing Team 后真机运行 / 打 TestFlight
```

需要 Xcode 26+。iPhone 上的局域网 `http://` 试用没有配置（iOS 默认拦截明文网页），iPhone 请直接用 HTTPS 地址。安全区（刘海、底部横条）的显示要在真机上确认。

### 公司账号开通前：用免费 Apple ID 装到自己的 iPhone（内测）

App 加载的是 Windows 电脑上经 Tailscale 发布的 HTTPS 地址，所以 iPhone 要开着 Tailscale，Windows 电脑上的服务器也要开着。

```sh
git clone https://github.com/Kakarottoooo/toward-us.git && cd toward-us
git checkout claude/relaunch-impl-20261101
cd mobile
npm ci --ignore-scripts
TOWARD_US_APP_URL=https://node.tail3f720f.ts.net npm run ios   # 生成配置、同步、打开 Xcode
```

在 Xcode 里：
1. 左侧选 `App` 工程 → `Signing & Capabilities` → Team 选自己的 Apple ID（Personal Team；没有就在 Xcode → Settings → Accounts 里登录）。
2. 如果提示 Bundle ID `us.toward.app` 不可用，改成只属于自己的，例如 `us.toward.app.<名字>`（只影响这台手机的内测包，不提交）。
3. iPhone 用数据线连 Mac，在 Xcode 顶部选这台 iPhone，点运行。
4. iPhone 第一次要：设置 → 隐私与安全性 → 开发者模式 打开（会重启）；设置 → 通用 → VPN 与设备管理 → 信任自己的开发者证书。

免费签名的包 7 天后失效，到期重新点一次运行即可；不能收原生推送。图标已是 Pinky（`AppIcon-512@2x.png`，1024×1024）。

## iPhone 桌面小组件和 App 内购买（2026-11-06）

两样东西都已经写进 iOS 工程，模拟器里编过、测过；**装到真机需要正式的 Apple 开发者账号（每年 99 美元）**，现在用的免费 Personal Team 不支持 App Groups 和 App 内购买。

### 桌面小组件（PinkyWidget）

- 尺寸：桌面小号、中号；锁屏长条、圆形。显示在一起的天数（大数字）、🔥 连续天数和今天谁打过卡（你 ✓ / TA ○）、下一个日子（“生日 · 还有 25 天”）、TA 的名字。语言跟服务器返回的 `language`（中 / 英 / 西）。点一下打开 Pinky。
- 怎么拿数据：网页登录后（在 App 里）调用 `Capacitor.Plugins.PinkyWidget.setWidgetData({ baseUrl, token })`，`token` 是服务器 `POST /api/widget/token` 发的小组件专用令牌（不是登录 Cookie）。原生插件把它存进 App Group `group.us.toward.app`（键 `pinky.widget.baseUrl` / `pinky.widget.token`），刷新小组件。小组件自己每 30 分钟左右请求一次 `GET {baseUrl}/api/widget`（`Authorization: Bearer`）。退出登录时网页调用 `PinkyWidget.clear()`，令牌和缓存一起删掉。
- 出错时：没令牌或服务器回 401 → 显示“打开 Pinky 登录”；404（服务器还没上这个接口）、断网、5xx → 显示上次的数字，没有就显示“打开 Pinky 看看今天”。
- 代码：`ios/App/PinkyWidget/`（入口 `PinkyWidget.swift`，界面和请求 `PinkyWidgetCore.swift`），插件 `ios/App/App/PinkyWidgetPlugin.swift`。小组件 Bundle ID 是 App 的加 `.widget`（`us.toward.app.widget`）。

### App 内购买（PinkyStore，StoreKit 2）

- 网页调用 `Capacitor.Plugins.PinkyStore`：`products({ ids })`、`purchase({ id, appAccountToken })`（`appAccountToken` 是登录用户的 id，必须是 UUID）、`restore({ sync })`，以及事件 `transaction`（续费、家长批准、在别的设备买的）。买到后把 `signedTransaction` 交给服务器 `POST /api/membership/apple/verify` 验证；会员按情侣算，一个人付，两个人都是会员。
- 商品：会员订阅（同一订阅组“Pinky 会员”）`us.toward.pinky.member.monthly` $9.99 / 月、`us.toward.pinky.member.yearly` $59.99 / 年；装扮（买断）`us.toward.pinky.outfit.<bow|crown|scarf|glasses|flower|santa>` 各 $1.99。
- 本地测试：`ios/App/Pinky.storekit` 里是这些商品，已挂在共享 Scheme `App` 的 Run 上（Xcode 里 Product → Scheme → Edit Scheme → Run → Options → StoreKit Configuration 应显示 `Pinky.storekit`），模拟器里点运行就能假装购买，不花钱、不连 App Store。
- 代码：`ios/App/App/PinkyStorePlugin.swift`，两个插件都在 `SceneDelegate.swift` 的 `PinkyBridgeViewController` 里注册。

### 自动测试（模拟器，不需要签名）

`AppTests` 跑在真的 App 里：页面上的 JavaScript 通过 Capacitor 调插件，StoreKit 用 `Pinky.storekit` 应答（列商品、带 `appAccountToken` 购买、恢复、`transaction` 事件、小组件数据存取）；小组件的请求在假服务器上测 200 / 404 / 503 / 401，并把每个尺寸、每种状态画成 PNG。

```sh
cd mobile
npm ci --ignore-scripts
TOWARD_US_APP_URL=https://example.com npm run sync   # 测试只需要一个能打开的网页让 Capacitor 注入桥
cd ios/App
xcodebuild -project App.xcodeproj -scheme App -sdk iphonesimulator \
  -destination 'platform=iOS Simulator,name=iPhone 17' CODE_SIGNING_ALLOWED=NO \
  TEST_RUNNER_PINKY_SNAPSHOT_DIR=$PWD/widget-snapshots test
```

### 创始人要做的事

1. 加入 Apple Developer Program（正式账号）。免费 Personal Team 签不了 App Groups 和 App 内购买，所以**在那之前，Xcode 里用免费账号给自己装包会签名失败**：临时办法是在 Xcode 里两个 target（App、PinkyWidgetExtension）的 Signing & Capabilities 删掉 App Groups（不要提交），小组件会一直显示“打开 Pinky 登录”。改了 App 的 Bundle ID（比如 `us.toward.pinky.ziwei`）时，小组件的也要改成 `<同一个>.widget`。
2. 开发者后台：给 `us.toward.app` 和 `us.toward.app.widget` 打开 App Groups，建 `group.us.toward.app`；App 打开 In-App Purchase。
3. App Store Connect：建 App，按上面的商品 id 和价格建订阅组“Pinky 会员”和 6 个装扮，签付费 App 协议、填银行和税务信息；沙盒测试账号。
4. 服务器配好 Apple 的验证（另一个 PR 负责），之后在真机上用沙盒账号走一遍：买会员 → 两个人都变成会员；恢复购买；小组件登录后显示数字、退出后显示“打开 Pinky 登录”。
