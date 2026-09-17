import { FaissStore } from "@langchain/community/vectorstores/faiss";
import { config } from "../config.js";
import { chunkDocuments, loadKnowledgeBaseDocuments } from "../ingest/loadDocuments.js";
import { createEmbeddings } from "../rag/vectorStore.js";

async function main() {
  console.log(`Loading knowledge-base documents from ${config.knowledgeBaseDir} ...`);
  const documents = await loadKnowledgeBaseDocuments();
  console.log(`Loaded ${documents.length} source document(s).`);

  const chunks = await chunkDocuments(documents);
  console.log(`Split into ${chunks.length} chunk(s). Generating Gemini embeddings ...`);

  const embeddings = createEmbeddings();
  const store = await FaissStore.fromDocuments(chunks, embeddings);

  await store.save(config.vectorStoreDir);
  console.log(`Vector store saved to ${config.vectorStoreDir}`);
}

main().catch((err) => {
  console.error("Ingestion failed:", err);
  process.exit(1);
});
