# Pinky App Store 上架材料包

全部是虚构示例数据（Mia / Leo、小雨 / 阿杰、Lucía / Mateo），不含任何真实用户内容。

| 文件 | 内容 |
|---|---|
| [checklist.zh-CN.md](checklist.zh-CN.md) | 给创始人的清单：已完成 / 等 Apple 账号 / 需要你决定 |
| [audit.zh-CN.md](audit.zh-CN.md) | 对照 Apple 审核指南逐条的风险审计（证据和修复） |
| [metadata.zh-Hans.md](metadata.zh-Hans.md)、[metadata.en.md](metadata.en.md)、[metadata.es.md](metadata.es.md) | 名称、副标题、关键词、描述、推广文本、新内容 |
| [review-notes.md](review-notes.md) | 审核备注（英文，直接粘贴）和审核账号的建法 |
| [privacy-nutrition-label.md](privacy-nutrition-label.md) | App 隐私问卷答案（和包里的隐私清单一一对应） |
| [age-rating.md](age-rating.md) | 年龄分级问卷答案 |
| [export-compliance.md](export-compliance.md) | 出口合规 |
| [urls-and-icon.md](urls-and-icon.md) | 隐私 / 支持 / 营销网址，图标检查 |
| [screenshots/](screenshots/) | iPhone 截图：`<语言>/6.3/`（1206×2622，必需）和 `<语言>/6.9/`（1320×2868） |

重新生成截图（UI 改了之后）：

```bash
node tools/app-store/screenshots.mjs
```

它会在本机起一个临时服务器（临时数据文件，不碰内测数据），用虚构账号走一遍真实界面，Pinky 的回复走本机 Claude 订阅（`AI_PROVIDER=claude-cli`），不调用付费 API。

`tests/app-store-package.test.mjs` 检查字段长度、隐私答案和清单一致、截图尺寸。
