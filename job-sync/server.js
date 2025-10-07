import { WebSocketServer } from "ws";
import fetch from "node-fetch";
import { JSDOM } from "jsdom";
import { CronJob } from "cron";

// ==== ENV ====
const {
  NOTION_TOKEN,
  NOTION_DB_ID,
  DISCORD_WEBHOOK_URL,
  GMAIL_CLIENT_ID,
  GMAIL_CLIENT_SECRET,
  GMAIL_REFRESH_TOKEN,
  GMAIL_LABEL_OA = "OA",
  GMAIL_LABEL_INTERVIEW = "Interview",
  GMAIL_LABEL_REJECTED = "Rejected",
  MCP_WS_PORT = "8719",
  CRON_GMAIL = "*/5 * * * *",
  CRON_WEEKLY_ANALYTICS = "0 18 * * SUN",
} = process.env;

// ========= Utilities =========
const reply = (ws, id, result, error) =>
  ws.send(JSON.stringify({ jsonrpc: "2.0", id, result, error }));

const discord = async (content) => {
  if (!DISCORD_WEBHOOK_URL) return;
  await fetch(DISCORD_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  }).catch(() => {});
};

const trim = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + "…" : s || "");

// ========= Notion =========
const NOTION_PROPS = {
  NAME: "Name",                 // Title
  ROLE: "Role",                 // Rich text
  DATE_APPLIED: "Date Applied", // Date
  STATUS: "Status"              // Select
};

// Accepted Status options in your DB
const NOTION_STATUS = {
  APPLIED: "Applied",
  OA: "Online Assessment",
  OA_COMPLETE: "OA Complete",
  NOPE: "Nope",
  INT_COMPLETED: "Interview Completed",
  INT_SCHEDULED: "Interview Scheduled",
  OFFER: "Offer Recieved" // spelling per user's schema
};
async function notionQuery(filter) {
  const res = await fetch(`https://api.notion.com/v1/databases/${NOTION_DB_ID}/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${NOTION_TOKEN}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(filter || {}),
  });
  if (!res.ok) throw new Error(`Notion query ${res.status}`);
  return res.json();
}

async function notionIterAll(handler) {
  let cursor = undefined;
  while (true) {
    const body = cursor ? { start_cursor: cursor, page_size: 100 } : { page_size: 100 };
    const r = await fetch(`https://api.notion.com/v1/databases/${NOTION_DB_ID}/query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${NOTION_TOKEN}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`Notion iterate ${r.status}`);
    const json = await r.json();
    for (const page of json.results || []) {
      const cont = await handler(page);
      if (cont === false) return page;
    }
    if (!json.has_more) return null;
    cursor = json.next_cursor;
  }
}

function extractTitleLink(page) {
  try {
    const title = page.properties?.[NOTION_PROPS.NAME]?.title || [];
    for (const blk of title) {
      const url = blk?.text?.link?.url;
      if (url) return url.trim();
    }
  } catch {}
  return "";
}

async function findPageByTitleLink(url) {
  const target = (url || "").trim();
  if (!target) return null;
  let found = null;
  await notionIterAll((page) => {
    if (extractTitleLink(page) === target) {
      found = page;
      return false;
    }
    return true;
  });
  return found;
}

function buildPropertiesFromApp(app) {
  const status = app.status || NOTION_STATUS.APPLIED;
  return {
    [NOTION_PROPS.NAME]: {
      title: [{
        type: "text",
        text: { content: app.company || "Unknown", link: app.url ? { url: app.url } : null }
      }]
    },
    [NOTION_PROPS.ROLE]: { rich_text: [{ type: "text", text: { content: app.role || "" } }] },
    [NOTION_PROPS.DATE_APPLIED]: { date: { start: app.submittedAt || new Date().toISOString() } },
    [NOTION_PROPS.STATUS]: { select: { name: status } },
  };
}

