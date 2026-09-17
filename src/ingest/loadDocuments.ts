import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import { Document } from "@langchain/core/documents";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { config } from "../config.js";

export interface KnowledgeBaseSourceMeta {
  title: string;
  source_url: string;
  publisher: string;
  retrieved: string;
  topics: string[];
}

/**
 * Loads every markdown file in the knowledge-base directory, keeping the
 * YAML frontmatter (title / source_url / publisher / ...) as metadata so the
 * RAG layer can cite a meaningful source for every answer.
 */
export async function loadKnowledgeBaseDocuments(): Promise<Document[]> {
  const files = (await fs.readdir(config.knowledgeBaseDir)).filter((f) =>
    f.endsWith(".md")
  );

  const documents: Document[] = [];
  for (const file of files) {
    const fullPath = path.join(config.knowledgeBaseDir, file);
    const raw = await fs.readFile(fullPath, "utf-8");
    const parsed = matter(raw);
    const meta = parsed.data as Partial<KnowledgeBaseSourceMeta>;

    documents.push(
      new Document({
        pageContent: parsed.content.trim(),
        metadata: {
          file,
          title: meta.title ?? file,
          source_url: meta.source_url ?? "unknown",
          publisher: meta.publisher ?? "unknown",
          retrieved: meta.retrieved ?? "unknown",
          topics: meta.topics ?? [],
        },
      })
    );
  }

  return documents;
}

/**
 * Splits each source document into overlapping chunks small enough for
 * focused retrieval, while preserving the parent document's source metadata
 * on every chunk (so a retrieved chunk can always be traced back to its
 * title/URL).
 */
export async function chunkDocuments(documents: Document[]): Promise<Document[]> {
  const splitter = RecursiveCharacterTextSplitter.fromLanguage("markdown", {
    chunkSize: config.rag.chunkSize,
    chunkOverlap: config.rag.chunkOverlap,
  });

  const chunks: Document[] = [];
  for (const doc of documents) {
    const docChunks = await splitter.splitDocuments([doc]);
    docChunks.forEach((chunk, index) => {
      chunk.metadata.chunkIndex = index;
    });
    chunks.push(...docChunks);
  }
  return chunks;
}
