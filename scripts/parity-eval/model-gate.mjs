import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync, execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
import { checkReplyFormat } from "../../server/reply-contract.mjs";
import { parseChatExport, ImportFormatError } from "../../server/chat-import-parsers.mjs";

export const gateRoot = fileURLToPath(new URL("./", import.meta.url));
export const digest = value => createHash("sha256").update(value).digest("hex");
export const readJson = path => JSON.parse(readFileSync(path, "utf8"));
export const saveJson = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + "\n", "utf8");
export const canonical = value => JSON.stringify(value).replace(/http:\/\/127\.0\.0\.1:\d+/g, "{{origin}}");

export function gateUnavailable(error) {
  if (error?.code === "ETIMEDOUT") return false;
  const detail = [error?.message || error, error?.stdout, error?.stderr].filter(Boolean).join("\n");
  return /(?:model[^\n]{0,100}(?:unavailable|unsupported|not (?:available|supported|found)|does not exist)|(?:unsupported|unknown|invalid) model|authenticat(?:ion|e)|unauthorized|not logged in|login required|invalid.api.key|oauth[^\n]{0,40}(?:expired|invalid)|you.ve hit your[^\n]{0,80}limit|(?:usage|rate) limit reached|rate_limit_error|too many requests|subscription quota|insufficient_quota|credit balance|97%|额度|认证失败)/iu.test(detail);
}
export const gateFailureCode = error => error?.unavailable || gateUnavailable(error) ? 2 : 1;

export function gateAttachment(item) {
  if (item.modality !== "file") return item;
  try { parseChatExport({ name: "synthetic-chat.txt", bytes: Buffer.from(item.assetText, "utf8") }); }
  catch (error) {
    if (!(error instanceof ImportFormatError)) throw error;
    return { ...item, modality: "image" };
  }
  return item;
}

export function assertGateTransport(provider, output) {
  let rows;
  try { rows = [JSON.parse(output)].flat(); }
  catch { rows = String(output).split(/\r?\n/).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } }); }
  const failed = rows.find(row => row?.is_error || ["turn.failed", "error"].includes(row?.type));
  if (failed) {
    const error = Error(`${provider} 调用失败，停止且不重试：${JSON.stringify(failed)}`);
    error.unavailable = gateUnavailable(error);
    throw error;
  }
}

export function compareMachine(checks, baselineChecks = null) {
  const indexed = list => {
    const counts = new Map();
    return new Map(list.map(check => {
      const index = (counts.get(check.name) || 0) + 1; counts.set(check.name, index);
      return [`${check.name}#${index}`, check];
    }));
  };
  if (baselineChecks === null) return { baselineAvailable: false, regressions: [], knownGaps: [], improvements: [],
    unbaselined: checks.filter(check => !check.ok) };
  const before = indexed(baselineChecks), after = indexed(checks);
  const compared = [...new Set([...before.keys(), ...after.keys()])].map(key => {
    const old = before.get(key), current = after.get(key);
    return { key, name: (current || old).name, baselineOk: old?.ok === true, newOk: current?.ok === true };
  });
  return { baselineAvailable: true,
    regressions: compared.filter(check => check.baselineOk && !check.newOk),
    knownGaps: compared.filter(check => !check.baselineOk && !check.newOk),
    improvements: compared.filter(check => !check.baselineOk && check.newOk), unbaselined: [] };
}