async function notionCreateOrUpdate(app) {
  const props = buildPropertiesFromApp(app);
  const existing = await findPageByTitleLink(app.url || "");
  if (existing) {
    const id = existing.id;
    const r = await fetch(`https://api.notion.com/v1/pages/${id}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${NOTION_TOKEN}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ properties: props }),
    });
    if (!r.ok) throw new Error(`Notion update ${r.status}`);
    return { action: "updated", pageId: id };
  }
  const r = await fetch(`https://api.notion.com/v1/pages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${NOTION_TOKEN}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      parent: { database_id: NOTION_DB_ID },
      properties: props,
      children: app.description
        ? [{
            object: "block",
            type: "paragraph",
            paragraph: { rich_text: [{ type: "text", text: { content: trim(app.description, 1800) } }] }
          }]
        : []
    }),
  });
  if (!r.ok) throw new Error(`Notion create ${r.status}`);
  const json = await r.json();
  return { action: "created", pageId: json.id };
}

async function notionSetStatusByGuess({ company, role, url, jobId, status, note, updateAllCompany = false }) {
  if (updateAllCompany && company) {
    // Update ALL applications from this company
    console.log(`[NOTION] Updating all applications from company: ${company} to status: ${status}`);
    
    let cursor = undefined;
    let updatedCount = 0;
    
    while (true) {
      const body = cursor ? { start_cursor: cursor, page_size: 100 } : { page_size: 100 };
      const r = await fetch(`https://api.notion.com/v1/databases/${NOTION_DB_ID}/query`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${NOTION_TOKEN}`,
          "Notion-Version": "2022-06-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      
      if (!r.ok) throw new Error(`Notion query ${r.status}`);
      const json = await r.json();
      
      // Find all pages from this company (flexible matching)
      const companyPages = json.results.filter(page => {
        const title = page.properties?.[NOTION_PROPS.NAME]?.title?.[0]?.text?.content || '';
        const titleLower = title.toLowerCase();
        const companyLower = company.toLowerCase();
        
        // Direct match
        if (titleLower.includes(companyLower)) return true;
        
        // Split company name into words and check if all words are present
        const companyWords = companyLower.split(/\s+/).filter(word => word.length > 2);
        if (companyWords.length > 1) {
          const allWordsMatch = companyWords.every(word => titleLower.includes(word));
          if (allWordsMatch) return true;
        }
        
        // Special cases for common variations
        if (companyLower.includes('mongodb') && titleLower.includes('mongo')) return true;
        if (companyLower.includes('microsoft') && titleLower.includes('msft')) return true;
        if (companyLower.includes('google') && titleLower.includes('alphabet')) return true;
        
        return false;
      });
      
      // Update each page
      for (const page of companyPages) {
        const patch = await fetch(`https://api.notion.com/v1/pages/${page.id}`, {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${NOTION_TOKEN}`,
            "Notion-Version": "2022-06-28",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            properties: { [NOTION_PROPS.STATUS]: { select: { name: status } } }
          }),
        });
        
        if (patch.ok) {
          updatedCount++;
          console.log(`[NOTION] Updated page ${page.id} (${page.properties?.[NOTION_PROPS.NAME]?.title?.[0]?.text?.content})`);
          
          // Add note if provided
          if (note) {
            await fetch(`https://api.notion.com/v1/blocks/${page.id}/children`, {
              method: "PATCH",
              headers: {
                Authorization: `Bearer ${NOTION_TOKEN}`,
                "Notion-Version": "2022-06-28",
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                children: [{
                  object: "block",
                  type: "paragraph",
                  paragraph: { rich_text: [{ type: "text", text: { content: note } }] }
                }]
              })
            }).catch(() => {});
          }
        }
      }
      
      if (!json.has_more) break;
      cursor = json.next_cursor;
    }
    
    return { ok: true, updatedCount, action: "company_wide_update" };
  } else {
    // Original single-page update logic
    let page = null;
    if (url) page = await findPageByTitleLink(url).catch(() => null);
    if (!page) {
      const q = await notionQuery({
        filter: {
          and: [
            { property: NOTION_PROPS.NAME, title: { contains: company || "" } },
            { property: NOTION_PROPS.ROLE, rich_text: { contains: role || "" } }
          ]
        }
      });
      if (!q.results?.length) return { ok: false, reason: "no_match" };
      page = q.results[0];
    }
    const id = page.id;

    const patch = await fetch(`https://api.notion.com/v1/pages/${id}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${NOTION_TOKEN}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        properties: { [NOTION_PROPS.STATUS]: { select: { name: status } } }
      }),
    });
    if (!patch.ok) throw new Error(`Notion set status ${patch.status}`);

    if (note) {
      await fetch(`https://api.notion.com/v1/blocks/${id}/children`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${NOTION_TOKEN}`,
          "Notion-Version": "2022-06-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          children: [{
            object: "block",
            type: "paragraph",
            paragraph: { rich_text: [{ type: "text", text: { content: note } }] }
          }]
        })
      }).catch(() => {});
    }
    return { ok: true, pageId: id };
  }
}

