import type { EvalCaseResult, EvalReport } from "./types.js";

function fmtScore(n: number): string {
  return n.toFixed(2);
}

function fmtPct(n: number | null): string {
  return n === null ? "n/a" : `${(n * 100).toFixed(0)}%`;
}

function renderCase(result: EvalCaseResult): string {
  const lines: string[] = [];
  lines.push(`### ${result.pass ? "✅ PASS" : "❌ FAIL"} — \`${result.id}\` (${result.category})`);
  lines.push("");
  lines.push(result.description);
  lines.push("");
  lines.push(
    `**Turns:** ${result.turns.map((t, i) => `\n${i + 1}. ${t}`).join("")}`
  );
  lines.push("");
  lines.push(`**Actual answer:**\n\n> ${result.actualAnswer.replace(/\n/g, "\n> ")}`);
  lines.push("");

  if (result.errors.length > 0) {
    lines.push(`**Errors:** ${result.errors.join(" | ")}`);
    lines.push("");
  }

  const tc = result.toolCallCheck;
  lines.push("**Tool-call check**");
  lines.push("");
  lines.push(`- Expected tools: \`${tc.expectedToolNames.join(", ") || "(none)"}\``);
  lines.push(`- Actual tools: \`${tc.actualToolNames.join(", ") || "(none)"}\``);
  lines.push(
    `- Count match: ${tc.countMatch ? "yes" : "no"} (expected ${tc.expectedCount}, got ${tc.actualCount})`
  );
  lines.push(`- Tool selection match: ${tc.toolNamesMatch ? "yes" : "no"}`);
  if (tc.missingTools.length > 0) lines.push(`  - Missing: \`${tc.missingTools.join(", ")}\``);
  if (tc.unexpectedTools.length > 0)
    lines.push(`  - Unexpected: \`${tc.unexpectedTools.join(", ")}\``);
  lines.push(`- Argument match: ${tc.argsMatch ? "yes" : "no"}`);
  for (const mismatch of tc.argMismatches) {
    lines.push(
      `  - \`${mismatch.tool}\`: expected ${JSON.stringify(mismatch.expectedArgs)}, got ${JSON.stringify(
        mismatch.actualArgs
      )} (mismatched keys: ${mismatch.mismatchedKeys.join(", ")})`
    );
  }
  lines.push("");

  if (result.retrieval) {
    lines.push("**Retrieval metrics**");
    lines.push("");
    lines.push(`- Expected sources: \`${result.retrieval.expectedSources.join(", ")}\``);
    lines.push(`- Retrieved sources: \`${result.retrieval.retrievedSources.join(", ")}\``);
    lines.push(
      `- Precision: ${fmtPct(result.retrieval.precision)} | Recall: ${fmtPct(
        result.retrieval.recall
      )} | F1: ${fmtPct(result.retrieval.f1)}`
    );
    if (result.retrieval.relevance) {
      lines.push(
        `- LLM-judged relevance: ${result.retrieval.relevance.score}/5 — ${result.retrieval.relevance.reasoning}`
      );
    }
    lines.push("");
  }

  lines.push("**Answer quality (LLM judge, 1-5 each)**");
  lines.push("");
  for (const [dim, judged] of Object.entries(result.judgement)) {
    lines.push(`- **${dim}**: ${judged.score}/5 — ${judged.reasoning}`);
  }
  lines.push("");
  lines.push("---");
  lines.push("");
  return lines.join("\n");
}

export function renderMarkdownReport(report: EvalReport): string {
  const lines: string[] = [];
  lines.push("# Agent Evaluation Report");
  lines.push("");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Chat model: \`${report.model}\` | Embedding model: \`${report.embeddingModel}\``);
  lines.push(`Pass threshold: ${report.passThreshold}/5 on every judged dimension`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`| Metric | Value |`);
  lines.push(`|---|---|`);
  lines.push(`| Total test cases | ${report.totalCases} |`);
  lines.push(`| Passed | ${report.passedCases} |`);
  lines.push(`| Failed | ${report.failedCases} |`);
  lines.push(`| Pass rate | ${fmtPct(report.passRate)} |`);
  lines.push(`| Avg. correctness | ${fmtScore(report.averageScores.correctness)}/5 |`);
  lines.push(`| Avg. relevance | ${fmtScore(report.averageScores.relevance)}/5 |`);
  lines.push(`| Avg. completeness | ${fmtScore(report.averageScores.completeness)}/5 |`);
  lines.push(`| Avg. faithfulness | ${fmtScore(report.averageScores.faithfulness)}/5 |`);
  lines.push(`| Avg. retrieval precision | ${fmtPct(report.averageRetrievalPrecision)} |`);
  lines.push(`| Avg. retrieval recall | ${fmtPct(report.averageRetrievalRecall)} |`);
  lines.push("");

  lines.push("## Per-test-case results");
  lines.push("");
  lines.push("| ID | Category | Verdict | Tool match | Judge pass |");
  lines.push("|---|---|---|---|---|");
  for (const r of report.results) {
    lines.push(
      `| \`${r.id}\` | ${r.category} | ${r.pass ? "✅" : "❌"} | ${
        r.toolCallCheck.overallMatch ? "✅" : "❌"
      } | ${r.judgementPass ? "✅" : "❌"} |`
    );
  }
  lines.push("");

  lines.push("## Details");
  lines.push("");
  for (const result of report.results) {
    lines.push(renderCase(result));
  }

  return lines.join("\n");
}
