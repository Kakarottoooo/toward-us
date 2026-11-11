import { spawn } from "node:child_process";

// Settle on close, after both pipes drain. Timeout is a transport failure even
// if a partial result exists; its metadata still belongs in the budget ledger.
export function runCliProcess(command, args, input, cwd, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let stdout = "", stderr = "", timedOut = false;
    const failure = (message, code, signal) => Object.assign(new Error(message), { code, signal, stdout, stderr });
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => { clearTimeout(timer); reject(failure(error.message, error.code)); });
    child.stdin.on("error", () => {}); // A child exiting early is reported by close, with its output.
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (timedOut) reject(failure(`CLI timed out after ${timeoutMs}ms`, "ETIMEDOUT", signal));
      else if (code !== 0) reject(failure(`CLI exited with ${code}`, code, signal));
      else resolve(stdout);
    });
    child.stdin.end(input, "utf8");
  });
}