// ========= Gmail (polling with refresh token) =========
// Minimal Gmail calls: list unread, classify by subject/body, label & mark read.
// You must pre-create label IDs or just mark read.
// For brevity we implement a simple unread search and mark read; extend as needed.
async function gmailAccessToken() {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GMAIL_CLIENT_ID,
      client_secret: GMAIL_CLIENT_SECRET,
      refresh_token: GMAIL_REFRESH_TOKEN,
      grant_type: "refresh_token"
    })
  });
  const json = await res.json();
  console.log('[GMAIL] Token response:', res.status, json);
  if (!json.access_token) throw new Error(`gmail token error: ${json.error || 'unknown'}`);
  return json.access_token;
}

async function gmailListUnread(accessToken) {
  // Check primary inbox only - use category:primary to get exactly primary tab emails
  const q = encodeURIComponent("is:unread category:primary");
  const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${q}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!r.ok) {
    const errorText = await r.text();
    console.warn('[GMAIL] list unread failed', r.status, errorText);
    return { messages: [] };
  }
  const json = await r.json();
  console.log('[GMAIL] primary inbox unread count', json.messages?.length || 0);
  return json;
}

async function gmailGetMessage(accessToken, id) {
  const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const json = await r.json();
  return json;
}

function gmailGetHeader(payload, name) {
  return payload.headers?.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || "";
}

function classifyEmail(subject, body) {
  const s = subject.toLowerCase();
  const b = body.toLowerCase();
  const combined = s + " " + b;
  
  // Debug: log what we're checking
  console.log('[GMAIL] Classifying:', { subject: s.slice(0, 50), body: b.slice(0, 100) });
  
  // Very strict OA detection - only specific assessment platforms
  const oaKeywords = [
    'codility', 'hackerrank', 'codesignal', 
    'online assessment', 'technical assessment', 'coding challenge', 
    'programming test', 'assessment test', 'coding test', 'algorithm test',
    'take-home challenge', 'technical challenge'
  ];
  
  // Must contain one of these specific terms
  const hasOaKeyword = oaKeywords.some(keyword => {
    const found = combined.includes(keyword);
    if (found) console.log('[GMAIL] OA keyword found:', keyword);
    return found;
  });
  if (hasOaKeyword) {
    return "OA";
  }
  
  // Interview detection - look for scheduling/interview keywords (but exclude "interview prep" marketing and thank you emails)
  const interviewMatch = /(schedule.*interview|interview.*schedule|availability.*interview|next steps.*interview|recruiter screen|phone screen|video interview|onsite interview|interview invitation|interview confirmation|interview request|interview call|interview meeting)/i.test(combined);
  if (interviewMatch && !/(thank you|thanks|application received|application submitted)/i.test(combined)) {
    console.log('[GMAIL] Interview pattern matched');
    return "Interview";
  }
  
  // Rejection detection - look for clear rejection language
  const rejectionMatch = /(unfortunately|regret to inform|not moving forward|not selected|not proceeding|rejection|declined|not a fit|position closed|no longer|decided to move forward|other candidates|not advance|not proceed|not continue|filled the position|position has been filled|selected another candidate|update about your application|application update|status update)/i.test(combined);
  if (rejectionMatch) {
    console.log('[GMAIL] Rejection pattern matched');
    return "Rejected";
  }
  
  // Thank you for applying detection
  const thankYouMatch = /(thank you for applying|thanks for applying|thank you for your application|thanks for your application|application received|application submitted)/i.test(combined);
  if (thankYouMatch) {
    console.log('[GMAIL] Thank you pattern matched');
    return "ThankYou";
  }
  
  return null;
}

