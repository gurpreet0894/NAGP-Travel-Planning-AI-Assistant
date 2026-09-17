import fs from "node:fs/promises";
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { FaissStore } from "@langchain/community/vectorstores/faiss";
import { config } from "../config.js";

export function createEmbeddings(): GoogleGenerativeAIEmbeddings {
  return new GoogleGenerativeAIEmbeddings({
    apiKey: config.google.apiKey,
    model: config.google.embeddingModel,
  });
}

export async function vectorStoreExists(): Promise<boolean> {
  try {
    await fs.access(config.vectorStoreDir);
    return true;
  } catch {
    return false;
  }
}

export async function loadVectorStore(): Promise<FaissStore> {
  if (!(await vectorStoreExists())) {
    throw new Error(
      `No vector store found at ${config.vectorStoreDir}. Run "npm run ingest" first.`
    );
  }
  return FaissStore.load(config.vectorStoreDir, createEmbeddings());
}
