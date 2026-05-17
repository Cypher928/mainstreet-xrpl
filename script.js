// pdfjs worker
    if (window.pdfjsLib) {
      pdfjsLib.GlobalWorkerOptions.workerSrc =
        "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
    }

// ── Main application ──────────────────────────────────────────────────────
// Set to true locally to enable verbose extraction/reconciliation tracing.
const DEBUG = false;
// ─── Supabase ─────────────────────────────────────────────────────────────────
const SUPABASE_URL      = 'https://zhsuhehgehbzkmzurzyf.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpoc3VoZWhnZWhiemttenVyenlmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4NDkwNDAsImV4cCI6MjA5MTQyNTA0MH0.HUl9ha9hhjIO1F_k8xPkqbZQnWx-ERRGbnmc6KS3lNE';


const { createClient: _sbCreateClient } = window.supabase;
const db = _sbCreateClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession:     true,
    autoRefreshToken:   true,
    detectSessionInUrl: true,
    storage:            window.localStorage,
  },
});

// 🚑 Emergency fallback — never leave the screen blank
setTimeout(() => {
  const login = document.getElementById('loginScreen');
  const app   = document.getElementById('appContent');
  if (login && app && login.style.display === 'none' && app.style.display === 'none') {
    _showLogin();
  }
}, 1000);

// ─── Authentication ───────────────────────────────────────────────────────────
async function _showApp(user) {
  document.getElementById('loginScreen').style.display  = 'none';
  document.getElementById('appContent').style.display   = 'block';
  if (user?.email) document.getElementById('headerUserEmail').textContent = user.email;
}

function _showLogin() {
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('appContent').style.display  = 'none';
}

let _authMode = 'signin'; // 'signin' | 'signup'
let _initialized = false;

function switchAuthTab(mode) {
  _authMode = mode;
  const isSignUp = mode === 'signup';
  document.getElementById('loginTabSignIn').classList.toggle('active', !isSignUp);
  document.getElementById('loginTabSignUp').classList.toggle('active',  isSignUp);
  document.getElementById('loginBtn').textContent = isSignUp ? 'Create Account' : 'Sign In';
  document.getElementById('loginPasswordHint').style.display = isSignUp ? '' : 'none';
  document.getElementById('loginPassword').autocomplete = isSignUp ? 'new-password' : 'current-password';
  document.getElementById('loginMsg').className = 'login-msg';
  document.getElementById('loginMsg').textContent = '';
}

async function submitAuth(event) {
  if (event) event.preventDefault(); // prevent form reload in all browsers


  const email    = (document.getElementById('loginEmail').value    || '').trim();
  const password = (document.getElementById('loginPassword').value || '');
  const btn      = document.getElementById('loginBtn');
  const msgEl    = document.getElementById('loginMsg');

  if (!email) {
    msgEl.className   = 'login-msg error';
    msgEl.textContent = 'Please enter your email address.';
    return;
  }
  if (!password) {
    msgEl.className   = 'login-msg error';
    msgEl.textContent = 'Please enter a password.';
    return;
  }
  if (_authMode === 'signup' && password.length < 6) {
    msgEl.className   = 'login-msg error';
    msgEl.textContent = 'Password must be at least 6 characters.';
    return;
  }

  btn.disabled    = true;
  btn.textContent = _authMode === 'signup' ? 'Creating account…' : 'Signing in…';
  msgEl.className = 'login-msg';
  msgEl.textContent = '';

  let data, error;
  try {
    const attemptAuth = () => _authMode === 'signup'
      ? db.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } })
      : db.auth.signInWithPassword({ email, password });

    const withTimeout = (promise, ms) => Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('__timeout__')), ms)),
    ]);

    // Two attempts: free-tier projects can take 20-30s to wake from pause
    try {
      ({ data, error } = await withTimeout(attemptAuth(), 20000));
    } catch (e) {
      if (e.message !== '__timeout__') throw e;
      msgEl.className   = 'login-msg';
      msgEl.textContent = 'Taking a moment — server is waking up, retrying…';
      ({ data, error } = await withTimeout(attemptAuth(), 25000));
    }
  } catch (e) {
    console.error('[Mainstreet] Auth exception:', e);
    const msg = e.message === '__timeout__'
      ? 'Connection timed out — please try again in a few seconds.'
      : (e.message || 'Network error — please check your connection and try again.');
    msgEl.className   = 'login-msg error';
    msgEl.textContent = msg;
    btn.disabled      = false;
    btn.textContent   = _authMode === 'signup' ? 'Create Account' : 'Sign In';
    return;
  }

  if (error) {
    console.error('[Mainstreet] Auth error:', error);
    msgEl.className   = 'login-msg error';
    msgEl.textContent = error.message || 'Sign-in failed — please check your credentials and try again.';
    // No alert — the inline message is sufficient
    btn.disabled      = false;
    btn.textContent   = _authMode === 'signup' ? 'Create Account' : 'Sign In';
  } else if (_authMode === 'signup') {
    // If email confirmation is disabled, signUp returns a live session immediately
    if (data?.session?.user) {
      _showApp(data.session.user);
      if (!_initialized) { _initialized = true; init(); }
    } else {
      // Switch tab first (it clears loginMsg), then write the success message
      switchAuthTab('signin');
      msgEl.className   = 'login-msg success';
      msgEl.textContent = '✓ Account created! Check your email for a confirmation link, then sign in here.';
      btn.disabled      = false;
    }
  } else if (data?.user) {
    // Explicit show — don't rely solely on onAuthStateChange firing in restricted browsers
    _showApp(data.user);
    if (!_initialized) { _initialized = true; init(); }
  }
}

async function signOut() {
  _initialized = false;
  _showLogin(); // Reset UI immediately — don't wait on Supabase
  try {
    await db.auth.signOut();
  } catch (e) {
    console.warn('[signOut] Supabase error:', e?.message);
  }
}

// Check existing session, then listen for changes
window.addEventListener('load', () => {
  initCamYearSelect();
  db.auth.getSession().then(({ data, error }) => {
    if (error) {
      _showLogin();
      return;
    }
    if (data?.session?.user) {
      _showApp(data.session.user);
      if (!_initialized) { _initialized = true; init(); }
    } else {
      _showLogin();
    }
  }).catch(e => {
    _showLogin();
  });
});

db.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_IN' && session?.user) {
    _showApp(session.user);
    if (!_initialized) {
      _initialized = true;
      init();
    }
  } else if (event === 'SIGNED_OUT') {
    _initialized = false;
    _showLogin();
  }
});

// ─── Constants ────────────────────────────────────────────────────────────────
const MODEL       = 'claude-sonnet-4-6';
const MAX_LEASES  = 3;

// Wraps fetch with a hard client-side abort timeout.
// Vercel Pro maxDuration is 60 s; 58 s gives a clean abort before platform kills the lambda.
function _fetchWithTimeout(url, opts, ms = 58000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

// Single entry-point for every Claude API call.
// Proxies through /api/claude — API key stays server-side.
async function claudeFetch(body) {
  const resp = await _fetchWithTimeout('/api/claude', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  if (!resp.ok) {
    let detail = `HTTP ${resp.status}`;
    try { const b = await resp.json(); detail = b?.error?.message || b?.message || detail; } catch {}
    throw new Error(detail);
  }
  return resp.json();
}

async function explainFetch(body) {
  const resp = await fetch('/api/explain', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  if (!resp.ok) {
    let detail = `HTTP ${resp.status}`;
    try { const b = await resp.json(); detail = b?.error?.message || b?.message || detail; } catch {}
    throw new Error(detail);
  }
  return resp.json();
}

const CAM_EXPLAIN_SYSTEM_PROMPT = `You are an expert in commercial real estate CAM (Common Area Maintenance) charges.

Your job is to help tenants understand charges in a calm, neutral, and practical way — WITHOUT creating unnecessary concern or conflict with landlords.

PRIMARY GOAL:
Make charges feel understandable and normal unless there is a clear reason not to.

CLASSIFY EACH CHARGE AS:
- Looks standard
- Needs clarification
- Potential issue

STRICT CLASSIFICATION RULES:

DEFAULT TO "Looks standard" unless there is a clear and meaningful problem.

DO NOT use "Needs clarification" for:
- Missing dates
- Generic categories like "other"
- Limited detail
- Common vendor types (insurance, landscaping, snow, repairs)

Use "Needs clarification" ONLY if:
- The tenant cannot reasonably understand what the charge is
- OR something directly impacts how much they are paying

Use "Potential issue" ONLY if:
- The charge appears clearly incorrect, duplicated, or unusually high
- OR it violates common CAM practices

TONE RULES:
- Calm, confident, matter-of-fact
- Reassuring, not investigative
- Do NOT imply something is wrong unless it clearly is
- Avoid phrases like:
  - "it might be worth checking"
  - "you may want to verify"
  - "this could be an issue"

QUESTION RULES:
- Do NOT include questions if the charge looks standard
- ONLY include questions if classification is "Needs clarification" or "Potential issue"
- Maximum ONE short, casual question
- Keep it simple and optional

OUTPUT FORMAT:

STATUS: [Looks standard / Needs clarification / Potential issue]

SUMMARY:
One short, plain-English sentence

EXPLANATION:
Clear, confident explanation of what the charge is and why it exists

CONTEXT:
Brief explanation of how this is typically handled in commercial leases

IF NEEDED:
(Optional — only if necessary)
One short, simple question

FINAL RULE:
When in doubt → choose "Looks standard" and do NOT include questions.

If the category appears incorrect based on the vendor or description, gently interpret the charge correctly in your explanation without criticizing the classification.`;

const LANDLORD_SYSTEM_PROMPT = `You are an expert in commercial real estate CAM (Common Area Maintenance) reconciliation.
You are advising a landlord reviewing expenses before sending them to tenants.
Your job is NOT to audit for correctness, but to identify which charges tenants may question and how to make them clearer.
Focus on:
- Clarity
- Presentation
- Reducing tenant confusion and disputes
CLASSIFICATIONS:
- No issues → Clear and typical
- Might get questions → Minor clarity issues
- Likely to be challenged → High risk of pushback
ONLY flag something if it could realistically confuse or concern a tenant.
COMMON TRIGGERS:
- Missing dates
- Vague categories like "other"
- Large or unusual amounts
- Unclear vendor names
TONE:
- Calm
- Professional
- Practical
- Never alarmist
- Never suggest legal wrongdoing
OUTPUT FORMAT:
STATUS: [No issues / Might get questions / Likely to be challenged]
WHY:
One short sentence explaining what a tenant might question
SUGGESTION:
One simple, practical way to improve clarity or reduce pushback
IMPORTANT:
If the charge looks normal, say "No issues" and do not invent problems.
If the category appears incorrect based on the vendor or description, gently interpret the charge correctly in your explanation without criticizing the classification.`;

// WHY single source of truth: previously there were THREE schema definitions
// (CLAUDE_LEASE_SYSTEM, CLAUDE_LEASE_PROMPT, and inline user prompts in each call
// function), each with different field names. This caused Claude to sometimes return
// fields the resolver didn't expect, silently dropping data. Now only this system
// prompt defines the canonical schema; both callClaudeForLease and
// callClaudeWithPdfDirect user prompts align to these exact field names.
// Canonical field set: tenant_name, lease_start_date, lease_end_date,
//   lease_type, sqft, cam_cap.
// The resolver in callClaudeForLease handles aliases (sqft→leased_sqft, etc.)
// for backward compatibility with any previously-cached extraction results.
const CLAUDE_LEASE_SYSTEM = `You are a strict JSON extraction engine for commercial leases.
Return ONLY valid JSON. No text. No explanation. No markdown. Start with { and end with }.

Return exactly this structure:
{
  "tenant_name": string,
  "lease_start_date": "YYYY-MM-DD",
  "lease_end_date": "YYYY-MM-DD",
  "lease_type": string,
  "sqft": number,
  "cam_cap": number
}

Rules:
- tenant_name: HIGHEST PRIORITY. The text may be OCR'd from a scanned document — tolerate spacing/character noise.
  Step 1: Look for labels "Tenant:", "Lessee:", "Occupant:" and take the name that follows.
  Step 2: If no label, find the first entity name with a suffix: LLC, Inc, Corp, Ltd, Co., L.P.
  Step 3: If multiple entities exist, EXCLUDE any containing: Properties, Realty, Real Estate, Holdings, Capital, Investments, Partners, Trust.
  Step 4: Return the most prominent remaining company name.
  NEVER return null if any company name exists anywhere in the text.
- lease_start_date: YYYY-MM-DD. Hierarchy: "Commencement Date" → "Lease Start Date" → "Term begins" → "Effective Date" → "Execution Date". Calculate from context if needed. Never null if any date exists.
- lease_end_date: YYYY-MM-DD. Hierarchy: "Expiration Date" → "Lease End Date" → "Term ends". Calculate from start_date + term length if needed. Never null if start date and term length are both known.
- lease_type: One of "NNN", "Gross", "Modified Gross".
  Explicit: "Triple Net" / "Triple-Net" / "NNN" → "NNN". "Modified Gross" → "Modified Gross". "Gross" → "Gross".
  Inferred: If tenant pays "Pro Rata Share" of taxes + insurance + operating expenses → "NNN".
  If landlord pays operating expenses → "Gross".
  If some expenses split → "Modified Gross". Null only if completely unresolvable.
- sqft: Integer. Strip commas, units, and the word "approximately". Null if not found.
- cam_cap: CRITICAL — you MUST search the entire document for any language that limits CAM or operating expense increases. Look for ALL of the following phrases: "CAM cap", "operating expense cap", "expense stop", "base year stop", "not to exceed", "shall not pay more than", "increases limited to", "capped at", "no more than X% increase", "annual increase cap", "controllable expense cap". If a percentage is found (e.g. "5%" or "5 percent"), return 5. If a dollar amount is found, return that number. Only return null if absolutely no cap-related language exists anywhere in the document.
- Use null only when a field is truly impossible to determine.`;

const INVOICE_PROMPT = `You are extracting data from a commercial real estate invoice or bill.
This document may be a scanned image — tolerate OCR noise, spacing issues, and number formatting quirks.
Return ONLY valid JSON. No explanation. No markdown.

{
  "vendorName": string,
  "amount": number,
  "invoiceDate": "YYYY-MM-DD" or null,
  "category": string,
  "confidence": { "vendorName": 0-100, "amount": 0-100, "invoiceDate": 0-100, "category": 0-100 }
}

RULES:
- vendorName: The company that issued the invoice (top of page, "From:", "Bill From:", or largest company name). Not the property owner.
- amount: Total due / Amount due / Invoice total. Numbers only — strip $, commas. If you see periods used as thousand separators (e.g. "1.200,00") convert correctly. Never null if any dollar amount exists.
- invoiceDate: Invoice date / Bill date / Date issued. YYYY-MM-DD format. Not the due date.
- category: One of: insurance, landscaping, snow, repairs, utilities, janitorial, security, management, other.
  - insurance → any insurance company, premium, policy, or coverage
  - utilities → electric, gas, water, sewer, telecom
  - landscaping → lawn, grounds, irrigation, tree, mulch
  - snow → snow removal, plowing, salting, ice
  - repairs → maintenance, HVAC, plumbing, roof, painting, carpentry
  - janitorial → cleaning, custodial, sanitation
  - security → alarm, guard, monitoring, access control
  - management → property management, admin fee
- confidence: 0 = not found, 100 = explicitly labeled`;

const CATEGORY_PROMPT = `Classify this invoice into ONE category:
[insurance, landscaping, snow, repairs, janitorial, utilities, other]

Prioritize vendor name when obvious (e.g. insurance companies → insurance).

Return JSON:
{ "category": "...", "confidence": 0.0-1.0 }`;

const CATEGORIES = ['insurance','landscaping','snow','repairs','utilities','janitorial','security','management','other'];

// ─── State ────────────────────────────────────────────────────────────────────
// tenantData[i] = null | { tenantName, leasedSqft, capPercentage, excludedCategories, baseYear }
const tenantData  = [null, null, null];
// invoiceData[i] = { vendorName, amount, category, invoiceDate, confidence, _error, fileUrl, fileName, fileType }
const invoiceData = [];
// glData[i] = { date, vendor, category, amount, confidence, _include }
let glData = [];

// ─── Data Model Classes ───────────────────────────────────────────────────────

class Property {
  constructor(name, totalSqFt) {
    this.name = name;
    this.totalSqFt = totalSqFt;
    this.leases = [];
    this.invoices = [];
    this.reconciliations = [];
  }
  addLeases(newLeases)  { this.leases   = this.leases.concat(newLeases);  }
  addInvoices(newInvs)  { this.invoices = this.invoices.concat(newInvs);  }
}

class Lease {
  constructor(tenantName, unitNumber, sqFt, startDate, endDate,
              excludedCategories = [], capPercentage = null, capBaseAmount = null,
              sqFtApproximate = false, baseYear = null, leaseType = null) {
    this.tenantName         = tenantName;
    this.unitNumber         = unitNumber || '';
    this.sqFt               = parseFloat(sqFt) || 0;
    this.startDate          = startDate  || '';
    this.endDate            = endDate    || '';
    this.excludedCategories = excludedCategories.map(c => c.toLowerCase());
    this.capPercentage      = capPercentage !== null ? parseFloat(capPercentage) : null;
    this.capBaseAmount      = capBaseAmount  !== null ? parseFloat(capBaseAmount)  : null;
    this.cap                = this.capPercentage; // direct alias — readable in reconciliation
    this.sqFtApproximate    = !!sqFtApproximate;
    this.baseYear           = baseYear ? parseInt(baseYear) : null;
    this.leaseType          = leaseType || null; // e.g. 'NNN', 'Gross', 'Modified Gross'
  }
}

class Invoice {
  constructor(id, date, amount, vendor, category, description = '') {
    this.id              = id || null;
    this.date            = date     || '';
    this.amount          = parseFloat(amount) || 0;
    this.vendorName      = vendor   || '';  // field matchInvoiceToTenant expects
    this.category        = category || 'other';
    this.invoiceDate     = date     || '';  // field matchInvoiceToTenant expects
    this.description     = description;
    this.matchedTenant   = null;
    this.matchedTenantId = null;
    this.matchConfidence = 0;
    this.matchReason     = '';
  }
}

class ReconciliationResult {
  constructor(tenantName, unitNumber, sqFt, totalAllocated, proRataPercent,
              includedInvoices, capApplied = false, capAdjustment = null) {
    this.tenantName         = tenantName;
    this.unitNumber         = unitNumber || '';
    this.sqFt               = sqFt;
    this.totalAllocated     = totalAllocated;
    this.proRataPercent     = proRataPercent;
    this.includedInvoices   = includedInvoices || [];
    this.capApplied         = capApplied;
    this.capAdjustment      = capAdjustment;
    this.ambiguityFlags     = [];  // populated by runFullReconciliation after construction
    this.status             = totalAllocated > 0 ? 'calculated' : 'needs review';
    const total = this.includedInvoices.reduce((s, inv) => s + (inv.share || 0), 0);
    this.averageConfidence  = total > 0
      ? Math.round(this.includedInvoices.reduce((s, inv) => s + (inv.matchConfidence || 0) * (inv.share || 0), 0) / total)
      : 0;
    // Aliases for lastResults consumers (runCAMAllocation shape compatibility)
    this.name           = tenantName;
    this.allocatedAmount = totalAllocated;
    this.proRata        = proRataPercent / 100;
    this.eligibleCount  = (includedInvoices || []).length;
  }
}

// ─── Portfolio State ──────────────────────────────────────────────────────────
const portfolio = [];
let activePropId = null; // null = portfolio view
let _props = []; // canonical merged array from loadProperties()

// Returns the currently selected property object, or null if none is active.
function currentProperty() {
  if (!activePropId) return null;
  return _props.find(p => p.id === activePropId) || null;
}

// ─── Supabase Storage upload ──────────────────────────────────────────────────

async function uploadInvoiceFile(file) {
  const attempt = async () => {
    const fileBase64 = await toBase64(file);
    const resp = await fetch('/api/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName: file.name, fileType: file.type, fileBase64 }),
    });
    const result = await resp.json();
    if (!resp.ok || result.error) throw new Error(result.error || `HTTP ${resp.status}`);
    return result.url;
  };

  // Retry up to 2 times with backoff — storage timeouts are usually transient
  for (let i = 0; i < 3; i++) {
    try {
      const url = await attempt();
      return { url, error: null };
    } catch (e) {
      if (i < 2) {
        await new Promise(r => setTimeout(r, (i + 1) * 1200));
        continue;
      }
      console.error('[uploadInvoiceFile] failed after 3 attempts:', e.message);
      return { url: null, error: 'cloud-backup-failed' };
    }
  }
}

// ─── Claude API helpers ───────────────────────────────────────────────────────

async function toBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload  = () => res(r.result.split(',')[1]);
    r.onerror = () => rej(new Error('Could not read file — try a different file'));
    r.readAsDataURL(file);
  });
}

function parseJSON(text) {
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('Empty response from API');
  }
  // Strip markdown code fences Claude sometimes wraps around JSON
  const cleaned = text.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new Error('Could not parse API response as JSON');
  }
}

async function callClaude(file, prompt) {
  let base64;
  try {
    base64 = await toBase64(file);
  } catch (e) {
    console.error('[Mainstreet] File read error:', e);
    throw new Error('Could not read file — try a different file');
  }

  // Determine media type — force PDF for non-image files
  const isImage   = file.type.startsWith('image/');
  const mediaType = isImage ? (file.type || 'image/jpeg') : 'application/pdf';

  const contentBlock = isImage
    ? { type: 'image',    source: { type: 'base64', media_type: mediaType, data: base64 } }
    : { type: 'document', source: { type: 'base64', media_type: mediaType, data: base64 } };

  let data;
  try {
    data = await claudeFetch({
      model: MODEL,
      max_tokens: 1024,
      messages: [{ role: 'user', content: [contentBlock, { type: 'text', text: prompt }] }],
    });
  } catch (e) {
    console.error('[Mainstreet] fetch error:', e);
    throw new Error('Could not reach the server — check your connection');
  }

  if (!data || typeof data !== 'object') {
    throw new Error('Extraction failed — try a different file or contact support');
  }

  return data;
}

function applyRawTextFallback(tenants) {
  const MONTHS = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}\b/i;
  tenants.forEach(t => {
    if (!t || !t._rawText) return;
    if (!t.startDate) {
      const match = t._rawText.match(MONTHS);
      if (match) {
        const d = new Date(match[0]);
        if (!isNaN(d)) t.startDate = d.toISOString().split('T')[0];
      }
    }
  });
}

function splitTextByTenant(extractedText, tenants) {
  if (!extractedText || !tenants?.length) return tenants;

  const text = extractedText.replace(/\s+/g, ' ');

  const positions = tenants.map(t => {
    if (!t.tenantName) return null;

    const name = t.tenantName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(name, 'i');
    const match = text.match(regex);

    if (!match) return null;

    return { tenant: t, index: match.index };
  }).filter(Boolean);

  positions.sort((a, b) => a.index - b.index);

  for (let i = 0; i < positions.length; i++) {
    const start = positions[i].index;
    const nextIndex = positions[i + 1]?.index || text.length;
    const extendedEnd = Math.min(nextIndex + 1500, text.length);
    positions[i].tenant._rawText = text.slice(start, extendedEnd);
  }

  return tenants;
}

function enrichLeaseData(data, extractedText) {
  if (!extractedText) return data;
  // Handle array response (new prompt returns [...])
  if (Array.isArray(data)) {
    data.forEach(item => enrichLeaseData(item, extractedText));
    return data;
  }

  const text = extractedText.toLowerCase();

  // --- SQFT (fallback)
  if (!data.leasedSqft) {
    const sqftMatch = extractedText.match(/([\d,]{2,6})\s*(sq\s*ft|square feet)/i);
    if (sqftMatch) {
      data.leasedSqft = parseInt(sqftMatch[1].replace(/,/g, ''));
    }
  }

  // --- START DATE
  if (!data.startDate) {
    const startMatch = extractedText.match(
      /(commence|commencement|start)[^\n]*?(\b\w+ \d{1,2}, \d{4}\b)/i
    );
    if (startMatch) {
      data.startDate = startMatch[2];
    }
  }

  // --- END DATE
  if (!data.endDate) {
    const endMatch = extractedText.match(
      /(expire|expiration|end(?:\s+date)?|terminate)[^\n]*?(\b\w+ \d{1,2}, \d{4}\b)/i
    );
    if (endMatch) {
      data.endDate = endMatch[2];
    }
  }

  // --- TERM FALLBACK
  if (!data.endDate && data.startDate) {
    const termMatch = extractedText.match(/(\d+)\s*\(?\d*\)?\s*year/i);
    if (termMatch) {
      const years = parseInt(termMatch[1]);
      const start = new Date(data.startDate);
      if (!isNaN(start)) {
        start.setFullYear(start.getFullYear() + years);
        data.endDate = start.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric'
        });
      }
    }
  }

  // --- START DATE ("on or about" fallback)
  if (!data.startDate) {
    const match = extractedText.match(/on or about ([A-Z][a-z]+ \d{1,2}, \d{4})/i);
    if (match) data.startDate = match[1];
  }

  // FINAL fallback — always extract first real date if still missing
  if (!data.startDate && extractedText) {
    const dateMatch = extractedText.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}\b/i);
    if (dateMatch) {
      data.startDate = dateMatch[0];
    }
  }


  // --- LEASE TYPE
  if (!data.leaseType) {
    if (/cam|common area maintenance|taxes|insurance/i.test(text)) {
      data.leaseType = "NNN";
    } else if (/gross/i.test(text)) {
      data.leaseType = "Gross";
    }
  }

  // --- CAP %
  if (!data.capPercentage) {
    const capMatch = extractedText.match(/(\d+(\.\d+)?)\s*%.*cap/i);
    if (capMatch) {
      data.capPercentage = parseFloat(capMatch[1]);
    }
  }

  // --- EXCLUSIONS
  if (!data.excludedCategories) {
    const exclMatch = extractedText.match(/exclusions?\s*[:\-]?\s*(.*)/i);
    if (exclMatch) {
      data.excludedCategories = exclMatch[1].trim();
    }
  }

  return data;
}


// Remove stray single-letter initials (e.g. "P." or "M.") that AI sometimes
// prepends/appends to extracted names, then collapse extra whitespace.
function cleanTenantName(raw) {
  if (!raw) return '';
  return raw
    .replace(/\b[A-Z]\.\s*/g, '')   // drop "P. ", "M. " etc.
    .replace(/\s+/g, ' ')
    .replace(/^[\s,;.]+|[\s,;.]+$/g, '')
    .trim();
}

// Returns true when a name is a real business/person name rather than a
// document-level phrase that the AI mistakenly returned as the tenant name.
function isStrongName(name) {
  if (!name || name.length <= 3) return false;
  if (/^(unknown\s*tenant|n\/a|none|null)$/i.test(name.trim())) return false;
  if (/\b(lease|agreement|contract|addendum|exhibit|amendment|schedule|document)\b/i.test(name)) return false;
  if (name.toLowerCase().includes('.pdf')) return false;
  // snake_case / kebab-case with no spaces → system-generated filename fragment
  if (/[_\-]/.test(name) && !/\s/.test(name)) return false;
  return true;
}

// Normalizes any date string/value to YYYY-MM-DD; returns '' if absent or unparseable.
function toISODate(val) {
  if (!val) return '';
  const s = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  return isNaN(d) ? '' : d.toISOString().split('T')[0];
}

// Deterministic tenant name extractor — runs before and after Claude as a hard fallback.
function extractTenantFromText(text) {
  if (!text) return null;

  const landlordWords = /properties|realty|real estate|holdings|capital|management|investments|partners|trust|fund|group llc|llp/i;

  // 1. Explicit label with entity suffix — highest confidence
  const labelMatch = text.match(
    /(?:tenant|lessee|occupant)\s*[:\-]?\s*([A-Z][A-Za-z0-9,&.\s]{2,60}?(?:LLC|L\.L\.C\.|INC\.?|CORP\.?|LTD\.?|L\.P\.|CO\.))/i
  );
  if (labelMatch) {
    const name = labelMatch[1].trim().replace(/\s+/g, ' ');
    if (isStrongName(name)) return name;
  }

  // 2. Explicit label without entity suffix — still reliable
  const labelOnly = text.match(/(?:tenant|lessee|occupant)\s*[:\-]\s*([A-Z][A-Za-z0-9,&.\s]{3,50})/i);
  if (labelOnly) {
    const name = labelOnly[1].split('\n')[0].trim().replace(/\s+/g, ' ');
    if (isStrongName(name) && !landlordWords.test(name)) return name;
  }

  // 3. Collect ALL entity names, filter landlord words, return first survivor
  const allEntities = text.match(
    /[A-Z][A-Za-z0-9,&.\s]{2,60}?(?:LLC|L\.L\.C\.|INC\.?|CORP\.?|LTD\.?|L\.P\.|CO\.)/g
  ) || [];
  const filtered = allEntities
    .map(n => n.trim().replace(/\s+/g, ' '))
    .filter(n => isStrongName(n) && !landlordWords.test(n));
  if (filtered.length > 0) return filtered[0];

  // 4. Any entity name at all (last resort before filename)
  if (allEntities.length > 0) return allEntities[0].trim().replace(/\s+/g, ' ');

  return null;
}

// Regex-based fallback: scans raw lease text for date strings.
function extractDatesFromText(text) {
  if (!text) return {};
  const re = /\b(\d{1,2}\/\d{1,2}\/\d{2,4}|\w+\s\d{1,2},\s\d{4})\b/g;
  const matches = text.match(re) || [];
  if (matches.length < 2) return {};
  return {
    startDate:     matches[0],
    endDate:       matches[1],
    _usedFallback: true,
  };
}

function normalizeTenant(d) {
  if (!d) return d;
  const fallback = extractDatesFromText(d.rawText || '');
  return {
    tenant_name:         cleanTenantName(d.tenant_name ?? d.tenantName ?? d.name ?? ''),
    leased_sqft:         d.leased_sqft         ?? d.leasedSqft ?? d.sqft  ?? '',
    start_date:          toISODate(d.start_date ?? d.startDate ?? d.lease_start_date ?? fallback.startDate ?? ''),
    end_date:            toISODate(d.end_date   ?? d.endDate   ?? d.lease_end_date  ?? fallback.endDate   ?? ''),
    lease_type:          d.lease_type          ?? d.leaseType                     ?? '',
    excluded_categories: d.excluded_categories ?? d.excludedCategories            ?? '',
    cap:                 d.cap                 ?? d.cam_cap ?? d.capPercentage    ?? null,
    flags:               d.flags               ?? [],
    confidence:          d.confidence          ?? {},
    baseYear:            d.baseYear            ?? null,
    unitNumber:          d.unitNumber          ?? '',
    doc_has_dates:       d.doc_has_dates       ?? true,
    doc_has_lease_type:  d.doc_has_lease_type  ?? true,
    leaseUrl:            d.leaseUrl ?? d.lease_url ?? d.file_url ?? null,
    leaseExpected:       d.leaseExpected ?? !!(d.leaseUrl ?? d.lease_url ?? d.file_url),
    extractionFailed:    d.extractionFailed    ?? false,
    _needsReview:        d._needsReview        ?? false,
    _pendingJobReview:   d._pendingJobReview   ?? false,
    _userConfirmed:      d._userConfirmed      ?? false,
    _jobId:              d._jobId              ?? null,
    _usedFallback:       d._usedFallback       ?? fallback._usedFallback ?? false,
    id:                  d.id                  ?? crypto.randomUUID(),
    fileName:            d.fileName            ?? '',
    _error:              d._error              ?? null,
    reviewOverrides:     d.reviewOverrides     ?? {},
  };
}

function isValidTenant(d) {
  if (!d) return false;
  return (
    d.tenant_name && d.tenant_name.trim().length > 0 &&
    d.leased_sqft != null && String(d.leased_sqft).trim().length > 0
  );
}


// Scores extraction quality from 0–100 and maps to high/medium/low/failed.
// Called in processFile after normalizeTenant; the result is stored on the tenant
// entry and drives badge colour, auto-expand, and manual-confirm requirements.
// meta: { usedPdfDirect, ocrChars, fileSizeBytes, processingMs, extractionFailed }
function computeExtractionConfidence(norm, meta) {
  if (!norm || meta?.extractionFailed) {
    return { level: 'failed', score: 0, reasons: ['Extraction returned no data'], failedFields: ['all'] };
  }

  let score = 100;
  const reasons = [];
  const failedFields = [];

  if (!norm.tenant_name || !norm.tenant_name.trim()) {
    score -= 40; reasons.push('No tenant name extracted'); failedFields.push('tenant_name');
  } else if (!isStrongName(norm.tenant_name)) {
    score -= 10; reasons.push('Tenant name looks weak (possible OCR noise)');
  }
  if (!norm.start_date)  { score -= 15; reasons.push('Missing lease start date'); failedFields.push('start_date'); }
  if (!norm.end_date)    { score -= 15; reasons.push('Missing lease end date');   failedFields.push('end_date'); }
  if (!norm.lease_type)  { score -= 10; reasons.push('Lease type not identified'); failedFields.push('lease_type'); }
  if (!norm.leased_sqft) { score -= 10; reasons.push('Square footage not found'); failedFields.push('leased_sqft'); }
  if (norm._usedFallback) { score -= 8; reasons.push('Dates came from regex fallback, not AI'); }
  // Very short text layer suggests poor OCR quality on the text path
  if (!meta?.usedPdfDirect && meta?.ocrChars != null && meta.ocrChars < 500) {
    score -= 10; reasons.push('Very short text layer — possible OCR degradation');
  }

  score = Math.max(0, score);
  const level = score >= 80 ? 'high' : score >= 55 ? 'medium' : score > 0 ? 'low' : 'failed';
  return { level, score, reasons, failedFields };
}

async function extractPdfText(file) {
  // For non-PDF files (txt, etc.) fall back to plain text read
  if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
    return file.text();
  }

  const pdfjs = window['pdfjsLib'];
  if (!pdfjs) {
    console.error('PDF.js not ready');
    throw new Error('PDF.js failed to load');
  }
  const lib = pdfjs;

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await lib.getDocument({ data: arrayBuffer }).promise;

  const MAX_PAGES = 5;
  // WHY warn: commercial leases are often 20-60 pages; term sheets and exhibit pages
  // can appear well past page 5. Silent truncation produced no signal when key fields
  // (commencement date, tenant name) lived beyond the read window.
  if (pdf.numPages > MAX_PAGES) {
    console.warn(`[extractPdfText] PDF has ${pdf.numPages} pages — reading only first ${MAX_PAGES}. Key terms may be truncated; Claude PDF vision path will read the full document.`);
  }

  const pages = [];
  for (let p = 1; p <= Math.min(pdf.numPages, MAX_PAGES); p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const pageText = content.items.map(item => item.str).join(' ');
    pages.push(pageText);
  }

  return pages.join('\n\n');
}

// Converts a File/Blob to a base64 string without stack-overflowing on large files.
async function fileToBase64(file) {
  const arrayBuffer = await file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';
  const CHUNK = 8192;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

// Sends the PDF directly to Claude as a base64 document block.
// Claude uses vision to read scanned PDFs — no OCR middleware needed.
async function callClaudeWithPdfDirect(file) {
  const base64 = await fileToBase64(file);

  const extractionPrompt = `Extract the following fields from this commercial lease document.
Return ONLY valid JSON. No explanation. No markdown.

{
  "tenant_name": string or null,
  "lease_start_date": "YYYY-MM-DD" or null,
  "lease_end_date": "YYYY-MM-DD" or null,
  "lease_type": "NNN" | "Gross" | "Modified Gross" | null,
  "sqft": number or null,
  "cam_cap": number or null
}

TENANT NAME:
- Look for labels: "Tenant:", "Lessee:", "Occupant:"
- If no label: first business entity (LLC, Inc, Corp) that is NOT the landlord
- Exclude names containing: Properties, Realty, Holdings, Capital, Investments, Management
- NEVER return null if any company name exists

DATES:
- Start: Commencement Date → Lease Start Date → Effective Date → Execution Date
- End: Expiration Date → Lease End Date → calculate from start date + term length

LEASE TYPE: Triple Net / NNN → "NNN" | Modified Gross | Gross

CAM CAP (CRITICAL): Search the ENTIRE document for any language limiting CAM or operating expense increases.
Look for: "CAM cap", "expense cap", "expense stop", "base year stop", "not to exceed", "shall not pay more than", "increases limited to", "capped at", "no more than X%", "controllable expense cap".
If a percentage (e.g. 5%) → return 5. If a dollar amount → return that number.
Only return null if NO cap language exists anywhere in the document.

Return best guess — do not leave fields null unless truly impossible.`;

  const messages = [{
    role: 'user',
    content: [
      {
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: base64 },
      },
      { type: 'text', text: extractionPrompt },
    ],
  }];

  const res = await _fetchWithTimeout('/api/claude', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, max_tokens: 1000, system: CLAUDE_LEASE_SYSTEM }),
  });

  if (!res.ok) throw new Error(`Claude PDF direct failed: HTTP ${res.status}`);
  const data = await res.json();
  return data;
}

async function extractLeaseText(file) {
  // For non-PDFs read as plain text
  if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
    return file.text();
  }

  // Try PDF.js text layer first (works for digital/searchable PDFs)
  let text = await extractPdfText(file);
  // WHY toLowerCase: legal PDFs routinely use all-caps headings ("LEASE AGREEMENT").
  // The original text.includes('Lease') is case-sensitive and returns false for 'LEASE',
  // incorrectly routing digital leases through PDF vision → hitting the 413 body limit.
  const isWeak = !text || text.length < 1000 || !text.toLowerCase().includes('lease') || text.split(' ').length < 100;

  if (!isWeak) {
    return text;
  }

  // Scanned / image-based PDF — return null so the caller uses Claude's PDF vision
  return null;
}

function normalizeText(text) {
  if (!text) return '';
  // WHY the 4th regex was removed: ([a-zA-Z])\s+([a-zA-Z]) → '$1$2' fused all words
  // together ("Commencement Date" → "CommencementDate", "Triple Net" → "TripleNet"),
  // breaking keyword-label detection in the regex fallback path.
  // The three remaining transforms are safe: CR → space, newline → space, collapse runs.
  return text
    .replace(/\r/g, ' ')
    .replace(/\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractLeaseData(text) {
  if (!text || typeof text !== 'string') {
    return { start_date: '', end_date: '', lease_type: '' };
  }

  const matches = text.match(
    /\b(\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2}|(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4})\b/gi
  ) || [];

  const dates = matches
    .map(d => new Date(d))
    .filter(d => !isNaN(d))
    .sort((a, b) => a - b);

  return {
    start_date: dates[0]              ? dates[0].toISOString().slice(0, 10)              : '',
    end_date:   dates.length          ? dates[dates.length - 1].toISOString().slice(0, 10) : '',
    lease_type: /triple[\s-]?net|nnn/i.test(text)                             ? 'Triple Net (NNN)'
              : /modified[\s-]?gross/i.test(text)                              ? 'Modified Gross'
              : /pro\s*rata\s*share.{0,120}(?:taxes|insurance|operating)/i.test(text) ? 'NNN'
              : /gross/i.test(text)                                             ? 'Gross'
              : '',
  };
}

function getWarnings(flags) {
  if (!Array.isArray(flags)) return [];
  return flags.map(f => {
    if (f === 'no_term_in_doc')        return 'No lease term found in document — please enter manually';
    if (f === 'lease_type_missing')    return 'Lease type not specified';
    if (f === 'missing_start_date')    return 'Missing start date';
    if (f === 'missing_end_date')      return 'Missing end date';
    if (f === 'approx_sqft_detected')  return 'Approximate sqft detected';
    if (f === 'base_year_detected')    return 'Base year needs review';
    return f;
  });
}

function computeFlags(d) {
  const base = [];
  // Only show "no term in doc" when the document had no dates AND the user hasn't
  // manually filled either in. If at least one date is present, fall through to
  // individual checks so only the still-missing field gets flagged.
  if (d.doc_has_dates === false && !d.start_date && !d.end_date) {
    base.push('no_term_in_doc');
  } else {
    if (!d.start_date) base.push('missing_start_date');
    if (!d.end_date)   base.push('missing_end_date');
  }
  if (!d.lease_type) base.push('lease_type_missing');
  const extra = (Array.isArray(d.flags) ? d.flags : []).filter(
    f => (f === 'approx_sqft_detected' || f === 'base_year_detected') && !base.includes(f)
  );
  const result = [...base, ...extra];
  if (d.lease_type && d.lease_type !== '') return result.filter(f => f !== 'lease_type_missing');
  return result;
}

function computeFlagsStrict(d) {
  const base = [];
  if (d.doc_has_dates === false && d.start_date == null && d.end_date == null) {
    base.push('no_term_in_doc');
  } else {
    if (d.start_date == null) base.push('missing_start_date');
    if (d.end_date   == null) base.push('missing_end_date');
  }
  if (!d.lease_type) base.push('lease_type_missing');
  const extra = (Array.isArray(d.flags) ? d.flags : []).filter(
    f => (f === 'approx_sqft_detected' || f === 'base_year_detected') && !base.includes(f)
  );
  const result = [...base, ...extra];
  if (d.lease_type && d.lease_type !== '') return result.filter(f => f !== 'lease_type_missing');
  return result;
}

// Extracts lines most likely to contain key lease fields.
function extractImportantSections(text) {
  const keywords = [
    'tenant', 'lessee', 'occupant', 'landlord', 'lessor',
    'term', 'commencement', 'expiration', 'commence', 'expires',
    'lease term', 'rent', 'square', 'premises', 'nnn', 'triple net',
    'gross', 'modified gross', 'sqft', 'sq ft', 'square feet',
  ];
  return text
    .split('\n')
    .filter(line => keywords.some(k => line.toLowerCase().includes(k)))
    .slice(0, 250)
    .join('\n');
}

// Builds the text sent to Claude: keyword lines first (signal boost),
// then head + tail of the full document so dates/terms near the middle
// and end of the lease are not lost to blind truncation.
function prepareLeaseTextForClaude(rawText) {
  if (!rawText) return '';
  const clean = rawText
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]{3,}/g, '  ')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();

  const keyLines  = extractImportantSections(clean);
  const head      = clean.slice(0, 4000);
  const tail      = clean.length > 4000 ? clean.slice(-2000) : '';

  return [
    keyLines ? `KEY SECTIONS:\n${keyLines}` : '',
    `FULL CONTEXT (start):\n${head}`,
    tail ? `FULL CONTEXT (end):\n${tail}` : '',
  ].filter(Boolean).join('\n\n...\n\n');
}

async function callClaudeForLease(text) {
  const leaseSnippet = prepareLeaseTextForClaude(text);
  // WHY cam_cap added: the system prompt (CLAUDE_LEASE_SYSTEM) always asks for cam_cap,
  // but the user prompt previously omitted it. Conflicting instructions caused Claude to
  // sometimes skip it. Now both prompts agree on the full canonical field set.
  const prompt = `
You are extracting structured data from a commercial lease document.
NOTE: This text may have been extracted via OCR from a scanned document — tolerate minor spelling errors, extra spaces, or character substitutions.
Return ONLY valid JSON. No explanation. No markdown.

Extract:
{
  "tenant_name": string,
  "lease_start_date": "YYYY-MM-DD" or null,
  "lease_end_date": "YYYY-MM-DD" or null,
  "lease_type": "NNN" | "Gross" | "Modified Gross" | null,
  "sqft": number or null,
  "cam_cap": number or null
}

TENANT NAME (highest priority):
- Look for labels: "Tenant:", "Lessee:", "Occupant:"
- If no label found: pick the first business entity (LLC, Inc, Corp, Ltd, L.P.)
- If multiple entities: EXCLUDE names with Properties/Realty/Holdings/Capital/Investments
- NEVER return null if any company name exists

DATES:
- Start: Commencement Date → Lease Start Date → Effective Date → Execution Date
- End: Expiration Date → Lease End Date → calculate from start + term length if needed

CAM CAP: Search the entire document for any language limiting CAM increases ("not to exceed", "capped at X%", "expense stop"). Return the number (e.g. 5% → 5). Null if no cap language exists.

IMPORTANT: Best guess always. Do not leave tenant_name null if any company name exists.

LEASE TEXT:
"""
${leaseSnippet}
"""
`;
  const messages = [{ role: 'user', content: prompt }];

  const res = await _fetchWithTimeout('/api/claude', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, max_tokens: 1000, system: CLAUDE_LEASE_SYSTEM }),
  });

  if (!res.ok) {
    throw new Error(`Lease extraction failed: HTTP ${res.status}`);
  }

  const response = await res.json();

  // Normalize: accept string, object, or array
  let parsed = response;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch (e) {
      console.error('[callClaudeForLease] Claude returned invalid JSON string:', parsed);
      return null;
    }
  }
  if (!Array.isArray(parsed)) {
    parsed = [parsed];
  }
  parsed = parsed.filter(t => t && typeof t === 'object');

  if (parsed.length === 0) {
    console.error('[callClaudeForLease] No valid tenant objects in response');
    return null;
  }

  const data = parsed[0];

  // Normalize leaseType so UI always receives the expected label
  const normalizeLeaseType = (val) => {
    if (!val) return null;
    const v = String(val).toLowerCase();
    if (v.includes('nnn') || v.includes('triple')) return 'Triple Net (NNN)';
    if (v.includes('modified'))                     return 'Modified Gross';
    if (v.includes('gross'))                        return 'Gross';
    return val;
  };
  // Normalize CAM cap: "35%" → 35, "0.35" → 35, "35" → 35
  const normalizeCap = val => {
    if (!val) return null;
    const n = parseFloat(String(val).replace(/[^0-9.]/g, ''));
    if (isNaN(n)) return null;
    return n < 1 ? Math.round(n * 100) : n;
  };

  const raw = data;
  const cleanText = normalizeText(text);
  const fb = extractLeaseData(cleanText);

  // Accept either schema: tenant_name (user prompt) or tenantName (system prompt)
  const aiName = raw.tenant_name ?? raw.tenantName ?? null;
  // Regex fallback when Claude returns null/empty for the tenant name
  const resolvedName = (aiName && String(aiName).trim()) || extractTenantFromText(text) || '';
  const resolvedSqft = (() => {
    const v = raw.leasedSqft ?? raw.leased_sqft ?? raw.sqft ?? raw.squareFeet ?? null;
    if (v != null && v !== '') {
      const n = Number(String(v).replace(/[^0-9.]/g, ''));
      if (!isNaN(n)) return n;
    }
    return null;
  })();
  const resolvedStart = raw.lease_start_date ?? raw.startDate ?? raw.start_date ?? fb.start_date ?? '';
  const resolvedEnd   = raw.lease_end_date   ?? raw.endDate   ?? raw.end_date   ?? fb.end_date   ?? '';
  const resolvedType  = normalizeLeaseType(raw.lease_type ?? raw.leaseType ?? fb.lease_type) ?? '';


  const doc_has_dates = /\b(?:\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2}|(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4})\b/i.test(text);
  const doc_has_lease_type = /triple[\s-]?net|nnn|gross|modified[\s-]?gross/i.test(text);

  const finalFlags = computeFlags({ start_date: resolvedStart, end_date: resolvedEnd, lease_type: resolvedType, flags: raw.flags, doc_has_dates, doc_has_lease_type });

  const normalized = normalizeTenant({
    tenant_name:         resolvedName,
    leased_sqft:         resolvedSqft,
    start_date:          resolvedStart,
    end_date:            resolvedEnd,
    lease_type:          resolvedType,
    cap:                 normalizeCap(raw.capPercentage ?? raw.cam_cap ?? null),
    excluded_categories: raw.excludedCategories ?? raw.excluded_categories ?? null,
    baseYear:            raw.baseYear ?? null,
    confidence:          raw.confidence || {},
    flags:               finalFlags,
    doc_has_dates,
    doc_has_lease_type,
    _error:              null,
  });
  return normalized;
}
// ─── SVG icons ────────────────────────────────────────────────────────────────
const CHECK_SVG = `<svg viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="2,6 5,9 10,3"/></svg>`;
const CROSS_SVG = `<svg viewBox="0 0 12 12" width="10" height="10" stroke="white" stroke-width="2.2" stroke-linecap="round"><line x1="2" y1="2" x2="10" y2="10"/><line x1="10" y1="2" x2="2" y2="10"/></svg>`;

// ─── Tenant Slots ─────────────────────────────────────────────────────────────

function renderTenantSlots() {
  const container = document.getElementById('tenantSlots');
  container.innerHTML = '';
  for (let i = 0; i < MAX_LEASES; i++) {
    const slot = document.createElement('div');
    slot.className = 'tenant-slot';
    slot.id = `ts-${i}`;
    slot.innerHTML = `<div class="slot-head">Tenant ${i + 1}</div>
                      <div class="slot-body" id="tb-${i}"></div>`;
    container.appendChild(slot);
    renderTenantUploadZone(i);
  }
}

function renderTenantUploadZone(i) {
  const body = document.getElementById(`tb-${i}`);
  const zone = document.createElement('div');
  zone.className = 'upload-zone';

  const inp = document.createElement('input');
  inp.type   = 'file';
  inp.accept = '.pdf,application/pdf';
  inp.addEventListener('change', e => {
    if (e.target.files[0]) handleLease(i, e.target.files[0]);
  });

  zone.innerHTML = `<div class="uz-icon">📄</div>
                    <div class="uz-label">Upload Lease</div>
                    <div class="uz-sub">PDF only</div>`;
  zone.appendChild(inp);
  body.innerHTML = '';
  body.appendChild(zone);
}

async function handleLease(i, file) {
  console.log('[handleLease] dropped:', file.name, `(${(file.size/1024).toFixed(1)} KB)`);
  const body = document.getElementById(`tb-${i}`);
  body.innerHTML = `<div class="spinner-wrap">
    <div class="spinner"></div>
    <div class="spinner-label">AI reading lease…</div>
  </div>`;

  const property = currentProperty();
  if (!property) { renderTenantError(i, 'No property selected'); return; }

  // Only clear this slot — preserve other tenants already uploaded
  tenantData[i] = null;

  try {
    // Ensure property has a DB id so the storage path is valid
    if (!property.id) await saveProperty(property);

    // Upload to storage and extract text in parallel — neither depends on the other
    const [leaseUrl, leaseText] = await Promise.all([
      uploadLeaseToStorage(file, property.id),
      extractLeaseText(file),
    ]);

    // Digital PDF: text layer extracted — send text to Claude
    // Scanned PDF: leaseText is null/short — send PDF bytes directly (vision)
    let extracted;
    if (leaseText && leaseText.length >= 50) {
      extracted = await callClaudeForLease(leaseText);
    } else {
      extracted = await callClaudeWithPdfDirect(file);
    }

    if (!extracted) throw new Error('Could not extract lease fields');
    const normalized = normalizeTenant(extracted);
    if (!isValidTenant(normalized)) throw new Error('Extracted tenant has no usable fields');

    tenantData[i] = { ...normalized, leaseFile: file, leaseExpected: true, fileName: file.name, leaseUrl };
    storeLeaseFile(normalized.id, file);
    renderTenantFields(i);
    checkSqftValidation();

    const deduped = dedupeTenants(tenantData.filter(t => t !== null));
    property.tenants = deduped;

    await saveProperty(property);
    // Full resync ONCE after save — replaces any stale rows for this property
    await resyncTenantsToTable(property.id, deduped);
  } catch (err) {
    renderTenantError(i, err.message);
  }
}

// ─── Sqft Validation ─────────────────────────────────────────────────────────

function validateTotalSqFt(property, newLease) {
  const totalSqFt = parseFloat(property.totalSqFt || property.totalSqft) || 0;
  if (!totalSqFt) return { valid: true, message: null };

  const existingTotal = (property.leases || [])
    .filter(l => l.tenantName !== (newLease?.tenantName))
    .reduce((s, l) => s + (parseSqft(l.sqFt || l.leasedSqft)), 0);

  const newTotal = existingTotal + parseSqft(newLease?.sqFt || newLease?.leasedSqft || 0);

  if (newTotal > totalSqFt) {
    return {
      valid: false,
      message: `Total tenant square footage (${newTotal.toLocaleString()} sqft) exceeds property total (${totalSqFt.toLocaleString()} sqft). Please adjust.`,
    };
  }
  return { valid: true, message: null };
}

function checkSqftValidation() {
  const prop = currentProperty();
  const totalSqFt = Number(prop?.totalSqft) || 0;
  if (!totalSqFt) { window._sqftInvalid = false; clearSqftBanner(); return true; }

  const usedSqFt = tenantData.filter(t => t).reduce((s, t) => s + parseSqft(t.leased_sqft), 0);

  if (!usedSqFt) { window._sqftInvalid = false; clearSqftBanner(); return true; }

  window._sqftInvalid = usedSqFt > totalSqFt;

  const used  = usedSqFt.toLocaleString();
  const total = totalSqFt.toLocaleString();

  if (usedSqFt > totalSqFt) {
    showSqftBanner(`⚠ Total leased (${used} sqft) exceeds building total (${total} sqft). Please adjust tenant sizes.`, 'over');
  } else if (usedSqFt < totalSqFt) {
    showSqftBanner(`⚠ Total leased (${used} sqft) is less than building total (${total} sqft). Some space may be unaccounted for.`, 'under');
  } else {
    window._sqftInvalid = false;
    clearSqftBanner();
  }
  return !window._sqftInvalid;
}

function runCamValidation() {
  const prop = currentProperty();

  const validTenants = getValidTenants();

  const tenantTotal = validTenants.reduce(
    (sum, t) => sum + (Number(t.leased_sqft) || 0),
    0
  );

  const propertyTotal = Number(prop?.totalSqft) || 0;


  const isValid = tenantTotal <= propertyTotal;

  window._sqftInvalid = !isValid;

  if (!isValid) {
    return;
  }

  calculateCAM?.();
}

function getValidTenants() {
  return (currentProperty()?.tenants || []).filter(t =>
    t &&
    t.tenant_name &&
    Number(t.leased_sqft) > 0 &&
    !t.extractionFailed
  );
}

function renderFailedTenants(tenants) {
  const el = document.getElementById('bulkResults');
  if (!el || !tenants.length) return;
  const srcTenants = currentProperty()?.tenants || tenantData;
  const rows = tenants.map((d) => {
    const i = srcTenants.findIndex(t => t?.id && t.id === d?.id);
    if (i === -1) return '';
    return `
      <div class="bulk-tenant-row has-error" id="btr-failed-${i}">
        <div class="bulk-tenant-summary">
          <span class="bulk-t-status">❌</span>
          <span class="bulk-t-name">${esc(d.fileName || d.tenant_name || 'Unknown')}</span>
          <span class="bulk-t-meta" data-retry data-index="${i}" style="cursor:pointer;">Extraction failed — tap to re-upload</span>
          <button class="view-lease-btn" data-retry data-index="${i}" style="margin-left:0;color:#f97316;">&#x21BA; Retry</button>
          <button class="bulk-t-remove" onclick="event.stopPropagation();removeBulkTenant(${i})">Remove</button>
        </div>
      </div>`;
  }).join('');
  el.insertAdjacentHTML('beforeend', `
    <div class="bulk-results-head" style="margin-top:16px;border-top:1px solid rgba(239,68,68,0.2);padding-top:12px;">
      <h3 style="color:#f87171;">Needs Attention (${tenants.length})</h3>
    </div>
    ${rows}`);
}

function updatePropertySqft(val) {
  const prop = currentProperty();
  if (!prop) return;

  prop.totalSqft = Number(val) || 0;


  saveProperty(prop);

  checkSqftValidation();
  runCamValidation();

  renderProperty(prop);
}

function showSqftBanner(msg, severity) {
  const el = document.getElementById('sqft-error');
  if (!el) { return; }
  el.innerText = msg;
  el.dataset.severity = severity;
  el.classList.remove('hidden');
}

function clearSqftBanner() {
  const el = document.getElementById('sqft-error');
  if (!el) return;
  el.innerText = '';
  el.classList.add('hidden');
  delete el.dataset.severity;
}

function toInputDate(val) {
  if (!val) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return val;
  const d = new Date(val);
  if (!isNaN(d)) return d.toISOString().slice(0, 10);
  const m = val.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  return '';
}

function renderTenantFields(i) {
  const d = tenantData[i];
  const flags = computeFlagsStrict(d);
  const body = document.getElementById(`tb-${i}`);
  body.innerHTML = `
    <div class="extracted">
      <div class="status-row ok">
        <span class="status-dot ok">${CHECK_SVG}</span>
        Fields extracted — review and edit below
        <button class="re-btn" onclick="resetTenant(${i})">Re-upload</button>
      </div>
      ${(() => { const w = getWarnings(flags); return w.length ? `<div class="rc-flags"><div class="rc-flags-title">&#x26A0;&#xFE0F; Needs Review</div>${w.map(m => `<div class="rc-flag-item">${m}</div>`).join('')}</div>` : ''; })()}
      ${d.leaseExpected
        ? (d.leaseFile instanceof File || d.leaseUrl)
          ? `<button class="action-btn" onclick="openLeaseModalFromFile(${i})">&#x1F4C4; View Lease</button>`
          : `<div class="lease-missing-note">⚠️ Lease not attached — using manual data</div>`
        : ''}
      <div class="field-row">
        <div class="field">
          <label>Tenant Name</label>
          <input type="text" value="${esc(d.tenant_name || '')}"
            onfocus="isEditingField=true"
            onblur="handleFieldBlur(${i},'tenant_name',this.value)"/>
        </div>
        <div class="field">
          <label>Leased Sqft</label>
          <input type="number" value="${d.leased_sqft ?? ''}"
            onfocus="isEditingField=true"
            onblur="handleFieldBlur(${i},'leased_sqft',this.value);checkSqftValidation()"/>
        </div>
      </div>
      <div class="field-row">
        <div class="field">
          <label>Lease Start Date</label>
          <input type="date" value="${toInputDate(d.start_date)}"
            onfocus="isEditingField=true"
            onblur="handleFieldBlur(${i},'start_date',this.value)"/>
        </div>
        <div class="field">
          <label>Lease End Date</label>
          <input type="date" value="${toInputDate(d.end_date)}"
            onfocus="isEditingField=true"
            onblur="handleFieldBlur(${i},'end_date',this.value)"/>
        </div>
      </div>
      <div class="field-row">
        <div class="field">
          <label>Lease Type</label>
          <select onchange="handleFieldBlur(${i},'lease_type',this.value||null)">
            <option value="">Select lease type</option>
            <option value="Triple Net (NNN)"${d.lease_type === 'Triple Net (NNN)' ? ' selected' : ''}>Triple Net (NNN)</option>
            <option value="Gross"${d.lease_type === 'Gross' ? ' selected' : ''}>Gross</option>
            <option value="Modified Gross"${d.lease_type === 'Modified Gross' ? ' selected' : ''}>Modified Gross</option>
          </select>
        </div>
        <div class="field">
          <label>Excluded Categories (comma-separated)</label>
          <input type="text" value="${esc(d.excluded_categories || '')}"
            onfocus="isEditingField=true"
            onblur="handleFieldBlur(${i},'excluded_categories',this.value)"/>
        </div>
      </div>
    </div>`;
}

function renderTenantError(i, msg) {
  const body = document.getElementById(`tb-${i}`);
  body.innerHTML = `
    <div class="extracted">
      <div class="status-row err">
        <span class="status-dot err">${CROSS_SVG}</span>
        Extraction failed: ${esc(msg)}
        <button class="re-btn" onclick="resetTenant(${i})">Try again</button>
      </div>
    </div>`;
}

function resetTenant(i) {
  const prop = currentProperty();
  if (prop?.tenants) prop.tenants[i] = null;
  tenantData[i] = null;
  renderTenantUploadZone(i);
  checkSqftValidation();
}

// ─── Lease Tab Switching ──────────────────────────────────────────────────────

function switchLeaseTab(tab) {
  document.getElementById('lTabBulk').classList.toggle('active', tab === 'bulk');
  document.getElementById('lTabSingle').classList.toggle('active', tab === 'single');
  document.getElementById('leasePanelBulk').style.display   = tab === 'bulk'   ? 'block' : 'none';
  document.getElementById('leasePanelSingle').style.display = tab === 'single' ? 'block' : 'none';
}

// ─── GL Excel Upload ─────────────────────────────────────────────────────────

const GL_COL_ALIASES = {
  date:        ['posting date','post date','gl date','trans date','transaction date',
                 'entry date','doc date','voucher date','invoice date','check date',
                 'period date','trx date','value date','effective date','pay date',
                 'date','period','posted'],
  vendor:      ['vendor name','payee name','vendor/payee','pay to','paid to','remit to',
                 'check payee','vend name','supplier name','payable to','merchant',
                 'counterparty','company name','vendor','payee','supplier','name'],
  description: ['gl description','account description','transaction description',
                 'invoice description','line description','trans description',
                 'item description','description','memo','narration','reference',
                 'remarks','particulars','notes','detail','note','comment','purpose',
                 'explanation','desc'],
  category:    ['account name','gl account','gl code','account code','account number',
                 'gl acct','expense type','expense category','gl category','cost type',
                 'expense acct','account type','natural account','object code',
                 'cost center','sub-account','category','account','acct','class',
                 'dept','department','type'],
  amount:      ['net amount','total amount','transaction amount','payment amount',
                 'expense amount','invoice amount','check amount','gross amount',
                 'amount','total','net','charge','expense','cost','value'],
  debit:       ['debit amount','dr amount','debit total','debit','dr'],
  credit:      ['credit amount','cr amount','credit total','credit','cr'],
};

const GL_CAT_KEYWORDS = {
  landscaping: ['landscap','lawn','grass','garden','tree','plant','irrigation','mulch',
                'fertiliz','turf','shrub','bush','groundskeep','exterior','sprinkler',
                'mow','prun','leaf','weed','sod','aerat'],
  snow:        ['snow','ice removal','salt','plow','winter removal','de-ice','deice',
                'sand','ice melt','winter service','deicer','salting'],
  repairs:     ['repair','maintenance','maint','hvac','roof','plumb','electric',
                'replac','paint','patch','caulk','seal','restore','renovate','rebuild',
                'work order','handyman','labor','capital improve','fix','service call',
                'ext repair','bldg repair','fac repair','general repair','preventive'],
  utilities:   ['utilit','electric','power','water','gas','sewer','trash','waste',
                'garbage','recycle','telecom','internet','phone','cable','fuel','oil',
                'natural gas','propane','electric bill','water bill'],
  janitorial:  ['janitor','clean','custodial','sweep','mop','sanitiz','disinfect',
                'porter','floor care','window wash','carpet','strip wax','pressure wash',
                'restroom','lavatory','janitorial supply','cleaning supply','building clean'],
  security:    ['securit','guard','patrol','alarm','cctv','camera','monitor',
                'access control','badge','surveillance','fire alarm','sprinkler system',
                'smoke','locksmith','security system','security service'],
  management:  ['mgmt fee','management fee','admin fee','pm fee','property mgmt',
                'property management','manage','admin','accounting','office','legal',
                'insurance','professional','audit','overhead','administrative'],
};

// Fuzzy header match — exact, contains, or normalized equality
function glFuzzyMatch(rawHeader, aliases) {
  const h = rawHeader.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  for (const a of aliases) {
    const an = a.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    if (h === an || h.includes(an) || an.includes(h)) return true;
  }
  return false;
}

function detectGLCategory(text) {
  if (!text) return 'other';
  const t = text.toLowerCase();
  for (const [cat, kws] of Object.entries(GL_CAT_KEYWORDS)) {
    if (kws.some(k => t.includes(k))) return cat;
  }
  return 'other';
}

// Parse a GL amount value — handles $, commas, (parentheses), trailing -
function parseGLAmount(v) {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return v;
  const s = String(v).trim();
  if (!s) return 0;
  // Detect accounting negative: (1,234.56) or (1234.56)
  const isParenNeg = /^\(.*\)$/.test(s);
  // Strip currency symbol, commas, spaces, parentheses, $
  const clean = s.replace(/[$,\s()]/g, '');
  // Handle trailing minus sign: 1234.56-
  const trailingMinus = clean.endsWith('-');
  const digits = trailingMinus ? clean.slice(0, -1) : clean;
  const n = parseFloat(digits);
  if (isNaN(n)) return 0;
  return (isParenNeg || trailingMinus) ? -Math.abs(n) : n;
}

function parseGLDate(val) {
  if (!val && val !== 0) return '';
  if (typeof val === 'number') {
    try {
      const d = XLSX.SSF.parse_date_code(val);
      return `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`;
    } catch { return String(val); }
  }
  const s = String(val).trim();
  // Try to normalize common date formats: M/D/YYYY, M-D-YYYY, YYYY/MM/DD
  const mdy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (mdy) {
    const yr = mdy[3].length === 2 ? '20' + mdy[3] : mdy[3];
    return `${yr}-${mdy[1].padStart(2,'0')}-${mdy[2].padStart(2,'0')}`;
  }
  return s;
}

function handleGLUpload(input) {
  const file = input.files && input.files[0];
  if (!file) return;

  if (!file.name.toLowerCase().endsWith('.xlsx')) {
    alert('Please select an .xlsx file.');
    input.value = '';
    return;
  }

  const statusEl    = document.getElementById('glStatus');
  const resultsEl   = document.getElementById('glResults');
  const importBarEl = document.getElementById('glImportBar');

  statusEl.style.display = 'block';
  statusEl.innerHTML = `<div class="spinner-wrap"><div class="spinner"></div>
    <div class="spinner-label">Reading ${esc(file.name)}&hellip;</div></div>`;
  resultsEl.innerHTML   = '';
  importBarEl.innerHTML = '';
  glData = [];

  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const wb   = XLSX.read(new Uint8Array(e.target.result), { type: 'array', cellDates: false });
      const ws   = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

      if (rows.length < 2) {
        statusEl.innerHTML = `<div class="err-banner">The spreadsheet appears empty or has no data rows.</div>`;
        return;
      }

      // ── Find header row ─────────────────────────────────────────────────
      // Score each of the first 15 rows by how many cells match a known alias.
      // The row with the most matches is the header.
      let hdrIdx = 0, bestScore = 0;
      for (let i = 0; i < Math.min(15, rows.length); i++) {
        const row = rows[i];
        const nonEmpty = row.filter(c => String(c).trim() !== '');
        if (nonEmpty.length < 2) continue;
        let score = 0;
        for (const cell of row) {
          const h = String(cell || '');
          if (!h.trim()) continue;
          for (const aliases of Object.values(GL_COL_ALIASES)) {
            if (glFuzzyMatch(h, aliases)) { score++; break; }
          }
        }
        if (score > bestScore) { bestScore = score; hdrIdx = i; }
        if (score >= 3) break; // Good enough — stop early
      }
      const headers = rows[hdrIdx].map(h => String(h || ''));

      // ── Detect column indices ───────────────────────────────────────────
      const ci = { date: -1, vendor: -1, description: -1, category: -1,
                   amount: -1, debit: -1, credit: -1 };
      headers.forEach((h, i) => {
        for (const [field, aliases] of Object.entries(GL_COL_ALIASES)) {
          if (ci[field] === -1 && glFuzzyMatch(h, aliases)) ci[field] = i;
        }
      });

      // Resolve amount column: prefer explicit amount, then debit, then scan for numbers
      let amtMode = 'single'; // single | debit | debit-credit
      if (ci.amount === -1 && ci.debit >= 0) {
        ci.amount = ci.debit;
        amtMode = ci.credit >= 0 ? 'debit-credit' : 'debit';
      }
      if (ci.amount === -1) {
        // Scan first several data rows for the first column that looks numeric
        for (let r = hdrIdx + 1; r < Math.min(hdrIdx + 6, rows.length); r++) {
          rows[r].forEach((v, i) => {
            if (ci.amount === -1 && i !== ci.date && i !== ci.vendor &&
                i !== ci.description && i !== ci.category) {
              const n = parseGLAmount(v);
              if (n > 0) ci.amount = i;
            }
          });
          if (ci.amount !== -1) break;
        }
      }

      if (ci.amount === -1) {
        statusEl.innerHTML = `<div class="err-banner">Could not detect an Amount column.
          Headers found: <em>${headers.filter(Boolean).join(', ') || 'none'}</em></div>`;
        return;
      }

      // Confidence scores based on detection quality
      const vendorConf = ci.vendor >= 0 ? 92 : (ci.description >= 0 ? 72 : 50);
      const dateConf   = ci.date   >= 0 ? 92 : 40;
      const catFromCol = ci.category >= 0;
      const vendorCol  = ci.vendor >= 0 ? ci.vendor : ci.description;

      // ── Parse data rows ─────────────────────────────────────────────────
      for (let i = hdrIdx + 1; i < rows.length; i++) {
        const row = rows[i];

        // Skip blank rows (fewer than 2 non-empty cells)
        if (row.filter(c => String(c).trim() !== '').length < 2) continue;

        // Compute net amount
        let amt = parseGLAmount(row[ci.amount]);
        if (amtMode === 'debit-credit' && ci.credit >= 0) {
          const cr = parseGLAmount(row[ci.credit]);
          amt = amt - cr; // net: debit minus credit
        }
        if (amt <= 0) continue; // skip zero / net-credit / blank rows

        const vendor  = vendorCol  >= 0 ? String(row[vendorCol]        || '').trim() : '';
        const desc    = ci.description >= 0 ? String(row[ci.description] || '').trim() : '';
        const catRaw  = ci.category >= 0 ? String(row[ci.category]     || '').trim() : '';
        const dateVal = ci.date     >= 0 ? parseGLDate(row[ci.date]) : '';

        if (!vendor && !desc) continue; // fully blank text row — skip

        // Categorize from GL account/description/vendor, in order of reliability
        const catText  = catRaw || desc || vendor;
        const category = detectGLCategory(catText);
        const catConf  = catFromCol
          ? (category !== 'other' ? 85 : 65)   // column present → higher baseline
          : (category !== 'other' ? 72 : 42);   // inferred from text

        glData.push({
          date:     dateVal,
          vendor:   vendor || desc,
          category,
          amount:   amt,
          confidence: { vendor: vendorConf, date: dateConf, amount: 95, category: catConf },
          _include: true,
        });
      }

      if (!glData.length) {
        statusEl.innerHTML = `<div class="err-banner">No valid expense rows found.
          Ensure the file has positive amounts and vendor or description data.</div>`;
        return;
      }

      const total = glData.reduce((s, r) => s + r.amount, 0);
      captureCheckpoint(activePropId, 'Before GL upload');
      logActivity('gl_uploaded', `GL file parsed — ${glData.length} entries`, { severity: 'info', actor: 'User', detail: file.name, financialImpact: fmt(total) });
      statusEl.innerHTML = `
        <div class="status-row ok" style="margin:0 0 2px;">
          <div class="status-dot ok"><svg width="10" height="10" viewBox="0 0 10 10">
            <polyline points="1.5,5 4,7.5 8.5,2.5" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/>
          </svg></div>
          <span>Parsed <strong>${glData.length} GL entries</strong> from
            <em>${esc(file.name)}</em> &mdash; total <strong>${fmt(total)}</strong></span>
        </div>`;

      renderGLResults();
    } catch (err) {
      statusEl.innerHTML = `<div class="err-banner">Error reading file: ${esc(String(err.message || err))}</div>`;
    }
  };
  reader.readAsArrayBuffer(file);
}

function renderGLResults() {
  const container   = document.getElementById('glResults');
  const importBarEl = document.getElementById('glImportBar');
  if (!glData.length) { container.innerHTML = ''; importBarEl.innerHTML = ''; return; }

  const included = glData.filter(r => r._include).length;
  const total    = glData.filter(r => r._include).reduce((s, r) => s + r.amount, 0);

  const catOpts = CATEGORIES.map(c => `<option value="${c}">${c}</option>`).join('');

  const rowsHtml = glData.map((r, i) => {
    const overall = Math.min(r.confidence.vendor, r.confidence.amount, r.confidence.category);
    const opts    = CATEGORIES.map(c =>
      `<option value="${c}"${r.category === c ? ' selected' : ''}>${c}</option>`
    ).join('');
    return `<tr class="${r._include ? '' : 'gl-row-excluded'}" id="glr-${i}">
      <td class="gl-td gl-td-cb">
        <input type="checkbox" ${r._include ? 'checked' : ''}
          onchange="glData[${i}]._include=this.checked;refreshGLFooter();
            document.getElementById('glr-${i}').className=this.checked?'':'gl-row-excluded';" />
      </td>
      <td class="gl-td gl-td-date">${esc(cleanHTML(r.date || '—'))}</td>
      <td class="gl-td">${esc(cleanHTML(r.vendor))}</td>
      <td class="gl-td">
        <select class="yardi-cat-sel" onchange="glData[${i}].category=this.value">${opts}</select>
      </td>
      <td class="gl-td gl-td-amt">${fmt(r.amount)}</td>
      <td class="gl-td">${confidenceBadge(overall)}</td>
    </tr>`;
  }).join('');

  container.innerHTML = `
    <div class="bulk-results-head" style="margin-top:16px;">
      <h3>Extracted GL Items (${glData.length})</h3>
      <button class="bulk-clear-btn" onclick="clearGLData()">&#x2715; Clear</button>
    </div>
    <div class="yardi-table-scroll" style="margin-top:10px;">
      <table class="gl-table">
        <thead><tr>
          <th class="gl-th gl-th-cb"></th>
          <th class="gl-th">Date</th>
          <th class="gl-th">Vendor / Description</th>
          <th class="gl-th">Category</th>
          <th class="gl-th gl-th-amt">Amount</th>
          <th class="gl-th">Confidence</th>
        </tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>
    <div class="gl-total-row">
      <span id="glIncludedCount">${included} of ${glData.length} items selected</span>
      <span id="glTotalAmt">Total: <strong>${fmt(total)}</strong></span>
    </div>`;

  importBarEl.innerHTML = `
    <button class="gl-import-btn" onclick="importGLToInvoices()">
      &#x2B07;&nbsp; Import ${included} Selected GL Items into Invoice List
    </button>`;
}

function refreshGLFooter() {
  const included = glData.filter(r => r._include).length;
  const total    = glData.filter(r => r._include).reduce((s, r) => s + r.amount, 0);
  const cEl = document.getElementById('glIncludedCount');
  const tEl = document.getElementById('glTotalAmt');
  if (cEl) cEl.textContent = `${included} of ${glData.length} items selected`;
  if (tEl) tEl.innerHTML  = `Total: <strong>${fmt(total)}</strong>`;
  const btn = document.querySelector('.gl-import-btn');
  if (btn) btn.textContent = `⬇ Import ${included} Selected GL Items into Invoice List`;
}

async function importGLToInvoices() {
  const items = glData.filter(r => r._include);
  if (!items.length) { alert('No GL items are selected.'); return; }

  items.forEach(r => {
    invoiceData.push({
      vendorName:  cleanHTML(r.vendor),
      amount:      r.amount,
      category:    r.category,
      invoiceDate: cleanHTML(r.date),
      confidence: {
        vendorName:  r.confidence.vendor,
        amount:      r.confidence.amount,
        category:    r.confidence.category,
        invoiceDate: r.confidence.date,
      },
      _error: null,
    });
  });

  renderInvResults();

  const property = currentProperty();
  if (!property) throw new Error('No property selected');
  const existing = { invoices: Array.from(property.invoices || []) };
  // invoiceData already has existing invoices (restored on selectProperty) + new GL items.
  property.invoices = Array.from(invoiceData);
  captureCheckpoint(activePropId, 'Before GL import');
  await saveProperty(property);
  logActivity('invoice_uploaded', `${items.length} GL item${items.length !== 1 ? 's' : ''} imported`, {
    severity:        'info',
    actor:           'User',
    detail:          'Imported from General Ledger',
    financialImpact: fmt(items.reduce((s, r) => s + r.amount, 0)),
  });

  const bar = document.getElementById('glImportBar');
  bar.innerHTML = `
    <div class="status-row ok" style="margin:10px 0 0;">
      <div class="status-dot ok"><svg width="10" height="10" viewBox="0 0 10 10">
        <polyline points="1.5,5 4,7.5 8.5,2.5" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/>
      </svg></div>
      <span><strong>${items.length} GL items imported</strong> to Invoice List &mdash;
        review below, then click <em>Calculate CAM Charges</em>.</span>
    </div>`;

  // Scroll to invoice results
  setTimeout(() => {
    const el = document.getElementById('invResults');
    if (el && el.innerHTML) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 120);
}

function clearGLData() {
  glData = [];
  document.getElementById('glResults').innerHTML   = '';
  document.getElementById('glImportBar').innerHTML = '';
  document.getElementById('glStatus').style.display = 'none';
  document.getElementById('glStatus').innerHTML    = '';
  document.getElementById('glFileInput').value     = '';
}

// ─── Upload Merge Helpers ─────────────────────────────────────────────────────
// New upload replaces existing tenant with the same name; others are kept.
function mergeTenantsDedup(existing, incoming) {
  const newNames = new Set(
    incoming.filter(t => t.tenant_name).map(t => t.tenant_name.trim().toLowerCase())
  );
  const kept = existing.filter(
    t => !t.tenant_name || !newNames.has(t.tenant_name.trim().toLowerCase())
  );
  return [...kept, ...incoming];
}

function dedupeTenants(arr) {
  // Key: fileName wins — same physical file uploaded twice = one entry.
  // Different files with the same tenant name = KEPT SEPARATE (e.g. two ShopRite spaces).
  // Entries with no name or file fall back to their stable id.
  const map = new Map();
  for (const t of arr) {
    const key = t.fileName || t.id || (t.tenant_name || '').toLowerCase().trim() || String(map.size);
    if (!map.has(key)) {
      map.set(key, t);
    } else {
      // If a later entry for the same file has a name and the existing one doesn't, prefer the later one
      const existing = map.get(key);
      if (!existing.tenant_name && t.tenant_name) map.set(key, t);
      // If a later entry has sqft and the existing one doesn't, prefer the later one
      else if (parseSqft(t.leased_sqft) > 0 && parseSqft(existing.leased_sqft) <= 0) map.set(key, t);
    }
  }
  return Array.from(map.values());
}

// Appends incoming invoices that don't already exist by vendor+amount+date.
function mergeInvoicesDedup(existing, incoming) {
  const seen = new Set(
    existing.map(inv =>
      `${(inv.vendorName || '').toLowerCase()}|${inv.amount}|${inv.invoiceDate || ''}`
    )
  );
  const novel = incoming.filter(inv => {
    const key = `${(inv.vendorName || '').toLowerCase()}|${inv.amount}|${inv.invoiceDate || ''}`;
    return !seen.has(key);
  });
  return [...existing, ...novel];
}

// ─── Lease Job Pipeline ───────────────────────────────────────────────────────
// Orchestration layer around the existing extraction flow.
// _leaseJobs (in-memory) is the real-time source of truth.
// lease_jobs (Supabase) is async-synced via fire-and-forget upserts.
// NO tenant row is written to Supabase until:
//   confidence is high/medium  OR  the user explicitly confirms via saveBulkTenant.

const _JOB_STAGES = {
  queued:        { label: 'Queued...',                   progress: 0   },
  upload:        { label: 'Uploading file...',           progress: 10  },
  OCR:           { label: 'Running OCR...',              progress: 30  },
  extraction:    { label: 'Extracting lease terms...',   progress: 55  },
  normalize:     { label: 'Normalizing...',              progress: 72  },
  confidence:    { label: 'Computing confidence...',     progress: 88  },
  persistence:   { label: 'Saving...',                   progress: 95  },
  completed:     { label: 'Completed',                   progress: 100 },
  manual_review: { label: 'Review required',             progress: 100 },
};

function createLeaseJob(file, propertyId) {
  const jobId = crypto.randomUUID();
  const now   = new Date().toISOString();
  const job   = {
    id:                      jobId,
    created_at:              now,
    updated_at:              now,
    status:                  'queued',
    stage:                   'upload',
    progress:                0,
    file_name:               file.name,
    file_size:               file.size,
    property_id:             propertyId,
    tenant_id:               null,
    confidence_level:        null,
    confidence_score:        null,
    extraction_route:        null,
    error_message:           null,
    processing_started_at:   null,
    processing_completed_at: null,
    retry_count:             0,
    debug_summary:           null,
    _file:    file,           // in-memory only
    _startMs: Date.now(),     // in-memory only
  };
  _leaseJobs.set(jobId, job);
  _syncJobToDb(job);
  return jobId;
}

function updateLeaseJob(jobId, updates) {
  const job = _leaseJobs.get(jobId);
  if (!job) return null;
  Object.assign(job, updates, { updated_at: new Date().toISOString() });
  _syncJobToDb(job);
  return job;
}

function _syncJobToDb(job) {
  // Strip in-memory-only fields before sending to Supabase
  const row = Object.fromEntries(Object.entries(job).filter(([k]) => !k.startsWith('_')));
  db.from('lease_jobs').upsert(row).then(({ error }) => {
    if (error) logError('lease_job_sync', error, { jobId: job.id, stage: job.stage });
  });
}

function failLeaseJob(jobId, err, stage) {
  updateLeaseJob(jobId, {
    status:                  'failed',
    stage:                   stage || 'extraction',
    progress:                _JOB_STAGES[stage]?.progress ?? 0,
    error_message:           err?.message || String(err),
    processing_completed_at: new Date().toISOString(),
  });
}

// Returns true if the tenant row requires manual review before Supabase persistence.
function finalizeLeaseJob(jobId, { norm, conf, meta, tenantId }) {
  const needsReview = conf.level === 'low' || conf.level === 'failed';
  updateLeaseJob(jobId, {
    status:                  needsReview ? 'review_required' : 'completed',
    stage:                   needsReview ? 'manual_review'   : 'completed',
    progress:                100,
    tenant_id:               tenantId,
    confidence_level:        conf.level,
    confidence_score:        conf.score,
    extraction_route:        meta.extractionRoute,
    processing_completed_at: new Date().toISOString(),
    debug_summary: {
      ocrChars:        meta.ocrChars,
      fileSizeBytes:   meta.fileSizeBytes,
      processingMs:    meta.processingMs,
      reasons:         conf.reasons,
      failedFields:    conf.failedFields,
      extractionRoute: meta.extractionRoute,
      tenant_name:     norm?.tenant_name  || null,
      leased_sqft:     norm?.leased_sqft  || null,
      start_date:      norm?.start_date   || null,
      end_date:        norm?.end_date     || null,
    },
  });
  return needsReview;
}

// Retry using the stored in-memory File — no re-upload dialog needed.
// Falls back to retryUploadForSlot if the file is no longer in memory.
async function retryLeaseJob(jobId) {
  const job = _leaseJobs.get(jobId);
  if (!job?._file) {
    console.warn('[retryLeaseJob] file not in memory for job:', jobId, '— falling back to file picker');
    const i = tenantData.findIndex(t => t.id === jobId);
    if (i !== -1) retryUploadForSlot(i);
    return;
  }
  const i = tenantData.findIndex(t => t.id === jobId);
  if (i === -1) { console.warn('[retryLeaseJob] tenantData entry not found for job:', jobId); return; }

  updateLeaseJob(jobId, {
    status:                  'processing',
    stage:                   'upload',
    progress:                0,
    error_message:           null,
    processing_started_at:   new Date().toISOString(),
    processing_completed_at: null,
    retry_count:             (job.retry_count || 0) + 1,
    confidence_level:        null,
    confidence_score:        null,
    tenant_id:               null,
  });
  job._startMs = Date.now();

  tenantData[i] = {
    ...tenantData[i],
    status:             'pending',
    extractionFailed:   false,
    _showRetry:         false,
    _error:             null,
    _confidence:        null,
    _confidenceScore:   null,
    _confidenceReasons: [],
    _autoExpand:        false,
    _pendingJobReview:  false,
    id:                 jobId,
    _jobId:             jobId,
  };

  const prop = currentProperty();
  if (prop) prop.tenants = [...tenantData];
  renderBulkResults();

  await _runLeaseJobPipeline(jobId, i);

  if (prop) prop.tenants = [...tenantData];
  renderBulkResults();
}

// Core extraction pipeline — extracted from processFile so retryLeaseJob can also call it.
// Writes tenantData[placeholderIdx] on completion (success or failure).
// Ghost-row protection: sets _pendingJobReview=true for low/failed confidence.
async function _runLeaseJobPipeline(jobId, placeholderIdx) {
  const job = _leaseJobs.get(jobId);
  if (!job) { console.error('[_runLeaseJobPipeline] job not found:', jobId); return; }
  const file       = job._file;
  const propertyId = job.property_id;
  const _startMs   = job._startMs || Date.now();
  console.warn('[PIPELINE:diag] entry | file:', file instanceof File, '| name:', file?.name, '| size:', file?.size, '| retry_count:', job.retry_count ?? 0, '| placeholderIdx:', placeholderIdx);

  updateLeaseJob(jobId, {
    status:                'processing',
    stage:                 'upload',
    progress:              _JOB_STAGES.upload.progress,
    processing_started_at: new Date().toISOString(),
  });
  renderBulkResults();

  try {
    let leaseText     = null;
    let extracted     = null;
    let usedPdfDirect = false;
    let leaseUrl      = null;

    // ── Stage: Upload + OCR ───────────────────────────────────────────────────
    console.groupCollapsed(`[LEASE:upload] ${file.name}`);
    try {
      [leaseUrl, leaseText] = await Promise.all([
        uploadLeaseToStorage(file, propertyId),
        extractLeaseText(file),
      ]);
      console.log('leaseUrl:', leaseUrl);
      console.log('leaseText length:', leaseText?.length ?? 0, '| preview:', (leaseText || '').slice(0, 120));
    } catch (err) {
      console.error('upload/extract failed:', err.message);
      logError('lease_upload_extract', err, { propId: propertyId, fileName: file.name, jobId });
    }
    console.groupEnd();

    updateLeaseJob(jobId, { stage: 'OCR', progress: _JOB_STAGES.OCR.progress });
    renderBulkResults();

    // ── Stage: Claude Extraction ──────────────────────────────────────────────
    console.groupCollapsed(`[LEASE:claude] ${file.name}`);
    try {
      if (leaseText && leaseText.length >= 50) {
        console.log('path: text extraction, chars:', leaseText.length);
        extracted = await callClaudeForLease(leaseText);
      } else {
        usedPdfDirect = true;
        console.log('path: PDF direct (text weak/missing, chars:', leaseText?.length ?? 0, ')');
        console.warn('[PIPELINE:diag] pre-pdfDirect | file:', file instanceof File, '| name:', file?.name, '| size:', file?.size, '| elapsedMs:', Date.now() - _startMs);
        extracted = await callClaudeWithPdfDirect(file);
        leaseText = extracted ? `[Claude PDF direct: ${file.name}]` : null;
      }
      console.log('raw extracted:', JSON.stringify(extracted)?.slice(0, 300));
    } catch (err) {
      console.error('[PIPELINE:diag] Claude stage FAILED | msg:', err.message, '| stack:', (err.stack || '').split('\n').slice(0, 4).join(' | '), '| elapsedMs:', Date.now() - _startMs, '| route:', usedPdfDirect ? 'pdf-direct' : 'text', '| file:', file instanceof File, '| name:', file?.name);
      logError('lease_claude_extraction', err, { propId: propertyId, fileName: file.name, jobId });
    }
    console.groupEnd();

    updateLeaseJob(jobId, { stage: 'extraction', progress: _JOB_STAGES.extraction.progress });
    renderBulkResults();

    if (extracted && !usedPdfDirect) extracted.rawText = leaseText;

    // ── Stage: Normalize ──────────────────────────────────────────────────────
    updateLeaseJob(jobId, { stage: 'normalize', progress: _JOB_STAGES.normalize.progress });
    renderBulkResults();

    const norm = extracted ? normalizeTenant(extracted) : null;

    // ── Stage: Confidence ─────────────────────────────────────────────────────
    updateLeaseJob(jobId, { stage: 'confidence', progress: _JOB_STAGES.confidence.progress });
    renderBulkResults();

    const _meta = {
      extractionRoute:  usedPdfDirect ? 'pdf-direct' : 'text',
      ocrChars:         (!usedPdfDirect && leaseText) ? leaseText.length : 0,
      fileSizeBytes:    file.size,
      processingMs:     Date.now() - _startMs,
      extractionFailed: !norm,
    };
    const _conf = computeExtractionConfidence(norm, _meta);
    _meta.confidence      = _conf.level;
    _meta.confidenceScore = _conf.score;

    console.groupCollapsed(`[LEASE:normalize] ${file.name}`);
    console.log('fields:', JSON.stringify({ tenant_name: norm?.tenant_name, leased_sqft: norm?.leased_sqft, start_date: norm?.start_date, end_date: norm?.end_date, lease_type: norm?.lease_type, cap: norm?.cap }));
    console.log('confidence:', _conf.level, `(${_conf.score}/100)`, '| route:', _meta.extractionRoute, '| file:', (file.size / 1024).toFixed(1) + 'KB', '| ocr chars:', _meta.ocrChars, '| ms:', _meta.processingMs);
    if (_conf.reasons.length)      console.log('reasons:', _conf.reasons.join('; '));
    if (_conf.failedFields.length) console.log('failedFields:', _conf.failedFields.join(', '));
    console.groupEnd();

    // ── Stage: Persistence ────────────────────────────────────────────────────
    updateLeaseJob(jobId, { stage: 'persistence', progress: _JOB_STAGES.persistence.progress });
    renderBulkResults();

    const claudeName   = norm?.tenant_name?.trim() || '';
    const regexName    = extractTenantFromText(leaseText || '');
    const filenameName = file.name.replace(/\.[^.]+$/, '').replace(/[_\-]+/g, ' ').trim();
    const resolvedName = claudeName || regexName || filenameName;
    const nameFromClaude = !!claudeName;

    const hasTenant     = !!(claudeName || regexName);
    const hasLeaseType  = !!norm?.lease_type;
    const hadExtraction = !!extracted;

    let status;
    if (!hadExtraction || !hasTenant) {
      status = 'failed';
    } else if (!norm?.start_date || !norm?.end_date || !hasLeaseType) {
      status = 'partial';
    } else {
      status = 'success';
    }

    const isPartial  = status === 'partial';
    const _showRetry = status === 'failed';

    // Processing isolation: low/failed confidence sets _pendingJobReview so the
    // resyncTenantsToTable filter blocks this row until the user explicitly saves.
    const needsJobReview = _conf.level === 'low' || _conf.level === 'failed';

    const finalEntry = {
      tenant_name:          resolvedName || null,
      leased_sqft:          norm?.leased_sqft        ?? null,
      start_date:           norm?.start_date         ?? null,
      end_date:             norm?.end_date           ?? null,
      lease_type:           norm?.lease_type         ?? null,
      cap:                  norm?.cap                ?? null,
      flags:                norm?.flags              ?? [],
      doc_has_dates:        norm?.doc_has_dates      ?? false,
      doc_has_lease_type:   norm?.doc_has_lease_type ?? false,
      leaseFile:            file,
      leaseExpected:        true,
      fileName:             file.name,
      leaseUrl,
      status,
      extractionFailed:     status === 'failed',
      _needsReview:         isPartial,
      _showRetry,
      _nameFromClaude:      nameFromClaude,
      _error:               status === 'failed' ? 'Extraction failed — tap Retry to re-upload' : null,
      _confidence:          _conf.level,
      _confidenceScore:     _conf.score,
      _confidenceReasons:   _conf.reasons,
      _meta,
      _autoExpand:          _conf.level === 'low' || _conf.level === 'failed',
      _userConfirmed:       false,
      _pendingJobReview:    needsJobReview,
      id:                   jobId,
      _jobId:               jobId,
    };

    tenantData[placeholderIdx] = finalEntry;
    storeLeaseFile(jobId, file);

    _leaseDebug.set(jobId, {
      tenantId:        jobId,
      fileName:        file.name,
      fileSizeBytes:   file.size,
      extractionRoute: _meta.extractionRoute,
      ocrText:         (!usedPdfDirect && leaseText && !leaseText.startsWith('[Claude')) ? leaseText.slice(0, 2000) : null,
      normalizedText:  (!usedPdfDirect && leaseText && !leaseText.startsWith('[Claude')) ? normalizeText(leaseText).slice(0, 2000) : null,
      rawExtracted:    extracted,
      norm,
      confidence:      _conf,
      meta:            { ..._meta },
      failureStage:    null,
      error:           null,
    });

    if (status === 'failed') {
      failLeaseJob(jobId, { message: finalEntry._error || 'Extraction failed' }, 'extraction');
    } else {
      finalizeLeaseJob(jobId, { norm, conf: _conf, meta: _meta, tenantId: jobId });
    }

  } catch (err) {
    logError('lease_processFile', err, { propId: propertyId, fileName: file.name, jobId });
    tenantData[placeholderIdx] = {
      tenant_name:       null,
      leased_sqft:       null,
      start_date:        null,
      end_date:          null,
      lease_type:        null,
      fileName:          file.name,
      leaseFile:         file,
      leaseExpected:     true,
      status:            'failed',
      extractionFailed:  true,
      _needsReview:      false,
      _showRetry:        true,
      _error:            err.message || 'Processing error',
      id:                jobId,
      _jobId:            jobId,
    };
    failLeaseJob(jobId, err, 'processFile');
    _leaseDebug.set(jobId, {
      tenantId:        jobId,
      fileName:        file.name,
      fileSizeBytes:   file.size,
      extractionRoute: 'unknown',
      ocrText:         null,
      normalizedText:  null,
      rawExtracted:    null,
      norm:            null,
      confidence:      { level: 'failed', score: 0, reasons: ['Unhandled exception in processFile'], failedFields: ['all'] },
      meta:            { extractionFailed: true, processingMs: Date.now() - _startMs },
      failureStage:    'processFile',
      error:           { message: err.message, stack: (err.stack || '').split('\n').slice(0, 5).join('\n') },
    });
  }
}

// ─── Bulk Lease Upload ────────────────────────────────────────────────────────

async function handleBulkLeases(fileList) {
  if (!fileList || fileList.length === 0) return;
  console.log('[handleBulkLeases] dropped', fileList.length, 'file(s):', Array.from(fileList).map(f => f.name).join(', '));

  const property = currentProperty();
  if (!property) throw new Error('No property selected');

  // Preserve existing tenants — new uploads append rather than replace
  const files = Array.from(fileList);
  const total = files.length;

  const prog    = document.getElementById('bulkProgress');
  const results = document.getElementById('bulkResults');
  results.innerHTML = '';
  prog.style.display = 'block';
  document.getElementById('bulkLeaseInput').value = '';

  let completed = 0;
  const _progUpdate = () => {
    const pct = Math.round((completed / total) * 100);
    prog.innerHTML = `
      <div class="bulk-progress-wrap">
        <div class="bulk-progress-label">Processing leases… ${completed} of ${total} done</div>
        <div class="bulk-progress-track">
          <div class="bulk-progress-fill" style="width:${pct}%"></div>
        </div>
      </div>`;
  };
  _progUpdate();

  // Process all files in parallel — OCR and Claude run concurrently.
  // Process in small batches: parallel within each batch, sequential between
  // batches so we don't hit DB / OCR rate limits.
  // Ensure property has a DB id once before processing any files
  if (!property.id) await saveProperty(property);

  const BATCH_SIZE = 2;
  const processFile = async (file) => {
    // jobId IS the tenantId — single UUID shared by both systems, preventing duplicates.
    const jobId = createLeaseJob(file, property.id);

    const placeholderIdx = tenantData.length;
    tenantData.push({ id: jobId, _jobId: jobId, fileName: file.name, status: 'pending', tenant_name: null, leaseExpected: true, _showRetry: false, _needsReview: false, extractionFailed: false });
    property.tenants = [...tenantData];
    renderBulkResults();

    await _runLeaseJobPipeline(jobId, placeholderIdx);

    completed++;
    _progUpdate();
    property.tenants = [...tenantData];
    renderBulkResults();
  };

  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    await Promise.all(files.slice(i, i + BATCH_SIZE).map(processFile));
  }

  prog.innerHTML = `
    <div class="bulk-progress-wrap">
      <div class="bulk-progress-label">&#x2713; ${total} lease${total !== 1 ? 's' : ''} processed — review and edit below</div>
      <div class="bulk-progress-track">
        <div class="bulk-progress-fill" style="width:100%"></div>
      </div>
    </div>`;


  // Dedup by name for persistence only (nameless entries keep their id-based key and are retained)
  // Filter nulls first — dedupeTenants cannot handle null entries (crashes on null.fileName).
  property.tenants = dedupeTenants(tenantData.filter(t => t !== null));

  renderBulkResults();
  checkSqftValidation();

  // Save property row, then resync tenants ONCE after all files are done.
  // Doing this inside processFile caused cumulative inserts: 1+2+3+4+5 = 15 rows for 5 files.
  captureCheckpoint(activePropId, 'Before lease upload');
  await saveProperty(property);
  // Exclude failed extractions — only persist tenants with at minimum a real name
  await resyncTenantsToTable(property.id, property.tenants.filter(t => t?.tenant_name && (!t?.extractionFailed || t?._userConfirmed) && !t?._pendingJobReview));
  {
    const successCount = tenantData.filter(t => t.status === 'success').length;
    logActivity('lease_uploaded', `${total} lease${total !== 1 ? 's' : ''} uploaded`, {
      severity:      'info',
      actor:         'User',
      relatedEntity: property.name || '',
      detail:        `${successCount} of ${total} extracted successfully`,
    });
  }
}

function updateTenantField(index, field, value) {
  // Primary write: property.tenants by stable id
  const prop = currentProperty();
  const td = tenantData[index];
  if (prop?.tenants && td?.id) {
    const pt = prop.tenants.find(t => t?.id === td.id);
    if (pt) pt[field] = value;
    else if (prop.tenants[index]) prop.tenants[index][field] = value;
  }
  // Mirror: keep tenantData in sync as working buffer
  if (td) td[field] = value;
}

function handleFieldBlur(index, field, value) {
  isEditingField = false;
  updateTenantField(index, field, value);
  savePropertyData(); // debounced — collapses rapid edits into one write
}

function _confidenceBadgeHtml(level) {
  if (!level || level === 'pending') return '';
  const cfg = {
    high:   { cls: 'cx-high',   label: 'High confidence' },
    medium: { cls: 'cx-medium', label: 'Review recommended' },
    low:    { cls: 'cx-low',    label: 'Low confidence' },
    failed: { cls: 'cx-failed', label: 'Extraction failed' },
  }[level];
  if (!cfg) return '';
  return `<span class="cx-badge ${cfg.cls}">${cfg.label}</span>`;
}

// ── Lease Review Status helpers ────────────────────────────────────────────
// Pure functions — read tenant fields only, no mutations, no pipeline access.
function getLeaseReviewStatus(t) {
  if (!t || !t.tenant_name || (t.extractionFailed && !t._userConfirmed)) return 'incomplete';
  const sqft = parseFloat(t.leased_sqft);
  const missing = !t.lease_type
    || !t.start_date
    || !t.end_date
    || (t.leased_sqft === '' || t.leased_sqft == null);
  const badSqft = !isNaN(sqft) && sqft <= 0;
  const recon = lastResults.find(r => r.name === t.tenant_name);
  const badProRata = recon && recon.proRata > 1.0;
  if (missing || badSqft || badProRata) return 'needs-review';
  return 'ready';
}

function getLeaseReviewNotes(t) {
  if (!t) return ['No lease data available'];
  const notes = [];
  if (t.leased_sqft === '' || t.leased_sqft == null) {
    notes.push('Square footage not found — verify against lease');
  } else if (parseFloat(t.leased_sqft) <= 0) {
    notes.push('Square footage may require verification');
  }
  if (!t.start_date) notes.push('Lease start date missing');
  if (!t.end_date)   notes.push('Lease end date missing');
  if (!t.lease_type) notes.push('Lease type could not be determined');
  const recon = lastResults.find(r => r.name === t.tenant_name);
  if (recon && recon.proRata > 1.0) notes.push('Pro-rata exceeds 100% — verify square footage');
  if (t._usedFallback) notes.push('Lease dates extracted from document text — confirm accuracy');
  return notes;
}

function _reviewStatusPillHtml(status) {
  const cfg = {
    'ready':        { cls: 'lrs-ready',       label: '✓ Ready' },
    'needs-review': { cls: 'lrs-needs-review', label: '⚠ Needs Review' },
    'incomplete':   { cls: 'lrs-incomplete',   label: '✕ Incomplete' },
  }[status] || { cls: 'lrs-needs-review', label: '? Unknown' };
  return `<span class="lrs-pill ${cfg.cls}">${cfg.label}</span>`;
}

// ── Tenant-level Review State + Scoring ──────────────────────────────────────
// Pure derived state — computed at render time, no persistence.

function getTenantReviewState(t) {
  if (!t) return 'incomplete';
  // manually_verified: any field has been explicitly confirmed by a reviewer
  const overrides = t.reviewOverrides || {};
  if (Object.values(overrides).some(ov => ov?.reviewerConfirmed)) return 'manually_verified';
  // incomplete: any critical field absent
  if (!t.lease_type || !t.leased_sqft || !t.start_date || !t.end_date) return 'incomplete';
  // needs_review: heuristic signals
  const sqftConf = t.confidence?.leased_sqft ?? t.confidence?.leasedSqft;
  const isNNN    = /nnn|triple[\s-]?net/i.test(String(t.lease_type || ''));
  if (
    t._usedFallback === true ||
    (sqftConf != null && sqftConf < 70) ||
    (isNNN && (t.cap == null || t.cap === '')) ||
    t._needsReview === true
  ) return 'needs_review';
  return 'verified';
}

function getTenantReviewScore(t) {
  if (!t) return 0;
  let score = 100;
  if (!t.leased_sqft) score -= 25;
  if (!t.lease_type)  score -= 25;
  if (t._usedFallback) score -= 15;
  const sqftConf = t.confidence?.leased_sqft ?? t.confidence?.leasedSqft;
  if (sqftConf != null && sqftConf < 70) score -= 10;
  const isNNN = /nnn|triple[\s-]?net/i.test(String(t.lease_type || ''));
  if (isNNN && (t.cap == null || t.cap === '')) score -= 10;
  const warnings = getWarnings(computeFlags(t));
  score -= warnings.length * 5;
  return Math.max(0, Math.min(100, score));
}

function _tenantReviewStateBadgeHtml(t) {
  if (!t) return '';
  const state = getTenantReviewState(t);
  const score = getTenantReviewScore(t);
  const cfg = {
    verified:          { cls: 'trs-verified',          label: 'Verified' },
    needs_review:      { cls: 'trs-needs-review',      label: 'Needs Review' },
    incomplete:        { cls: 'trs-incomplete',        label: 'Incomplete' },
    manually_verified: { cls: 'trs-manually-verified', label: 'Manually Verified' },
  }[state] || { cls: 'trs-needs-review', label: 'Unknown' };
  const scoreColor = score >= 90 ? 'trs-score--high' : score >= 70 ? 'trs-score--mid' : 'trs-score--low';
  return `<div class="trs-header">
    <span class="trs-badge ${cfg.cls}">${cfg.label}</span>
    <span class="trs-score ${scoreColor}">Score: ${score}</span>
  </div>`;
}
// ─────────────────────────────────────────────────────────────────────────────

// ── Field Confidence + Source Trace helpers ────────────────────────────────
// Pure functions — read tenant fields and metadata only, no mutations.
function getFieldConfidence(fieldName, t) {
  if (!t) return { status: 'missing', source: 'missing', note: 'No lease data' };
  const val = (fieldName === 'proRata') ? null : t[fieldName];
  const isEmpty = val === null || val === undefined || String(val).trim() === '';

  switch (fieldName) {
    case 'start_date':
    case 'end_date': {
      if (isEmpty) return { status: 'missing', source: 'missing', note: 'Not found in extraction' };
      if (t._usedFallback)           return { status: 'estimated', source: 'heuristic', note: 'Estimated from document text — confirm accuracy' };
      if (t.doc_has_dates === false) return { status: 'estimated', source: 'heuristic', note: 'No structured date field found — date inferred' };
      return { status: 'verified', source: 'structured', note: 'Extracted from lease document' };
    }
    case 'lease_type': {
      if (isEmpty) return { status: 'missing', source: 'missing', note: 'Lease type not identified' };
      if (t.doc_has_lease_type === false) return { status: 'estimated', source: 'ocr', note: 'Lease type inferred from document context' };
      return { status: 'verified', source: 'structured', note: 'Extracted from lease document' };
    }
    case 'leased_sqft': {
      if (isEmpty) return { status: 'missing', source: 'missing', note: 'Square footage not found' };
      const fc = t.confidence?.leased_sqft ?? t.confidence?.leasedSqft;
      if (fc != null && fc < 70) return { status: 'estimated', source: 'ocr', note: 'Confidence below threshold — verify against lease' };
      return { status: 'verified', source: 'structured', note: 'Extracted from lease document' };
    }
    case 'cap': {
      if (isEmpty) return { status: 'missing', source: 'missing', note: 'CAM cap not stated in lease' };
      return { status: 'verified', source: 'structured', note: 'Extracted from lease document' };
    }
    case 'proRata': {
      const sqftConf = getFieldConfidence('leased_sqft', t);
      if (sqftConf.status === 'missing')   return { status: 'missing',   source: 'missing',    note: 'Cannot compute — square footage missing' };
      if (sqftConf.status === 'estimated') return { status: 'estimated', source: 'heuristic',  note: 'Computed from estimated square footage' };
      return { status: 'verified', source: 'structured', note: 'Computed from verified square footage' };
    }
    default:
      return isEmpty
        ? { status: 'missing',  source: 'missing',    note: 'Not found' }
        : { status: 'verified', source: 'structured', note: 'Extracted from lease document' };
  }
}

function isFieldManuallyVerified(fieldName, t) {
  return !!(t?.reviewOverrides?.[fieldName]?.reviewerConfirmed);
}

function renderManualVerifiedBadge(fieldName, t) {
  if (!isFieldManuallyVerified(fieldName, t)) return '';
  return `<div class="lfc-manual-badge">✓ Manually Verified</div>`;
}

// Always shows the underlying AI confidence state — manual badge is the
// sole "Manually Verified" indicator, so no duplicate label here.
function renderFieldConfidenceHtml(fieldName, t) {
  const conf = getFieldConfidence(fieldName, t);
  const icon = conf.status === 'verified' ? '✓' : conf.status === 'estimated' ? '⚠' : '—';
  return `<span class="lfc-meta lfc-${conf.status}">${icon} ${esc(conf.note)}</span>`;
}
// ─────────────────────────────────────────────────────────────────────────────

// ── Field Override + Manual Confirmation ──────────────────────────────────
// Priority: manual override → extracted value → null.
// Resolver used by all display layers so override logic stays in one place.
function getEffectiveLeaseField(fieldName, t) {
  if (!t) return null;
  const ov = t.reviewOverrides?.[fieldName];
  return (ov?.reviewerConfirmed ? ov.override : null) ?? t[fieldName] ?? null;
}

// Editable fields — proRata is computed, not directly stored
const _LFC_EDITABLE = new Set(['lease_type', 'leased_sqft', 'start_date', 'end_date', 'cap']);

// Renders inner HTML for one LFC item.
// Pass isEditing=true to render the inline input; false (default) for display mode.
function _lfcItemInner(key, label, val, td, isEditing = false) {
  const editable = _LFC_EDITABLE.has(key) && td?.id;

  if (isEditing) {
    const inputType = _getFieldInputType(key);
    const inputVal  = esc(String(getEffectiveLeaseField(key, td) ?? val ?? ''));
    return `<div class="lfc-label">${esc(label)}</div>
      <div class="lfc-edit-wrap">
        <input class="lfc-edit-input" data-lfc-input="${key}" type="${inputType}" value="${inputVal}"${inputType === 'number' ? ' inputmode="decimal"' : ''} />
        <div class="lfc-edit-actions">
          <button class="lfc-save-btn"   onclick="confirmFieldOverride('${td.id}','${key}')">Save</button>
          <button class="lfc-cancel-btn" onclick="cancelFieldOverride('${td.id}','${key}')">Cancel</button>
        </div>
      </div>`;
  }

  const missingCls = val == null ? 'lfc-missing' : '';
  return `<div class="lfc-label">${esc(label)}</div>
    <div class="lfc-value-row">
      <div class="lfc-value ${missingCls}">${val ?? '—'}</div>
      ${editable ? `<button class="lfc-edit-btn" onclick="startFieldOverride('${td.id}','${key}')">Edit</button>` : ''}
    </div>
    ${renderFieldConfidenceHtml(key, td)}
    ${renderManualVerifiedBadge(key, td)}`;
}

// Saves a manual override to the tenant object + triggers persistence.
function saveFieldOverride(tenantId, fieldName, newValue) {
  const idx = tenantData.findIndex(t => t && t.id === tenantId);
  if (idx === -1) return;
  const t = tenantData[idx];
  const prev = t.reviewOverrides || {};
  // Preserve the very first extracted value as the permanent original
  const original = prev[fieldName]?.original ?? (t[fieldName] ?? null);
  tenantData[idx] = {
    ...t,
    [fieldName]: newValue,   // update live field so reconciliation reads override
    reviewOverrides: {
      ...prev,
      [fieldName]: { original, override: newValue, reviewerConfirmed: true, reviewedAt: new Date().toISOString(), overrideSource: 'manual' },
    },
  };
  savePropertyData();
  renderBulkResults();
  _refreshLfcExpansion(tenantId);
  showToast('✓ Field updated — re-run reconciliation to apply to totals.', { color: '#0c4a6e', textColor: '#7dd3fc', duration: 4000 });
}

// Transforms an LFC item to inline edit mode.
function startFieldOverride(tenantId, fieldName) {
  const item = document.querySelector(`.lfc-item[data-tenant-id="${tenantId}"][data-field-name="${fieldName}"]`);
  if (!item) return;
  const t = tenantData.find(x => x && x.id === tenantId);
  if (!t) return;
  const label = item.querySelector('.lfc-label')?.textContent || fieldName;
  const val   = getEffectiveLeaseField(fieldName, t);
  item.innerHTML = _lfcItemInner(fieldName, label, val, t, true);
  setTimeout(() => {
    const el = document.querySelector(`[data-lfc-input="${fieldName}"]`);
    if (el) { el.focus(); el.select?.(); }
  }, 0);
}

// Reads the inline input and commits the override.
function confirmFieldOverride(tenantId, fieldName) {
  const input = document.querySelector(`[data-lfc-input="${fieldName}"]`);
  const val   = input?.value?.trim() || null;
  saveFieldOverride(tenantId, fieldName, val);
}

// Restores the item to display mode without saving.
function cancelFieldOverride(tenantId, fieldName) {
  _refreshLfcExpansion(tenantId);
}

// Enter key commits the active inline edit — registered once at module load.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const input = e.target.closest?.('[data-lfc-input]');
  if (!input) return;
  e.preventDefault();
  const fieldName = input.dataset.lfcInput;
  const tenantId  = input.closest('[data-tenant-id]')?.dataset?.tenantId;
  if (tenantId && fieldName) confirmFieldOverride(tenantId, fieldName);
});

// Returns correct <input> type for each field — drives native mobile pickers.
function _getFieldInputType(fieldName) {
  if (fieldName === 'start_date' || fieldName === 'end_date') return 'date';
  if (fieldName === 'leased_sqft' || fieldName === 'cap')     return 'number';
  return 'text';
}

// Closes and re-renders the expansion row for a tenant after an override is saved/cancelled.
function _refreshLfcExpansion(tenantId) {
  const t = tenantData.find(x => x && x.id === tenantId);
  if (!t?.tenant_name) return;
  const allRows = Array.from(document.querySelectorAll('#rptBody tr[data-tenant-name]'));
  const tr = allRows.find(el => el.dataset.tenantName === t.tenant_name);
  if (!tr) return;
  closeReportTenantExpansion();
  renderReportTenantExpansion(tr, t.tenant_name);
}
// ─────────────────────────────────────────────────────────────────────────────

function _copyDebugFromEl(elId, btn) {
  const el = document.getElementById(elId);
  if (!el) return;
  const text = el.textContent || '';
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => {
      const orig = btn.textContent; btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = orig; }, 1500);
    }).catch(() => window.prompt('Copy:', text));
  } else {
    window.prompt('Copy:', text);
  }
}

function toggleLeaseDebug(i) {
  const panel = document.getElementById('cxdbg-' + i);
  if (!panel) return;
  panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
}

function renderLeaseDebugPanel(d, i) {
  const dbg = _leaseDebug.get(d.id);
  if (!dbg) {
    return `<div class="cx-debug-panel" id="cxdbg-${i}" style="display:none;">
      <div class="cx-debug-section">
        <div class="cx-debug-label">Debug</div>
        <div class="cx-debug-val">No debug data — entry was loaded from storage before this session.</div>
      </div></div>`;
  }
  const m    = dbg.meta       || {};
  const c    = dbg.confidence || {};
  const sizeKb  = dbg.fileSizeBytes != null ? (dbg.fileSizeBytes / 1024).toFixed(1) + ' KB' : '—';
  const routeMap = { text: 'Text layer → Claude', 'pdf-direct': 'Claude PDF vision (direct)', unknown: 'Unknown (error before route)' };
  const routeLabel = routeMap[dbg.extractionRoute] || dbg.extractionRoute || '—';

  const sec1 = `<div class="cx-debug-section">
    <div class="cx-debug-label">Extraction</div>
    <div class="cx-debug-val"><b>Route:</b> ${esc(routeLabel)} &nbsp;|&nbsp; <b>Time:</b> ${m.processingMs != null ? m.processingMs + ' ms' : '—'} &nbsp;|&nbsp; <b>Size:</b> ${esc(sizeKb)}</div>
  </div>`;

  const reasonsHtml = c.reasons?.length
    ? `<div class="cx-debug-val" style="margin-top:3px;">${c.reasons.map(r => '• ' + esc(r)).join('<br>')}</div>` : '';
  const sec2 = `<div class="cx-debug-section">
    <div class="cx-debug-label">Confidence</div>
    <div class="cx-debug-val"><b>Level:</b> ${esc(c.level || '—')} &nbsp;|&nbsp; <b>Score:</b> ${c.score != null ? c.score + '/100' : '—'} &nbsp;|&nbsp; <b>Failed fields:</b> ${c.failedFields?.length ? esc(c.failedFields.join(', ')) : 'none'}</div>
    ${reasonsHtml}
  </div>`;

  const ocrChars = m.ocrChars ?? '—';
  const weakFlag = m.ocrChars != null && m.ocrChars < 500 ? ' ⚠ (weak)' : '';
  const sec3 = `<div class="cx-debug-section">
    <div class="cx-debug-label">OCR Metrics</div>
    <div class="cx-debug-val"><b>OCR chars:</b> ${ocrChars}${weakFlag} &nbsp;|&nbsp; <b>Stored preview:</b> ${dbg.ocrText ? dbg.ocrText.length + ' chars' : 'none (PDF direct)'}</div>
  </div>`;

  const missing = c.failedFields?.length ? c.failedFields : (d.extractionFailed ? ['all'] : []);
  const sec4 = `<div class="cx-debug-section">
    <div class="cx-debug-label">Missing Fields</div>
    <div class="cx-debug-val">${missing.length ? esc(missing.join(', ')) : 'none'}</div>
  </div>`;

  const rawClaudeStr = dbg.rawExtracted != null ? JSON.stringify(dbg.rawExtracted, null, 2) : null;
  const normStr      = dbg.norm         != null ? JSON.stringify(dbg.norm,         null, 2) : null;

  const ocrBlock = dbg.ocrText
    ? `<details><summary class="cx-debug-label" style="display:list-item;cursor:pointer;">OCR Text Preview (2000 chars max)</summary>
        <pre class="cx-debug-pre" id="cxdbg-ocr-${i}">${esc(dbg.ocrText)}</pre></details>`
    : '<div class="cx-debug-val">No OCR text (PDF direct path or error).</div>';

  const rawBlock = rawClaudeStr
    ? `<details><summary class="cx-debug-label" style="display:list-item;cursor:pointer;">Raw Claude Response <button class="cx-debug-copy" onclick="event.stopPropagation();_copyDebugFromEl('cxdbg-raw-${i}',this)">Copy</button></summary>
        <pre class="cx-debug-pre" id="cxdbg-raw-${i}">${esc(rawClaudeStr)}</pre></details>`
    : '<div class="cx-debug-val">No raw Claude response captured.</div>';

  const normBlock = normStr
    ? `<details><summary class="cx-debug-label" style="display:list-item;cursor:pointer;">Normalized Object <button class="cx-debug-copy" onclick="event.stopPropagation();_copyDebugFromEl('cxdbg-norm-${i}',this)">Copy</button></summary>
        <pre class="cx-debug-pre" id="cxdbg-norm-${i}">${esc(normStr)}</pre></details>`
    : '<div class="cx-debug-val">No normalized object.</div>';

  const sec5 = `<div class="cx-debug-section">
    <div class="cx-debug-label">Raw Outputs</div>
    ${ocrBlock}
    ${rawBlock}
    ${normBlock}
  </div>`;

  let sec6 = '';
  if (dbg.failureStage || dbg.error) {
    sec6 = `<div class="cx-debug-section">
      <div class="cx-debug-label" style="color:#fca5a5;">Failure Diagnostics</div>
      <div class="cx-debug-val"><b>Stage:</b> ${esc(dbg.failureStage || '—')}</div>
      ${dbg.error ? `<div class="cx-debug-val" style="margin-top:3px;"><b>Error:</b> ${esc(dbg.error.message || '—')}</div>` : ''}
      ${dbg.error?.stack ? `<pre class="cx-debug-pre">${esc(dbg.error.stack)}</pre>` : ''}
    </div>`;
  }

  return `<div class="cx-debug-panel" id="cxdbg-${i}" style="display:none;">
    <div style="padding-bottom:6px;margin-bottom:8px;border-bottom:1px solid rgba(99,102,241,0.25);">
      <span style="font-weight:600;color:#a5b4fc;">🛠 Lease Debug</span>
      <span style="color:#64748b;margin-left:8px;font-size:0.73rem;">${esc(dbg.fileName)}</span>
    </div>
    ${sec1}${sec2}${sec3}${sec4}${sec5}${sec6}
  </div>`;
}

function renderBulkResults() {
  const el = document.getElementById('bulkResults');
  el.innerHTML = '';
  el.scrollTop = 0;

  // tenantData is the source of truth — contains every file, including failed extractions.
  // Do NOT filter by tenant_name or status here; every file must render a card.
  const tenants = tenantData.filter(t => t && typeof t === 'object');
  const _debugMode = !!(window.DEBUG_LEASES || localStorage.getItem('ms_debug_leases') === '1');

  if (!tenants.length) return;

  // Build a set of tenant names that appear more than once (case-insensitive).
  // Used to show a "possible duplicate" badge so the user knows to review them.
  const _nameCount = new Map();
  tenants.forEach(t => {
    if (!t.tenant_name) return;
    const key = t.tenant_name.trim().toLowerCase();
    _nameCount.set(key, (_nameCount.get(key) || 0) + 1);
  });
  const _dupNames = new Set([..._nameCount.entries()].filter(([, n]) => n > 1).map(([k]) => k));

  const rows = tenants.map((d, i) => {
    if (!d) return '';
    const sqft      = d.leased_sqft  || null;
    const start     = d.start_date  || null;
    const end       = d.end_date    || null;
    const leaseType = d.lease_type  || null;
    const capPct    = d.cap         ?? null;
    const showRetryButton = d.extractionFailed || d._showRetry;
    const showWarning     = d._needsReview;

    const displayName = d.tenant_name && d.tenant_name.trim().length > 0
      ? d.tenant_name
      : '(unknown — click to edit)';
    const isWeakName  = d.tenant_name ? !isStrongName(d.tenant_name) : false;
    const isDupName   = d.tenant_name ? _dupNames.has(d.tenant_name.trim().toLowerCase()) : false;

    const isPending = d.status === 'pending';
    const confLevel = d._confidence || (d.extractionFailed ? 'failed' : d._needsReview ? 'medium' : null);
    const icon = isPending ? '⏳' : d.extractionFailed ? '❌' : showWarning ? '⚠️' : d.tenant_name ? '✓' : '?';

    // Job progress state — only relevant when pending
    const _job        = _leaseJobs.get(d.id);
    const _jobStage   = _job?.stage    || 'upload';
    const _jobPct     = _job?.progress ?? 0;
    const _jobElapsed = _job?._startMs ? ((Date.now() - _job._startMs) / 1000).toFixed(1) + 's' : '';
    const _stageLabel = _JOB_STAGES[_jobStage]?.label ?? 'Processing...';

    const meta = isPending
      ? _stageLabel
      : d.extractionFailed
      ? 'Extraction failed — tap to re-upload'
      : showWarning
        ? 'Partial — some fields missing'
        : [
            sqft      !== null && sqft      !== '' ? `${sqft} sqft`   : '— sqft',
            start     !== null && start     !== '' ? start             : '—',
            end       !== null && end       !== '' ? end               : '—',
            leaseType !== null && leaseType !== '' ? leaseType         : '—',
          ].join(' · ');

    const jobProgressHtml = isPending ? `
      <div class="cx-job-progress-track">
        <div class="cx-job-progress-fill" style="width:${_jobPct}%"></div>
      </div>
      ${_jobElapsed ? `<span class="cx-job-elapsed">${_jobElapsed}</span>` : ''}
    ` : '';

    const dupBadge = isDupName
      ? `<span style="font-size:0.72rem;background:#78350f40;border:1px solid #f59e0b;color:#fbbf24;border-radius:4px;padding:1px 6px;margin-left:6px;white-space:nowrap;">⚠ Duplicate name — add unit # or remove one</span>`
      : '';

    // Confidence banner text and colour for the expanded detail header
    const confBannerHtml = (() => {
      if (isPending || !confLevel) return '';
      if (confLevel === 'failed') {
        return `<div class="cx-detail-banner cx-banner-failed">
          ❌ Extraction failed — AI could not read this document. Fill in the fields below and click Save to confirm manually.
          ${d._confidenceReasons?.length ? `<div class="cx-reasons">${d._confidenceReasons.map(r => `• ${r}`).join('<br>')}</div>` : ''}
        </div>`;
      }
      if (confLevel === 'low') {
        return `<div class="cx-detail-banner cx-banner-low">
          ⚠️ Low confidence extraction — please verify the fields below before saving.
          ${d._confidenceReasons?.length ? `<div class="cx-reasons">${d._confidenceReasons.map(r => `• ${r}`).join('<br>')}</div>` : ''}
        </div>`;
      }
      if (confLevel === 'medium' || showWarning) {
        return `<div class="cx-detail-banner cx-banner-medium">
          ⚠️ Partial extraction — AI found the tenant but some fields are missing. Please fill them in below.
        </div>`;
      }
      return '';
    })();

    const detailInitialDisplay = d._autoExpand ? 'block' : 'none';
    const chevInitialHtml = d._autoExpand ? '&#x25B2; Close' : '&#x25BC; Edit';

    return `
      <div class="bulk-tenant-row${isPending ? ' is-pending' : d.extractionFailed ? ' has-error' : showWarning ? ' has-warning' : ''}" id="btr-${i}">
        <div class="bulk-tenant-summary" onclick="toggleBulkDetail(${i})">
          <span class="bulk-t-status" id="bstatus-${i}">${icon}</span>
          <div class="bulk-t-info" id="binfo-${i}">
            <div class="tenant-title" id="bname-${i}"${isWeakName ? ' style="opacity:0.6;font-style:italic;"' : ''}${!isPending && d.tenant_name ? ` data-tdp onclick="event.stopPropagation();openTenantDetailPanel(${i})"` : ''}>
              ${esc(displayName)}${dupBadge}${_confidenceBadgeHtml(confLevel)}
            </div>
            <div class="tenant-meta" id="bmeta-${i}">${esc(meta)}</div>
            ${!isPending ? `<div class="lrs-notes-row">${_reviewStatusPillHtml(getLeaseReviewStatus(d))}</div>` : ''}
            ${jobProgressHtml}
          </div>
          <span class="bulk-t-chevron" id="bchev-${i}">${chevInitialHtml}</span>
          ${showRetryButton
            ? `<button class="view-lease-btn" data-retry data-index="${i}" data-job-id="${d.id || ''}" style="margin-left:0;color:#f97316;">&#x21BA; Retry</button>`
            : isPending
              ? ''
              : d.leaseExpected
                ? (d.leaseFile instanceof File || d.leaseUrl)
                  ? `<button class="view-lease-btn" style="margin-left:0" onclick="event.stopPropagation();openLeaseModalFromFile(${i})">View Lease</button>`
                  : `<span class="lease-missing-note" data-retry data-index="${i}" data-job-id="${d.id || ''}" style="margin-left:6px;cursor:pointer;">No lease file — tap to re-upload</span>`
                : ''}
          ${_debugMode ? `<button class="cx-debug-toggle" onclick="event.stopPropagation();toggleLeaseDebug(${i})">🛠 Debug</button>` : ''}
          <button class="bulk-t-remove" onclick="event.stopPropagation();removeBulkTenant(${i})">Remove</button>
        </div>
        <div class="bulk-tenant-detail" id="bdet-${i}" style="display:${detailInitialDisplay};">
          ${confBannerHtml || (d._error
            ? `<div class="err-banner" style="margin-bottom:10px;">Extraction error: ${esc(d._error)}</div>`
            : '')}
          ${(() => { const w = getWarnings(computeFlags(d)); return w.length ? `<div class="rc-flags"><div class="rc-flags-title">&#x26A0;&#xFE0F; Needs Review</div>${w.map(m => `<div class="rc-flag-item">${m}</div>`).join('')}</div>` : ''; })()}
          <div class="field-row">
            <div class="field">
              <label>Tenant Name</label>
              <input type="text" value="${esc(d.tenant_name || '')}"
                onfocus="isEditingField=true"
                onblur="handleFieldBlur(${i},'tenant_name',this.value);refreshBulkSummary(${i})"/>
            </div>
            <div class="field">
              <label>Leased Sqft</label>
              <input type="number" value="${d.leased_sqft || ''}"
                onfocus="isEditingField=true"
                onblur="handleFieldBlur(${i},'leased_sqft',this.value);refreshBulkSummary(${i});checkSqftValidation()"/>
            </div>
          </div>
          <div class="field-row">
            <div class="field">
              <label>Lease Start Date</label>
              <input type="date" value="${d.start_date || ''}"
                onfocus="isEditingField=true"
                onblur="handleFieldBlur(${i},'start_date',this.value)"/>
            </div>
            <div class="field">
              <label>Lease End Date</label>
              <input type="date" value="${d.end_date || ''}"
                onfocus="isEditingField=true"
                onblur="handleFieldBlur(${i},'end_date',this.value)"/>
            </div>
          </div>
          <div class="field-row">
            <div class="field">
              <label>Lease Type</label>
              <select onchange="handleFieldBlur(${i},'lease_type',this.value||null)">
                <option value="">Select lease type</option>
                <option value="Triple Net (NNN)"${d.lease_type === 'Triple Net (NNN)' ? ' selected' : ''}>Triple Net (NNN)</option>
                <option value="Gross"${d.lease_type === 'Gross' ? ' selected' : ''}>Gross</option>
                <option value="Modified Gross"${d.lease_type === 'Modified Gross' ? ' selected' : ''}>Modified Gross</option>
              </select>
            </div>
            <div class="field">
              <label>Excluded Categories (comma-separated)</label>
              <input type="text" value="${esc(d.excluded_categories || '')}"
                onfocus="isEditingField=true"
                onblur="handleFieldBlur(${i},'excluded_categories',this.value)"/>
            </div>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;padding-top:10px;">
            ${d.extractionFailed && !d._userConfirmed
              ? `<span style="font-size:0.78rem;color:#94a3b8;">Fill in fields above, then click Save to confirm manually</span>`
              : `<span></span>`}
            <button class="bulk-done-btn" id="bdone-${i}" onclick="saveBulkTenant(${i})">
              ${d.extractionFailed && !d._userConfirmed ? 'Confirm &amp; Save' : 'Done ✓'}
            </button>
          </div>
        </div>
        ${_debugMode ? renderLeaseDebugPanel(d, i) : ''}
      </div>`;
  }).join('');

  el.innerHTML = `
    <div class="bulk-results-head">
      <h3>Extracted Tenants (${tenants.length})</h3>
      <button class="bulk-clear-btn" onclick="clearBulkResults()">&#x2715; Clear All</button>
    </div>
    ${rows}`;

  // Confirm onclick is in the generated DOM
  const firstSummary = el.querySelector('.bulk-tenant-summary');
  console.log('[renderBulkResults] rendered', tenants.length, 'tenants', {
    firstSummaryOnclick:     firstSummary?.getAttribute('onclick'),
    firstSummaryPE:          firstSummary ? window.getComputedStyle(firstSummary).pointerEvents : 'N/A',
    bulkResultsPE:           window.getComputedStyle(el).pointerEvents,
    mainWorkflowPE:          window.getComputedStyle(document.getElementById('mainWorkflow')).pointerEvents,
    appContentPE:            window.getComputedStyle(document.getElementById('appContent')).pointerEvents,
  });

  if (activePropId) {
    const _rqProp = _props.find(p => p.id === activePropId);
    if (_rqProp) renderPropertyReviewQueue(_rqProp);
  }
}

function toggleBulkDetail(i) {
  console.log('[toggleBulkDetail] ENTER', { i });
  const det  = document.getElementById(`bdet-${i}`);
  const chev = document.getElementById(`bchev-${i}`);
  if (!det) { console.warn('[toggleBulkDetail] GUARD: det element not found', { i, id: `bdet-${i}` }); return; }
  if (!chev) { console.warn('[toggleBulkDetail] GUARD: chev element not found', { i, id: `bchev-${i}` }); return; }
  const open = det.style.display === 'block';
  console.log('[toggleBulkDetail] toggling', { i, wasOpen: open });
  det.style.display  = open ? 'none' : 'block';
  chev.innerHTML     = open ? '&#x25BC; Edit' : '&#x25B2; Close';
}

async function saveBulkTenant(i) {
  // Commit any in-progress field edit before reading
  if (document.activeElement && document.activeElement !== document.body) {
    document.activeElement.blur();
  }

  const d   = tenantData[i];
  const row = document.getElementById(`btr-${i}`);

  // If tenant now has a name and sqft, clear the needs-review state
  if (d && d._needsReview && d.tenant_name && parseSqft(d.leased_sqft) > 0) {
    d._needsReview = false;
    if (row) {
      row.classList.remove('has-warning', 'has-error');
      const statusEl = document.getElementById(`bstatus-${i}`);
      if (statusEl) statusEl.textContent = '✓';
    }
  }

  // When a user explicitly saves a valid tenant name, promote the entry out of
  // extractionFailed so the resync guard lets it through to Supabase.
  // This is the only code path that sets _userConfirmed — it cannot happen
  // automatically; the user must click "Confirm & Save" with a name present.
  if (d && d.tenant_name && d.tenant_name.trim()) {
    d._userConfirmed = true;
    // Clear the job review gate — this tenant is now explicitly confirmed by the user
    if (d._pendingJobReview) {
      d._pendingJobReview = false;
      if (d._jobId) updateLeaseJob(d._jobId, { status: 'completed', stage: 'completed' });
    }
    if (d.extractionFailed) {
      d.extractionFailed = false;
      d.status           = 'partial'; // conservative — AI didn't fill it, mark partial
      if (row) {
        row.classList.remove('has-error');
        row.classList.add('has-warning');
        const statusEl = document.getElementById(`bstatus-${i}`);
        if (statusEl) statusEl.textContent = '⚠️';
        // Update confidence badge in the name line to reflect user confirmation
        const nameEl = document.getElementById(`bname-${i}`);
        if (nameEl) {
          const badge = nameEl.querySelector('.cx-badge');
          if (badge) { badge.className = 'cx-badge cx-medium'; badge.textContent = 'Manually confirmed'; }
        }
      }
    }
  }

  // Refresh the card header (name, meta line)
  refreshBulkSummary(i);

  // Persist to Supabase immediately — don't rely on debounced oninput
  await savePropertyData();
  const prop = currentProperty();
  if (prop?.id) await resyncTenantsToTable(prop.id, tenantData.filter(t => t?.tenant_name && (!t?.extractionFailed || t?._userConfirmed) && !t?._pendingJobReview));
  console.log('[saveBulkTenant] tenant', i, 'saved:', d?.tenant_name);

  // Success flash
  if (row) {
    row.classList.add('lease-save-flash');
    setTimeout(() => row.classList.remove('lease-save-flash'), 800);
  }

  // Button feedback: "Done ✓" → "Saved ✓" briefly
  const btn = document.getElementById(`bdone-${i}`);
  if (btn) {
    btn.textContent = 'Saved ✓';
    btn.disabled = true;
  }

  // Collapse after a short pause so user sees the flash
  setTimeout(() => {
    const det  = document.getElementById(`bdet-${i}`);
    const chev = document.getElementById(`bchev-${i}`);
    if (det)  { det.style.display = 'none'; }
    if (chev) { chev.innerHTML = '&#x25BC; Edit'; }
    // Reset Done button for if they reopen
    if (btn) { btn.textContent = 'Done ✓'; btn.disabled = false; }
  }, 550);

  showToast('Lease updated');
}

function refreshBulkSummary(i) {
  const d = tenantData[i];
  if (!d) return;
  const nameEl = document.getElementById(`bname-${i}`);
  const metaEl = document.getElementById(`bmeta-${i}`);

  if (nameEl) {
    const displayName = d.tenant_name?.trim() || '(unknown — click to edit)';
    const isWeakName  = d.tenant_name ? !isStrongName(d.tenant_name) : false;

    // Recompute duplicate badge from current tenantData
    const _nc = new Map();
    tenantData.forEach(t => {
      if (!t?.tenant_name) return;
      const k = t.tenant_name.trim().toLowerCase();
      _nc.set(k, (_nc.get(k) || 0) + 1);
    });
    const isDup = d.tenant_name ? (_nc.get(d.tenant_name.trim().toLowerCase()) || 0) > 1 : false;
    const dupBadge = isDup
      ? `<span style="font-size:0.72rem;background:#78350f40;border:1px solid #f59e0b;color:#fbbf24;border-radius:4px;padding:1px 6px;margin-left:6px;white-space:nowrap;">⚠ Duplicate name — add unit # or remove one</span>`
      : '';

    nameEl.style.opacity     = isWeakName ? '0.6' : '';
    nameEl.style.fontStyle   = isWeakName ? 'italic' : '';
    nameEl.innerHTML = esc(displayName) + dupBadge;
  }

  if (metaEl) {
    metaEl.textContent = [
      d.leased_sqft ? `${d.leased_sqft} sqft` : null,
      d.start_date  || null,
      d.end_date    || null,
      d.lease_type  || null,
    ].filter(Boolean).join(' · ') || '—';
  }
}

async function removeBulkTenant(i) {
  const prop = currentProperty();
  if (tenantData[i]?.id) deleteLeaseFile(tenantData[i].id);
  tenantData.splice(i, 1);
  if (prop?.tenants) prop.tenants = [...tenantData];
  renderBulkResults();
  checkSqftValidation();
  // Full re-sync: delete all rows for this property then re-insert what remains
  if (prop?.id) await resyncTenantsToTable(prop.id, tenantData.filter(t => t?.tenant_name && (!t?.extractionFailed || t?._userConfirmed) && !t?._pendingJobReview));
  await savePropertyData();
}

// Opens the bulk file input scoped to a single slot so the user can
// re-select a file for an extraction that failed or had no cached file.
function retryUploadForSlot(index) {
  const input = document.getElementById('bulkLeaseInput');
  if (!input) return;
  input.value = '';
  input.onchange = async (e) => {
    const file = e.target.files[0];
    input.onchange = null; // detach after one use
    if (!file) {
      alert("No file selected.");
      return;
    }
    if (file.size === 0) {
      alert("File failed to load. Try re-uploading.");
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      alert("This lease is too large. Please upload a smaller or compressed PDF.");
      return;
    }
    await retryExtractionWithFile(index, file);
  };
  input.click();
}

async function retryExtraction(index) {
  const t = tenantData[index];
  if (!t) return;
  const file = (t.leaseFile instanceof File) ? t.leaseFile : await getLeaseFile(t.id);
  if (!file) {
    retryUploadForSlot(index);
    return;
  }
  await retryExtractionWithFile(index, file);
}

async function retryExtractionWithFile(index, file) {
  const t    = tenantData[index];
  const prop = currentProperty();

  if (file.size > 25 * 1024 * 1024) {
    alert("This lease is too large. Please upload a smaller or compressed PDF.");
    return;
  }

  const row = document.getElementById(`btr-${index}`);
  if (row) {
    row.style.opacity = '0.5';
    const statusEl = row.querySelector('.bulk-t-meta');
    if (statusEl) statusEl.textContent = 'Processing lease… this may take up to 30 seconds';
  }

  try {
    let leaseText = null;
    let extracted = null;
    try {
      leaseText = await extractLeaseText(file);
      if (!leaseText) {
        extracted = { tenant_name: null, status: 'failed' };
      } else {
        extracted = await callClaudeForLease(leaseText);
      }
    } catch (err) {
      console.error('[retryExtraction] extraction error:', err);
    }

    if (extracted && leaseText) extracted.rawText = leaseText;
    const norm = extracted ? normalizeTenant(extracted) : null;

    // Confidence scoring (mirrors handleBulkLeases exactly)
    const hasStrongName = norm ? isStrongName(norm.tenant_name) : false;
    let confidenceScore = 0;
    if (norm) {
      const hasTenant = !!norm.tenant_name && norm.tenant_name.trim().length > 0;
      if (hasStrongName)      confidenceScore += 2;
      else if (hasTenant)     confidenceScore += 1; // weak name still counts
      if (norm.start_date)    confidenceScore += 1;
      if (norm.end_date)      confidenceScore += 1;
      if (norm.leased_sqft)   confidenceScore += 1;
      if (norm._usedFallback) confidenceScore -= 1;
    }
    const hasTenant    = !!norm?.tenant_name?.trim();
    const hasDates     = !!(norm?.start_date || norm?.end_date);
    const hasLeaseType = !!norm?.lease_type;

    let status = 'success';
    if (!hasTenant) {
      status = 'failed';
    } else if (!hasDates || !hasLeaseType) {
      status = 'partial';
    }

    const isValid    = status !== 'failed';
    const isPartial  = status === 'partial';
    const _showRetry = !hasTenant || !hasDates || !hasLeaseType;

    const updated = {
      ...(isValid ? norm : {}),
      leaseFile:        file,
      leaseExpected:    true,
      fileName:         file.name,
      leaseUrl:         t?.leaseUrl ?? null,
      extractionFailed: !isValid,
      _needsReview:     isPartial,
      _showRetry,
      _error:           isValid ? null : 'Could not identify a tenant — please enter fields manually',
      id:               t?.id ?? crypto.randomUUID(),
    };
    tenantData[index] = updated;
    if (prop?.tenants) prop.tenants[index] = updated;
  } catch (err) {
    console.error('[retryExtraction] unexpected error:', err);
    const failed = { ...(t ?? {}), _error: err.message || 'Retry failed' };
    tenantData[index] = failed;
    if (prop?.tenants) prop.tenants[index] = failed;
  } finally {
    if (row) row.style.opacity = '';
  }

  renderBulkResults();
  checkSqftValidation();
}

async function clearBulkResults() {
  const prop = currentProperty();
  tenantData.splice(0, tenantData.length);
  if (prop?.tenants) prop.tenants.splice(0, prop.tenants.length);
  document.getElementById('bulkResults').innerHTML = '';
  document.getElementById('bulkProgress').style.display = 'none';
  document.getElementById('bulkLeaseInput').value = '';
  // Delete all tenant rows for this property from Supabase
  if (prop?.id) {
    const { error } = await db.from('tenants').delete().eq('property_id', prop.id);
    if (error) console.error('[clearBulkResults] delete error:', error.message);
  }
  await savePropertyData();
}

// ─── Batch Invoice Upload ─────────────────────────────────────────────────────

function normalizeCategory(vendor, description) {
  const v = (vendor || '').toLowerCase();

  if (v.includes('insurance') || v.includes(' ins ') || v.includes(' ins.') || v.startsWith('ins ') || v.includes('coverage') || v.includes('policy')) return { category: 'insurance', confidence: 0.95 };
  if (v.includes('landscap'))                         return { category: 'landscaping', confidence: 0.95 };
  if (v.includes('snow'))                             return { category: 'snow',        confidence: 0.95 };
  if (v.includes('electric') || v.includes('utility')) return { category: 'utilities',  confidence: 0.90 };

  return null;
}

async function classifyCategory(vendorName, amount) {
  try {
    const data = await claudeFetch({
      model: MODEL,
      max_tokens: 64,
      messages: [{ role: 'user', content:
        CATEGORY_PROMPT + `\n\nVendor: ${vendorName || 'Unknown'}\nAmount: $${amount || '0'}`
      }],
    });
    if (data?.category && CATEGORIES.includes(data.category)) return data;
  } catch { /* non-fatal */ }
  return null;
}

async function handleBatchInvoices(fileList) {
  if (!fileList || fileList.length === 0) return;
  const files = Array.from(fileList).filter(f =>
    f.type.startsWith('image/') || f.type === 'application/pdf' ||
    /\.(pdf|jpe?g|png|webp)$/i.test(f.name)
  );
  if (!files.length) return;

  // Bind property and snapshot existing invoices BEFORE clearing in-memory state.
  const property = currentProperty();
  if (!property) throw new Error('No property selected');
  const existing = { invoices: Array.from(property.invoices || []) };

  const total = files.length;

  invoiceData.splice(0, invoiceData.length);

  const prog = document.getElementById('invProgress');
  const res  = document.getElementById('invResults');
  res.innerHTML = '';
  prog.style.display = 'block';

  document.getElementById('invFileInput').value   = '';
  document.getElementById('invFolderInput').value = '';

  for (let i = 0; i < total; i++) {
    const pct = Math.round((i / total) * 100);
    prog.innerHTML = `
      <div class="bulk-progress-wrap">
        <div class="bulk-progress-label">Processing invoice ${i + 1} of ${total} — "${esc(files[i].name)}"</div>
        <div class="bulk-progress-track">
          <div class="bulk-progress-fill" style="width:${pct}%"></div>
        </div>
      </div>`;

    // Step 1 — Claude extraction (failure is non-fatal; recorded in _error)
    let d = null;
    let claudeError = null;
    try {
      d = await callClaude(files[i], INVOICE_PROMPT);
    } catch (err) {
      console.error('[Mainstreet] Claude extraction failed:', err.message, err);
      claudeError = err.message;
    }

    // Step 2 — Storage upload (always runs, independent of Claude)
    const { url: fileUrl, error: fileUploadError } = await uploadInvoiceFile(files[i]);

    // Step 3 — Category resolution: Claude → normalizeCategory → classifyCategory
    const vendorName = d?.vendorName ?? files[i].name.replace(/\.(pdf|jpe?g|png|webp)$/i, '');
    let resolvedCategory = d?.category ?? 'other';
    let resolvedConf     = d?.confidence ?? {};
    const claudeCatConf  = resolvedConf.category ?? 0;

    if (resolvedCategory === 'other' || claudeCatConf < 80) {
      const norm = normalizeCategory(vendorName, '');
      if (norm) {
        resolvedCategory = norm.category;
        resolvedConf = { ...resolvedConf, category: Math.round(norm.confidence * 100) };
      } else {
        const ai = await classifyCategory(vendorName, d?.amount);
        if (ai) {
          resolvedCategory = ai.category;
          resolvedConf = { ...resolvedConf, category: Math.round(ai.confidence * 100) };
        }
      }
    }

    if (resolvedCategory === 'other' && vendorName.toLowerCase().includes('insurance')) {
      resolvedCategory = 'insurance';
      resolvedConf = { ...resolvedConf, category: 90 };
    }

    invoiceData.push({
      vendorName:  cleanHTML(vendorName),
      amount:      d?.amount      ?? '',
      category:    resolvedCategory,
      invoiceDate: cleanHTML(d?.invoiceDate ?? ''),
      confidence:  resolvedConf,
      _error:           claudeError,
      _fileUploadError: fileUploadError,
      fileUrl, fileName: files[i].name, fileType: files[i].type,
    });

    renderInvResults();
    const idx = invoiceData.length - 1;
    checkDuplicateInvoice(idx);
    checkAmountSanity(idx);
  }

  prog.innerHTML = `
    <div class="bulk-progress-wrap">
      <div class="bulk-progress-label">&#x2713; ${total} invoice${total !== 1 ? 's' : ''} processed — review and edit below</div>
      <div class="bulk-progress-track">
        <div class="bulk-progress-fill" style="width:100%"></div>
      </div>
    </div>`;

  // Merge: append new invoices that don't already exist by vendor+amount+date.
  const newInvoices = Array.from(invoiceData);
  const merged = mergeInvoicesDedup(existing.invoices, newInvoices);
  property.invoices = merged;
  // Keep invoiceData in sync with merged result so UI shows the full set.
  invoiceData.splice(0, invoiceData.length, ...merged);
  renderInvResults();

  captureCheckpoint(activePropId, 'Before invoice upload');
  await saveProperty(property);
  logActivity('invoice_uploaded', `${total} invoice${total !== 1 ? 's' : ''} uploaded`, {
    severity:        'info',
    actor:           'User',
    relatedEntity:   property.name || '',
    financialImpact: fmt(invoiceData.reduce((s, i) => s + (parseFloat(i.amount) || 0), 0)),
  });
}

function renderInvResults() {
  const el = document.getElementById('invResults');
  if (!invoiceData.length) { el.innerHTML = ''; return; }

  const rows = invoiceData.map((d, i) => {
    const conf = d.confidence || {};
    const icon = d._error ? '⚠️' : d.vendorName ? '✓' : '?';
    const name = cleanHTML(d.vendorName || '(unknown — click to edit)');
    const amtStr = d.amount !== '' ? fmt(parseFloat(d.amount) || 0) : '—';
    const catStr = cleanHTML(d.category || 'other');
    const scores = [conf.vendorName, conf.amount, conf.category].filter(s => s !== undefined && s !== null);
    const overallConf = scores.length ? Math.min(...scores) : undefined;

    const weakFields = ['vendorName','amount','category','invoiceDate']
      .filter(f => (conf[f] === undefined || conf[f] === null || parseInt(conf[f]) < 90) && !d.verified?.[f]);
    const matchBadge  = d.matchedTenant
      ? `<span class="match-badge" title="${esc(d.matchReason || '')}">&#x2192; ${esc(d.matchedTenant)}</span>`
      : '';

    const opts = CATEGORIES.map(c =>
      `<option value="${c}"${d.category === c ? ' selected' : ''}>${c}</option>`
    ).join('');

    // Inline duplicate detection — check against all other items
    let dupBadge = '';
    if (d.vendorName && d.amount !== '') {
      const amt = parseFloat(d.amount);
      for (let j = 0; j < invoiceData.length; j++) {
        if (j === i) continue;
        const oth = invoiceData[j];
        if (!oth || !oth.vendorName || oth.amount === '') continue;
        if (Math.abs(amt - parseFloat(oth.amount)) <= 1 && similarVendor(d.vendorName, oth.vendorName)) {
          dupBadge = `<span class="dup-row-badge" onclick="event.stopPropagation()">
            ⚠ Possible duplicate of ${esc(oth.vendorName)}
            <button class="dup-row-remove" onclick="event.stopPropagation();removeInvItem(${i})">Remove</button>
          </span>`;
          break;
        }
      }
    }

    // ── Verify blocks: computed explicitly for each field ──────────────────
    function _vblock(score, fieldName) {
      if (d.verified?.[fieldName]) {
        return `<span class="conf-badge conf-verified">&#x2713; Verified</span>`;
      }
      const s = (score == null) ? -1 : parseInt(score, 10);
      if (isNaN(s) || s < 90) {
        return `<div class="field-verify-actions">
          <button class="verify-btn verify-btn-confirm" onclick="markFieldVerified(${i},'${fieldName}')">&#x2714; Mark Verified</button>
          <button class="verify-btn verify-btn-change" onclick="focusInvField(${i},'${fieldName}')">&#x270E; Change</button>
        </div>`;
      }
      return '';
    }
    const vVendor   = _vblock(conf.vendorName,  'vendorName');
    const vAmount   = _vblock(conf.amount,       'amount');
    const vCategory = _vblock(conf.category,     'category');
    const vDate     = _vblock(conf.invoiceDate,  'invoiceDate');

    return `
      <div class="bulk-tenant-row${d._error ? ' has-error' : ''}" id="itr-${i}">
        <div class="bulk-tenant-summary" onclick="toggleInvDetail(${i})">
          <span class="bulk-t-status">${icon}</span>
          <span class="bulk-t-name" id="iname-${i}">${esc(name)}</span>
          <span class="bulk-t-meta" id="imeta-${i}">${esc(catStr)} &middot; ${amtStr}</span>
          <span id="isummaryBadge-${i}">${overallConf !== undefined ? clickableConfBadge(overallConf, i, weakFields) : ''}</span>
          ${matchBadge}
          ${dupBadge}
          ${d._disputed ? `<span class="badge-disputed">Disputed</span>` : ''}
          <span class="bulk-t-chevron" id="ichev-${i}">&#x25BC; Edit</span>
          <div class="inv-action-btns">
            <button class="inv-act-btn" onclick="event.stopPropagation();viewInvoice(${i})">View</button>
            <button class="inv-act-btn inv-act-explain" id="iexplbtn-${i}" onclick="event.stopPropagation();explainCharge(${i})">Explain</button>
            <button class="inv-act-btn inv-act-dispute" onclick="event.stopPropagation();disputeCharge(${i})">Dispute</button>
          </div>
          <button class="bulk-t-remove" onclick="event.stopPropagation();removeInvItem(${i})">Remove</button>
        </div>
        ${d._fileUploadError ? `<div class="inv-upload-err-banner">&#x26A0; File backup unavailable — invoice data is saved and CAM will run normally</div>` : ''}
        <div class="bulk-tenant-detail" id="idet-${i}" style="display:none;">
          ${d._error ? `<div class="err-banner" style="margin-bottom:10px;">Extraction error: ${esc(d._error)}</div>` : ''}
          <div id="dup-warn-${i}"></div>
          <div id="sanity-warn-${i}"></div>
          <div class="field-row">
            <div class="field" style="flex:2;">
              <label>Vendor ${confidenceBadge(conf.vendorName)}</label>
              <input id="ifield-${i}-vendorName" type="text" value="${esc(cleanHTML(d.vendorName))}"
                oninput="invoiceData[${i}].vendorName=this.value;markFieldVerified(${i},'vendorName');refreshInvSummary(${i});savePropertyData()"/>
              <span id="ibadgeWrap-${i}-vendorName">${vVendor}</span>
            </div>
            <div class="field">
              <label>Amount ($) ${confidenceBadge(conf.amount)}</label>
              <input id="ifield-${i}-amount" type="number" value="${esc(d.amount)}"
                oninput="invoiceData[${i}].amount=parseFloat(this.value)||'';markFieldVerified(${i},'amount');refreshInvSummary(${i});savePropertyData()"/>
              <span id="ibadgeWrap-${i}-amount">${vAmount}</span>
            </div>
          </div>
          <div class="field-row">
            <div class="field">
              <label>Category ${confidenceBadge(conf.category)}</label>
              <select id="ifield-${i}-category" onchange="invoiceData[${i}].category=this.value;markFieldVerified(${i},'category');refreshInvSummary(${i});savePropertyData()">${opts}</select>
              <span id="ibadgeWrap-${i}-category">${vCategory}</span>
            </div>
            <div class="field">
              <label>Invoice Date ${confidenceBadge(conf.invoiceDate)}</label>
              <input id="ifield-${i}-invoiceDate" type="text" value="${esc(cleanHTML(d.invoiceDate))}"
                oninput="invoiceData[${i}].invoiceDate=this.value;markFieldVerified(${i},'invoiceDate');recomputeSummaryBadge(${i});savePropertyData()"/>
              <span id="ibadgeWrap-${i}-invoiceDate">${vDate}</span>
            </div>
          </div>
        </div>
      </div>`;
  }).join('');

  el.innerHTML = `
    <div class="bulk-results-head">
      <h3>Extracted Invoices (${invoiceData.length})</h3>
      <button class="bulk-clear-btn" onclick="clearInvResults()">&#x2715; Clear All</button>
    </div>
    ${rows}`;
}

// Returns a clickable confidence badge that opens + highlights weak fields on click.
// Falls back to the plain badge when all fields are high-confidence.
function clickableConfBadge(score, i, weakFields) {
  if (score === null || score === undefined) return '';
  const s = parseInt(score, 10);
  if (isNaN(s) || s >= 90 || !weakFields.length) return confidenceBadge(score);
  const label = s >= 70 ? '&#x26A0; Please verify' : '&#x2691; Low confidence — click to review';
  const cls   = s >= 70 ? 'conf-mid' : 'conf-low';
  return `<span class="conf-badge ${cls} conf-clickable"
    onclick="event.stopPropagation();openInvoiceAndHighlight(${i},${JSON.stringify(weakFields)})"
    title="Click to jump to fields that need review">${label}</span>`;
}

const _FIELD_HINTS = {
  vendorName:  'We are not confident about this vendor name. Please verify.',
  amount:      'We are not confident about this amount. Please verify.',
  category:    'We are not confident this category is correct. Please review.',
  invoiceDate: 'We are not confident about this date. Please verify.',
};

function openInvoiceAndHighlight(i, fields) {
  // Open the detail row
  const det  = document.getElementById(`idet-${i}`);
  const chev = document.getElementById(`ichev-${i}`);
  if (!det) return;
  det.style.display = 'block';
  if (chev) chev.innerHTML = '&#x25B2; Close';

  // Scroll into view
  det.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  // Highlight each weak field and show a hint message
  fields.forEach(field => {
    const el = document.getElementById(`ifield-${i}-${field}`);
    if (!el) return;

    el.classList.add('field-highlight');
    setTimeout(() => el.classList.remove('field-highlight'), 3500);

    const hintId = `ifhint-${i}-${field}`;
    if (!document.getElementById(hintId)) {
      const hint = document.createElement('div');
      hint.id        = hintId;
      hint.className = 'field-hint';
      hint.textContent = _FIELD_HINTS[field] || 'Please review this field.';
      el.parentElement.appendChild(hint);
      setTimeout(() => hint.remove(), 5000);
    }
  });
}

function verifiableActions(score, i, field) {
  const verified = invoiceData[i]?.verified?.[field];
  if (verified) return `<span class="conf-badge conf-verified">&#x2713; Verified</span>`;

  const s = (score === null || score === undefined) ? -1 : parseInt(score, 10);
  const needsVerify = isNaN(s) || s < 90;
  if (needsVerify) {
    return `<div class="field-verify-actions">
      <button class="verify-btn verify-btn-confirm" onclick="markFieldVerified(${i},'${field}')">&#x2713; Mark as Verified</button>
      <button class="verify-btn verify-btn-change" onclick="focusInvField(${i},'${field}')">&#x270E; Change</button>
    </div>`;
  }
  return '';
}

function markFieldVerified(i, field) {
  if (!invoiceData[i]) return;
  if (!invoiceData[i].verified) invoiceData[i].verified = {};
  invoiceData[i].verified[field] = true;
  const wrap = document.getElementById(`ibadgeWrap-${i}-${field}`);
  if (wrap) wrap.innerHTML = '<span class="conf-badge conf-verified">&#x2713; Verified</span>';
  recomputeSummaryBadge(i);
}

function focusInvField(i, field) {
  const el = document.getElementById(`ifield-${i}-${field}`);
  if (!el) return;
  el.focus();
  if (el.tagName === 'SELECT') el.click();
}

function recomputeSummaryBadge(i) {
  const d = invoiceData[i]; if (!d) return;
  const conf = d.confidence || {};
  const scores = [conf.vendorName, conf.amount, conf.category].filter(s => s !== undefined && s !== null);
  const overallConf = scores.length ? Math.min(...scores) : undefined;
  const weakFields = ['vendorName','amount','category','invoiceDate']
    .filter(f => (conf[f] === undefined || conf[f] === null || parseInt(conf[f]) < 90) && !d.verified?.[f]);
  const el = document.getElementById(`isummaryBadge-${i}`);
  if (el) el.innerHTML = overallConf !== undefined ? clickableConfBadge(overallConf, i, weakFields) : '';
}

function toggleInvDetail(i) {
  const det  = document.getElementById(`idet-${i}`);
  const chev = document.getElementById(`ichev-${i}`);
  if (!det) return;
  const open = det.style.display === 'block';
  det.style.display = open ? 'none' : 'block';
  chev.innerHTML    = open ? '&#x25BC; Edit' : '&#x25B2; Close';
}

function viewInvoice(i) {
  const det  = document.getElementById(`idet-${i}`);
  const chev = document.getElementById(`ichev-${i}`);
  if (!det) return;
  det.style.display = 'block';
  chev.innerHTML    = '&#x25B2; Close';
  det.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function viewInvFile(i) {
  const inv = invoiceData[i];
  console.log('[viewInvFile] ENTER', {
    i,
    invFound:  !!inv,
    fileUrl:   inv?.fileUrl ? 'PRESENT' : 'MISSING',
    fileType:  inv?.fileType,
    vendorName: inv?.vendorName,
    invoiceDataLen: invoiceData.length,
  });
  if (!inv || !inv.fileUrl) {
    console.warn('[viewInvFile] GUARD: no inv or no fileUrl', { i, inv });
    return;
  }
  openInvFileViewer(inv.fileUrl, inv.vendorName || inv.fileName || 'Invoice', inv.fileType);
}

function closeInvFileViewer() {
  const viewer = document.getElementById('invFileViewer');
  viewer.style.display = 'none';
  document.getElementById('invFileViewerBody').innerHTML = '';
}

function openInvFileViewer(url, title, fileType) {
  if (!url) return;
  document.getElementById('invFileViewerTitle').textContent = title || 'Invoice';
  const body = document.getElementById('invFileViewerBody');
  if (fileType && fileType.startsWith('image/')) {
    body.innerHTML = `<img src="${url}" style="max-width:100%;max-height:calc(100vh - 80px);border-radius:8px;object-fit:contain;" />`;
  } else {
    body.innerHTML = `<iframe src="${url}" style="width:100%;height:calc(100vh - 80px);border:none;border-radius:8px;"></iframe>`;
  }
  document.getElementById('invFileViewer').style.display = 'flex';
}

async function handleExplain(button, fn) {
  const original = button ? button.innerText : '';
  if (button) { button.innerText = 'Thinking…'; button.disabled = true; }
  try {
    await fn();
  } finally {
    if (button) { button.innerText = original; button.disabled = false; }
  }
}

async function explainCharge(i) {
  const inv = invoiceData[i];
  if (!inv) return;
  const btn = document.getElementById(`iexplbtn-${i}`);
  try {
    await handleExplain(btn, async () => {
    const data = await explainFetch({
      model: MODEL,
      max_tokens: 1024,
      system: LANDLORD_SYSTEM_PROMPT,
      messages: [{ role: 'user', content:
        `Vendor: ${inv.vendorName || 'Unknown'}\n` +
        `Category: ${inv.category || 'other'}\n` +
        `Amount: $${inv.amount || '0'}\n` +
        `Date: ${inv.invoiceDate || 'Unknown'}\n` +
        `Confidence: ${inv.confidence?.category ?? 'unknown'}%`
      }],
    });
    const text = data?.content?.[0]?.text || 'No explanation available.';
    const det = document.getElementById(`idet-${i}`);
    let expl = document.getElementById(`iexpl-${i}`);
    if (!expl) {
      expl = document.createElement('div');
      expl.id = `iexpl-${i}`;
      expl.className = 'inv-explain-box';
      det.appendChild(expl);
    }
    const mdHtml = renderMarkdown(text);
    expl.innerHTML = `<strong>AI Review</strong><div class="expl-preview">${mdHtml}</div><button class="expl-readmore" onclick="var p=this.previousElementSibling;p.classList.toggle('expanded');this.textContent=p.classList.contains('expanded')?'Show less \u25b2':'Read full explanation \u25be'">Read full explanation &#x25BE;</button>`;
    det.style.display = 'block';
    document.getElementById(`ichev-${i}`).innerHTML = '&#x25B2; Close';
    expl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  } catch (e) {
    alert(`Explain error: ${e.message}`);
  }
}

function disputeCharge(i) {
  const det = document.getElementById(`idet-${i}`);
  if (!det) return;
  det.style.display = 'block';
  document.getElementById(`ichev-${i}`).innerHTML = '&#x25B2; Close';
  const existing = document.getElementById(`idisp-${i}`);
  if (existing) { existing.remove(); return; }
  const form = document.createElement('div');
  form.id = `idisp-${i}`;
  form.className = 'dispute-form';
  form.innerHTML = `
    <label>Dispute Reason</label>
    <textarea id="idispr-${i}" placeholder="Why are you disputing this charge?"></textarea>
    <div class="dispute-form-btns">
      <button class="d-submit-btn" onclick="submitInvDispute(${i})">Flag as Disputed</button>
      <button class="d-cancel-btn" onclick="document.getElementById('idisp-${i}').remove()">Cancel</button>
    </div>`;
  det.appendChild(form);
  form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function submitInvDispute(i) {
  const inv = invoiceData[i];
  if (!inv) return;
  const ta = document.getElementById(`idispr-${i}`);
  const reason = ta?.value?.trim();
  if (!reason) { if (ta) ta.style.borderColor = '#ea580c'; return; }
  inv._disputed = true;
  inv._disputeReason = reason;
  await savePropertyData();
  renderInvResults();
  showToast('✓ Dispute submitted — your landlord will review it.');
}

function refreshInvSummary(i) {
  const d = invoiceData[i];
  if (!d) return;
  const nameEl = document.getElementById(`iname-${i}`);
  const metaEl = document.getElementById(`imeta-${i}`);
  if (nameEl) nameEl.textContent = d.vendorName || '(unknown — click to edit)';
  if (metaEl) {
    const amtStr = d.amount !== '' ? fmt(parseFloat(d.amount) || 0) : '—';
    metaEl.textContent = (d.category || 'other') + ' · ' + amtStr;
  }
}

async function removeInvItem(i) {
  invoiceData.splice(i, 1);
  renderInvResults();
  await savePropertyData();
}

async function clearInvResults() {
  invoiceData.splice(0, invoiceData.length);
  document.getElementById('invResults').innerHTML = '';
  document.getElementById('invProgress').style.display = 'none';
  document.getElementById('invFileInput').value   = '';
  document.getElementById('invFolderInput').value = '';
  await savePropertyData();
}

// ─── Invoice Tab Switching ────────────────────────────────────────────────────

function switchInvTab(tab) {
  document.getElementById('iTabFiles').classList.toggle('active', tab === 'files');
  document.getElementById('iTabYardi').classList.toggle('active', tab === 'yardi');
  document.getElementById('invPanelFiles').style.display = tab === 'files' ? 'block' : 'none';
  document.getElementById('invPanelYardi').style.display = tab === 'yardi' ? 'block' : 'none';
}

// ─── Yardi Genesis CSV Import ─────────────────────────────────────────────────

// Known column aliases for Yardi export headers
const YARDI_COL_ALIASES = {
  vendorName:  ['vendor', 'payee', 'vendor name', 'payee name', 'supplier', 'vendor/payee', 'paid to'],
  amount:      ['amount', 'total', 'net amount', 'net', 'charge', 'expense', 'cost', 'debit', 'invoice amount', 'check amount'],
  invoiceDate: ['date', 'post date', 'posting date', 'invoice date', 'trans date', 'transaction date', 'gl date', 'check date'],
  description: ['description', 'memo', 'notes', 'comment', 'detail', 'narrative', 'reference', 'invoice description'],
  category:    ['category', 'account', 'gl code', 'gl account', 'account code', 'expense type', 'type', 'account description', 'account name'],
  property:    ['property', 'building', 'property name', 'building name', 'site', 'property code', 'location'],
};

let yardiRows        = [];
let yardiColMap      = {}; // fieldName -> colIndex
let yardiUnrecognized = []; // [{index, name}]

function yardiParseCSV(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  return lines
    .filter(l => l.trim())
    .map(line => {
      const cells = [];
      let inQ = false, cur = '', i = 0;
      while (i < line.length) {
        const c = line[i];
        if (c === '"') {
          if (inQ && line[i + 1] === '"') { cur += '"'; i += 2; continue; }
          inQ = !inQ;
        } else if (c === ',' && !inQ) {
          cells.push(cur.trim());
          cur = ''; i++; continue;
        } else { cur += c; }
        i++;
      }
      cells.push(cur.trim());
      return cells;
    });
}

function yardiFuzzyMatch(header, aliases) {
  const h = header.toLowerCase().replace(/[^a-z0-9 /]/g, '').trim();
  return aliases.some(alias => {
    const a = alias.toLowerCase();
    return h === a || h.includes(a) || a.includes(h);
  });
}

function yardiDetectColumns(headers) {
  const colMap = {};
  const unrecognized = [];
  headers.forEach((h, i) => {
    let matched = false;
    for (const [field, aliases] of Object.entries(YARDI_COL_ALIASES)) {
      if (!(field in colMap) && yardiFuzzyMatch(h, aliases)) {
        colMap[field] = i;
        matched = true;
        break;
      }
    }
    if (!matched && h.trim()) unrecognized.push({ index: i, name: h });
  });
  return { colMap, unrecognized };
}

function yardiCategoryFromText(description, gl) {
  const t = (description + ' ' + gl).toLowerCase();
  if (/landscap|lawn|mow|trim|plant|shrub|mulch|irrigation/.test(t))    return 'landscaping';
  if (/snow|ice|salt|plow|deice/.test(t))                                return 'snow';
  if (/repair|fix|maintain|hvac|heat|cool|roof|paint|plumb|electric/.test(t) &&
      !/utility|utilities/.test(t))                                       return 'repairs';
  if (/electric|gas|water|sewer|utility|utilities|power/.test(t))        return 'utilities';
  if (/janitor|clean|sweep|trash|waste/.test(t))                         return 'janitorial';
  if (/secur|guard|patrol|access|camera/.test(t))                        return 'security';
  if (/manag|admin|management fee|service fee/.test(t))                  return 'management';
  return 'other';
}

function handleYardiCSV(file) {
  if (!file) return;
  const preview = document.getElementById('yardiPreview');
  preview.innerHTML = '<div class="spinner-wrap"><div class="spinner sm"></div><div class="spinner-label">Parsing CSV…</div></div>';

  const reader = new FileReader();
  reader.onload = e => {
    const allRows = yardiParseCSV(e.target.result);
    if (allRows.length < 2) { showYardiError(); return; }

    const headers = allRows[0];
    const { colMap, unrecognized } = yardiDetectColumns(headers);

    if (!('vendorName' in colMap) && !('amount' in colMap)) {
      showYardiError(); return;
    }

    yardiRows         = allRows.slice(1).filter(r => r.some(c => c.trim()));
    yardiColMap       = colMap;
    yardiUnrecognized = unrecognized;

    document.getElementById('yardiFileInput').value = '';
    renderYardiPreview(headers);
  };
  reader.onerror = showYardiError;
  reader.readAsText(file);
}

function showYardiError() {
  document.getElementById('yardiPreview').innerHTML = `
    <div class="yardi-err">
      <span class="yardi-err-icon">⚠️</span>
      <div class="yardi-err-msg">
        <strong>We couldn't read this file automatically.</strong><br>
        Please make sure you're exporting the CAM expense report from Yardi Genesis.<br><br>
        <a href="#" onclick="event.preventDefault();downloadYardiTemplate()">
          ⬇ Need help? Download our import template
        </a>
      </div>
    </div>`;
}

function yardiCell(row, field) {
  const idx = yardiColMap[field];
  return idx !== undefined ? (row[idx] || '').trim() : '';
}

function renderYardiPreview(headers) {
  const el = document.getElementById('yardiPreview');

  let initCount = 0, initTotal = 0;
  const tableRows = yardiRows.map((row, i) => {
    const vendor  = cleanHTML(yardiCell(row, 'vendorName'));
    const amtRaw  = yardiCell(row, 'amount').replace(/[$,\s]/g, '');
    const amt     = parseFloat(amtRaw) || 0;
    const date    = cleanHTML(yardiCell(row, 'invoiceDate'));
    const desc    = cleanHTML(yardiCell(row, 'description'));
    const gl      = cleanHTML(yardiCell(row, 'category'));
    const sugCat  = yardiCategoryFromText(desc, gl);
    const checked = amt > 0 || !!vendor;

    if (checked) { initCount++; initTotal += amt; }

    const opts = CATEGORIES.map(c =>
      `<option value="${c}"${sugCat === c ? ' selected' : ''}>${c}</option>`
    ).join('');

    const extraCells = yardiUnrecognized.map(u =>
      `<td class="yardi-td yardi-unknown">${esc((row[u.index] || '').trim())}</td>`
    ).join('');

    return `<tr>
      <td class="yardi-td yardi-cb">
        <input type="checkbox" id="ychk-${i}"${checked ? ' checked' : ''} onchange="updateYardiTotals()"/>
      </td>
      <td class="yardi-td">${esc(vendor || '—')}</td>
      <td class="yardi-td yardi-amt">${amt > 0 ? fmt(amt) : '—'}</td>
      <td class="yardi-td">${esc(date || '—')}</td>
      <td class="yardi-td">
        <select class="yardi-cat-sel" id="ycat-${i}">${opts}</select>
      </td>
      <td class="yardi-td yardi-desc" title="${esc(desc || gl || '')}">${esc(desc || gl || '—')}</td>
      ${extraCells}
    </tr>`;
  }).join('');

  const extraHeaders = yardiUnrecognized.map(u =>
    `<th class="yardi-th yardi-unknown">${esc(u.name)}</th>`
  ).join('');

  el.innerHTML = `
    <div class="yardi-preview-wrap">
      <div class="yardi-preview-info">
        Found <strong>${yardiRows.length}</strong> expense row${yardiRows.length !== 1 ? 's' : ''}.
        ${yardiUnrecognized.length
          ? `<span class="yardi-unknown-note">⚠ ${yardiUnrecognized.length} unrecognized column${yardiUnrecognized.length !== 1 ? 's' : ''} highlighted in yellow</span>`
          : ''}
      </div>
      <div class="yardi-table-scroll">
        <table class="yardi-table">
          <thead><tr>
            <th class="yardi-th yardi-th-cb">
              <input type="checkbox" id="yCheckAll" checked onchange="toggleAllYardi(this.checked)"/>
            </th>
            <th class="yardi-th">Vendor</th>
            <th class="yardi-th" style="text-align:right">Amount</th>
            <th class="yardi-th">Date</th>
            <th class="yardi-th">Category</th>
            <th class="yardi-th">Description / GL</th>
            ${extraHeaders}
          </tr></thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>
      <div class="yardi-footer">
        <span id="yardiTotalInfo">
          <strong>${initCount}</strong> row${initCount !== 1 ? 's' : ''} selected &nbsp;&middot;&nbsp;
          <strong>${fmt(initTotal)}</strong> total
        </span>
        <button class="yardi-import-btn" id="yardiImportBtn" onclick="confirmYardiImport()">
          &#x2713; Import ${initCount} Expense${initCount !== 1 ? 's' : ''}
        </button>
      </div>
    </div>`;
}

function updateYardiTotals() {
  let count = 0, total = 0;
  yardiRows.forEach((row, i) => {
    const chk = document.getElementById(`ychk-${i}`);
    if (!chk || !chk.checked) return;
    const amt = parseFloat(yardiCell(row, 'amount').replace(/[$,\s]/g, '')) || 0;
    count++; total += amt;
  });
  const info = document.getElementById('yardiTotalInfo');
  const btn  = document.getElementById('yardiImportBtn');
  if (info) info.innerHTML = `<strong>${count}</strong> row${count !== 1 ? 's' : ''} selected &nbsp;&middot;&nbsp; <strong>${fmt(total)}</strong> total`;
  if (btn)  btn.textContent = `✓ Import ${count} Expense${count !== 1 ? 's' : ''}`;
}

function toggleAllYardi(checked) {
  yardiRows.forEach((_, i) => {
    const chk = document.getElementById(`ychk-${i}`);
    if (chk) chk.checked = checked;
  });
  updateYardiTotals();
}

async function confirmYardiImport() {
  let imported = 0;
  yardiRows.forEach((row, i) => {
    const chk = document.getElementById(`ychk-${i}`);
    if (!chk || !chk.checked) return;
    const vendor = cleanHTML(yardiCell(row, 'vendorName'));
    const amt    = parseFloat(yardiCell(row, 'amount').replace(/[$,\s]/g, '')) || 0;
    const date   = cleanHTML(yardiCell(row, 'invoiceDate'));
    const cat    = document.getElementById(`ycat-${i}`)?.value || 'other';
    if (!vendor && amt <= 0) return;
    invoiceData.push({
      vendorName:  vendor || 'Unknown Vendor',
      amount:      amt,
      category:    cat,
      invoiceDate: date,
      confidence:  { vendorName: 95, amount: 95, category: 70, invoiceDate: 90 },
      _error:      null,
    });
    imported++;
  });

  // Switch to file-upload tab so user sees the imported results
  switchInvTab('files');
  renderInvResults();

  const property = currentProperty();
  if (!property) throw new Error('No property selected');
  const existing = { invoices: Array.from(property.invoices || []) };
  // invoiceData already has existing invoices (restored on selectProperty) + new Yardi items.
  property.invoices = Array.from(invoiceData);
  captureCheckpoint(activePropId, 'Before Yardi import');
  await saveProperty(property);
  logActivity('invoice_uploaded', `${imported} Yardi expense${imported !== 1 ? 's' : ''} imported`, { severity: 'info', actor: 'User', detail: 'Imported from Yardi CSV' });

  document.getElementById('invResults').scrollIntoView({ behavior: 'smooth', block: 'start' });

  // Reset Yardi state and show confirmation
  yardiRows = []; yardiColMap = {}; yardiUnrecognized = [];
  document.getElementById('yardiPreview').innerHTML = `
    <div class="hole-item ok" style="margin-top:14px;">
      <span class="hole-icon">✅</span>
      <span class="hole-text">
        <strong>${imported} expense${imported !== 1 ? 's' : ''} imported from Yardi.</strong>
        <span class="hole-detail">Review and edit them in the Upload Files tab before running allocation.</span>
      </span>
    </div>`;
}

function downloadYardiTemplate() {
  const csv = [
    'Vendor,Amount,Post Date,Description,GL Account,Property',
    'ABC Landscaping,1250.00,2025-01-15,Monthly grounds maintenance,5400-Landscaping,Westfield Plaza',
    'City Snow Removal,875.50,2025-01-22,Snow plowing and salt - Lot A,5410-Snow Removal,Westfield Plaza',
    'Acme Janitorial,2100.00,2025-01-31,January janitorial services,5420-Janitorial,Westfield Plaza',
    'Metro Electric,3400.00,2025-01-31,Common area electricity,5430-Utilities,Westfield Plaza',
    'SecureGuard Inc,1800.00,2025-01-31,Security patrol services,5440-Security,Westfield Plaza',
  ].join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = 'yardi-cam-import-template.csv';
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Confidence Badge ─────────────────────────────────────────────────────────

function confidenceBadge(score) {
  if (score === null || score === undefined) return '';
  const s = parseInt(score, 10);
  if (isNaN(s)) return '';
  if (s >= 90) return `<span class="conf-badge conf-high">✓ High confidence</span>`;
  if (s >= 70) return `<span class="conf-badge conf-mid">⚠ Please verify</span>`;
  return `<span class="conf-badge conf-low">⚑ Low confidence — review carefully</span>`;
}

// ─── Duplicate Invoice Detection ──────────────────────────────────────────────

function similarVendor(a, b) {
  if (!a || !b) return false;
  const na = a.toLowerCase().trim();
  const nb = b.toLowerCase().trim();
  if (na === nb) return true;
  // Check if one contains at least the first 5 chars of the other
  const min = Math.min(na.length, nb.length);
  if (min >= 5) {
    const prefix = na.substring(0, Math.min(5, na.length));
    if (nb.includes(prefix)) return true;
    const prefix2 = nb.substring(0, Math.min(5, nb.length));
    if (na.includes(prefix2)) return true;
  }
  return false;
}

function checkDuplicateInvoice(idx) {
  const curr = invoiceData[idx];
  if (!curr || !curr.vendorName || curr.amount === '') return;
  const currAmt  = parseFloat(curr.amount);
  const currDate = curr.invoiceDate ? new Date(curr.invoiceDate) : null;

  for (let i = 0; i < invoiceData.length; i++) {
    if (i === idx) continue;
    const other = invoiceData[i];
    if (!other || !other.vendorName || other.amount === '') continue;

    const amtMatch    = Math.abs(currAmt - parseFloat(other.amount)) <= 1;
    const vendorMatch = similarVendor(curr.vendorName, other.vendorName);

    let dateMatch = true;
    if (currDate && other.invoiceDate) {
      const diffDays = Math.abs(currDate - new Date(other.invoiceDate)) / 86400000;
      dateMatch = diffDays <= 7;
    }

    if (vendorMatch && amtMatch && dateMatch) {
      showDuplicateWarning(idx, other, i);
      return;
    }
  }
}

function showDuplicateWarning(idx, other, otherIdx) {
  const el = document.getElementById(`dup-warn-${idx}`);
  if (!el) return;
  el.innerHTML = `
    <div class="warn-banner">
      <div class="warn-msg">
        ⚠️ This looks like a duplicate of <strong>${esc(other.vendorName)}</strong>
        ${fmt(parseFloat(other.amount))} (Invoice ${otherIdx + 1}) already uploaded.
        Add anyway?
      </div>
      <div class="warn-banner-btns">
        <button class="warn-btn add"    onclick="this.closest('.warn-banner').remove()">Yes, add it</button>
        <button class="warn-btn remove" onclick="removeDuplicateInvoice(${idx})">Remove duplicate</button>
      </div>
    </div>`;
}

function removeDuplicateInvoice(idx) {
  removeInvItem(idx);
}

// ─── Amount Sanity Check ──────────────────────────────────────────────────────

function checkAmountSanity(idx) {
  const curr = invoiceData[idx];
  if (!curr || curr.amount === '' || !curr.category) return;
  const currAmt = parseFloat(curr.amount);
  if (!currAmt || currAmt <= 0) return;

  const peers = invoiceData
    .filter((inv, i) => i !== idx && inv && inv.category === curr.category && parseFloat(inv.amount) > 0)
    .map(inv => parseFloat(inv.amount));

  if (peers.length === 0) return;

  const avg = peers.reduce((s, a) => s + a, 0) / peers.length;
  if (currAmt > avg * 3) {
    showSanityWarning(idx, curr.category, currAmt, avg);
  }
}

function showSanityWarning(idx, category, amount, avg) {
  const el = document.getElementById(`sanity-warn-${idx}`);
  if (!el) return;
  el.innerHTML = `
    <div class="warn-banner">
      <div class="warn-msg">
        ⚠️ This <strong>${esc(category)}</strong> invoice (${fmt(amount)}) is unusually
        high compared to your other ${esc(category)} invoices (avg ${fmt(avg)}).
        Please verify before continuing.
      </div>
      <div class="warn-banner-btns">
        <button class="warn-btn dismiss" onclick="this.closest('.warn-banner').remove()">Dismiss</button>
      </div>
    </div>`;
}

// ─── Pre-Allocation Confirmation Modal ────────────────────────────────────────

// Parse leasedSqft robustly: handles numbers, numeric strings, and strings
// with commas (e.g. "2,500") or trailing units (e.g. "2500 sq ft").
// Returns the numeric value, or 0 if the value is empty / non-numeric.
function parseSqft(v) {
  if (v === null || v === undefined || v === '') return 0;
  let s = String(v).trim();
  // Replace capital-O OCR artifact with zero: "45,OOO" → "45,000"
  s = s.replace(/O/g, '0');
  // European-style thousand separators: "45.000" → "45000" (only when no decimal follows)
  s = s.replace(/\.(?=\d{3}(?:[,\s]|$))/g, '');
  // Strip remaining non-numeric chars except decimal point
  s = s.replace(/[^0-9.]/g, '');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function showAllocationModal() {
  const totalSqft = parseFloat(document.getElementById('totalSqft').value);
  const tenants   = tenantData.filter(t => t && t.tenantName && parseSqft(t.leasedSqft) > 0);
  const invoices  = invoiceData.filter(inv => inv && inv.vendorName && parseFloat(inv.amount) > 0);

  // If data isn't ready let runAllocation() surface the validation error
  if (!totalSqft || totalSqft <= 0 || !tenants.length || !invoices.length) {
    runAllocation();
    return;
  }

  const total = invoices.reduce((s, inv) => s + parseFloat(inv.amount), 0);

  // Category breakdown rows
  const catTotals = {};
  invoices.forEach(inv => {
    catTotals[inv.category] = (catTotals[inv.category] || 0) + parseFloat(inv.amount);
  });
  const catRows = Object.entries(catTotals)
    .sort((a, b) => b[1] - a[1])
    .map(([cat, amt]) => `
      <tr>
        <td style="padding-left:14px;color:#64748b;text-transform:capitalize">${esc(cat)}</td>
        <td>${fmt(amt)}</td>
      </tr>`).join('');

  document.getElementById('allocModalBody').innerHTML = `
    <div class="modal-confirm-msg">
      You are about to allocate <strong>${fmt(total)}</strong> across
      <strong>${tenants.length}</strong> tenant${tenants.length !== 1 ? 's' : ''}.
      Please confirm this looks correct.
    </div>
    <table class="modal-summary-table">
      <tr><td>Total Invoices</td><td>${invoices.length}</td></tr>
      <tr><td>Total Amount</td><td>${fmt(total)}</td></tr>
      <tr><td>Tenants</td><td>${tenants.length}</td></tr>
      ${catRows}
    </table>`;

  document.getElementById('allocModal').style.display = 'flex';
}

function confirmAllocation() {
  closeAllocModal();
  runAllocation();
}

function closeAllocModal() {
  document.getElementById('allocModal').style.display = 'none';
}

// ─── Tenant Matching ──────────────────────────────────────────────────────────
// Tries to match a single invoice to a specific tenant by unit number or name.
// Returns { tenantName, confidence, reason } or null if no genuine match found.
function matchesTenant(inv, tenant) {
  const tName = tenant.tenantName || tenant.name || '';
  return (
    (inv.matchedTenantId && tenant.id && inv.matchedTenantId === tenant.id) ||
    (inv.tenantId        && tenant.id && inv.tenantId        === tenant.id) ||
    (inv.matchedTenant   && tName && inv.matchedTenant === tName) ||
    (inv.tenantName      && tName && inv.tenantName    === tName)
  );
}

function matchInvoiceToTenant(invoice, tenants) {
  let bestMatch = null;
  let bestConf  = 0;
  const text = [invoice.vendorName, invoice.category, invoice.invoiceDate]
    .filter(Boolean).join(' ').toLowerCase();

  console.log('[matchInvoiceToTenant] INPUT', {
    invoiceVendorName:  invoice.vendorName,
    invoiceVendor:      invoice.vendor,       // alias used in some paths
    invoiceCategory:    invoice.category,
    invoiceDate:        invoice.invoiceDate,
    invoiceAmount:      invoice.amount,
    invoiceId:          invoice.id,
    assembledText:      text,
    tenantCount:        tenants.length,
    tenantNames:        tenants.map(t => t.tenantName || t.tenant_name || '(none)'),
    tenantUnits:        tenants.map(t => t.unitNumber || '(none)'),
  });

  for (const t of tenants) {
    let conf   = 0;
    let reason = '';
    // support both Lease objects (tenantName) and tenantData items (tenant_name)
    const name = t.tenantName || t.tenant_name || '';

    const unitHit = !!(t.unitNumber && text.includes(t.unitNumber.toLowerCase()));
    const nameHit = !!(name && text.includes(name.toLowerCase()));

    if (unitHit) {
      conf   = 90;
      reason = `Unit ${t.unitNumber}`;
    }
    if (nameHit) {
      if (conf < 75) { conf = 75; reason = name; }
    }

    console.log('[matchInvoiceToTenant] CANDIDATE', {
      tenantName:  name,
      unitNumber:  t.unitNumber || '',
      unitChecked: t.unitNumber ? t.unitNumber.toLowerCase() : '(skip)',
      nameChecked: name ? name.toLowerCase() : '(skip)',
      unitHit,
      nameHit,
      conf,
      reason: reason || 'no match',
    });

    if (conf > bestConf) {
      bestConf  = conf;
      bestMatch = { tenantName: name, tenantId: t.id || null, confidence: conf, reason };
    }
  }

  console.log('[matchInvoiceToTenant] RESULT', {
    vendor:     invoice.vendorName || invoice.vendor,
    bestConf,
    bestMatch,
    verdict:    bestConf >= 75 ? 'DIRECT' : bestConf > 0 ? 'LOW-CONF' : 'SHARED (no match)',
  });

  return bestMatch; // null = no match, shared expense
}

// ─── Full Reconciliation Engine ───────────────────────────────────────────────
// Works on a Property object. Shared invoices are split pro-rata; invoices with
// a direct tenant match (confidence >= 75) are charged only to that tenant.

function runFullReconciliation(property) {
  // Always read fresh tenant data — never rely on what was baked into Lease objects
  const liveTenants = currentProperty()?.tenants || [];
  const { leases, invoices, totalSqFt } = property;
  if (!leases.length || !invoices.length) return [];

  // Pre-compute property-level sqFt overflow once
  const totalLeasedSqFt = leases.reduce((s, l) => s + (l.sqFt || 0), 0);
  const sqFtOverflow    = totalSqFt > 0 && totalLeasedSqFt > totalSqFt;

  console.log('[runFullReconciliation] ENTER', {
    invoiceCount: invoices.length,
    leaseCount:   leases.length,
    leaseSummary: leases.map(l => ({ name: l.tenantName, unit: l.unitNumber, sqFt: l.sqFt })),
    invoiceSample: invoices.slice(0, 3).map(inv => ({
      vendorName:  inv.vendorName,
      vendor:      inv.vendor,
      category:    inv.category,
      invoiceDate: inv.invoiceDate,
      amount:      inv.amount,
    })),
  });

  invoices.forEach(inv => {
    const m = matchInvoiceToTenant(inv, leases);
    inv.matchedTenant   = m ? m.tenantName : null;
    inv.matchedTenantId = m ? m.tenantId   : null;
    inv.matchConfidence = m ? m.confidence : 0;
    inv.matchReason     = m ? m.reason     : '';
    console.log('[runFullReconciliation] MATCH RESULT', {
      vendor:         inv.vendorName || inv.vendor,
      matchConfidence: inv.matchConfidence,
      matchedTenant:  inv.matchedTenant,
      matchReason:    inv.matchReason,
      classification: inv.matchConfidence >= 75 ? 'DIRECT' : 'SHARED',
    });
  });

  const directInvoices = invoices.filter(inv => inv.matchConfidence >= 75);
  const sharedInvoices = invoices.filter(inv => inv.matchConfidence <  75);

  const results = leases.map(lease => {
    // Look up current tenant state directly from property.tenants by stable id
    const live    = liveTenants.find(t => t?.id === lease.id) || {};
    const proRata = lease.sqFt / totalSqFt;

    const eligibleShared = sharedInvoices.filter(inv =>
      !lease.excludedCategories.includes((inv.category || '').toLowerCase())
    );
    const sharedTotal = eligibleShared.reduce((s, inv) => s + inv.amount, 0) * proRata;

    const ownInvoices = directInvoices.filter(inv => matchesTenant(inv, lease));
    const ownTotal    = ownInvoices.reduce((s, inv) => s + inv.amount, 0);

    let rawTotal      = sharedTotal + ownTotal;
    let capApplied    = false;
    let capAdjustment = null;

    if (lease.capPercentage !== null && lease.capBaseAmount !== null) {
      const cap = lease.capBaseAmount * (1 + lease.capPercentage / 100);
      if (rawTotal > cap) {
        capAdjustment = parseFloat((rawTotal - cap).toFixed(2));
        rawTotal      = cap;
        capApplied    = true;
      }
    }

    const included = [
      ...eligibleShared.map(inv => ({
        ...inv,
        allocation: 'shared',
        share: parseFloat((inv.amount * proRata).toFixed(2)),
        ...(inv.matchConfidence < 75 ? {
          flag: {
            message:     'Low confidence invoice match',
            explanation: 'This invoice could not be confidently matched to a tenant using unit number or name, so it was treated as a shared expense.',
          },
        } : {}),
      })),
      ...ownInvoices.map(inv => ({ ...inv, allocation: 'direct', share: inv.amount })),
    ];

    // Recompute flags from live tenant data — never cache between runs
    const flags = [];

    if (sqFtOverflow) {
      flags.push({
        code:        'SQFT_OVERFLOW',
        message:     'Total leased square footage exceeds property total',
        explanation: `The sum of tenant square footage (${totalLeasedSqFt.toLocaleString()} sqft) exceeds the property total (${totalSqFt.toLocaleString()} sqft). Pro-rata calculations may be incorrect.`,
      });
    }

    if (!parseSqft(live.leased_sqft || lease.sqFt)) {
      flags.push({
        code:        'SQFT_APPROXIMATE',
        message:     'Square footage may be incorrect',
        explanation: 'This tenant has missing or zero square footage, which may cause incorrect pro-rata calculations.',
      });
    }

    const invoiceYears   = invoices.map(inv => new Date(inv.date || inv.invoiceDate || '').getFullYear()).filter(y => !isNaN(y));
    const leaseStartDate = live.start_date || lease.startDate || '';
    const leaseStartYear = new Date(leaseStartDate).getFullYear();
    if (!isNaN(leaseStartYear) && invoiceYears.some(y => y < leaseStartYear)) {
      flags.push({
        code:        'BASE_YEAR_MISMATCH',
        message:     'Invoice dates may not match lease period',
        explanation: 'One or more invoices occur before the lease start date, which may indicate incorrect CAM charges.',
      });
    }

    // Use live lease_type so edits take effect immediately without re-extracting
    const currentLeaseType = live.lease_type || lease.leaseType || null;
    if (!currentLeaseType) {
      flags.push({
        code:        'NNN_GROSS_UNKNOWN',
        message:     'Lease type not specified',
        explanation: 'The system could not determine if this lease is NNN or Gross, which affects how expenses should be allocated.',
      });
    }

    const result = new ReconciliationResult(
      lease.tenantName,
      lease.unitNumber,
      lease.sqFt,
      parseFloat(rawTotal.toFixed(2)),
      parseFloat((proRata * 100).toFixed(2)),
      included,
      capApplied,
      capAdjustment
    );
    result.ambiguityFlags = flags;
    result.tenantId       = lease.id;

    const actualCam   = result.totalAllocated ?? null;
    const expectedCam = live.cap ?? null;
    const variance    = (actualCam !== null && expectedCam !== null)
      ? Math.round((actualCam - expectedCam) * 100) / 100
      : null;

    result.actualCam   = actualCam;
    result.expectedCam = expectedCam;
    result.variance    = variance;
    return result;
  });

  // Penny adjustment: if floating-point rounding leaves a tiny gap, absorb it into
  // the largest tenant so the sum of allocations equals total invoices exactly.
  const totalExpenses = invoices.reduce((s, inv) => s + inv.amount, 0);
  const sumAllocated  = results.reduce((s, r) => s + r.totalAllocated, 0);
  const diff          = parseFloat((totalExpenses - sumAllocated).toFixed(2));
  if (Math.abs(diff) < 0.05 && results.length > 0) {
    const largest = results.reduce((a, b) => a.totalAllocated >= b.totalAllocated ? a : b);
    largest.totalAllocated   = parseFloat((largest.totalAllocated  + diff).toFixed(2));
    largest.allocatedAmount  = largest.totalAllocated;
  }

  property.reconciliations = results;
  return results;
}

// ─── CAM Allocation Engine ────────────────────────────────────────────────────

function runCAMAllocation(expenses, tenants) {
  return tenants.map(t => {
    const proRata  = t.leasedSqft / t.totalSqft;
    const eligible = expenses.filter(e =>
      !t.excludedCategories.includes(e.category.toLowerCase())
    );
    let total = eligible.reduce((s, e) => s + e.amount * proRata, 0);
    let capAdj = null;

    // Cap requires a prior-year base amount to calculate correctly.
    // capBaseAmount must be entered manually; without it we skip cap enforcement
    // rather than show wrong math.
    if (t.capPct !== null && t.capPct !== '' && !isNaN(parseFloat(t.capPct)) &&
        t.capBaseAmount !== null && t.capBaseAmount !== undefined && !isNaN(parseFloat(t.capBaseAmount))) {
      const cap = parseFloat(t.capBaseAmount) * (1 + parseFloat(t.capPct) / 100);
      if (total > cap) { capAdj = total - cap; total = cap; }
    }

    return {
      name:            t.name,
      proRata,
      allocatedAmount: parseFloat(total.toFixed(2)),
      capAdjustment:   capAdj !== null ? parseFloat(capAdj.toFixed(2)) : null,
      capApplied:      capAdj !== null,
      eligibleCount:   eligible.length,
    };
  });
}

async function runAllocation() {
  if (isRunning) return; // prevent concurrent runs
  isRunning = true;

  const scrollY    = window.scrollY;

  // Loading state
  const runBtn = document.getElementById('runBtn');
  const runBtnOrigText = runBtn ? runBtn.textContent : '';
  if (runBtn) { runBtn.disabled = true; runBtn.textContent = 'Running…'; runBtn.style.opacity = '0.7'; }

  // Commit any in-progress field edit before reading data — if the user typed
  // a new value and clicked Run without clicking away, onblur hasn't fired yet.
  if (document.activeElement && document.activeElement !== document.body) {
    document.activeElement.blur();
  }

  try {

  const propName  = document.getElementById('propertyName').value.trim() || 'Property';
  const totalSqft = parseFloat(document.getElementById('totalSqft').value);
  const section   = document.getElementById('results');
  const body      = document.getElementById('resultsBody');

  if (!totalSqft || totalSqft <= 0) {
    showErr(body, section, 'Please enter a valid Total Property Sqft in Section 1.');
    return;
  }

  // Show banner if sqFt is over, but do NOT block — surfaced as SQFT_OVERFLOW flag on results
  checkSqftValidation();

  // Flush any pending field edits from tenantData into currentProperty().tenants before reading.
  // updateTenantField writes to both, but if the ID lookup missed, only tenantData was updated.
  const _activeProp = currentProperty();
  if (_activeProp && tenantData.some(t => t !== null)) _activeProp.tenants = tenantData.filter(t => t !== null);

  const validTenants = getValidTenants();

  // Clear any warnings left over from a previous run before recomputing them.
  section.querySelectorAll('.cam-sqft-warning, .cam-skip-warning').forEach(el => el.remove());

  // Warn about tenants that exist but are excluded from CAM due to missing sqft
  const allNamedTenants = (currentProperty()?.tenants || []).filter(t => t && t.tenant_name);
  const missingSquare   = allNamedTenants.filter(t => parseSqft(t.leased_sqft) <= 0);
  if (missingSquare.length > 0 && validTenants.length > 0) {
    const warn = document.createElement('div');
    warn.className = 'cam-sqft-warning';
    warn.style.cssText = 'background:#7c2d1220;border:1px solid #f97316;color:#fb923c;padding:10px 14px;border-radius:8px;margin-bottom:14px;font-size:0.85rem;';
    warn.textContent = `⚠️ ${missingSquare.length} tenant${missingSquare.length > 1 ? 's' : ''} excluded from CAM — missing Leased Sqft: ${missingSquare.map(t => t.tenant_name).join(', ')}. Edit those tenants in Section 2 and re-run to include them.`;
    section.prepend(warn);
  }

  const tenants = validTenants.map(t => ({
      name:               t.tenant_name,
      leasedSqft:         parseSqft(t.leased_sqft),
      totalSqft,
      capPct:             t.cap,
      capBaseAmount:      t.capBaseAmount ?? null,
      excludedCategories: t.excluded_categories
        ? t.excluded_categories.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
        : [],
    }));

  if (!tenants.length) {
    // If there are tenants with names but missing sqft, give a more specific message
    const namedTenantsWithNoSqft = (currentProperty()?.tenants || []).filter(t => t && t.tenant_name && parseSqft(t.leased_sqft) <= 0);
    if (namedTenantsWithNoSqft.length) {
      showErr(body, section,
        `${namedTenantsWithNoSqft.length} tenant(s) are missing Leased Sqft. ` +
        'Click "Edit" on each tenant in Section 2 and enter their square footage, then run again.');
    } else {
      showErr(body, section, 'Please upload at least one lease with a name and square footage in Section 2.');
    }
    return;
  }

  const allInvoices   = invoiceData.filter(inv => inv && inv.vendorName);
  const invoices      = allInvoices
    .filter(inv => parseFloat(inv.amount) > 0)
    .map(inv => ({ vendor: inv.vendorName, category: inv.category, amount: parseFloat(inv.amount) }));
  const skippedCount  = allInvoices.length - invoices.length;

  if (!invoices.length) {
    showErr(body, section, 'Please upload at least one invoice with a vendor and amount in Section 3.');
    return;
  }

  // Warn if invoices are being excluded due to missing amounts
  if (skippedCount > 0) {
    const warn = document.createElement('div');
    warn.className = 'cam-skip-warning';
    warn.style.cssText = 'background:#7c3a0020;border:1px solid #f59e0b;color:#fbbf24;padding:10px 14px;border-radius:8px;margin-bottom:14px;font-size:0.85rem;';
    warn.textContent = `⚠️ ${skippedCount} invoice${skippedCount > 1 ? 's' : ''} with no amount were excluded from this calculation. Open each invoice in Section 3 and enter the missing amount to include them.`;
    section.prepend(warn);
  }

  const results   = runCAMAllocation(invoices, tenants);
  const totalCost = invoices.reduce((s, e) => s + e.amount, 0);

  const totalLeasedSqft = tenants.reduce((s, t) => s + (t.leasedSqft || 0), 0);
  const sqftExceedsProperty = totalLeasedSqft > totalSqft;

  // Build a Property + run full reconciliation (for per-tenant invoice breakdown + direct matching)
  const _prop = new Property(propName, totalSqft);
  _prop.addLeases(getValidTenants().map(t => {
    const lease = new Lease(t.tenant_name, t.unitNumber || '', parseSqft(t.leased_sqft), t.start_date || '', t.end_date || '',
      t.excluded_categories ? t.excluded_categories.split(',').map(s => s.trim()) : [],
      t.cap ?? null, null,
      (t.confidence?.leased_sqft ?? t.confidence?.leasedSqft ?? 100) < 70,
      t.baseYear ?? null,
      t.lease_type || null);
    lease.id = t.id || null; // stable id for invoice linking
    return lease;
  }));
  _prop.addInvoices(invoiceData.filter(inv => inv && inv.vendorName && parseFloat(inv.amount) > 0).map(inv =>
    new Invoice(null, inv.invoiceDate, inv.amount, inv.vendorName, inv.category)
  ));
  const fullResults = runFullReconciliation(_prop);

  // Sync matchedTenant tags back to invoiceData for badge display
  const activeTenants = (currentProperty()?.tenants || []).filter(t => t && t.tenant_name);
  console.log('[runAllocation] badge-sync matchInvoiceToTenant', {
    activeTenantCount: activeTenants.length,
    activeTenantNames: activeTenants.map(t => t.tenant_name),
    activeTenantUnits: activeTenants.map(t => t.unitNumber || '(none)'),
    invoiceDataCount:  invoiceData.length,
    invoiceDataSample: invoiceData.slice(0, 3).map(inv => ({
      vendorName:  inv?.vendorName,
      vendor:      inv?.vendor,
      category:    inv?.category,
      invoiceDate: inv?.invoiceDate,
    })),
  });
  invoiceData.forEach((inv, i) => {
    if (!inv) return;
    const m = matchInvoiceToTenant(inv, activeTenants);
    invoiceData[i].matchedTenant   = m ? m.tenantName : null;
    invoiceData[i].matchedTenantId = m ? m.tenantId   : null;
    invoiceData[i].matchConfidence = m ? m.confidence : 0;
    invoiceData[i].matchReason     = m ? m.reason     : '';
    console.log('[runAllocation] badge-sync RESULT', {
      idx:             i,
      vendor:          inv.vendorName || inv.vendor,
      matchConfidence: invoiceData[i].matchConfidence,
      matchedTenant:   invoiceData[i].matchedTenant,
    });
  });
  renderInvResults();

  // Store for dispute + reports sections
  lastInvoices        = invoices.map((inv, i) => ({ id: `inv-${i}`, ...inv }));
  lastTenants         = tenants;
  lastResults         = fullResults; // unified: ReconciliationResult[] is single source of truth
  lastFullResults     = fullResults;
  lastPropName        = propName;
  lastTotal           = totalCost;
  lastInvoicesFull    = invoices;
  console.groupCollapsed('[PIPELINE:1] runAllocation runtime snapshot');
  console.log('lastInvoicesFull[0]:', JSON.parse(JSON.stringify(lastInvoicesFull[0] || {})));
  console.log('invoiceData[0]:', JSON.parse(JSON.stringify(invoiceData[0] || {})));
  console.groupEnd();

  document.getElementById('resultsTitle').textContent = `${getCamYear()} CAM — ${propName}`;
  applySqftMismatchUI(sqftExceedsProperty);

  let html = `<div class="summary-bar">
    <div class="summary-bar-item"><span class="summary-bar-label">Total Expenses</span><strong>${fmt(totalCost)}</strong></div>
    <div class="summary-bar-item"><span class="summary-bar-label">Tenants</span><strong>${fullResults.length}</strong></div>
    <div class="summary-bar-item"><span class="summary-bar-label">Invoices</span><strong>${invoices.length}</strong></div>
  </div>
  ${sqftExceedsProperty ? `
  <div class="sqft-mismatch-banner">
    <div class="smb-title">&#x26A0;&#xFE0F; Sqft mismatch — results may be inaccurate</div>
    <div class="smb-body">
      Your leases total <strong>${totalLeasedSqft.toLocaleString()} sqft</strong>, but the property is set to <strong>${totalSqft.toLocaleString()} sqft</strong>.<br><br>
      Pro-rata shares are calculated using mismatched data. You can fix this now or continue reviewing results.
    </div>
    <div class="smb-actions">
      <button class="smb-btn" onclick="fixSqftToMatch(${totalLeasedSqft})">Use Lease Total (${totalLeasedSqft.toLocaleString()} sqft)</button>
      <button class="smb-btn smb-btn-primary" onclick="rerunAfterWarning()">Run Anyway</button>
    </div>
  </div>
  ` : ''}`;

  fullResults.forEach(r => {
    const flags = r.ambiguityFlags || [];

    // ── Prominent flags block ──────────────────────────────────────────
    const flagsSection = flags.length > 0
      ? `<div class="rc-flags">
          <div class="rc-flags-title">&#x26A0;&#xFE0F; Needs Review</div>
          ${flags.map(f => `
            <div class="rc-flag-item">
              &#x2022; <strong>${esc(f.message)}</strong>
              ${f.explanation ? `<br><span class="rc-flag-expl">${esc(f.explanation)}</span>` : ''}
            </div>`).join('')}
        </div>`
      : '';

    // ── Category-grouped invoice breakdown (matches Tenant Statement style) ──
    const invBreakdown = (() => {
      if (!r.includedInvoices.length) return '';

      // Group invoices by category, accumulate share per category
      const catMap = {};
      r.includedInvoices.forEach((inv, invIdx) => {
        const key = (inv.category || 'other').toLowerCase();
        if (!catMap[key]) catMap[key] = { label: inv.category || 'Other', share: 0, invoices: [] };
        catMap[key].share += inv.share;
        catMap[key].invoices.push({ inv, invIdx });
      });

      const pct = (r.proRata * 100).toFixed(2);

      const catCards = Object.entries(catMap)
        .sort((a, b) => b[1].share - a[1].share)
        .map(([, data]) => {
          const invRows = data.invoices.map(({ inv, invIdx }) => {
            const rowId = `rcn-${r.name}-${invIdx}`.replace(/[^a-zA-Z0-9-]/g, '-');
            return `
              <div class="charge-row ts-inv-card" id="crow-${rowId}"
                onclick="(function(row){var d=document.getElementById('ddetail-${rowId}');var open=d.style.display==='block';d.style.display=open?'none':'block';row.classList.toggle('detail-open',!open);})(this)">
                <div class="charge-row-top">
                  <div class="charge-row-left">
                    <div class="charge-vendor">${esc(inv.vendorName || '')}</div>
                    <div class="charge-amount">${fmt(inv.share)}</div>
                    <div class="charge-sub">Tenant share (${pct}%)${inv.allocation === 'direct' ? ' &middot; direct' : ''}</div>
                    <p class="ts-vendor-hint">Tap for details or to dispute</p>
                  </div>
                  <div class="charge-chevron">&#x203A;</div>
                </div>
                <div id="ddetail-${rowId}" class="ts-detail-box" style="display:none;" onclick="event.stopPropagation()">
                  <div class="ts-detail-header">
                    <span class="ts-detail-title">Charge Details</span>
                    <button class="ts-detail-close"
                      onclick="document.getElementById('ddetail-${rowId}').style.display='none';document.getElementById('crow-${rowId}').classList.remove('detail-open')">&#x2715;</button>
                  </div>
                  <div class="ts-detail-row"><span>Vendor</span><span class="ts-detail-val">${esc(inv.vendorName || '')}</span></div>
                  <div class="ts-detail-row"><span>Category</span><span class="ts-detail-val">${esc(inv.category || '')}</span></div>
                  <div class="ts-detail-row"><span>Invoice Total</span><span class="ts-detail-val">${fmt(inv.amount)}</span></div>
                  <div class="ts-detail-row ts-detail-highlight"><span>Tenant Share</span><span class="ts-detail-val">${fmt(inv.share)}</span></div>
                  <div class="ts-detail-basis">Based on ${pct}% pro-rata allocation by square footage</div>
                  <div class="ts-detail-actions">
                    <button class="inv-act-btn inv-act-explain" id="tsexplbtn-${rowId}"
                      onclick="event.stopPropagation();tsExplainInvoice('${rowId}','${esc(inv.vendorName||'')}','${esc(inv.category||'')}',${inv.amount},'${esc(inv.invoiceDate||'')}')">Explain</button>
                    <button class="inv-act-btn inv-act-dispute" id="dbtn-${rowId}"
                      onclick="event.stopPropagation();toggleDisputeForm('${rowId}','${esc(r.name)}','${rowId}','${esc(inv.vendorName||'')}','${esc(inv.category||'')}',${inv.share})">Dispute</button>
                  </div>
                  ${inv.flag ? `<div class="recon-inv-flag" style="margin-top:8px;">&#x26A0; ${esc(inv.flag.message)}</div>` : ''}
                  <div id="tsexpl-${rowId}"></div>
                  <div id="dform-${rowId}" style="display:none;"></div>
                </div>
              </div>`;
          }).join('');

          const count = data.invoices.length;
          return `
            <div class="ts-cat-accordion">
              <div class="ts-cat-header"
                onclick="(function(hdr){var body=hdr.nextElementSibling;var open=body.style.display==='block';body.style.display=open?'none':'block';hdr.classList.toggle('active',!open);})(this)">
                <div class="ts-cat-left">
                  <div class="ts-cat-name">${esc(data.label)}</div>
                  <div class="ts-cat-meta">${count} invoice${count !== 1 ? 's' : ''}</div>
                </div>
                <div class="ts-cat-right">
                  <div class="ts-cat-share-amt">${fmt(parseFloat(data.share.toFixed(2)))}</div>
                  <div class="ts-cat-share-lbl">YOUR SHARE</div>
                </div>
                <div class="ts-cat-chevron">&#x203A;</div>
              </div>
              <div class="ts-cat-body" style="display:none;">
                <div class="charge-list">${invRows}</div>
              </div>
            </div>`;
        }).join('');

      const capLine = r.capApplied
        ? `<div class="recon-cap-note">&#x26A0; Cap applied — ${fmt(r.capAdjustment)} reduced</div>`
        : '';

      return `<div class="rc-cat-breakdown">${capLine}${catCards}</div>`;
    })();

    // ── Confidence stat ────────────────────────────────────────────────
    const confStat = r.averageConfidence > 0
      ? stat('Confidence', r.averageConfidence + '%')
      : '';

    const tdIdx = tenantData.findIndex(t => t && t.tenant_name === r.name);
    const _td   = tdIdx >= 0 ? tenantData[tdIdx] : null;
    const leaseBtn = _td?.leaseExpected
      ? (_td.leaseFile instanceof File || _td.leaseUrl)
        ? `<button class="action-btn" onclick="openLeaseModalFromFile(${tdIdx})">&#x1F4C4; View Lease</button>`
        : `<div class="lease-missing-note">⚠️ Lease not attached — using manual data</div>`
      : '';

    html += `<div class="result-card${flags.length ? ' result-card--flagged' : ''}">
      <div class="r-name">${esc(r.name)}${r.unitNumber ? `<span class="rc-unit"> · Unit ${esc(r.unitNumber)}</span>` : ''}</div>
      <div class="result-grid">
        ${stat('Total', fmt(r.allocatedAmount))}
        ${stat('Pro-Rata', (r.proRata * 100).toFixed(2) + '%')}
        ${confStat}
        ${stat('Included', r.eligibleCount + ' of ' + invoices.length)}
      </div>
      ${r.capApplied ? `<div class="cap-badge">Cap applied — ${fmt(r.capAdjustment)} reduced</div>` : ''}
      ${flagsSection}
      ${leaseBtn}
      ${invBreakdown}
      <button class="explain-btn" onclick="openExplainPanel('${esc(r.name)}')">&#x1F4CA; View Calculation</button>
    </div>`;
  });

  body.innerHTML = html;
  section.style.display = 'block';
  animateCAMResults(body, section);

  // Save to previous runs history
  camRuns.unshift({
    propName,
    camYear:       getCamYear(),
    timestamp:     new Date(),
    totalExpenses: totalCost,
    tenantCount:   fullResults.length,
    invoiceCount:  invoices.length,
    results:       fullResults.map(r => ({ ...r })),
    sqft:          parseFloat(currentProperty()?.totalSqft || currentProperty()?.totalSqFt) || 0,
    categories:    invoices.reduce((m, inv) => {
      const k = (inv.category || 'other').toLowerCase();
      m[k] = (m[k] || 0) + (parseFloat(inv.amount) || 0);
      return m;
    }, {}),
    vendors:       invoices.reduce((m, inv) => {
      const k = (inv.vendor || inv.vendorName || '').toLowerCase().trim();
      if (k) m[k] = (m[k] || 0) + (parseFloat(inv.amount) || 0);
      return m;
    }, {}),
  });

  captureCheckpoint(activePropId, 'Before CAM run');
  // ── Activity log: reconciliation run ─────────────────────────────────
  {
    const isRerun = camRuns.length > 1;
    const narrative = buildAuditNarrative();
    logActivity(
      isRerun ? 'reconciliation_rerun' : 'reconciliation_run',
      `${isRerun ? 'Rerun' : 'CAM reconciliation'} — ${getCamYear()}`,
      {
        severity:       'success',
        actor:          'System',
        relatedEntity:  propName,
        financialImpact: fmt(totalCost),
        detail:         `Risk: ${narrative.riskLevel} · ${fullResults.length} tenants · ${invoices.length} invoices`,
      }
    );
    const trendsData = buildHistoricalTrends();
    if (trendsData && trendsData.trends.length) {
      logActivity('historical_comparison',
        `Historical comparison — ${trendsData.priorYear} vs ${trendsData.currYear}`,
        { severity: 'info', actor: 'System', relatedEntity: propName, detail: `${trendsData.trends.length} trend${trendsData.trends.length > 1 ? 's' : ''} detected` }
      );
    }
  }

  renderPreviousRuns();
  renderNarrativePanel();
  renderAuditPanel();
  renderHistoricalTrendsPanel();
  renderActivityTimeline();

  renderDisputeSection();
  showReportSection(); // refresh notice + tenant buttons
  // Fire-and-forget — only updates portfolio card stats; a Supabase hang here
  // must not hold the button in "Running…" after results are already on screen.
  syncPortfolioEntry().catch(() => {});
  await savePropertyData(); // persist CAM allocation results to Supabase
  await saveCamResults(currentProperty()?.id, fullResults, getCamYear()).catch(e =>
    console.error('[saveCamResults]', e)
  );

  // Snapshot the full reconciliation and immediately persist to Supabase so
  // results survive logout, browser refresh, and cleared localStorage.
  const _snapProp = currentProperty();
  if (_snapProp) {
    _snapProp.camReconciliation = {
      propId:       _snapProp.id,
      propName,
      camYear:      getCamYear(),
      savedAt:      new Date().toISOString(),
      total:        totalCost,
      results:      fullResults.map(r => ({ ...r })),
      invoices:     lastInvoices,
      invoicesFull: lastInvoicesFull,
      tenants:      lastTenants,
      camRuns:      camRuns.map(r => ({
        ...r,
        timestamp: r.timestamp instanceof Date ? r.timestamp.toISOString() : r.timestamp,
      })),
    };
    console.groupCollapsed('[PIPELINE:2] pre-save snapshot');
    console.log('camRec.invoicesFull[0]:', JSON.parse(JSON.stringify(_snapProp.camReconciliation.invoicesFull?.[0] || {})));
    console.log('prop.invoices[0]:', JSON.parse(JSON.stringify(_snapProp.invoices?.[0] || {})));
    console.log('results[0].includedInvoices[0]:', JSON.parse(JSON.stringify(_snapProp.camReconciliation.results?.[0]?.includedInvoices?.[0] || {})));
    console.groupEnd();
    await saveProperty(_snapProp);
  }

  updateStepBar('review');

  showRunCompleteToast();

  requestAnimationFrame(() => { window.scrollTo(0, scrollY); });

  } catch (err) {
    logError('runAllocation', err, {
      tenantCount:  tenantData.filter(t => t?.tenant_name).length,
      invoiceCount: invoiceData.length,
      propName:     document.getElementById('propertyName')?.value?.trim() || '',
    });
    const body = document.getElementById('resultsBody');
    const section = document.getElementById('results');
    if (body && section) showErr(body, section, 'Calculation error — please check your data and try again.');
  } finally {
    // Always restore button and release the guard, even on error
    if (runBtn) { runBtn.disabled = false; runBtn.textContent = runBtnOrigText; runBtn.style.opacity = '1'; }
    isRunning = false;
  }
}

// Generic toast: bg defaults to green success, pass a hex color for other tones.
function showToast(msg, { color = '#166534', textColor = '#bbf7d0', duration = 3000 } = {}) {
  const toast = document.createElement('div');
  Object.assign(toast.style, {
    position: 'fixed', bottom: '28px', left: '50%',
    transform: 'translateX(-50%) translateY(12px)',
    opacity: '0',
    background: color, color: textColor, padding: '10px 22px',
    borderRadius: '8px', fontWeight: '600', fontSize: '0.9rem',
    boxShadow: '0 4px 20px rgba(0,0,0,0.4)', zIndex: '99999',
    transition: 'opacity 0.28s ease, transform 0.28s ease',
    pointerEvents: 'none', maxWidth: '90vw', textAlign: 'center',
  });
  toast.textContent = msg;
  document.body.appendChild(toast);
  requestAnimationFrame(() => {
    toast.style.transform = 'translateX(-50%) translateY(0)';
    toast.style.opacity = '1';
  });
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(-50%) translateY(10px)';
  }, duration - 350);
  setTimeout(() => { toast.remove(); }, duration);
}

function animateCAMResults(body, section) {
  // Slide the whole results section up from slightly below
  section.style.opacity = '0';
  section.style.transform = 'translateY(8px)';
  requestAnimationFrame(() => requestAnimationFrame(() => {
    section.style.transition = 'opacity 0.32s ease, transform 0.32s ease';
    section.style.opacity = '1';
    section.style.transform = 'translateY(0)';
    setTimeout(() => { section.style.transition = ''; section.style.transform = ''; }, 400);
  }));

  // Stagger each tenant card in, then pop the total amount
  const cards = body.querySelectorAll('.result-card');
  cards.forEach((card, i) => {
    card.style.opacity = '0';
    card.style.transform = 'translateY(12px)';
    setTimeout(() => {
      card.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
      card.style.opacity = '1';
      card.style.transform = 'translateY(0)';
      // Money pop: bounce the "Total" stat value once the card appears
      const totalEl = card.querySelector('.result-stat:first-child .stat-value');
      if (totalEl) {
        setTimeout(() => {
          totalEl.style.transition = 'transform 0.22s cubic-bezier(0.34,1.56,0.64,1)';
          totalEl.style.transform = 'scale(1.08)';
          setTimeout(() => { totalEl.style.transform = 'scale(1)'; }, 200);
        }, 120);
      }
    }, i * 80);
  });
}

// ─── Centralized Error Logging ───────────────────────────────────────────────
// Stores a ring-buffer of recent errors in localStorage for post-hoc debugging.
// Call: logError('saveProperty', err, { propId, invoiceCount })
const _ERR_KEY = 'mainstreet_errors_v1';
const _ERR_MAX = 50;

// In-memory lease extraction debug store — never persisted; reset on page reload.
const _leaseDebug = new Map();
// In-memory lease job store — source of truth for job state; async-synced to lease_jobs table.
const _leaseJobs  = new Map();

function logError(type, error, context = {}) {
  const entry = {
    type,
    message:  error?.message || String(error),
    stack:    (error?.stack || '').split('\n').slice(0, 6).join('\n'),
    ts:       new Date().toISOString(),
    propId:   context.propId   ?? activePropId ?? null,
    propName: context.propName ?? lastPropName  ?? null,
    ...context,
  };

  console.group(`%c[Mainstreet] ${type}`, 'color:#f87171;font-weight:700');
  console.error('Message:', entry.message);
  if (Object.keys(context).length) console.info('Context:', context);
  if (entry.stack) console.debug('Stack:\n' + entry.stack);
  console.groupEnd();

  try {
    const log = JSON.parse(localStorage.getItem(_ERR_KEY) || '[]');
    log.unshift(entry);
    if (log.length > _ERR_MAX) log.length = _ERR_MAX;
    localStorage.setItem(_ERR_KEY, JSON.stringify(log));
  } catch { /* quota — silently skip */ }
}

// Devtools helpers: window._msErrors.get() / .clear()
window._msErrors = {
  get:   ()  => { try { return JSON.parse(localStorage.getItem(_ERR_KEY) || '[]'); } catch { return []; } },
  clear: ()  => { try { localStorage.removeItem(_ERR_KEY); } catch {} },
  show:  ()  => { console.table(window._msErrors.get()); },
};

// ─── Regression Tests ─────────────────────────────────────────────────────────
// Run via browser console: window._msRunTests()
// Returns { passed, failed } — safe to run in production (no mutations to server).
function _msRunTests() {
  let passed = 0, failed = 0;
  const ok   = name      => { console.log(`  ✓ ${name}`); passed++; };
  const fail = (name, r) => { console.warn(`  ✗ ${name}: ${r}`); failed++; };

  console.group('[Mainstreet] Regression Tests');

  // ── 1. _stripBlobs preserves invoice amounts and strips File/raw text ────
  try {
    const raw = {
      invoices: [{
        id: 99, vendorName: 'ACME', amount: 999.99, category: 'utilities',
        _rawText: 'x'.repeat(5000),
        file:    new File([''], 'test.pdf'),
      }],
    };
    const stripped = _stripBlobs(raw);
    const inv = stripped.invoices[0];
    if (!inv)                       fail('stripBlobs: invoice survives strip', 'entry is null');
    else if (inv.vendorName !== 'ACME')   fail('stripBlobs: vendorName preserved', `got "${inv.vendorName}"`);
    else if (inv.amount !== 999.99)       fail('stripBlobs: amount preserved',    `got ${inv.amount}`);
    else if ('_rawText' in inv)           fail('stripBlobs: _rawText removed',     '_rawText still present');
    else if ('file'     in inv)           fail('stripBlobs: File removed',         'file still present');
    else ok('_stripBlobs preserves invoice data, removes blobs and raw text');
  } catch (e) { fail('_stripBlobs', e.message); }

  // ── 2. restoreResultsDisplay normalizes vendor from vendorName ───────────
  // This was a bug where tenant statements matched nothing after page reload.
  try {
    const _savedLR  = lastResults; const _savedLN  = lastPropName;
    const _savedLT  = lastTotal;   const _savedLIF = lastInvoicesFull;
    const _savedLS  = lastTenants;

    restoreResultsDisplay({
      results:     [{ name: 'T1', allocatedAmount: 500, proRata: 0.5, eligibleCount: 1, capApplied: false }],
      propName:    '__test__',
      total:       1000,
      invoices:    [],
      invoicesFull:[{ vendorName: 'ACME Corp', vendor: undefined, amount: 500, category: 'utilities' }],
      tenants:     [{ name: 'T1', excludedCategories: [] }],
    });

    const inv = lastInvoicesFull[0];
    if (!inv)                          fail('restoreResultsDisplay: invoicesFull populated', 'array empty');
    else if (inv.vendor !== 'ACME Corp') fail('restoreResultsDisplay: vendor normalized from vendorName', `got "${inv.vendor}"`);
    else                               ok('restoreResultsDisplay normalizes vendor field from vendorName');

    // Restore globals
    lastResults = _savedLR; lastPropName = _savedLN;
    lastTotal   = _savedLT; lastInvoicesFull = _savedLIF; lastTenants = _savedLS;
  } catch (e) { fail('restoreResultsDisplay vendor normalization', e.message); }

  // ── 3. localStorage roundtrip preserves invoice count and content ────────
  // Exercises _lsSave → _lsLoad to guard against serialization regressions.
  try {
    const TEST_ID = '__ms_regtest__';
    const testProp = {
      id: TEST_ID, name: 'Regression Test Prop', totalSqft: 5000,
      invoices: [
        { id: 1, vendorName: 'Vendor A', amount: 100.00, category: 'utilities' },
        { id: 2, vendorName: 'Vendor B', amount: 200.50, category: 'maintenance' },
      ],
      tenants: [], disputes: [], activityLog: [],
    };
    _lsSave(testProp);
    const loaded = _lsLoad(TEST_ID);

    // Clean up immediately — don't leave test data in storage
    try {
      const store = JSON.parse(localStorage.getItem(_LS_KEY) || '{}');
      delete store[TEST_ID];
      localStorage.setItem(_LS_KEY, JSON.stringify(store));
    } catch {}

    if (!loaded)                               fail('localStorage roundtrip: load returned null', 'null');
    else if (loaded.invoices?.length !== 2)    fail('localStorage roundtrip: invoice count preserved', `got ${loaded.invoices?.length}`);
    else if (loaded.invoices[0].amount !== 100) fail('localStorage roundtrip: invoice[0].amount', `got ${loaded.invoices[0].amount}`);
    else if (loaded.invoices[1].vendorName !== 'Vendor B') fail('localStorage roundtrip: invoice[1].vendorName', `got ${loaded.invoices[1].vendorName}`);
    else ok('localStorage roundtrip preserves invoice count and field values');
  } catch (e) { fail('localStorage roundtrip', e.message); }

  const status = failed === 0 ? '✓ All tests passed' : `${failed} test(s) FAILED`;
  console.log(`\n  ${status} (${passed} passed, ${failed} failed)`);
  console.groupEnd();
  return { passed, failed };
}
window._msRunTests = _msRunTests;

// Devtools helper: window._msLeaseDebug(indexOrId) — prints full debug object for a processed lease.
// Usage: _msLeaseDebug(0) for first card, _msLeaseDebug('uuid-...') by tenant ID or job ID.
window._msLeaseDebug = function(entryIdOrIndex) {
  let id;
  if (typeof entryIdOrIndex === 'number') {
    const d = tenantData[entryIdOrIndex];
    id = d?.id;
  } else {
    id = entryIdOrIndex;
  }

  const entry = id ? _leaseDebug.get(id) : null;
  const job   = id ? _leaseJobs.get(id)  : null;

  if (!entry && !job) {
    console.warn('[_msLeaseDebug] No data for:', entryIdOrIndex,
      '\n  _leaseDebug IDs:', [..._leaseDebug.keys()],
      '\n  _leaseJobs IDs:',  [..._leaseJobs.keys()]);
    return null;
  }

  const label = entry?.fileName || job?.file_name || String(entryIdOrIndex);
  console.group('[Mainstreet] Lease Debug — ' + label);

  if (job) {
    console.group('Job State');
    console.log('status:', job.status, '| stage:', job.stage, '| progress:', job.progress + '%');
    console.log('retry_count:', job.retry_count);
    if (job.processing_started_at)   console.log('started:', job.processing_started_at);
    if (job.processing_completed_at) console.log('completed:', job.processing_completed_at);
    if (job.error_message)           console.error('error_message:', job.error_message);
    if (job.debug_summary)           console.log('debug_summary:', job.debug_summary);
    console.groupEnd();
  }

  if (entry) {
    console.group('Extraction Detail');
    console.log('route:',      entry.extractionRoute);
    console.log('confidence:', entry.confidence?.level, '(' + (entry.confidence?.score ?? '?') + '/100)');
    if (entry.confidence?.reasons?.length) console.log('reasons:', entry.confidence.reasons.join('; '));
    console.log('meta:',         entry.meta);
    console.log('norm:',         entry.norm);
    console.log('rawExtracted:', entry.rawExtracted);
    if (entry.ocrText) console.log('ocrText (first 500):', entry.ocrText.slice(0, 500));
    if (entry.error)   console.error('error:', entry.error);
    console.groupEnd();
  }

  console.groupEnd();
  return { job, entry };
};

function showRunCompleteToast() {
  const existing = document.getElementById('camCompleteToast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.id = 'camCompleteToast';
  toast.textContent = '✓ CAM Reconciliation Complete';
  Object.assign(toast.style, {
    position: 'fixed', bottom: '28px', left: '50%',
    transform: 'translateX(-50%) translateY(12px)',
    opacity: '0',
    background: '#166534', color: '#bbf7d0', padding: '10px 22px',
    borderRadius: '8px', fontWeight: '600', fontSize: '0.9rem',
    boxShadow: '0 4px 20px rgba(0,0,0,0.4)', zIndex: '99999',
    transition: 'opacity 0.28s ease, transform 0.28s ease',
    pointerEvents: 'none',
  });
  document.body.appendChild(toast);
  requestAnimationFrame(() => {
    toast.style.transform = 'translateX(-50%) translateY(0)';
    toast.style.opacity = '1';
  });
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(-50%) translateY(10px)';
  }, 2650);
  setTimeout(() => { toast.remove(); }, 3100);
}

// ─── Step Progress Bar ────────────────────────────────────────────────────────

function updateStepBar(reached) {
  const steps = ['upload','calculate','review','resolve'];
  const idx   = steps.indexOf(reached);
  steps.forEach((s, i) => {
    const el = document.getElementById(`step-${s}`);
    if (!el) return;
    el.classList.remove('done', 'active');
    if (i < idx)  el.classList.add('done');
    if (i === idx) el.classList.add('active');
    const dot = el.querySelector('.step-dot');
    if (i < idx && dot) dot.innerHTML = '&#x2713;';
    if (i >= idx && dot) dot.textContent = i + 1;
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function showErr(body, section, msg) {
  body.innerHTML = `<div class="err-banner">${esc(msg)}</div>`;
  section.style.display = 'block';
  section.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ─── Previous Runs ────────────────────────────────────────────────────────────
function _fmtRunTs(ts) {
  return (ts instanceof Date ? ts : new Date(ts)).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function _prevRunDetailHtml(run) {
  return run.results.map(r => `
    <div class="result-card" style="padding:10px 14px;margin-bottom:6px;">
      <div class="r-name" style="font-size:0.88rem;">${esc(r.name)}</div>
      <div class="result-grid">
        ${stat('Allocated', fmt(r.allocatedAmount))}
        ${stat('Pro-Rata',  (r.proRata * 100).toFixed(2) + '%')}
        ${stat('Invoices',  r.eligibleCount + ' of ' + run.invoiceCount)}
      </div>
    </div>`).join('');
}

function renderPrevRunCard(run, camIdx) {
  return `
    <div class="prev-run-card">
      <div class="prev-run-meta">${_fmtRunTs(run.timestamp)}</div>
      <div class="prev-run-title">${run.camYear ? `${run.camYear} CAM — ` : ''}${esc(run.propName)}<span class="prev-run-latest-badge">Latest</span></div>
      <div class="prev-run-stats">
        <div class="prev-run-stat">Expenses: <strong>${fmt(run.totalExpenses)}</strong></div>
        <div class="prev-run-stat">Tenants: <strong>${run.tenantCount}</strong></div>
        <div class="prev-run-stat">Invoices: <strong>${run.invoiceCount}</strong></div>
      </div>
      <button class="prev-run-view-btn" onclick="togglePrevRunDetail(${camIdx})">&#x25BC; View Results</button>
      <div class="prev-run-detail" id="prev-run-detail-${camIdx}">
        ${_prevRunDetailHtml(run)}
      </div>
    </div>`;
}

function renderPrevRunHistItem(run, camIdx) {
  return `
    <div class="prev-run-hist-item">
      <div class="prev-run-hist-meta">${run.camYear ? `${run.camYear} CAM · ` : ''}${_fmtRunTs(run.timestamp)}</div>
      <div class="prev-run-hist-stats">
        <div class="prev-run-hist-stat">Expenses: <strong>${fmt(run.totalExpenses)}</strong></div>
        <div class="prev-run-hist-stat">Tenants: <strong>${run.tenantCount}</strong></div>
        <div class="prev-run-hist-stat">Invoices: <strong>${run.invoiceCount}</strong></div>
      </div>
      <button class="prev-run-view-btn" style="font-size:0.72rem;padding:4px 10px;" onclick="togglePrevRunDetail(${camIdx})">&#x25BC; View Results</button>
      <div class="prev-run-detail" id="prev-run-detail-${camIdx}">
        ${_prevRunDetailHtml(run)}
      </div>
    </div>`;
}

function renderPreviousRuns() {
  const sec  = document.getElementById('previousRunsSection');
  const list = document.getElementById('previousRunsList');
  if (camRuns.length < 2) { sec.style.display = 'none'; return; }
  sec.style.display = 'block';

  // Group historical runs (all but camRuns[0]) by property name, preserving DESC order
  const grouped = new Map();
  camRuns.slice(1).forEach((run, sliceIdx) => {
    const key = (run.propName || '').trim();
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push({ run, camIdx: sliceIdx + 1 });
  });

  // Sort groups by each property's most recent run, newest first
  const groups = [...grouped.entries()].sort(
    (a, b) => new Date(b[1][0].run.timestamp) - new Date(a[1][0].run.timestamp)
  );

  list.innerHTML = groups.map(([, entries], groupIdx) => {
    const primary = entries[0];
    const older   = entries.slice(1);
    return `
      <div class="prev-run-group">
        ${renderPrevRunCard(primary.run, primary.camIdx)}
        ${older.length ? `
          <button class="prev-run-toggle-btn" onclick="togglePrevRunGroup(${groupIdx}, this)">
            &#x25BC; Show previous runs (${older.length})
          </button>
          <div class="prev-run-hist-list" id="prhist-${groupIdx}">
            ${older.map(e => renderPrevRunHistItem(e.run, e.camIdx)).join('')}
          </div>` : ''}
      </div>`;
  }).join('');
}

function togglePrevRunGroup(groupIdx, btn) {
  const el = document.getElementById(`prhist-${groupIdx}`);
  if (!el) return;
  const open = el.classList.toggle('open');
  const count = el.querySelectorAll('.prev-run-hist-item').length;
  btn.innerHTML = open
    ? `&#x25B2; Hide previous runs (${count})`
    : `&#x25BC; Show previous runs (${count})`;
}

function togglePrevRunDetail(idx) {
  const el  = document.getElementById(`prev-run-detail-${idx}`);
  const btn = el ? el.previousElementSibling : null;
  if (!el) return;
  const open = el.style.display === 'block';
  el.style.display = open ? 'none' : 'block';
  if (btn) btn.innerHTML = open ? '&#x25BC; View Results' : '&#x25B2; Hide Results';
}

function fmt(n) {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function cleanHTML(text) {
  if (text === null || text === undefined) return '';
  const div = document.createElement('div');
  div.innerHTML = String(text);
  return div.textContent || div.innerText || '';
}

function esc(v) {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Convert a subset of markdown to safe HTML (HTML-escapes first, then renders).
function renderMarkdown(rawText) {
  let s = String(rawText || '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  s = s.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>');
  s = s.replace(/^#{1,3} +(.+)$/gm,'<span class="expl-hd">$1</span>');
  const lines = s.split('\n');
  const segs = [];
  let listItems = [];
  for (const line of lines) {
    const m = line.match(/^[-*] +(.+)$/);
    if (m) { listItems.push(`<li>${m[1]}</li>`); }
    else {
      if (listItems.length) { segs.push({ ul: true, html: `<ul class="expl-list">${listItems.join('')}</ul>` }); listItems = []; }
      segs.push({ ul: false, html: line });
    }
  }
  if (listItems.length) segs.push({ ul: true, html: `<ul class="expl-list">${listItems.join('')}</ul>` });
  let out = '';
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    if (seg.ul) { out += seg.html; }
    else { if (i > 0 && !segs[i-1].ul) out += '<br>'; out += seg.html; }
  }
  return out;
}

function stat(label, value) {
  return `<div class="result-stat">
    <div class="stat-label">${label}</div>
    <div class="stat-value">${value}</div>
  </div>`;
}

// ─── Explain Charge Panel ─────────────────────────────────────────────────────

function openExplainPanel(tenantName) {
  console.log('[openExplainPanel] ENTER', {
    tenantName,
    lastResultsLen:  lastResults.length,
    lastTenantsLen:  lastTenants.length,
    tenantDataLen:   tenantData.filter(Boolean).length,
    lastTenantsNames: lastTenants.map(x => x.name),
    lastResultsNames: lastResults.map(x => x.name),
  });

  const r = lastResults.find(x => x.name === tenantName);
  const t = lastTenants.find(x => x.name === tenantName);

  if (!r || !t) {
    console.warn('[openExplainPanel] GUARD 1 FAILED — missing r or t', {
      tenantName,
      rFound:         !!r,
      tFound:         !!t,
      lastResultsLen: lastResults.length,
      lastTenantsLen: lastTenants.length,
      lastTenantsNames: lastTenants.map(x => x.name),
      lastResultsNames: lastResults.map(x => x.name),
    });
    return;
  }

  console.log('[openExplainPanel] GUARD 1 passed', { tenantName, r, t });

  const td = tenantData.find(x => x && x.tenant_name === tenantName);
  if (!t.leasedSqft || !t.totalSqft || !td?.lease_type) {
    console.warn('[openExplainPanel] GUARD 2 — missing lease data (showing error panel)', {
      tenantName,
      leasedSqft:  t.leasedSqft,
      totalSqft:   t.totalSqft,
      tdFound:     !!td,
      leaseType:   td?.lease_type,
    });
    const panel = document.getElementById('explainPanel');
    const body  = document.getElementById('explainPanelBody');
    if (body) body.innerHTML = `<div class="rc-flags"><div class="rc-flags-title">&#x26A0;&#xFE0F; Cannot Generate Explanation</div><div class="rc-flag-item">Cannot generate explanation — missing required lease data (leased sqft, property sqft, or lease type).</div></div>`;
    if (panel) { panel.classList.add('open'); document.body.style.overflow = 'hidden'; }
    return;
  }

  console.log('[openExplainPanel] GUARD 2 passed — proceeding to render', { tenantName, leasedSqft: t.leasedSqft, totalSqft: t.totalSqft, leaseType: td.lease_type });

  const leasedSqft  = parseFloat(t.leasedSqft) || 0;
  const totalSqft   = parseFloat(t.totalSqft)  || 0;
  const totalCamAll = lastInvoicesFull.reduce((s, inv) => s + (parseFloat(inv.amount) || 0), 0);

  const eligible = lastInvoicesFull.filter(inv =>
    !t.excludedCategories.includes((inv.category || '').toLowerCase())
  );

  // Section 1 — Summary
  const adjHtml = r.capApplied
    ? `<div class="ep-adj">&#x26A0; Cap applied — your share reduced by ${fmt(r.capAdjustment)}</div>`
    : '';
  const exclHtml = t.excludedCategories.length
    ? `<div class="ep-excl">Excluded from your CAM: ${t.excludedCategories.join(', ')}</div>`
    : '';

  const s1 = `
    <div class="ep-section-title">Summary</div>
    <div class="ep-stat-grid">
      <div class="ep-stat">
        <div class="ep-stat-label">Your Sqft</div>
        <div class="ep-stat-value">${leasedSqft.toLocaleString()}</div>
      </div>
      <div class="ep-stat">
        <div class="ep-stat-label">Building Sqft</div>
        <div class="ep-stat-value">${totalSqft.toLocaleString()}</div>
      </div>
      <div class="ep-stat">
        <div class="ep-stat-label">Your % Share</div>
        <div class="ep-stat-value">${(r.proRata * 100).toFixed(2)}%</div>
      </div>
      <div class="ep-stat">
        <div class="ep-stat-label">Total CAM Pool</div>
        <div class="ep-stat-value">${fmt(totalCamAll)}</div>
      </div>
      <div class="ep-stat">
        <div class="ep-stat-label">Eligible Expenses</div>
        <div class="ep-stat-value">${fmt(eligible.reduce((s,i)=>s+(parseFloat(i.amount)||0),0))}</div>
      </div>
      <div class="ep-stat">
        <div class="ep-stat-label">Your CAM Charge</div>
        <div class="ep-stat-value highlight">${fmt(r.allocatedAmount)}</div>
      </div>
    </div>
    ${adjHtml}${exclHtml}`;

  // Section 2 — Category Breakdown
  const catMap = {};
  eligible.forEach(inv => {
    const cat = (inv.category || 'other').toLowerCase();
    if (!catMap[cat]) catMap[cat] = { total: 0, count: 0, invs: [] };
    const amt = parseFloat(inv.amount) || 0;
    catMap[cat].total += amt;
    catMap[cat].count++;
    catMap[cat].invs.push(inv);
  });

  const s2rows = Object.entries(catMap)
    .sort((a, b) => b[1].total - a[1].total)
    .map(([cat, data]) => {
      const yourShare = parseFloat((data.total * r.proRata).toFixed(2));
      return `
        <div class="ep-cat-row" id="epcat-${esc(cat.replace(/\s+/g,'-'))}"
          onclick="epToggleDrill('${esc(cat)}','${esc(tenantName)}')">
          <div>
            <div class="ep-cat-name">${esc(cat)}</div>
            <div class="ep-cat-meta">${data.count} invoice${data.count !== 1 ? 's' : ''}</div>
          </div>
          <div style="display:flex;align-items:center;">
            <div class="ep-cat-right">
              <div class="ep-cat-total">${fmt(data.total)}</div>
              <div class="ep-cat-share">Your CAM charge: ${fmt(yourShare)}</div>
            </div>
            <span class="ep-cat-chevron" id="epchev-${esc(cat.replace(/\s+/g,'-'))}">&#x25BC;</span>
          </div>
        </div>
        <div id="epdrill-${esc(cat.replace(/\s+/g,'-'))}" style="display:none;"></div>`;
    }).join('');

  const s2 = `<div class="ep-section-title">Category Breakdown — click to drill down</div>${s2rows}`;

  // Populate and open panel
  document.getElementById('explainPanelTitle').textContent    = tenantName;
  document.getElementById('explainPanelSubtitle').textContent = `CAM Charge Breakdown — ${lastPropName}`;
  document.getElementById('explainPanelBody').innerHTML = s1 + s2;
  document.getElementById('explainPanel').classList.add('open');
  document.body.style.overflow = 'hidden';
  console.log('[openExplainPanel] PANEL OPENED', { tenantName, panelClasses: document.getElementById('explainPanel').className });
}

function epToggleDrill(category, tenantName) {
  console.log('[epToggleDrill] ENTER', { category, tenantName, lastTenantsLen: lastTenants.length, lastResultsLen: lastResults.length });

  const t = lastTenants.find(x => x.name === tenantName);
  const r = lastResults.find(x => x.name === tenantName);

  if (!t || !r) {
    console.warn('[epToggleDrill] GUARD 1 FAILED — missing t or r', {
      category, tenantName,
      tFound: !!t, rFound: !!r,
      lastTenantsLen: lastTenants.length,
      lastResultsLen: lastResults.length,
    });
    return;
  }

  const slug    = category.replace(/\s+/g, '-');
  const drillEl = document.getElementById(`epdrill-${slug}`);
  const chevEl  = document.getElementById(`epchev-${slug}`);
  const rowEl   = document.getElementById(`epcat-${slug}`);

  if (!drillEl) {
    console.warn('[epToggleDrill] GUARD 2 FAILED — drillEl not found', { slug, id: `epdrill-${slug}` });
    return;
  }

  const open = drillEl.style.display === 'block';
  drillEl.style.display = open ? 'none' : 'block';
  if (chevEl) chevEl.innerHTML = open ? '&#x25BC;' : '&#x25B2;';
  if (rowEl)  rowEl.classList.toggle('active', !open);
  if (open)   return;

  // Build drill-down invoice list for this category
  const invs = lastInvoicesFull.filter(inv =>
    !t.excludedCategories.includes((inv.category || '').toLowerCase()) &&
    (inv.category || 'other').toLowerCase() === category.toLowerCase()
  );

  console.log('[epToggleDrill] building drill for', { category, tenantName, invCount: invs.length, sampleInv: invs[0], invoiceDataLen: invoiceData.length });

  drillEl.innerHTML = `<div class="ep-drill">${
    invs.map(inv => {
      const vendorKey = (inv.vendor || inv.vendorName || '').toLowerCase();
      const stored = invoiceData.find(d =>
        d.vendorName && d.vendorName.toLowerCase() === vendorKey
      );
      console.log('[epToggleDrill] inv match', { vendor: inv.vendor, vendorName: inv.vendorName, vendorKey, storedFound: !!stored, fileUrl: stored?.fileUrl ? 'PRESENT' : 'MISSING' });
      const viewBtn = stored && stored.fileUrl
        ? `<button class="ep-view-inv-btn" onclick="viewInvFile(${invoiceData.indexOf(stored)})">&#x1F4C4; View Source Invoice</button>`
        : '';
      return `
      <div class="ep-inv-row">
        <div>
          <div class="ep-inv-vendor">${esc(inv.vendor || inv.vendorName || '—')}</div>
          <div class="ep-inv-date">${esc(inv.invoiceDate || '—')}</div>
          ${viewBtn}
        </div>
        <div class="ep-inv-amount">${fmt(parseFloat(inv.amount) || 0)}</div>
      </div>`;
    }).join('')
  }</div>`;
}

function closeExplainPanel() {
  document.getElementById('explainPanel').classList.remove('open');
  document.body.style.overflow = '';
  document.body.classList.remove('modal-open');
}

// ─── Tenant Detail Panel ──────────────────────────────────────────────────────

function _tdpDisputeBadge(status) {
  const map = {
    open:           { cls: 'open',     label: 'Open' },
    docs_requested: { cls: 'review',   label: 'Under Review' },
    accepted:       { cls: 'resolved', label: 'Resolved' },
    rejected:       { cls: 'rejected', label: 'Rejected' },
  };
  const cfg = map[status] || { cls: 'open', label: status || 'Open' };
  return `<span class="tdp-dispute-badge ${cfg.cls}">${cfg.label}</span>`;
}

function _tdpDisputesHtml(tenantName) {
  if (!tenantName) return `<div class="tdp-empty-disputes">No disputes for this tenant.</div>`;

  const tenantDisputes = disputes.filter(d => d.tenantName === tenantName);
  if (!tenantDisputes.length) {
    return `<div class="tdp-empty-disputes">No disputes for this tenant.</div>`;
  }

  function _ts(iso) {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
    } catch (e) { return ''; }
  }

  return tenantDisputes.map(d => {
    const isResolved = d.status === 'accepted';
    const isRejected = d.status === 'rejected';
    const cardCls    = isResolved ? ' is-resolved' : isRejected ? ' is-rejected' : '';

    const amountStr  = (d.tenantShare !== null && d.tenantShare !== undefined && !isNaN(d.tenantShare))
      ? fmt(parseFloat(d.tenantShare))
      : '—';
    const vendor     = d.vendor   || 'Unknown vendor';
    const category   = d.category || 'Unknown category';
    const reason     = d.reason   || '(no reason given)';
    const docHtml    = d.docName
      ? `<div style="font-size:0.73rem;color:#4ade80;margin:4px 0 8px;font-family:'DM Mono',monospace;">&#x1F4CE; ${esc(d.docName)}</div>`
      : '';

    const resolvedTs = (d.resolvedAt && (isResolved || isRejected))
      ? `<div style="font-size:0.73rem;color:#64748B;margin-top:4px;">${isResolved ? 'Resolved' : 'Rejected'} · ${_ts(d.resolvedAt)}</div>`
      : '';

    const actionHtml = (isResolved || isRejected) ? '' : `
      <div class="tdp-dc-actions">
        <button class="tdp-dc-btn" onclick="event.stopPropagation();showToast('Invoice viewer — coming soon',{color:'#1e3a5f',textColor:'#93c5fd'})">View Invoice</button>
        <button class="tdp-dc-btn" onclick="event.stopPropagation();showToast('Lease clause viewer — coming soon',{color:'#1e3a5f',textColor:'#93c5fd'})">View Lease Clause</button>
        <button class="tdp-dc-btn resolve" onclick="event.stopPropagation();showToast('Dispute resolution — coming soon',{color:'#1e3a5f',textColor:'#93c5fd'})">Resolve Dispute</button>
      </div>`;

    return `
      <div class="tdp-dispute-card${cardCls}">
        <div class="tdp-dc-header">
          <div class="tdp-dc-title">${esc(vendor)} &middot; ${esc(category)}</div>
          ${_tdpDisputeBadge(d.status)}
        </div>
        <div class="tdp-dc-meta">${amountStr}${d.timestamp ? ' &middot; Opened ' + _ts(d.timestamp) : ''}</div>
        <div class="tdp-dc-reason">&ldquo;${esc(reason)}&rdquo;</div>
        ${docHtml}
        ${resolvedTs}
        ${actionHtml}
      </div>`;
  }).join('');
}

function openTenantDetailPanel(i) {
  const d = tenantData[i];
  if (!d || d.status === 'pending') return;

  const panel    = document.getElementById('tenantDetailPanel');
  const titleEl  = document.getElementById('tdpTitle');
  const subEl    = document.getElementById('tdpSubtitle');
  const bodyEl   = document.getElementById('tdpBody');
  if (!panel || !bodyEl) return;

  // Match by tenantId (stable) if reconciliation has run, else no recon data
  const recon = lastResults.find(r => r.tenantId === d.id) || null;

  const _v  = (val, fallback = '—') => (val !== null && val !== undefined && val !== '') ? val : fallback;
  const _pct = (val) => (val !== null && val !== undefined && !isNaN(val))
    ? parseFloat(val).toFixed(2) + '%' : '—';
  const _fmt = (n) => (n !== null && n !== undefined && !isNaN(n))
    ? '$' + parseFloat(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '—';

  const confLevel = d._confidence || (d.extractionFailed ? 'failed' : d._needsReview ? 'medium' : null);
  const badgeHtml = _confidenceBadgeHtml(confLevel);

  const name    = d.tenant_name || '(unknown)';
  const sqft    = d.leased_sqft ? Number(d.leased_sqft).toLocaleString('en-US') + ' sqft' : null;
  const capPct  = d.cap ?? null;

  // Pro-rata: prefer live recon value (most accurate), fall back to lease-level cap
  const proRataPct = recon
    ? _pct(recon.proRataPercent)
    : '—';

  const allocatedCam  = recon ? _fmt(recon.totalAllocated) : null;
  const invoiceCount  = recon ? recon.includedInvoices.length : null;

  titleEl.textContent = name;
  subEl.textContent   = d.lease_type || '';

  bodyEl.innerHTML = `
    <div class="tdp-name-row">
      <span class="tdp-tenant-name">${esc(name)}</span>
      ${badgeHtml}
    </div>

    <div class="tdp-section">Lease Info</div>
    <div class="tdp-grid">
      <div class="tdp-stat">
        <div class="tdp-stat-label">Lease Type</div>
        <div class="tdp-stat-value${!d.lease_type ? ' tdp-null' : ''}">${esc(_v(d.lease_type))}</div>
      </div>
      <div class="tdp-stat">
        <div class="tdp-stat-label">Leased Sqft</div>
        <div class="tdp-stat-value${!d.leased_sqft ? ' tdp-null' : ''}">${esc(sqft || '—')}</div>
      </div>
      <div class="tdp-stat">
        <div class="tdp-stat-label">Start Date</div>
        <div class="tdp-stat-value${!d.start_date ? ' tdp-null' : ''}">${esc(_v(d.start_date))}</div>
      </div>
      <div class="tdp-stat">
        <div class="tdp-stat-label">End Date</div>
        <div class="tdp-stat-value${!d.end_date ? ' tdp-null' : ''}">${esc(_v(d.end_date))}</div>
      </div>
      <div class="tdp-stat">
        <div class="tdp-stat-label">CAM Cap</div>
        <div class="tdp-stat-value${capPct === null ? ' tdp-null' : ''}">${capPct !== null ? capPct + '%' : '—'}</div>
      </div>
      <div class="tdp-stat">
        <div class="tdp-stat-label">Pro-Rata %</div>
        <div class="tdp-stat-value tdp-highlight">${proRataPct}</div>
      </div>
    </div>

    ${recon ? `
    <div class="tdp-section">CAM Reconciliation</div>
    <div class="tdp-grid">
      <div class="tdp-stat">
        <div class="tdp-stat-label">Allocated CAM</div>
        <div class="tdp-stat-value tdp-highlight">${allocatedCam}</div>
      </div>
      <div class="tdp-stat">
        <div class="tdp-stat-label">Invoice Count</div>
        <div class="tdp-stat-value">${invoiceCount}</div>
      </div>
      ${recon.capApplied ? `
      <div class="tdp-stat tdp-wide">
        <div class="tdp-stat-label">Cap Applied</div>
        <div class="tdp-stat-value">Cap reduced charge by ${_fmt(recon.capAdjustment)}</div>
      </div>` : ''}
    </div>` : `
    <div class="tdp-section">CAM Reconciliation</div>
    <div class="tdp-no-recon">Run reconciliation to see CAM totals and invoice breakdown.</div>`}

    <div class="tdp-section">Disputes</div>
    ${_tdpDisputesHtml(d.tenant_name)}
  `;

  document.body.style.overflow = 'hidden';
  panel.classList.add('open');
}

function closeTenantDetailPanel() {
  const panel = document.getElementById('tenantDetailPanel');
  if (panel) panel.classList.remove('open');
  document.body.style.overflow = '';
}

// ─── Lease Viewer ─────────────────────────────────────────────────────────────

// Primary: open lease in the in-app modal viewer.
function openLease(file) {
  openLeaseModal(file);
}

// Entry point for all inline onclick buttons.
function openLeaseModalFromFile(index) {
  const d = tenantData[index];
  if (!d) return;
  if (d.leaseFile instanceof File) {
    openLeaseModal(d.leaseFile);
  } else if (d.leaseUrl) {
    openLeaseModal(d.leaseUrl);
  }
}

// Modal viewer — accepts a File object (local) or a URL string (persisted).
function openLeaseModal(fileOrUrl) {
  if (!fileOrUrl) return;
  const modal = document.getElementById('leaseViewerModal');
  const frame = document.getElementById('leaseViewerFrame');
  const title = document.getElementById('leaseViewerTitle');

  let url, titleText, isBlob;
  if (typeof fileOrUrl === 'string') {
    url       = fileOrUrl;
    titleText = 'Lease Document';
    isBlob    = false;
  } else {
    url       = URL.createObjectURL(fileOrUrl);
    titleText = fileOrUrl.name || 'Lease Document';
    isBlob    = true;
  }

  modal._leaseUrl = url;
  modal._isBlob   = isBlob;
  if (title) title.textContent = titleText;
  frame.src = url;
  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closeLeaseModal() {
  const modal = document.getElementById('leaseViewerModal');
  const frame = document.getElementById('leaseViewerFrame');
  if (frame) { frame.onload = null; frame.src = ''; }
  if (modal) {
    modal.style.display = 'none';
    if (modal._leaseUrl && modal._isBlob) {
      URL.revokeObjectURL(modal._leaseUrl);
    }
    modal._leaseUrl = null;
    modal._isBlob   = false;
  }
  document.body.style.overflow = '';
}

function leaseViewerOpenExternal() {
  const modal = document.getElementById('leaseViewerModal');
  if (modal?._leaseUrl) window.open(modal._leaseUrl, '_blank');
}

// ESC key always closes modal — user can never be trapped
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeLeaseModal();
});

// Global click diagnostic — reports what element received the click and any blocking overlays
document.addEventListener('click', (e) => {
  const path = e.composedPath ? e.composedPath() : [];
  const topEl = path[0] || e.target;

  // Check every fixed/absolute overlay that could be covering content
  const overlayIds = ['explainPanel','leaseViewerModal','allocModal','reportOverlay','invFileViewer','loginScreen'];
  const overlayState = overlayIds.map(id => {
    const el = document.getElementById(id);
    if (!el) return `${id}:MISSING`;
    const s = window.getComputedStyle(el);
    return `${id}:display=${s.display},vis=${s.visibility},pe=${s.pointerEvents}`;
  });

  console.log('[CLICK PROBE]', {
    target:          e.target?.id || e.target?.className || e.target?.tagName,
    composedPath0:   topEl?.id || topEl?.className || topEl?.tagName,
    composedPathLen: path.length,
    pathIds:         path.slice(0,8).map(el => el.id || el.className || el.tagName || '?'),
    clientXY:        `${e.clientX},${e.clientY}`,
    elementAtPoint:  document.elementFromPoint(e.clientX, e.clientY)?.id
                     || document.elementFromPoint(e.clientX, e.clientY)?.className
                     || document.elementFromPoint(e.clientX, e.clientY)?.tagName,
    overlays:        overlayState,
    bodyOverflow:    document.body.style.overflow,
    bodyPE:          window.getComputedStyle(document.body).pointerEvents,
  });
}, true); // capture phase so we see it before any stopPropagation

// Delegated retry handler — survives innerHTML re-renders.
// Uses retryLeaseJob (in-memory file) when available; falls back to file picker.
document.addEventListener('click', (e) => {
  const retryEl = e.target.closest('[data-retry]');
  if (!retryEl) return;
  e.stopPropagation();
  const i     = parseInt(retryEl.dataset.index, 10);
  const jobId = retryEl.dataset.jobId;
  if (jobId && _leaseJobs.get(jobId)?._file) {
    retryLeaseJob(jobId);
  } else {
    retryUploadForSlot(i);
  }
});

// Mousedown diagnostic — fires before click; confirms the pointer event is reaching the DOM
document.addEventListener('mousedown', (e) => {
  const el = document.elementFromPoint(e.clientX, e.clientY);
  console.log('[MOUSEDOWN PROBE]', {
    target:         e.target?.id || e.target?.className || e.target?.tagName,
    elementAtPoint: el?.id || el?.className || el?.tagName,
    clientXY:       `${e.clientX},${e.clientY}`,
  });
}, true);

// Clicking the dark backdrop closes modal
document.getElementById('leaseViewerModal')?.addEventListener('click', (e) => {
  if (e.target.id === 'leaseViewerModal') closeLeaseModal();
});

// ─── Report State ─────────────────────────────────────────────────────────────
const camRuns    = []; // previous run history
let lastResults  = []; // ReconciliationResult[] — unified with lastFullResults

// ─── CAM Year ─────────────────────────────────────────────────────────────────
let _camYear = (() => {
  const stored = localStorage.getItem('camYear');
  return stored ? parseInt(stored, 10) : new Date().getFullYear();
})();
function getCamYear() { return _camYear; }
function setCamYear(y) {
  _camYear = parseInt(y, 10) || new Date().getFullYear();
  localStorage.setItem('camYear', _camYear);
}
function initCamYearSelect() {
  const sel = document.getElementById('camYearSelect');
  if (!sel) return;
  const cur = new Date().getFullYear();
  sel.innerHTML = '';
  for (let yr = cur - 3; yr <= cur + 1; yr++) {
    const opt = document.createElement('option');
    opt.value = yr;
    opt.textContent = `${yr} CAM`;
    if (yr === _camYear) opt.selected = true;
    sel.appendChild(opt);
  }
}
let sqftMismatch   = false;
let isEditingField = false; // true while a text/number/date input has focus
let isRunning      = false; // guard against concurrent runAllocation() calls

function applySqftMismatchUI(mismatch) {
  sqftMismatch = mismatch;
}

function fixSqftToMatch(leaseTotalSqft) {
  const sqftInput = document.getElementById('totalSqft');
  if (sqftInput) {
    sqftInput.value = leaseTotalSqft;
    updatePropertySqft(leaseTotalSqft);
  }
  showToast(`Property sqft updated to ${Number(leaseTotalSqft).toLocaleString()} sqft`);
  rerunAfterWarning();
}

function rerunAfterWarning() {
  document.querySelectorAll('.sqft-mismatch-banner').forEach(el => el.remove());
  setTimeout(() => runAllocation(), 50);
}
let lastPropName = '';
let lastTotal    = 0;
let lastInvoicesFull = []; // full invoice list with category sums
let lastFullResults  = []; // ReconciliationResult[] from runFullReconciliation

// ─── Dispute State ────────────────────────────────────────────────────────────
let lastInvoices = []; // [{ id, vendor, category, amount }]
let lastTenants  = []; // [{ name, excludedCategories }]
const disputes   = []; // [{ id, tenantName, invoiceId, vendor, category, tenantShare, reason, timestamp, status, resolution, resolvedAt, hash }]
let nextDisputeId = 0;

// ─── Activity Log ─────────────────────────────────────────────────────────────
const activityLog = []; // { type, title, detail, severity, timestamp, actor, relatedEntity, financialImpact }

function logActivity(type, title, { detail = '', severity = 'info', actor = 'System', relatedEntity = '', financialImpact = '' } = {}) {
  activityLog.unshift({
    type, title, detail, severity,
    timestamp:     new Date().toISOString(),
    actor,
    relatedEntity,
    financialImpact,
  });
  if (activityLog.length > 200) activityLog.length = 200;
  savePropertyData(); // persist change — debounced, so rapid events collapse
}

// ─── Checkpoint System ────────────────────────────────────────────────────────
const _CP_KEY = 'mainstreet_ckpt_v1';
const _checkpoints = {};

function _loadCheckpoints() {
  try {
    const raw = localStorage.getItem(_CP_KEY);
    if (raw) Object.assign(_checkpoints, JSON.parse(raw));
  } catch (e) { }
}

function _saveCheckpoints() {
  try {
    localStorage.setItem(_CP_KEY, JSON.stringify(_checkpoints));
  } catch (e) {
    // quota exceeded — trim to 2 per property and retry
    Object.keys(_checkpoints).forEach(id => {
      if (_checkpoints[id].length > 2) _checkpoints[id].length = 2;
    });
    try { localStorage.setItem(_CP_KEY, JSON.stringify(_checkpoints)); } catch (_) { }
  }
}

function captureCheckpoint(propId, label) {
  if (!propId) return;
  const prop = _props.find(p => p.id === propId);
  if (!prop) return;
  if (!_checkpoints[propId]) _checkpoints[propId] = [];
  try {
    const snap = _stripBlobs({
      ...prop,
      tenants:     [...(prop.tenants     || [])],
      invoices:    [...(prop.invoices    || [])],
      disputes:    [...(prop.disputes    || [])],
      activityLog: [...activityLog],
    });
    _checkpoints[propId].unshift({ ts: new Date().toISOString(), label, snapshot: snap });
    if (_checkpoints[propId].length > 5) _checkpoints[propId].length = 5;
    _saveCheckpoints();
  } catch (e) { console.warn('[captureCheckpoint] failed:', e.message); }
}

// ─── Sync Status ──────────────────────────────────────────────────────────────
let _syncStatus = 'idle';
let _lastSyncAt = null;

function _setSyncStatus(status) {
  _syncStatus = status;
  if (status === 'synced') _lastSyncAt = new Date();
  _renderSyncIndicator();
}

function _renderSyncIndicator() {
  const el = document.getElementById('syncIndicator');
  if (!el) return;
  const cfgMap = {
    idle:     { cls: '',             icon: '',  label: '' },
    pending:  { cls: 'si-pending',   icon: '◌', label: 'Saving…' },
    synced:   { cls: 'si-synced',    icon: '✓', label: 'Synced' },
    error:    { cls: 'si-error',     icon: '⚠', label: 'Local only' },
    conflict: { cls: 'si-conflict',  icon: '⚡', label: 'Conflict' },
    recovery: { cls: 'si-recovery',  icon: '↩', label: 'Recovery available' },
  };
  const cfg = cfgMap[_syncStatus] || { cls: '', icon: '', label: '' };
  const ts = _lastSyncAt
    ? `Last synced ${_lastSyncAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
    : '';
  el.className = `sync-indicator${cfg.cls ? ' ' + cfg.cls : ''}`;
  el.title = ts;
  el.innerHTML = cfg.label
    ? `<span class="si-icon">${cfg.icon}</span><span class="si-label">${cfg.label}</span>`
    : '';
}

// ─── Integrity Checks ────────────────────────────────────────────────────────
function checkIntegrity(prop) {
  const issues = [];
  if (!prop) return issues;

  const results  = (prop.camReconciliation ?? prop.results)?.results || [];
  const invoices = prop.invoices || [];
  const tenants  = prop.tenants  || [];
  const disps    = prop.disputes || [];

  // 1. Allocation sums — each tenant share should be ≤ total CAM
  if (results.length) {
    const totalCam = results.reduce((s, r) => s + (parseFloat(r.tenantShare) || 0), 0);
    const declared = (prop.camReconciliation ?? prop.results)?.total || 0;
    if (declared && Math.abs(totalCam - declared) > 1) {
      issues.push({
        type:    'allocation_mismatch',
        level:   'error',
        message: `Allocated total (${fmt(totalCam)}) differs from declared total (${fmt(declared)}) by ${fmt(Math.abs(totalCam - declared))}`,
      });
    }
  }

  // 2. Invoice total integrity — sum of amounts should be positive
  const invoiceTotal = invoices.reduce((s, inv) => s + (parseFloat(inv.amount) || 0), 0);
  if (invoices.length && invoiceTotal <= 0) {
    issues.push({ type: 'invalid_invoice_total', level: 'error', message: 'Invoice total is zero or negative — check uploaded amounts.' });
  }

  // 3. Orphaned invoices — invoices with no category assignment
  const orphaned = invoices.filter(inv => !inv.category || inv.category === 'Uncategorized');
  if (orphaned.length) {
    issues.push({ type: 'orphaned_invoices', level: 'warning', message: `${orphaned.length} invoice${orphaned.length > 1 ? 's' : ''} have no category assignment.` });
  }

  // 4. Missing tenant mappings — results rows with no matching tenant
  if (results.length && tenants.length) {
    const tenantNames = new Set(tenants.map(t => (t.tenant_name || '').toLowerCase()));
    const unmapped = results.filter(r => !tenantNames.has((r.tenantName || '').toLowerCase()));
    if (unmapped.length) {
      issues.push({ type: 'missing_tenant_mapping', level: 'warning', message: `${unmapped.length} reconciliation row${unmapped.length > 1 ? 's' : ''} have no matching tenant record.` });
    }
  }

  // 5. Duplicate tenant IDs
  if (tenants.length) {
    const ids = tenants.map(t => t.id).filter(Boolean);
    const dups = ids.filter((id, i) => ids.indexOf(id) !== i);
    if (dups.length) {
      issues.push({ type: 'duplicate_tenant_ids', level: 'error', message: `${dups.length} duplicate tenant ID${dups.length > 1 ? 's' : ''} detected.` });
    }
  }

  // 6. Invalid pro-rata (any tenant with leased_sqft > property sqft)
  if (prop.totalSqft) {
    const oversized = tenants.filter(t => (parseFloat(t.leased_sqft) || 0) > (prop.totalSqft || Infinity));
    if (oversized.length) {
      issues.push({ type: 'invalid_prorata', level: 'error', message: `${oversized.length} tenant${oversized.length > 1 ? 's have' : ' has'} leased sqft exceeding property total.` });
    }
  }

  // 7. Open disputes with no resolution path
  const openDisps = disps.filter(d => d.status === 'open');
  if (openDisps.length) {
    issues.push({ type: 'open_disputes', level: 'warning', message: `${openDisps.length} open dispute${openDisps.length > 1 ? 's' : ''} require resolution.` });
  }

  // 8. Partial reconciliation state — invoices exist but no CAM run
  if (invoices.length && !results.length && tenants.length) {
    issues.push({ type: 'partial_reconciliation', level: 'warning', message: 'Invoices and tenants are loaded but no CAM reconciliation has been run.' });
  }

  return issues;
}

// ─── Recovery Modal ──────────────────────────────────────────────────────────
function openRecoveryModal() {
  const prop = _props.find(p => p.id === activePropId);
  let modal = document.getElementById('recoveryModal');
  if (!modal) return;
  _buildRecoveryModalBody(prop);
  modal.style.display = 'flex';
}

function closeRecoveryModal() {
  const modal = document.getElementById('recoveryModal');
  if (modal) modal.style.display = 'none';
}

function _buildRecoveryModalBody(prop) {
  const body = document.getElementById('recoveryModalBody');
  if (!body) return;

  const cpList = _checkpoints[prop?.id] || [];
  const issues = prop ? checkIntegrity(prop) : [];
  const errors  = issues.filter(i => i.level === 'error');
  const warnings = issues.filter(i => i.level === 'warning');

  // ── Sync status section ──
  const syncHtml = `
    <div class="rc-section">
      <div class="rc-section-title">Sync Status</div>
      <div class="rc-sync-row">
        <span class="rc-sync-dot rc-sync-dot--${_syncStatus}"></span>
        <span class="rc-sync-label">${{
          idle:     'Idle',
          pending:  'Save in progress…',
          synced:   'Cloud synced' + (_lastSyncAt ? ` · ${_lastSyncAt.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})}` : ''),
          error:    'Sync failed — data saved locally only',
          conflict: 'Conflict detected',
          recovery: 'Recovery available',
        }[_syncStatus] || _syncStatus}</span>
      </div>
    </div>`;

  // ── Integrity section ──
  let integrityRows = '';
  if (issues.length === 0) {
    integrityRows = '<div class="rc-integrity-ok">✓ No integrity issues found</div>';
  } else {
    integrityRows = issues.map(iss => `
      <div class="rc-issue rc-issue--${iss.level}">
        <span class="rc-issue-icon">${iss.level === 'error' ? '✕' : '⚠'}</span>
        <span class="rc-issue-msg">${iss.message}</span>
      </div>`).join('');
  }
  const integrityHtml = `
    <div class="rc-section">
      <div class="rc-section-title">Data Integrity
        <span class="rc-badge ${errors.length ? 'rc-badge--error' : warnings.length ? 'rc-badge--warn' : 'rc-badge--ok'}">
          ${errors.length ? errors.length + ' error' + (errors.length > 1 ? 's' : '') : warnings.length ? warnings.length + ' warning' + (warnings.length > 1 ? 's' : '') : 'Clean'}
        </span>
      </div>
      ${integrityRows}
      ${issues.length ? `<button class="rc-action-btn" onclick="rebuildReconciliationState()">↺ Rebuild Reconciliation State</button>` : ''}
    </div>`;

  // ── Checkpoints section ──
  let cpRows = '';
  if (cpList.length === 0) {
    cpRows = '<div class="rc-no-cp">No checkpoints saved yet. Checkpoints are captured automatically before major operations.</div>';
  } else {
    cpRows = cpList.map((cp, i) => {
      const d = new Date(cp.ts);
      const label = cp.label || 'Checkpoint';
      const ts = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
               + ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      return `
        <div class="rc-cp-row">
          <div class="rc-cp-info">
            <span class="rc-cp-label">${label}</span>
            <span class="rc-cp-ts">${ts}</span>
          </div>
          <button class="rc-restore-btn" onclick="restoreCheckpoint(${i})">Restore</button>
        </div>`;
    }).join('');
  }
  const cpHtml = `
    <div class="rc-section">
      <div class="rc-section-title">Checkpoint History <span class="rc-cp-count">${cpList.length}/5</span></div>
      ${cpRows}
    </div>`;

  // ── Export section ──
  const exportHtml = `
    <div class="rc-section">
      <div class="rc-section-title">Export Backup</div>
      <p class="rc-export-desc">Download a full JSON backup of this property's data (invoices, tenants, reconciliation, disputes, activity log).</p>
      <button class="rc-action-btn rc-export-btn" onclick="exportPropertyBackup()">⬇ Export Property Backup</button>
    </div>`;

  body.innerHTML = syncHtml + integrityHtml + cpHtml + exportHtml;
}

function restoreCheckpoint(index) {
  const cpList = _checkpoints[activePropId];
  if (!cpList || !cpList[index]) return;
  const cp = cpList[index];
  const d  = new Date(cp.ts);
  const ts = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' at ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (!confirm(`Restore checkpoint "${cp.label}" from ${ts}?\n\nThis will overwrite current unsaved changes.`)) return;

  const snap = cp.snapshot;
  const propIdx = _props.findIndex(p => p.id === activePropId);
  if (propIdx === -1) return;

  Object.assign(_props[propIdx], snap);
  closeRecoveryModal();

  // Reload UI from restored snapshot
  renderProperty(_props[propIdx]);
  _setSyncStatus('pending');
  savePropertyData();

  const banner = document.createElement('div');
  banner.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:9999;background:#1e3a5f;color:#93c5fd;padding:10px 20px;border-radius:10px;font-size:0.85rem;font-weight:600;box-shadow:0 4px 20px rgba(0,0,0,.5);pointer-events:none;white-space:nowrap;';
  banner.textContent = `↩ Checkpoint restored — ${cp.label}`;
  document.body.appendChild(banner);
  setTimeout(() => banner.remove(), 4000);
}

function exportPropertyBackup() {
  const prop = _props.find(p => p.id === activePropId);
  if (!prop) return;
  const backup = {
    exportedAt: new Date().toISOString(),
    appVersion: 'mainstreet-v1',
    property:   _stripBlobs({ ...prop, activityLog: [...activityLog] }),
    checkpoints: _checkpoints[activePropId] || [],
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  const safeName = (prop.name || 'property').replace(/[^a-z0-9]/gi, '_').toLowerCase();
  a.href = url;
  a.download = `mainstreet_backup_${safeName}_${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function rebuildReconciliationState() {
  const prop = _props.find(p => p.id === activePropId);
  if (!prop) return;
  closeRecoveryModal();
  // Reload the property to re-hydrate all globals from canonical storage
  renderProperty(prop);
  // Re-run if results exist
  if ((prop.camReconciliation ?? prop.results)?.results?.length) {
    restoreResults(prop);
  }
  const banner = document.createElement('div');
  banner.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:9999;background:#134e4a;color:#99f6e4;padding:10px 20px;border-radius:10px;font-size:0.85rem;font-weight:600;box-shadow:0 4px 20px rgba(0,0,0,.5);pointer-events:none;white-space:nowrap;';
  banner.textContent = '↺ Reconciliation state rebuilt from saved data';
  document.body.appendChild(banner);
  setTimeout(() => banner.remove(), 4000);
}

// ─── Executive Review Mode ───────────────────────────────────────────────────
const _RV_KEY = 'mainstreet_review_v1';
let _reviewMode = false;

function _rvLoad() {
  try { return JSON.parse(localStorage.getItem(_RV_KEY) || '{}'); } catch { return {}; }
}
function _rvSave(tokens) {
  try { localStorage.setItem(_RV_KEY, JSON.stringify(tokens)); } catch {}
}
function _genUUID() {
  return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
    (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16));
}

function generateReviewToken(expiresIn) { // expiresIn: 7, 30, or 0 = never
  try {
  const prop = _props.find(p => p.id === activePropId);
  if (!prop || !lastResults.length) return null;
  const token     = _genUUID();
  const now       = new Date();
  const expiresAt = expiresIn ? new Date(now.getTime() + expiresIn * 86400000).toISOString() : null;
  const payload   = {
    token, expiresAt,
    propId:    prop.id,
    propName:  lastPropName || prop.name,
    camYear:   getCamYear(),
    createdAt: now.toISOString(),
    snapshot:  _stripBlobs({
      propName:    lastPropName || prop.name,
      propId:      prop.id,
      totalSqft:   prop.totalSqft,
      camYear:     getCamYear(),
      results:     [...lastResults],
      total:       lastTotal,
      invoices:    [...lastInvoices],
      invoicesFull:[...lastInvoicesFull],
      tenants:     [...lastTenants],
      camRuns:     camRuns.map(r => ({ ...r, timestamp: r.timestamp instanceof Date ? r.timestamp.toISOString() : r.timestamp })),
      activityLog: [...activityLog],
      invoiceData: invoiceData.map(inv => ({ ...inv })),
      disputes:    [...disputes],
    }),
  };
  const tokens = _rvLoad();
  const cutoff = now;
  Object.keys(tokens).forEach(k => {
    if (tokens[k].expiresAt && new Date(tokens[k].expiresAt) < cutoff) delete tokens[k];
  });
  tokens[token] = payload;
  _rvSave(tokens);
  return payload;
  } catch (e) {
    logError('generateReviewToken', e, { propId: activePropId, expiresIn });
    return null;
  }
}

function validateReviewToken(token) {
  const payload = _rvLoad()[token];
  if (!payload) return null;
  if (payload.expiresAt && new Date(payload.expiresAt) < new Date()) return null;
  return payload;
}

// ─── Generate Review Link Modal ───────────────────────────────────────────────
function openReviewLinkModal() {
  if (!lastResults.length) {
    showToast('Run a CAM allocation first to generate a review link.', { color: '#92400e', textColor: '#fef3c7' });
    return;
  }
  const modal = document.getElementById('reviewLinkModal');
  if (!modal) return;
  document.getElementById('rvLinkOutput').value      = '';
  document.getElementById('rvLinkResult').style.display = 'none';
  modal.style.display = 'flex';
}

function closeReviewLinkModal() {
  const m = document.getElementById('reviewLinkModal');
  if (m) m.style.display = 'none';
}

function confirmGenerateReviewLink() {
  const sel  = document.querySelector('input[name="rvExpiry"]:checked');
  const days = sel ? parseInt(sel.value, 10) : 7;
  const payload = generateReviewToken(days);
  if (!payload) {
    showToast('Could not generate review link — no allocation results found.', { color: '#92400e', textColor: '#fef3c7' });
    return;
  }
  const url = window.location.origin + window.location.pathname + '#review/' + payload.token;
  document.getElementById('rvLinkOutput').value = url;
  document.getElementById('rvLinkResult').style.display = 'block';
  document.getElementById('rvLinkExpiry').textContent = days === 0 ? 'Never expires' : `Expires in ${days} day${days > 1 ? 's' : ''}`;
}

function copyReviewLink() {
  const input = document.getElementById('rvLinkOutput');
  input.select();
  try {
    navigator.clipboard.writeText(input.value).catch(() => document.execCommand('copy'));
  } catch { document.execCommand('copy'); }
  const btn  = document.getElementById('rvCopyBtn');
  const orig = btn.textContent;
  btn.textContent = '✓ Copied!';
  setTimeout(() => { btn.textContent = orig; }, 2000);
}

// ─── Review Mode: Entry & Rendering ──────────────────────────────────────────
function enterReviewMode(payload) {
  try {
  _reviewMode = true;
  const snap = payload.snapshot;

  // Populate all globals from the stored snapshot
  lastResults      = snap.results      || [];
  lastPropName     = snap.propName     || '';
  lastTotal        = snap.total        || 0;
  lastInvoices     = snap.invoices     || [];
  lastInvoicesFull = (snap.invoicesFull || []).map(inv =>
    (inv && !inv.vendor) ? { ...inv, vendor: inv.vendorName || '' } : inv
  );
  lastTenants = snap.tenants || [];
  if (snap.camYear) setCamYear(snap.camYear);
  if (Array.isArray(snap.camRuns) && snap.camRuns.length) {
    camRuns.splice(0, camRuns.length, ...snap.camRuns.map(r => ({
      ...r, timestamp: r.timestamp ? new Date(r.timestamp) : new Date(),
    })));
  }
  activityLog.splice(0, activityLog.length, ...(snap.activityLog || []));
  invoiceData.splice(0, invoiceData.length, ...(snap.invoiceData || []));
  disputes.splice(0, disputes.length, ...(snap.disputes || []));

  // Apply body class — CSS hides all edit controls
  document.body.classList.add('review-mode');

  // Show the review banner
  _renderReviewBanner(payload);

  // Temporarily show mainWorkflow + #results so render functions can run
  document.getElementById('portfolioDashboard').style.display = 'none';
  document.getElementById('propertyBreadcrumb').style.display = 'none';
  const mw = document.getElementById('mainWorkflow');
  const rv = document.getElementById('results');
  mw.style.display = 'block';
  rv.style.display = 'block';

  // Render allocation table into review slot
  const rvBody = document.getElementById('reviewResultsBody');
  if (rvBody) {
    let html = `<div class="summary-bar">
      <strong>Total Expenses:</strong> ${fmt(lastTotal)}
      &nbsp;|&nbsp; <strong>Tenants:</strong> ${lastResults.length}
      &nbsp;|&nbsp; <strong>Invoices:</strong> ${lastInvoicesFull.length}
    </div>`;
    lastResults.forEach(r => {
      html += `<div class="result-card">
        <div class="r-name">${esc(r.name)}</div>
        <div class="result-grid">
          ${stat('Allocated Amount',  fmt(r.allocatedAmount))}
          ${stat('Pro-Rata Share',    (r.proRata * 100).toFixed(2) + '%')}
          ${stat('Included Expenses', r.eligibleCount + ' of ' + lastInvoicesFull.length)}
        </div>
        ${r.capApplied ? `<div class="cap-badge">Cap applied — ${fmt(r.capAdjustment)} reduced</div>` : ''}
      </div>`;
    });
    rvBody.innerHTML = html;
  }

  // Render each AI panel then move it from #results into its review slot
  const _movePanel = (panelId, renderFn, slotId) => {
    renderFn();
    const panel = document.getElementById(panelId);
    const slot  = document.getElementById(slotId);
    if (panel && slot) slot.appendChild(panel);
  };
  _movePanel('narrativePanel', renderNarrativePanel,        'rvNarrativeSlot');
  _movePanel('auditPanel',     renderAuditPanel,            'rvAuditSlot');
  _movePanel('trendsPanel',    renderHistoricalTrendsPanel, 'rvTrendsSlot');
  _movePanel('timelinePanel',  renderActivityTimeline,      'rvTimelineSlot');

  // Hide main workflow — review dashboard takes over
  mw.style.display = 'none';
  document.getElementById('reviewDashboard').style.display = 'block';

  window.scrollTo({ top: 0, behavior: 'instant' });
  } catch (e) {
    logError('enterReviewMode', e, { token: payload?.token, propName: payload?.propName });
    // Show the expired/error screen as a safe fallback
    document.getElementById('portfolioDashboard').style.display = 'none';
    document.getElementById('mainWorkflow').style.display       = 'none';
    const exp = document.getElementById('reviewExpiredMsg');
    if (exp) {
      exp.style.display = 'flex';
      const desc = exp.querySelector('.rv-expired-desc');
      if (desc) desc.textContent = 'An error occurred loading this review. Please request a new link.';
    }
  }
}

function _renderReviewBanner(payload) {
  const banner = document.getElementById('reviewBanner');
  if (!banner) return;
  const createdStr = new Date(payload.createdAt)
    .toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const expiryStr = payload.expiresAt
    ? 'Expires ' + new Date(payload.expiresAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : 'No expiry';
  banner.innerHTML = `
    <div class="rv-banner-left">
      <span class="rv-ro-badge">READ ONLY</span>
      <span class="rv-prop">${esc(payload.propName)}</span>
      <span class="rv-sep">·</span>
      <span class="rv-year">${esc(String(payload.camYear))} CAM Year</span>
    </div>
    <div class="rv-banner-right">
      <span class="rv-meta">Generated ${createdStr}</span>
      <span class="rv-sep">·</span>
      <span class="rv-meta">${expiryStr}</span>
      <button class="rv-export-btn" onclick="exportReviewPackage()">&#x2B07; Download Package</button>
    </div>`;
  banner.style.display = 'flex';
}

function exportReviewPackage() {
  const now      = new Date().toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' });
  const safeName = (lastPropName || 'property').replace(/[^a-z0-9]/gi, '_').toLowerCase();
  const year     = getCamYear();

  const gather = id => document.getElementById(id)?.outerHTML || '';
  const narrative = gather('narrativePanel');
  const audit     = gather('auditPanel');
  const trends    = gather('trendsPanel');
  const timeline  = gather('timelinePanel');
  const rvBodyEl  = document.getElementById('reviewResultsBody');
  const resultsHtml = rvBodyEl ? `<div class="card" style="margin-bottom:24px;padding:24px;">
    <h2 style="font-size:1.1rem;font-weight:700;color:#E2E8F0;margin-bottom:16px;">${year} Allocation Results</h2>
    ${rvBodyEl.innerHTML}</div>` : '';

  const styles = Array.from(document.styleSheets).flatMap(ss => {
    try { return Array.from(ss.cssRules).map(r => r.cssText); } catch { return []; }
  }).join('\n');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(lastPropName)} — ${year} CAM Audit Package</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{background:#0B1120;color:#E2E8F0;font-family:'Inter',system-ui,sans-serif;padding:32px 24px}
.rv-pkg-header{background:linear-gradient(135deg,#1a2535,#0B1120);border:1px solid rgba(201,151,58,.3);border-radius:12px;padding:24px;margin-bottom:28px}
.rv-pkg-title{font-size:1.5rem;font-weight:800;color:#C9973A;margin-bottom:4px}
.rv-pkg-meta{font-size:0.84rem;color:#64748B}
${styles}</style>
</head>
<body>
<div class="rv-pkg-header">
  <div class="rv-pkg-title">${esc(lastPropName)} — ${year} CAM Audit Package</div>
  <div class="rv-pkg-meta">Generated ${now} · Executive read-only review</div>
</div>
${narrative}${audit}${trends}${resultsHtml}${timeline}
</body></html>`;

  const blob = new Blob([html], { type: 'text/html' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href: url, download: `mainstreet_audit_${safeName}_${year}.html` });
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

// ─── SHA-256 (Web Crypto — no library needed) ─────────────────────────────────
async function sha256(obj) {
  const text   = JSON.stringify(obj, Object.keys(obj).sort());
  const buf    = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

// ─── Dispute: Invoice List ────────────────────────────────────────────────────
function renderDisputeSection() {
  // Section is only shown when tenants have actually filed disputes.
  // renderOpenDisputes() controls visibility of #disputeSection.
  document.getElementById('disputeInvoiceList').innerHTML = '';
  renderOpenDisputes();
}

// Wrapper for Dispute button inside the tenant statement report (table context).
// Shows/hides the hidden <tr> that contains the form div, then delegates to toggleDisputeForm.
// Opens the Explain Charge panel from the tenant statement and pre-expands
// the category of the invoice that was clicked.
function tsExplainCharge(tenantName, category) {
  openExplainPanel(tenantName);
  if (category) {
    setTimeout(() => epToggleDrill(category, tenantName), 60);
  }
}

// AI Explanation for a single invoice inside the Tenant Statement.
// Same Claude call and styling as the landlord explainCharge() — scoped to the
// tenant detail box so the landlord view is completely unaffected.
async function tsExplainInvoice(rowId, vendor, category, amount, date) {
  const btn = document.getElementById(`tsexplbtn-${rowId}`);
  try {
    await handleExplain(btn, async () => {
    const data = await explainFetch({
      model: MODEL,
      max_tokens: 1024,
      system: CAM_EXPLAIN_SYSTEM_PROMPT,
      messages: [{ role: 'user', content:
        `Vendor: ${vendor || 'Unknown'}\n` +
        `Category: ${category || 'other'}\n` +
        `Amount: $${amount || '0'}\n` +
        `Date: ${date || 'Unknown'}\n` +
        `Confidence: unknown%`
      }],
    });
    const text = data?.content?.[0]?.text || 'No explanation available.';
    const expl = document.getElementById(`tsexpl-${rowId}`);
    if (expl) {
      expl.className = 'inv-explain-box';
      const mdHtml = renderMarkdown(text);
      expl.innerHTML = `<strong>AI Explanation</strong><div class="expl-preview">${mdHtml}</div><button class="expl-readmore" onclick="var p=this.previousElementSibling;p.classList.toggle('expanded');this.textContent=p.classList.contains('expanded')?'Show less \u25b2':'Read full explanation \u25be'">Read full explanation &#x25BE;</button>`;
      expl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    });
  } catch (e) {
    const expl = document.getElementById(`tsexpl-${rowId}`);
    if (expl) { expl.className = 'inv-explain-box'; expl.innerHTML = '<span style="color:#f87171;">Unable to generate explanation — please try again.</span>'; }
  }
}

function tsToggleDispute(rowId, tenantName, idx) {
  const t = lastTenants.find(x => x.name === tenantName);
  const r = lastResults.find(x => x.name === tenantName);
  if (!t || !r) return;
  const eligible = lastInvoicesFull.filter(inv =>
    !t.excludedCategories.includes(inv.category.toLowerCase())
  );
  const inv = eligible[idx];
  if (!inv) return;
  const share = parseFloat((inv.amount * r.proRata).toFixed(2));
  toggleDisputeForm(rowId, tenantName, `inv-${idx}`, inv.vendor, inv.category, share);
}

function toggleDisputeForm(rowId, tenantName, invoiceId, vendor, category, tenantShare) {
  const formEl = document.getElementById(`dform-${rowId}`);
  const btnEl  = document.getElementById(`dbtn-${rowId}`);
  const card   = formEl && formEl.closest('.ts-inv-card');

  if (formEl.style.display === 'block') {
    formEl.style.display = 'none';
    btnEl.classList.remove('active');
    btnEl.textContent = 'Dispute';
    if (card) {
      card.classList.remove('ts-inv-card--disputing');
      const lbl = card.querySelector('.ts-dispute-mode-label');
      if (lbl) lbl.remove();
    }
    return;
  }

  btnEl.classList.add('active');
  btnEl.textContent = 'Cancel';
  formEl.style.display = 'block';

  if (card) {
    card.classList.add('ts-inv-card--disputing');
    if (!card.querySelector('.ts-dispute-mode-label')) {
      const lbl = document.createElement('div');
      lbl.className = 'ts-dispute-mode-label';
      lbl.textContent = '\u26A0 Disputing this charge';
      card.insertBefore(lbl, formEl);
    }
  }

  formEl.innerHTML = `
    <div class="dispute-form">
      <div class="dispute-form-title">Dispute this charge</div>
      <textarea id="dreason-${esc(rowId)}" placeholder="Explain why you're disputing this charge…"></textarea>
      <label class="dispute-attach-label">
        <input type="file" id="ddoc-${esc(rowId)}" class="dispute-doc-input"
          onchange="document.getElementById('ddocname-${esc(rowId)}').textContent=this.files[0]?'&#x1F4CE; '+this.files[0].name:''">
        <span id="ddocname-${esc(rowId)}">&#x1F4CE; Attach file (optional)</span>
      </label>
      <div class="dispute-form-btns">
        <button class="d-submit-btn"
          onclick="submitDispute('${esc(rowId)}','${esc(tenantName)}','${esc(invoiceId)}','${esc(vendor)}','${esc(category)}',${tenantShare})">
          Submit
        </button>
        <button class="d-cancel-btn"
          onclick="toggleDisputeForm('${esc(rowId)}','${esc(tenantName)}','${esc(invoiceId)}','${esc(vendor)}','${esc(category)}',${tenantShare})">
          Cancel
        </button>
      </div>
      <div class="ts-landlord-note">Your landlord will review and respond.</div>
    </div>`;
}

async function submitDispute(rowId, tenantName, invoiceId, vendor, category, tenantShare) {
  const reason = document.getElementById(`dreason-${rowId}`).value.trim();
  if (!reason) {
    document.getElementById(`dreason-${rowId}`).style.borderColor = '#ea580c';
    return;
  }
  const docInput = document.getElementById(`ddoc-${rowId}`);
  const docName  = docInput && docInput.files[0] ? docInput.files[0].name : null;
  disputes.push({
    id:          nextDisputeId++,
    tenantName, invoiceId, vendor, category, tenantShare, reason, docName,
    timestamp:   new Date().toISOString(),
    status:      'open',
    resolution:  null, resolvedAt: null, hash: null,
  });
  logActivity('dispute_opened', `Dispute filed — ${vendor || 'Unknown vendor'}`, {
    severity:        'warning',
    actor:           tenantName || 'Tenant',
    relatedEntity:   vendor || '',
    detail:          reason || '',
    financialImpact: tenantShare ? fmt(parseFloat(tenantShare) || 0) : '',
  });

  const formEl = document.getElementById(`dform-${rowId}`);
  const btnEl  = document.getElementById(`dbtn-${rowId}`);
  const card   = formEl && formEl.closest('.ts-inv-card');

  if (card) {
    // Tenant statement card — rich feedback
    card.classList.remove('ts-inv-card--disputing');
    card.classList.add('ts-inv-card--disputed');
    const lbl = card.querySelector('.ts-dispute-mode-label');
    if (lbl) lbl.remove();
    // Success message replaces the form
    formEl.style.display = 'block';
    formEl.innerHTML = `<div class="ts-dispute-submitted-msg">&#x2705; Dispute submitted — your landlord will review this request.</div>`;
    // "Under Review" badge below vendor name
    const vendorEl = card.querySelector('.ts-inv-vendor');
    if (vendorEl && !card.querySelector('.badge-disputed')) {
      const badge = document.createElement('span');
      badge.className = 'badge-disputed';
      badge.textContent = 'Disputed';
      vendorEl.insertAdjacentElement('afterend', badge);
    }
    // Lock the dispute button
    if (btnEl) {
      btnEl.disabled = true;
      btnEl.textContent = 'Disputed';
      btnEl.classList.remove('active');
      btnEl.style.cssText += ';opacity:0.45;cursor:not-allowed;';
    }
  } else {
    // Landlord side — simple close
    formEl.style.display = 'none';
    if (btnEl) { btnEl.classList.remove('active'); btnEl.textContent = 'Dispute'; }
  }

  // Mark matching invoice as disputed so badge renders on re-entry
  const matchedInv = invoiceData.find(d => d.vendorName?.toLowerCase() === vendor?.toLowerCase());
  if (matchedInv) matchedInv._disputed = true;

  renderOpenDisputes();
  await syncPortfolioEntry();
  await savePropertyData(); // persist dispute to Supabase
  updateStepBar('resolve');
  showToast('✓ Dispute submitted — your landlord will review it.');
}

// ─── Dispute: Open Disputes List ─────────────────────────────────────────────
function renderOpenDisputes() {
  const section = document.getElementById('disputeSection');
  const wrap    = document.getElementById('openDisputesWrap');
  const list    = document.getElementById('openDisputesList');

  if (!disputes.length) {
    section.style.display = 'none';
    wrap.style.display = 'none';
    return;
  }
  section.style.display = 'block';
  wrap.style.display = 'block';

  const openList     = disputes.filter(d => d.status === 'open');
  const resolvedList = disputes.filter(d => d.status !== 'open');
  document.getElementById('resolvedCount').textContent = resolvedList.length;

  function fmtTs(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  function renderCard(d) {
    const isResolved = d.status !== 'open';
    const docHtml = d.docName
      ? `<div style="font-size:0.75rem;color:#4ade80;margin:4px 0 0;font-family:'DM Mono',monospace;">📎 ${esc(d.docName)}</div>`
      : '';

    let actionsHtml = '';
    if (isResolved) {
      const label      = d.status === 'accepted' ? '✅ Accepted'
                       : d.status === 'rejected' ? '❌ Rejected'
                       : '📄 Docs Requested';
      const statusWord = d.status === 'accepted' ? 'Accepted'
                       : d.status === 'rejected' ? 'Rejected' : 'Resolved';
      const badgeClass = d.status === 'rejected' ? 'resolved-badge rejected'
                       : d.status === 'docs_requested' ? 'resolved-badge docs'
                       : 'resolved-badge';
      actionsHtml = `
        <div class="${badgeClass}">${label}</div>
        ${d.resolvedAt ? `<div class="d-resolved-ts">${statusWord} · ${fmtTs(d.resolvedAt)}</div>` : ''}
        ${d.hash ? `<div class="onchain-record">
          <div class="oc-label">On-Chain Record</div>
          <div class="oc-hash">${d.hash}</div>
          <button class="oc-view-btn" onclick="copyOnChainHash(this,'${d.hash}')">&#x1F517; View Record</button>
        </div>` : ''}`;
    } else {
      actionsHtml = `
        <div class="d-actions">
          <button class="d-res-btn accept" onclick="resolveDispute(${d.id},'accepted')">✅ Accept</button>
          <button class="d-res-btn reject" onclick="resolveDispute(${d.id},'rejected')">❌ Reject</button>
          <button class="d-res-btn docs"   onclick="showDocsRequest(${d.id})">📄 Request Documentation</button>
        </div>
        <div id="docs-req-${d.id}" style="display:none;margin-top:8px;padding:10px 12px;background:rgba(201,151,58,0.07);border:1px solid rgba(201,151,58,0.2);border-radius:8px;">
          <span class="dispute-doc-label" style="color:#C9973A;">Attach landlord documentation for this dispute:</span>
          <input type="file" id="docs-file-${d.id}" class="dispute-doc-input"
            onchange="document.getElementById('docs-fname-${d.id}').textContent=this.files[0]?'📎 '+this.files[0].name:''" />
          <div id="docs-fname-${d.id}" class="dispute-doc-name"></div>
          <div style="display:flex;gap:8px;margin-top:8px;">
            <button class="warn-btn add" onclick="confirmDocsRequest(${d.id})">Submit &amp; Resolve</button>
            <button class="warn-btn dismiss" onclick="document.getElementById('docs-req-${d.id}').style.display='none'">Cancel</button>
          </div>
        </div>`;
    }

    return `
      <div class="dispute-card${isResolved ? ' resolved' : ''}">
        <div class="d-meta">#${d.id + 1} · ${esc(d.tenantName)} · ${fmtTs(d.timestamp)}</div>
        <div class="d-title">${esc(d.vendor)} (${esc(d.category)}) — ${fmt(d.tenantShare)}</div>
        <div class="d-reason">"${esc(d.reason)}"</div>
        ${docHtml}
        ${actionsHtml}
      </div>`;
  }

  let html = '';
  if (openList.length) {
    html += `<div class="disputes-heading disputes-open-head">&#x1F534; Open Disputes</div>`;
    html += openList.map(renderCard).join('');
  }
  if (resolvedList.length) {
    html += `<div class="disputes-heading disputes-resolved-head">&#x1F7E2; Resolved Disputes</div>`;
    html += resolvedList.map(renderCard).join('');
  }
  list.innerHTML = html;
}

function copyOnChainHash(btn, hash) {
  navigator.clipboard.writeText(hash).then(() => {
    const orig = btn.textContent;
    btn.textContent = '\u2705 Copied!';
    setTimeout(() => btn.textContent = orig, 2000);
  }).catch(() => {
    btn.textContent = hash.substring(0, 8) + '\u2026';
  });
}

function showDocsRequest(id) {
  const el = document.getElementById(`docs-req-${id}`);
  if (el) el.style.display = el.style.display === 'block' ? 'none' : 'block';
}

async function confirmDocsRequest(id) {
  const fileEl = document.getElementById(`docs-file-${id}`);
  const d = disputes.find(x => x.id === id);
  if (d && fileEl && fileEl.files[0]) d.docName = fileEl.files[0].name;
  await resolveDispute(id, 'docs_requested');
}

async function resolveDispute(id, resolution) {
  const d = disputes.find(x => x.id === id);
  if (!d || d.status !== 'open') return;

  d.status     = resolution;
  d.resolvedAt = new Date().toISOString();
  {
    const isDocsReq = resolution === 'docs_requested';
    const evType  = isDocsReq ? 'docs_requested' : 'dispute_resolved';
    const evTitle = isDocsReq
      ? `Documentation requested — ${d.vendor || 'Unknown vendor'}`
      : `Dispute ${resolution} — ${d.vendor || 'Unknown vendor'}`;
    logActivity(evType, evTitle, {
      severity:        isDocsReq ? 'warning' : 'info',
      actor:           'Landlord',
      relatedEntity:   d.tenantName || '',
      detail:          d.reason || '',
      financialImpact: d.tenantShare ? fmt(parseFloat(d.tenantShare) || 0) : '',
    });
  }

  // Hash the full dispute record for the on-chain audit trail
  d.hash = await sha256({
    id:          d.id,
    tenantName:  d.tenantName,
    invoiceId:   d.invoiceId,
    vendor:      d.vendor,
    category:    d.category,
    tenantShare: d.tenantShare,
    reason:      d.reason,
    timestamp:   d.timestamp,
    resolution:  d.resolution,
    resolvedAt:  d.resolvedAt,
  });

  renderOpenDisputes();
  syncPortfolioEntry();
}

// ─── AI Audit Summary ────────────────────────────────────────────────────────

// Duplicate / Suspicious Invoice Detection
// Accepts the normalized invoiceData array (items with vendorName, amount,
// invoiceDate, fileUrl, fileName). Returns an array of
// { severity: 'red'|'yellow', title, detail } objects.
// Rules are deterministic and explainable — no ML required.
function _detectInvoiceSuspicions(invoices) {
  const flags = [];
  if (!invoices.length) return flags;

  // Normalised view used by all checks
  const rows = invoices.map((inv, idx) => {
    const vendor = (inv.vendorName || inv.vendor || '').toLowerCase().trim();
    const amount = parseFloat(inv.amount) || 0;
    const date   = (inv.invoiceDate || '').trim();
    const ts     = date ? new Date(date).getTime() : NaN;
    return {
      idx,
      vendor,
      displayVendor: inv.vendorName || inv.vendor || '(unknown)',
      amount,
      amtKey: amount.toFixed(2),
      date,
      ts,
      category: (inv.category || '').toLowerCase().trim(),
      fileUrl:  inv.fileUrl  || '',
      fileName: (inv.fileName || '').trim().toLowerCase(),
    };
  }).filter(r => r.vendor && r.amount > 0);

  const DAY_MS = 24 * 60 * 60 * 1000;

  // ── 1. Exact duplicates: same vendor + amount + date → Red ───────────────
  const exactMap = {};
  rows.forEach(r => {
    if (!r.date) return;
    const key = `${r.vendor}|${r.amtKey}|${r.date}`;
    (exactMap[key] = exactMap[key] || []).push(r);
  });
  const exactFlaggedIdx = new Set();
  Object.values(exactMap).forEach(group => {
    if (group.length < 2) return;
    group.forEach(r => exactFlaggedIdx.add(r.idx));
    const dupTotal = group[0].amount * (group.length - 1);
    flags.push({
      severity:   'red',
      title:      `Exact duplicate invoice: "${group[0].displayVendor}" — ${fmt(group[0].amount)} on ${group[0].date} appears ${group.length} times`,
      detail:     `This invoice is listed ${group.length} times with identical vendor, amount, and date. If billed as-is, ${group.length - 1} charge${group.length > 2 ? 's' : ''} (${fmt(dupTotal)}) would be overbilled. Remove all but one entry before billing tenants.`,
      conditions: [
        `Vendor: "${group[0].displayVendor}"`,
        `Amount per record: ${fmt(group[0].amount)}`,
        `Date: ${group[0].date}`,
        `Occurrences: ${group.length} (${group.length - 1} excess)`,
        `Overbilling risk: ${fmt(dupTotal)} if all records are billed`,
      ],
    });
  });

  // ── 2. Near-duplicate: same vendor + amount, dates within 7 days → Yellow ─
  // (Skip invoices already flagged as exact duplicates)
  const nearMap = {};
  rows.filter(r => !exactFlaggedIdx.has(r.idx)).forEach(r => {
    const key = `${r.vendor}|${r.amtKey}`;
    (nearMap[key] = nearMap[key] || []).push(r);
  });
  Object.values(nearMap).forEach(group => {
    if (group.length < 2) return;
    const dated = group.filter(r => !isNaN(r.ts)).sort((a, b) => a.ts - b.ts);
    for (let i = 0; i < dated.length - 1; i++) {
      const daysDiff = Math.round((dated[i + 1].ts - dated[i].ts) / DAY_MS);
      if (daysDiff <= 7) {
        flags.push({
          severity:   'yellow',
          title:      `Possible duplicate: "${dated[i].displayVendor}" billed ${fmt(dated[i].amount)} twice within ${daysDiff} day${daysDiff === 1 ? '' : 's'}`,
          detail:     `Same vendor and amount appearing ${daysDiff} day${daysDiff === 1 ? '' : 's'} apart. Monthly services are typically billed once per period — confirm whether both charges represent distinct services or whether one is a duplicate submission.`,
          conditions: [
            `Vendor: "${dated[i].displayVendor}"`,
            `Amount: ${fmt(dated[i].amount)} (identical on both invoices)`,
            `Invoice date 1: ${dated[i].date}`,
            `Invoice date 2: ${dated[i + 1].date}`,
            `Gap: ${daysDiff} day${daysDiff === 1 ? '' : 's'} (threshold for review: ≤7 days)`,
          ],
        });
        break; // one flag per vendor+amount pair is enough
      }
    }
  });

  // ── 3. Same source file attached to multiple invoice records → Red ────────
  const urlMap = {};
  rows.forEach(r => {
    if (!r.fileUrl) return;
    (urlMap[r.fileUrl] = urlMap[r.fileUrl] || []).push(r);
  });
  Object.values(urlMap).forEach(group => {
    if (group.length < 2) return;
    const totalAmt = group.reduce((s, r) => s + r.amount, 0);
    flags.push({
      severity:   'red',
      title:      `Same source document linked to ${group.length} separate invoice records`,
      detail:     `One file attachment is associated with ${group.length} distinct invoice entries totalling ${fmt(totalAmt)}. A single document cannot substantiate multiple separate charges — this indicates either a data entry error or potential double-billing.`,
      conditions: [
        `Shared attachment used across ${group.length} records`,
        `Combined billed amount: ${fmt(totalAmt)}`,
        ...group.slice(0, 4).map(r => `Record: "${r.displayVendor}" — ${fmt(r.amount)}`),
        'Each invoice entry must reference a unique source document',
      ],
    });
  });

  // ── 4. Same filename + same amount from different records → Yellow ─────────
  // (Only fires if fileUrl check didn't already catch it)
  const fnMap = {};
  rows.forEach(r => {
    if (!r.fileName) return;
    const key = `${r.fileName}|${r.amtKey}`;
    (fnMap[key] = fnMap[key] || []).push(r);
  });
  Object.entries(fnMap).forEach(([key, group]) => {
    if (group.length < 2) return;
    const alreadyCovered = Object.values(urlMap).some(g => g.length > 1 &&
      group.every(r => g.some(u => u.idx === r.idx)));
    if (alreadyCovered) return;
    const [fn] = key.split('|');
    const uniqueVendors = [...new Set(group.map(r => r.displayVendor))];
    flags.push({
      severity:   'yellow',
      title:      `Filename "${fn}" with amount ${fmt(group[0].amount)} appears on ${group.length} invoice records`,
      detail:     `Matching filename and amount across ${group.length} records may indicate the same file was uploaded multiple times under different entries. Confirm that each record references a distinct, original invoice document.`,
      conditions: [
        `Filename: "${fn}"`,
        `Amount: ${fmt(group[0].amount)} (same on all ${group.length} records)`,
        `Vendors: ${uniqueVendors.join(', ')}`,
        'Verify these are distinct invoices and not duplicate uploads of the same file',
      ],
    });
  });

  // ── 5. Billing frequency: same vendor, 3+ invoices within 5 days → Yellow ─
  const byVendor = {};
  rows.filter(r => !isNaN(r.ts)).forEach(r => {
    (byVendor[r.vendor] = byVendor[r.vendor] || []).push(r);
  });
  Object.entries(byVendor).forEach(([, entries]) => {
    if (entries.length < 3) return;
    const sorted = [...entries].sort((a, b) => a.ts - b.ts);
    for (let i = 0; i <= sorted.length - 3; i++) {
      const win = sorted.filter(e => e.ts >= sorted[i].ts && e.ts <= sorted[i].ts + 5 * DAY_MS);
      if (win.length >= 3) {
        const winTotal = win.reduce((s, e) => s + e.amount, 0);
        flags.push({
          severity:   'yellow',
          title:      `"${win[0].displayVendor}" billed ${win.length} times within 5 days (${fmt(winTotal)} total)`,
          detail:     `${win.length} invoices from "${win[0].displayVendor}" fall within a single 5-day window. While some vendors bill for multiple events (e.g. emergency calls), this pattern can indicate split invoicing to avoid approval thresholds or duplicate submissions. Obtain itemized backup for each charge.`,
          conditions: [
            `Vendor: "${win[0].displayVendor}"`,
            `${win.length} invoices within a 5-day window`,
            `Combined total in window: ${fmt(winTotal)}`,
            ...win.map(e => `Invoice: ${e.date} — ${fmt(e.amount)}`),
          ],
        });
        break;
      }
    }
  });

  // ── 6. Same amount from 3+ different vendors (round-number clustering) ─────
  const amtVendorMap = {};
  rows.forEach(r => {
    (amtVendorMap[r.amtKey] = amtVendorMap[r.amtKey] || new Set()).add(r.vendor);
  });
  Object.entries(amtVendorMap).forEach(([amtKey, vendorSet]) => {
    if (vendorSet.size < 3) return;
    const amt = parseFloat(amtKey);
    if (amt % 100 !== 0) return; // only flag suspiciously round amounts
    flags.push({
      severity:   'yellow',
      title:      `${vendorSet.size} unrelated vendors each invoiced the same round amount (${fmt(amt)})`,
      detail:     `Identical round-number amounts from ${vendorSet.size} different vendors is statistically uncommon for independent services. This may indicate estimated or placeholder billing rather than actual cost invoices. Request itemized backup for each charge.`,
      conditions: [
        `Shared amount: ${fmt(amt)} (round number, divisible by 100)`,
        `${vendorSet.size} distinct vendors at this exact amount`,
        `Vendors: ${[...vendorSet].join(', ')}`,
        'Legitimate invoices typically reflect actual variable costs, not uniform round numbers',
      ],
    });
  });

  return flags;
}

// Pure function — reads globals, returns flag arrays. No DOM side-effects.
function buildAuditSummary() {
  const red = [], yellow = [], green = [];

  const invs     = lastInvoicesFull.length ? lastInvoicesFull : [];
  const allInvData = invoiceData.filter(inv => inv && inv.vendorName);
  const paidInvData = allInvData.filter(inv => parseFloat(inv.amount) > 0);
  const results  = lastResults;
  const tenants  = lastTenants;
  const total    = lastTotal || 0;

  // ── 1. Unusually large single invoice (> 40% of total) ───────────────────
  if (total > 0 && invs.length) {
    const thresh = total * 0.4;
    invs.forEach(inv => {
      if (!inv) return;
      const amt = parseFloat(inv.amount) || 0;
      if (amt > thresh) {
        const pct     = ((amt / total) * 100).toFixed(1);
        const excess  = fmt(amt - thresh);
        const vendor  = inv.vendor || inv.vendorName || 'Unknown';
        red.push({
          group:  'red_flags',
          title:  `Unusually large invoice — ${vendor}: ${fmt(amt)} (${pct}% of total CAM)`,
          detail: `This invoice represents ${pct}% of total CAM expenses (${fmt(amt)} of ${fmt(total)}), exceeding the 40% materiality threshold by ${excess}. A single vendor accounting for more than 40% of the total expense pool warrants independent verification before billing.`,
          conditions: [
            `Vendor: "${vendor}"`,
            `Invoice amount: ${fmt(amt)}`,
            `Total CAM pool: ${fmt(total)}`,
            `Concentration: ${pct}% (threshold: 40%)`,
            `Dollar excess above threshold: ${excess}`,
          ],
        });
      }
    });
  }

  // ── 2. YoY change (compare two most-recent distinct years) ───────────────
  {
    const byYear = {};
    camRuns.forEach(r => { if (r.camYear && !byYear[r.camYear]) byYear[r.camYear] = r; });
    const years = Object.keys(byYear).map(Number).sort((a, b) => b - a);
    if (years.length >= 2) {
      const curr = byYear[years[0]], prev = byYear[years[1]];
      if (curr.totalExpenses && prev.totalExpenses) {
        const pct    = ((curr.totalExpenses - prev.totalExpenses) / prev.totalExpenses) * 100;
        const absDiff = curr.totalExpenses - prev.totalExpenses;
        const dir    = pct > 0 ? 'increased' : 'decreased';
        const detail = `${years[1]}: ${fmt(prev.totalExpenses)} → ${years[0]}: ${fmt(curr.totalExpenses)}`;
        const yoyConditions = [
          `Previous year (${years[1]}): ${fmt(prev.totalExpenses)}`,
          `Current year (${years[0]}): ${fmt(curr.totalExpenses)}`,
          `Absolute change: ${absDiff > 0 ? '+' : ''}${fmt(absDiff)}`,
          `Percentage change: ${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`,
        ];
        if (pct > 20) {
          red.push({
            group: 'allocation',
            title: `Total CAM ${dir} ${Math.abs(pct).toFixed(1)}% year-over-year`,
            detail: `Total CAM expenses rose ${Math.abs(pct).toFixed(1)}% from ${fmt(prev.totalExpenses)} in ${years[1]} to ${fmt(curr.totalExpenses)} in ${years[0]}, a ${fmt(Math.abs(absDiff))} ${absDiff > 0 ? 'increase' : 'decrease'}. This exceeds the 20% year-over-year materiality threshold and may require additional landlord documentation under standard CAM audit protocols.`,
            conditions: [...yoyConditions, 'Threshold: >20% triggers critical flag'],
          });
        } else if (Math.abs(pct) > 10) {
          yellow.push({
            group: 'allocation',
            title: `Total CAM ${dir} ${Math.abs(pct).toFixed(1)}% year-over-year`,
            detail: `Total CAM expenses ${dir} ${Math.abs(pct).toFixed(1)}% between ${years[1]} and ${years[0]} (${fmt(prev.totalExpenses)} → ${fmt(curr.totalExpenses)}). This change exceeds the 10% monitoring threshold and should be reviewed for unusual or non-recurring expense categories.`,
            conditions: [...yoyConditions, 'Threshold: >10% triggers warning'],
          });
        } else {
          green.push({
            group: 'allocation',
            title: `CAM within normal range YoY (${pct > 0 ? '+' : ''}${pct.toFixed(1)}%)`,
            detail,
            conditions: [...yoyConditions, 'Within normal ±10% range — no action required'],
          });
        }
      }
    }
  }

  // ── 3. Duplicate / suspicious invoice detection ──────────────────────────
  {
    const suspicions = _detectInvoiceSuspicions(allInvData);
    suspicions.forEach(s => (s.severity === 'red' ? red : yellow).push({ group: 'duplicates', title: s.title, detail: s.detail, conditions: s.conditions }));
    if (suspicions.length === 0 && allInvData.length > 0) {
      green.push({ title: 'No duplicate or suspicious invoice patterns detected' });
    }
  }

  // ── 4. Missing source documents ──────────────────────────────────────────
  {
    const missing = allInvData.filter(inv => !inv.fileUrl && !inv.fileName);
    if (missing.length > 0) {
      const pct   = Math.round((missing.length / allInvData.length) * 100);
      const names = missing.slice(0, 3).map(inv => inv.vendorName).join(', ') +
        (missing.length > 3 ? ` +${missing.length - 3} more` : '');
      const bucket = pct === 100 ? red : yellow;
      const allMissing = pct === 100;
      bucket.push({
        group:  'missing_docs',
        title:  `${missing.length} of ${allInvData.length} invoice${missing.length > 1 ? 's' : ''} missing source document`,
        detail: allMissing
          ? `No invoices have attached source documents — the entire CAM expense pool of ${fmt(total)} cannot be independently verified. Standard CAM audit requirements mandate supporting documentation for all billed charges.`
          : `CAM audits require source documentation for all billed expenses. Without attachments, ${names} cannot be independently verified and are susceptible to tenant challenge. ${missing.length} of ${allInvData.length} invoices (${pct}%) are affected.`,
        conditions: [
          `Invoices missing attachments: ${missing.length} of ${allInvData.length} (${pct}%)`,
          `Affected vendors: ${names}`,
          'Requirement: all CAM charges must have attached invoices or receipts for audit defensibility',
        ],
      });
    } else if (allInvData.length > 0) {
      green.push({ title: `All ${allInvData.length} invoices have source documents attached`, conditions: [`${allInvData.length} of ${allInvData.length} invoices have attached source documentation — audit-ready`] });
    }
  }

  // ── 5. Invoices without a date ───────────────────────────────────────────
  {
    const noDates = allInvData.filter(inv => !inv.invoiceDate);
    if (noDates.length) {
      const noDateNames = noDates.slice(0, 3).map(inv => inv.vendorName).join(', ') +
        (noDates.length > 3 ? ` +${noDates.length - 3} more` : '');
      const camYr = getCamYear() || 'the reconciliation period';
      yellow.push({
        group:  'missing_docs',
        title:  `${noDates.length} invoice${noDates.length > 1 ? 's' : ''} missing invoice date`,
        detail: `Invoice date confirms that a charge falls within the ${camYr} CAM reconciliation period. Undated invoices may be excluded or challenged in a formal tenant audit. Affected: ${noDateNames}.`,
        conditions: [
          `Count: ${noDates.length} invoice${noDates.length > 1 ? 's' : ''} have no recorded invoice date`,
          `Affected vendors: ${noDateNames}`,
          `Required: invoice date must fall within the ${camYr} reconciliation year`,
        ],
      });
    }
  }

  // ── 6. Low-confidence tenant matches ────────────────────────────────────
  {
    const lowConf = paidInvData.filter(inv => inv.matchConfidence > 0 && inv.matchConfidence < 75);
    if (lowConf.length) {
      const lowConfConditions = lowConf.slice(0, 5).map(inv => {
        const reason = inv.matchReason || 'no field match';
        return `"${inv.vendorName}": matched on "${reason}" at ${inv.matchConfidence}% — below 75% threshold, allocated pro-rata`;
      });
      if (lowConf.length > 5) lowConfConditions.push(`+${lowConf.length - 5} more`);
      yellow.push({
        group:  'allocation',
        title:  `${lowConf.length} invoice${lowConf.length > 1 ? 's' : ''} matched with insufficient confidence for direct tenant charge`,
        detail: `The matching engine assigns confidence based on unit number hits (90%) and tenant name hits (75%). These invoices matched partially but fell below the 75% direct-charge threshold, so they were distributed pro-rata across all tenants rather than charged to a specific tenant.`,
        conditions: [
          `Confidence threshold for direct charge: 75%`,
          `Matching signals: unit number match = 90%, tenant name match = 75%`,
          ...lowConfConditions,
        ],
      });
    }
  }

  // ── 7. Shared expense allocation status ──────────────────────────────────
  {
    const matched = paidInvData.filter(inv => (inv.matchConfidence || 0) >= 75).length;
    const shared  = paidInvData.length - matched;
    if (paidInvData.length > 0) {
      if (matched === 0) {
        green.push({
          title:  `All ${paidInvData.length} invoices allocated as shared CAM expenses (pro-rata)`,
          detail: `No invoices were matched to an individual tenant — all ${fmt(total)} of CAM expenses were distributed pro-rata across all tenants using their square footage share of the total building.`,
          conditions: [
            `${paidInvData.length} invoices distributed pro-rata; none directly charged to a single tenant`,
            'Allocation basis: each tenant\'s leased sqft as a percentage of total building sqft',
          ],
        });
      } else {
        green.push({
          title:  `${matched} invoice${matched > 1 ? 's' : ''} directly matched to tenant${matched > 1 ? 's' : ''}, ${shared} shared pro-rata`,
          conditions: [
            `Direct tenant charges: ${matched} invoice${matched > 1 ? 's' : ''} (confidence ≥75% — unit or name match)`,
            `Shared pro-rata: ${shared} invoice${shared !== 1 ? 's' : ''} distributed by square footage`,
          ],
        });
      }
    }
  }

  // ── 8. Pro-rata allocation coverage ─────────────────────────────────────
  {
    const totalPR     = results.reduce((s, r) => s + (r.proRataPercent || 0), 0);
    const prop        = currentProperty();
    const propSqft    = parseFloat(prop?.totalSqft || prop?.totalSqFt) || 0;
    const leasedSqft  = results.reduce((s, r) => s + (r.sqFt || 0), 0);
    const sqftCtx     = propSqft > 0 && leasedSqft > 0
      ? `Tenant leases cover ${leasedSqft.toLocaleString()} of ${propSqft.toLocaleString()} total sqft.`
      : null;
    if (results.length > 0) {
      if (Math.abs(totalPR - 100) < 2) {
        green.push({
          group: 'allocation',
          title: `Pro-rata percentages sum to ${totalPR.toFixed(1)}% — all expenses accounted for`,
          conditions: [
            `Sum of tenant pro-rata: ${totalPR.toFixed(1)}% (within ±2% of 100%)`,
            ...(sqftCtx ? [sqftCtx + ' Full building is under lease.'] : []),
          ],
        });
      } else if (totalPR < 98) {
        const gap = (100 - totalPR).toFixed(1);
        yellow.push({
          group:  'allocation',
          title:  `Pro-rata totals ${totalPR.toFixed(1)}% — ${gap}% of expenses unallocated`,
          detail: sqftCtx
            ? `${sqftCtx} The remaining ${(propSqft - leasedSqft).toLocaleString()} sqft is untenanted — its share of CAM expenses (${gap}%) is not recoverable under current leases.`
            : `Total leased sqft is less than the property total, leaving ${gap}% of CAM expenses unallocated. Review tenant sqft entries.`,
          conditions: [
            `Sum of tenant pro-rata: ${totalPR.toFixed(1)}%`,
            `Unrecoverable gap: ${gap}%`,
            ...(sqftCtx ? [`Leased sqft: ${leasedSqft.toLocaleString()} of ${propSqft.toLocaleString()} total`] : []),
          ],
        });
      } else {
        const excess = (totalPR - 100).toFixed(1);
        yellow.push({
          group:  'allocation',
          title:  `Pro-rata totals ${totalPR.toFixed(1)}% — exceeds 100%`,
          detail: sqftCtx
            ? `${sqftCtx} Tenant sqft entries sum to ${leasedSqft.toLocaleString()}, which exceeds the property total of ${propSqft.toLocaleString()} sqft. This overallocates CAM by ${excess}% and must be corrected to avoid overbilling.`
            : `Tenant sqft entries sum to more than the property total, overallocating CAM by ${excess}%. Review and correct sqft entries.`,
          conditions: [
            `Sum of tenant pro-rata: ${totalPR.toFixed(1)}%`,
            `Overallocation: ${excess}% above 100%`,
            ...(sqftCtx ? [`Leased sqft: ${leasedSqft.toLocaleString()} vs property total: ${propSqft.toLocaleString()}`] : []),
          ],
        });
      }
    }
  }

  // ── 9. CAM cap applied ───────────────────────────────────────────────────
  {
    const capped     = results.filter(r => r.capApplied);
    const totalSaved = capped.reduce((s, r) => s + (r.capAdjustment || 0), 0);
    if (capped.length) {
      const capConditions = capped.map(r => {
        const t      = tenants.find(x => (x.name || x.tenantName) === r.name);
        const capPct = t?.capPercentage ?? t?.cap ?? null;
        const capBase = t?.capBaseAmount ?? null;
        const ceiling = capPct !== null && capBase !== null ? fmt(capBase * (1 + capPct / 100)) : null;
        const parts  = [`${r.name}: reduced by ${fmt(r.capAdjustment)}`];
        if (capPct !== null) parts.push(`${capPct}% annual cap`);
        if (ceiling !== null) parts.push(`ceiling ${ceiling}`);
        return parts.join(' — ');
      });
      yellow.push({
        group:  'allocation',
        title:  `CAM cap applied for ${capped.length} tenant${capped.length > 1 ? 's' : ''}: ${capped.map(r => r.name).join(', ')}`,
        detail: `Tenant responsibility was reduced due to annual controllable CAM cap language in the lease${capped.length > 1 ? 's' : ''}. Affected tenant${capped.length > 1 ? 's' : ''} paid ${fmt(totalSaved)} less in aggregate than their uncapped pro-rata share.`,
        conditions: [
          `Total CAM savings from cap enforcement: ${fmt(totalSaved)}`,
          ...capConditions,
          'Basis: capBaseAmount × (1 + capPercentage%) sets the maximum billable amount per tenant',
        ],
      });
    }
  }

  // ── 10. Ambiguity flags surfaced by the reconciliation engine ────────────
  {
    const flagMap = {};
    results.forEach(r => {
      (r.ambiguityFlags || []).forEach(f => {
        if (!flagMap[f.code]) flagMap[f.code] = { message: f.message, explanation: f.explanation, tenants: [] };
        flagMap[f.code].tenants.push(r.name);
      });
    });
    Object.values(flagMap).forEach(({ message, explanation, tenants }) => {
      yellow.push({
        group:  'lease',
        title:  `${message} — ${tenants.length} tenant${tenants.length > 1 ? 's' : ''}: ${tenants.join(', ')}`,
        detail: explanation
          ? `Reconciliation engine flag: ${explanation} This condition was surfaced automatically and may require lease review or landlord clarification.`
          : 'This condition was surfaced by the reconciliation engine and may require lease review.',
        conditions: [
          `Flagged by: reconciliation engine`,
          `Affected tenants: ${tenants.join(', ')}`,
          ...(explanation ? [`Engine explanation: ${explanation}`] : []),
        ],
      });
    });
  }

  // ── 11. Lease exclusion inconsistencies ──────────────────────────────────
  {
    const cats = [...new Set(invs.map(inv => inv ? (inv.category || 'other').toLowerCase() : null).filter(Boolean))];
    cats.forEach(cat => {
      const excl     = tenants.filter(t => (t.excludedCategories || []).includes(cat));
      const included = tenants.filter(t => !(t.excludedCategories || []).includes(cat));
      if (excl.length > 0 && excl.length < tenants.length) {
        const catTotal = invs
          .filter(i => i && (i.category || 'other').toLowerCase() === cat)
          .reduce((s, i) => s + (parseFloat(i.amount) || 0), 0);
        const exclImpact = excl.reduce((s, t) => {
          const r = results.find(x => x.name === (t.name || t.tenantName));
          return s + (r ? catTotal * ((r.proRataPercent || 0) / 100) : 0);
        }, 0);
        yellow.push({
          group:  'lease',
          title:  `"${cat}" excluded for ${excl.length} of ${tenants.length} tenants`,
          detail: `${cat.charAt(0).toUpperCase() + cat.slice(1)} expenses total ${fmt(catTotal)}. Per lease terms, ${excl.map(t => t.name || t.tenantName).join(' and ')} ${excl.length > 1 ? 'are' : 'is'} excluded from this category, reducing their combined CAM obligation by approximately ${fmt(exclImpact)}.`,
          conditions: [
            `Category: "${cat}" — total expenses: ${fmt(catTotal)}`,
            `Excluded (per lease): ${excl.map(t => t.name || t.tenantName).join(', ')}`,
            `Included: ${included.map(t => t.name || t.tenantName).join(', ')}`,
            `Estimated impact of exclusion: ~${fmt(exclImpact)} reduction in billable obligations`,
          ],
        });
      }
    });
  }

  if (red.length === 0 && yellow.length === 0) {
    green.push({ title: 'No issues detected — reconciliation looks clean' });
  }

  return { red, yellow, green };
}

// ─── AI Auditor Narrative ─────────────────────────────────────────────────────

function buildAuditNarrative() {
  const { red, yellow, green } = buildAuditSummary();
  const trends      = buildHistoricalTrends();
  const invAll      = invoiceData.filter(inv => inv && inv.vendorName);
  const prop        = currentProperty();
  const propName    = lastPropName || prop?.name || 'This property';
  const camYear     = getCamYear() || new Date().getFullYear();
  const total       = lastTotal || 0;
  const tenantCount = lastResults.length;
  const openDisputes = disputes.filter(d => d.status === 'open');

  // ── Risk Level ────────────────────────────────────────────────────────────
  let riskLevel;
  if (red.length >= 3 || (red.length >= 1 && openDisputes.length >= 1)) {
    riskLevel = 'Critical';
  } else if (red.length >= 1 || yellow.length >= 3) {
    riskLevel = 'Elevated';
  } else if (yellow.length >= 1 || openDisputes.length >= 1) {
    riskLevel = 'Moderate';
  } else {
    riskLevel = 'Low';
  }

  // ── Headline ──────────────────────────────────────────────────────────────
  const headlines = {
    Critical: 'Critical Audit Risk — Immediate Review Required Before Tenant Billing',
    Elevated: 'Elevated Audit Risk — Material Exceptions Identified',
    Moderate: 'Moderate Risk — Advisory Findings Require Review',
    Low:      'Low Risk — Reconciliation Appears Audit-Ready',
  };
  const headline = headlines[riskLevel];

  // ── Confidence ────────────────────────────────────────────────────────────
  const pctWithDocs = invAll.length > 0
    ? Math.round((invAll.filter(i => i.fileUrl || i.fileName).length / invAll.length) * 100)
    : 100;
  const pctDated = invAll.length > 0
    ? Math.round((invAll.filter(i => i.invoiceDate).length / invAll.length) * 100)
    : 100;
  let confidence;
  if (red.length === 0 && pctWithDocs >= 80 && pctDated >= 80 && openDisputes.length === 0) {
    confidence = 'High';
  } else if (pctWithDocs >= 50 && red.length <= 1) {
    confidence = 'Moderate';
  } else {
    confidence = 'Low';
  }

  // ── Financial Impact ──────────────────────────────────────────────────────
  const disputeAmt   = openDisputes.reduce((s, d) => s + (parseFloat(d.tenantShare) || 0), 0);
  const capSavings   = lastResults.filter(r => r.capApplied).reduce((s, r) => s + (r.capAdjustment || 0), 0);
  const missingDocAmt = invAll
    .filter(i => !i.fileUrl && !i.fileName)
    .reduce((s, i) => s + (parseFloat(i.amount) || 0), 0);
  const impactParts = [];
  if (missingDocAmt > 0) impactParts.push(`${fmt(missingDocAmt)} in undocumented charges`);
  if (disputeAmt   > 0) impactParts.push(`${fmt(disputeAmt)} in open dispute`);
  if (capSavings   > 0) impactParts.push(`${fmt(capSavings)} reduced via CAM caps`);
  const financialImpact = impactParts.length > 0
    ? impactParts.join(' · ')
    : total > 0 ? `${fmt(total)} total CAM pool — no at-risk amounts identified` : 'Insufficient data';

  // ── Summary Paragraph ─────────────────────────────────────────────────────
  const parts = [];
  parts.push(
    `The ${camYear} CAM reconciliation for ${propName} covers ${fmt(total)} in total expenses` +
    ` across ${tenantCount} tenant${tenantCount !== 1 ? 's' : ''}` +
    ` and ${invAll.length} invoice${invAll.length !== 1 ? 's' : ''}.`
  );
  if (red.length > 0) {
    parts.push(
      `The audit engine identified ${red.length} critical exception${red.length > 1 ? 's' : ''}` +
      ` requiring immediate attention prior to tenant billing.`
    );
  }
  if (yellow.length > 0) {
    parts.push(
      `An additional ${yellow.length} advisory finding${yellow.length > 1 ? 's were' : ' was'} noted` +
      ` that may affect the defensibility of this reconciliation in a formal tenant audit.`
    );
  }
  if (openDisputes.length > 0) {
    parts.push(
      `${openDisputes.length} tenant dispute${openDisputes.length > 1 ? 's remain' : ' remains'} unresolved;` +
      ` reconciliation statements should not be finalized until each dispute is addressed.`
    );
  }
  if (trends) {
    const nonGreenTrends = trends.trends.filter(t => t.severity !== 'green').length;
    if (nonGreenTrends > 0) {
      parts.push(
        `Year-over-year comparison against ${trends.priorYear} identified ${nonGreenTrends}` +
        ` trend${nonGreenTrends > 1 ? 's' : ''} warranting further review.`
      );
    }
  }
  if (red.length === 0 && yellow.length === 0 && openDisputes.length === 0) {
    parts.push(
      'No critical exceptions were detected. The reconciliation appears materially complete' +
      ' and audit-defensible based on available data.'
    );
  }
  const summaryParagraph = parts.join(' ');

  // ── Key Findings ──────────────────────────────────────────────────────────
  const keyFindings = [];
  red.slice(0, 3).forEach(f => keyFindings.push(f.detail || f.title));
  if (keyFindings.length < 5) {
    yellow.slice(0, 5 - keyFindings.length).forEach(f => keyFindings.push(f.detail || f.title));
  }
  if (openDisputes.length > 0 && keyFindings.length < 5) {
    const dAmt = disputeAmt > 0 ? ` totaling ${fmt(disputeAmt)}` : '';
    keyFindings.push(
      `${openDisputes.length} unresolved tenant dispute${openDisputes.length > 1 ? 's' : ''}${dAmt} ` +
      `pending landlord review — billing should be held until resolved.`
    );
  }
  if (trends && keyFindings.length < 5) {
    trends.trends
      .filter(t => t.severity === 'red' || t.severity === 'yellow')
      .slice(0, 5 - keyFindings.length)
      .forEach(t => keyFindings.push(t.note));
  }

  // ── Recommendations ───────────────────────────────────────────────────────
  const recommendations = [];
  const allFlags = [...red, ...yellow];

  if (allFlags.some(f => f.group === 'missing_docs' && f.title.includes('source document'))) {
    recommendations.push(
      'Obtain and attach source invoices for all undocumented CAM charges before issuing ' +
      'reconciliation statements. Missing documentation is the most common basis for tenant audit challenges.'
    );
  }
  if (red.some(f => f.group === 'red_flags')) {
    recommendations.push(
      'Obtain competitive bids or independent verification for any single-vendor invoice ' +
      'exceeding 40% of the total CAM pool prior to tenant billing.'
    );
  }
  if (allFlags.some(f => f.group === 'duplicates')) {
    recommendations.push(
      'Reconcile suspected duplicate or unusually round-number invoices against the general ' +
      'ledger and executed vendor contracts before finalizing the CAM statement.'
    );
  }
  if (openDisputes.length > 0) {
    recommendations.push(
      `Resolve ${openDisputes.length} open tenant dispute${openDisputes.length > 1 ? 's' : ''} ` +
      'and provide supporting documentation before finalizing reconciliation statements.'
    );
  }
  if (allFlags.some(f => f.group === 'allocation' && f.title.includes('year-over-year'))) {
    recommendations.push(
      'Prepare a written landlord explanation for material year-over-year expense increases. ' +
      'Most standard lease audit rights clauses require this documentation upon tenant request.'
    );
  }
  if (allFlags.some(f => f.group === 'allocation' && f.title.includes('CAM cap'))) {
    recommendations.push(
      'Confirm controllable CAM cap calculations are applied consistently with lease terms ' +
      'and prior-year base amounts for all affected tenants.'
    );
  }
  if (allFlags.some(f => f.group === 'lease')) {
    recommendations.push(
      'Review lease exclusion and ambiguity flags with counsel to ensure category treatment ' +
      'is consistent across all tenant lease agreements.'
    );
  }
  if (allFlags.some(f => f.group === 'missing_docs' && f.title.includes('date'))) {
    recommendations.push(
      `Confirm all invoices include a date falling within the ${camYear} reconciliation period. ` +
      'Undated invoices may be excluded or challenged in a formal audit.'
    );
  }
  if (trends && trends.trends.some(t => t.type === 'vendor' && t.label.includes('New'))) {
    recommendations.push(
      `Retain executed contracts and written authorization for all new vendors added in ${trends.currYear} ` +
      'to substantiate charges in the event of a tenant audit.'
    );
  }
  if (yellow.some(f => f.group === 'allocation' && f.title.includes('unallocated'))) {
    recommendations.push(
      'Review tenant square footage entries — the current unallocated gap represents CAM expenses ' +
      'that cannot be recovered under existing leases without amendment.'
    );
  }
  if (recommendations.length === 0) {
    recommendations.push(
      'No corrective actions required. Retain all supporting invoices and reconciliation workpapers ' +
      'for the statutory audit period (typically three to five years under standard lease audit rights clauses).'
    );
  }

  return {
    headline,
    riskLevel,
    summaryParagraph,
    keyFindings,
    recommendations,
    financialImpact,
    confidence,
  };
}

function renderNarrativePanel() {
  const prev = document.getElementById('narrativePanel');
  if (prev) prev.remove();

  const section = document.getElementById('results');
  if (!section || !lastResults.length) return;

  const n = buildAuditNarrative();

  const riskColor = { Critical: 'red', Elevated: 'yellow', Moderate: 'blue', Low: 'green' }[n.riskLevel] || 'green';

  const riskEmoji = { Critical: '🔴', Elevated: '🟡', Moderate: '🔵', Low: '🟢' }[n.riskLevel];

  const findingsHtml = n.keyFindings.length
    ? `<ul class="an-list">${n.keyFindings.map(f => `<li>${esc(f)}</li>`).join('')}</ul>`
    : '';

  const recsHtml = n.recommendations.length
    ? `<ol class="an-list an-list--recs">${n.recommendations.map(r => `<li>${esc(r)}</li>`).join('')}</ol>`
    : '';

  const panel = document.createElement('div');
  panel.id        = 'narrativePanel';
  panel.className = 'an-panel';
  panel.innerHTML = `
    <div class="an-header">
      <div class="an-header-left">
        <span class="an-icon">&#x1F4CB;</span>
        <div>
          <div class="an-label">AI Auditor Narrative</div>
          <div class="an-headline">${esc(n.headline)}</div>
        </div>
      </div>
      <div class="an-header-right">
        <span class="an-risk an-risk--${riskColor}">${riskEmoji} ${esc(n.riskLevel)} Risk</span>
        <span class="an-conf">${esc(n.confidence)} Confidence</span>
      </div>
    </div>
    <div class="an-body">
      <p class="an-summary">${esc(n.summaryParagraph)}</p>
      ${n.keyFindings.length ? `<div class="an-section-title">Key Findings</div>${findingsHtml}` : ''}
      ${n.recommendations.length ? `<div class="an-section-title">Recommended Actions</div>${recsHtml}` : ''}
      <div class="an-impact-row">
        <span class="an-impact-label">Estimated Financial Exposure</span>
        <span class="an-impact-val">${esc(n.financialImpact)}</span>
      </div>
    </div>`;

  // Insert before auditPanel so narrative sits above the flag detail panel
  const auditPanel = document.getElementById('auditPanel');
  if (auditPanel) {
    section.insertBefore(panel, auditPanel);
  } else {
    section.appendChild(panel);
  }
}

// Builds and injects the AI Audit Panel into the results section.
// Safe to call multiple times — removes any prior panel first.
function renderAuditPanel() {
  const prev = document.getElementById('auditPanel');
  if (prev) prev.remove();

  const section = document.getElementById('results');
  if (!section || !lastResults.length) return;

  const { red, yellow, green } = buildAuditSummary();

  const badge = (n, color) => n > 0
    ? `<span class="ap-badge ap-badge--${color}">${n}</span>`
    : '';

  const flagSection = (flags, color, label) => {
    if (!flags.length) return '';
    return `<div class="ap-section">
      <div class="ap-section-title ap-${color}">${esc(label)} (${flags.length})</div>
      ${flags.map(f => `<div class="ap-flag ap-flag--${color}">
        <div class="ap-flag-title">${esc(f.title)}</div>
        ${f.detail ? `<div class="ap-flag-detail">${esc(f.detail)}</div>` : ''}
        ${f.conditions?.length ? `<ul class="ap-flag-conditions">${f.conditions.map(c => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}
      </div>`).join('')}
    </div>`;
  };

  const panel = document.createElement('div');
  panel.id        = 'auditPanel';
  panel.className = 'ap-panel';
  panel.innerHTML = `
    <div class="ap-header" onclick="
      document.getElementById('apBody').classList.toggle('ap-body--open');
      this.querySelector('.ap-chevron').classList.toggle('ap-chevron--open');
    ">
      <div class="ap-header-left">
        <span class="ap-title">&#x1F50D;&nbsp; AI Audit Summary</span>
      </div>
      <div class="ap-header-right">
        ${badge(red.length, 'red')}
        ${badge(yellow.length, 'yellow')}
        ${badge(green.length, 'green')}
        <span class="ap-chevron">&#x25BC;</span>
      </div>
    </div>
    <div id="apBody" class="ap-body ap-body--open">
      ${flagSection(red,    'red',    'Red Flags')}
      ${flagSection(yellow, 'yellow', 'Yellow Flags')}
      ${flagSection(green,  'green',  'Green Flags')}
    </div>`;

  section.appendChild(panel);
}

// ─── Historical Trends ────────────────────────────────────────────────────────

function buildHistoricalTrends() {
  if (camRuns.length < 2) return null;

  const curr  = camRuns[0];
  // Find the most recent prior run for the same property with a different year
  const prior = camRuns.slice(1).find(r =>
    r.propName === curr.propName && r.camYear !== curr.camYear
  ) || camRuns.slice(1).find(r => r.propName === curr.propName);
  if (!prior) return null;

  const currYear  = curr.camYear  || 'Current';
  const priorYear = prior.camYear || 'Prior';
  const trends    = [];

  // ── Total Expenses trend ───────────────────────────────────────────────────
  if (curr.totalExpenses > 0 && prior.totalExpenses > 0) {
    const diff    = curr.totalExpenses - prior.totalExpenses;
    const pct     = (diff / prior.totalExpenses) * 100;
    const absPct  = Math.abs(pct);
    trends.push({
      type:      'total',
      label:     'Total CAM Expenses',
      currVal:   curr.totalExpenses,
      priorVal:  prior.totalExpenses,
      diff,
      pct,
      direction: diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat',
      severity:  absPct >= 15 ? 'red' : absPct >= 7 ? 'yellow' : 'green',
      note:      absPct >= 15
        ? `${absPct.toFixed(1)}% YoY increase exceeds the 15% materiality threshold — warrants landlord explanation.`
        : absPct >= 7
        ? `${absPct.toFixed(1)}% YoY change — moderate variance, review category drivers.`
        : `${absPct.toFixed(1)}% YoY change — within normal range.`,
    });
  }

  // ── Cost per sqft trend ────────────────────────────────────────────────────
  const currSqft  = curr.sqft  || 0;
  const priorSqft = prior.sqft || 0;
  if (currSqft > 0 && priorSqft > 0 && curr.totalExpenses > 0 && prior.totalExpenses > 0) {
    const currCpSf  = curr.totalExpenses  / currSqft;
    const priorCpSf = prior.totalExpenses / priorSqft;
    const diff      = currCpSf - priorCpSf;
    const pct       = (diff / priorCpSf) * 100;
    const absPct    = Math.abs(pct);
    trends.push({
      type:      'sqft',
      label:     'Cost per Sqft',
      currVal:   currCpSf,
      priorVal:  priorCpSf,
      diff,
      pct,
      direction: diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat',
      severity:  absPct >= 15 ? 'red' : absPct >= 7 ? 'yellow' : 'green',
      note:      `${fmt(currCpSf)}/sqft vs ${fmt(priorCpSf)}/sqft prior year.`,
      isCpSf:    true,
    });
  }

  // ── Per-category trends ────────────────────────────────────────────────────
  const currCats  = curr.categories  || {};
  const priorCats = prior.categories || {};
  if (Object.keys(currCats).length > 0 && Object.keys(priorCats).length > 0) {
    // Categories present in prior but missing now
    Object.keys(priorCats).forEach(cat => {
      if (!currCats[cat] && priorCats[cat] > 500) {
        trends.push({
          type:      'category',
          label:     `Category: ${cat.charAt(0).toUpperCase() + cat.slice(1)}`,
          currVal:   0,
          priorVal:  priorCats[cat],
          diff:      -priorCats[cat],
          pct:       -100,
          direction: 'down',
          severity:  'yellow',
          note:      `${cat} (${fmt(priorCats[cat])}) present in ${priorYear} but absent in ${currYear} — confirm category was legitimately removed or reclassified.`,
        });
      }
    });

    // Significant spikes in existing categories
    Object.keys(currCats).forEach(cat => {
      const c = currCats[cat]  || 0;
      const p = priorCats[cat] || 0;
      if (p < 100) return; // ignore categories with tiny prior-year base
      const diff   = c - p;
      const pct    = (diff / p) * 100;
      const absPct = Math.abs(pct);
      if (absPct >= 20) {
        trends.push({
          type:      'category',
          label:     `Category: ${cat.charAt(0).toUpperCase() + cat.slice(1)}`,
          currVal:   c,
          priorVal:  p,
          diff,
          pct,
          direction: diff > 0 ? 'up' : 'down',
          severity:  absPct >= 40 ? 'red' : 'yellow',
          note:      `${absPct.toFixed(0)}% YoY ${diff > 0 ? 'increase' : 'decrease'} — ${fmt(c)} vs ${fmt(p)} prior year.${absPct >= 40 ? ' Potential controllable CAM cap exposure.' : ''}`,
        });
      }
    });
  }

  // ── New vendor detection ───────────────────────────────────────────────────
  const currVendors  = curr.vendors  || {};
  const priorVendors = prior.vendors || {};
  if (Object.keys(currVendors).length > 0 && Object.keys(priorVendors).length > 0) {
    const newVendors = Object.keys(currVendors).filter(v =>
      !priorVendors[v] && currVendors[v] >= 1000
    );
    if (newVendors.length > 0) {
      const topNew = newVendors
        .sort((a, b) => currVendors[b] - currVendors[a])
        .slice(0, 3);
      trends.push({
        type:      'vendor',
        label:     `New Vendor${topNew.length > 1 ? 's' : ''} Detected`,
        currVal:   null,
        priorVal:  null,
        direction: 'up',
        severity:  topNew.some(v => currVendors[v] >= 5000) ? 'yellow' : 'green',
        note:      `${newVendors.length} new vendor${newVendors.length > 1 ? 's' : ''} not present in ${priorYear}: ${topNew.map(v => `${v} (${fmt(currVendors[v])})`).join(', ')}${newVendors.length > 3 ? ` +${newVendors.length - 3} more` : ''}.`,
        vendors:   topNew,
      });
    }

    // Recurring vendors that disappeared
    const goneVendors = Object.keys(priorVendors).filter(v =>
      !currVendors[v] && priorVendors[v] >= 2000
    );
    if (goneVendors.length > 0) {
      const topGone = goneVendors
        .sort((a, b) => priorVendors[b] - priorVendors[a])
        .slice(0, 3);
      trends.push({
        type:      'vendor',
        label:     `Recurring Vendor${topGone.length > 1 ? 's' : ''} Missing`,
        currVal:   null,
        priorVal:  null,
        direction: 'down',
        severity:  'yellow',
        note:      `${goneVendors.length} vendor${goneVendors.length > 1 ? 's' : ''} from ${priorYear} absent in ${currYear}: ${topGone.map(v => `${v} (${fmt(priorVendors[v])})`).join(', ')}${goneVendors.length > 3 ? ` +${goneVendors.length - 3} more` : ''}.`,
      });
    }
  }

  // ── Tenant count change ────────────────────────────────────────────────────
  if (curr.tenantCount !== prior.tenantCount) {
    const diff = curr.tenantCount - prior.tenantCount;
    trends.push({
      type:      'tenant',
      label:     'Tenant Count',
      currVal:   curr.tenantCount,
      priorVal:  prior.tenantCount,
      diff,
      pct:       (diff / Math.max(prior.tenantCount, 1)) * 100,
      direction: diff > 0 ? 'up' : 'down',
      severity:  'yellow',
      note:      `${Math.abs(diff)} tenant${Math.abs(diff) > 1 ? 's' : ''} ${diff > 0 ? 'added' : 'removed'} since ${priorYear} — verify pro-rata denominators reflect current lease roll.`,
    });
  }

  return { trends, currYear, priorYear };
}

function renderHistoricalTrendsPanel() {
  const prev = document.getElementById('trendsPanel');
  if (prev) prev.remove();

  const section = document.getElementById('results');
  if (!section || !lastResults.length) return;

  const data = buildHistoricalTrends();
  if (!data || data.trends.length === 0) return;

  const { trends, currYear, priorYear } = data;

  const dirIcon = t => {
    if (t.direction === 'up')   return '<span class="ht-dir ht-dir--up">&#x2191;</span>';
    if (t.direction === 'down') return '<span class="ht-dir ht-dir--down">&#x2193;</span>';
    return '<span class="ht-dir ht-dir--flat">&#x25CF;</span>';
  };

  const valDisplay = t => {
    if (t.type === 'vendor') return '';
    if (t.isCpSf) {
      return `<span class="ht-vals">${fmt(t.currVal)}/sqft <span class="ht-sep">vs</span> ${fmt(t.priorVal)}/sqft</span>`;
    }
    if (t.type === 'tenant') {
      return `<span class="ht-vals">${t.currVal} <span class="ht-sep">vs</span> ${t.priorVal}</span>`;
    }
    const sign = t.diff > 0 ? '+' : '';
    const pctStr = t.pct != null ? ` (${sign}${t.pct.toFixed(1)}%)` : '';
    return `<span class="ht-vals">${fmt(t.currVal)} <span class="ht-sep">vs</span> ${fmt(t.priorVal)}${pctStr}</span>`;
  };

  const rows = trends.map(t => `
    <div class="ht-row ht-row--${t.severity}">
      <div class="ht-row-left">
        ${dirIcon(t)}
        <div class="ht-row-text">
          <div class="ht-row-label">${esc(t.label)}</div>
          ${valDisplay(t)}
        </div>
      </div>
      <div class="ht-row-note">${esc(t.note)}</div>
    </div>`).join('');

  const redCount    = trends.filter(t => t.severity === 'red').length;
  const yellowCount = trends.filter(t => t.severity === 'yellow').length;
  const greenCount  = trends.filter(t => t.severity === 'green').length;

  const badge = (n, color) => n > 0
    ? `<span class="ap-badge ap-badge--${color}">${n}</span>`
    : '';

  const panel = document.createElement('div');
  panel.id        = 'trendsPanel';
  panel.className = 'ap-panel';
  panel.innerHTML = `
    <div class="ap-header" onclick="
      document.getElementById('htBody').classList.toggle('ap-body--open');
      this.querySelector('.ap-chevron').classList.toggle('ap-chevron--open');
    ">
      <div class="ap-header-left">
        <span class="ap-title">&#x1F4C8;&nbsp; Historical Trends &mdash; ${esc(String(priorYear))} &rarr; ${esc(String(currYear))}</span>
      </div>
      <div class="ap-header-right">
        ${badge(redCount, 'red')}
        ${badge(yellowCount, 'yellow')}
        ${badge(greenCount, 'green')}
        <span class="ap-chevron">&#x25BC;</span>
      </div>
    </div>
    <div id="htBody" class="ap-body ap-body--open">
      <div class="ht-rows">${rows}</div>
    </div>`;

  section.appendChild(panel);
}

// ─── Activity Timeline ────────────────────────────────────────────────────────

function buildActivityTimeline() {
  return [...activityLog]; // already newest-first
}

function renderActivityTimeline() {
  const prev = document.getElementById('timelinePanel');
  if (prev) prev.remove();

  const section = document.getElementById('results');
  if (!section || !lastResults.length) return;

  const events = buildActivityTimeline();
  if (!events.length) return;

  const severityDot = sev => {
    const cls = { error: 'tl-dot--red', warning: 'tl-dot--yellow', success: 'tl-dot--green', info: 'tl-dot--blue' }[sev] || 'tl-dot--blue';
    return `<div class="tl-dot ${cls}"></div>`;
  };

  const fmtTs = ts => {
    const d = new Date(ts);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      + ' at ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  };

  const typeLabel = {
    property_created:      'Property',
    lease_uploaded:        'Lease',
    invoice_uploaded:      'Invoice',
    gl_uploaded:           'GL',
    reconciliation_run:    'CAM Run',
    reconciliation_rerun:  'CAM Rerun',
    audit_generated:       'Audit',
    historical_comparison: 'Trends',
    tenant_statement:      'Report',
    exception_report:      'Report',
    reconciliation_summary:'Report',
    dispute_opened:        'Dispute',
    dispute_resolved:      'Dispute',
    docs_requested:        'Docs',
  };

  const rows = events.map((ev, idx) => {
    const isLast = idx === events.length - 1;
    const lbl = typeLabel[ev.type] || 'Event';
    const actorHtml = (ev.actor && ev.actor !== 'System')
      ? `<span class="tl-actor">${esc(ev.actor)}</span>`
      : '';
    const impactHtml = ev.financialImpact
      ? `<span class="tl-impact">${esc(ev.financialImpact)}</span>`
      : '';
    const entityHtml = ev.relatedEntity
      ? `<span class="tl-entity">${esc(ev.relatedEntity)}</span>`
      : '';
    return `<div class="tl-item">
      <div class="tl-track">
        ${severityDot(ev.severity)}
        ${!isLast ? '<div class="tl-line"></div>' : ''}
      </div>
      <div class="tl-content">
        <div class="tl-top">
          <span class="tl-type-badge">${esc(lbl)}</span>
          <span class="tl-title">${esc(ev.title)}</span>
          ${impactHtml}
        </div>
        ${ev.detail ? `<div class="tl-detail">${esc(ev.detail)}</div>` : ''}
        <div class="tl-meta">
          <span class="tl-ts">${fmtTs(ev.timestamp)}</span>
          ${actorHtml}
          ${entityHtml}
        </div>
      </div>
    </div>`;
  }).join('');

  const panel = document.createElement('div');
  panel.id        = 'timelinePanel';
  panel.className = 'ap-panel';
  panel.innerHTML = `
    <div class="ap-header" onclick="
      document.getElementById('tlBody').classList.toggle('ap-body--open');
      this.querySelector('.ap-chevron').classList.toggle('ap-chevron--open');
    ">
      <div class="ap-header-left">
        <span class="ap-title">&#x1F4C5;&nbsp; Activity Timeline &mdash; ${esc(String(events.length))} event${events.length !== 1 ? 's' : ''}</span>
      </div>
      <div class="ap-header-right">
        <span class="ap-chevron">&#x25BC;</span>
      </div>
    </div>
    <div id="tlBody" class="ap-body">
      <div class="tl-list">${rows}</div>
    </div>`;

  section.appendChild(panel);
}

// ─── Reports ──────────────────────────────────────────────────────────────────

function showReportSection() {
  // Update the notice + tenant buttons after allocation runs
  const msg  = document.getElementById('reportsMsg');
  const wrap = document.getElementById('tenantReportButtons');

  if (!lastResults.length) {
    msg.style.display  = 'block';
    wrap.innerHTML = '';
    return;
  }

  msg.style.display = 'none';

  let html = '<div style="font-size:0.8rem;color:#64748b;margin-bottom:8px;">Tenant Statements</div>';
  html += '<div class="report-btn-row">';
  // Count name occurrences so duplicates get sqft disambiguation
  const _rNameCount = {};
  lastResults.forEach(r => { _rNameCount[r.name] = (_rNameCount[r.name] || 0) + 1; });
  lastResults.forEach(r => {
    const isDup = (_rNameCount[r.name] || 0) > 1;
    const t = lastTenants.find(x => x.name === r.name);
    const label = isDup && t?.leasedSqft
      ? `${r.name} (${Number(t.leasedSqft).toLocaleString()} sqft)`
      : r.name;
    html += `<button class="tenant-report-btn" onclick="generateTenantStatement('${esc(r.name)}')">${esc(label)}</button>`;
  });
  html += '</div>';
  wrap.innerHTML = html;
}

function guardedMasterReport() {
  if (!lastResults.length) {
    const msg = document.getElementById('reportsMsg');
    msg.style.display = 'block';
    msg.textContent = 'Please run a CAM allocation first to generate reports.';
    msg.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    return;
  }
  generateMasterReport();
}

function guardedTenantStatement() {
  if (!lastResults.length) {
    const msg = document.getElementById('reportsMsg');
    msg.style.display = 'block';
    msg.textContent = 'Please run a CAM allocation first to generate reports.';
    msg.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    return;
  }
  // If only one tenant, open directly; otherwise prompt via the tenant buttons
  if (lastResults.length === 1) {
    generateTenantStatement(lastResults[0].name);
  } else {
    const msg = document.getElementById('reportsMsg');
    msg.style.display = 'block';
    msg.textContent = 'Select a tenant below to generate their statement.';
    document.getElementById('tenantReportButtons').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

// ─── Shared report primitives ─────────────────────────────────────────────────

function _rptHeader(propName, reportType, period, now, extra = []) {
  const metaItems = [
    { label: 'Period',    value: period },
    { label: 'Generated', value: now    },
    ...extra,
  ].map(m => `<div class="rpt-cover-meta-item">
      <span>${esc(String(m.label))}</span>
      <span>${esc(String(m.value))}</span>
    </div>`).join('');
  return `<div class="rpt-cover">
    <div class="rpt-cover-brand">Mainstreet CAM Platform</div>
    <div class="rpt-cover-title">${esc(propName)}</div>
    <div class="rpt-cover-type">${esc(reportType)}</div>
    <div class="rpt-cover-meta">${metaItems}</div>
  </div>`;
}

function _rptFooter(propName, reportType, now) {
  return `<div class="rpt-footer">
    <span class="rpt-footer-brand">Mainstreet CAM Platform</span>
    <span>${esc(propName)} &nbsp;&middot;&nbsp; ${esc(reportType)}</span>
    <span>Generated ${esc(now)}</span>
  </div>`;
}

// ─── Monthly Holes Report ─────────────────────────────────────────────────────

function generateHolesReport() {
  const propName = document.getElementById('propertyName').value.trim() || 'Property';
  const now      = new Date().toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' });
  const month    = new Date().toLocaleDateString('en-US', { year:'numeric', month:'long' });

  const criticalItems = [];
  const warningItems  = [];

  // ── 1. Missing categories vs. last reconciliation ──────────────────────────
  // prevCats: categories seen in the last allocation run
  // currCats: categories present in currently uploaded invoices
  const prevCats = [...new Set(lastInvoicesFull.map(inv => inv.category).filter(Boolean))];
  const currCats = [...new Set(
    invoiceData.filter(inv => inv && !inv._error && inv.category).map(inv => inv.category)
  )];

  if (prevCats.length > 0) {
    prevCats.forEach(cat => {
      if (!currCats.includes(cat)) {
        const prevTotal = lastInvoicesFull
          .filter(inv => inv.category === cat)
          .reduce((s, inv) => s + (parseFloat(inv.amount) || 0), 0);
        criticalItems.push({
          icon: '🚫',
          text: `No <strong>${esc(cat)}</strong> invoice found this month`,
          detail: prevTotal > 0
            ? `Last reconciliation total: ${fmt(prevTotal)} — verify if expense still applies`
            : 'Was present in last reconciliation',
        });
      }
    });
  }

  // ── 2. Missing regular vendors ────────────────────────────────────────────
  const prevVendors = [...new Set(lastInvoicesFull.map(inv => inv.vendor).filter(Boolean))];
  const currVendors = invoiceData
    .filter(inv => inv && !inv._error && inv.vendorName)
    .map(inv => inv.vendorName);

  prevVendors.forEach(vendor => {
    const stillPresent = currVendors.some(v => similarVendor(v, vendor));
    if (!stillPresent) {
      const lastAmt = lastInvoicesFull
        .filter(inv => inv.vendor === vendor)
        .reduce((s, inv) => s + (parseFloat(inv.amount) || 0), 0);
      criticalItems.push({
        icon: '🏢',
        text: `<strong>${esc(vendor)}</strong> has not submitted an invoice this month`,
        detail: lastAmt > 0 ? `Last invoice total: ${fmt(lastAmt)}` : 'Was present in last reconciliation',
      });
    }
  });

  if (prevCats.length === 0 && prevVendors.length === 0) {
    // No prior reconciliation to compare against — note it as a warning
    warningItems.push({
      icon: '📋',
      text: 'No previous reconciliation data available for comparison',
      detail: 'Run a CAM allocation first to enable month-over-month gap detection',
    });
  }

  // ── 3. Tenants with no lease uploaded ────────────────────────────────────
  const validTenants = tenantData.filter(t => t && !t._error && t.tenant_name && parseSqft(t.leased_sqft) > 0);
  const errorTenants = tenantData.filter(t => t && t._error);
  const emptySlots   = tenantData.filter(t => t === null).length;

  if (validTenants.length === 0 && tenantData.length === 0) {
    warningItems.push({
      icon: '👤',
      text: 'No tenant leases uploaded',
      detail: 'Upload at least one lease in Section 2 before running allocation',
    });
  }
  errorTenants.forEach(t => {
    warningItems.push({
      icon: '⚠️',
      text: `Lease extraction failed for <strong>${esc(t.tenant_name || 'unknown tenant')}</strong>`,
      detail: t._error,
    });
  });
  if (emptySlots > 0 && tenantData.some(t => t === null)) {
    // Only flag empty slots if we're in single-lease mode (fixed 3-slot array)
    // and some real tenants exist (mixed state)
    if (validTenants.length > 0) {
      warningItems.push({
        icon: '👤',
        text: `${emptySlots} tenant slot${emptySlots !== 1 ? 's' : ''} still empty`,
        detail: 'Upload leases for all tenants or remove unused slots before reconciling',
      });
    }
  }

  // ── 4. Low-confidence invoices not reviewed ───────────────────────────────
  invoiceData.forEach((inv, i) => {
    if (!inv) return;
    if (inv._error) {
      warningItems.push({
        icon: '🔴',
        text: `Invoice ${i + 1}: extraction failed — <strong>${esc(inv.vendorName || 'unknown vendor')}</strong>`,
        detail: inv._error,
      });
      return;
    }
    const conf   = inv.confidence || {};
    const scores = Object.values(conf).filter(s => typeof s === 'number');
    const minScore = scores.length ? Math.min(...scores) : null;
    if (minScore !== null && minScore < 70) {
      const fieldNames = Object.entries(conf)
        .filter(([, v]) => typeof v === 'number' && v < 70)
        .map(([k]) => k);
      warningItems.push({
        icon: '⚠️',
        text: `Invoice ${i + 1} — <strong>${esc(inv.vendorName || 'unknown vendor')}</strong> has low confidence fields`,
        detail: `Low confidence on: ${fieldNames.join(', ')} (min score: ${minScore}%) — please verify before allocating`,
      });
    }
  });

  // ── Build HTML ────────────────────────────────────────────────────────────
  const totalIssues = criticalItems.length + warningItems.length;

  function renderItems(items) {
    if (!items.length) return '';
    return items.map(it => `
      <div class="hole-item ${it.severity || (it === criticalItems[criticalItems.indexOf(it)] ? 'critical' : 'warning')}">
        <span class="hole-icon">${it.icon}</span>
        <span class="hole-text">
          ${it.text}
          ${it.detail ? `<span class="hole-detail">${esc(it.detail)}</span>` : ''}
        </span>
      </div>`).join('');
  }

  // Tag severity explicitly
  criticalItems.forEach(it => { it.severity = 'critical'; });
  warningItems.forEach(it => { it.severity = 'warning'; });

  const missingSection = criticalItems.length ? `
    <div class="holes-group">
      <div class="holes-group-title">&#x1F6AB; Missing Items</div>
      ${criticalItems.map(it => `
        <div class="hole-item critical">
          <span class="hole-icon">${it.icon}</span>
          <span class="hole-text">
            ${it.text}
            ${it.detail ? `<span class="hole-detail">${esc(it.detail)}</span>` : ''}
          </span>
        </div>`).join('')}
    </div>` : `
    <div class="holes-group">
      <div class="holes-group-title">&#x1F6AB; Missing Items</div>
      <div class="hole-item ok">
        <span class="hole-icon">&#x2705;</span>
        <span class="hole-text">No missing categories or vendors detected</span>
      </div>
    </div>`;

  const incompleteSection = warningItems.length ? `
    <div class="holes-group">
      <div class="holes-group-title">&#x26A0;&#xFE0F; Incomplete Items</div>
      ${warningItems.map(it => `
        <div class="hole-item warning">
          <span class="hole-icon">${it.icon}</span>
          <span class="hole-text">
            ${it.text}
            ${it.detail ? `<span class="hole-detail">${esc(it.detail)}</span>` : ''}
          </span>
        </div>`).join('')}
    </div>` : `
    <div class="holes-group">
      <div class="holes-group-title">&#x26A0;&#xFE0F; Incomplete Items</div>
      <div class="hole-item ok">
        <span class="hole-icon">&#x2705;</span>
        <span class="hole-text">All tenants and invoices look complete</span>
      </div>
    </div>`;

  const summaryBar = totalIssues === 0 ? `
    <div class="holes-summary-bar all-clear">
      <div class="holes-summary-count">&#x2713;</div>
      <div class="holes-summary-msg">Everything looks good — ready to run reconciliation</div>
    </div>` : `
    <div class="holes-summary-bar has-issues">
      <div class="holes-summary-count">${totalIssues}</div>
      <div class="holes-summary-msg">
        ${totalIssues} item${totalIssues !== 1 ? 's' : ''} need${totalIssues === 1 ? 's' : ''} attention before running reconciliation
        <span style="display:block;font-size:0.78rem;font-weight:400;margin-top:2px;opacity:0.8;">
          ${criticalItems.length} critical &nbsp;·&nbsp; ${warningItems.length} warning${warningItems.length !== 1 ? 's' : ''}
        </span>
      </div>
    </div>`;

  const html = `
    <div class="rpt-letterhead">
      <h1>${esc(propName)}</h1>
      <div class="rpt-sub">Monthly Holes Report &nbsp;·&nbsp; ${month} &nbsp;·&nbsp; Generated ${now}</div>
    </div>

    <div class="rpt-kpi-row">
      <div class="rpt-kpi">
        <div class="kpi-val" style="color:${criticalItems.length > 0 ? '#be123c' : '#15803d'}">${criticalItems.length}</div>
        <div class="kpi-lbl">Critical Missing</div>
      </div>
      <div class="rpt-kpi">
        <div class="kpi-val" style="color:${warningItems.length > 0 ? '#92400e' : '#15803d'}">${warningItems.length}</div>
        <div class="kpi-lbl">Warnings</div>
      </div>
      <div class="rpt-kpi">
        <div class="kpi-val">${validTenants.length}</div>
        <div class="kpi-lbl">Leases Uploaded</div>
      </div>
      <div class="rpt-kpi">
        <div class="kpi-val">${invoiceData.filter(inv => inv && !inv._error).length}</div>
        <div class="kpi-lbl">Invoices Loaded</div>
      </div>
    </div>

    ${missingSection}
    ${incompleteSection}
    ${summaryBar}

    <div class="rpt-footer">
      Mainstreet &nbsp;·&nbsp; ${esc(propName)} &nbsp;·&nbsp; Monthly Holes Report &nbsp;·&nbsp; ${now}
    </div>`;

  openReport('Monthly Holes Report — ' + propName, html);
}

function openReport(title, bodyHtml) {
  document.getElementById('rptToolbarTitle').textContent = title;
  document.getElementById('rptBody').innerHTML = bodyHtml;
  document.getElementById('reportOverlay').style.display = 'block';
  window.scrollTo(0, 0);
}

function closeReport() {
  document.getElementById('reportOverlay').style.display = 'none';
}

// ─── Reconciliation Summary Report ───────────────────────────────────────────

function guardedReconciliationSummary() {
  if (!lastResults.length) {
    const msg = document.getElementById('reportsMsg');
    msg.style.display = 'block';
    msg.textContent = 'Please run a CAM allocation first to generate reports.';
    msg.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    return;
  }
  generateReconciliationSummary();
}

function generateReconciliationSummary() {
  try {
  logActivity('reconciliation_summary', 'Reconciliation Summary report generated', { severity: 'info', actor: 'User', relatedEntity: lastPropName || 'Property' });
  const propName   = lastPropName || 'Property';
  const now        = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const period     = (getCamYear() || new Date().getFullYear()) + ' CAM Year';
  const totalBilled = lastResults.reduce((s, r) => s + r.allocatedAmount, 0);
  const prop       = currentProperty();
  const propSqft   = parseFloat(prop?.totalSqft || prop?.totalSqFt) || 0;
  const avgPerTenant = lastTotal / Math.max(lastResults.length, 1);

  const catTotals = {};
  lastInvoicesFull.forEach(inv => {
    catTotals[inv.category] = (catTotals[inv.category] || 0) + inv.amount;
  });

  const tenantRows = lastResults.map(r => {
    const capNote = r.capApplied
      ? ` <span style="font-size:0.72rem;color:#f59e0b;">(cap &minus;${fmt(r.capAdjustment)})</span>`
      : '';
    return `<tr>
      <td>${esc(r.name)}</td>
      <td style="text-align:right">${r.sqFt ? Number(r.sqFt).toLocaleString() : '—'}</td>
      <td style="text-align:right">${(r.proRata * 100).toFixed(2)}%</td>
      <td style="text-align:right">${fmt(r.allocatedAmount)}${capNote}</td>
    </tr>`;
  }).join('');

  const catRows = Object.entries(catTotals)
    .sort((a, b) => b[1] - a[1])
    .map(([cat, amt]) => `<tr>
      <td style="text-transform:capitalize">${esc(cat)}</td>
      <td style="text-align:right">${lastInvoicesFull.filter(i => i.category === cat).length}</td>
      <td style="text-align:right">${fmt(amt)}</td>
      <td style="text-align:right">${((amt / lastTotal) * 100).toFixed(1)}%</td>
    </tr>`).join('');

  const html = `
    ${_rptHeader(propName, 'CAM Reconciliation Summary', period, now, [
      { label: 'Property sqft', value: propSqft > 0 ? propSqft.toLocaleString() + ' sqft' : '—' },
      { label: 'Tenants',       value: lastResults.length },
    ])}

    <div class="rpt-kpi-row">
      <div class="rpt-kpi"><div class="kpi-val">${fmt(lastTotal)}</div><div class="kpi-lbl">Total Expenses</div></div>
      <div class="rpt-kpi"><div class="kpi-val">${fmt(totalBilled)}</div><div class="kpi-lbl">Total CAM Billed</div></div>
      <div class="rpt-kpi"><div class="kpi-val">${lastResults.length}</div><div class="kpi-lbl">Tenants</div></div>
      <div class="rpt-kpi"><div class="kpi-val">${lastInvoicesFull.length}</div><div class="kpi-lbl">Invoices</div></div>
      <div class="rpt-kpi"><div class="kpi-val">${fmt(avgPerTenant)}</div><div class="kpi-lbl">Avg / Tenant</div></div>
    </div>

    <div class="rpt-section-title">Tenant Allocation</div>
    <table class="rpt-table">
      <thead><tr>
        <th>Tenant</th>
        <th style="text-align:right">Leased sqft</th>
        <th style="text-align:right">Pro-Rata %</th>
        <th style="text-align:right">CAM Billed</th>
      </tr></thead>
      <tbody>${tenantRows}</tbody>
      <tfoot><tr class="total-row">
        <td>TOTAL</td>
        <td style="text-align:right">${propSqft > 0 ? propSqft.toLocaleString() : '—'}</td>
        <td></td>
        <td style="text-align:right">${fmt(totalBilled)}</td>
      </tr></tfoot>
    </table>

    <div class="rpt-section-title">Expense Categories</div>
    <table class="rpt-table">
      <thead><tr>
        <th>Category</th>
        <th style="text-align:right">Invoices</th>
        <th style="text-align:right">Amount</th>
        <th style="text-align:right">% of Total</th>
      </tr></thead>
      <tbody>${catRows}</tbody>
      <tfoot><tr class="total-row">
        <td>TOTAL</td>
        <td style="text-align:right">${lastInvoicesFull.length}</td>
        <td style="text-align:right">${fmt(lastTotal)}</td>
        <td style="text-align:right">100%</td>
      </tr></tfoot>
    </table>

    ${_rptFooter(propName, 'CAM Reconciliation Summary', now)}`;

  openReport('Reconciliation Summary — ' + propName, html);
  } catch (e) {
    logError('generateReconciliationSummary', e, { propName: lastPropName });
    showToast('Could not generate Reconciliation Summary — check console for details.', { color: '#92400e', textColor: '#fef3c7' });
  }
}

// ─── Audit Exception Summary Report ──────────────────────────────────────────

function guardedExceptionReport() {
  if (!lastResults.length) {
    const msg = document.getElementById('reportsMsg');
    msg.style.display = 'block';
    msg.textContent = 'Please run a CAM allocation first to generate reports.';
    msg.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    return;
  }
  generateExceptionReport();
}

function generateExceptionReport() {
  try {
  logActivity('exception_report', 'Audit Exception Summary report generated', { severity: 'info', actor: 'User', relatedEntity: lastPropName || 'Property' });
  const { red, yellow, green } = buildAuditSummary();
  const propName = lastPropName || 'Property';
  const now      = new Date().toLocaleString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const period   = (getCamYear() || new Date().getFullYear()) + ' CAM Year';

  // All actionable flags with severity tag
  const allFlags = [
    ...red.map(f    => ({ ...f, severity: 'red'    })),
    ...yellow.map(f => ({ ...f, severity: 'yellow' })),
  ];

  // Six semantic groups; ungrouped flags fall into severity catch-alls
  const GROUPS = [
    { key: 'red_flags',    label: 'Critical Red Flags',               icon: '&#x1F534;' },
    { key: 'duplicates',   label: 'Duplicate / Suspicious Invoices',  icon: '&#x1F4CB;' },
    { key: 'missing_docs', label: 'Missing Documentation',            icon: '&#x1F4CE;' },
    { key: 'allocation',   label: 'Allocation Warnings',              icon: '&#x2696;'  },
    { key: 'lease',        label: 'Lease Conflicts',                  icon: '&#x1F4C4;' },
    { key: 'other',        label: 'Other Warnings',                   icon: '&#x26A0;'  },
  ];

  const buckets = {};
  GROUPS.forEach(g => { buckets[g.key] = []; });
  allFlags.forEach(f => {
    const key = f.group && buckets[f.group] ? f.group : (f.severity === 'red' ? 'red_flags' : 'other');
    buckets[key].push(f);
  });

  const renderFlag = f => {
    const sevLabel = f.severity === 'red' ? 'Critical' : 'Warning';
    return `<div class="exc-flag exc-flag--${f.severity}">
      <div class="exc-flag-header">
        <span class="exc-sev exc-sev--${f.severity}">${sevLabel}</span>
        <span class="exc-flag-title">${esc(f.title)}</span>
      </div>
      ${f.detail ? `<div class="exc-flag-detail">${esc(f.detail)}</div>` : ''}
      ${f.conditions?.length ? `<ul class="exc-conditions">${f.conditions.map(c => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}
    </div>`;
  };

  const sections = GROUPS.map(g => {
    const flags = buckets[g.key];
    if (!flags.length) return '';
    return `<div class="rpt-section-title">${g.icon}&nbsp; ${esc(g.label)} (${flags.length})</div>
      <div class="exc-flag-list">${flags.map(renderFlag).join('')}</div>`;
  }).join('');

  const noExceptions = allFlags.length === 0;
  const body = noExceptions
    ? `<div class="exc-clean-state">
        <div class="exc-clean-icon">&#x2705;</div>
        <div class="exc-clean-title">No critical exceptions detected</div>
        <div class="exc-clean-sub">All ${green.length} audit check${green.length !== 1 ? 's' : ''} passed. No red or yellow flags were raised for this reconciliation.</div>
      </div>`
    : sections;

  const html = `
    ${_rptHeader(propName, 'Audit Exception Summary', period, now, [
      { label: 'Flags Raised', value: red.length + yellow.length },
      { label: 'Checks Passed', value: green.length },
    ])}

    <div class="rpt-kpi-row">
      <div class="rpt-kpi">
        <div class="kpi-val" style="color:${red.length > 0 ? '#f87171' : '#4ade80'}">${red.length}</div>
        <div class="kpi-lbl">Critical Flags</div>
      </div>
      <div class="rpt-kpi">
        <div class="kpi-val" style="color:${yellow.length > 0 ? '#fbbf24' : '#4ade80'}">${yellow.length}</div>
        <div class="kpi-lbl">Warnings</div>
      </div>
      <div class="rpt-kpi">
        <div class="kpi-val" style="color:#4ade80">${green.length}</div>
        <div class="kpi-lbl">Passed Checks</div>
      </div>
      <div class="rpt-kpi">
        <div class="kpi-val">${red.length + yellow.length + green.length}</div>
        <div class="kpi-lbl">Total Checks</div>
      </div>
    </div>

    ${body}

    ${_rptFooter(propName, 'Audit Exception Summary', now)}`;

  openReport('Audit Exception Summary — ' + propName, html);
  } catch (e) {
    logError('generateExceptionReport', e, { propName: lastPropName });
    showToast('Could not generate Exception Report — check console for details.', { color: '#92400e', textColor: '#fef3c7' });
  }
}

function generateMasterReport() {
  if (!lastResults.length) { showToast('Run a CAM allocation first to generate reports.', { color: '#92400e', textColor: '#fef3c7' }); return; }
  try {

  const now    = new Date().toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' });
  const period = new Date().getFullYear() + ' CAM Year';

  // Category breakdown
  const catTotals = {};
  lastInvoicesFull.forEach(inv => {
    catTotals[inv.category] = (catTotals[inv.category] || 0) + inv.amount;
  });

  // Dispute counts per tenant
  function disputeCount(tenantName) {
    return disputes.filter(d => d.tenantName === tenantName).length;
  }
  function openDisputeCount(tenantName) {
    return disputes.filter(d => d.tenantName === tenantName && d.status === 'open').length;
  }

  const totalBilled = lastResults.reduce((s, r) => s + r.allocatedAmount, 0);

  // AI Risk classification — map confidence scores to risk buckets
  const riskInvoices = invoiceData.filter(inv => inv && !inv._error && inv.vendorName && parseFloat(inv.amount) > 0);
  let riskGreen = 0, riskYellow = 0, riskRed = 0;
  riskInvoices.forEach(inv => {
    const conf = inv.confidence || {};
    const scores = [conf.vendorName, conf.amount, conf.category].filter(s => s != null);
    const minScore = scores.length ? Math.min(...scores) : 0;
    const flagged = minScore < 90 || inv.category === 'other' || !inv.invoiceDate;
    const openDispute = disputes.some(d => d.vendor === inv.vendorName && d.status === 'open');
    if (openDispute) riskRed++;
    else if (flagged) riskYellow++;
    else riskGreen++;
  });

  // Tenant summary table rows
  const tenantRows = lastResults.map(r => {
    const dc = disputeCount(r.name);
    const oc = openDisputeCount(r.name);
    return `<tr data-tenant-name="${esc(r.name)}">
      <td><span class="rpt-tenant-link" onclick="openReportTenantDetail('${esc(r.name)}')">${esc(r.name)}</span></td>
      <td style="text-align:right">${fmt(r.allocatedAmount)}</td>
      <td style="text-align:right">${(r.proRata * 100).toFixed(2)}%</td>
      <td style="text-align:center">${dc > 0
        ? `<span class="rpt-pill ${oc > 0 ? 'open' : 'closed'}">${dc} (${oc} open)</span>`
        : '—'}</td>
    </tr>`;
  }).join('');

  // Expense breakdown rows
  const expRows = Object.entries(catTotals).map(([cat, amt]) => `
    <tr>
      <td style="text-transform:capitalize">${esc(cat)}</td>
      <td style="text-align:right">${lastInvoicesFull.filter(i => i.category === cat).length}</td>
      <td style="text-align:right">${fmt(amt)}</td>
      <td style="text-align:right">${((amt / lastTotal) * 100).toFixed(1)}%</td>
    </tr>`).join('');

  // Report hash
  sha256({ propName: lastPropName, total: lastTotal, tenants: lastResults.map(r => r.name), generated: now })
    .then(hash => {
      document.querySelector('.rpt-hash-val').textContent =
        'SHA-256: ' + hash + '\nGenerated: ' + new Date().toISOString();
    });

  const html = `
    ${_rptHeader(lastPropName, 'Landlord Master CAM Report', period, now, [
      { label: 'Tenants',        value: lastResults.length },
      { label: 'Total Expenses', value: fmt(lastTotal) },
    ])}

    <div class="ai-risk-box">
      <div class="ai-risk-title">&#x1F9E0; AI Risk Review — Building Summary</div>
      <div class="ai-risk-row"><span>&#x1F7E2;</span><span><strong>${riskGreen}</strong> charge${riskGreen !== 1 ? 's' : ''} look standard — no action needed</span></div>
      <div class="ai-risk-row"><span>&#x1F7E1;</span><span><strong>${riskYellow}</strong> charge${riskYellow !== 1 ? 's' : ''} may get tenant questions</span></div>
      <div class="ai-risk-row"><span>&#x1F534;</span><span><strong>${riskRed}</strong> charge${riskRed !== 1 ? 's' : ''} linked to open disputes</span></div>
      <div id="aiRiskDetail"></div>
      ${riskYellow + riskRed > 0 ? `<button class="ai-run-btn" onclick="runLandlordAIReview()">&#x1F9E0; Run AI Review on Flagged Charges</button>` : ''}
    </div>

    <div class="rpt-kpi-row">
      <div class="rpt-kpi">
        <div class="kpi-val">${fmt(lastTotal)}</div>
        <div class="kpi-lbl">Total Expenses</div>
      </div>
      <div class="rpt-kpi">
        <div class="kpi-val">${fmt(totalBilled)}</div>
        <div class="kpi-lbl">Total CAM Billed</div>
      </div>
      <div class="rpt-kpi">
        <div class="kpi-val">${lastResults.length}</div>
        <div class="kpi-lbl">Tenants</div>
      </div>
      <div class="rpt-kpi">
        <div class="kpi-val">${lastInvoicesFull.length}</div>
        <div class="kpi-lbl">Invoices</div>
      </div>
      <div class="rpt-kpi">
        <div class="kpi-val">${disputes.length}</div>
        <div class="kpi-lbl">Total Disputes</div>
      </div>
    </div>

    <div class="rpt-section-title">Tenant Summary</div>
    <table class="rpt-table">
      <thead><tr>
        <th>Tenant</th><th style="text-align:right">CAM Billed</th>
        <th style="text-align:right">Pro-Rata</th><th style="text-align:center">Disputes</th>
      </tr></thead>
      <tbody>${tenantRows}</tbody>
      <tfoot><tr class="total-row">
        <td>TOTAL</td>
        <td style="text-align:right">${fmt(totalBilled)}</td>
        <td></td><td></td>
      </tr></tfoot>
    </table>

    <div class="rpt-section-title">Expense Breakdown by Category</div>
    <table class="rpt-table">
      <thead><tr>
        <th>Category</th><th style="text-align:right">Invoices</th>
        <th style="text-align:right">Amount</th><th style="text-align:right">% of Total</th>
      </tr></thead>
      <tbody>${expRows}</tbody>
      <tfoot><tr class="total-row">
        <td>TOTAL</td><td style="text-align:right">${lastInvoicesFull.length}</td>
        <td style="text-align:right">${fmt(lastTotal)}</td><td style="text-align:right">100%</td>
      </tr></tfoot>
    </table>

    <div class="rpt-section-title">XRPL Audit Record</div>
    <div class="rpt-hash-box">
      <div class="rpt-hash-lbl">&#x1F517; On-Chain Integrity Hash</div>
      <div class="rpt-hash-val">Computing…</div>
    </div>

    ${_rptFooter(lastPropName, 'Landlord Master CAM Report', now)}`;

  openReport('Landlord Master Report — ' + lastPropName, html);

  // Fill hash after render
  sha256({ propName: lastPropName, total: lastTotal, tenants: lastResults.map(r => r.name), generated: now })
    .then(hash => {
      const el = document.querySelector('#rptBody .rpt-hash-val');
      if (el) el.textContent = 'SHA-256: ' + hash + '\nGenerated: ' + new Date().toISOString();
    });
  } catch (e) {
    logError('generateMasterReport', e, { propName: lastPropName, tenantCount: lastResults.length });
    showToast('Could not generate Landlord Master Report — check console for details.', { color: '#92400e', textColor: '#fef3c7' });
  }
}

// Controller — toggles inline expansion row in the Master Report tenant table.
// tenantName comes from data-tenant-name dataset on the <tr> (set by generateMasterReport).
function openReportTenantDetail(tenantName) {
  const allRows = Array.from(document.querySelectorAll('#rptBody tr[data-tenant-name]'));
  console.log('[openReportTenantDetail] clicked:', JSON.stringify(tenantName),
    '| report rows in DOM:', allRows.length,
    '| row names:', allRows.map(r => r.dataset.tenantName));

  const tr = allRows.find(el => el.dataset.tenantName === tenantName);
  if (!tr) {
    console.warn('[openReportTenantDetail] <tr> not found — tenantName:', JSON.stringify(tenantName),
      '| available names:', allRows.map(r => JSON.stringify(r.dataset.tenantName)));
    return;
  }

  const recon   = lastResults.find(r => r.name === tenantName) || null;
  const tdMatch = tenantData.find(t => t && t.tenant_name === tenantName) || null;
  console.log('[openReportTenantDetail] recon:', recon
    ? { name: recon.name, cam: recon.allocatedAmount, proRata: recon.proRataPercent }
    : 'NOT FOUND',
    '| tenantData:', tdMatch
    ? { name: tdMatch.tenant_name, sqft: tdMatch.leased_sqft, type: tdMatch.lease_type }
    : 'NOT FOUND');

  // Toggle: clicking the same tenant again collapses
  const next = tr.nextElementSibling;
  if (next && next.classList.contains('report-tenant-expanded-row')) {
    console.log('[openReportTenantDetail] collapsing existing expansion');
    closeReportTenantExpansion();
    return;
  }

  closeReportTenantExpansion();
  renderReportTenantExpansion(tr, tenantName);
}

function closeReportTenantExpansion() {
  const row = document.querySelector('#rptBody .report-tenant-expanded-row');
  if (row) row.remove();
  const highlighted = document.querySelector('#rptBody tr.rpt-row-expanded');
  if (highlighted) highlighted.classList.remove('rpt-row-expanded');
}

function toggleReportDisputeDrilldown(el) {
  const next = el.nextElementSibling;
  if (next && next.classList.contains('rpt-exp-dispute-drilldown')) {
    next.remove();
    el.classList.remove('open');
    return;
  }
  el.classList.add('open');
  const div = document.createElement('div');
  div.className = 'rpt-exp-dispute-drilldown';
  div.innerHTML = renderReportDisputeDrilldown(el.dataset.tenantName);
  el.insertAdjacentElement('afterend', div);
}

function renderReportDisputeDrilldown(tenantName) {
  const items = disputes.filter(d => d.tenantName === tenantName);
  if (!items.length) return '<div class="rpt-exp-dispute-empty">No disputes found.</div>';

  const statusMap = {
    open:           { cls: 'open',     label: 'Open' },
    docs_requested: { cls: 'review',   label: 'Under Review' },
    accepted:       { cls: 'resolved', label: 'Resolved' },
    rejected:       { cls: 'rejected', label: 'Rejected' },
  };

  function ts(iso) {
    if (!iso) return '';
    try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
    catch (e) { return ''; }
  }

  return items.map(d => {
    const st     = statusMap[d.status] || { cls: 'open', label: d.status || 'Open' };
    const amount = (d.tenantShare != null && !isNaN(d.tenantShare)) ? fmt(parseFloat(d.tenantShare)) : '—';
    const opened = ts(d.timestamp);
    return `<div class="rpt-exp-dispute-item">
      <div class="rpt-exp-dispute-item-header">
        <span class="rpt-exp-dispute-item-title">${esc(d.vendor || '—')} &middot; ${esc(d.category || '—')}</span>
        <span class="rpt-exp-dispute-status ${st.cls}">${st.label}</span>
      </div>
      <div class="rpt-exp-dispute-item-meta">${amount}${opened ? ' &middot; Opened ' + opened : ''}</div>
      <div class="rpt-exp-dispute-item-reason">&ldquo;${esc(d.reason || '—')}&rdquo;</div>
    </div>`;
  }).join('');
}

function renderReportTenantExpansion(tr, tenantName) {
  const recon = lastResults.find(r => r.name === tenantName) || null;
  const td    = tenantData.find(t => t && t.tenant_name === tenantName) || null;
  const dc    = disputes.filter(d => d.tenantName === tenantName).length;
  const oc    = disputes.filter(d => d.tenantName === tenantName && d.status === 'open').length;

  const _v = (val) =>
    (val !== null && val !== undefined && String(val).trim() !== '') ? esc(String(val)) : null;

  function stat(label, value, gold) {
    const isNull = value === null || value === undefined;
    return `<div class="rpt-exp-stat">
      <div class="rpt-exp-label">${label}</div>
      <div class="rpt-exp-value${gold ? ' hi' : ''}${isNull ? ' nil' : ''}">${isNull ? '—' : value}</div>
    </div>`;
  }

  const sqftStr   = td?.leased_sqft ? Number(td.leased_sqft).toLocaleString('en-US') : null;
  const proRatStr = recon ? (recon.proRata * 100).toFixed(2) + '%' : null;
  const camStr    = recon ? fmt(recon.allocatedAmount) : null;
  const invCount  = recon ? String(recon.includedInvoices.length) : null;

  const disputeHtml = dc > 0
    ? `<div class="rpt-exp-dispute-summary"
          data-tenant-name="${esc(tenantName)}" data-total="${dc}" data-open="${oc}"
          onclick="toggleReportDisputeDrilldown(this)">
        <span class="rpt-exp-dispute-count">${dc} dispute${dc !== 1 ? 's' : ''}</span>
        ${oc > 0
          ? `<span class="rpt-exp-dispute-open">${oc} open</span>`
          : `<span class="rpt-exp-dispute-resolved">All resolved</span>`}
        <span class="rpt-exp-dispute-hint">&#x203A;</span>
      </div>`
    : `<div class="rpt-exp-no-disputes">No disputes filed</div>`;

  const innerHtml = `
    <div class="rpt-exp-inner">
      ${td ? _tenantReviewStateBadgeHtml(td) : ''}
      <div class="rpt-exp-section">Lease Info</div>
      <div class="rpt-exp-grid">
        ${stat('Lease Type',  _v(td?.lease_type))}
        ${stat('Leased Sqft', sqftStr)}
        ${stat('Start Date',  _v(td?.start_date))}
        ${stat('End Date',    _v(td?.end_date))}
        ${stat('Pro-Rata',    proRatStr, true)}
      </div>
      <div class="rpt-exp-section">CAM Summary</div>
      <div class="rpt-exp-grid">
        ${stat('Allocated CAM',  camStr, true)}
        ${stat('Invoice Count',  invCount)}
      </div>
      <div class="rpt-exp-section">Disputes</div>
      ${disputeHtml}
      <div class="rpt-exp-section">Lease Review</div>
      ${_reviewStatusPillHtml(td ? getLeaseReviewStatus(td) : 'incomplete')}
      ${(() => {
        const notes = td ? getLeaseReviewNotes(td) : ['No lease data available'];
        return notes.length
          ? `<ul class="rpt-exp-review-notes">${notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>`
          : '';
      })()}
      ${(() => {
        if (!td) return '';
        const capStr = td.cap != null ? td.cap + '%' : null;
        const lfcFields = [
          { key: 'lease_type',  label: 'Lease Type',  val: _v(td.lease_type) },
          { key: 'leased_sqft', label: 'Leased Sqft', val: sqftStr },
          { key: 'start_date',  label: 'Start Date',  val: _v(td.start_date) },
          { key: 'end_date',    label: 'End Date',    val: _v(td.end_date) },
          { key: 'cap',         label: 'CAM Cap',     val: capStr },
          { key: 'proRata',     label: 'Pro-Rata',    val: proRatStr },
        ];
        const tdId = td.id || '';
        const items = lfcFields.map(f =>
          `<div class="lfc-item" data-tenant-id="${esc(tdId)}" data-field-name="${f.key}">
            ${_lfcItemInner(f.key, f.label, f.val, td)}
          </div>`).join('');
        return `<div class="rpt-exp-section">Lease Field Confidence</div>
          <div class="lfc-grid">${items}</div>`;
      })()}
    </div>`;

  // createElement + insertBefore — guaranteed correct for table row insertion
  // (insertAdjacentHTML can mis-parse <tr> in <div> context in some engines).
  const newRow = document.createElement('tr');
  newRow.className = 'report-tenant-expanded-row';
  const cell = document.createElement('td');
  cell.colSpan = 4;
  cell.innerHTML = innerHtml;
  newRow.appendChild(cell);

  tr.classList.add('rpt-row-expanded');
  const tbody = tr.parentNode;
  tbody.insertBefore(newRow, tr.nextSibling);

  console.log('[renderReportTenantExpansion] inserted | tbody children after:', tbody.children.length,
    '| newRow visible:', newRow.offsetHeight > 0,
    '| cell colSpan:', cell.colSpan,
    '| preview:', newRow.outerHTML.slice(0, 200));
}

async function runLandlordAIReview() {
  const btn = document.querySelector('.ai-run-btn');
  const container = document.getElementById('aiRiskDetail');
  if (!container) return;
  if (btn) { btn.disabled = true; btn.textContent = 'Reviewing flagged charges…'; }

  const flagged = invoiceData.filter(inv => {
    if (!inv || inv._error || !inv.vendorName || !(parseFloat(inv.amount) > 0)) return false;
    const conf = inv.confidence || {};
    const scores = [conf.vendorName, conf.amount, conf.category].filter(s => s != null);
    const minScore = scores.length ? Math.min(...scores) : 0;
    return minScore < 90 || inv.category === 'other' || !inv.invoiceDate;
  });

  if (!flagged.length) {
    container.innerHTML = '<div style="color:#4ade80;font-size:0.83rem;margin-top:10px;">&#x2713; All charges look clear — no AI review needed.</div>';
    if (btn) btn.remove();
    return;
  }

  let html = '';
  for (const inv of flagged) {
    try {
      const data = await explainFetch({
        model: MODEL,
        max_tokens: 512,
        system: LANDLORD_SYSTEM_PROMPT,
        messages: [{ role: 'user', content:
          `Vendor: ${inv.vendorName || 'Unknown'}\n` +
          `Category: ${inv.category || 'other'}\n` +
          `Amount: $${inv.amount || '0'}\n` +
          `Date: ${inv.invoiceDate || 'Unknown'}`
        }],
      });
      const text = data?.content?.[0]?.text || 'No review available.';
      html += `<div class="ai-inv-review"><strong>${esc(inv.vendorName)} — ${fmt(parseFloat(inv.amount))}</strong>${renderMarkdown(text)}</div>`;
    } catch (e) {
      html += `<div class="ai-inv-review"><strong>${esc(inv.vendorName)}</strong>Review failed: ${esc(e.message)}</div>`;
    }
  }

  container.innerHTML = html;
  if (btn) btn.remove();
}

function generateTenantStatement(tenantName) {
  if (!lastResults.length) { showToast('Run a CAM allocation first to generate reports.', { color: '#92400e', textColor: '#fef3c7' }); return; }
  try {
  logActivity('tenant_statement', `Tenant statement generated — ${tenantName}`, { severity: 'info', actor: 'User', relatedEntity: tenantName });

  const r = lastResults.find(x => x.name === tenantName);
  const t = lastTenants.find(x => x.name === tenantName);
  if (!r || !t) {
    console.warn('[generateTenantStatement] GUARD: missing r or t', { tenantName, rFound: !!r, tFound: !!t });
    return;
  }

  console.groupCollapsed('[PIPELINE:7] generateTenantStatement');
  console.log('lastInvoicesFull[0]:', JSON.parse(JSON.stringify(lastInvoicesFull[0] || {})));
  console.log('invoiceData[0]:', JSON.parse(JSON.stringify(invoiceData[0] || {})));
  console.groupEnd();

  const now    = new Date().toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' });
  const period = new Date().getFullYear() + ' CAM Year';

  // Per-invoice breakdown
  const eligible = lastInvoicesFull.filter(inv =>
    !t.excludedCategories.includes(inv.category.toLowerCase())
  );
  // Group eligible invoices by category, preserving per-invoice indices
  const catMap = {};
  eligible.forEach((inv, idx) => {
    const key = (inv.category || 'other').toLowerCase();
    if (!catMap[key]) catMap[key] = { label: inv.category || 'Other', share: 0, invoices: [] };
    const share = parseFloat((inv.amount * r.proRata).toFixed(2));
    catMap[key].share += share;
    catMap[key].invoices.push({ inv, idx, share });
  });

  const pct = (r.proRata * 100).toFixed(2);

  // Build accordion: one card per category, invoices expand inside
  const categoryCards = Object.entries(catMap)
    .sort((a, b) => b[1].share - a[1].share)
    .map(([, data]) => {
      const invRows = data.invoices.map(({ inv, idx, share }) => {
        const rowId = `ts-${tenantName}-${idx}`.replace(/\s+/g, '-');
        const vendorKey = (inv.vendor || inv.vendorName || '').toLowerCase();
        const stored = invoiceData.find(d =>
          d.vendorName && d.vendorName.toLowerCase() === vendorKey
        );
        if (idx === 0) {
          console.log('[PIPELINE:7b] first inv obj', JSON.parse(JSON.stringify(inv || {})));
          console.log('[PIPELINE:7b] first stored obj', JSON.parse(JSON.stringify(stored || {})));
        }
        console.log('[generateTenantStatement] invoice match', {
          idx,
          invVendor:    inv.vendor,
          invVendorName: inv.vendorName,
          vendorKey,
          storedFound:  !!stored,
          storedFileUrl: stored ? (stored.fileUrl ? 'PRESENT' : 'MISSING') : 'N/A',
        });
        const viewInvBtn = stored && stored.fileUrl
          ? `<button class="btn-secondary" onclick="event.stopPropagation();openInvFileViewer('${stored.fileUrl}','${esc(inv.vendor || inv.vendorName || '')}','${esc(stored.fileType || '')}')">&#x1F4C4; View Invoice</button>`
          : '';
        return `
          <div class="charge-row ts-inv-card" id="crow-${rowId}"
            onclick="(function(row){var d=document.getElementById('ddetail-${rowId}');var open=d.style.display==='block';d.style.display=open?'none':'block';row.classList.toggle('detail-open',!open);})(this)">
            <div class="charge-row-top">
              <div class="charge-row-left">
                <div class="charge-vendor">${esc(inv.vendor)}</div>
                <div class="charge-amount">${fmt(share)}</div>
                <div class="charge-sub">Your share (${pct}%)</div>
                <p class="ts-vendor-hint">Tap here for details or to dispute this charge</p>
              </div>
              <div class="charge-chevron">&#x203A;</div>
            </div>
            <div id="ddetail-${rowId}" class="ts-detail-box" style="display:none;" onclick="event.stopPropagation()">
              <div class="ts-detail-header">
                <span class="ts-detail-title">Charge Details</span>
                <button class="ts-detail-close"
                  onclick="document.getElementById('ddetail-${rowId}').style.display='none';document.getElementById('crow-${rowId}').classList.remove('detail-open')">&#x2715;</button>
              </div>
              <div class="ts-detail-row"><span>Vendor</span><span class="ts-detail-val">${esc(inv.vendor)}</span></div>
              <div class="ts-detail-row"><span>Category</span><span class="ts-detail-val">${esc(inv.category)}</span></div>
              <div class="ts-detail-row"><span>Invoice Total</span><span class="ts-detail-val">${fmt(inv.amount)}</span></div>
              <div class="ts-detail-row ts-detail-highlight"><span>Your Share</span><span class="ts-detail-val">${fmt(share)}</span></div>
              <div class="ts-detail-basis">Based on ${pct}% pro-rata allocation by square footage</div>
              <div class="ts-detail-actions">
                ${viewInvBtn}
                <button class="inv-act-btn inv-act-explain" id="tsexplbtn-${rowId}"
                  onclick="event.stopPropagation();tsExplainInvoice('${rowId}','${esc(inv.vendor)}','${esc(inv.category)}',${inv.amount},'${esc(inv.invoiceDate||'')}')">Explain</button>
                <button class="btn-danger-outline" id="dbtn-${rowId}"
                  onclick="event.stopPropagation();tsToggleDispute('${rowId}','${esc(tenantName)}',${idx})">Dispute this charge</button>
              </div>
              <div id="tsexpl-${rowId}"></div>
            </div>
            <div id="dform-${rowId}" style="display:none;" onclick="event.stopPropagation()"></div>
          </div>`;
      }).join('');

      const count = data.invoices.length;
      return `
        <div class="ts-cat-accordion">
          <div class="ts-cat-header"
            onclick="(function(hdr){var body=hdr.nextElementSibling;var isOpen=body.style.display==='block';document.querySelectorAll('.ts-cat-body').forEach(function(b){b.style.display='none';});document.querySelectorAll('.ts-cat-header').forEach(function(h){h.classList.remove('active');});if(!isOpen){body.style.display='block';hdr.classList.add('active');}})(this)">
            <div class="ts-cat-left">
              <div class="ts-cat-name">${esc(data.label)}</div>
              <div class="ts-cat-meta">${count} invoice${count !== 1 ? 's' : ''}</div>
            </div>
            <div class="ts-cat-right">
              <div class="ts-cat-share-amt">${fmt(parseFloat(data.share.toFixed(2)))}</div>
              <div class="ts-cat-share-lbl">Your share</div>
            </div>
            <div class="ts-cat-chevron">&#x203A;</div>
          </div>
          <div class="ts-cat-body" style="display:none;">
            <div class="charge-list">${invRows}</div>
          </div>
        </div>`;
    }).join('');

  // Excluded categories note
  const exclNote = t.excludedCategories.length
    ? `<p style="font-size:0.8rem;color:#94a3b8;margin-top:6px;">Excluded categories: ${t.excludedCategories.join(', ')}</p>`
    : '';

  // Cap info
  const capNote = r.capApplied
    ? `<p style="font-size:0.82rem;color:#b45309;margin-top:6px;font-style:italic;">
        Cap applied — your allocation was reduced by ${fmt(r.capAdjustment)} to meet the lease cap.</p>`
    : '';

  // Year-end reconciliation (estimated = allocated, actual = allocated for demo)
  const estimated  = r.allocatedAmount;
  const actual     = r.allocatedAmount; // same when no payments entered
  const difference = actual - estimated;
  const reconNote  = difference > 0
    ? `<span style="color:#dc2626">Underpaid ${fmt(difference)}</span>`
    : difference < 0
    ? `<span style="color:#16a34a">Overpaid ${fmt(Math.abs(difference))}</span>`
    : '<span style="color:#16a34a">Settled — no adjustment needed</span>';

  // Disputes for this tenant
  const tenantDisputes = disputes.filter(d => d.tenantName === tenantName);
  const disputeRows = tenantDisputes.length
    ? tenantDisputes.map(d => {
        const statusLabel = d.status === 'open' ? 'Open'
          : d.status === 'accepted' ? 'Accepted'
          : d.status === 'rejected' ? 'Rejected'
          : 'Docs Requested';
        const pill = `<span class="rpt-pill ${d.status === 'open' ? 'open' : 'closed'}">${statusLabel}</span>`;
        return `<tr>
          <td>${esc(d.vendor)}</td>
          <td>${fmt(d.tenantShare)}</td>
          <td>${esc(d.reason)}</td>
          <td>${pill}</td>
          ${d.hash ? `<td style="font-family:monospace;font-size:0.66rem;word-break:break-all">${d.hash.substring(0,16)}…</td>` : '<td>—</td>'}
        </tr>`;
      }).join('')
    : '<tr><td colspan="5" style="color:#94a3b8;text-align:center">No disputes filed</td></tr>';

  const html = `
    ${_rptHeader(lastPropName, 'Tenant CAM Statement', period, now, [
      { label: 'Tenant',     value: tenantName },
      { label: 'Your Share', value: (r.proRata * 100).toFixed(2) + '%' },
    ])}

    <div class="ts-summary-card">
      <div class="ts-summary-total-label">Total CAM Billed to You</div>
      <div class="ts-summary-total-amount">${fmt(r.allocatedAmount)}</div>
      <div class="ts-summary-stats">
        <div class="ts-summary-stat">
          <span class="ts-ss-label">Your Share</span>
          <span class="ts-ss-val highlight">${(r.proRata * 100).toFixed(2)}%</span>
        </div>
        <div class="ts-summary-stat">
          <span class="ts-ss-label">Building Sq Ft</span>
          <span class="ts-ss-val">${(t.totalSqft || 0).toLocaleString()}</span>
        </div>
        <div class="ts-summary-stat">
          <span class="ts-ss-label">Your Sq Ft</span>
          <span class="ts-ss-val">${t.leasedSqft.toLocaleString()}</span>
        </div>
      </div>
    </div>

    <button class="primary-pay-btn" style="margin-bottom:24px;">Pay Now &mdash; ${fmt(r.allocatedAmount)} USD</button>

    <div class="rpt-section-title">Expense Breakdown</div>
    <p class="rpt-helper-text">Tap a category to see individual charges. Tap any charge to view details or dispute.</p>
    <div class="ts-cat-list">${categoryCards}</div>
    ${exclNote}${capNote}

    <div class="rpt-section-title">Year-End Reconciliation</div>
    <table class="rpt-table">
      <tbody>
        <tr><td>Estimated Annual CAM</td><td style="text-align:right">${fmt(estimated)}</td></tr>
        <tr><td>Actual Reconciled CAM</td><td style="text-align:right">${fmt(actual)}</td></tr>
        <tr class="total-row"><td>Net Settlement</td><td style="text-align:right">${reconNote}</td></tr>
      </tbody>
    </table>

    <div class="rpt-section-title">Disputes</div>
    <p class="rpt-helper-text">Disputes are reviewed by your landlord. You'll be notified when a decision is made.</p>
    <table class="rpt-table">
      <thead><tr>
        <th>Vendor</th><th>Amount</th><th>Reason</th><th>Status</th><th>Hash</th>
      </tr></thead>
      <tbody>${disputeRows}</tbody>
    </table>

    <div class="rpt-section-title">XRPL Audit Record</div>
    <div class="rpt-hash-box">
      <div class="rpt-hash-lbl">&#x1F517; On-Chain Integrity Hash</div>
      <div class="rpt-hash-val" id="tenantHashVal">Computing…</div>
    </div>

    ${_rptFooter(lastPropName, 'Tenant CAM Statement — ' + tenantName, now)}`;

  openReport('Tenant Statement — ' + tenantName, html);

  sha256({ tenantName, propName: lastPropName, allocated: r.allocatedAmount, proRata: r.proRata, generated: now })
    .then(hash => {
      const el = document.getElementById('tenantHashVal');
      if (el) el.textContent = 'SHA-256: ' + hash + '\nGenerated: ' + new Date().toISOString();
    });
  } catch (e) {
    logError('generateTenantStatement', e, { tenantName, propName: lastPropName });
    showToast(`Could not generate statement for ${tenantName} — check console for details.`, { color: '#92400e', textColor: '#fef3c7' });
  }
}

// ─── Load Demo ────────────────────────────────────────────────────────────────

// Stable identifiers so the demo property is idempotent across sessions/devices.
const DEMO_PROPERTY_ID = 'dec00000-0000-4000-a000-000000000001';
const _DEMO_TENANT_IDS = [
  'dec00000-0000-4000-a000-000000000002', // Fresh Market Foods
  'dec00000-0000-4000-a000-000000000003', // Riverside Dental Group
  'dec00000-0000-4000-a000-000000000004', // FitLife Gym & Wellness
];

// Deletes every property whose name matches "Riverside Commons*" and whose ID
// is NOT the canonical DEMO_PROPERTY_ID.  Cleans Supabase, _props, and
// localStorage so no duplicate demo entries survive.
async function cleanupLegacyDemos(userId) {
  try {
    const { data: rows } = await db.from('properties')
      .select('id, name, sqft')
      .eq('user_id', userId)
      .ilike('name', 'riverside commons%')
      .neq('id', DEMO_PROPERTY_ID);

    // Belt-and-suspenders: only remove entries whose sqft matches the demo
    const legacyIds = (rows || []).filter(r => r.sqft === 24000).map(r => r.id);
    if (!legacyIds.length) return;

    console.log('[cleanupLegacyDemos] removing', legacyIds.length, 'legacy entry/entries:', legacyIds);

    // Delete tenants first (FK), then the property rows
    for (const id of legacyIds) {
      await db.from('tenants').delete().eq('property_id', id);
    }
    await db.from('properties').delete().in('id', legacyIds).eq('user_id', userId);

    // Remove from _props
    for (const id of legacyIds) {
      const idx = _props.findIndex(p => p.id === id);
      if (idx >= 0) _props.splice(idx, 1);
    }

    // Remove from localStorage
    try {
      const stored = JSON.parse(_lsGet(_LS_KEY) || '{}');
      let dirty = false;
      legacyIds.forEach(id => { if (stored[id]) { delete stored[id]; dirty = true; } });
      if (dirty) _lsSet(_LS_KEY, JSON.stringify(stored));
    } catch (_) {}
  } catch (e) {
    console.warn('[cleanupLegacyDemos] non-fatal:', e.message);
  }
}

// Ensures Riverside Commons exists in Supabase with complete seeded state.
// Idempotent — skips re-seeding if valid camReconciliation already present.
// Returns DEMO_PROPERTY_ID on success, null on auth failure.
async function ensureDemoProperty() {
  const { data: { user } } = await db.auth.getUser();
  if (!user?.id) return null;

  // Always clean up legacy random-UUID demo copies before anything else
  await cleanupLegacyDemos(user.id);

  // ── Idempotency check — skip if already fully seeded ─────────────────────
  try {
    const { data: row, error } = await db.from('properties')
      .select('data')
      .eq('id', DEMO_PROPERTY_ID)
      .eq('user_id', user.id)
      .single();
    if (!error && row?.data?.camReconciliation?.results?.length > 0) {
      console.log('[ensureDemoProperty] already seeded — skip');
      return DEMO_PROPERTY_ID;
    }
  } catch (_) { /* not found — fall through to seed */ }

  console.log('[ensureDemoProperty] seeding Riverside Commons…');

  // ── Demo data constants ───────────────────────────────────────────────────
  const PROP_NAME  = 'Riverside Commons';
  const PROP_SQFT  = 24000;
  const CAM_YEAR   = 2025;

  const demoTenantConfigs = [
    {
      id: _DEMO_TENANT_IDS[0], tenant_name: 'Fresh Market Foods',
      leased_sqft: '6200', cap: '10', excluded_categories: 'snow',
      start_date: '2020-01-01', end_date: '2027-12-31', lease_type: 'NNN',
      confidence: { tenantName:98, leasedSqft:96, capPercentage:92, excludedCategories:88 },
    },
    {
      id: _DEMO_TENANT_IDS[1], tenant_name: 'Riverside Dental Group',
      leased_sqft: '1800', cap: null, excluded_categories: 'management',
      start_date: '2021-06-01', end_date: '2026-05-31', lease_type: 'NNN',
      confidence: { tenantName:97, leasedSqft:94, excludedCategories:91 },
    },
    {
      id: _DEMO_TENANT_IDS[2], tenant_name: 'FitLife Gym & Wellness',
      leased_sqft: '3400', cap: null, excluded_categories: '',
      start_date: '2022-01-01', end_date: '2025-12-31', lease_type: 'NNN',
      confidence: { tenantName:99, leasedSqft:97 },
    },
  ];

  const demoInvoiceList = [
    { vendorName: 'Green Thumb Landscaping', amount: 2400, category: 'landscaping', invoiceDate: '2025-01-15' },
    { vendorName: 'Metro Snow Services',     amount: 1850, category: 'snow',        invoiceDate: '2025-01-22' },
    { vendorName: 'Apex Building Repairs',   amount: 3200, category: 'repairs',     invoiceDate: '2025-01-31' },
    { vendorName: 'City Electric Co',        amount: 4100, category: 'utilities',   invoiceDate: '2025-01-31' },
    { vendorName: 'CleanRight Janitorial',   amount: 2800, category: 'janitorial',  invoiceDate: '2025-01-31' },
    { vendorName: 'SecureWatch Inc',         amount: 1600, category: 'security',    invoiceDate: '2025-01-31' },
    { vendorName: 'Summit Management Group', amount: 3500, category: 'management',  invoiceDate: '2025-01-31' },
  ];

  const totalExpenses = demoInvoiceList.reduce((s, inv) => s + inv.amount, 0);

  // ── Normalize tenants (gives stable IDs + all expected fields) ────────────
  const demoTenants = demoTenantConfigs.map(normalizeTenant);

  // ── Build Property object for reconciliation engine ───────────────────────
  const reconProp = new Property(PROP_NAME, PROP_SQFT);
  reconProp.addLeases(demoTenants.map(t => {
    const excl  = (t.excluded_categories || '').split(',').map(s => s.trim()).filter(Boolean);
    const lease = new Lease(
      t.tenant_name, '', parseSqft(t.leased_sqft),
      t.start_date || '', t.end_date || '', excl,
      t.cap ? parseFloat(t.cap) : null, null, false, null, t.lease_type || null
    );
    lease.id = t.id;
    return lease;
  }));
  reconProp.addInvoices(demoInvoiceList.map(inv =>
    new Invoice(null, inv.invoiceDate, inv.amount, inv.vendorName, inv.category)
  ));

  // runFullReconciliation reads currentProperty().tenants for live cap/flag lookups.
  // Temporarily wire the demo property into _props and activePropId.
  const prevActivePropId = activePropId;
  const demoEntry = { id: DEMO_PROPERTY_ID, name: PROP_NAME, totalSqft: PROP_SQFT, tenants: demoTenants };
  const demoIdx = _props.findIndex(p => p.id === DEMO_PROPERTY_ID);
  if (demoIdx >= 0) Object.assign(_props[demoIdx], demoEntry);
  else _props.unshift(demoEntry);
  activePropId = DEMO_PROPERTY_ID;

  let fullResults;
  try {
    fullResults = runFullReconciliation(reconProp);
  } finally {
    activePropId = prevActivePropId; // always restore
  }

  // ── Build report-layer data structures ────────────────────────────────────
  const invoiceSummary = demoInvoiceList.map((inv, i) => ({
    id: `inv-${i}`, vendor: inv.vendorName, category: inv.category, amount: inv.amount,
  }));
  const tenantSummary = demoTenants.map(t => ({
    name:               t.tenant_name,
    leasedSqft:         parseSqft(t.leased_sqft),
    totalSqft:          PROP_SQFT,
    capPct:             t.cap ? parseFloat(t.cap) : null,
    excludedCategories: (t.excluded_categories || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
  }));

  const camReconciliation = {
    propId:       DEMO_PROPERTY_ID,
    propName:     PROP_NAME,
    camYear:      CAM_YEAR,
    savedAt:      new Date().toISOString(),
    total:        totalExpenses,
    results:      fullResults.map(r => ({ ...r })),
    invoices:     invoiceSummary,
    invoicesFull: demoInvoiceList, // full objects; stripped on save, re-hydrated on load
    tenants:      tenantSummary,
    camRuns: [{
      propName:      PROP_NAME,
      camYear:       CAM_YEAR,
      timestamp:     new Date().toISOString(),
      totalExpenses,
      tenantCount:   fullResults.length,
      invoiceCount:  demoInvoiceList.length,
      results:       fullResults.map(r => ({ ...r })),
    }],
  };

  const repairShare = parseFloat((3200 * (6200 / PROP_SQFT)).toFixed(2));
  const demoDisputes = [{
    id: 0,
    tenantName:  'Fresh Market Foods',
    invoiceId:   'inv-2',
    vendor:      'Apex Building Repairs',
    category:    'repairs',
    tenantShare: repairShare,
    reason:      'Work order was not pre-approved per lease Section 8.3. Requesting documentation before accepting this charge.',
    timestamp:   new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    status:      'open',
    resolution:  null, resolvedAt: null, hash: null,
  }];

  // ── Persist to Supabase ───────────────────────────────────────────────────
  // invoicesFull is intentionally omitted (matches _stripBlobs convention);
  // on load it is re-hydrated from data.invoices via renderProperty.
  const propertyData = {
    invoices:          demoInvoiceList.map(inv => ({
      vendorName: inv.vendorName, amount: inv.amount,
      category: inv.category, invoiceDate: inv.invoiceDate,
    })),
    disputes:          demoDisputes,
    camYear:           CAM_YEAR,
    results:           null,
    camReconciliation: { ...camReconciliation, invoicesFull: undefined },
  };

  const { error: propErr } = await db.from('properties')
    .upsert({ id: DEMO_PROPERTY_ID, user_id: user.id, name: PROP_NAME, sqft: PROP_SQFT, data: propertyData })
    .select('id');
  if (propErr) { console.error('[ensureDemoProperty] property upsert failed:', propErr.message); throw propErr; }

  // Tenants: delete existing rows then insert with stable IDs so they're
  // always queryable by property_id even if the user has run the old demo.
  await db.from('tenants').delete().eq('property_id', DEMO_PROPERTY_ID);
  const tenantRows = demoTenants.map(t => ({
    id:          t.id,
    property_id: DEMO_PROPERTY_ID,
    name:        t.tenant_name,
    sqft:        Number(t.leased_sqft) || null,
    cap:         t.cap != null ? parseFloat(t.cap) : null,
    start_date:  t.start_date  || null,
    end_date:    t.end_date    || null,
    lease_type:  t.lease_type  || null,
    lease_url:   null,
  }));
  const { error: tenErr } = await db.from('tenants').insert(tenantRows).select('id');
  if (tenErr) console.warn('[ensureDemoProperty] tenant insert warning:', tenErr.message);

  // ── Update in-memory _props with full state ───────────────────────────────
  const demoPropFull = {
    id:                DEMO_PROPERTY_ID,
    name:              PROP_NAME,
    totalSqft:         PROP_SQFT,
    tenants:           demoTenants,
    invoices:          propertyData.invoices,
    disputes:          demoDisputes,
    camYear:           CAM_YEAR,
    camReconciliation, // invoicesFull intact for in-memory rendering
  };
  const finalIdx = _props.findIndex(p => p.id === DEMO_PROPERTY_ID);
  if (finalIdx >= 0) Object.assign(_props[finalIdx], demoPropFull);
  else _props.unshift(demoPropFull);

  // Save to localStorage so it's available immediately on next load
  _lsSave(demoPropFull);

  console.log('[ensureDemoProperty] seeded successfully', {
    totalExpenses, tenants: fullResults.length, invoices: demoInvoiceList.length,
  });
  return DEMO_PROPERTY_ID;
}

async function loadDemo() {
  const btn = document.getElementById('demoBtn');
  const origText = btn?.textContent ?? 'Try Live Demo';
  if (btn) { btn.disabled = true; btn.textContent = 'Loading…'; }
  try {
    const id = await ensureDemoProperty();
    if (!id) {
      showToast('Please log in to load the demo.', { color: '#92400e', textColor: '#fef3c7' });
      return;
    }
    renderPortfolio(); // refresh card list so demo appears
    await selectProperty(id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (e) {
    console.error('[loadDemo]', e);
    showToast('Demo failed to load — please try again.', { color: '#92400e', textColor: '#fef3c7' });
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = origText; }
  }
}

// ─── Portfolio ────────────────────────────────────────────────────────────────

let _portfolioSort = 'risk'; // 'risk' | 'recent' | 'cam' | 'disputes'
let _reviewQueueFilter = 'all'; // 'all' | 'incomplete' | 'needs_review' | 'manually_verified'
const _reviewAcknowledged = new Set();

// Pure function — derives risk metadata from a stored property snapshot.
// Runs without globals so it can compute for any prop, not just the active one.
function _buildPropMeta(prop) {
  const snap     = prop.camReconciliation ?? prop.results ?? null;
  const invoices = (snap?.invoicesFull?.length ? snap.invoicesFull : null)
    || (prop.invoices?.length ? prop.invoices : []);
  const results    = snap?.results || [];
  const total      = snap?.total || Number(prop.totalCAM) || 0;
  const camRunsArr = (snap?.camRuns || []);

  const missingDocs  = invoices.filter(i => i && !i.fileUrl && !i.fileName).length;
  const openDisputes = (prop.disputes || []).filter(d => d.status === 'open').length
    || Number(prop.openDisputes) || 0;

  // Lightweight flag counts from stored data
  let redCount = 0, yellowCount = 0;
  if (snap) {
    // Large single invoice > 40% of total
    if (total > 0) {
      const thresh = total * 0.4;
      invoices.forEach(inv => { if ((parseFloat(inv?.amount) || 0) > thresh) redCount++; });
    }
    // Missing docs — 100% missing = red, partial = yellow
    if (invoices.length > 0) {
      const pct = missingDocs / invoices.length;
      if (pct === 1) redCount++; else if (missingDocs > 0) yellowCount++;
    }
    // YoY change from stored camRuns
    if (camRunsArr.length >= 2) {
      const curr = camRunsArr[0];
      const prev = camRunsArr.slice(1).find(r => r.camYear !== curr.camYear) || camRunsArr[1];
      if (curr.totalExpenses && prev.totalExpenses) {
        const pct = Math.abs((curr.totalExpenses - prev.totalExpenses) / prev.totalExpenses * 100);
        if (pct > 20) redCount++; else if (pct > 10) yellowCount++;
      }
    }
    // Pro-rata coverage gap
    const totalPR = results.reduce((s, r) => s + (r.proRataPercent || 0), 0);
    if (results.length > 0 && Math.abs(totalPR - 100) >= 5) yellowCount++;
    // Open disputes add yellow signal
    if (openDisputes > 0) yellowCount++;
  }

  // Risk classification — same thresholds as buildAuditNarrative
  let riskLevel = 'None';
  if (snap) {
    if      (redCount >= 3 || (redCount >= 1 && openDisputes >= 1)) riskLevel = 'Critical';
    else if (redCount >= 1 || yellowCount >= 3)                     riskLevel = 'Elevated';
    else if (yellowCount >= 1)                                      riskLevel = 'Moderate';
    else                                                            riskLevel = 'Low';
  }

  // Avg confidence from per-tenant results
  const confScores = results.map(r => r.averageConfidence || 0).filter(s => s > 0);
  const avgConf    = confScores.length
    ? Math.round(confScores.reduce((s, c) => s + c, 0) / confScores.length)
    : null;

  // YoY trend direction
  let trendDir = null, trendPct = null;
  if (camRunsArr.length >= 2) {
    const curr = camRunsArr[0];
    const prev = camRunsArr.slice(1).find(r => r.camYear !== curr.camYear) || camRunsArr[1];
    if (curr.totalExpenses && prev.totalExpenses) {
      trendPct  = (curr.totalExpenses - prev.totalExpenses) / prev.totalExpenses * 100;
      trendDir  = Math.abs(trendPct) < 3 ? 'flat' : trendPct > 0 ? 'up' : 'down';
    }
  }

  // Tenant review state counts — computed from prop.tenants (pure derived state)
  const tenantArr            = Array.isArray(prop.tenants) ? prop.tenants.filter(Boolean) : [];
  const tenantsNeedingReview = tenantArr.filter(t => getTenantReviewState(t) === 'needs_review').length;
  const incompleteLeases     = tenantArr.filter(t => getTenantReviewState(t) === 'incomplete').length;
  const manuallyVerifiedCount = tenantArr.filter(t => getTenantReviewState(t) === 'manually_verified').length;

  return {
    riskLevel, redCount, yellowCount, missingDocs, avgConf,
    trendDir, trendPct, openDisputes, total,
    camYear: snap?.camYear || prop.camYear || null,
    savedAt: snap?.savedAt || null,
    tenantsNeedingReview, incompleteLeases, manuallyVerifiedCount,
  };
}

function _fmtCardTs(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ─── Review Queue ─────────────────────────────────────────────────────────────

function getReviewQueueItems(props) {
  const items = [];
  for (const p of (props || [])) {
    const tenants = Array.isArray(p.tenants) ? p.tenants.filter(Boolean) : [];
    for (const t of tenants) {
      const state = getTenantReviewState(t);
      if (state === 'verified') continue;

      const score = getTenantReviewScore(t);
      const missingFields = [];
      if (!t.lease_type)  missingFields.push('Lease Type');
      if (!t.leased_sqft) missingFields.push('Sq Ft');
      if (!t.start_date)  missingFields.push('Start Date');
      if (!t.end_date)    missingFields.push('End Date');
      const isNNN = /nnn|triple[\s-]?net/i.test(String(t.lease_type || ''));
      if (isNNN && (t.cap == null || t.cap === '')) missingFields.push('NNN Cap');

      const warningReasons = [];
      if (t._usedFallback) warningReasons.push('Fallback extraction used');
      const sqftConf = t.confidence?.leased_sqft ?? t.confidence?.leasedSqft;
      if (sqftConf != null && sqftConf < 70) warningReasons.push(`Low sqft confidence (${sqftConf}%)`);
      const recon = lastResults.find(r => r.name === t.tenant_name);
      if (recon && recon.proRata > 1.0) warningReasons.push('Pro-rata > 100%');

      items.push({
        propertyId:    p.id,
        propertyName:  p.name || '—',
        tenantId:      t.id,
        tenantName:    t.tenant_name || '—',
        reviewState:   state,
        reviewScore:   score,
        missingFields,
        warningReasons,
        lastUpdated:   t.updated_at || t.created_at || null,
      });
    }
  }
  items.sort((a, b) => {
    const order = { incomplete: 0, needs_review: 1, manually_verified: 2 };
    const sa = order[a.reviewState] ?? 3, sb = order[b.reviewState] ?? 3;
    if (sa !== sb) return sa - sb;
    if (a.reviewScore !== b.reviewScore) return a.reviewScore - b.reviewScore;
    const ta = a.lastUpdated ? new Date(a.lastUpdated).getTime() : 0;
    const tb = b.lastUpdated ? new Date(b.lastUpdated).getTime() : 0;
    return tb - ta;
  });
  return items;
}

function _rqUrgencyClass(score) {
  if (score < 50) return 'rq-critical';
  if (score < 80) return 'rq-moderate';
  return 'rq-healthy';
}

function _rqItemHtml(item) {
  const acked = _reviewAcknowledged.has(item.tenantId);
  const urgCls = _rqUrgencyClass(item.reviewScore);
  const stateCfg = {
    incomplete:        { cls: 'trs-incomplete',        label: 'Incomplete' },
    needs_review:      { cls: 'trs-needs-review',      label: 'Needs Review' },
    manually_verified: { cls: 'trs-manually-verified', label: 'Manually Verified' },
  }[item.reviewState] || { cls: 'trs-needs-review', label: item.reviewState };
  const scoreColor = item.reviewScore >= 80 ? 'trs-score--high' : item.reviewScore >= 50 ? 'trs-score--mid' : 'trs-score--low';

  const missingChips = item.missingFields.map(f => `<span class="rq-chip rq-chip--missing">${esc(f)}</span>`).join('');
  const warnChips    = item.warningReasons.map(w => `<span class="rq-chip rq-chip--warn">${esc(w)}</span>`).join('');

  const pid = esc(item.propertyId);
  const tid = esc(item.tenantId);

  return `
  <div class="rq-card ${urgCls}${acked ? ' rq-acknowledged' : ''}" data-rq-tenant-id="${tid}">
    <div class="rq-card-main">
      <div class="rq-tenant-name">${esc(item.tenantName)}</div>
      <div class="rq-prop-name">${esc(item.propertyName)}</div>
      <div class="rq-badges">
        <span class="trs-badge ${stateCfg.cls}">${stateCfg.label}</span>
        <span class="trs-score ${scoreColor}">Score: ${item.reviewScore}</span>
      </div>
      ${(missingChips || warnChips) ? `<div class="rq-chips">${missingChips}${warnChips}</div>` : ''}
    </div>
    <div class="rq-actions">
      <button class="rq-action-btn rq-btn--primary" onclick="selectProperty('${pid}')">Review Lease</button>
      <button class="rq-action-btn rq-btn--secondary" onclick="selectProperty('${pid}')">Jump to Tenant</button>
      ${acked
        ? `<span class="rq-chip" style="text-align:center;justify-content:center;">Acknowledged</span>`
        : `<button class="rq-action-btn rq-btn--ack" onclick="markTenantReviewAcknowledged('${tid}')">Mark Reviewed</button>`
      }
    </div>
  </div>`;
}

// Portfolio homepage: banner only — detailed queue lives inside each property view.
function renderReviewQueue(props) {
  const panel = document.getElementById('reviewQueuePanel');
  if (!panel) return;

  const allItems = getReviewQueueItems(props);
  const nonAcked = allItems.filter(i => !_reviewAcknowledged.has(i.tenantId));

  if (nonAcked.length === 0) { panel.style.display = 'none'; return; }
  panel.style.display = 'block';

  const propCount  = new Set(nonAcked.map(i => i.propertyId)).size;
  const bannerText = `${nonAcked.length} tenant${nonAcked.length !== 1 ? 's' : ''} require attention across ${propCount} propert${propCount !== 1 ? 'ies' : 'y'}`;
  panel.innerHTML = `<div class="rq-summary-banner">${esc(bannerText)}</div>`;
}

function setReviewQueueFilter(filter) {
  _reviewQueueFilter = filter;
  if (!activePropId) return;
  const prop = _props.find(p => p.id === activePropId);
  if (prop) renderPropertyReviewQueue(prop);
}

function markTenantReviewAcknowledged(tenantId) {
  _reviewAcknowledged.add(tenantId);
  const card = document.querySelector(`.rq-card[data-rq-tenant-id="${tenantId}"]`);
  if (!card) return;
  card.classList.add('rq-acknowledged');
  const btn = card.querySelector('.rq-btn--ack');
  if (btn) btn.outerHTML = `<span class="rq-chip">Acknowledged</span>`;
}

// Returns chip objects {label, cls} for the property card review summary (max 3).
function _rqPropCardBullets(items) {
  const incomplete  = items.filter(i => i.reviewState === 'incomplete').length;
  const needsReview = items.filter(i => i.reviewState === 'needs_review').length;
  let nnnCap = 0, missingDate = 0;
  items.forEach(item => {
    if (item.missingFields.includes('NNN Cap'))                                               nnnCap++;
    if (item.missingFields.includes('Start Date') || item.missingFields.includes('End Date')) missingDate++;
  });
  const chips = [];
  if (incomplete  > 0) chips.push({ label: `${incomplete} Incomplete`,      cls: 'review-chip--incomplete' });
  if (needsReview > 0) chips.push({ label: `${needsReview} Needs Review`,   cls: 'review-chip--moderate'   });
  if (nnnCap      > 0) chips.push({ label: `${nnnCap} NNN Cap`,             cls: ''                        });
  if (missingDate > 0) chips.push({ label: `${missingDate} Missing Date`,   cls: ''                        });
  return chips.slice(0, 3);
}

// Compact single-row card for property-level queue.
function _rqCompactItemHtml(item) {
  const acked = _reviewAcknowledged.has(item.tenantId);
  const urgCls = _rqUrgencyClass(item.reviewScore);
  const stateCfg = {
    incomplete:        { cls: 'trs-incomplete',        label: 'Incomplete' },
    needs_review:      { cls: 'trs-needs-review',      label: 'Needs Review' },
    manually_verified: { cls: 'trs-manually-verified', label: 'Verified' },
  }[item.reviewState] || { cls: 'trs-needs-review', label: item.reviewState };
  const scoreColor = item.reviewScore >= 80 ? 'trs-score--high' : item.reviewScore >= 50 ? 'trs-score--mid' : 'trs-score--low';
  const tid = esc(item.tenantId);

  const missingChips = item.missingFields.map(f => `<span class="rq-chip rq-chip--missing">${esc(f)}</span>`).join('');
  const warnChips    = item.warningReasons.map(w => `<span class="rq-chip rq-chip--warn">${esc(w)}</span>`).join('');

  return `
  <div class="rq-card rq-card--compact ${urgCls}${acked ? ' rq-acknowledged' : ''}" data-rq-tenant-id="${tid}">
    <div class="rq-compact-name">${esc(item.tenantName)}</div>
    <span class="trs-badge ${stateCfg.cls}">${stateCfg.label}</span>
    <span class="trs-score ${scoreColor}">Score: ${item.reviewScore}</span>
    <div class="rq-chips rq-chips--inline">${missingChips}${warnChips}</div>
    <div class="rq-compact-actions">
      ${acked
        ? `<span class="rq-chip">Acknowledged</span>`
        : `<button class="rq-action-btn rq-btn--ack" onclick="markTenantReviewAcknowledged('${tid}')">Mark Reviewed</button>`}
    </div>
  </div>`;
}

// Property-level queue: grouped by this property, rendered above tenant table.
function renderPropertyReviewQueue(property) {
  const panel = document.getElementById('propertyReviewQueuePanel');
  if (!panel) return;

  const allItems  = getReviewQueueItems([property]);
  const nonAcked  = allItems.filter(i => !_reviewAcknowledged.has(i.tenantId));
  const ackedItems = allItems.filter(i => _reviewAcknowledged.has(i.tenantId));

  if (allItems.length === 0) { panel.style.display = 'none'; return; }
  panel.style.display = 'block';

  const counts = {
    all:               nonAcked.length,
    incomplete:        nonAcked.filter(i => i.reviewState === 'incomplete').length,
    needs_review:      nonAcked.filter(i => i.reviewState === 'needs_review').length,
    manually_verified: nonAcked.filter(i => i.reviewState === 'manually_verified').length,
  };
  const critical = nonAcked.filter(i => i.reviewScore < 50).length;

  const healthParts = [];
  if (counts.incomplete        > 0) healthParts.push(`<span class="rq-hs-item rq-hs--incomplete">${counts.incomplete} Incomplete</span>`);
  if (critical                 > 0) healthParts.push(`<span class="rq-hs-item rq-hs--critical">${critical} Critical</span>`);
  if (counts.needs_review      > 0) healthParts.push(`<span class="rq-hs-item rq-hs--moderate">${counts.needs_review} Needs Review</span>`);
  if (counts.manually_verified > 0) healthParts.push(`<span class="rq-hs-item rq-hs--verified">${counts.manually_verified} Manually Verified</span>`);

  const shouldExpand = counts.incomplete > 0;

  const filteredItems = _reviewQueueFilter === 'all'
    ? nonAcked
    : nonAcked.filter(i => i.reviewState === _reviewQueueFilter);
  const displayItems = _reviewQueueFilter === 'all'
    ? [...filteredItems, ...ackedItems]
    : filteredItems;

  const filterCfg = [
    { key: 'all',               label: `All (${counts.all})` },
    { key: 'incomplete',        label: `Incomplete (${counts.incomplete})` },
    { key: 'needs_review',      label: `Needs Review (${counts.needs_review})` },
    { key: 'manually_verified', label: `Verified (${counts.manually_verified})` },
  ];

  panel.innerHTML = `
    <details class="rq-prop-details"${shouldExpand ? ' open' : ''}>
      <summary class="rq-prop-summary">
        <span class="rq-prop-summary-title">Review Queue</span>
        <span class="rq-health-summary">${healthParts.join('')}</span>
      </summary>
      <div class="rq-prop-body">
        <div class="rq-filter-tabs">
          ${filterCfg.map(({ key, label }) =>
              `<button class="rq-tab${_reviewQueueFilter === key ? ' active' : ''}" onclick="setReviewQueueFilter('${key}')">${esc(label)}</button>`
            ).join('')}
        </div>
        <div class="rq-cards rq-cards--compact">
          ${displayItems.length > 0
            ? displayItems.map(_rqCompactItemHtml).join('')
            : `<div class="rq-empty">No tenants in this category</div>`}
        </div>
      </div>
    </details>`;
}

function portfolioKPIs(props) {
  const safeProps = Array.isArray(props) ? props : [];
  const metas     = safeProps.map(p => _buildPropMeta(p));
  const criticalOrElevated = metas.filter(m => m.riskLevel === 'Critical' || m.riskLevel === 'Elevated').length;
  const totalMissingDocs   = metas.reduce((s, m) => s + m.missingDocs, 0);
  const confScores = metas.map(m => m.avgConf).filter(c => c !== null);
  return {
    properties:          safeProps.length,
    cam:                 safeProps.reduce((s, p) => s + (Number(p.totalCAM) || 0), 0),
    openDisputes:        safeProps.reduce((s, p) => s + (Number(p.openDisputes) || 0), 0),
    criticalOrElevated,
    totalMissingDocs,
    avgConf: confScores.length ? Math.round(confScores.reduce((s, c) => s + c, 0) / confScores.length) : null,
  };
}

function renderPortfolio(props) {
  props = props || _props; // handle no-arg calls
  if (!Array.isArray(props)) {
    console.error('[renderPortfolio] called with invalid data:', props);
    return;
  }

  // Per-property metadata (risk, confidence, trend, timestamps)
  const metas = props.map(p => _buildPropMeta(p));

  // Sort
  const riskScore  = { Critical: 4, Elevated: 3, Moderate: 2, Low: 1, None: 0 };
  const sortedPairs = props.map((p, i) => ({ p, m: metas[i] })).sort((a, b) => {
    if (_portfolioSort === 'risk')     return (riskScore[b.m.riskLevel] ?? 0) - (riskScore[a.m.riskLevel] ?? 0);
    if (_portfolioSort === 'recent')   return (b.m.savedAt ? new Date(b.m.savedAt).getTime() : 0) - (a.m.savedAt ? new Date(a.m.savedAt).getTime() : 0);
    if (_portfolioSort === 'cam')      return (b.m.total || 0) - (a.m.total || 0);
    if (_portfolioSort === 'disputes') return (b.m.openDisputes || 0) - (a.m.openDisputes || 0);
    if (_portfolioSort === 'review')   return (b.m.incompleteLeases + b.m.tenantsNeedingReview) - (a.m.incompleteLeases + a.m.tenantsNeedingReview);
    return 0;
  });

  // KPI tiles
  const k = portfolioKPIs(props);
  document.getElementById('pKpiProperties').textContent  = k.properties;
  document.getElementById('pKpiCAM').textContent         = '$' + k.cam.toLocaleString('en-US');
  document.getElementById('pKpiDisputes').textContent    = k.openDisputes;
  document.getElementById('pKpiCritical').textContent    = k.criticalOrElevated;
  document.getElementById('pKpiMissingDocs').textContent = k.totalMissingDocs;
  document.getElementById('pKpiConfidence').textContent  = k.avgConf !== null ? k.avgConf + '%' : '—';

  // Conditional accent on risk-sensitive KPIs
  const critEl = document.getElementById('pKpiCritical');
  const dispEl = document.getElementById('pKpiDisputes');
  const missEl = document.getElementById('pKpiMissingDocs');
  if (critEl) critEl.style.color = k.criticalOrElevated > 0 ? '#f87171' : '#C9973A';
  if (dispEl) dispEl.style.color = k.openDisputes        > 0 ? '#f87171' : '#C9973A';
  if (missEl) missEl.style.color = k.totalMissingDocs    > 0 ? '#fbbf24' : '#C9973A';

  // Sort buttons
  const sortCfg = [
    { key: 'risk',     label: 'Highest Risk'  },
    { key: 'recent',   label: 'Most Recent'   },
    { key: 'cam',      label: 'Largest CAM'   },
    { key: 'disputes', label: 'Most Disputes' },
    { key: 'review',   label: 'Needs Review'  },
  ];
  const sortRowEl = document.getElementById('ptfSortRow');
  if (sortRowEl) {
    sortRowEl.innerHTML = '<span class="ptf-sort-lbl">Sort by:</span>'
      + sortCfg.map(({ key, label }) =>
          `<button class="ptf-sort-btn${_portfolioSort === key ? ' active' : ''}"
            onclick="_portfolioSort='${key}';renderPortfolio(_props)">${esc(label)}</button>`
        ).join('');
  }

  // Property cards
  const statusLabel = { reconciled: 'Reconciled', 'in-progress': 'In Progress', disputes: 'Has Open Disputes' };

  document.getElementById('propertyCardsGrid').innerHTML = sortedPairs.map(({ p, m }) => {
    const tenants      = Array.isArray(p.tenants)  ? p.tenants.length  : (Number(p.tenantCount)  || 0);
    const invoices     = Array.isArray(p.invoices) ? p.invoices.length : (Number(p.invoiceCount) || 0);
    const cam          = m.total || Number(p.totalCAM) || 0;
    const status       = p.status || 'in-progress';

    const riskBadge = (() => {
      const cfg = {
        Critical: 'ptf-risk--critical',
        Elevated: 'ptf-risk--elevated',
        Moderate: 'ptf-risk--moderate',
        Low:      'ptf-risk--low',
      }[m.riskLevel];
      return cfg ? `<span class="ptf-risk-badge ${cfg}">${esc(m.riskLevel)}</span>` : '';
    })();

    const trendHtml = (() => {
      if (!m.trendDir) return '';
      const absPct = Math.abs(m.trendPct || 0).toFixed(0);
      if (m.trendDir === 'up')   return `<span class="ptf-trend ptf-trend--up">&#x2191;${absPct}% YoY</span>`;
      if (m.trendDir === 'down') return `<span class="ptf-trend ptf-trend--down">&#x2193;${absPct}% YoY</span>`;
      return `<span class="ptf-trend ptf-trend--flat">Stable YoY</span>`;
    })();

    const footParts = [];
    if (m.camYear) footParts.push(`<span class="ptf-cam-year">${esc(String(m.camYear))} CAM</span>`);
    if (m.savedAt) footParts.push(`<span class="ptf-rec-ts">${_fmtCardTs(m.savedAt)}</span>`);

    const reviewItems   = getReviewQueueItems([p]).filter(i => !_reviewAcknowledged.has(i.tenantId));
    const reviewChips   = _rqPropCardBullets(reviewItems);
    const pid           = esc(p.id);

    const hasIncomplete   = reviewItems.some(i => i.reviewState === 'incomplete');
    const reviewUrgency   = reviewItems.length === 0 ? '' : hasIncomplete ? ' review--incomplete' : ' review--needs-review';
    const reviewHealth    = reviewItems.length === 0 ? 100
      : Math.max(0, Math.round(reviewItems.reduce((s, i) => s + i.reviewScore, 0) / reviewItems.length));
    const healthCls       = reviewHealth >= 80 ? 'review-health--good' : reviewHealth >= 50 ? 'review-health--mid' : 'review-health--low';

    return `
    <div class="ptf-prop-card status-${status}${activePropId === p.id ? ' active' : ''}${reviewUrgency}" onclick="selectProperty('${pid}')">
      <div class="ptf-card-top">
        <div class="ptf-prop-name">${esc(p.name || '—')}</div>
        ${riskBadge}
      </div>
      <div class="ptf-status-row">
        <span class="ptf-status-dot ${status}"></span>
        <span>${statusLabel[status] || status}</span>
        ${trendHtml}
      </div>
      <div class="ptf-stats-row">
        <div class="ptf-stat"><strong>${tenants}</strong>Tenants</div>
        <div class="ptf-stat"><strong>${invoices}</strong>Invoices</div>
        ${m.openDisputes > 0
          ? `<div class="ptf-stat ptf-stat--alert"><strong>${m.openDisputes}</strong>Disputes</div>`
          : ''}
        ${m.missingDocs > 0
          ? `<div class="ptf-stat ptf-stat--warn"><strong>${m.missingDocs}</strong>No Docs</div>`
          : ''}
      </div>
      ${reviewChips.length > 0 ? `
      <div class="property-review-summary">
        ${reviewChips.map(c => `<span class="review-chip ${c.cls}">${esc(c.label)}</span>`).join('')}
        <span class="review-health ${healthCls}">${reviewHealth}% Healthy</span>
        <button class="review-queue-btn" onclick="event.stopPropagation();selectProperty('${pid}')">Review ›</button>
      </div>` : ''}
      <div class="ptf-cam-lbl">CAM This Period</div>
      <div class="ptf-cam-val">${cam > 0 ? '$' + cam.toLocaleString('en-US') : '—'}</div>
      ${footParts.length ? `<div class="ptf-card-foot">${footParts.join('')}</div>` : ''}
      ${m.avgConf !== null
        ? `<div class="ptf-conf-bar" title="${m.avgConf}% avg. match confidence">
             <div class="ptf-conf-fill" style="width:${m.avgConf}%"></div>
           </div>`
        : ''}
    </div>`;
  }).join('');

  renderReviewQueue(props);

  document.getElementById('portfolioDashboard').style.display = 'block';
  document.getElementById('propertyBreadcrumb').style.display = 'none';
  document.getElementById('mainWorkflow').style.display       = 'none';
}

async function selectProperty(id) {
  const property = _props.find(p => p.id === id);
  if (!property) return;

  // If re-selecting the same active property and we already have live
  // in-memory tenants, just re-render — do not reset or reload
  if (id === activePropId && tenantData.some(t => t && t.tenant_name)) {
    renderProperty(property);
    return;
  }

  // Fire-and-forget save for the property we're leaving — don't block navigation
  if (activePropId && activePropId !== id) {
    savePropertyData();
  }

  // Switch active property and clear workflow state
  activePropId = id;
  resetWorkflow();

  // ⚡ INSTANT: render with whatever is already in the _props cache.
  // Do NOT wipe property.tenants/invoices — that would erase data the user
  // just uploaded if they navigate away and back within the same session.
  renderProperty(property);

  // Load from DB/localStorage in the background and update if richer data arrives.
  setTimeout(async () => {
    const data = await loadPropertyData(id);
    if (!data || activePropId !== id) return;

    const safeResults = (data.results?.propId === id) ? data.results : null;
    const safeCamRec  = (data.camReconciliation?.propId === id) ? data.camReconciliation : null;

    console.log('[selectProperty load]', {
      propertyId:   id,
      hasDbResults: !!data.results,
      hasDbCamRec:  !!data.camReconciliation,
      safeCamRec:   !!safeCamRec,
      safeResults:  !!safeResults,
    });

    // Reconciliation results are always applied — they don't depend on tenant count.
    property.results           = safeResults;
    property.camReconciliation = safeCamRec;

    // Tenant/invoice data: only overwrite when loaded data is at least as rich,
    // preventing a stale DB record from erasing a fresh in-session upload.
    const inMemCount  = (property.tenants || []).length;
    const loadedCount = (data.tenants     || []).length;
    if (loadedCount >= inMemCount) {
      property.tenants  = data.tenants  || [];
      property.invoices = data.invoices || [];
      property.disputes = data.disputes || [];
      if (data.name)      property.name      = data.name;
      if (data.totalSqft) property.totalSqft = data.totalSqft;
    }

    // Always re-render so the restored reconciliation snapshot appears even when
    // the tenant-count guard above did not overwrite tenant/invoice arrays.
    if (activePropId === id) {
      console.log('[selectProperty] SECOND renderProperty firing', { id, activePropId });
      renderProperty(property);
      console.log('[selectProperty] SECOND renderProperty done — mainWorkflow display:', document.getElementById('mainWorkflow')?.style.display, 'portfolio display:', document.getElementById('portfolioDashboard')?.style.display);
    }
  }, 0);
}

async function backToPortfolio() {
  // ── 1. Synchronously snapshot all state into the _props entry ─────────────
  //    Do this before clearing activePropId so DOM reads still work.
  if (activePropId) {
    const prop = _props.find(p => p.id === activePropId);
    if (prop) {
      const name = document.getElementById('propertyName')?.value?.trim() || '';
      const sqft = parseFloat(document.getElementById('totalSqft')?.value) || 0;
      if (name) prop.name = name;
      if (sqft) prop.totalSqft = sqft;
      prop.tenants  = tenantData.filter(t => t !== null);
      prop.invoices = Array.from(invoiceData);
      prop.disputes = Array.from(disputes);
      prop.results  = lastResults.length ? {
        propId:      prop.id,
        results:     lastResults, propName: lastPropName, total: lastTotal,
        invoices:    lastInvoices, invoicesFull: lastInvoicesFull,
        tenants:     lastTenants, disputes: Array.from(disputes),
        camRuns:     camRuns.map(r => ({ ...r, timestamp: r.timestamp instanceof Date ? r.timestamp.toISOString() : r.timestamp })),
      } : null;
      // Update portfolio card stats from current session
      if (lastResults.length) {
        prop.tenantCount  = lastResults.length;
        prop.invoiceCount = lastInvoicesFull.length;
        prop.totalCAM     = Math.round(lastResults.reduce((s, r) => s + r.allocatedAmount, 0));
      } else {
        prop.tenantCount  = (prop.tenants || []).length;
        prop.invoiceCount = (prop.invoices || []).length;
      }
      const openCount   = disputes.filter(d => d.status === 'open').length;
      prop.openDisputes = openCount;
      prop.status       = openCount > 0      ? 'disputes'
                        : lastResults.length ? 'reconciled'
                        : 'in-progress';
      // Cancel any pending debounce timer — we're saving now
      clearTimeout(_saveDebounceTimer);
      // Always flush to localStorage synchronously before navigating away
      _lsSave(prop);
      // Fire-and-forget the DB write
      saveProperty(prop);
    }
  }

  // ── 2. Show portfolio immediately — no waiting for network ────────────────
  activePropId = null;
  renderPortfolio(_props);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function addNewProperty() {
  // No id — saveProperty will INSERT and patch newProp.id with the Supabase UUID
  const newProp = {
    name: 'New Property', totalSqft: 0,
    status: 'in-progress', tenantCount: 0, invoiceCount: 0,
    totalCAM: 0, openDisputes: 0, createdAt: new Date().toISOString(),
  };
  _props.push(newProp);
  portfolio.push(newProp);
  await saveProperty(newProp); // patches newProp.id in-place
  logActivity('property_created', 'Property created', { severity: 'success', actor: 'User', relatedEntity: newProp.name || 'New Property' });
  await selectProperty(newProp.id);
  setTimeout(() => {
    const el = document.getElementById('propertyName');
    el.focus(); el.select();
  }, 80);
}

async function syncPortfolioEntry() {
  if (!activePropId) return;
  const prop = _props.find(p => p.id === activePropId);
  if (!prop) return;

  const name = document.getElementById('propertyName').value.trim();
  const sqft = parseFloat(document.getElementById('totalSqft').value) || 0;
  if (name) prop.name = name;
  if (sqft) prop.totalSqft = sqft;

  if (lastResults.length) {
    prop.tenantCount  = lastResults.length;
    prop.invoiceCount = lastInvoicesFull.length;
    prop.totalCAM     = Math.round(lastResults.reduce((s, r) => s + r.allocatedAmount, 0));
  }

  const openCount   = disputes.filter(d => d.status === 'open').length;
  prop.openDisputes = openCount;
  prop.status       = openCount > 0      ? 'disputes'
                    : lastResults.length ? 'reconciled'
                    : 'in-progress';

  document.getElementById('breadcrumbPropName').textContent = prop.name;
  await saveProperty(prop);
}

function resetWorkflow() {
  // Reset tenant data for both modes
  tenantData.splice(0, tenantData.length, null, null, null);
  document.getElementById('bulkResults').innerHTML = '';
  document.getElementById('bulkProgress').style.display = 'none';
  document.getElementById('bulkLeaseInput').value = '';
  switchLeaseTab('bulk');

  invoiceData.length = 0;
  lastResults = []; lastInvoices = []; lastTenants = [];
  lastPropName = ''; lastTotal = 0; lastInvoicesFull = []; lastFullResults = [];
  disputes.length = 0;
  nextDisputeId = 0;
  camRuns.length = 0;
  document.getElementById('previousRunsSection').style.display = 'none';
  document.getElementById('previousRunsList').innerHTML = '';

  document.getElementById('propertyName').value = '';
  document.getElementById('totalSqft').value    = '';
  document.getElementById('resultsBody').innerHTML = '';
  document.getElementById('resultsTitle').textContent = `${getCamYear()} CAM Reconciliation`;
  document.getElementById('results').style.display = 'none';
  document.getElementById('disputeSection').style.display = '';
  document.getElementById('disputeInvoiceList').innerHTML = '';
  document.getElementById('openDisputesWrap').style.display = 'none';
  document.getElementById('resolvedCount').textContent = '0';
  document.getElementById('reportsMsg').style.display = 'block';
  document.getElementById('reportsMsg').textContent = 'Run a CAM allocation in Section 4 to generate reports.';
  document.getElementById('tenantReportButtons').innerHTML = '';

  renderTenantSlots();
  invoiceData.splice(0, invoiceData.length);
  document.getElementById('invResults').innerHTML = '';
  document.getElementById('invProgress').style.display = 'none';
  document.getElementById('invFileInput').value   = '';
  document.getElementById('invFolderInput').value = '';
  yardiRows = []; yardiColMap = {}; yardiUnrecognized = [];
  document.getElementById('yardiPreview').innerHTML = '';
  switchInvTab('files');
  // Reset GL state
  glData = [];
  document.getElementById('glResults').innerHTML   = '';
  document.getElementById('glImportBar').innerHTML = '';
  document.getElementById('glStatus').style.display = 'none';
  document.getElementById('glStatus').innerHTML    = '';
  document.getElementById('glFileInput').value     = '';
}

function liveUpdateBreadcrumb(name) {
  const el = document.getElementById('breadcrumbPropName');
  if (el) el.textContent = name || 'New Property';
}

// ─── Supabase Persistence ─────────────────────────────────────────────────────
// All property data lives in Supabase: properties(id text PK, name text, data jsonb)
// The `data` column holds everything except id and name — sqft, status, tenants,
// invoices, results, tenantCount, invoiceCount, totalCAM, openDisputes, etc.

// Explicit defaults — structural baseline for default properties.
const defaultProperties = [];

// ── localStorage fallback ─────────────────────────────────────────────────────
// Data is always saved here first (instant, offline-safe).
// Supabase is synced in the background — if it's down, data is still safe.

const _LS_KEY = '_ms_props_v2';

// In-memory fallback for when localStorage is blocked (Safari ITP, private mode, file://)
const _memStore = {};

function _lsGet(key) {
  try { return localStorage.getItem(key); } catch { return _memStore[key] ?? null; }
}
function _lsSet(key, value) {
  try { localStorage.setItem(key, value); } catch { _memStore[key] = value; }
}

// ── IndexedDB lease-file cache ────────────────────────────────────────────────
// Persists File blobs across navigation in the same browser. Falls back to
// Supabase Storage URL for cross-device access when available.
const _IDB_NAME  = 'mainstreet-lease-files';
const _IDB_STORE = 'files';
let   _leaseIdb  = null;

function _openLeaseIdb() {
  if (_leaseIdb) return Promise.resolve(_leaseIdb);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(_IDB_NAME, 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore(_IDB_STORE);
    req.onsuccess  = e => { _leaseIdb = e.target.result; resolve(_leaseIdb); };
    req.onerror    = e => reject(e.target.error);
  });
}

async function storeLeaseFile(tenantId, file) {
  if (!tenantId || !(file instanceof File)) return;
  try {
    const db = await _openLeaseIdb();
    const tx = db.transaction(_IDB_STORE, 'readwrite');
    tx.objectStore(_IDB_STORE).put(file, tenantId);
    await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = e => rej(e.target.error); });
  } catch (e) { }
}

async function getLeaseFile(tenantId) {
  if (!tenantId) return null;
  try {
    const db  = await _openLeaseIdb();
    const tx  = db.transaction(_IDB_STORE, 'readonly');
    const req = tx.objectStore(_IDB_STORE).get(tenantId);
    return new Promise((res, rej) => { req.onsuccess = () => res(req.result ?? null); req.onerror = e => rej(e.target.error); });
  } catch (e) { return null; }
}

async function deleteLeaseFile(tenantId) {
  if (!tenantId) return;
  try {
    const db = await _openLeaseIdb();
    const tx = db.transaction(_IDB_STORE, 'readwrite');
    tx.objectStore(_IDB_STORE).delete(tenantId);
  } catch (e) { }
}

// After restoring tenants from DB, refill leaseFile from IndexedDB and re-render.
async function restoreLeaseFiles() {
  let changed = false;
  await Promise.all(tenantData.map(async (t, idx) => {
    if (!t || !t.id || !t.leaseExpected || t.leaseFile instanceof File) return;
    const file = await getLeaseFile(t.id);
    if (file instanceof File) {
      console.warn('[PIPELINE:diag] restoreLeaseFiles OVERWRITE | idx:', idx, '| t.status:', t?.status, '| existing tenantData[idx].status:', tenantData[idx]?.status, '| pipeline still pending?', tenantData[idx]?.status === 'pending');
      tenantData[idx] = { ...t, leaseFile: file };
      changed = true;
    }
  }));
  if (changed) renderBulkResults();
}

function _stripBlobs(property) {
  if (!property || !Array.isArray(property.tenants)) return property;
  return {
    ...property,
    tenants: property.tenants.map(t => t ? {
      ...t,
      leaseFile: undefined, // File objects are not serializable
      rawText:   undefined, // OCR text only needed during extraction — can be 10k+ chars
    } : t),
    // Strip the full invoice list from the DB payload — invoices live separately
    // and are merged back in on load; keeping them in `data` inflates the row.
    invoices: (property.invoices || []).map(inv => inv ? {
      vendorName:  inv.vendorName,
      amount:      inv.amount,
      category:    inv.category,
      invoiceDate: inv.invoiceDate,
      fileUrl:     inv.fileUrl,
      fileName:    inv.fileName,
      // drop confidence, _error, raw text — not needed for persistence
    } : inv),
    // CAM results can be very large; strip the full invoice copy inside results/camReconciliation
    results: property.results ? {
      ...property.results,
      invoicesFull: undefined,
    } : property.results,
    camReconciliation: property.camReconciliation ? {
      ...property.camReconciliation,
      invoicesFull: undefined,
    } : property.camReconciliation,
  };
}

function _lsSave(property) {
  try {
    const stored = JSON.parse(_lsGet(_LS_KEY) || '{}');
    stored[property.id] = _stripBlobs(property);
    _lsSet(_LS_KEY, JSON.stringify(stored));
  } catch (e) { }
}

function _lsLoadAll() {
  try {
    const stored = JSON.parse(_lsGet(_LS_KEY) || '{}');
    const rows = Object.values(stored);
    return rows.length ? rows : null;
  } catch (e) { return null; }
}

function _lsLoad(id) {
  try {
    const stored = JSON.parse(_lsGet(_LS_KEY) || '{}');
    return stored[id] || null;
  } catch (e) { return null; }
}

async function loadProperties() {
  const { data: { user } } = await db.auth.getUser();
  if (!user?.id) throw new Error('Not authenticated');

  // Select only the columns needed for the property list — skip the large data blob.
  const { data, error } = await db
    .from('properties')
    .select('id, name, sqft, user_id')
    .eq('user_id', user.id);

  if (error) throw error;

  const properties = (data || []).map(p => ({
    id:         p.id,
    name:       p.name,
    totalSqft:  p.sqft || 0,
  }));

  if (properties.length === 0) return properties;

  const propertyIds = properties.map(p => p.id);
  const { data: tenantRows, error: tenantErr } = await db
    .from('tenants')
    .select('id, property_id, name, sqft, cap, start_date, end_date, lease_url, lease_type')
    .in('property_id', propertyIds);

  if (tenantErr) console.error('[loadProperties] tenants error:', tenantErr.message);

  const allTenants = tenantRows || [];
  properties.forEach(p => {
    // Map DB column names back to the field names the app expects
    p.tenants = allTenants
      .filter(t => t.property_id === p.id)
      .map(t => normalizeTenant({
        id:          t.id,
        tenant_name: t.name,
        leased_sqft: t.sqft,
        cap:         t.cap,
        start_date:  t.start_date,
        end_date:    t.end_date,
        lease_url:   t.lease_url,
        lease_type:  t.lease_type,
      }));
  });

  return properties;
}

// Per-property serialization: prevents concurrent delete+insert races.
// Each entry: { running: boolean, pending: tenants[]|null }
const _resyncQueues = new Map();

async function _doResyncTenantsToTable(propertyId, tenants) {
  const { error: delErr } = await db.from('tenants').delete().eq('property_id', propertyId);
  if (delErr) { console.error('[resyncTenantsToTable] delete error:', delErr.message); return; }
  const rows = (tenants || [])
    .filter(t => t && t.tenant_name && !t._pendingJobReview)
    .map(t => ({
      id:          t.id,
      property_id: propertyId,
      name:        t.tenant_name || null,
      sqft:        Number(t.leased_sqft) || null,
      cap:         t.cap ?? t.cam_cap ?? t.capPercentage ?? null,
      start_date:  t.start_date || null,
      end_date:    t.end_date   || null,
      ...(t.leaseUrl ? { lease_url: t.leaseUrl } : {}),
      lease_type:  t.lease_type || null,
    }));
  if (rows.length === 0) return;
  const { error } = await db.from('tenants').insert(rows).select('id');
  if (error) console.error('[resyncTenantsToTable] insert error:', error.message);
}

// Full replace: delete all rows for the property then insert the given list.
// Serialized per-property (last-writer wins): if a resync is already in flight,
// coalesces concurrent callers so the final state always wins with no interleaving.
async function resyncTenantsToTable(propertyId, tenants) {
  if (!propertyId || typeof propertyId !== 'string' || propertyId.length < 10) return;
  let state = _resyncQueues.get(propertyId);
  if (!state) {
    state = { running: false, pending: null };
    _resyncQueues.set(propertyId, state);
  }
  if (state.running) {
    state.pending = tenants; // last caller wins; earlier pending calls are superseded
    return;
  }
  state.running = true;
  try {
    await _doResyncTenantsToTable(propertyId, tenants);
    while (state.pending !== null) {
      const next = state.pending;
      state.pending = null;
      await _doResyncTenantsToTable(propertyId, next);
    }
  } finally {
    state.running = false;
  }
}

async function syncTenantsToTable(propertyId, tenants) {
  if (!propertyId || typeof propertyId !== 'string' || propertyId.length < 10) return;
  const rows = (tenants || [])
    .filter(t => t && t.tenant_name)
    .map(t => ({
      id:          t.id,
      property_id: propertyId,
      name:        t.tenant_name || null,
      sqft:        Number(t.leased_sqft) || null,
      cap:         t.cap ?? t.cam_cap ?? t.capPercentage ?? null,
      start_date:  t.start_date || null,
      end_date:    t.end_date   || null,
      ...(t.leaseUrl ? { lease_url: t.leaseUrl } : {}),
      lease_type:  t.lease_type || null,
    }));
  if (rows.length === 0) return;
  const { error } = await db.from('tenants').insert(rows).select('id');
  if (error) console.error('[syncTenantsToTable] insert error:', error.message);
}

async function saveCamResults(propertyId, fullResults, year) {
  if (!propertyId || !year) return;
  const rows = (fullResults || []).map(r => {
    const actual   = r.actualCam ?? r.totalAllocated ?? null;
    const expected = r.expectedCam ?? null;
    return {
      property_id:  propertyId,
      tenant_id:    r.tenantId,
      actual_cam:   actual,
      expected_cam: expected,
      variance:     (actual !== null && expected !== null)
        ? Math.round((actual - expected) * 100) / 100
        : null,
      year,
    };
  });
  const resp = await fetch('/api/cam-reconciliations', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ propertyId, year, rows }),
  });
  const result = await resp.json();
  if (!resp.ok) console.error('[saveCamResults] error:', result.error, result.detail);
}

async function loadCamResults(propertyId, year) {
  if (!propertyId || !year) return [];
  const resp = await fetch(`/api/cam-reconciliations?propertyId=${encodeURIComponent(propertyId)}&year=${encodeURIComponent(year)}`);
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    console.error('[loadCamResults] error:', err.error);
    return [];
  }
  const { data } = await resp.json();
  return data || [];
}

async function uploadLeaseToStorage(file, propertyId) {
  if (!propertyId) {
    console.warn('[uploadLeaseToStorage] skipped — property has no id yet');
    return null;
  }

  const fileName = `${propertyId}/${Date.now()}-${file.name}`;
  console.log('[uploadLeaseToStorage] uploading', file.name, '→', fileName);

  const attempt = async () => {
    const fileBase64 = await toBase64(file);
    const resp = await fetch('/api/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName, fileType: file.type, fileBase64, bucket: 'leases' }),
    });
    const result = await resp.json();
    if (!resp.ok || result.error) throw new Error(result.error || `HTTP ${resp.status}`);
    return result.url;
  };

  for (let i = 0; i < 3; i++) {
    try {
      const url = await attempt();
      console.log('[uploadLeaseToStorage] SUCCESS:', url);
      return url;
    } catch (e) {
      if (i < 2) {
        await new Promise(r => setTimeout(r, (i + 1) * 1200));
        continue;
      }
      console.error('[uploadLeaseToStorage] failed after 3 attempts:', e.message);
      return null;
    }
  }
}


// Save a property — localStorage first (instant), then Supabase.
// INSERT when property has no id (new); UPSERT when it already has a UUID.
async function saveProperty(property) {
  _lsSave(property);

  try {
    const stripped = _stripBlobs(property);
    const { id, name, totalSqft } = stripped;

    const data = {
      invoices:          stripped.invoices          || [],
      disputes:          stripped.disputes          || [],
      camYear:           stripped.camYear           ?? null,
      results:           stripped.results           ?? null,
      camReconciliation: stripped.camReconciliation ?? null,
      activityLog:       stripped.activityLog       || [],
    };

    console.groupCollapsed('[PIPELINE:3] saveProperty post-strip');
    console.log('invoices[0]:', JSON.parse(JSON.stringify(data.invoices[0] || {})));
    console.log('camRec.results[0].includedInvoices[0]:', JSON.parse(JSON.stringify(data.camReconciliation?.results?.[0]?.includedInvoices?.[0] || {})));
    console.groupEnd();

    const payload = {
      name: name || 'New Property',
      sqft: totalSqft || 0,
      data,
    };

    if (id) {
      const { error } = await db.from('properties')
        .upsert({ id, ...payload })
        .select('id');
      if (error) throw error;
    } else {
      const { data: { user } } = await db.auth.getUser();
      if (!user?.id) throw new Error('Not authenticated');
      const { data: inserted, error } = await db.from('properties')
        .insert({ ...payload, user_id: user.id })
        .select('id')
        .single();
      if (error) throw error;
      property.id = inserted.id;
      _lsSave(property);
    }

    // Tenant sync is NOT done here — syncTenantsToTable is called explicitly
    // at upload completion and on user actions (Done, Remove, Clear All) only.
    // Calling it here caused duplicate inserts: saveProperty runs per file
    // processed, so 5 uploads × 5 cumulative rows = 15 DB rows from one session.
    _setSyncStatus('synced');
  } catch (e) {
    const msg = e?.message || String(e);
    const isNetErr  = /load failed|failed to fetch|networkerror|offline/i.test(msg);

    if (isNetErr) return;

    _setSyncStatus('error');
    logError('saveProperty', e, {
      propId:      property?.id,
      propName:    property?.name,
      invoiceCount: (property?.invoices || []).length,
    });

    const prev = document.getElementById('_saveErrToast');
    if (prev) prev.remove();

    const toast = document.createElement('div');
    toast.id = '_saveErrToast';
    toast.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#92400e;color:#fef3c7;padding:12px 20px;border-radius:6px;z-index:9999;font-size:13px;box-shadow:0 4px 12px rgba(0,0,0,.3);max-width:90vw;text-align:center;';
    toast.textContent = '⚠️ Sync delayed — your data is saved locally and will sync on next save.';
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 5000);
  }
}


// ── App-level wrappers ────────────────────────────────────────────────────────

let _saveDebounceTimer = null;

// Snapshot current in-memory state back into the canonical _props entry and
// persist to Supabase. Debounced — rapid successive calls collapse into one write.
async function savePropertyData() {
  if (!activePropId) return;

  const prop = _props.find(p => p.id === activePropId);
  if (!prop) return;

  try {
    const name = document.getElementById('propertyName')?.value?.trim() || '';
    const sqftDom = parseFloat(document.getElementById('totalSqft')?.value) || 0;
    const sqft = prop.totalSqft || sqftDom;

    if (name) prop.name = name;
    if (sqft) prop.totalSqft = sqft;
    // tenantData is the live working buffer; always sync it to prop.tenants before saving
    // so any field edit (even if prop.tenants wasn't updated) is captured.
    if (tenantData.some(t => t !== null)) prop.tenants = tenantData.filter(t => t !== null);
    prop.invoices = Array.from(invoiceData);

    prop.disputes    = Array.from(disputes);
    prop.activityLog = [...activityLog];
    prop.results  = lastResults.length ? {
      propId:       prop.id,          // used to verify results belong to this property on load
      results:      lastResults,
      propName:     lastPropName,
      total:        lastTotal,
      invoices:     lastInvoices,
      invoicesFull: lastInvoicesFull,
      tenants:      lastTenants,
      disputes:     Array.from(disputes),
      camRuns:      camRuns.map(r => ({ ...r, timestamp: r.timestamp instanceof Date ? r.timestamp.toISOString() : r.timestamp })),
    } : null;

    // Debounce: collapse rapid successive saves (e.g. per-keystroke field edits)
    // into a single DB write 800 ms after the last call.
    _setSyncStatus('pending');
    clearTimeout(_saveDebounceTimer);
    _saveDebounceTimer = setTimeout(() => saveProperty(prop), 800);
  } catch (e) {
    logError('savePropertyData', e, { propId: prop.id, propName: prop.name });
  }
}

// Fetch a single property's full data.
// Returns the richer of the two sources — DB or localStorage — measured by tenant count.
// This prevents a timed-out DB write from making the old (empty) DB record win over
// the localStorage snapshot that was written before the timeout.
async function loadPropertyData(id) {
  let dbData  = null;
  let lsData  = _lsLoad(id);

  try {
    if (!id || typeof id !== 'string') throw new Error('invalid id');
    const { data, error } = await db
      .from('properties')
      .select('id, name, sqft, data')
      .eq('id', id)
      .single();
    if (!error && data) {
      const d = data.data || {};
      dbData = {
        id:        data.id,
        name:      data.name,
        totalSqft: data.sqft || 0,
        invoices:          d.invoices          || [],
        disputes:          d.disputes          || [],
        camYear:           d.camYear           ?? null,
        results:           d.results           ?? null,
        camReconciliation: d.camReconciliation ?? null,
        activityLog:       d.activityLog       || [],
      };
      console.groupCollapsed('[PIPELINE:4] Supabase read');
      console.log('invoices[0]:', JSON.parse(JSON.stringify(dbData.invoices[0] || {})));
      console.log('camRec.results[0].includedInvoices[0]:', JSON.parse(JSON.stringify(dbData.camReconciliation?.results?.[0]?.includedInvoices?.[0] || {})));
      console.groupEnd();

      // Fetch tenants from their own table and merge in
      const { data: tenantRows } = await db
        .from('tenants')
        .select('id, property_id, name, sqft, cap, start_date, end_date, lease_url, lease_type')
        .eq('property_id', id);
      if (tenantRows?.length) {
        dbData.tenants = tenantRows.map(t => normalizeTenant({
          id:          t.id,
          tenant_name: t.name,
          leased_sqft: t.sqft,
          cap:         t.cap,
          start_date:  t.start_date,
          end_date:    t.end_date,
          lease_url:   t.lease_url,
          lease_type:  t.lease_type,
        }));

        // Merge persisted CAM results into tenant objects so the UI can restore them
        const camRows = await loadCamResults(id, getCamYear());
        if (camRows.length) {
          dbData.tenants = dbData.tenants.map(t => {
            const cam = camRows.find(r => r.tenant_id === t.id);
            if (!cam) return t;
            return {
              ...t,
              expectedCam: cam.expected_cam,
              actualCam:   cam.actual_cam,
              variance:    cam.variance,
            };
          });

          // If the full snapshot is missing from properties.data (e.g. saveProperty
          // failed while saveCamResults succeeded), rebuild a minimal camReconciliation
          // from the cam_reconciliations rows so the results section still restores.
          if (!dbData.camReconciliation && !dbData.results) {
            const totalSqft   = dbData.totalSqft || 1;
            // Use the invoices already loaded from properties.data so invoice
            // counts and totals display correctly instead of showing "0 invoices".
            const invoiceList = dbData.invoices || [];
            const invoiceCount = invoiceList.length;
            const invoiceTotal = invoiceList.reduce(
              (s, inv) => s + (parseFloat(inv.amount) || 0), 0
            );

            const snapResults = dbData.tenants
              .filter(t => t.actualCam != null)
              .map(t => ({
                name:             t.tenant_name || '(Unknown)',
                allocatedAmount:  t.actualCam,
                totalAllocated:   t.actualCam,
                proRata:          (Number(t.leased_sqft) || 0) / totalSqft,
                proRataPercent:   ((Number(t.leased_sqft) || 0) / totalSqft) * 100,
                // All invoices are eligible for every tenant in a standard CAM run;
                // we can't recover the per-tenant breakdown from cam_reconciliations
                // alone, so use the full invoice count as the best approximation.
                eligibleCount:    invoiceCount,
                capApplied:       false,
                capAdjustment:    null,
                includedInvoices: [],
                ambiguityFlags:   [],
              }));
            if (snapResults.length) {
              console.log('[loadPropertyData] FALLBACK PATH — rebuilding camReconciliation from cam_reconciliations rows', {
                snapResultsLen: snapResults.length,
                dbTenantsLen: (dbData.tenants || []).length,
                totalSqft,
              });
              dbData.camReconciliation = {
                propId:       dbData.id,
                propName:     dbData.name || '',
                camYear:      camRows[0]?.year ?? getCamYear(),
                // Prefer the sum of stored invoice amounts; fall back to sum of
                // actual_cam values if no invoices were saved in properties.data.
                total:        invoiceTotal || snapResults.reduce((s, r) => s + (r.allocatedAmount || 0), 0),
                results:      snapResults,
                invoices:     invoiceList.map((inv, i) => ({ id: `inv-${i}`, ...inv })),
                invoicesFull: invoiceList,
                tenants:      (dbData.tenants || [])
                  .filter(t => t && t.tenant_name)
                  .map(t => ({
                    name:               t.tenant_name,
                    leasedSqft:         Number(t.leased_sqft) || 0,
                    totalSqft:          totalSqft,
                    excludedCategories: t.excluded_categories
                      ? t.excluded_categories.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
                      : [],
                  })),
                camRuns:      [],
              };
            }
          }
        }
      }
    }
  } catch (e) {
    const isNet = /load failed|failed to fetch|networkerror|offline/i.test(e?.message || '');
    if (!isNet) logError('loadPropertyData', e, { propId: id });
    // fall through to localStorage
  }

  if (!dbData) {
    console.log('[loadPropertyData] MERGE: using lsData only (no dbData)', { lsInvoices: lsData?.invoices?.length });
    return lsData;
  }
  if (!lsData) {
    console.log('[loadPropertyData] MERGE: using dbData only (no lsData)', { dbInvoices: dbData?.invoices?.length });
    return dbData;
  }

  // Tenant/invoice data: prefer whichever source has more (prevents stale DB
  // from erasing a fresh upload that hasn't synced yet).
  const dbCount = (dbData.tenants || []).length;
  const lsCount = (lsData.tenants || []).length;
  const base = lsCount > dbCount ? lsData : dbData;

  console.groupCollapsed('[PIPELINE:4b] MERGE decision');
  console.log('winner:', lsCount > dbCount ? 'localStorage' : 'supabase', { dbTenants: dbCount, lsTenants: lsCount, dbInvoices: (dbData.invoices||[]).length, lsInvoices: (lsData.invoices||[]).length });
  console.log('base.invoices[0]:', JSON.parse(JSON.stringify(base.invoices?.[0] || {})));
  console.groupEnd();

  // Reconciliation results: always prefer Supabase — it is written immediately
  // after each run and is the authoritative source. localStorage may lag behind
  // or be missing the field entirely on older sessions.
  return {
    ...base,
    results:           dbData.results           ?? base.results           ?? null,
    camReconciliation: dbData.camReconciliation ?? base.camReconciliation ?? null,
  };
}

// Restore a property's saved state into working arrays and render the detail view.
// Called exactly once from selectProperty — after data has been attached to `property`.
function renderProperty(property) {
  let restored = false;

  // ── Header ────────────────────────────────────────────────────────────
  document.getElementById('propertyName').value             = property.name;
  document.getElementById('totalSqft').value                = property.totalSqft || '';
  document.getElementById('breadcrumbPropName').textContent = property.name;

  // ── Tenants ───────────────────────────────────────────────────────────
  try {
    // While a pipeline is running, placeholderIdx references inside processFile /
    // _runLeaseJobPipeline are live. Splicing tenantData would shift or wipe those
    // indices, leaving the placeholder at the wrong slot and creating ghost cards.
    // Just re-render the current state and let the pipeline own the array.
    const hasPending = tenantData.some(t => t?.status === 'pending');

    if (hasPending) {
      renderBulkResults();
      restored = true;
    } else {
      const liveTenants = tenantData.filter(t => t && t.tenant_name);

      if (liveTenants.length > 0) {
        // Deduplicate in-place by stable UUID (t.id)
        const seen = new Set();
        const deduped = tenantData.filter(t => {
          if (!t || typeof t !== 'object') return false;
          const key = t.id || t.fileName || t.tenant_name;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        tenantData.splice(0, tenantData.length, ...deduped);
        // Normalize leased_sqft to a clean number in-place and sync to property.tenants
        tenantData.forEach((t, idx) => {
          if (t) tenantData[idx] = { ...t, leased_sqft: Number(t.leased_sqft) || 0 };
        });
        property.tenants = [...tenantData];
        switchLeaseTab('bulk');
        renderBulkResults();
        restored = true;
      } else {
        const tenants = (property.tenants || []).filter(t => t !== null);
        if (tenants.length) {
          property.tenants = tenants.map(normalizeTenant);
          // Sync tenantData from property.tenants so renderBulkResults and field edits work.
          // resetWorkflow() clears tenantData on every navigation, so we must repopulate it
          // here whenever we restore from property.tenants (the else branch = tenantData was empty).
          tenantData.splice(0, tenantData.length, ...property.tenants);
          switchLeaseTab('bulk');
          renderBulkResults();
          restored = true;
        }
      }
    }
    checkSqftValidation();
    // Don't restore files while a pipeline is running — restoreLeaseFiles uses stale
    // captured (t, idx) refs and would overwrite finalEntry with the old placeholder.
    if (!hasPending) restoreLeaseFiles();
  } catch (e) { }

  // ── Invoices ──────────────────────────────────────────────────────────
  try {
    const invoices = property.invoices || [];
    if (invoices.length) {
      invoiceData.splice(0, invoiceData.length, ...invoices);
      console.groupCollapsed('[PIPELINE:5] renderProperty invoices restored');
      console.log('invoices[0]:', JSON.parse(JSON.stringify(invoices[0] || {})));
      console.log('invoiceData[0] after splice:', JSON.parse(JSON.stringify(invoiceData[0] || {})));
      console.groupEnd();
      switchInvTab('files');
      renderInvResults();
      restored = true;
    }
  } catch (e) {
    logError('renderProperty.invoices', e, { propId: property?.id, propName: property?.name });
  }

  // ── Disputes ──────────────────────────────────────────────────────────
  try {
    const savedDisputes = property.disputes || [];
    if (savedDisputes.length) {
      disputes.splice(0, disputes.length, ...savedDisputes);
      nextDisputeId = Math.max(...savedDisputes.map(d => d.id + 1), 0);
    }
  } catch (e) { }

  // ── Activity Log ──────────────────────────────────────────────────────
  try {
    const savedLog = property.activityLog || [];
    activityLog.splice(0, activityLog.length, ...savedLog);
  } catch (e) { }

  // ── CAM Results ───────────────────────────────────────────────────────
  // camReconciliation is the authoritative snapshot (written immediately after
  // each run). property.results is the legacy fallback for older saved data.
  try {
    const propertyId = property.id;
    console.log('[restore]', {
      propertyId,
      hasResults:    !!property.results,
      hasCamRec:     !!property.camReconciliation,
      resultsPropId: property.results?.propId,
      camRecCount:   property.camReconciliation?.length,
    });
    const rec = property.camReconciliation ?? property.results;
    if (rec && Array.isArray(rec.results) && rec.results.length &&
        (!rec.propId || rec.propId === property.id)) {
      // invoicesFull is stripped by _stripBlobs before every save (Supabase + localStorage)
      // to keep payloads small. Re-hydrate it here from invoiceData, which was
      // already populated by the invoices block above, so the summary bar
      // ("Invoices: N") and per-tenant stat ("X of N") render correctly.
      const invoiceFull = rec.invoicesFull?.length
        ? rec.invoicesFull
        : invoiceData.length ? [...invoiceData] : (property.invoices || []);
      const patchedRec = invoiceFull.length && !rec.invoicesFull?.length
        ? {
            ...rec,
            invoicesFull: invoiceFull,
            // eligibleCount of 0 means it was lost (fallback path); replace with
            // full invoice count, which is correct for standard CAM allocations.
            results: rec.results.map(r =>
              r.eligibleCount ? r : { ...r, eligibleCount: invoiceFull.length }
            ),
          }
        : rec;
      restoreResultsDisplay(patchedRec);
      renderDisputeSection();
      renderPreviousRuns();
      renderNarrativePanel();
      renderAuditPanel();
      renderHistoricalTrendsPanel();
      renderActivityTimeline();
      showReportSection();
      restored = true;
    }
  } catch (e) {
    logError('renderProperty.restoreResults', e, { propId: property?.id, propName: property?.name });
  }

  if (restored) showRestoredBanner();

  // ── Show property view ────────────────────────────────────────────────
  document.getElementById('portfolioDashboard').style.display  = 'none';
  document.getElementById('propertyBreadcrumb').style.display  = 'flex';
  document.getElementById('mainWorkflow').style.display        = 'block';

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Wipe saved data for the active property and reset the workflow UI.
async function clearPropertyData() {
  if (!activePropId) return;
  if (!confirm(
    'Clear saved tenants, invoices, and results for this property?\n' +
    'The property will remain in your portfolio.'
  )) return;

  const prop = _props.find(p => p.id === activePropId);
  if (prop) {
    prop.tenants  = [];
    prop.invoices = [];
    prop.results  = null;
    await saveProperty(prop);
  }

  const savedName = document.getElementById('propertyName').value;
  const savedSqft = document.getElementById('totalSqft').value;
  resetWorkflow();
  document.getElementById('propertyName').value = savedName;
  document.getElementById('totalSqft').value    = savedSqft;
}

// Re-draw the results cards from a reconciliation snapshot.
// Pass the snapshot object to hydrate globals before rendering, or omit to
// render from already-set globals (e.g. immediately after runAllocation).
function restoreResultsDisplay(snapshot) {
  if (snapshot) {
    lastResults      = snapshot.results      || [];
    lastPropName     = snapshot.propName     || '';
    lastTotal        = snapshot.total        || 0;
    lastInvoices     = snapshot.invoices     || [];
    // Normalize restored invoices to always carry `vendor` (the field used by fresh-run paths).
    // _stripBlobs preserves `vendorName` but drops the `vendor` alias that runAllocation creates.
    // Without this, generateTenantStatement and epToggleDrill vendor matches return nothing.
    lastInvoicesFull = (snapshot.invoicesFull || []).map(inv => inv && !inv.vendor
      ? { ...inv, vendor: inv.vendorName || '' }
      : inv
    );
    lastTenants      = snapshot.tenants      || [];
    console.groupCollapsed('[PIPELINE:6] restoreResultsDisplay');
    console.log('lastInvoicesFull[0]:', JSON.parse(JSON.stringify(lastInvoicesFull[0] || {})));
    console.log('lastResults[0].includedInvoices[0]:', JSON.parse(JSON.stringify(lastResults[0]?.includedInvoices?.[0] || {})));
    console.log('invoiceData[0] at restore time:', JSON.parse(JSON.stringify(invoiceData[0] || {})));
    console.groupEnd();
    if (snapshot.camYear) setCamYear(snapshot.camYear);
    if (Array.isArray(snapshot.camRuns) && snapshot.camRuns.length) {
      camRuns.splice(0, camRuns.length, ...snapshot.camRuns.map(run => ({
        ...run,
        timestamp: run.timestamp ? new Date(run.timestamp) : new Date(),
      })));
    }
  }
  const section = document.getElementById('results');
  const body    = document.getElementById('resultsBody');
  document.getElementById('resultsTitle').textContent = `${getCamYear()} CAM — ${lastPropName}`;

  let html = `<div class="summary-bar">
    <strong>Total Expenses:</strong> ${fmt(lastTotal)}
    &nbsp;|&nbsp; <strong>Tenants:</strong> ${lastResults.length}
    &nbsp;|&nbsp; <strong>Invoices:</strong> ${lastInvoicesFull.length}
  </div>`;

  lastResults.forEach(r => {
    html += `<div class="result-card">
      <div class="r-name">${esc(r.name)}</div>
      <div class="result-grid">
        ${stat('Allocated Amount',  fmt(r.allocatedAmount))}
        ${stat('Pro-Rata Share',    (r.proRata * 100).toFixed(2) + '%')}
        ${stat('Included Expenses', r.eligibleCount + ' of ' + lastInvoicesFull.length)}
      </div>
      ${r.capApplied
        ? `<div class="cap-badge">Cap applied — ${fmt(r.capAdjustment)} reduced</div>`
        : ''}
      <button class="explain-btn" onclick="openExplainPanel('${esc(r.name)}')">&#x1F4CA; View Calculation</button>
    </div>`;
  });

  body.innerHTML = html;
  section.style.display = 'block';

  // Confirm the explain buttons rendered with onclick and are not pointer-blocked
  const firstBtn = body.querySelector('.explain-btn');
  console.log('[restoreResultsDisplay] results rendered', {
    resultCount:      lastResults.length,
    firstBtnOnclick:  firstBtn?.getAttribute('onclick'),
    firstBtnPE:       firstBtn ? window.getComputedStyle(firstBtn).pointerEvents : 'N/A',
    sectionPE:        window.getComputedStyle(section).pointerEvents,
    bodyPE:           window.getComputedStyle(body).pointerEvents,
    sectionDisplay:   section.style.display,
  });
}

// Show a temporary green banner confirming data was loaded from a previous session.
function showRestoredBanner() {
  let banner = document.getElementById('restoredBanner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'restoredBanner';
    banner.style.cssText = [
      'position:fixed', 'top:16px', 'left:50%', 'transform:translateX(-50%)',
      'z-index:9999', 'background:#166534', 'color:#dcfce7',
      'padding:10px 20px', 'border-radius:10px', 'font-size:0.85rem',
      'font-weight:600', 'box-shadow:0 4px 20px rgba(0,0,0,0.5)',
      'transition:opacity 0.6s', 'pointer-events:none', 'white-space:nowrap',
    ].join(';');
    document.body.appendChild(banner);
  }
  banner.textContent = '✅ Data restored from previous session';
  banner.style.opacity = '1';
  clearTimeout(banner._hideTimer);
  banner._hideTimer = setTimeout(() => { banner.style.opacity = '0'; }, 4000);
}


// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  _loadCheckpoints();

  // ── Review mode: detect #review/{token} in URL hash ──────────────────────
  const hashMatch = location.hash.match(/^#review\/([a-f0-9-]{36})$/i);
  if (hashMatch) {
    const payload = validateReviewToken(hashMatch[1]);
    if (payload) {
      enterReviewMode(payload);
    } else {
      // Token is expired or unknown — show error screen
      document.getElementById('portfolioDashboard').style.display = 'none';
      document.getElementById('mainWorkflow').style.display       = 'none';
      const exp = document.getElementById('reviewExpiredMsg');
      if (exp) exp.style.display = 'flex';
    }
    return; // never proceed to normal portfolio load in review mode
  }

  try {
    const properties = await loadProperties();
    _props = properties || [];
    portfolio.splice(0, portfolio.length, ..._props);
    renderPortfolio(properties);
  } catch (e) {
    const isNet = /load failed|failed to fetch|networkerror|offline/i.test(e?.message || '');
    if (!isNet) logError('init.loadProperties', e, {});
    else console.warn('[init] offline — loading from localStorage');
    // Show the dashboard with zero properties — never hide it on a transient error.
    // This keeps the user on the correct screen instead of the empty workflow.
    _props = [];
    portfolio.splice(0, portfolio.length);
    renderPortfolio([]);
    document.getElementById('portfolioDashboard').style.display = 'block';
    document.getElementById('mainWorkflow').style.display       = 'none';
  }
}

