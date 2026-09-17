import { config } from "../config.js";
import { loadVectorStore, vectorStoreExists } from "../rag/vectorStore.js";
import { McpToolProvider } from "../mcp/client.js";
import { createTravelAgentExecutor } from "./agent.js";
import type { TravelAgent } from "./agent.js";
import type { FaissStore } from "@langchain/community/vectorstores/faiss";

export interface AppRuntime {
  vectorStore: FaissStore;
  mcpProvider: McpToolProvider;
  executor: TravelAgent;
  shutdown: () => Promise<void>;
}

/**
 * Boots the same runtime (vector store + MCP servers + tool-calling agent)
 * used by the web server, so the evaluator exercises the exact code path a
 * real user request goes through rather than a re-implementation of it.
 */
export async function createAppRuntime(): Promise<AppRuntime> {
  if (!(await vectorStoreExists())) {
    throw new Error(
      `No vector store found at ${config.vectorStoreDir}. Run "npm run ingest" first.`
    );
  }

  const vectorStore = await loadVectorStore();

  const mcpProvider = new McpToolProvider();
  await mcpProvider.connect();

  const executor = await createTravelAgentExecutor(vectorStore, mcpProvider);

  return {
    vectorStore,
    mcpProvider,
    executor,
    shutdown: () => mcpProvider.close(),
  };
}
