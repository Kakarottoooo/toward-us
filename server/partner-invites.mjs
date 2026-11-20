// All stores project invite timestamps as ISO UTC strings.
export function invitationStatus(invite, now = new Date().toISOString()) {
  if (!invite) return "invalid";
  if (invite.acceptedAt) return "used";
  if (invite.cancelledAt) return "cancelled";
  return invite.expiresAt <= now ? "expired" : "open";
}

export function currentInvitation(context, code) {
  return context?.relationship.status === "pending" && context.invitation?.code === code;
}

export function partnerCode(value) {
  const code = typeof value === "string" ? value.trim().toUpperCase() : "";
  return /^[A-Z0-9]{8}$/.test(code) ? code : "";
}

const problems = {
  invite_invalid: ["找不到这个邀请。请检查邀请码，或请伴侣发送新链接。", "This invite could not be found. Check the code or ask your partner for a new link.", "No se encontró la invitación. Comprueba el código o pide a tu pareja un enlace nuevo."],
  invite_expired: ["邀请已过期。请伴侣发送新链接。", "This invite has expired. Ask your partner for a new link.", "La invitación caducó. Pide a tu pareja un enlace nuevo."],
  invite_cancelled: ["邀请已取消。请伴侣发送新链接。", "This invite was cancelled. Ask your partner for a new link.", "Se canceló la invitación. Pide a tu pareja un enlace nuevo."],
  invite_used: ["邀请已被使用。如果你已经加入，请打开“我们俩”。", "This invite has already been used. If you joined, open Us.", "La invitación ya se usó. Si te uniste, abre Nosotros."],
  invite_self: ["此邀请无效，因为这是你自己的链接。把它发给伴侣，或打开对方的邀请。", "This is your own invite. Send it to your partner or open theirs.", "Esta es tu propia invitación. Envíala a tu pareja o abre la suya."],
  already_paired: ["你已经与伴侣配对。请返回你们的共同空间，或在设置中管理连接。", "You already have a partner. Return to your shared space or manage your connection in Settings.", "Ya tienes pareja vinculada. Vuelve a su espacio compartido o gestiona la conexión en Ajustes."],
};

export function inviteProblem(code, language) {
  const translations = problems[code];
  return { code, error: translations[language === "zh" ? 0 : language === "es" ? 2 : 1] };
}
