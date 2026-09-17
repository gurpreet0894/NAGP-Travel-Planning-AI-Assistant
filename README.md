# AI Travel Planning Assistant — Singapore

A context-aware travel assistant that combines a document-based **RAG knowledge base** with
**live MCP tools** (weather + currency), powered by **Google Gemini** for both chat and
embeddings. Built with **Node.js + TypeScript + LangChain**.

> Destination: **Singapore** (As per the Recommendation — public resources are
> plentiful and well suited to RAG).

> **⚠️ Model pinning note:** All captured transcripts (`docs/SAMPLE_QA.md`) and evaluator
> reports (`eval/reports/`) in this submission were generated with
> `GEMINI_CHAT_MODEL=gemini-2.5-flash` (the default in `.env.example`). Tool selection in this
> app is an LLM decision, not hardcoded routing — running with a different Gemini model
> version can legitimately change which tools get called and how the answer is worded.

##  Project Links

### Repository
- GitHub Repository: `https://github.com/gurpreet0894/NAGP-Travel-Planning-AI-Assistant`

### Technical Documentation
- please refer AI_Travel_Planning_Assistant_Technical_Documentation.docx file in the root folder for Techinal Documentation
- [Download Technical Documentation](./AI_Travel_Planning_Assistant_Technical_Documentation.docx)

### Video Demonstration
- [TODO] Video Link to be added

## 1. What it does

- Answers destination questions (attractions, neighbourhoods, transport, culture, food,
  itineraries) grounded in a curated knowledge base, with source citations.
- Answers current-information questions (weather forecast, currency conversion) by calling
  real MCP tools over the Model Context Protocol.
- Combines both in a single answer when a question needs it — e.g. "Plan a 3-day itinerary
  and adjust it for the weather forecast."
- Keeps multi-turn conversational context (e.g. a stated budget or "travelling with children"
  carries over to later turns without repeating it).
- Never fabricates: if the knowledge base has nothing relevant, or an MCP tool call fails, the
  assistant says so explicitly instead of inventing an answer.

> **Apart from the requirements:** This project also includes a self-built **Agent Evaluator** — an automated test harness that runs the real agent against a versioned dataset of
> test cases and scores it on tool-call correctness, RAG retrieval precision/recall, and a
> 4-dimension LLM-judged answer quality check, producing a pass/fail report. It was added because manually typing sample questions proves the happy path works once, by hand — it says nothing about whether a later prompt tweak, a knowledge-base edit, or a model swap quietly breaks tool selection, starts hallucinating a number, or stops citing sources. The evaluator turns that manual, one-off confidence into a reproducible, versioned, numeric report.

## 2. Architecture

```
                     ┌─────────────────────────┐
                     │   Browser chat UI        │  (public/index.html, app.js)
                     └────────────┬─────────────┘
                                  │ POST /api/chat { message, sessionId }
                     ┌────────────▼─────────────┐
                     │  Express server           │  (src/server/index.ts)
                     │  - per-session chat memory │  (src/agent/memory.ts)
                     └────────────┬─────────────┘
                                  │
                     ┌────────────▼─────────────┐
                     │ LangChain createAgent       │  (src/agent/agent.ts)
                     │ (Gemini, via langgraph)    │  (src/agent/prompt.ts)
                     └───┬─────────────┬─────────┘
                         │             │
           ┌─────────────▼───┐   ┌─────▼─────────────────────┐
           │ RAG tool         │   │ MCP tool wrappers          │  (src/mcp/tools.ts)
           │ (FAISS + Gemini  │   │  - get_weather_forecast    │
           │  embeddings)     │   │  - convert_currency        │
           │ (src/rag/*)      │   └─────┬──────────────┬──────┘
           └─────────────┬───┘         │              │
                         │      (MCP stdio protocol)   │
                         │             ▼              ▼
                         │   ┌──────────────┐  ┌──────────────┐
                         │   │ Weather MCP   │  │ Currency MCP  │
                         │   │ server         │  │ server         │
                         │   │ (Open-Meteo)   │  │ (Frankfurter)  │
                         │   └──────────────┘  └──────────────┘
                         ▼
              data/knowledge-base/*.md
              (Wikivoyage + Wikipedia sources)
```

