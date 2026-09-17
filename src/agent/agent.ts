import { createAgent } from "langchain";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { AIMessage, BaseMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { FaissStore } from "@langchain/community/vectorstores/faiss";
import { config } from "../config.js";
import { SYSTEM_PROMPT } from "./prompt.js";
import { createKnowledgeBaseTool } from "../rag/ragTool.js";
import { createMcpLangChainTools } from "../mcp/tools.js";
import type { McpToolProvider } from "../mcp/client.js";

export interface ToolUsageRecord {
  tool: string;
  input: unknown;
  output: unknown;
}

export interface AgentAnswer {
  text: string;
  toolUsage: ToolUsageRecord[];
}

/**
 * Built on `createAgent` from the `langchain` package (the current,
 * non-deprecated agent API, backed by @langchain/langgraph under the hood)
 * rather than the older `createToolCallingAgent` + `AgentExecutor` pair.
 *
 * Why this matters here: Gemini 3.x models require the `thoughtSignature`
 * token attached to a function call to be echoed back on the next turn.
 * The older agent stack (and even a hand-rolled loop on top of
 * @langchain/google-genai@0.2.x) had no code path that preserved this
 * provider-specific field when replaying tool-call history, so 3.x models
 * failed with "Function call is missing a thought_signature". This project
 * now depends on @langchain/google-genai@2.x + @langchain/core@1.x, the
 * generation of these libraries built to carry that field through
 * correctly, and `createAgent` is the API that generation ships as current.
 */
export type TravelAgent = ReturnType<typeof createAgent>;

export async function createTravelAgentExecutor(
  vectorStore: FaissStore,
  mcpProvider: McpToolProvider
): Promise<TravelAgent> {
  const model = new ChatGoogleGenerativeAI({
    apiKey: config.google.apiKey,
    model: config.google.chatModel,
    temperature: 0.3,
  });

  const tools: StructuredToolInterface[] = [
    createKnowledgeBaseTool(vectorStore),
    ...createMcpLangChainTools(mcpProvider),
  ];

  return createAgent({
    model,
    tools,
    systemPrompt: SYSTEM_PROMPT,
  });
}

function extractText(message: BaseMessage): string {
  if (typeof message.content === "string") return message.content;
  if (Array.isArray(message.content)) {
    return message.content
      .map((part) => (typeof part === "string" ? part : (part as { text?: string }).text ?? ""))
      .join("");
  }
  return String(message.content ?? "");
}

function parseMaybeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Reconstructs a flat [{tool, input, output}] list from the agent's full
 * message trace: each AIMessage's `tool_calls` gives the tool name + args,
 * each matching ToolMessage (joined by `tool_call_id`) gives the result.
 */
function extractToolUsage(messages: BaseMessage[]): ToolUsageRecord[] {
  const callById = new Map<string, { tool: string; input: unknown }>();
  for (const message of messages) {
    if (message instanceof AIMessage) {
      for (const call of message.tool_calls ?? []) {
        callById.set(call.id ?? "", { tool: call.name, input: call.args });
      }
    }
  }

  const usage: ToolUsageRecord[] = [];
  for (const message of messages) {
    if (message instanceof ToolMessage) {
      const matched = callById.get(message.tool_call_id ?? "");
      const contentText =
        typeof message.content === "string" ? message.content : JSON.stringify(message.content);
      usage.push({
        tool: matched?.tool ?? message.name ?? "unknown",
        input: matched?.input,
        output: parseMaybeJson(contentText),
      });
    }
  }
  return usage;
}

export async function askTravelAgent(
  agent: TravelAgent,
  input: string,
  chatHistory: BaseMessage[]
): Promise<AgentAnswer> {
  const result = await agent.invoke({
    messages: [...chatHistory, new HumanMessage(input)],
  });

  const messages = result.messages as BaseMessage[];
  const lastMessage = messages[messages.length - 1];

  return {
    text: extractText(lastMessage),
    toolUsage: extractToolUsage(messages),
  };
}
