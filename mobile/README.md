# Pinky 手机 App 外壳（Capacitor 8）

这是一个很薄的原生外壳：App 打开后直接加载网站（`server.url`），界面、登录、语音都是现有网页，没有重写。这样现有的 `HttpOnly` Cookie 登录不用改；网站更新后 App 里立即生效，不需要重新装包。公开上架前再评估要不要把前端打进安装包。

- App ID：`us.toward.app`，名字：`Pinky`。Bundle ID 正式占用前要在开发者账号里确认可用。
- 权限：麦克风和通知（`@capacitor/push-notifications`，经 Firebase Cloud Messaging）。通知权限只在登录后、或在「我的提醒」点「开启此手机通知」时问，而且只有服务器配了 `FCM_SERVICE_ACCOUNT_JSON` 才会问。安卓打包前把 Firebase 的 `google-services.json` 放进 `android/app/`（不进仓库；没有它也能编译，只是推送不可用）。iPhone 还缺 Firebase Messaging SDK（AppDelegate 里把 APNs token 换成 FCM token），要等 Apple 团队和 Mac。
  - iOS：`NSMicrophoneUsageDescription`，中英西三语说明。
  - Android：`RECORD_AUDIO`（会弹窗问用户）和 `MODIFY_AUDIO_SETTINGS`（必需，不弹窗）。原因：网页调用麦克风时，Capacitor 8.5.3 的 WebView 桥会同时申请这两项，只要有一项没在清单里声明就直接拒绝录音，所以少了它语音输入永远打不开。
- 加载哪个网址在**打包时**决定：默认是云端服务器 `https://toward-us-private-beta.onrender.com`（`scripts/config.mjs` 里的 `CLOUD_URL`，唯一一处；服务器在 Render 上，见根目录 README 的“云端部署”）。本地试用时用环境变量 `TOWARD_US_APP_URL` 临时改指别的地址。换网址就要重新打包、重新安装。
- **上架用的正式包**（TestFlight / App Store）用 `npm run sync:release` 或 `npm run check:ios-release`：不设 `TOWARD_US_APP_URL` 就用云端地址；设了的话只能是公网 `https://` 地址；`*.ts.net`（Tailscale，只有创始人自己的设备连得上）、`localhost`、`.local`、IP 地址都会直接报错，防止把内测地址打进正式包。
- 连不上服务器时（没网、服务器挂了）显示包里自带的离线页（`www/offline.html`，按手机语言显示中/英/西），每 10 秒和联网时自动重试，连上就回到 App；不会白屏。
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

iOS 工程在 `ios/`：只支持 iPhone、竖屏；权限说明（麦克风、相册、相机、语音识别）都有中英西三语；包里带隐私清单 `App/PrivacyInfo.xcprivacy`，`Info.plist` 已声明 `ITSAppUsesNonExemptEncryption = false`（只用系统 HTTPS，上传时不用再答出口合规）。Windows 上不能编译 iOS，在创始人的 Mac 上编（见下）。

```sh
cd mobile
npm ci --ignore-scripts
npm run check:ios   # 无签名的模拟器编译
TOWARD_US_APP_URL=https://<正式域名> npm run check:ios-release   # 无签名的 Release 真机编译（和上架归档同一套编译）
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
