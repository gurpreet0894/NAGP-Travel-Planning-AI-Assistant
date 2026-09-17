import { AIMessage, BaseMessage, HumanMessage } from "@langchain/core/messages";

const MAX_TURNS_KEPT = 12;

/**
 * Minimal in-memory, per-session chat history so the assistant supports
 * multi-turn conversation with retained context (e.g. a budget or party
 * size mentioned earlier). Good enough for a single-instance demo app;
 * swap for a persistent store (Redis, DB) for production/multi-instance use.
 */
export class ConversationMemoryStore {
  private sessions = new Map<string, BaseMessage[]>();

  getHistory(sessionId: string): BaseMessage[] {
    return this.sessions.get(sessionId) ?? [];
  }

  append(sessionId: string, humanText: string, aiText: string): void {
    const history = this.sessions.get(sessionId) ?? [];
    history.push(new HumanMessage(humanText), new AIMessage(aiText));

    const excess = history.length - MAX_TURNS_KEPT * 2;
    if (excess > 0) {
      history.splice(0, excess);
    }

    this.sessions.set(sessionId, history);
  }

  reset(sessionId: string): void {
    this.sessions.delete(sessionId);
  }
}
