import { z } from "zod";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { config } from "../config.js";
import type { AnswerJudgement, JudgeScore } from "./types.js";

// NOTE: each dimension gets its OWN z.object() instance (via this factory)
// rather than reusing one shared schema object four times. Gemini's function-
// calling/structured-output schema validator does not support the "$ref"
// JSON-Schema shorthand that zod-to-json-schema emits when the same schema
// object instance is reused for multiple properties - reusing one instance
// here causes a 400 "Unknown name '$ref'" error from the API.
function makeScoreSchema(description: string) {
  return z
    .object({
      score: z.number().describe("Integer score from 1 (very poor) to 5 (excellent)."),
      reasoning: z.string().describe("One or two sentences justifying the score."),
    })
    .describe(description);
}

const AnswerJudgementSchema = z.object({
  correctness: makeScoreSchema(
    "Are the factual claims in the answer accurate and consistent with the provided context/tool results?"
  ),
  relevance: makeScoreSchema(
    "Does the answer directly address what the user asked, without going off-topic?"
  ),
  completeness: makeScoreSchema(
    "Does the answer cover the key points described in the expected-answer criteria?"
  ),
  faithfulness: makeScoreSchema(
    "Is the answer grounded in the given knowledge-base context and tool outputs, with no invented facts, numbers, or sources not present in that context?"
  ),
});

let judgeModel: ChatGoogleGenerativeAI | null = null;

function getJudgeModel() {
  if (!judgeModel) {
    judgeModel = new ChatGoogleGenerativeAI({
      apiKey: config.google.apiKey,
      model: config.google.chatModel,
      temperature: 0,
    });
  }
  return judgeModel;
}

function toJudgeScore(raw: { score: number; reasoning: string }): JudgeScore {
  return { score: raw.score, reasoning: raw.reasoning };
}

export interface JudgeAnswerInput {
  query: string;
  expectedAnswerCriteria: string;
  actualAnswer: string;
  /** Formatted RAG context / MCP tool outputs the agent had available, for faithfulness checking. */
  supportingContext: string;
}

/**
 * LLM-as-judge evaluation of the agent's final answer across four
 * dimensions. Uses structured output (a zod schema) rather than asking the
 * model to free-format JSON, so scores are always parseable.
 */
export async function judgeAnswer(input: JudgeAnswerInput): Promise<AnswerJudgement> {
  const model = getJudgeModel().withStructuredOutput(AnswerJudgementSchema);

  const prompt = `You are a strict evaluator of an AI travel assistant's answer. Score the ANSWER on four dimensions, each from 1 (very poor) to 5 (excellent). Be critical - do not default to high scores.

USER QUESTION:
${input.query}

WHAT A CORRECT ANSWER SHOULD CONTAIN (evaluation criteria, not a literal template):
${input.expectedAnswerCriteria}

CONTEXT THE ASSISTANT HAD AVAILABLE (retrieved knowledge-base passages and/or MCP tool results - use this to judge faithfulness; the answer should not state facts that contradict or go beyond this):
${input.supportingContext || "(no supporting context was retrieved/returned)"}

THE ASSISTANT'S ACTUAL ANSWER:
${input.actualAnswer}

Score:
- correctness: factual accuracy against the criteria and context.
- relevance: does it address the actual question asked.
- completeness: does it cover the expected key points.
- faithfulness: is every claim traceable to the supporting context (no hallucination). If the context is empty/an error and the answer correctly says so instead of inventing an answer, that counts as highly faithful.`;

  const result = await model.invoke(prompt);

  return {
    correctness: toJudgeScore(result.correctness),
    relevance: toJudgeScore(result.relevance),
    completeness: toJudgeScore(result.completeness),
    faithfulness: toJudgeScore(result.faithfulness),
  };
}

export interface JudgeRetrievalInput {
  query: string;
  retrievedContext: string;
}

/**
 * LLM-judged qualitative relevance of the retrieved RAG context to the
 * query - complements the deterministic precision/recall metrics, which
 * only check source *titles* and can't tell whether a chunk from a
 * correctly-titled source was actually the relevant part of it.
 */
export async function judgeRetrievalRelevance(input: JudgeRetrievalInput): Promise<JudgeScore> {
  const model = getJudgeModel().withStructuredOutput(
    makeScoreSchema("Relevance of the retrieved context to the query, 1-5.")
  );

  const prompt = `You are evaluating a RAG system's retrieval step. Score from 1 (irrelevant) to 5 (highly relevant) how useful the RETRIEVED CONTEXT below is for answering the QUERY. Penalize context that is off-topic, or that is missing the specific information the query asks for.

QUERY:
${input.query}

RETRIEVED CONTEXT:
${input.retrievedContext || "(nothing was retrieved)"}`;

  const result = await model.invoke(prompt);
  return toJudgeScore(result);
}
