# 网址与图标检查

## App Store Connect 要填的网址

| 字段 | 是否必填 | 填什么 | 现在的状态 |
|---|---|---|---|
| 隐私政策网址（Privacy Policy URL） | 必填 | `https://<正式域名>/privacy` | 页面已做好（PR #188，`server/legal.mjs`），**等正式域名**；英文以外的语言可填 `?lang=zh`、`?lang=es` |
| 技术支持网址（Support URL） | 必填 | `https://<正式域名>/support` | 页面已做好，**等正式域名**；要先设 `PINKY_SUPPORT_EMAIL` 才会显示邮箱 |
| 营销网址（Marketing URL） | 选填 | 可以不填，或填 `https://<正式域名>/` | 首页就是 App 的登录页，**没有单独的营销页**；不填不影响审核 |
| 使用条款（EULA） | 有自动续期订阅时必须在描述或 EULA 字段给出链接 | `https://<正式域名>/terms` | 页面已做好；描述末尾已写链接（替换域名） |

上线前在正式服务器上要设的环境变量：

- `PINKY_SUPPORT_EMAIL`：支持和隐私请求的收信邮箱（必须是你能收到、会回复的）
- `PINKY_OPERATOR`：隐私政策里"由谁运营"，个人开发者填你的英文名，公司就填公司名；不设时显示"Pinky 团队"

**还缺的页面**：没有了。三个页面都在服务器上，只差正式域名和上面两个环境变量。

## 图标检查（2026-11-12）

文件：`mobile/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png`

| 要求 | 结果 |
|---|---|
| 1024 × 1024 像素 | ✅ 1024 × 1024 |
| 不能有透明通道 | ✅ RGB，无 alpha |
| 不要自己切圆角（系统会切） | ✅ 方形，四角是米色背景 `#f4efe6` |
| 一张"universal"图，Xcode 自动生成各尺寸 | ✅ `Contents.json` 是单尺寸 universal，Release 编译后生成了 60pt 等尺寸 |
| 图标和 App 名字一致、不误导（2.3.8） | ✅ 两条交扣的红蓝线（拉钩），没有文字 |
| 适合所有年龄 | ✅ |
| 深色 / 着色图标（iOS 18+ 可选） | 未提供，可选；不提供时系统自动处理 |

安卓图标和两边的启动图还是 Capacitor 默认的（`mobile/README.md` 已注明），不影响 iOS 审核。
