# 网址与图标检查

## App Store Connect 要填的网址

独立品牌站已上线。三种语言的页面均已通过公网核对。

| App Store Connect 字段 | 英文默认网址 |
|---|---|
| Privacy Policy URL | https://ourever.onrender.com/privacy |
| Support URL | https://ourever.onrender.com/support |
| Marketing URL | https://ourever.onrender.com/ |
| Terms of Use | https://ourever.onrender.com/terms |

简体中文在路径前加 `/zh`，西语加 `/es`。公开支持邮箱为 ziwei@witnora.com，运营主体为 Witnora, Inc.。现有客户分享链接继续可用，另行决定公司子域名。

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
