import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { invoke } from "./cli.mjs";
import { blindPair, decodeVerdict, judgeInstructions, judgeSchema, comparisonReady, completionResult } from "./score.mjs";

// Transport batching only: each pair retains its own randomized order, records,
// criterion and verdict. Never share the first judge's vote with the second.
export async function reviewBatches({ packets, context, directory, seed, checkpoint }) {
  const schema = { type: "object", additionalProperties: false, required: ["verdicts"], properties: {
    verdicts: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "verdict"], properties: { id: { type: "string" }, verdict: judgeSchema } } },
  } };
  for (const judge of ["codex", "claude"]) {
    const pairs = packets.flatMap(({ item, result }) => ["claude", "codex"].flatMap((provider) => {
      const comparison = result.comparisons[provider] ||= { policy: "codex-first", judges: [] };
      if (result.pinky.error || result.rivals[provider]?.error || judge === "claude" && !["tie", "loss"].includes(comparison.judges[0]?.outcome)) return [];
      return [{ id: `${item.id}/${provider}`, comparison, pair: blindPair(item, result.pinky, result.rivals[provider], judge, seed) }];
    }));
    for (let offset = 0; offset < pairs.length; offset += 8) {
      const batch = pairs.slice(offset, offset + 8);
      try {
        const raw = await context.run({ phase: `judge-batch:${judge}`, case: batch.map((row) => row.id).join(",") }, () => invoke(judge, {
          root: join(directory, "judges"), schema,
          instructions: `${judgeInstructions}\nEvaluate each independent packet separately. Do not compare packets to each other. Return exactly one verdict per supplied id in verdicts.`,
          input: JSON.stringify(batch.map(({ id, pair }) => ({ id, ...pair.input }))),
        }));
        const values = raw.value?.verdicts;
        if (!Array.isArray(values) || values.length !== batch.length || new Set(values.map((row) => row.id)).size !== batch.length || batch.some((row) => !values.some((v) => v.id === row.id))) throw new Error("Incomplete batch verdicts");
        const decoded = batch.map((row) => decodeVerdict(values.find((v) => v.id === row.id).verdict, row.pair.swap));
        batch.forEach((row, index) => row.comparison.judges.push({ judge, swap: row.pair.swap, ...decoded[index], batch: `${judge}:${offset}`, model: raw.model }));
      } catch (error) { for (const row of batch) row.comparison.judges.push({ judge, error: error.message }); }
      await checkpoint();
      console.log(`Blind review ${judge}: ${Math.min(offset + 8, pairs.length)}/${pairs.length} pairs`);
    }
  }
  for (const { result } of packets) {
    const votes = Object.values(result.comparisons).flatMap((pair) => pair.judges);
    result.pinky.completed = Object.values(result.comparisons).every(comparisonReady) ? completionResult(result.pinky.machineCompleted, votes, votes.length) : null;
    await writeFile(join(directory, result.id, "result.json"), JSON.stringify(result, null, 2));
  }
}
