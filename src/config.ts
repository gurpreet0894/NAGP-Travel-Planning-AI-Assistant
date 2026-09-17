import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

function requireEnv(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(
      `Missing required environment variable "${name}". Copy .env.example to .env and set it.`
    );
  }
  return value;
}

export const config = {
  projectRoot,
  knowledgeBaseDir: path.join(projectRoot, "data", "knowledge-base"),
  vectorStoreDir: path.join(projectRoot, "vector-store"),
  publicDir: path.join(projectRoot, "public"),
  port: Number(process.env.PORT ?? 3000),

  google: {
    // GOOGLE_API_KEY is only required once the server / ingest script actually
    // needs to call Gemini, not just to import this module.
    get apiKey() {
      return requireEnv("GOOGLE_API_KEY");
    },
    chatModel: process.env.GEMINI_CHAT_MODEL ?? "gemini-2.5-flash",
    embeddingModel: process.env.GEMINI_EMBEDDING_MODEL ?? "gemini-embedding-001",
  },

  rag: {
    chunkSize: 900,
    chunkOverlap: 150,
    topK: 5,
  },
};
