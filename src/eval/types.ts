/** A single expected tool invocation for a test case. */
export interface ExpectedToolCall {
  tool: string;
  /**
   * Partial expected arguments. Only the keys listed here are checked
   * against the agent's actual call - extra actual args are ignored.
   */
  args?: Record<string, unknown>;
}

/** One row of the evaluator dataset. */
export interface EvalTestCase {
  id: string;
  description: string;
  /** Category tag used for grouping in the report, e.g. "rag", "mcp-weather". */
  category: string;
  /**
   * Either a single question, or a sequence of turns run in the same
   * session (to test multi-turn memory). Only the LAST turn's tool usage
   * and answer are scored; earlier turns just set up conversational context.
   */
  turns: string[];
  /** Tool calls expected on the final turn. Empty array means "no tool calls expected". */
  expectedToolCalls: ExpectedToolCall[];
  /**
   * Free-text description of what a correct final answer must contain -
   * fed to the LLM judge alongside the actual answer. Not a literal string
   * match.
   */
  expectedAnswerCriteria: string;
  /**
   * Source titles (must match the `title` frontmatter of a knowledge-base
   * document) that a RAG-backed answer's citations should include. Used to
   * compute retrieval precision/recall. Omit for non-RAG test cases.
   */
  expectedSources?: string[];
}

export interface EvalDataset {
  version: number;
  testCases: EvalTestCase[];
}

/** Result of comparing actual vs expected tool calls (names + args). */
export interface ToolCallCheckResult {
  expectedCount: number;
  actualCount: number;
  countMatch: boolean;
  expectedToolNames: string[];
  actualToolNames: string[];
  missingTools: string[];
  unexpectedTools: string[];
  toolNamesMatch: boolean;
  argMismatches: Array<{
    tool: string;
    expectedArgs: Record<string, unknown>;
    actualArgs: unknown;
    mismatchedKeys: string[];
  }>;
  argsMatch: boolean;
  /** countMatch && toolNamesMatch && argsMatch */
  overallMatch: boolean;
}

/** Result of comparing retrieved RAG sources vs expected sources. */
export interface RetrievalMetrics {
  expectedSources: string[];
  retrievedSources: string[];
  precision: number | null;
  recall: number | null;
  f1: number | null;
  relevance: JudgeScore | null;
}

export interface JudgeScore {
  score: number; // 1-5
  reasoning: string;
}

export interface AnswerJudgement {
  correctness: JudgeScore;
  relevance: JudgeScore;
  completeness: JudgeScore;
  faithfulness: JudgeScore;
}

export interface EvalCaseResult {
  id: string;
  description: string;
  category: string;
  turns: string[];
  actualAnswer: string;
  toolCallCheck: ToolCallCheckResult;
  retrieval: RetrievalMetrics | null;
  judgement: AnswerJudgement;
  judgementPass: boolean;
  pass: boolean;
  errors: string[];
  durationMs: number;
}

export interface EvalReport {
  generatedAt: string;
  model: string;
  embeddingModel: string;
  passThreshold: number;
  totalCases: number;
  passedCases: number;
  failedCases: number;
  passRate: number;
  averageScores: Record<keyof AnswerJudgement, number>;
  averageRetrievalPrecision: number | null;
  averageRetrievalRecall: number | null;
  results: EvalCaseResult[];
}