Everything runs as a single Node.js process. The two MCP servers are still genuine,
independent MCP servers — they are spawned as **separate child processes** and communicate
with the main app exclusively over the **stdio MCP transport** (`@modelcontextprotocol/sdk`
`Client` / `McpServer`), so they can equally be run standalone or wired into any other
MCP-compatible host (see `npm run mcp:weather` / `npm run mcp:currency`).

## 3. Knowledge base (RAG)

Five markdown documents in `data/knowledge-base/`, each with YAML frontmatter (`title`,
`source_url`, `publisher`, `retrieved`, `topics`) so every retrieved chunk can be traced back
to a real, citable source:

| File | Source | Covers |
|---|---|---|
| `01-wikivoyage-singapore.md` | [Wikivoyage — Singapore](https://en.wikivoyage.org/wiki/Singapore) | Districts, transport, culture, food, safety, practical tips |
| `02-wikipedia-tourism-in-singapore.md` | [Wikipedia — Tourism in Singapore](https://en.wikipedia.org/wiki/Tourism_in_Singapore) | Attractions, family/nature/culture categories |
| `03-wikipedia-public-transport-in-singapore.md` | [Wikipedia — Public transport in Singapore](https://en.wikipedia.org/wiki/Public_transport_in_Singapore) | MRT, buses, taxis, fares |
| `04-wikipedia-culture-of-singapore.md` | [Wikipedia — Culture of Singapore](https://en.wikipedia.org/wiki/Culture_of_Singapore) | Ethnic groups, festivals, etiquette, food culture |
| `05-compiled-sample-itineraries.md` | Compiled from the four sources above | 3-day itinerary, family/cultural itineraries, indoor vs outdoor activity lists |

The fifth file is explicitly labelled in its frontmatter as a **derived compilation**, not an
independent source — it reorganises facts already present in the other four documents into
itinerary and indoor/outdoor structures, because the RAG requirements ask the assistant to
answer itinerary-style questions directly. This keeps grounding honest: nothing in it isn't
also traceable to a real source above.

### RAG workflow

1. **Load** — `src/ingest/loadDocuments.ts` reads every `.md` file and keeps its frontmatter
   as document metadata.
2. **Chunk** — `RecursiveCharacterTextSplitter.fromLanguage("markdown", …)` splits each
   document into 900-character overlapping chunks (150-char overlap), preserving the parent
   document's metadata on every chunk.
3. **Embed** — each chunk is embedded with Gemini's `gemini-embedding-001` model
   (`src/rag/vectorStore.ts`).
4. **Store** — embeddings are stored in a **FAISS** vector index on disk
   (`@langchain/community`'s `FaissStore`, backed by `faiss-node`), saved to `vector-store/`.
5. **Retrieve** — `src/rag/ragTool.ts` runs `similaritySearchWithScore` (top 5) for each
   query.
6. **Generate** — the retrieved chunks (with source title/URL) are handed to Gemini as tool
   output; the system prompt requires the model to ground its answer in them and cite sources.
7. **Cite** — every RAG-backed answer lists the source titles/URLs used; the chat UI also
   renders a badge under the message.

Run `npm run ingest` any time the knowledge-base files change to rebuild the FAISS index.

### RAG Exposed as an Agent Tool - Design Rationale
  A common, simpler RAG implementation always retrieves from the knowledge base before every model call, then stuffs the retrieved text into the prompt regardless of whether the question actually needs it. This project deliberately does not do that. Instead, the FAISS retriever is wrapped as a named, independently callable LangChain tool  search_singapore_knowledge_base with its own description and input schema, and handed to the same tool-calling agent that also holds the two MCP tools. The model decides, per question, whether to call it at all. 
  
  Given a natural-language query, the tool runs a FAISS similarity search over the ingested knowledge base and returns a JSON payload containing:

  1. **formattedContext** — the retrieved passages, each labelled with its source title and URL, ready to be quoted or grounded against.
  2. **citations** — a de-duplicated list of {title, sourceUrl, publisher} for every source that contributed a passage, used both by the model (to cite sources in respone text) and by the server (to show a knowledge-base badge in the UI, independent of the model's own citation text).
  3. **matchCount** — how many chunks were found, which is what allows the model (and the evaluator) to detect a genuinely empty result and say so honestly.

#### Why This Design, Specifically
  1. **Intent-based invocation**- The agent only searches the knowledge base when a question actually needs destination knowledge. A pure weather or currency question never triggers a retrieval call, and a pure destination question never triggers an MCP call — directly satisfying the requirement that MCP must not be used to answer questions the knowledge base already covers, and vice versa.
  2. **Unified orchestration for combined questions**- Because RAG and the two MCP tools are just three tools available to one agent, a combined question such as “create a 3-day itinerary and adjust it for the weather” is handled by the model naturally calling both the knowledge-base tool and the weather tool in the same turn. No separate, hand-written branch of application logic is needed to detect “this looks like a combined query” — the agent's normal tool-selection behaviour already produces that outcome.
  3. **Transparency, independent of the prose answer**- Because retrieval is a discrete, named tool call rather than invisible prompt construction, its input (the exact search query the model chose) and output (which chunks and sources came back) are recorded as structured data on every request, not just embedded inside the answer text.
  4. **Extensibility**- Swapping the vector store, adding a second knowledge base, or changing the embedding model only means changing what is inside this one tool; the agent's orchestration logic and the other two tools are unaffected.



## 4. MCP tools

Two independent MCP servers, each exposing exactly one tool, connected over stdio
(`src/mcp/client.ts`, `src/mcp/servers/*.ts`):

- **`get_weather_forecast`** (`src/mcp/servers/weatherServer.ts`) — geocodes a place name and
  calls the free [Open-Meteo](https://open-meteo.com/) API for current conditions + up to a
  7-day forecast. No API key required.
- **`convert_currency`** (`src/mcp/servers/currencyServer.ts`) — calls the free
  [Frankfurter](https://www.frankfurter.app/) API (ECB reference rates) to convert between
  ISO-4217 currency codes. No API key required.

Both tools:
- Return a normalised `{ ok, data | error }` shape (`src/mcp/tools.ts`) so the agent can tell
  a genuine result from a failure at a glance.
- Report `isError`/throw on failure (bad location, unsupported currency, network failure,
  HTTP error) rather than ever inventing a number.
- Are wrapped as LangChain tools with descriptions that explicitly tell the model **not** to
  use its own knowledge for weather/rates, and to only use knowledge-base search for stable
  destination facts — this is how the agent avoids using MCP for questions the knowledge base
  already answers, and vice versa.

You can also run either server completely standalone (e.g. to point another MCP client):

```
npm run mcp:weather
npm run mcp:currency
```

## 5. Prompt & context strategy

The full system prompt lives in `src/agent/prompt.ts`. Summary of the strategy:

- **Tool-selection rules** are spelled out explicitly (knowledge base → destination facts;
  weather/currency tools → time-sensitive facts; call both for combined questions) so the
  model doesn't default to guessing from its own training data.
- **Grounding rules** forbid stating a destination fact not present in the retrieved KB
  context, and forbid stating a weather/rate fact not returned by a successful MCP call.
  When context is insufficient or a tool call fails, the model is instructed to say so
  plainly rather than fill the gap.
- **Response structure** asks the model to separate "From the knowledge base" (with
  citations), "Current information (via MCP)" (labelled with the tool used), and
  "Recommendation" (explicitly flagged as the assistant's own synthesis) — so a reader can
  tell fact from AI-generated suggestion at a glance.
- **Conversation memory**: `src/agent/memory.ts` keeps a per-session list of
  `HumanMessage`/`AIMessage` turns (last 12 turns) and feeds it back to the agent via a
  `MessagesPlaceholder("chat_history")`, with an explicit instruction to preserve stated
  preferences (budget, dates, party composition, interests) across turns unless the user
  contradicts them.
- **Tool usage transparency**: the API response includes a `toolUsage` array (which tool ran,
  with what input, and what it returned) alongside the chat reply, and the UI renders it as
  small badges — this is the "identify the sources and tool results used" requirement made
  visible, not just implied by the prose answer.

## 6. Agent Evaluator — automated quality gate *(Additional Feature)*

### Why

This component is developed beyond the minimum requirements. It was added because manually typing sample questions proves the happy path works once, by hand — it says nothing about whether a later prompt tweak, a knowledge-base edit, or a model swap quietly breaks tool selection, starts hallucinating a number, or stops citing sources. The evaluator turns that manual, one-off confidence into a reproducible, versioned, numeric report.

The evaluator (src/eval/*, driven by npm run eval) boots the exact same runtime the web server uses - the same vector store, the same MCP server connections, the same agent instance is shared by both - and drives it through a version-controlled dataset of test cases (eval/dataset.json), each specifying one or more conversational turns, the tool call(s) expected, the arguments expected, and (for RAG-relevant cases) the source titles expected to be retrieved.

### What it checks, per test case

1. **Deterministic tool-call correctness** (`src/eval/matchers.ts`) — no LLM involved, so
   these checks are exact and free:
   - **Call count**: did the agent call the expected number of tools?
   - **Tool selection**: did it call the *right* tools (set comparison, reporting any missing
     or unexpected tool by name)? This is what proves "appropriate tool selection based on
     user intent" rather than just eyeballing the transcript.
   - **Argument correctness**: for each expected call, do the actual arguments match (e.g. did
     `convert_currency` really get `amount: 60000, from: "INR", to: "SGD"`, not some other
     amount silently substituted)?
2. **RAG retrieval quality** (when a test case specifies `expectedSources`):
   - **Precision / recall** (`src/eval/matchers.ts`) — deterministic set overlap between
     the source *titles* the retriever actually returned and the titles the dataset says are
     relevant.
   - **LLM-judged relevance** (`src/eval/judge.ts`) — precision/recall only check *titles*; a
     correctly-titled source can still return an irrelevant chunk. A separate Gemini call
     scores 1–5 how useful the actual retrieved *text* is for the query, catching that gap.
3. **Answer quality, LLM-as-judge on 4 dimensions** (`src/eval/judge.ts`), each scored 1–5
   with a short reasoning string, via **structured output** (a zod schema, not a free-form
   "please return JSON" prompt) so scores are always machine-parseable:
   - **Correctness** — are the factual claims accurate against the retrieved context/tool
     output?
   - **Relevance** — does the answer address what was actually asked?
   - **Completeness** — does it cover the key points the dataset says a correct answer needs?
   - **Faithfulness** — is every claim traceable to the supporting context, with no invented
     facts, numbers, or sources (this is where the two failure-handling test cases — an
     unsupported currency and a fictional place — are scored: correctly saying "I don't know /
     that failed" scores *high* on faithfulness, inventing an answer scores low)?
4. **Verdict**: a test case passes only if the tool-call check is a **full match** *and* every
   judged dimension clears a pass threshold (3/5 by default, `PASS_SCORE_THRESHOLD` in
   `src/eval/runner.ts`). The threshold is applied deterministically in code — the judge model
   only supplies scores, it never gets to decide its own pass/fail.

Multi-turn test cases run their turns sequentially in one session (same as a real
conversation) and only the final turn's tool calls/answer are scored, so the memory-retention
scenario can be evaluated the same way as a single-turn one.

### Dataset

`eval/dataset.json` — a plain, human-editable JSON file (validated against a zod schema on
load), currently with **9 test cases** covering every scenario category the assignment
requires: 3 pure-RAG questions, a weather-only question, a currency-only question, the
required combined RAG+MCP itinerary scenario, the multi-turn budget/children memory scenario,
and both failure-handling requirements (unsupported currency, out-of-scope/fictional
destination question).

### Report

Each run writes a Markdown report and a JSON report to `eval/reports/`,
with:
- An aggregate summary: pass rate, average score per judged dimension, average retrieval
  precision/recall across all RAG cases.
- Full per-case detail: expected vs. actual tools and arguments (with mismatches called out),
  retrieved vs. expected sources, every judge score with its reasoning, and the actual answer
  text — everything needed to see *why* a case passed or failed, not just that it did.

### Running it

```bash
npm run eval                                              # full dataset
npm run eval -- --ids=rag-attractions,mcp-weather-forecast # just these test cases
npm run eval -- --category=rag --delay-ms=3000             # one category, paced out
```

> **Free-tier quota note:** Gemini's free tier can be as restrictive as 20 requests/day for a
> given model, and every test case costs several requests (the agent's own tool-calling turns,
> plus one LLM-judge call per RAG case for retrieval relevance, plus one for the 4-dimension
> answer judgement). On a quota-constrained key, running all 9 cases in one sitting can exceed
> the daily limit — that's a Gemini account limit. The `--ids` / `--category` / `--delay-ms` flags exist specifically so the suite
> can be run in smaller batches, or paced out, on such a key; a paid-tier key has no such
> restriction.

### The benefit, concretely

- **Catches regressions** If a future prompt edit, model swap, or knowledge-base
  change causes the agent to stop calling the weather tool for weather questions, pass the
  wrong amount to the currency tool, or start inventing facts, the suite fails loudly and
  points at exactly which check failed — instead of a user quietly getting a worse answer.
- **Separates "did it look plausible" from "did it technically do the right thing."** An agent
  can call the right tool with a subtly wrong argument (e.g. converting the wrong amount) and
  still produce a fluent, confident-sounding answer that an LLM judge alone might score highly.
  The deterministic tool/argument checks catch that class of bug; the LLM judge catches the
  class of bug deterministic checks can't see (a factually wrong or unfaithful answer built
  from technically-correct tool calls). Running both together, on every test case, is the
  point.

## 7. Tech stack

| Concern | Choice |
|---|---|
| Language / runtime | TypeScript, Node.js 22, `tsx` (dev), `tsc` (build) |
| Orchestration | LangChain (`langchain@1.x` — `createAgent`, backed by `@langchain/langgraph`) |
| LLM | Google Gemini — `gemini-2.5-flash` (`@langchain/google-genai@2.x`)|
| Embeddings | Google Gemini — `gemini-embedding-001` |
| Vector store | FAISS (`@langchain/community` `FaissStore` + `faiss-node`) |
| MCP | `@modelcontextprotocol/sdk` (stdio client + server) |
| Web server / UI | Express + a small vanilla HTML/CSS/JS chat page |

> If you hit a `429` quota error on `gemini-2.5-flash`, that's the Gemini free-tier daily
> request cap — retry later or use a higher-quota/paid key. 

## 8. Setup

### Prerequisites
- Node.js 20+ (developed on Node 22)
- A Google Gemini API key — [aistudio.google.com/apikey](https://aistudio.google.com/apikey)

### Install & configure

```bash
npm install --legacy-peer-deps   # some optional peer deps (typeorm/better-sqlite3) conflict; harmless
cp .env.example .env
# edit .env and set GOOGLE_API_KEY
```

### Build the knowledge base (run once, and again whenever KB files change)

```bash
npm run ingest
```

### Run the app

```bash
npm run dev        # http://localhost:3000, auto-reload
# or
npm run build && npm start
```

Open `http://localhost:3000` and chat. Use "New conversation" to reset session memory.

### Useful scripts

| Script | Purpose |
|---|---|
| `npm run ingest` | Build/rebuild the FAISS vector store from `data/knowledge-base/` |
| `npm run dev` | Start the web app with hot-reload |
| `npm run build` / `npm start` | Compile and run the production build |
| `npm run typecheck` | Type-check without emitting |
| `npm run mcp:weather` / `mcp:currency` | Run an MCP server standalone over stdio |
| `npm run eval` | Run the agent evaluator against `eval/dataset.json` |

## 9. Sample questions & responses

See [`SAMPLE_QA.md`](SAMPLE_QA.md) for real, captured transcripts covering: a pure RAG question, a weather-only question, a currency-only question, combined RAG+MCP scenario, multi-turn memory, and both failure-mode
requirements (unsupported currency, out-of-scope destination question).

## 10. Design notes / trade-offs

- **FAISS over Chroma**: avoids running a separate Chroma server process for a single-user; the index is a flat file under `vector-store/`.
- **stdio MCP transport**: the two MCP servers are spawned via
  `node --import tsx <server>.ts` from the main process (`src/mcp/client.ts`), so no separate
  terminal/process management is required to run the app, while the servers remain fully
  standalone MCP servers usable elsewhere.
- **In-memory session store**: `ConversationMemoryStore` is a simple `Map` — fine for a single
  instance; swap for Redis/a DB for multi-instance deployments.
- **Weather/currency providers**: Open-Meteo and Frankfurter were chosen because they are
  free, keyless, and reliable — appropriate for our usecase.
- **Evaluator uses the same LLM as the app, not a separate "judge model"**: keeps the setup to
  a single API key. The trade-off is a same-model judge can share blind spots with the model
  being judged; for higher-stakes use this would be worth swapping for a different/larger judge
  model, which the evaluator supports by simply pointing `GEMINI_CHAT_MODEL` at a different
  model for the eval run.
- **Pass threshold is a fixed constant (3/5), not per-test-case**: simpler to reason about than
  a configurable-per-case bar, at the cost of not being able to demand a stricter bar for a
  particular test case without editing code.
- **Zero-Fabrication Policy, Enforced and Tested**:
  “Don't invent an answer” is stated in the brief as a requirement, not a suggestion. This project treats it as a testable property in both directions: a knowledge-base gap (a fictional neighbourhood was used as a probe question) and an MCP tool failure (an unsupported currency code) both correctly produce an explicit “I don't have this information” style answer rather than a fabricated one.
- **Markdown-Aware Chat Rendering**:
  The system prompt asks the model to produce clearly structured, sectioned answers, which means the model naturally produces Markdown (headings, bold labels, bullet lists)- the convention any modern LLM uses for “structured text”. A small Markdown-to-HTML renderer was added to the chat UI so that structure is actually rendered- headings, bold, italics, bullet/numbered lists, and section dividers- instead of showing the raw Markdown characters to the user.

## 11. Model version sensitivity

**Pinned versions used for every artifact in this submission:** `GEMINI_CHAT_MODEL=gemini-2.5-flash`
(chat / tool-calling) and `GEMINI_EMBEDDING_MODEL=gemini-embedding-001` (RAG embeddings), as set
in `.env.example` / `.env` and read by `src/config.ts`. Both `docs/SAMPLE_QA.md` and every report
in `eval/reports/` are **captured**, not hand-written, output from this exact configuration.

### Why a model swap can change behaviour here, technically

This app has no hardcoded "if question mentions weather → call weather tool" branching. Tool
selection is delegated entirely to the LLM's own function-calling decision, driven by the
natural-language rules in `src/agent/prompt.ts` (`createAgent` from `langchain`, backed by
`@langchain/langgraph`). That is by design — "RAG Exposed as an Agent Tool - Design
Rationale" — so that adding/changing tools never requires new application-side routing logic.
The direct consequence
is that **the same prompt and the same question can be interpreted differently by different
model generations**, because each generation has its own reasoning depth and instruction-
following strictness. A newer/stronger model may reasonably decide a question needs an
additional tool call that an older model didn't make, or phrase/structure the answer
differently, while still producing a factually correct, grounded response.

- **`eval/dataset.json`'s `expectedToolCalls`** were authored and validated against
  `gemini-2.5-flash`'s actual behaviour on each question. Running `npm run eval` with a
  different `GEMINI_CHAT_MODEL` may therefore show a different pass/fail count on one or more
  cases.
- **`docs/SAMPLE_QA.md`** is live-captured output; a different model will produce different
  exact wording, forecast/exchange-rate numbers (also because those come from live external
  APIs), and potentially a different tool-call pattern for borderline questions like the one
  above.
- **To reproduce this submission's exact results**, keep `GEMINI_CHAT_MODEL=gemini-2.5-flash`
  (already the default in `.env.example`) when running `npm run dev`, `npm run eval`.
- **Changing `GEMINI_EMBEDDING_MODEL`** additionally requires re-running `npm run ingest`, since
  the FAISS index in `vector-store/` stores vectors from one specific embedding model and is not
  interchangeable across embedding models.
