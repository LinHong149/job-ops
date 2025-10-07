// background.js (MV3 service worker)
const MODEL = "gpt-4o-mini"; // or another provider/model

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
      if (msg.type === "LLM_DRAFT_REQUEST") {
        const { question, job, profile } = msg.payload;
        const { apiKey, tone = "concise" } = await chrome.storage.sync.get(["apiKey", "tone"]);
        if (!apiKey) throw new Error("Missing API key. Set it in Options.");

        const systemPrompt = `You help candidates draft brief, specific answers for job applications. Write in first person, crisp sentences. Avoid fluff.`;
        const userPrompt = `
Question: ${question}

Write a ${tone} answer (2-4 sentences) tailored to:
- Company: ${job.company || "(unknown)"}
- Role: ${job.title || "(unknown)"}
- Highlights from my background: ${profile.highlights || ""}
- Resume summary: ${profile.resume || ""}
- Values/interests: ${profile.values || ""}

Use concrete links between role impact and my experience. No placeholders. Avoid repeating the question. Avoid generic buzzwords. Do not mention that you are an AI.`;

        const draft = await callLLM({ apiKey, systemPrompt, userPrompt });
        sendResponse({ ok: true, draft });
      }
    } catch (e) {
      sendResponse({ ok: false, error: e.message });
    }
  })();
  return true; // keep the message channel open for async
});