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
  const company = (document.querySelector('[data-company], .company, .company-name, [data-testid="company-name"]')?.innerText || '').trim();
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
  return { title, company, description };
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

  chrome.storage.sync.get(['profile'], ({ profile = {} }) => {
    chrome.runtime.sendMessage(
      { type: 'LLM_DRAFT_REQUEST', payload: { question, job, profile } },
      (res) => {
        try {
          if (!res?.ok) throw new Error(res?.error || 'Unknown error');

          let draft = res.draft || '';

          // respect maxlength if present
          const limit = parseInt(field.getAttribute('maxlength') || '0', 10) || 0;
          if (limit && draft.length > limit) draft = draft.slice(0, Math.max(0, limit - 1)) + '…';

          setFieldValue(field, draft);

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