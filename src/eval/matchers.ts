import type { ToolUsageRecord } from "../agent/agent.js";
import type { ExpectedToolCall, RetrievalMetrics, ToolCallCheckResult } from "./types.js";

function normalizeValue(value: unknown): string {
  if (typeof value === "string") return value.trim().toLowerCase();
  if (typeof value === "number") return String(value);
  return JSON.stringify(value);
}

/** True if `actual` equals `expected`, or (for strings) contains it as a substring. */
function valuesMatch(expected: unknown, actual: unknown): boolean {
  if (typeof expected === "number" && typeof actual === "number") {
    return Math.abs(expected - actual) < 1e-6;
  }
  const normExpected = normalizeValue(expected);
  const normActual = normalizeValue(actual);
  return normActual === normExpected || normActual.includes(normExpected);
}

function argsMatch(
  expectedArgs: Record<string, unknown> | undefined,
  actualArgs: unknown
): string[] {
  if (!expectedArgs) return [];
  const actualObj = (actualArgs ?? {}) as Record<string, unknown>;
  const mismatched: string[] = [];
  for (const [key, expectedValue] of Object.entries(expectedArgs)) {
    if (!(key in actualObj) || !valuesMatch(expectedValue, actualObj[key])) {
      mismatched.push(key);
    }
  }
  return mismatched;
}

/**
 * Compares the tools the agent actually invoked (in `toolUsage`) against
 * the dataset's expected tool calls: how many were called, whether the
 * right tools (by name) were selected, and whether the arguments passed to
 * each matching tool were the expected ones.
 */
export function checkToolCalls(
  expected: ExpectedToolCall[],
  actual: ToolUsageRecord[]
): ToolCallCheckResult {
  const expectedToolNames = expected.map((e) => e.tool);
  const actualToolNames = actual.map((a) => a.tool);

  const remainingActual = [...actual];
  const argMismatches: ToolCallCheckResult["argMismatches"] = [];
  const missingTools: string[] = [];

  for (const expectedCall of expected) {
    const matchIndex = remainingActual.findIndex((a) => a.tool === expectedCall.tool);
    if (matchIndex === -1) {
      missingTools.push(expectedCall.tool);
      continue;
    }
    const [actualCall] = remainingActual.splice(matchIndex, 1);
    const mismatchedKeys = argsMatch(expectedCall.args, actualCall.input);
    if (mismatchedKeys.length > 0) {
      argMismatches.push({
        tool: expectedCall.tool,
        expectedArgs: expectedCall.args ?? {},
        actualArgs: actualCall.input,
        mismatchedKeys,
      });
    }
  }

  // Whatever's left in remainingActual was called but not expected at all.
  const unexpectedTools = remainingActual.map((a) => a.tool);

  const countMatch = expected.length === actual.length;
  const toolNamesMatch = missingTools.length === 0 && unexpectedTools.length === 0;
  const argsOk = argMismatches.length === 0;

  return {
    expectedCount: expected.length,
    actualCount: actual.length,
    countMatch,
    expectedToolNames,
    actualToolNames,
    missingTools,
    unexpectedTools,
    toolNamesMatch,
    argMismatches,
    argsMatch: argsOk,
    overallMatch: countMatch && toolNamesMatch && argsOk,
  };
}

/**
 * Deterministic precision/recall of the RAG tool's retrieved source
 * citations against the dataset's expected sources for this question.
 * (The qualitative "relevance" score is filled in separately by the LLM
 * judge in judge.ts, since precision/recall alone can't tell whether a
 * correctly-titled source was actually a relevant chunk.)
 */
export function checkRetrieval(
  expectedSources: string[] | undefined,
  toolUsage: ToolUsageRecord[]
): Omit<RetrievalMetrics, "relevance"> | null {
  const ragCalls = toolUsage.filter((t) => t.tool === "search_singapore_knowledge_base");
  if (!expectedSources || ragCalls.length === 0) return null;

  const retrievedSources = Array.from(
    new Set(
      ragCalls.flatMap((call) => {
        const citations = (call.output as { citations?: Array<{ title: string }> })?.citations;
        return citations?.map((c) => c.title) ?? [];
      })
    )
  );

  const expectedSet = new Set(expectedSources);
  const retrievedSet = new Set(retrievedSources);
  const intersection = retrievedSources.filter((s) => expectedSet.has(s));

  const precision = retrievedSet.size > 0 ? intersection.length / retrievedSet.size : null;
  const recall = expectedSet.size > 0 ? intersection.length / expectedSet.size : null;
  const f1 =
    precision !== null && recall !== null && precision + recall > 0
      ? (2 * precision * recall) / (precision + recall)
      : null;

  return { expectedSources, retrievedSources, precision, recall, f1 };
}