async function gmailModify(accessToken, id, { markRead, addTrash } = { markRead: false, addTrash: false }) {
  if (addTrash) {
    const del = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}/trash`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    console.log('[GMAIL] moved to trash', id, del.ok);
    return del.ok;
  }
  const body = { removeLabelIds: [], addLabelIds: [] };
  if (markRead) body.removeLabelIds.push("UNREAD");
  const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}/modify`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  console.log('[GMAIL] modify', id, r.ok, { markRead });
  return r.ok;
}

function parseBody(parts) {
  // quick text/plain scrape
  if (!parts) return "";
  for (const p of parts) {
    if (p.mimeType === "text/plain" && p.body?.data) {
      return Buffer.from(p.body.data, "base64").toString("utf8");
    }
    if (p.parts) {
      const sub = parseBody(p.parts);
      if (sub) return sub;
    }
  }
  return "";
}

async function gmailPollOnce() {
  if (!GMAIL_CLIENT_ID) return;
  const token = await gmailAccessToken();
  const list = await gmailListUnread(token);

  if (!list.messages) return;

  for (const { id } of list.messages) {
    const msg = await gmailGetMessage(token, id);
    const payload = msg.payload || {};
    const subject = gmailGetHeader(payload, "Subject");
    const from = gmailGetHeader(payload, "From");
    const bodyText = parseBody(payload.parts || []);

    const status = classifyEmail(subject, bodyText);
    console.log('[GMAIL] message', { id, subject: subject.slice(0, 50), from: from.slice(0, 30), status });
    
    if (status === 'Rejected') {
      await gmailModify(token, id, { markRead: true }).catch(()=>{});
      
      // Extract company name from email sender
      const companyMatch = from.match(/^(.+?)\s*<|^(.+?)$/);
      let company = companyMatch ? (companyMatch[1] || companyMatch[2]).trim() : from;
      
      // Clean up company name - remove common suffixes and normalize
      company = company
        .replace(/\s*(recruiting|hr|careers|jobs|talent|hiring|team)\s*$/i, '')
        .replace(/\s*<.*$/, '')
        .trim();
      
      // Special cases for known companies
      if (company.toLowerCase().includes('mongodb')) {
        company = 'MongoDB';
      } else if (company.toLowerCase().includes('microsoft')) {
        company = 'Microsoft';
      } else if (company.toLowerCase().includes('google')) {
        company = 'Google';
      } else if (company.toLowerCase().includes('amazon')) {
        company = 'Amazon';
      } else if (company.toLowerCase().includes('meta')) {
        company = 'Meta';
      } else if (company.toLowerCase().includes('apple')) {
        company = 'Apple';
      }
      
      console.log(`[GMAIL] Extracted company name: "${company}" from sender: "${from}"`);
      
      // Update ALL applications from this company to "Nope"
      const result = await notionSetStatusByGuess({ 
        company, 
        status: NOTION_STATUS.NOPE, 
        note: `Auto from Gmail rejection: ${subject}`,
        updateAllCompany: true 
      }).catch(() => ({ ok: false }));
      
      if (result.ok) {
        await discord(`❌ Rejection detected from **${company}**: **${subject}** — Updated ${result.updatedCount || 1} application(s) to Nope`);
      } else {
        await discord(`❌ Rejection detected: **${subject}** — ${from}`);
      }
    } else if (status === 'ThankYou') {
      // mark as read, notify, but don't delete
      await gmailModify(token, id, { markRead: true }).catch(()=>{});
      await discord(`📧 Thank you email: **${subject}** — ${from}`);
    } else if (status) {
      // keep unread, notify only; map to your schema
      const mapped = status === 'OA' ? NOTION_STATUS.OA : status === 'Interview' ? NOTION_STATUS.INT_SCHEDULED : NOTION_STATUS.APPLIED;
      await discord(`📬 ${mapped} email: **${subject}** — ${from}`);
    } else {
      // non-classified: keep unread, no action
      console.log('[GMAIL] unclassified email (keeping unread):', subject.slice(0, 50));
    }
  }
}

