import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { createAppRuntime } from "../agent/bootstrap.js";
import { loadEvalDataset } from "../eval/datasetLoader.js";
import { runEvaluation } from "../eval/runner.js";
import { renderMarkdownReport } from "../eval/report.js";

interface CliOptions {
  datasetPath?: string;
  ids?: string[];
  category?: string;
  delayMs: number;
}

/**
 * Minimal flag parsing - no positional args besides an optional dataset
 * path, so a small hand-rolled parser is enough:
 *   npm run eval -- --ids=rag-attractions,mcp-weather-forecast
 *   npm run eval -- --category=rag --delay-ms=5000
 * Filtering/delay exist because free-tier Gemini keys have very small daily
 * request quotas - the full 9-case suite (each case makes several agent +
 * judge calls) can exceed a 20-requests/day quota in one run, so being able
 * to evaluate a subset is what makes this practically usable on such a key.
 */
function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { delayMs: 0 };
  for (const arg of argv) {
    if (arg.startsWith("--ids=")) {
      options.ids = arg.slice("--ids=".length).split(",").map((s) => s.trim());
    } else if (arg.startsWith("--category=")) {
      options.category = arg.slice("--category=".length).trim();
    } else if (arg.startsWith("--delay-ms=")) {
      options.delayMs = Number(arg.slice("--delay-ms=".length));
    } else if (!arg.startsWith("--")) {
      options.datasetPath = arg;
    }
  }
  return options;
}

async function main() {
  const cli = parseArgs(process.argv.slice(2));
  const dataset = await loadEvalDataset(cli.datasetPath);

  if (cli.ids || cli.category) {
    dataset.testCases = dataset.testCases.filter(
      (tc) =>
        (!cli.ids || cli.ids.includes(tc.id)) && (!cli.category || tc.category === cli.category)
    );
  }
  console.log(`Loaded ${dataset.testCases.length} test case(s).`);

  console.log("Booting agent runtime (vector store + MCP servers) ...");
  const runtime = await createAppRuntime();

  console.log("Running evaluation ...");
  try {
    const report = await runEvaluation(dataset, runtime.executor, { delayMs: cli.delayMs });

    const reportsDir = path.join(config.projectRoot, "eval", "reports");
    await fs.mkdir(reportsDir, { recursive: true });
    const stamp = report.generatedAt.replace(/[:.]/g, "-");

    const jsonPath = path.join(reportsDir, `${stamp}.json`);
    const mdPath = path.join(reportsDir, `${stamp}.md`);

    await fs.writeFile(jsonPath, JSON.stringify(report, null, 2), "utf-8");
    const markdown = renderMarkdownReport(report);
    await fs.writeFile(mdPath, markdown, "utf-8");

    console.log(`\n${report.passedCases}/${report.totalCases} test cases passed (${(report.passRate * 100).toFixed(0)}%)`);
    console.log(`Report written to:\n  ${mdPath}\n  ${jsonPath}`);

    process.exitCode = report.failedCases > 0 ? 1 : 0;
  } finally {
    await runtime.shutdown();
  }
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err) => {
    console.error("Evaluation run failed:", err);
    process.exit(1);
  });
