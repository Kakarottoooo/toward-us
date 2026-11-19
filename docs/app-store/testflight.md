# Internal TestFlight release sheet

## App Store Connect fields

| Field | Value for the US launch |
|---|---|
| Platform and bundle ID | iOS · `us.toward.app` |
| Primary language and storefront | English (U.S.) · United States |
| Version, price and release | 1.0 · Free · Manually release this version |
| Primary category (proposed) | Lifestyle |
| SKU (proposed at record creation) | WT-IOS-REL-001 |
| Copyright | 2026 Witnora, Inc. |
| Feedback email | ziwei@witnora.com |
| Distribution | Internal TestFlight group with manual build selection and only designated company testers |

Create the record with the approved new name. The current company-signed build 2611.19.5 is the pre-rename reference. Archive and export a new build with the selected icon and a higher build number. Wait for the migrated public backend and device verification before the first internal upload. After Apple processes it, assign that exact build to the internal group. App Review uses the build verified through TestFlight. The founder controls public release.

## English (U.S.)

**Beta App Description**

A private space for adults to think through relationship questions, with an optional shared space for partners to plan together. Each person can talk privately before choosing what to share.

**What to Test**

1. Open the app on a fresh install. Check that the headline and start button are readable in English. Switch languages and reopen the app to see whether your choice is remembered.
2. Use a fictional adult account. Check that registration and permission to use third-party AI are separate. Try declining the AI request, then granting permission when you want a reply.
3. With the two paired demo accounts, write a private message as Mia and open Leo’s account. Check what Leo can see. In the shared chat, propose a dinner plan and approve the same version from both accounts.
4. Add the Home Screen widget. Tap it to open the app. Report the language, iPhone model and last action if anything looks wrong. Use fictional messages and photos in feedback.

## Español

**Descripción beta**

Un espacio privado para adultos que quieren pensar cómo hablar con su pareja. Al vincular sus cuentas, ambos pueden hacer planes en un chat compartido y elegir qué compartir.

**Qué probar**

Comprueba que la primera pantalla aparece en inglés. Elige español y vuelve a abrir la app. Con una cuenta ficticia, prueba el registro y el permiso para usar IA por separado. Escribe en privado como Mia y comprueba qué ve Leo. Propón un plan en el chat compartido y apruébalo desde las dos cuentas. Añade el widget y tócalo para abrir la app. Incluye el modelo del iPhone y el último paso en tus comentarios.

## 简体中文

**Beta 版描述**

成年人可以私下整理恋爱中的想法。双方连接账号后，也可以一起商量计划，各自决定哪些内容可以分享。

**测试重点**

首次打开应显示英文，切换中文后重新打开应保留选择。用虚构账号体验注册和单独的第三方 AI 授权。以 Mia 身份发一条私聊，再登录 Leo 查看他能看到的内容。到共同聊天提出一个计划，用两个账号确认同一版本。添加桌面小组件，点按打开 App。反馈时请写明 iPhone 型号、界面语言和出问题前的操作。

## Review handoff

Review credentials and the reviewer walkthrough are in [review-notes.md](review-notes.md). Retrieve passwords only when populating Apple's private fields. Use the designated review contact's first name, last name, reachable phone with country code and email in the private contact fields. The designated contact is saved in the company signing Mac keychain under service `Pinky US App Review Contact`, account `Apple App Review` (hex-encoded UTF-8 JSON). Transfer those values directly to Apple’s private form. The guide to product privacy, age rating, export compliance and localized screenshots is in [README.md](README.md).

[Apple’s TestFlight information fields](https://developer.apple.com/help/app-store-connect/test-a-beta-version/provide-test-information/)