// ========= Weekly Analytics =========
function isoDate(d) { return d.toISOString(); }
function daysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return d; }

async function sendWeeklyAnalytics() {
  // count Applied in the last 7 days by Status bucket
  const since = daysAgo(7);
  const filter = {
    filter: {
      and: [
        { property: NOTION_PROPS.DATE_APPLIED, date: { on_or_after: isoDate(since) } }
      ]
    }
  };
  const q = await notionQuery(filter);
  const rows = q.results || [];
  const total = rows.length;

  const bucket = { [NOTION_STATUS.APPLIED]: 0, [NOTION_STATUS.OA]: 0, [NOTION_STATUS.OA_COMPLETE]: 0, [NOTION_STATUS.INT_SCHEDULED]: 0, [NOTION_STATUS.INT_COMPLETED]: 0, [NOTION_STATUS.OFFER]: 0, [NOTION_STATUS.NOPE]: 0, Other: 0 };
  for (const r of rows) {
    const status = r.properties?.["Status"]?.select?.name || "Other";
    bucket[status] = (bucket[status] || 0) + 1;
  }

  const lines = [
    `📊 **Weekly Applications (last 7 days)**`,
    `Total: **${total}**`,
    `Applied: **${bucket[NOTION_STATUS.APPLIED]}**`,
    `OA: **${bucket[NOTION_STATUS.OA]}**, OA Complete: **${bucket[NOTION_STATUS.OA_COMPLETE]}**, Interview Scheduled: **${bucket[NOTION_STATUS.INT_SCHEDULED]}**, Interview Completed: **${bucket[NOTION_STATUS.INT_COMPLETED]}**, Offer: **${bucket[NOTION_STATUS.OFFER]}**, Nope: **${bucket[NOTION_STATUS.NOPE]}**`
  ];
  await discord(lines.join("\n"));
}

// ========= MCP (JSON-RPC over WS) =========
const wss = new WebSocketServer({ port: Number(MCP_WS_PORT) });
console.log(`✅ MCP listening ws://127.0.0.1:${MCP_WS_PORT}`);

wss.on("connection", (ws) => {
  ws.on("message", async (raw) => {
    let id, method, params;
    try {
      ({ id, method, params } = JSON.parse(raw.toString()));
    } catch {
      return;
    }
    try {
      // From extension: emits when user submits an app
      if (method === "event/emit" && params?.event === "jobapp.submit") {
        const app = params.data || {};
        console.log('[MCP] jobapp.submit', app);
        // Ensure default mapping to your schema
        const payload = {
          company: app.company,
          role: app.role,
          url: app.url,
          submittedAt: app.submittedAt,
          status: app.status || NOTION_STATUS.APPLIED
        };
        const res = await notionCreateOrUpdate(payload);
        console.log(`[MCP] Application logged: ${app.company || "Unknown"} — ${app.role || ""} (${res.action})`);
        return reply(ws, id, res);
      }

      // Manual tools you can call if needed
      if (method === "tool/notion.upsert_application") {
        const r = await notionCreateOrUpdate(params.app);
        return reply(ws, id, r);
      }

      if (method === "tool/notion.set_status") {
        const r = await notionSetStatusByGuess(params);
        return reply(ws, id, r);
      }

      if (method === "tool/analytics.weekly") {
        await sendWeeklyAnalytics();
        return reply(ws, id, { ok: true });
      }

      if (method === "tool/gmail.poll") {
        await gmailPollOnce();
        return reply(ws, id, { ok: true });
      }

      return reply(ws, id, null, { code: -32601, message: "Method not found" });
    } catch (e) {
      return reply(ws, id, null, { code: -32000, message: e.message });
    }
  });
});

// ========= Cron jobs =========
new CronJob(CRON_GMAIL, () => gmailPollOnce().catch(()=>{}), null, true, "America/Toronto");
new CronJob(CRON_WEEKLY_ANALYTICS, () => sendWeeklyAnalytics().catch(()=>{}), null, true, "America/Toronto");