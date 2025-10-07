// === Direct-insert Drafts ===

let lastCall = 0;
const COOLDOWN_MS = 1200;

function isVisible(el) {
  const rect = el.getBoundingClientRect();
  const style = getComputedStyle(el);
  return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
}

function extractJobContext() {
  const title = (document.querySelector('h1, [data-testid="job-title"], .job-title')?.innerText || '').trim();
  
  // Try multiple selectors for company name
  let company = '';
  const companySelectors = [
    '[data-company]', '.company', '.company-name', '[data-testid="company-name"]',
    '[data-testid="company"]', '.employer', '.organization', '.org-name',
    'h2', 'h3', '.header-company', '.job-company', '.company-header'
  ];
  
  for (const selector of companySelectors) {
    const el = document.querySelector(selector);
    if (el?.innerText?.trim()) {
      company = el.innerText.trim();
      break;
    }
  }
  
  // If still no company, try to extract from URL or page title
  if (!company) {
    // Try URL patterns
    const urlMatch = location.href.match(/(?:https?:\/\/)?(?:www\.)?([^\/]+)\.(?:com|org|net|io)/);
    if (urlMatch) {
      const domain = urlMatch[1];
      // Skip common job board domains
      if (!['greenhouse', 'lever', 'workday', 'bamboohr', 'smartrecruiters', 'icims', 'jobvite'].includes(domain.toLowerCase())) {
        company = domain.charAt(0).toUpperCase() + domain.slice(1);
      }
    }
    
    // Try page title
    if (!company && document.title) {
      const titleMatch = document.title.match(/(.+?)\s*[-|]\s*(.+)/);
      if (titleMatch) {
        company = titleMatch[1].trim();
      }
    }
    
    // Try breadcrumbs or navigation
    if (!company) {
      const breadcrumb = document.querySelector('.breadcrumb, .breadcrumbs, nav[aria-label*="breadcrumb"]');
      if (breadcrumb) {
        const links = breadcrumb.querySelectorAll('a');
        for (const link of links) {
          const text = link.innerText.trim();
          if (text && text.length > 2 && text.length < 50) {
            company = text;
            break;
          }
        }
      }
    }
  }
  
  const descNode = document.querySelector(
    '.job-description, [data-testid="job-description"], [class*="description"], [role="main"]'
  );
  let description = descNode ? descNode.innerText : '';
  if (!description || description.length < 400) {
    description = Array.from(document.querySelectorAll('p, li'))
      .slice(0, 120)
      .map(n => n.innerText.trim())
      .join('\n')
      .slice(0, 4000);
  }
  const url = location.href;
  console.log('[CONTENT] Job context extracted', { title, company, url, descLen: (description||'').length });
  return { title, company, description, url };
}

function getQuestionText(field) {
  // label[for=id]
  if (field.id) {
    const lbl = document.querySelector(`label[for="${CSS.escape(field.id)}"]`);
    if (lbl?.innerText?.trim()) return lbl.innerText.trim();
  }
  // close containers common in ATS
  const container = field.closest(`
    .field, .form-group, .QuestionPrompt,
    .application-question, .question, .g-FormField,
    [data-testid="question"], [data-qa="question"]
  `);
  if (container?.innerText?.trim()) return container.innerText.trim();

  // aria-describedby
  const describedBy = field.getAttribute('aria-describedby');
  if (describedBy) {
    for (const id of describedBy.split(/\s+/)) {
      const n = document.getElementById(id);
      if (n?.innerText?.trim()) return n.innerText.trim();
    }
  }
  // fallbacks
  return (field.placeholder || field.getAttribute('aria-label') || '').trim();
}

function isQuestionField(el) {
  if (!(el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement)) return false;
  if (el instanceof HTMLInputElement && (el.type || '').toLowerCase() !== 'text') return false;
  if (!isVisible(el)) return false;

  const q = `${el.name} ${el.id} ${el.placeholder} ${getQuestionText(el)}`.toLowerCase();

  // filter obvious non-essay fields
  if (/first name|last name|email|phone|address|city|state|zip|linkedin|github|portfolio|resume|cv|url/.test(q)) return false;

  // positive cues
  const positive = /why|interest|motivation|join|fit|values|mission|about you|summary|impact|experience|strength|weakness/.test(q);
  const hasQM = q.includes('?');
  return positive || hasQM;
}

// React-controlled safe setter
function setFieldValue(field, value) {
  const proto = Object.getPrototypeOf(field);
  const setter =
    Object.getOwnPropertyDescriptor(proto, 'value')?.set ||
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set ||
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;

  setter?.call(field, value);
  field.dispatchEvent(new Event('input', { bubbles: true }));
  field.dispatchEvent(new Event('change', { bubbles: true }));
}

