// Public pages App Review and every user can open without signing in (App Review 5.1.1(i), 1.2, 1.5): the privacy
// policy, the terms of use and support. In Simplified Chinese, English and Spanish (?lang=zh|en|es, else the browser's
// language). The contact address and the operator's name come from the environment so nothing here is a placeholder:
//   PINKY_SUPPORT_EMAIL  the address people write to (support, privacy requests, reports)
//   PINKY_OPERATOR       company operating Ourever (defaults to Witnora, Inc.)
// What the policy says must stay true to the code: update it with any change to what is collected or who processes it.
export const LEGAL_PAGES = ["privacy", "terms", "support"];
const UPDATED = "2026-11-18";

const escape = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

function contactLine(language, email) {
  if (email) return { zh: `写信给 <a href="mailto:${escape(email)}">${escape(email)}</a>，我们会在 2 个工作日内回复。`, en: `Email <a href="mailto:${escape(email)}">${escape(email)}</a>. We reply within 2 business days.`, es: `Escribe a <a href="mailto:${escape(email)}">${escape(email)}</a>. Respondemos en 2 días hábiles.` }[language];
  return { zh: "在 App 里打开“设置 → 举报或求助”写给我们，我们会在 2 个工作日内回复。", en: "In the app, open Settings → Report or get help and write to us. We reply within 2 business days.", es: "En la app, abre Ajustes → Denunciar o pedir ayuda y escríbenos. Respondemos en 2 días hábiles." }[language];
}