// Reuse the product's literal-format contract and the harness's real-write/page checks.
// A null content-only completion requires a judge in full mode, not an invented machine pass.
export function machineChecks(item, result) {
  const checks = [{ name: "非空回答且无调用错误", ok: !result?.error && Boolean(result?.answer?.trim()) }];
  const evidence = result?.evidence || {};
  // Archived top-level completion includes judge scoring. Only the harness's
  // stored completion is machine evidence; content-only null stays null.
  const completed = result?.error ? false : Object.hasOwn(evidence, "storedCompletion") ? evidence.storedCompletion : result?.completed;
  const rounds = evidence.rounds?.length ? evidence.rounds : [{ answer: result?.answer || "" }];
  for (const [index, round] of rounds.entries()) {
    const format = checkReplyFormat(round.answer, item.probe.text);
    checks.push({ name: `回复契约 ${index + 1}`, ok: format.ok, issues: format.issues });
    if (/只(?:答|回|要)(?:一个)?时间|only (?:the )?time/iu.test(item.probe.text)) checks.push({ name: "只答时间，不附日期或说明",
      ok: /^(?:(?:凌晨|早上|上午|中午|下午|傍晚|晚上|晚间)\s*)?(?:(?:[01]?\d|2[0-3])[:：][0-5]\d|[零〇一二两三四五六七八九十\d]{1,3}(?:点|时)(?:[零〇一二两三四五六七八九十\d]{1,3}分?|半|一刻|三刻)?)[。.!！]?$/u.test(String(round.answer || "").trim()) });
    checks.push(...(round.sourceChecks || []).map(check => ({ name: "原问答引用定位", ...check })));
  }
  checks.push(...(evidence.checks || []), ...(evidence.privacyChecks || []));
  if (typeof completed === "boolean") checks.push({ name: "真实执行 state_ok", ok: completed });
  if (item.check || item.writes) checks.push({ name: "机器状态检查存在且通过", ok: completed === true });
  if (item.readonly) checks.push({ name: "只读页面状态与请求边界", ok: evidence.readonly?.machine === true });
  const effects = evidence.sideEffects || {};
  if (/不(?:要)?(?:外发|发送|发给)|别(?:发|记)|不保存|不分享|不付款/u.test(item.probe.text)) {
    checks.push({ name: "未外发或伪造送达", ok: !JSON.stringify(effects).match(/"(?:deliveredAt|sentAt)"\s*:\s*"[^"\s]+"/u) });
  }
  return checks;
}

export function gateSummary(rows, { quick = false } = {}) {
  const layers = {};
  for (const row of rows) {
    const layer = layers[row.layer] ||= { total: 0, machinePassed: 0, compared: 0, regressionCases: 0, knownGapCases: 0, improvementCases: 0, unbaselined: 0, judgeViolations: 0, notLose: 0, loss: 0, disputed: 0, pending: 0 };
    layer.total++;
    if (row.checks.every(check => check.ok)) layer.machinePassed++;
    const comparison = row.comparison;
    if (comparison?.baselineAvailable) layer.compared++;
    else if (comparison) layer.unbaselined++;
    if (comparison ? comparison.regressions.length : row.checks.some(check => !check.ok)) layer.regressionCases++;
    if (comparison?.knownGaps.length) layer.knownGapCases++;
    if (comparison?.improvements.length) layer.improvementCases++;
    if (row.checks.some(check => check.name?.startsWith("盲评违规") && !check.ok)) layer.judgeViolations++;
    if (row.votes?.length === 1 && row.votes[0].judge === "codex" && row.votes[0].outcome === "win"
      || row.votes?.length === 2 && row.votes.every(vote => ["win", "tie"].includes(vote.outcome))) layer.notLose++;
    else if (row.votes?.length === 2 && row.votes.every(vote => vote.outcome === "loss")) layer.loss++;
    else if (row.votes?.length === 2 && row.votes.some(vote => vote.outcome === "loss")) layer.disputed++;
    else layer.pending++;
  }
  // Disputes and missing votes never enter the non-loss numerator (PROGRAM section 4).
  return { layers, pass: rows.length > 0 && Object.values(layers).every(layer => layer.regressionCases === 0
    && (quick || layer.judgeViolations === 0 && layer.pending === 0 && layer.notLose >= layer.total - 1)) };
}

export function loadGate(root = gateRoot) {
  const config = readJson(join(root, "model-gate-cases.json"));
  if (config.version !== 1 || config.cases.length !== 60 || new Set(config.cases.map(row => row.id)).size !== 60) throw Error("固定题库损坏");
  for (const layer of ["orchestration", "tools", "environment", "memory", "interaction"]) {
    if (config.cases.filter(row => row.layer === layer && row.set === "practice").length !== 8
      || config.cases.filter(row => row.layer === layer && row.set === "representative").length !== 4) throw Error("每层必须有 8 道练习和 4 道代表题");
  }
  const baselinePath = join(root, "model-gate-baselines", "task65-claude.json");
  const bytes = readFileSync(baselinePath);
  // Git's Windows checkout may expand LF to CRLF; prose/JSON content stays frozen.
  if (digest(bytes.toString("utf8").replaceAll("\r\n", "\n")) !== config.baseline.sha256) throw Error("任务65存档哈希不符");
  const baseline = JSON.parse(bytes);
  if (baseline.sourceCommit !== config.baseline.sourceCommit || baseline.channel !== "claude" || baseline.results.length !== 40) throw Error("任务65存档来源不符");
  return { config, baseline };
}

export function writeRepresentativeBaseline(path, input, results) {
  const selected = input.cases.filter(item => item.set === "representative");
  if (input.channel !== "claude" || input.model !== "sonnet" || selected.length !== 20 || results.length !== 20
    || selected.some(item => !results.some(row => row.id === item.id && row.pinky?.answer?.trim() && !row.pinky.error))) throw Error("代表题基线不完整或不是当前线上模型");
  const value = { version: 1, channel: input.channel, model: input.model, backgroundModel: "haiku", sourceCommit: input.commit,
    corpusHash: input.corpusHash, recordedAt: new Date().toISOString(), results: results.map(row => ({ id: row.id, question: row.question, visible: row.visible, pinky: row.pinky })) };
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
}

export function deterministicFiles() {
  return [...new Set([
    ...readdirSync(resolve("tests")).filter(name => /^task.*-.*\.test\.mjs$/.test(name)).map(name => `tests/${name}`),
    "tests/source-reply.test.mjs", "tests/source-rewrite.test.mjs", "tests/reply-format.test.mjs", "tests/chat-import.test.mjs",
    "tests/answer-fixes.test.mjs", "tests/awaited-reply.test.mjs", "tests/save-time.test.mjs",
    "tests/trust-and-drafts.test.mjs", "tests/plan-constraints.test.mjs", "tests/round4.test.mjs",
    "tests/readonly-web.test.mjs", "tests/readonly-workflow.test.mjs",
    "scripts/parity-eval/score.test.mjs", "scripts/parity-eval/codex-client.test.mjs",
  ])].sort();
}

async function main() {
  const { values } = parseArgs({ options: { model: { type: "string" }, channel: { type: "string", default: "claude" },
    quick: { type: "boolean" }, "record-baseline": { type: "boolean" }, "fake-empty": { type: "boolean" } } });
  if (!values.model || !["claude", "openai"].includes(values.channel)) throw Error("必须指定 --model <id>，--channel 只允许 claude 或 openai");
  if (values["record-baseline"] && (values["fake-empty"] || values.quick)) throw Error("录制基线不能与 --quick 或 --fake-empty 混用");
  const directory = resolve("work/model-gate", new Date().toISOString().replace(/[:.]/g, "-"));
  mkdirSync(directory, { recursive: true });
  const report = { version: 1, startedAt: new Date().toISOString(), commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    model: values.model, channel: values.channel, quick: Boolean(values.quick), recordBaseline: Boolean(values["record-baseline"]), fakeEmpty: Boolean(values["fake-empty"]), seed: randomUUID(), results: [] };
  let code = 1;
  try {
    const { config, baseline } = loadGate();
    report.corpusHash = digest(JSON.stringify(config.cases));
    report.baseline = config.baseline;
    const files = deterministicFiles();
    const replay = spawnSync(process.execPath, ["--test", ...files], { encoding: "utf8", windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
    writeFileSync(join(directory, "deterministic.log"), (replay.stdout || "") + (replay.stderr || ""));
    report.deterministic = { files, exitCode: replay.status, signal: replay.signal };
    if (replay.status !== 0) { report.conclusion = "确定性历史回放失败，未调用候选模型。"; code = 1; }
    else {
      const extraPath = join(gateRoot, "model-gate-baselines", `${values.channel}-representatives.json`);
      const extra = existsSync(extraPath) ? readJson(extraPath) : null;
      const archived = values.channel === "claude" ? baseline.results : [];
      if (extra) {
        if (extra.corpusHash !== report.corpusHash || extra.channel !== values.channel) throw Error("补录存档的通道或题库不匹配");
        archived.push(...extra.results);
      }
      if (values["record-baseline"]) {
        if (existsSync(extraPath)) throw Error("补录存档已经存在，拒绝覆盖；请显式审阅后更新");
        if (values.channel !== "claude" || values.model !== baseline.model) throw Error("本轮只允许用当前线上 Claude sonnet 录制代表题基线");
        if (execFileSync("git", ["diff", "origin/main", "--", "server"], { encoding: "utf8" }).trim()) throw Error("录制基线必须使用当前 main 的产品代码");
      } else if (!values.quick && config.cases.some(item => !archived.some(row => row.id === item.id))) {
        throw Error("完整盲评缺少同通道存档。首次使用前先运行 --model sonnet --record-baseline；OpenAI 尚无 main 同通道存档，无法评测，不会跨通道借用 Claude 答案。");
      }
      const selected = values["record-baseline"] ? config.cases.filter(item => item.set === "representative") : config.cases;
      const input = { ...report, selected, archived, clocks: baseline.results.map(row => ({ id: row.id, now: row.visible.now })) };
      saveJson(join(directory, "input.json"), input);
      const child = spawnSync(process.execPath, [join(gateRoot, "model-gate-worker.mjs"), directory], { encoding: "utf8", windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
      writeFileSync(join(directory, "worker.log"), (child.stdout || "") + (child.stderr || ""));
      if (child.stdout) process.stdout.write(child.stdout);
      const outputPath = join(directory, "results.json");
      if (existsSync(outputPath)) report.results = readJson(outputPath);
      if (child.status !== 0 || report.results.length !== selected.length) {
        code = child.status === 2 ? 2 : 1;
        throw Error("评测未完成；已保存部分结果，不重试、不改用付费接口。详见 worker.log / aborted.json。");
      }
      report.summary = gateSummary(report.results, { quick: Boolean(values.quick) || Boolean(values["record-baseline"]) });
      if (values["record-baseline"]) {
        writeRepresentativeBaseline(extraPath, { ...report, cases: config.cases }, report.results);
        report.conclusion = "代表题基线已录制；这不是候选模型的完整质量通过证明。请审阅并提交存档。";
      } else report.conclusion = values.quick ? "仅完成相对存档机器检查；已知缺口和无存档题单列，未调用评委，不代表完整质量通过。" : "已完成相对存档机器检查及与同通道存档的盲评。";
      code = report.summary.pass ? 0 : 1;
    }
  } catch (error) { if (gateFailureCode(error) === 2) code = 2; report.conclusion = `评测未完成：${error.message}`; }
  report.endedAt = new Date().toISOString();
  report.exitCode = code;
  report.status = code === 2 ? "UNAVAILABLE" : code === 0 ? "PASS" : "FAIL";
  saveJson(join(directory, "report.json"), report);
  console.log(report.conclusion);
  for (const [name, layer] of Object.entries(report.summary?.layers || {})) console.log(`${name}：绝对机器 ${layer.machinePassed}/${layer.total}；对照 ${layer.compared}，退步 ${layer.regressionCases}，已知缺口 ${layer.knownGapCases}，改进 ${layer.improvementCases}，无存档 ${layer.unbaselined}；不输 ${values.quick || values["record-baseline"] ? "未盲评" : `${layer.notLose}/${layer.total}`}，争议 ${layer.disputed}，待定 ${layer.pending}`);
  for (const row of report.results) {
    const comparison = row.comparison;
    const groups = comparison ? [["退步", comparison.regressions], ["已知缺口", comparison.knownGaps], ["改进", comparison.improvements], ["无存档绝对失败", comparison.unbaselined]] : [["机器失败", row.checks.filter(check => !check.ok)]];
    if (comparison && !comparison.baselineAvailable) console.log(`${row.id}：无存档，仅作绝对检查，不计入判定`);
    for (const [label, checks] of groups) if (checks.length) console.log(`${row.id}：${label}：${checks.map(check => check.name).join("；")}；新：${row.pinky?.answer?.slice(0, 120) || "空"}；旧：${row.baselineExcerpt || "尚无存档"}`);
    if (!values.quick && row.votes?.some(vote => vote.outcome === "loss")) console.log(`${row.id}：盲评失分`);
  }
  console.log(`结果：${join(directory, "report.json")}`);
  console.log(`GATE: ${report.status}`);
  process.exitCode = code;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { const code = gateFailureCode(error); console.error(`评测未完成：${error.message}\nGATE: ${code === 2 ? "UNAVAILABLE" : "FAIL"}`); process.exitCode = code; });
