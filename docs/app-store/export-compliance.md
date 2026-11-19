# 出口合规（加密）

## 结论

Pinky 只用 Apple 系统提供的加密（WKWebView / URLSession 的 HTTPS、钥匙串以外不存密钥），没有自带或自写的加密算法，属于豁免情况。

`mobile/ios/App/App/Info.plist` 已写：

```xml
<key>ITSAppUsesNonExemptEncryption</key>
<false/>
```

所以每次上传构建版本后，App Store Connect 不会再弹出加密问题，可以直接提交 TestFlight 和审核。

## 如果 App Store Connect 仍然问（手动回答时）

| 问题 | 答案 |
|---|---|
| Does your app use encryption? | Yes（用了 HTTPS） |
| Does your app qualify for any of the exemptions provided in Category 5, Part 2 of the U.S. Export Administration Regulations? | Yes |
| 选择的豁免 | Only uses encryption that is exempt / limited to standard encryption within Apple's operating system (HTTPS) |
| 是否需要上传 CCATS / 法国申报 | 否 |

## 什么时候要重新看

将来加入端到端加密、自带加密库（例如 libsodium、OpenSSL 自定义算法）或 VPN 类功能时，要重新评估并可能改成 `true` 后提交文件。