function content(page, language, { email, operator }) {
  const contact = contactLine(language, email);
  const op = escape(operator);
  const T = {
    privacy: {
      zh: { title: "Ourever 隐私政策", sections: [
        ["我们是谁", [`Ourever 由 ${op} 运营。Ourever 是一个私人的关系助手：先做你一个人的教练，你和另一半连接后，也是你们俩共同的助手。`]],
        ["我们收集什么", [
          "账号：你的名字（显示名）、邮箱、加密保存的密码；如果你绑定了手机号用 iMessage 和 Ourever 聊天，还有手机号。",
          "你主动给 Ourever 的内容：你打字或说出的话（语音会转成文字）、你选择发送或连接的照片和相册信息（拍摄时间、地点坐标）、你导入的聊天记录、提醒、约定、记忆、经期记录等。",
          "使用情况：功能使用、每天 AI 请求次数、打开次数、前后台切换和使用时长。已登录活跃度按账号汇总。崩溃摘要由 Apple MetricKit 送到 Ourever，单独保存，不含账号或聊天。",
          "付款：会员或装扮的购买记录（由 Apple 或 Stripe 处理，我们看不到你的卡号）。",
          "反馈与举报：你写给我们的内容和截图。",
          "“找出你们俩的合照”只在手机上比对人脸，人脸特征不会上传；只有你选中的照片才会上传。"]],
        ["我们怎么用", ["只用来提供和改进 Ourever 本身：回答你、记住你让它记住的事、提醒你、帮你们俩一起做决定。我们不卖你的数据，不做广告，不跨 App 追踪你。"]],
        ["私人与共享", ["你在“只有我”里的一切只有你能看到，另一半永远看不到。只有你确认过的“可共享摘要”才会进入你们俩共同的对话；约定要你们两人都同意同一个版本才算数。经期记录只属于你；即使你选择让对方知道，对方也只会收到一句“这几天多照顾 TA 一点”，看不到日期和原因。"]],
        ["第三方 AI 和其他处理方", [
          "注册账号后，Ourever 会单独询问第三方 AI 授权。相关聊天记录、他人的导入消息、截图、所选照片及语音可发送给 OpenAI 或 Anthropic，以生成回复、转录及理解图片。OpenAI 还对相关文字和图片进行安全审核。选择制作动态角色时，处理后的角色图片发送给 Replicate。你可以在设置中撤回。",
          "其他处理方：云服务器和数据库托管商（存放数据）；Apple、Google 的推送服务（发通知）；Resend（发重设密码邮件）；Sendblue 和 Apple（仅当你用 iMessage 和 Ourever 聊天）；Apple 和 Stripe（付款）。我们只给它们完成该项工作所需的数据，并要求它们提供不低于本政策的保护。"]],
        ["保留与删除", ["私人内容默认保留到你自己删除，你也可以在“设置 → 私人内容保留”里改成 7、30、90 或 365 天没更新就自动删除。“设置 → 下载我的数据”可以导出全部数据；“删除我的私人内容”立即删除私人内容；“删除账号”立即删除账号、私人内容、私人照片和导入的聊天记录，并让你退出关系。你在“我们俩”里说过的话会留给对方。"]],
        ["撤回同意", ["你可以随时撤回第三方 AI 同意（设置 → AI 与数据处理方），撤回后 Ourever 不再把你的内容发给 AI，需要重新同意才能继续使用 AI 功能。也可以随时退出关系、删除内容或删除账号，都不需要对方批准。"]],
        ["儿童", ["Ourever 只面向 18 岁及以上的人，我们不会有意收集未成年人的数据。"]],
        ["安全", ["数据全程 HTTPS 传输；密码只保存加密后的散列；每个对象都记录可见范围，服务器按人返回，不依赖前端隐藏。"]],
        ["联系我们", [contact]]] },
      en: { title: "Ourever Privacy Policy", sections: [
        ["Who we are", [`Ourever is operated by ${op}. Ourever is a private relationship assistant: first a coach for you alone, and, once you connect with a partner, a shared assistant for the two of you.`]],
        ["What we collect", [
          "Account: your display name, email and a hashed password; if you link a phone number to talk to Ourever over iMessage, that number.",
          "What you give Ourever: what you type or say (voice is turned into text), photos you choose to send or connect and their album details (when and where they were taken), chat history you import, reminders, agreements, memories, cycle entries and the like.",
          "Usage: feature use, daily AI requests, launches, foreground sessions and time spent. Signed-in activity is counted by account. Ourever stores Apple MetricKit crash summaries separately without account identifiers or chat content.",
          "Payments: records of membership or outfit purchases (processed by Apple or Stripe; we never see your card number).",
          "Feedback and reports: what you write to us and any screenshots.",
          "“Find photos of you two” compares faces on your phone only; face data is never uploaded, only the photos you pick."]],
        ["How we use it", ["Only to provide and improve Ourever itself: to answer you, remember what you ask it to, remind you and help the two of you decide together. We do not sell your data, show ads or track you across apps."]],
        ["Private and shared", ["Everything in Just me is visible only to you; your partner never sees it. Only a summary you confirm as shareable enters the shared conversation, and an agreement counts only when both of you approve the same version. Cycle entries are yours alone; even if you choose to let your partner know, they only get a note to take extra care of you these days, with no dates and no reason."]],
        ["Third-party AI and other processors", [
          "After signup, Ourever separately asks permission for third-party AI. Relevant chats (including imported messages from others), screenshots, selected photos and voice may go to OpenAI or Anthropic for replies, transcription and image understanding. OpenAI also screens relevant text and images for safety. If you animate a character, the processed image is sent to Replicate. You can withdraw in Settings.",
          "Other processors: our cloud server and database host (stores data); Apple and Google push services (notifications); Resend (password-reset email); Sendblue and Apple (only if you talk to Ourever over iMessage); Apple and Stripe (payments). Each receives only what its job needs, and we require protection at least equal to this policy."]],
        ["Retention and deletion", ["Private content stays until you delete it, or you can choose in Settings → Keep private content to delete it after 7, 30, 90 or 365 days without changes. Settings → Download my data exports everything; Delete my private content removes it at once; Delete account immediately removes your account, private content, private photos and imported chats, and ends your relationship space. What you wrote in Us stays for your partner."]],
        ["Withdrawing consent", ["You can withdraw third-party AI consent at any time (Settings → AI and data processors); Ourever then stops sending your content to AI until you agree again. You can also leave a relationship, delete content or delete your account at any time, without your partner's approval."]],
        ["Children", ["Ourever is only for people 18 and older. We do not knowingly collect data from minors."]],
        ["Security", ["All traffic uses HTTPS; passwords are stored only as hashes; every object records who may see it and the server returns each person only what they may see, never relying on the app to hide it."]],
        ["Contact", [contact]]] },
      es: { title: "Política de privacidad de Ourever", sections: [
        ["Quiénes somos", [`Ourever lo opera ${op}. Ourever es un asistente privado de pareja: primero un coach solo para ti y, cuando te conectas con tu pareja, un asistente compartido para los dos.`]],
        ["Qué recopilamos", [
          "Cuenta: tu nombre visible, tu correo y una contraseña cifrada; si vinculas un teléfono para hablar con Ourever por iMessage, ese número.",
          "Lo que le das a Ourever: lo que escribes o dices (la voz se convierte en texto), las fotos que eliges enviar o conectar y sus datos de álbum (cuándo y dónde se tomaron), los chats que importas, recordatorios, acuerdos, recuerdos, registros del ciclo y similares.",
          "Uso: funciones, peticiones diarias de IA, aperturas, sesiones y duración. La actividad con sesión iniciada se cuenta por cuenta. Ourever guarda por separado resúmenes de fallos de Apple MetricKit sin cuentas ni chats.",
          "Pagos: registros de compras de membresía o atuendos (los procesan Apple o Stripe; nunca vemos tu tarjeta).",
          "Comentarios y denuncias: lo que nos escribes y las capturas que adjuntas.",
          "“Encontrar fotos de los dos” compara caras solo en tu teléfono; los datos faciales nunca se suben, solo las fotos que eliges."]],
        ["Cómo lo usamos", ["Solo para ofrecer y mejorar Ourever: responderte, recordar lo que le pides, avisarte y ayudar a los dos a decidir juntos. No vendemos tus datos, no mostramos anuncios ni te rastreamos entre apps."]],
        ["Privado y compartido", ["Todo lo de Solo yo lo ves solo tú; tu pareja nunca lo ve. Solo un resumen que confirmas como compartible entra en la conversación común, y un acuerdo cuenta solo cuando los dos aprueban la misma versión. El registro del ciclo es solo tuyo; aunque elijas avisar a tu pareja, solo recibe una nota para cuidarte más estos días, sin fechas ni motivo."]],
        ["IA de terceros y otros encargados", [
          "Después de registrarte, Ourever solicita permiso específico para usar IA de terceros. Los chats pertinentes (incluidos mensajes importados de otras personas), capturas, fotos elegidas y voz pueden enviarse a OpenAI o Anthropic para responder, transcribir e interpretar imágenes. OpenAI también revisa el texto y las imágenes por seguridad. Si animas un personaje, la imagen procesada se envía a Replicate. Puedes retirar el permiso en Ajustes.",
          "Otros encargados: nuestro proveedor de servidor y base de datos (almacena los datos); los servicios de notificaciones de Apple y Google; Resend (correo para restablecer la contraseña); Sendblue y Apple (solo si hablas con Ourever por iMessage); Apple y Stripe (pagos). Cada uno recibe solo lo necesario para su tarea y les exigimos una protección al menos igual a esta política."]],
        ["Conservación y borrado", ["Lo privado se conserva hasta que lo borres, o puedes elegir en Ajustes → Conservar lo privado que se borre tras 7, 30, 90 o 365 días sin cambios. Ajustes → Descargar mis datos lo exporta todo; Borrar mi contenido privado lo elimina al instante; Borrar la cuenta elimina de inmediato tu cuenta, lo privado, las fotos privadas y los chats importados, y termina el espacio de pareja. Lo que escribiste en Nosotros queda para tu pareja."]],
        ["Retirar el consentimiento", ["Puedes retirar el consentimiento de IA de terceros en cualquier momento (Ajustes → IA y encargados de datos); Ourever deja de enviar tu contenido a la IA hasta que vuelvas a aceptar. También puedes salir de una relación, borrar contenido o borrar tu cuenta cuando quieras, sin la aprobación de tu pareja."]],
        ["Menores", ["Ourever es solo para mayores de 18 años. No recopilamos a sabiendas datos de menores."]],
        ["Seguridad", ["Todo viaja por HTTPS; las contraseñas se guardan solo como hash; cada objeto registra quién puede verlo y el servidor devuelve a cada persona solo lo suyo, sin depender de que la app lo oculte."]],
        ["Contacto", [contact]]] },
    },
    terms: {
      zh: { title: "Ourever 使用条款", sections: [
        ["接受条款", [`使用 Ourever 即表示你同意这些条款和《隐私政策》。Ourever 由 ${op} 提供。`]],
        ["谁可以用", ["你需要年满 18 岁。每个账号只属于一个人，请保管好密码和恢复码。"]],
        ["AI 生成的内容", ["Ourever 的回复、建议、摘要和草稿由 AI 生成，可能出错。它不是心理咨询、医疗、法律或财务建议；遇到危险或紧急情况，请联系当地紧急服务。重要的事请自己核实。"]],
        ["你的内容", ["你发给 Ourever 的内容属于你。你授权我们为了提供服务而存储和处理它（包括交给《隐私政策》里列出的 AI 服务处理）。请只上传你有权分享的内容。"]],
        ["行为规范", ["不得用 Ourever 骚扰、威胁、欺凌或伤害他人；不得上传色情、暴力、仇恨或违法内容；不得未经同意上传他人的私密影像；不得冒充他人或尝试访问别人的数据。我们收到举报后会在 24 小时内处理，并可删除违规内容、暂停或终止账号。"]],
        ["举报与屏蔽", ["在“设置 → 举报或求助”可以举报对方发的内容或 Ourever 的回复。在“设置 → 退出当前关系”可以立即结束连接，对方将无法再看到你或给你发消息，不需要对方同意。"]],
        ["终止", ["你可以随时在设置里删除账号。我们可能因为违反条款而暂停或终止账号。"]],
        ["免责与责任限制", ["Ourever 按现状提供。在法律允许的最大范围内，我们不对间接损失负责。"]],
        ["变更", ["条款有重要变化时我们会在 App 里告知。继续使用即表示接受新条款。"]],
        ["联系我们", [contact]]] },
      en: { title: "Ourever Terms of Use", sections: [
        ["Accepting these terms", [`By using Ourever you agree to these terms and the Privacy Policy. Ourever is provided by ${op}.`]],
        ["Who can use Ourever", ["You must be 18 or older. Each account belongs to one person; keep your password and recovery code safe."]],
        ["AI-generated content", ["Ourever's replies, suggestions, summaries and drafts are generated by AI and can be wrong. They are not therapy, medical, legal or financial advice; in danger or an emergency, contact your local emergency services. Check anything important yourself."]],
        ["Your content", ["What you give Ourever is yours. You let us store and process it to provide the service (including by the AI providers named in the Privacy Policy). Only upload content you have the right to share."]],
        ["Conduct", ["Do not use Ourever to harass, threaten, bully or harm anyone; do not upload sexual, violent, hateful or illegal content; do not upload intimate images of anyone without their consent; do not impersonate others or try to reach anyone else's data. We act on reports within 24 hours and may remove content and suspend or end accounts that break these rules."]],
        ["Reporting and blocking", ["In Settings → Report or get help you can report content from your partner or a reply from Ourever. In Settings → Leave this relationship you can end the connection at once; the other person can no longer see you or message you, and no approval is needed."]],
        ["Ending", ["You can delete your account in Settings at any time. We may suspend or end an account that breaks these terms."]],
        ["Disclaimer and limits", ["Ourever is provided as is. To the extent the law allows, we are not liable for indirect losses."]],
        ["Changes", ["We will tell you in the app about important changes. Using Ourever afterwards means you accept them."]],
        ["Contact", [contact]]] },
      es: { title: "Condiciones de uso de Ourever", sections: [
        ["Aceptación", [`Al usar Ourever aceptas estas condiciones y la Política de privacidad. Ourever lo ofrece ${op}.`]],
        ["Quién puede usarlo", ["Debes tener 18 años o más. Cada cuenta es de una sola persona; guarda bien tu contraseña y tu código de recuperación."]],
        ["Contenido generado por IA", ["Las respuestas, sugerencias, resúmenes y borradores de Ourever los genera una IA y pueden equivocarse. No son terapia ni consejo médico, legal o financiero; ante un peligro o una emergencia, llama a los servicios de emergencia locales. Comprueba tú mismo lo importante."]],
        ["Tu contenido", ["Lo que le das a Ourever es tuyo. Nos permites guardarlo y procesarlo para dar el servicio (también mediante los proveedores de IA indicados en la Política de privacidad). Sube solo contenido que tengas derecho a compartir."]],
        ["Normas de conducta", ["No uses Ourever para acosar, amenazar, intimidar o dañar a nadie; no subas contenido sexual, violento, de odio o ilegal; no subas imágenes íntimas de nadie sin su consentimiento; no te hagas pasar por otra persona ni intentes acceder a datos ajenos. Atendemos las denuncias en 24 horas y podemos retirar contenido y suspender o cerrar cuentas que incumplan estas normas."]],
        ["Denunciar y bloquear", ["En Ajustes → Denunciar o pedir ayuda puedes denunciar contenido de tu pareja o una respuesta de Ourever. En Ajustes → Salir de esta relación terminas la conexión al instante; la otra persona ya no puede verte ni escribirte, sin necesidad de su aprobación."]],
        ["Terminación", ["Puedes borrar tu cuenta en Ajustes cuando quieras. Podemos suspender o cerrar una cuenta que incumpla estas condiciones."]],
        ["Exención y límites", ["Ourever se ofrece tal cual. En la medida que la ley permita, no respondemos de pérdidas indirectas."]],
        ["Cambios", ["Te avisaremos en la app de los cambios importantes. Seguir usando Ourever significa que los aceptas."]],
        ["Contacto", [contact]]] },
    },
    support: {
      zh: { title: "Ourever 帮助与支持", sections: [
        ["联系我们", [contact]],
        ["举报内容或用户", ["在 App 里打开“设置 → 举报或求助”，选择要举报的是对方的内容还是 Ourever 的回复，写下发生了什么。我们会在 24 小时内处理。需要立刻停止联系时，在“设置 → 退出当前关系”结束连接，对方将无法再看到你或给你发消息。"]],
        ["删除账号和数据", ["“设置 → 删除账号”会立即删除你的账号和私人内容。“设置 → 下载我的数据”可以先导出一份。"]],
        ["忘记密码", ["在登录页点“使用恢复码找回账号”，或使用邮件重设密码（如果已开通）。"]],
        ["紧急情况", ["Ourever 不是紧急服务。如果你或别人有危险，请立刻联系当地的紧急电话。"]]] },
      en: { title: "Ourever Help and Support", sections: [
        ["Contact us", [contact]],
        ["Report content or a person", ["In the app, open Settings → Report or get help, choose whether it is about your partner's content or a reply from Ourever, and tell us what happened. We act within 24 hours. To stop contact right away, use Settings → Leave this relationship; the other person can no longer see you or message you."]],
        ["Delete your account and data", ["Settings → Delete account removes your account and private content immediately. Settings → Download my data gives you a copy first."]],
        ["Forgot your password", ["On the sign-in screen tap “Recover with a recovery code”, or reset it by email where available."]],
        ["Emergencies", ["Ourever is not an emergency service. If you or someone else is in danger, call your local emergency number now."]]] },
      es: { title: "Ayuda y soporte de Ourever", sections: [
        ["Contacto", [contact]],
        ["Denunciar contenido o a una persona", ["En la app, abre Ajustes → Denunciar o pedir ayuda, elige si se trata de contenido de tu pareja o de una respuesta de Ourever y cuéntanos qué pasó. Lo atendemos en 24 horas. Para cortar el contacto al instante, usa Ajustes → Salir de esta relación; la otra persona ya no puede verte ni escribirte."]],
        ["Borrar la cuenta y los datos", ["Ajustes → Borrar la cuenta elimina tu cuenta y lo privado al instante. Ajustes → Descargar mis datos te da una copia antes."]],
        ["Olvidé la contraseña", ["En la pantalla de inicio toca “Recuperar con un código”, o restablécela por correo si está disponible."]],
        ["Emergencias", ["Ourever no es un servicio de emergencias. Si tú u otra persona están en peligro, llama ya al número de emergencias local."]]] },
    },
  };
  return T[page][language];
}

