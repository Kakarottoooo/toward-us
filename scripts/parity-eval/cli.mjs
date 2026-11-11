import { runCliProcess } from "../../server/cli-process.mjs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { jsonObjects } from "../../server/claude-cli-client.mjs";
import { budgetedModelCall, claudeResult } from "../../server/model-call-budget.mjs";

// Authentication remains in the installed subscription CLIs. No auth/config file is read or copied.
export async function run(command, args, input, cwd, timeout = 180_000) {
  const started = performance.now();
  const stdout = await runCliProcess(command, args, input, cwd, timeout);
  return { stdout, ms: performance.now() - started };
}

export async function invoke(provider, { root, input, instructions, schema, image, search = false }) {
  const cwd = join(root, randomUUID());
  await mkdir(cwd, { recursive: true });
  const system = join(cwd, "instructions.txt");
  await writeFile(system, instructions);
  await writeFile(join(cwd, "input.json"), input);
  if (provider === "claude") {
    const args = ["-p", "--output-format", "json", "--model", "sonnet", "--no-session-persistence", "--strict-mcp-config", "--setting-sources", "project", "--disable-slash-commands", "--restricted", "--permission-mode", "dontAsk", "--system-prompt-file", system];
    const allowed = [search ? "WebSearch" : "", image ? "Read" : ""].filter(Boolean).join(",");
    args.push("--tools", allowed);
    if (allowed) args.push("--allowedTools", allowed);
    // Read is confined by --restricted to this per-call directory, which contains only synthetic inputs.
    let prompt = input;
    if (image) {
      const localImage = join(cwd, "input.png");
      await writeFile(localImage, await readFile(image));
      prompt += `\nAttached synthetic image: ${localImage}`;
    }
    if (schema) prompt += `\nReturn exactly one JSON object matching: ${JSON.stringify(schema)}`;
    const { stdout, ms } = await budgetedModelCall("claude", args, (bounded) => run("claude", bounded, prompt, cwd), search || image ? 6 : 1);
    await writeFile(join(cwd, "response.json"), stdout);
    const raw = claudeResult(stdout);
    if (raw.is_error) throw new Error("Claude subscription returned an error");
    const answer = String(raw.result || "");
    return { answer, value: schema ? jsonObjects(answer).at(-1) : null, ms, usage: raw.usage || null, usd: raw.total_cost_usd ?? null, model: Object.keys(raw.modelUsage || {}).join(",") || "sonnet (alias)", toolCalls: raw.num_turns ?? null };
  }
  const output = join(cwd, "answer.txt");
  const args = ["exec", "--ignore-user-config", "--skip-git-repo-check", "--ephemeral", "--sandbox", "read-only", "--json", "--color", "never", "-C", cwd,
    "-c", "project_doc_max_bytes=0", "-c", "features.shell_tool=false", "-c", "features.memories=false", "-c", "features.multi_agent=false",
    "-c", `web_search=\"${search ? "live" : "disabled"}\"`, "-c", `model_instructions_file=${JSON.stringify(system.replaceAll("\\", "/"))}`, "-o", output];
  if (schema) { const file = join(cwd, "schema.json"); await writeFile(file, JSON.stringify(schema)); args.push("--output-schema", file); }
  if (image) args.push("--image", image);
  args.push("-");
  // npm's Windows command wrapper is not spawn-able without a shell. Invoke its JS entry point directly.
  const command = process.platform === "win32" ? process.execPath : "codex";
  if (process.platform === "win32") args.unshift(join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), "npm", "node_modules", "@openai", "codex", "bin", "codex.js"));
  const { stdout, ms } = await budgetedModelCall("codex", args, (bounded) => run(command, bounded, input, cwd));
  await writeFile(join(cwd, "events.jsonl"), stdout);
  const events = stdout.split(/\r?\n/).filter(Boolean).flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } });
  if (events.some((event) => event.type === "turn.failed")) throw new Error("Codex subscription turn failed");
  const answer = await readFile(output, "utf8");
  return { answer, value: schema ? JSON.parse(answer) : null, ms, usage: events.findLast((event) => event.type === "turn.completed")?.usage || null, usd: null,
    model: "Codex CLI default (--ignore-user-config); not ChatGPT web", toolCalls: events.filter((event) => event.type === "item.completed" && !["agent_message", "reasoning"].includes(event.item?.type)).length };
}
