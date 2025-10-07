// background.js (MV3 service worker)
const MODEL = "gpt-4o-mini"; // or another provider/model

// one-time MCP client with retry logic
let mcp;
let mcpRetryCount = 0;
const MAX_RETRIES = 3;

async function getMCP() {
  if (mcp) return mcp;
  
  try {
    const ws = new WebSocket("ws://127.0.0.1:8719");
    
    // Add timeout to connection attempt
    const connectionTimeout = setTimeout(() => {
      ws.close();
      throw new Error('MCP connection timeout');
    }, 5000);
    
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', () => {
        clearTimeout(connectionTimeout);
        resolve();
      }, { once: true });
      
      ws.addEventListener('error', (e) => {
        clearTimeout(connectionTimeout);
        reject(new Error('MCP connection failed'));
      }, { once: true });
    });
    
    console.log('[MCP] Connected ws://127.0.0.1:8719');
    mcpRetryCount = 0; // reset on successful connection
    
    mcp = {
      call: (method, params) => new Promise((resolve, reject) => {
        const id = Math.random().toString(36).slice(2);
        ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
        const onMsg = (ev) => {
          const msg = JSON.parse(ev.data);
          if (msg.id !== id) return;
          ws.removeEventListener('message', onMsg);
          msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
        };
        ws.addEventListener('message', onMsg);
      })
    };
    
    ws.addEventListener('close', () => {
      console.warn('[MCP] Connection closed');
      mcp = undefined;
    });
    
    ws.addEventListener('error', (e) => {
      console.error('[MCP] WebSocket error', e);
      mcp = undefined;
    });
    
    return mcp;
  } catch (e) {
    console.error('[MCP] Connection failed:', e.message);
    mcp = undefined;
    throw new Error(`MCP server not available: ${e.message}`);
  }
}

async function callLLM({ apiKey, systemPrompt, userPrompt, temperature = 0.4, maxTokens = 300 }) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: MODEL,
      temperature,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ]
    })
  });
  if (!res.ok) throw new Error(`LLM error: ${res.status}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || "";
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      console.log('[BG] Message received', msg?.type, { fromTab: sender?.tab?.id });
      if (msg.type === "LLM_DRAFT_REQUEST") {
        const { question, job, profile, prevQA = [] } = msg.payload;
        const { apiKey, tone = "concise" } = await chrome.storage.sync.get(["apiKey", "tone"]);
        if (!apiKey) throw new Error("Missing API key. Set it in Options.");

        const systemPrompt = `You are an assistant drafting multiple short, targeted answers for a single job application page. Maintain consistency across answers, avoid repeating the same points verbatim, and ensure each answer covers a distinct facet of the candidate's background. Prefer first person, crisp sentences, and concrete details.`;
        const prevBlock = (prevQA || []).map((qa, i) => `Q${i+1}: ${qa.question}\nA${i+1}: ${qa.answer}`).join("\n\n");
        const userPrompt = `
We are on a job application for ${job.company || "(unknown company)"} — role: ${job.title || "(unknown role)"}.
Previously answered on this page (if any):
${prevBlock || "(none)"}

Now draft a ${tone} answer (2-4 sentences) for the following prompt, making sure to avoid repeating prior answers and to cover complementary aspects:
PROMPT: ${question}

Helpful context about me:
- Highlights: ${profile.highlights || ""}
- Resume: ${profile.resume || ""}
- Values: ${profile.values || ""}

Constraints:
- Do not repeat the same examples or phrases from previous answers; use different evidence or angle.
- Keep first person, specific, and tailored to the role and company.
- No placeholders, no buzzwords, no meta commentary about being AI.`;

        const draft = await callLLM({ apiKey, systemPrompt, userPrompt });
        console.log('[BG] Draft generated, length=', draft?.length || 0);
        sendResponse({ ok: true, draft });
      } else if (msg.type === "MCP_EVENT") {
        const client = await getMCP();
        console.log('[BG] Emitting MCP event', msg?.payload?.event);
        await client.call("event/emit", msg.payload);
        sendResponse({ ok: true });
      }
    } catch (e) {
      console.error('[BG] Error handling message', e);
      sendResponse({ ok: false, error: e.message });
    }
  })().catch(e => sendResponse({ ok: false, error: e.message }));
  return true; // keep the message channel open for async
});