// mini inline spinner
function withLoading(btn, on = true) {
  if (on) {
    btn.dataset.prevText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Drafting…';
  } else {
    btn.disabled = false;
    btn.textContent = btn.dataset.prevText || 'Draft with AI';
  }
}

async function draftDirectlyInto(field, btn) {
  if (Date.now() - lastCall < COOLDOWN_MS) return;
  lastCall = Date.now();

  withLoading(btn, true);

  const job = extractJobContext();
  const question = getQuestionText(field);
  // collect prior Q/A on the page to provide context
  const allFields = Array.from(document.querySelectorAll('textarea, input[type="text"]'));
  const prevQA = [];
  for (const f of allFields) {
    if (f === field) continue;
    if (!isQuestionField(f)) continue;
    const val = (f.value || '').trim();
    if (!val) continue;
    const qtext = getQuestionText(f);
    prevQA.push({ question: qtext.slice(0, 300), answer: val.slice(0, 800) });
    if (prevQA.length >= 6) break; // cap to control token usage
  }

  chrome.storage.sync.get(['profile'], ({ profile = {} }) => {
    chrome.runtime.sendMessage(
      { type: 'LLM_DRAFT_REQUEST', payload: { question, job, profile, prevQA } },
      (res) => {
        try {
          if (!res?.ok) throw new Error(res?.error || 'Unknown error');

          let draft = res.draft || '';

          // respect maxlength if present
          const limit = parseInt(field.getAttribute('maxlength') || '0', 10) || 0;
          if (limit && draft.length > limit) draft = draft.slice(0, Math.max(0, limit - 1)) + '…';

          setFieldValue(field, draft);

          // remember this answer for subsequent questions in this page session
          try {
            window.__llmPrevQA = Array.isArray(window.__llmPrevQA) ? window.__llmPrevQA : [];
            window.__llmPrevQA.unshift({ question, answer: draft, url: location.href, at: Date.now() });
            window.__llmPrevQA = window.__llmPrevQA.slice(0, 8);
          } catch {}

          // quick flash to show success
          field.classList.add('llm-flash');
          setTimeout(() => field.classList.remove('llm-flash'), 600);
        } catch (e) {
          // simple error toast near the button
          const note = document.createElement('div');
          note.textContent = `AI draft failed: ${e.message}`;
          note.style.cssText = 'color:#b91c1c;font-size:12px;margin-top:4px;';
          btn.insertAdjacentElement('afterend', note);
          setTimeout(() => note.remove(), 3500);
        } finally {
          withLoading(btn, false);
        }
      }
    );
  });
}

function injectDraftButton(field) {
  if (field.dataset.llmButtonInjected) return;
  field.dataset.llmButtonInjected = '1';

  const btn = document.createElement('button');
  btn.textContent = 'Draft with AI';
  btn.className = 'llm-btn'; // style via styles.css
  btn.type = 'button';
  btn.addEventListener('click', () => draftDirectlyInto(field, btn));
  field.insertAdjacentElement('afterend', btn);
}

function scanAndAttach() {
  const fields = Array.from(document.querySelectorAll('textarea, input[type="text"]'));
  fields.filter(isQuestionField).forEach(injectDraftButton);
}

new MutationObserver(scanAndAttach).observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener('load', scanAndAttach);
scanAndAttach();

// === Submit detection & emit to MCP via background ===
function showToast(message, { success = true, durationMs = 2400 } = {}) {
  try {
    const toast = document.createElement('div');
    toast.textContent = message;
    toast.style.cssText = [
      'position:fixed',
      'right:16px',
      'bottom:16px',
      'z-index:2147483647',
      success ? 'background:#064e3b' : 'background:#7f1d1d',
      success ? 'color:#ecfdf5' : 'color:#fee2e2',
      'padding:10px 12px',
      'border-radius:8px',
      'font:600 13px system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
      'box-shadow:0 6px 16px rgba(0,0,0,.2)',
      'opacity:0',
      'transition:opacity .2s ease, transform .2s ease',
      'transform:translateY(6px)'
    ].join(';');
    (document.body || document.documentElement).appendChild(toast);
    requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateY(0)';
    });
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(6px)';
      setTimeout(() => toast.remove(), 300);
    }, durationMs);
  } catch (e) {
    try { alert(message); } catch {}
  }
}

