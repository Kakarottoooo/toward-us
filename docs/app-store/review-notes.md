# App Review notes and demo accounts

Paste the **Notes** block into App Store Connect → App Review Information → Notes, and the account into Sign-In Information. Everything below uses fictional people. The founder creates the two accounts on the production server before submitting (steps at the end, in Chinese).

## Sign-in information

- User name: `appreview.mia@<production-domain-or-mailbox>`
- Password: (the founder sets it; at least 10 characters; never commit it)

## Notes (English, paste as is after filling the two placeholders)

```
Pinky is a private relationship assistant for one person, which becomes a shared assistant for a couple once two accounts connect.

DEMO ACCOUNTS (fictional people, already connected to each other)
- Mia: appreview.mia@<domain>  /  password in Sign-In Information
- Leo: appreview.leo@<domain>  /  same password
Sign in as Mia. "Just me" is Mia's private chat with Pinky; "Us" is the shared chat that Leo also sees. To see the two-person flow, sign in as Leo on a second device or after signing out.

THINGS TO TRY
1. Just me: type or say "Leo forgot our anniversary dinner, how do I bring it up?" Pinky replies privately; Leo never sees it.
2. Us: "@Pinky help us plan Saturday dinner under $80". Pinky drafts a plan; an agreement only counts after both approve the same version.
3. Settings (menu, top left) → Report or get help: report the partner's content or a Pinky reply. Settings → Leave this relationship blocks the partner immediately.
4. Settings → Delete account: deletes the account in the app (password confirmation).
5. Settings → AI and data processors: names the third-party AI providers and lets the user withdraw consent.

THIRD-PARTY AI (5.1.2(i))
Pinky sends the text, voice and photos a user gives it to OpenAI and Anthropic to generate replies and transcribe voice. The sign-up screen states this directly above the "Create account" button; accounts created before see a one-time consent screen. Consent can be withdrawn in Settings. No tracking, no ads.

NATIVE FEATURES (beyond the web content)
- "Find photos of you two": on-device Vision face matching across the photo library; face data never leaves the phone, only photos the user picks are uploaded.
- Share a WhatsApp/WeChat chat export or a text file to Pinky from the share sheet to import it privately.
- Live voice input with the microphone.
- Offline screen bundled in the app when the server is unreachable.

USER-GENERATED CONTENT (1.2)
Content is only shared between two people who invited each other with a code; there is no public feed or stranger matching. Reports go to our team and are handled within 24 hours. Contact: see the Support URL.

PURCHASES
<choose one before submitting>
(a) This version has no in-app purchases; membership is not offered in the iPhone app.
(b) Pinky membership (auto-renewing, monthly / yearly) and outfits are sold with In-App Purchase only; Restore Purchases is in Settings → Pinky membership.

The app is for adults (18+). It is not therapy or medical advice; in danger it points users to local emergency services.
```

## 给创始人：建审核账号（约 5 分钟，在正式服务器上）

1. 用两个你能收信的邮箱（例如 `xxx+mia@…`、`xxx+leo@…`）在 App 里各注册一次：名字填 **Mia**、**Leo**，密码一样、至少 10 位，写进 App Store Connect 的登录信息里，**不要提交到仓库**。
2. Mia 登录 → 我们俩 → 复制邀请码；Leo 登录 → 输入 TA 的邀请码，两人连上。
3. 用 Mia 在"只有我"里说一两句（可以用上面"THINGS TO TRY"第 1 条），在"我们俩"里 @Pinky 一次，让审核员一进来就能看到内容。都是虚构的人和事，**不要用你自己的账号或真实联系人**。
4. 这两个账号不要用内测码，不要设成 `FOUNDER_EMAILS`、`AI_PAID_USERS`。
5. 审核期间保持服务器开着；审核通过后也保留这两个账号，以后每次更新都要用。
