# Toward Us 手机 App 外壳（Capacitor 8）

这是一个很薄的原生外壳：App 打开后直接加载网站（`server.url`），界面、登录、语音都是现有网页，没有重写。这样现有的 `HttpOnly` Cookie 登录不用改；网站更新后 App 里立即生效，不需要重新装包。公开上架前再评估要不要把前端打进安装包。

- App ID：`us.toward.app`，名字：`Toward Us`。Bundle ID 正式占用前要在开发者账号里确认可用。
- 权限：只有麦克风（iOS `NSMicrophoneUsageDescription` 中英西三语；Android `RECORD_AUDIO`，外加系统不弹窗的 `MODIFY_AUDIO_SETTINGS`，Capacitor 的网页录音必须两者都有）。推送以后再加。
- 加载哪个网址在**打包时**决定：环境变量 `TOWARD_US_APP_URL`，不设时默认 `https://toward-us.onrender.com`（占位，**正式域名确认后要改 `scripts/config.mjs` 里的默认值**）。换网址就要重新打包、重新安装。
- 只有网址是 `http://` 时才允许明文流量（本地试用）；默认的 HTTPS 包不允许。
- 图标和启动图还是 Capacitor 默认的，等定稿图标再换。

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

1. 根目录启动服务器：`npm run dev:full`（监听 `0.0.0.0:5173`）。
2. 电脑运行 `ipconfig`，找到和手机同一个 Wi-Fi 的 IPv4 地址，比如 `192.168.1.23`。手机浏览器先打开 `http://192.168.1.23:5173` 确认能访问；打不开通常是 Windows 防火墙没放行 Node 的「专用网络」。
3. 用这个地址重新打包并安装：

```powershell
cd mobile
$env:TOWARD_US_APP_URL = "http://192.168.1.23:5173"
npm run check:android
& "E:\CodexData\toolchains\android\platform-tools\adb.exe" install -r android\app\build\outputs\apk\debug\app-debug.apk
```

4. 用完记得 `Remove-Item Env:TOWARD_US_APP_URL` 再打包，否则下一个包还指着你的电脑。

**限制：`http://` 局域网地址下语音输入用不了。** 手机网页只在 HTTPS（安全环境）下才给麦克风，这是浏览器规则，不是 App 的问题。登录、文字对话可以在局域网验；语音要用 HTTPS 地址验（线上域名，或者把本机服务通过 HTTPS 隧道暴露出来再把 `TOWARD_US_APP_URL` 设成那个 `https://` 地址）。

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