function submitDataFromPage() {
  const job = extractJobContext();
  const portal = (location.hostname || '').toLowerCase();
  const submittedAt = new Date().toISOString();
  // try finding role/location from headings/labels
  const role = job.title;
  const locationText = (document.querySelector('[data-testid="location"], .location, [class*="location"]')?.innerText || '').trim();
  const jobId = (document.querySelector('[data-job-id], [data-testid="job-id"], .job-id')?.textContent || '').trim();
  return { company: job.company, role, location: locationText, url: job.url, jobId, portal, submittedAt, description: job.description, status: 'Applied' };
}

function attachSubmitListeners() {
  // Avoid unsupported :has() / :contains() / attribute flags in selectors
  let candidates = [];
  try {
    candidates = Array.from(document.querySelectorAll('button, input[type="submit"], [role="button"], a[role="button"]'));
  } catch (e) {
    console.warn('[CONTENT] candidate selector failed', e);
    candidates = Array.from(document.querySelectorAll('button, input'));
  }
  function getLabel(el) {
    return (
      (el.getAttribute('aria-label') || '') + ' ' +
      (el.textContent || '')
    ).trim();
  }
  const buttons = candidates.filter(el => {
    try {
      if (el instanceof HTMLInputElement && (el.type || '').toLowerCase() === 'submit') return true;
      const label = getLabel(el).toLowerCase();
      if (/\bsubmit\b|\bapply\b/.test(label)) return true;
      if (el.querySelector && el.querySelector('[data-icon="send"]')) return true;
      const dataTestId = (el.getAttribute('data-testid') || '').toLowerCase();
      const dataQa = (el.getAttribute('data-qa') || '').toLowerCase();
      if (dataTestId.includes('submit') || dataQa.includes('submit')) return true;
      return false;
    } catch {
      return false;
    }
  });
  console.log('[CONTENT] Found submit/apply candidates:', buttons.length);
  for (const btn of buttons) {
    if (btn.dataset.llmSubmitHooked) continue;
    btn.dataset.llmSubmitHooked = '1';
    btn.addEventListener('click', () => {
      try {
        const data = submitDataFromPage();
        console.log('[CONTENT] Submit clicked, emitting jobapp.submit', data);
        chrome.runtime.sendMessage({ type: 'MCP_EVENT', payload: { event: 'jobapp.submit', data } }, (res) => {
          const runtimeErr = chrome.runtime?.lastError?.message;
          if (runtimeErr || !res?.ok) {
            const message = runtimeErr || res?.error || 'Unknown error';
            console.warn('[CONTENT] MCP emit failed', message);
            // Check if it's a connection issue
            if (message.includes('MCP server not available') || message.includes('connection') || message.includes('timeout')) {
              showToast('⚠️ MCP server not running - start job-sync server', { success: false, durationMs: 4000 });
            } else {
              showToast(`❌ Failed to add to Notion: ${message}`, { success: false, durationMs: 3200 });
            }
          } else {
            console.log('[CONTENT] MCP emit ok');
            showToast('✅ Added to Notion', { success: true, durationMs: 2200 });
          }
        });
      } catch (e) {
        console.error('[CONTENT] Submit handler error', e);
      }
    }, { capture: true });
  }
}

// Global form submit hook (catch-all), so we handle forms even if no button match
function attachFormSubmitHook() {
  if (window.__llmFormHooked) return;
  window.__llmFormHooked = true;
  document.addEventListener('submit', (ev) => {
    try {
      const data = submitDataFromPage();
      console.log('[CONTENT] Form submit detected, emitting jobapp.submit', data);
      chrome.runtime.sendMessage({ type: 'MCP_EVENT', payload: { event: 'jobapp.submit', data } }, (res) => {
        const runtimeErr = chrome.runtime?.lastError?.message;
        if (runtimeErr || !res?.ok) {
          const message = runtimeErr || res?.error || 'Unknown error';
          // Check if it's a connection issue
          if (message.includes('MCP server not available') || message.includes('connection') || message.includes('timeout')) {
            showToast('⚠️ MCP server not running - start job-sync server', { success: false, durationMs: 4000 });
          } else {
            showToast(`❌ Failed to add to Notion: ${message}`, { success: false, durationMs: 3200 });
          }
        } else {
          showToast('✅ Added to Notion', { success: true, durationMs: 2200 });
        }
      });
    } catch (e) {
      console.error('[CONTENT] Global submit handler error', e);
    }
  }, true);
}

window.addEventListener('load', attachSubmitListeners);
new MutationObserver(attachSubmitListeners).observe(document.documentElement, { childList: true, subtree: true });
attachFormSubmitHook();