const NAV = { zh: { back: "返回 Ourever", updated: "更新于", privacy: "隐私政策", terms: "使用条款", support: "帮助与支持" }, en: { back: "Back to Ourever", updated: "Updated", privacy: "Privacy", terms: "Terms", support: "Support" }, es: { back: "Volver a Ourever", updated: "Actualizado", privacy: "Privacidad", terms: "Condiciones", support: "Ayuda" } };

export function renderLegalPage(page, language, env = process.env, standalone = false) {
  const operator = String(env.PINKY_OPERATOR || "").trim() || "Witnora, Inc.";
  const { title, sections } = content(page, language, { email: String(env.PINKY_SUPPORT_EMAIL || "").trim() || "ziwei@witnora.com", operator });
  const nav = NAV[language];
  const pageUrl = (name, code) => standalone
    ? `/${code === "en" ? "" : code + "/"}${name}`
    : `/${name}?lang=${code}`;
  const homeUrl = standalone && language !== "en" ? `/${language}/` : "/";
  const links = LEGAL_PAGES.map((name) => name === page ? `<strong>${nav[name]}</strong>` : `<a href="${pageUrl(name, language)}">${nav[name]}</a>`).join(" · ");
  const languages = ["zh", "en", "es"].map((code) => code === language ? `<strong>${code.toUpperCase()}</strong>` : `<a href="${pageUrl(page, code)}">${code.toUpperCase()}</a>`).join(" / ");
  // Inside the app there is no browser back button: go back if there is history, else to the app's home.
  return `<!doctype html><html lang="${language === "zh" ? "zh-Hans" : language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><title>${title}</title>
<style>body{margin:0;background:#f4efe6;color:#2b2622;font:17px/1.6 -apple-system,BlinkMacSystemFont,"PingFang SC","Helvetica Neue",sans-serif}main{max-width:680px;margin:0 auto;padding:max(20px,env(safe-area-inset-top)) 20px max(32px,env(safe-area-inset-bottom))}h1{font-size:26px;line-height:1.3;margin:18px 0 4px}h2{font-size:19px;margin:26px 0 6px}p{margin:0 0 10px}nav{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;font-size:15px}a{color:#b03a33}small{color:#6f655d}.back{display:inline-flex;align-items:center;min-height:44px;font-weight:600;text-decoration:none}</style></head>
<body><main data-testid="legal-${page}"><nav><a class="back" href="${homeUrl}"${standalone ? "" : ' onclick="if(history.length>1){history.back();return false}"'}>← ${nav.back}</a><span>${languages}</span></nav>
<h1>${title}</h1><small>${nav.updated} ${UPDATED}</small>
${sections.map(([heading, paragraphs]) => `<h2>${heading}</h2>${paragraphs.map((text) => `<p>${text}</p>`).join("")}`).join("\n")}
<p><small>${links}</small></p></main></body></html>`;
}
