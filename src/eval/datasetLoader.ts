import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { config } from "../config.js";
import type { EvalDataset } from "./types.js";

const ExpectedToolCallSchema = z.object({
  tool: z.string(),
  args: z.record(z.string(), z.unknown()).optional(),
});

const EvalTestCaseSchema = z.object({
  id: z.string(),
  description: z.string(),
  category: z.string(),
  turns: z.array(z.string()).min(1),
  expectedToolCalls: z.array(ExpectedToolCallSchema),
  expectedAnswerCriteria: z.string(),
  expectedSources: z.array(z.string()).optional(),
});

const EvalDatasetSchema = z.object({
  version: z.number(),
  testCases: z.array(EvalTestCaseSchema),
});

export async function loadEvalDataset(datasetPath?: string): Promise<EvalDataset> {
  const filePath = datasetPath ?? path.join(config.projectRoot, "eval", "dataset.json");
  const raw = await fs.readFile(filePath, "utf-8");
  const parsed = EvalDatasetSchema.parse(JSON.parse(raw));

  const ids = new Set<string>();
  for (const testCase of parsed.testCases) {
    if (ids.has(testCase.id)) {
      throw new Error(`Duplicate test case id "${testCase.id}" in ${filePath}`);
    }
    ids.add(testCase.id);
  }

  return parsed;
}
