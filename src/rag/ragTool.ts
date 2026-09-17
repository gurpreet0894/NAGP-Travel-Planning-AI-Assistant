import { z } from "zod";
import { tool } from "@langchain/core/tools";
import type { FaissStore } from "@langchain/community/vectorstores/faiss";
import { config } from "../config.js";

export interface RagCitation {
  title: string;
  sourceUrl: string;
  publisher: string;
}

export interface RagLookupResult {
  formattedContext: string;
  citations: RagCitation[];
  matchCount: number;
}

/**
 * Runs a similarity search against the Singapore knowledge base and formats
 * the retrieved chunks (with their source title/URL) into a single string
 * the LLM can ground its answer in.
 */
export async function lookupKnowledgeBase(
  store: FaissStore,
  query: string
): Promise<RagLookupResult> {
  const results = await store.similaritySearchWithScore(query, config.rag.topK);

  const citationsMap = new Map<string, RagCitation>();
  const blocks: string[] = [];

  for (const [doc, score] of results) {
    const title = String(doc.metadata.title ?? "Unknown source");
    const sourceUrl = String(doc.metadata.source_url ?? "unknown");
    const publisher = String(doc.metadata.publisher ?? "unknown");
    citationsMap.set(sourceUrl, { title, sourceUrl, publisher });

    blocks.push(
      `Source: ${title} (${sourceUrl})\nRelevance score: ${score.toFixed(3)}\n${doc.pageContent}`
    );
  }

  return {
    formattedContext:
      blocks.length > 0
        ? blocks.join("\n\n---\n\n")
        : "No relevant passages were found in the Singapore knowledge base for this query.",
    citations: Array.from(citationsMap.values()),
    matchCount: results.length,
  };
}

/**
 * Wraps the knowledge-base lookup as a LangChain tool the tool-calling agent
 * can invoke whenever a question is about stable destination knowledge
 * (attractions, neighbourhoods, transport, culture, food, itineraries) rather
 * than current/time-sensitive information.
 */
export function createKnowledgeBaseTool(store: FaissStore) {
  return tool(
    async ({ query }: { query: string }) => {
      const result = await lookupKnowledgeBase(store, query);
      return JSON.stringify(result);
    },
    {
      name: "search_singapore_knowledge_base",
      description:
        "Searches the Singapore travel knowledge base (Wikivoyage and Wikipedia articles " +
        "covering attractions, neighbourhoods, transportation, culture, food, and sample " +
        "itineraries). Use this for ANY question about destination facts, attractions, " +
        "things to do, neighbourhoods, culture, or itinerary planning. Do NOT use this for " +
        "current weather or currency exchange rates - those require the other tools. Returns " +
        "a JSON object with 'formattedContext' (grounded passages with their sources) and " +
        "'citations' (title + source_url for every source used).",
      schema: z.object({
        query: z
          .string()
          .describe(
            "A focused natural-language search query describing the destination information needed, e.g. 'family-friendly indoor attractions' or 'transportation options for tourists'."
          ),
      }),
    }
  );
}
