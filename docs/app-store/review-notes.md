# App Review notes and demo accounts

Paste the **Notes** block into App Store Connect → App Review Information → Notes, and the account into Sign-In Information. Everything below uses fictional people. The two review accounts are provisioned on the production server.

## Sign-in information

- User name: `ziwei+pinky-review-mia@witnora.com`
- Password: retrieve from the company release keychain

## Notes (English, paste as is after inserting the private Leo password)

```
Ourever is a private relationship assistant for one person, which becomes a shared assistant for a couple once two accounts connect.

DEMO ACCOUNTS (fictional people, already connected to each other)
- Mia: ziwei+pinky-review-mia@witnora.com  /  password in Sign-In Information
- Leo: ziwei+pinky-review-leo@witnora.com  /  insert the separate Leo password in private review notes
Sign in as Mia. "Just me" is Mia's private chat with Ourever; "Us" is the shared chat that Leo also sees. To see the two-person flow, sign in as Leo on a second device or after signing out.

THINGS TO TRY
1. Just me: type or say "Leo forgot our anniversary dinner, how do I bring it up?" Ourever replies privately; Leo never sees it.
2. Us: "@Ourever help us plan Saturday dinner under $80". Ourever drafts a plan; an agreement only counts after both approve the same version.
3. Settings (menu, top left) → Report or get help: report the partner's content or a Ourever reply. Settings → Leave this relationship blocks the partner immediately.
4. Settings → Delete account: deletes the account in the app (password confirmation).
5. Settings → AI and data processors: names the third-party AI providers and lets the user withdraw consent.

THIRD-PARTY AI (5.1.2(i))
With permission, relevant messages (including imported chats), selected photos, screenshots and voice may be processed by OpenAI or Anthropic for replies, image understanding or transcription. OpenAI also screens relevant text and images for safety. If the user chooses to animate a character, Replicate receives the processed character image. Creating an account and granting permission for third-party AI are separate steps. The consent screen identifies the processors and data involved. Consent can be withdrawn in Settings. No tracking, no ads.

NATIVE FEATURES (beyond the web content)
- "Find photos of you two": on-device Vision face matching across the photo library; face data never leaves the phone, only photos the user picks are uploaded.
- Share a WhatsApp/WeChat chat export or a text file to Ourever from the share sheet to import it privately.
- Live voice input with the microphone.
- A Home Screen widget and an offline screen bundled with the app.

USER-GENERATED CONTENT (1.2)
Content is only shared between two people who invited each other with a code; there is no public feed or stranger matching. Reports go to the team for review. Contact: ziwei@witnora.com.

PURCHASES
This iPhone release is free and offers no purchases.

The app is for adults (18+). It is not therapy or medical advice; in danger it points users to local emergency services.
```

## 审核登录信息

Mia 和 Leo 是正式服务器上的虚构账号，已验证可登录并已互相连接。两份独立密码保存在公司签名 Mac 钥匙串的 `Pinky US App Review` 项，按上方两个账号邮箱查找。提交时把 Mia 密码填入私有 Sign-In Information，Leo 的登录资料仅填审核员可见的备注。公开商店文案不含凭据。
