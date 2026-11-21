const RESEND_URL = "https://api.resend.com/emails";
const TIMEOUT_MS = 15_000;

const resetCopy = {
  en: ["Reset your Ourever password", "Choose a new password using the link below. The link works once and expires in 30 minutes.", "Choose a new password", "If you did not request a reset, you can ignore this email."],
  es: ["Restablece tu contraseña de Ourever", "Elige una contraseña nueva con el enlace de abajo. Solo puede usarse una vez y caduca en 30 minutos.", "Elegir una contraseña nueva", "Si no solicitaste este cambio, puedes ignorar este correo."],
  zh: ["重设你的 Ourever 密码", "请使用下方链接设置新密码。链接 30 分钟内有效，只能使用一次。", "设置新密码", "如果你没有申请重设密码，请忽略这封邮件。"],
};

export function resetMessage(language, link) {
  const [subject, instructions, action, footer] = resetCopy[language] || resetCopy.zh;
  const href = link.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  return {
    subject,
    text: `${subject}\n\n${instructions}\n\n${link}\n\n${footer}`,
    html: `<h1>${subject}</h1><p>${instructions}</p><p><a href="${href}" style="font-size:18px">${action}</a></p><p>${footer}</p>`,
  };
}

export function createEmailSender({ env = process.env, fetchImpl = globalThis.fetch, log = console } = {}) {
  const apiKey = String(env.RESEND_API_KEY || "").trim();
  const senderAddress = String(env.EMAIL_FROM || "").trim();
  const mailbox = senderAddress.match(/^[^<>\r\n]+<([^<>]+)>$/)?.[1] || senderAddress;
  const from = `Ourever <${mailbox}>`;
  const configured = Boolean(apiKey) && /^[^@\s<>,;]+@[^@\s<>,;]+\.[^@\s<>,;]+$/.test(mailbox);
  async function send({ to, subject, text, html }) {
    if (!configured) return { sent: false };
    try {
      const response = await fetchImpl(RESEND_URL, {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ from, to: [to], subject, text, ...(html ? { html } : {}) }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) { log.error(`[email] delivery failed with status ${response.status}`); return { sent: false }; }
      return { sent: true };
    } catch (error) {
      log.error(`[email] delivery failed (${error?.name === "TimeoutError" ? "timeout" : "network error"})`);
      return { sent: false };
    }
  }
  return { configured, send };
}
