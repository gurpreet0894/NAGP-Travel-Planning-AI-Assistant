import express from "express";
import cors from "cors";
import { v4 as uuidv4 } from "uuid";
import { config } from "../config.js";
import { createAppRuntime } from "../agent/bootstrap.js";
import { askTravelAgent } from "../agent/agent.js";
import { ConversationMemoryStore } from "../agent/memory.js";

async function main() {
  console.log("Loading vector store ...");
  console.log("Starting MCP servers (weather, currency) ...");
  console.log("Building the travel-planning agent ...");
  const { executor, shutdown: shutdownRuntime } = await createAppRuntime();

  const memory = new ConversationMemoryStore();

  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use(express.static(config.publicDir));

  app.post("/api/chat", async (req, res) => {
    try {
      const { message, sessionId: incomingSessionId } = req.body as {
        message?: string;
        sessionId?: string;
      };

      if (!message || typeof message !== "string" || !message.trim()) {
        res.status(400).json({ error: "Field 'message' is required." });
        return;
      }

      const sessionId = incomingSessionId ?? uuidv4();
      const history = memory.getHistory(sessionId);

      const answer = await askTravelAgent(executor, message, history);
      memory.append(sessionId, message, answer.text);

      res.json({
        sessionId,
        reply: answer.text,
        toolUsage: answer.toolUsage,
      });
    } catch (error) {
      console.error("Chat request failed:", error);
      res.status(500).json({
        error:
          "The assistant hit an unexpected error handling that request. Please try again.",
      });
    }
  });

  app.post("/api/session/reset", (req, res) => {
    const { sessionId } = req.body as { sessionId?: string };
    if (sessionId) memory.reset(sessionId);
    res.json({ ok: true });
  });

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  const server = app.listen(config.port, () => {
    console.log(`\nAI Travel Planning Assistant listening on http://localhost:${config.port}\n`);
  });

  async function shutdown() {
    console.log("\nShutting down ...");
    server.close();
    await shutdownRuntime();
    process.exit(0);
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
