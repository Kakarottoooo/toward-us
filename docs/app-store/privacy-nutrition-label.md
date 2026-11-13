# App 隐私（营养标签）问卷答案

App Store Connect → App 隐私。答案要和 `mobile/ios/App/App/PrivacyInfo.xcprivacy`、公开隐私政策 `/privacy` 一致；改了其中一个，三个一起改（`tests/app-store-package.test.mjs` 会检查清单和这里列的类型一一对应）。

## 第一问：你或第三方合作伙伴是否从这个 App 收集数据？

**是**。

## 追踪

- 是否用这些数据追踪用户（与其他公司的数据关联做广告，或分享给数据经纪人）？**否**，所有类型都选"不用于追踪"。
- 不需要 App Tracking Transparency 弹窗。

## 收集的数据类型（全部"与用户身份关联"、全部"不用于追踪"）

| App Store Connect 里的类型 | 清单里的键 | 用途 | 说明 |
|---|---|---|---|
| 联系信息 → 姓名 | `NSPrivacyCollectedDataTypeName` | App 功能 | 显示名 |
| 联系信息 → 电子邮件地址 | `NSPrivacyCollectedDataTypeEmailAddress` | App 功能 | 登录、重设密码 |
| 联系信息 → 电话号码 | `NSPrivacyCollectedDataTypePhoneNumber` | App 功能 | 只在用户绑定 iMessage 时 |
| 健康与健身 → 健康 | `NSPrivacyCollectedDataTypeHealth` | App 功能 | 经期记录（只属于本人） |
| 位置 → 精确位置 | `NSPrivacyCollectedDataTypePreciseLocation` | App 功能 | 只来自用户连接的相册照片里的拍摄坐标，用来写回忆地点；App 不读设备定位 |
| 用户内容 → 照片或视频 | `NSPrivacyCollectedDataTypePhotosorVideos` | App 功能 | 用户选择发送的照片 |
| 用户内容 → 音频数据 | `NSPrivacyCollectedDataTypeAudioData` | App 功能 | 语音输入转文字，不保存录音 |
| 用户内容 → 电子邮件或短信 | `NSPrivacyCollectedDataTypeEmailsOrTextMessages` | App 功能 | 用户导入的聊天记录 |
| 用户内容 → 其他用户内容 | `NSPrivacyCollectedDataTypeOtherUserContent` | App 功能 | 对话、约定、提醒、记忆 |
| 用户内容 → 客户支持 | `NSPrivacyCollectedDataTypeCustomerSupport` | App 功能 | 反馈和举报 |
| 标识符 → 用户 ID | `NSPrivacyCollectedDataTypeUserID` | App 功能 | 账号 ID |
| 购买 → 购买记录 | `NSPrivacyCollectedDataTypePurchaseHistory` | App 功能 | 会员和装扮（首版不带内购也可以先保留） |
| 使用数据 → 产品交互 | `NSPrivacyCollectedDataTypeProductInteraction` | 分析、App 功能 | 功能使用次数、每天 AI 次数，不含内容 |

## 不收集

精确/粗略设备定位、通讯录、浏览记录、搜索记录、设备 ID / 广告标识符、崩溃数据、性能数据、财务信息（卡号由 Apple / Stripe 处理）、敏感信息（人脸特征只在手机上，不上传）、其他诊断数据。

## 第三方 AI

营养标签没有单独的"AI"栏目；发给 OpenAI、Anthropic 的内容属于上表"用户内容"，由我们代为处理（App 功能），已在隐私政策和 App 内同意页写明（5.1.2(i)）。
