import { AsyncLocalStorage } from "node:async_hooks";
import { renderReply } from "./reply-contract.mjs";

const responses = new AsyncLocalStorage();
export const chatSignal = () => responses.getStore();
export const withChatSignal = (signal, action) => responses.run(signal, action);

export async function withChatRequest(res, action) {
  const controller = new AbortController();
  const close = () => { if (!res.writableEnded) controller.abort(); };
  res.once("close", close);
  try { return await responses.run(controller.signal, action); }
  finally { res.off("close", close); }
}

// Use the existing text-only rewrite call. Regenerating a receipt must never repeat its actions.
export async function regenerateChatReply(mediator, request, reply, language, scope = "me") {
  const result = await mediator.rewriteReply({ request: request.text, reply: reply.text,
    sources: [{ kind: "previous_reply", text: reply.text }],
    issues: ["Answer the original request from a different angle. Offer a concrete alternative instead of paraphrasing the rejected advice. Preserve facts, existing action receipts and boundaries."] }, language, scope);
  const text = renderReply(result).trim();
  if (!text) throw Object.assign(new Error("No reply was produced."), { statusCode: 502 });
  chatSignal()?.throwIfAborted();
  return text;
}
