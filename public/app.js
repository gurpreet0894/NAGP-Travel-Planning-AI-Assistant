const messagesEl = document.getElementById("messages");
const formEl = document.getElementById("chat-form");
const inputEl = document.getElementById("chat-input");
const resetBtn = document.getElementById("reset-btn");
const suggestionsEl = document.getElementById("suggestions");

let sessionId = localStorage.getItem("travel-assistant-session") || null;

function saveSession(id) {
  sessionId = id;
  localStorage.setItem("travel-assistant-session", id);
}

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderInline(text) {
  let out = escapeHtml(text);
  out = out.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "<em>$1</em>");
  out = out.replace(/`(.+?)`/g, "<code>$1</code>");
  return out;
}

// Small, dependency-free renderer for the subset of Markdown the model
// actually produces (headers, bold/italic, bullet/numbered lists, hr,
// paragraphs) - avoids pulling in a client-side library for a "basic UI".
function renderMarkdown(raw) {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const htmlParts = [];
  let paragraphBuffer = [];
  let listBuffer = null; // { type: 'ul' | 'ol', items: string[] }

  function flushParagraph() {
    if (paragraphBuffer.length) {
      htmlParts.push(`<p>${paragraphBuffer.map(renderInline).join("<br>")}</p>`);
      paragraphBuffer = [];
    }
  }

  function flushList() {
    if (listBuffer) {
      const { type, items } = listBuffer;
      htmlParts.push(`<${type}>${items.map((i) => `<li>${renderInline(i)}</li>`).join("")}</${type}>`);
      listBuffer = null;
    }
  }

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed === "") {
      flushParagraph();
      flushList();
      continue;
    }

    if (/^([-*_])\1{2,}$/.test(trimmed)) {
      flushParagraph();
      flushList();
      htmlParts.push("<hr>");
      continue;
    }

    const headerMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (headerMatch) {
      flushParagraph();
      flushList();
      const level = headerMatch[1].length;
      htmlParts.push(`<h${level}>${renderInline(headerMatch[2])}</h${level}>`);
      continue;
    }

    const bulletMatch = trimmed.match(/^[*-]\s+(.*)$/);
    if (bulletMatch) {
      flushParagraph();
      if (!listBuffer || listBuffer.type !== "ul") {
        flushList();
        listBuffer = { type: "ul", items: [] };
      }
      listBuffer.items.push(bulletMatch[1]);
      continue;
    }

    const numberedMatch = trimmed.match(/^\d+\.\s+(.*)$/);
    if (numberedMatch) {
      flushParagraph();
      if (!listBuffer || listBuffer.type !== "ol") {
        flushList();
        listBuffer = { type: "ol", items: [] };
      }
      listBuffer.items.push(numberedMatch[1]);
      continue;
    }

    flushList();
    paragraphBuffer.push(trimmed);
  }

  flushParagraph();
  flushList();

  return htmlParts.join("\n");
}

function addMessage(role, text) {
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  if (role === "ai") {
    div.innerHTML = renderMarkdown(text);
  } else {
    div.textContent = text;
  }
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return div;
}

function describeToolUsage(usage) {
  if (!usage || usage.length === 0) return null;

  const wrapper = document.createElement("div");
  wrapper.className = "tool-badges";

  for (const step of usage) {
    const badge = document.createElement("span");

    if (step.tool === "search_singapore_knowledge_base") {
      const citations = step.output?.citations ?? [];
      badge.className = "badge";
      badge.textContent =
        citations.length > 0
          ? `📚 Knowledge base: ${citations.map((c) => c.title).join(", ")}`
          : "📚 Knowledge base: no relevant sources found";
    } else if (step.tool === "get_weather_forecast" || step.tool === "convert_currency") {
      const ok = step.output?.ok;
      badge.className = ok ? "badge" : "badge error";
      const icon = step.tool === "get_weather_forecast" ? "🌦️" : "💱";
      badge.textContent = ok
        ? `${icon} MCP ${step.tool} ✓`
        : `${icon} MCP ${step.tool} failed: ${step.output?.error ?? "unknown error"}`;
    } else {
      badge.className = "badge";
      badge.textContent = `🔧 ${step.tool}`;
    }

    wrapper.appendChild(badge);
  }

  return wrapper;
}

async function sendMessage(text) {
  addMessage("user", text);
  inputEl.value = "";
  inputEl.disabled = true;

  const typingEl = addMessage("system", "Assistant is thinking...");
  typingEl.classList.add("typing");

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, sessionId }),
    });

    const data = await res.json();
    typingEl.remove();

    if (!res.ok) {
      addMessage("system", data.error || "Something went wrong.");
      return;
    }

    saveSession(data.sessionId);
    const aiEl = addMessage("ai", data.reply);

    const badges = describeToolUsage(data.toolUsage);
    if (badges) aiEl.appendChild(badges);
  } catch (err) {
    typingEl.remove();
    addMessage("system", "Network error - is the server running?");
  } finally {
    inputEl.disabled = false;
    inputEl.focus();
  }
}

formEl.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = inputEl.value.trim();
  if (text) sendMessage(text);
});

suggestionsEl.addEventListener("click", (e) => {
  const target = e.target;
  if (target.tagName === "BUTTON" && target.dataset.q) {
    sendMessage(target.dataset.q);
  }
});

resetBtn.addEventListener("click", async () => {
  if (sessionId) {
    await fetch("/api/session/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId }),
    });
  }
  localStorage.removeItem("travel-assistant-session");
  sessionId = null;
  messagesEl.innerHTML = "";
  addMessage("system", "Started a new conversation.");
});

addMessage(
  "system",
  "Ask about Singapore attractions, culture, transport, weather, currency conversion, or a full itinerary."
);
