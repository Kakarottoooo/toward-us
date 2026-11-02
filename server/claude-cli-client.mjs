import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Local dogfooding only: answers the OpenAI `responses.create` text calls through the `claude` CLI signed in with the
// founder's Claude subscription. It never runs tools, keeps no session, and loads no user settings, hooks or MCP
// servers, so the founder's own Claude configuration cannot leak into product replies. Audio stays on OpenAI.
const TIMEOUT_MS = 180_000;

const textOf = (content) => typeof content === "string" ? content
  : Array.isArray(content) ? content.map((part) => part?.text || "").join("\n") : String(content ?? "");

export function createClaudeCliClient({ model = process.env.CLAUDE_CLI_MODEL || "haiku", command = process.env.CLAUDE_CLI_PATH || "claude" } = {}) {
  // An empty working folder keeps project CLAUDE.md files and settings out of the call.
  const cwd = join(tmpdir(), "pinky-claude-cli");
  mkdirSync(cwd, { recursive: true });

  return {
    model: `claude-cli:${model}`,
    responses: {
      async create(params) {
        const input = Array.isArray(params.input) ? params.input : [{ role: "user", content: params.input }];
        const system = [params.instructions, ...input.filter((item) => item.role === "developer" || item.role === "system").map((item) => textOf(item.content))].filter(Boolean).join("\n\n");
        const prompt = input.filter((item) => item.role === "user" || item.role === "assistant").map((item) => `${item.role === "assistant" ? "Assistant: " : ""}${textOf(item.content)}`).join("\n\n");
        const schema = params.text?.format?.type === "json_schema" ? params.text.format.schema : null;
        const args = ["-p", "--output-format", "json", "--model", model, "--tools", "", "--no-session-persistence", "--strict-mcp-config", "--setting-sources", "project"];
        if (system) args.push("--system-prompt", system);
        if (schema) args.push("--json-schema", JSON.stringify(schema));
        const stdout = await run(command, args, prompt, cwd);
        let result;
        try { result = JSON.parse(stdout); } catch { throw new Error(`claude CLI returned non-JSON output: ${stdout.slice(0, 200)}`); }
        if (result.is_error) throw new Error(`claude CLI error: ${String(result.result || result.api_error_status || "unknown").slice(0, 300)}`);
        return { output_text: schema ? JSON.stringify(result.structured_output ?? {}) : String(result.result ?? "") };
      },
    },
  };
}

function run(command, args, input, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let stdout = "", stderr = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error("claude CLI timed out")); }, TIMEOUT_MS);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0 || stdout.trim().startsWith("{")) resolve(stdout);
      else reject(new Error(`claude CLI exited with ${code}: ${stderr.slice(0, 300)}`));
    });
    child.stdin.end(input, "utf8");
  });
}
