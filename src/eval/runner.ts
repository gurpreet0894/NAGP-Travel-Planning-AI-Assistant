import { AIMessage, HumanMessage, type BaseMessage } from "@langchain/core/messages";
import { config } from "../config.js";
import { askTravelAgent, type ToolUsageRecord, type TravelAgent } from "../agent/agent.js";
import { checkRetrieval, checkToolCalls } from "./matchers.js";
import { judgeAnswer, judgeRetrievalRelevance } from "./judge.js";
import type {
  AnswerJudgement,
  EvalCaseResult,
  EvalDataset,
  EvalReport,
  RetrievalMetrics,
} from "./types.js";

const PASS_SCORE_THRESHOLD = 3; // out of 5, per dimension

function buildSupportingContext(toolUsage: ToolUsageRecord[]): string {
  return toolUsage
    .map((step) => {
      if (step.tool === "search_singapore_knowledge_base") {
        const output = step.output as { formattedContext?: string };
        return `[search_singapore_knowledge_base]\n${output.formattedContext ?? ""}`;
      }
      return `[${step.tool}] input=${JSON.stringify(step.input)} output=${JSON.stringify(
        step.output
      )}`;
    })
    .join("\n\n");
}

function judgementPasses(judgement: AnswerJudgement): boolean {
  return Object.values(judgement).every((s) => s.score >= PASS_SCORE_THRESHOLD);
}

async function runTurns(
  executor: TravelAgent,
  turns: string[]
): Promise<{ finalAnswer: string; finalToolUsage: ToolUsageRecord[] }> {
  const history: BaseMessage[] = [];
  let finalAnswer = "";
  let finalToolUsage: ToolUsageRecord[] = [];

  for (const [index, turn] of turns.entries()) {
    const answer = await askTravelAgent(executor, turn, history);
    history.push(new HumanMessage(turn), new AIMessage(answer.text));

    if (index === turns.length - 1) {
      finalAnswer = answer.text;
      finalToolUsage = answer.toolUsage;
    }
  }

  return { finalAnswer, finalToolUsage };
}

export interface RunEvaluationOptions {
  /** Delay between test cases, to stay under free-tier rate limits. Default 0. */
  delayMs?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runEvaluation(
  dataset: EvalDataset,
  executor: TravelAgent,
  options: RunEvaluationOptions = {}
): Promise<EvalReport> {
  const results: EvalCaseResult[] = [];

  for (const [index, testCase] of dataset.testCases.entries()) {
    if (index > 0 && options.delayMs) {
      await sleep(options.delayMs);
    }
    const startedAt = Date.now();
    const errors: string[] = [];

    let finalAnswer = "";
    let finalToolUsage: ToolUsageRecord[] = [];

    try {
      const outcome = await runTurns(executor, testCase.turns);
      finalAnswer = outcome.finalAnswer;
      finalToolUsage = outcome.finalToolUsage;
    } catch (error) {
      errors.push(`Agent execution failed: ${error instanceof Error ? error.message : error}`);
    }

    const toolCallCheck = checkToolCalls(testCase.expectedToolCalls, finalToolUsage);

    let retrieval: RetrievalMetrics | null = null;
    const deterministicRetrieval = checkRetrieval(testCase.expectedSources, finalToolUsage);
    if (deterministicRetrieval) {
      const ragContext = finalToolUsage
        .filter((t) => t.tool === "search_singapore_knowledge_base")
        .map((t) => (t.output as { formattedContext?: string }).formattedContext ?? "")
        .join("\n\n");

      let relevance = null;
      try {
        relevance = await judgeRetrievalRelevance({
          query: testCase.turns[testCase.turns.length - 1],
          retrievedContext: ragContext,
        });
      } catch (error) {
        errors.push(
          `Retrieval-relevance judge failed: ${error instanceof Error ? error.message : error}`
        );
      }
      retrieval = { ...deterministicRetrieval, relevance };
    }

    let judgement: AnswerJudgement = {
      correctness: { score: 0, reasoning: "Not evaluated due to an earlier error." },
      relevance: { score: 0, reasoning: "Not evaluated due to an earlier error." },
      completeness: { score: 0, reasoning: "Not evaluated due to an earlier error." },
      faithfulness: { score: 0, reasoning: "Not evaluated due to an earlier error." },
    };

    if (errors.length === 0) {
      try {
        judgement = await judgeAnswer({
          query: testCase.turns[testCase.turns.length - 1],
          expectedAnswerCriteria: testCase.expectedAnswerCriteria,
          actualAnswer: finalAnswer,
          supportingContext: buildSupportingContext(finalToolUsage),
        });
      } catch (error) {
        errors.push(`Answer judge failed: ${error instanceof Error ? error.message : error}`);
      }
    }

    const judgementPass = errors.length === 0 && judgementPasses(judgement);
    const pass = errors.length === 0 && toolCallCheck.overallMatch && judgementPass;

    results.push({
      id: testCase.id,
      description: testCase.description,
      category: testCase.category,
      turns: testCase.turns,
      actualAnswer: finalAnswer,
      toolCallCheck,
      retrieval,
      judgement,
      judgementPass,
      pass,
      errors,
      durationMs: Date.now() - startedAt,
    });
  }

  const passedCases = results.filter((r) => r.pass).length;
  const dimensionKeys: Array<keyof AnswerJudgement> = [
    "correctness",
    "relevance",
    "completeness",
    "faithfulness",
  ];
  const averageScores = dimensionKeys.reduce((acc, key) => {
    const scored = results.filter((r) => r.errors.length === 0);
    acc[key] =
      scored.length > 0
        ? scored.reduce((sum, r) => sum + r.judgement[key].score, 0) / scored.length
        : 0;
    return acc;
  }, {} as Record<keyof AnswerJudgement, number>);

  const precisionValues = results
    .map((r) => r.retrieval?.precision)
    .filter((v): v is number => v !== null && v !== undefined);
  const recallValues = results
    .map((r) => r.retrieval?.recall)
    .filter((v): v is number => v !== null && v !== undefined);

  return {
    generatedAt: new Date().toISOString(),
    model: config.google.chatModel,
    embeddingModel: config.google.embeddingModel,
    passThreshold: PASS_SCORE_THRESHOLD,
    totalCases: results.length,
    passedCases,
    failedCases: results.length - passedCases,
    passRate: results.length > 0 ? passedCases / results.length : 0,
    averageScores,
    averageRetrievalPrecision:
      precisionValues.length > 0
        ? precisionValues.reduce((a, b) => a + b, 0) / precisionValues.length
        : null,
    averageRetrievalRecall:
      recallValues.length > 0
        ? recallValues.reduce((a, b) => a + b, 0) / recallValues.length
        : null,
    results,
  };
}
