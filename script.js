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
  _lsUserId = (user && user.id) ? user.id : null;
  _lsMigrateAncillaryKeys(); // scope ancillary LS keys + re-hydrate _camYear
  initCamYearSelect();       // re-sync dropdown now that _camYear may have changed
  document.getElementById('loginScreen').style.display  = 'none';
  document.getElementById('appContent').style.display   = 'block';
  if (user?.email) document.getElementById('headerUserEmail').textContent = user.email;
  const _acNorm = window.AuthService ? window.AuthService.hydrateFromSupabaseUser(user) : null;
  if (_acNorm) {
    const _roleEl = document.getElementById('headerRoleBadge');
    if (_roleEl) { _roleEl.textContent = _acNorm.role; _roleEl.setAttribute('data-role', _acNorm.role); _roleEl.style.display = ''; }
    const _appEl = document.getElementById('appContent');
    if (_appEl) _appEl.setAttribute('data-role', _acNorm.role);
  }
}

function _showLogin() {
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('appContent').style.display  = 'none';
}

let _authMode = 'signin'; // 'signin' | 'signup'
let _initialized = false;
let _lsUserId = null; // set in _showApp(), cleared in _clearAppState()

function _lsUserKey()   { return _lsUserId ? `_ms_props_v2_${_lsUserId}`       : '_ms_props_v2_anon'; }
function _errKey()      { return _lsUserId ? `mainstreet_errors_v1_${_lsUserId}`  : 'mainstreet_errors_v1'; }
function _cpKey()       { return _lsUserId ? `mainstreet_ckpt_v1_${_lsUserId}`    : 'mainstreet_ckpt_v1'; }
function _rvKey()       { return _lsUserId ? `mainstreet_review_v1_${_lsUserId}`  : 'mainstreet_review_v1'; }
function _camYearKey()  { return _lsUserId ? `ms_camYear_${_lsUserId}`            : 'ms_camYear_anon'; }

// One-time migration: if the unscoped key has data and the scoped key does not,
// move the value to the scoped key and delete the unscoped one.
function _lsMigrateAncillaryKeys() {
  if (!_lsUserId) return;
  [
    ['mainstreet_errors_v1',  _errKey()],
    ['mainstreet_ckpt_v1',   _cpKey()],
    ['mainstreet_review_v1', _rvKey()],
    ['camYear',              _camYearKey()],
    ['ms_debug_leases',      'ms_debug_leases_' + _lsUserId],
  ].forEach(function(pair) {
    var old = pair[0], scoped = pair[1];
    if (old === scoped) return;
    if (localStorage.getItem(scoped) !== null) return;
    var val = localStorage.getItem(old);
    if (val === null) return;
    try { localStorage.setItem(scoped, val); } catch (_) {}
    localStorage.removeItem(old);
  });
  // Re-hydrate _camYear from the now-scoped key
  var stored = localStorage.getItem(_camYearKey());
  if (stored) _camYear = parseInt(stored, 10) || _camYear;
}

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
  if (window.AuthService) window.AuthService.clear();
  _clearAppState();
  _initialized = false;
  _showLogin(); // Reset UI immediately — don't wait on Supabase
  try {
    await db.auth.signOut();
  } catch (e) {
    console.warn('[signOut] Supabase error:', e?.message);
  }
}

function _clearAppState() {
  _lsUserId        = null;
  activePropId     = null;
  _props           = [];
  lastResults      = [];
  lastPropName     = '';
  lastTotal        = 0;
  lastInvoicesFull = [];
  lastFullResults  = [];
  lastInvoices     = [];
  lastTenants      = [];
  _lastReconIssues = [];
  _dwActiveDid     = null;
  nextDisputeId    = 0;
  _saveGeneration  = 0;
  if (_saveDebounceTimer) { clearTimeout(_saveDebounceTimer); _saveDebounceTimer = null; }
  camRuns.length     = 0;
  disputes.length    = 0;
  activityLog.length = 0;
  invoiceData.length = 0;
  portfolio.length   = 0;
  tenantData[0] = tenantData[1] = tenantData[2] = null;
  Object.keys(_snapshots).forEach(k => delete _snapshots[k]);
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
  if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && session?.user) {
    _showApp(session.user);
    if (!_initialized) {
      _initialized = true;
      init();
    }
  } else if (event === 'TOKEN_REFRESHED') {
    console.log('[Auth] Token refreshed');
  } else if (event === 'SIGNED_OUT') {
    _clearAppState();
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

// Returns the Authorization header object for the current Supabase session.
// Returns {} (no-op spread) when unauthenticated so calls still go through
// to get a clean 401 from the server rather than silently failing client-side.
async function _authHeaders() {
  try {
    const { data } = await db.auth.getSession();
    if (!data?.session) return {};
    // Refresh if the token expires within the next 60 seconds so API routes
    // never receive an expired JWT (getSession() returns stale tokens as-is).
    const expiresAt = data.session.expires_at ?? 0;
    if (expiresAt - Date.now() / 1000 < 60) {
      const { data: r } = await db.auth.refreshSession();
      const tok = r?.session?.access_token;
      return tok ? { 'Authorization': `Bearer ${tok}` } : {};
    }
    return { 'Authorization': `Bearer ${data.session.access_token}` };
  } catch { return {}; }
}

// Single entry-point for every Claude API call.
// Proxies through /api/claude — API key stays server-side.
async function claudeFetch(body) {
  const resp = await _fetchWithTimeout('/api/claude', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await _authHeaders()) },
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
    headers: { 'Content-Type': 'application/json', ...(await _authHeaders()) },
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
  "suite": string | null,
  "lease_start_date": "YYYY-MM-DD",
  "lease_end_date": "YYYY-MM-DD",
  "lease_type": string,
  "sqft": number,
  "base_rent": number | null,
  "cam_cap": number,
  "admin_fee_pct": number | null,
  "gross_up_pct": number | null,
  "expense_stop": number | null,
  "audit_rights": true | false | null,
  "pro_rata_method": "rentable" | "leasable" | "occupied" | "gross" | null,
  "renewal_options": string | null,
  "excluded_categories": string | null,
  "security_deposit": number | null,
  "quotes": {
    "cam_cap": string | null,
    "admin_fee_pct": string | null,
    "gross_up_pct": string | null,
    "expense_stop": string | null,
    "audit_rights": string | null,
    "pro_rata_method": string | null,
    "renewal_options": string | null,
    "base_rent": string | null,
    "security_deposit": string | null
  }
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
- admin_fee_pct: Look for "management fee", "administrative fee not to exceed X%", "admin fee cap". Return percentage number only (e.g. 15 for "15%"). Null if not found.
- gross_up_pct: Look for "gross up", "grossed up to X% occupancy", "occupancy factor". Return percentage (e.g. 95 for "95% occupancy"). Null if not found.
- expense_stop: Look for "expense stop", "base year stop", "base operating expenses of $X per square foot". Return dollar amount per sqft if found, else null.
- audit_rights: Return true if tenant has explicit right to audit CAM records. Return false if explicitly waived. Return null if not addressed.
- pro_rata_method: Return "rentable", "leasable", "occupied", or "gross" based on how the lease defines the pro-rata denominator. Return null if unresolvable.
- renewal_options: Short description including count, term length, and rate basis (max 120 chars). Null if no renewal options stated.
- excluded_categories: Comma-separated list of expense categories explicitly excluded from CAM (e.g. "capital expenditures, management fees, structural repairs"). Return null if no exclusion schedule is stated.
- suite: The tenant's unit or suite identifier. Look for "Suite", "Unit", "Space", "Ste.", "#" labels. Return the short designator (e.g. "101", "Suite A", "200"). Null if not identified.
- base_rent: Annual base rent in dollars as a plain number. If the lease states a monthly amount, multiply by 12. Look for "Base Rent", "Annual Rent", "Minimum Rent", "Fixed Rent", "Monthly Rent". Null if not found.
- security_deposit: Security deposit in dollars as a plain number. Look for "Security Deposit", "Deposit", "Holdback". Null if not found.
- quotes: For each field where you return a non-null value, copy ≤120 chars of the exact verbatim clause text from the lease that led to that value. Return null for any field where the value is null.
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

// ─── Acquisition Review State ─────────────────────────────────────────────────
// Fully isolated — never touches _props, tenantData, invoiceData, or activePropId.
let _acqReviews    = [];
let _activeAcqId   = null;
let _acqTenants    = [];
let _acqInvoices   = [];
let _acqSqFt       = 0;
let _acqActiveTab  = 'risk';                          // 'risk' | 'rentroll'
let _acqRentRollSort = { col: 'tenant_name', dir: 'asc' };
let _leaseAlertsDismissed   = false;       // session-only; resets on reload
let _actionCenterDismissed = false;       // session-only; resets on reload

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
      headers: { 'Content-Type': 'application/json', ...(await _authHeaders()) },
      body: JSON.stringify({ fileName: file.name, fileType: file.type, fileBase64 }),
    });
    const result = await resp.json();
    if (resp.status === 429) {
      const err = new Error('Upload rate limit reached — wait a moment and try again');
      err.isRateLimit = true;
      throw err;
    }
    if (!resp.ok || result.error) throw new Error(result.error || `HTTP ${resp.status}`);
    return result.url;
  };

  for (let i = 0; i < 3; i++) {
    try {
      const url = await attempt();
      return { url, error: null };
    } catch (e) {
      if (e.isRateLimit) {
        // Rate-limit window is 60s — short retries won't recover; surface immediately
        console.warn('[uploadInvoiceFile] rate limited:', e.message);
        return { url: null, error: 'rate-limited' };
      }
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
    suite:               d.suite ?? d.unit ?? d.unitNumber ?? '',
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
    review:              d.review              ?? {},
    capBaseAmount:       d.capBaseAmount       ?? null,
    fieldEvidence:       d.fieldEvidence       ?? {},
    admin_fee_pct:       d.admin_fee_pct       ?? null,
    gross_up_pct:        d.gross_up_pct        ?? null,
    expense_stop:        d.expense_stop        ?? null,
    audit_rights:        d.audit_rights        ?? null,
    pro_rata_method:     d.pro_rata_method     ?? null,
    renewal_options:     d.renewal_options     ?? null,
    base_rent:           d.base_rent           ?? null,
    security_deposit:    d.security_deposit    ?? null,
    amendments:          Array.isArray(d.amendments) ? d.amendments : [],
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

  // WHY 50: Ask-the-Lease needs full lease text for QA. Substantive clauses (CAM,
  // exclusions, renewals) typically appear on pages 10–40. 5 pages only covered
  // the cover sheet and recitals, making QA useless for standard commercial leases.
  // Field extraction (callClaudeForLease) uses prepareLeaseTextForClaude which
  // caps its own input window — extra stored pages don't affect extraction cost.
  const MAX_PAGES = 50;
  if (pdf.numPages > MAX_PAGES) {
    console.warn(`[extractPdfText] PDF has ${pdf.numPages} pages — reading only first ${MAX_PAGES}. Exhibits beyond page 50 will not be stored.`);
  }

  const pages = [];
  for (let p = 1; p <= Math.min(pdf.numPages, MAX_PAGES); p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const pageText = content.items.map(item => item.str).join(' ');
    // WHY marker: ask-lease citations need page numbers. Claude reads these markers
    // and reports them as citation.page. Format must match the system prompt in ask-lease.js.
    pages.push(`--- Page ${p} ---\n${pageText}`);
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
    headers: { 'Content-Type': 'application/json', ...(await _authHeaders()) },
    body: JSON.stringify({ messages, max_tokens: 1500, system: CLAUDE_LEASE_SYSTEM }),
  });

  if (!res.ok) throw new Error(`Claude PDF direct failed: HTTP ${res.status}`);
  const data = await res.json();
  // Mark telemetry: PDF direct path uses Claude's native document understanding
  if (window.ms_extractionDebug) window.ms_extractionDebug.OCRUsed = true;
  console.log('[EXTRACTION] PDF direct (vision) path used');
  return data;
}

// Extracts substantive lease text from a scanned PDF so Ask-the-Lease works
// on vision-path documents. Runs concurrently with callClaudeWithPdfDirect but
// uses a different prompt (text transcription, not structured JSON). The result
// is stored in extracted_text of the lease_documents row.
//
// Uses /api/explain (not /api/claude) because explain returns raw content[0].text
// — no JSON extraction step that would mangle plain-text lease content.
// Timeout is 85s to accommodate max_tokens=8096 output (~25-30s generation time).
async function extractTextFromPdfDirect(file) {
  const base64 = await fileToBase64(file);

  const prompt = `Return the substantive text from this commercial lease document for use in question-answering.

Include the complete text of all provisions relating to:
- Parties (tenant name, landlord name, guarantors)
- Premises (address, suite, square footage)
- Lease term (commencement, expiration, any options)
- Rent schedule (base rent, percentage rent, escalations)
- CAM charges, operating expenses, and maintenance obligations
- Expense exclusions and limitations (caps, expense stops, base years)
- Administrative fees and gross-up provisions
- Audit rights
- Renewal and extension options
- Assignment and subletting
- Default and remedies

Also include the complete text of any exhibits, addenda, or schedules that contain financial terms or definitions.

Preserve all section numbers, headings, and exact figures (percentages, dollar amounts, dates).
Omit: page headers, page footers, page numbers, signature blocks, notary certifications, and table of contents lines.

Return plain text only. No JSON, no markdown, no commentary.`;

  const messages = [{
    role: 'user',
    content: [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
      { type: 'text', text: prompt },
    ],
  }];

  // 85s timeout — generating 8096 output tokens takes ~25-30s; allow headroom
  const res = await _fetchWithTimeout('/api/explain', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', ...(await _authHeaders()) },
    body:    JSON.stringify({ messages, max_tokens: 8096, model: 'claude-sonnet-4-6' }),
  }, 85000);

  if (!res.ok) throw new Error(`PDF text extraction failed: HTTP ${res.status}`);
  const data = await res.json();
  const text = data?.content?.[0]?.text;
  if (!text) throw new Error('No text returned from PDF text extraction');
  console.log('[extractTextFromPdfDirect] extracted', text.length, 'chars from', file.name);
  return text;
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

// Shims — delegate to ReviewEngine (review-engine.js)
function getWarnings(flags)       { return ReviewEngine.getWarnings(flags); }
function computeFlags(d)          { return ReviewEngine.computeFlags(d); }
function computeFlagsStrict(d)    { return ReviewEngine.computeFlagsStrict(d); }

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
  "cam_cap": number or null,
  "admin_fee_pct": number or null,
  "gross_up_pct": number or null,
  "expense_stop": number or null,
  "audit_rights": true | false | null,
  "pro_rata_method": "rentable" | "leasable" | "occupied" | "gross" | null,
  "renewal_options": string or null,
  "excluded_categories": string or null,
  "quotes": { "cam_cap": string|null, "admin_fee_pct": string|null, "gross_up_pct": string|null, "expense_stop": string|null, "audit_rights": string|null, "pro_rata_method": string|null, "renewal_options": string|null }
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

QUOTES: For each non-null extracted value, copy ≤120 chars of the exact verbatim clause text that led to that value.

IMPORTANT: Best guess always. Do not leave tenant_name null if any company name exists.

LEASE TEXT:
"""
${leaseSnippet}
"""
`;
  const messages = [{ role: 'user', content: prompt }];

  console.log('[EXTRACTION] starting lease extraction (text path)');
  const _extractStart = Date.now();

  const res = await _fetchWithTimeout('/api/claude', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await _authHeaders()) },
    body: JSON.stringify({ messages, max_tokens: 1500, system: CLAUDE_LEASE_SYSTEM }),
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
  const _meta = (raw.__meta && typeof raw.__meta === 'object') ? raw.__meta : {};
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
    admin_fee_pct:       raw.admin_fee_pct  != null ? parseFloat(raw.admin_fee_pct)  || null : null,
    gross_up_pct:        raw.gross_up_pct   != null ? parseFloat(raw.gross_up_pct)   || null : null,
    expense_stop:        raw.expense_stop   != null ? parseFloat(raw.expense_stop)   || null : null,
    audit_rights:        raw.audit_rights   != null ? Boolean(raw.audit_rights)              : null,
    pro_rata_method:     raw.pro_rata_method ?? null,
    renewal_options:     raw.renewal_options ?? null,
  });

  // Inject quote-bearing evidence snapshots for fields where Claude returned verbatim clause text.
  // Map: Claude quote key → normalized field key (cam_cap is stored as 'cap' in tenant objects).
  const _quoteMap = {
    cam_cap:        'cap',
    admin_fee_pct:  'admin_fee_pct',
    gross_up_pct:   'gross_up_pct',
    expense_stop:   'expense_stop',
    audit_rights:   'audit_rights',
    pro_rata_method:'pro_rata_method',
    renewal_options:'renewal_options',
  };
  const _rawQuotes = (raw.quotes && typeof raw.quotes === 'object') ? raw.quotes : {};
  const _qTs = new Date().toISOString();
  const _extractionModel = _meta.model || null;
  let _fev = normalized.fieldEvidence || {};
  let _clauseMatchCount = 0;
  for (const [quoteKey, fieldKey] of Object.entries(_quoteMap)) {
    const qt = typeof _rawQuotes[quoteKey] === 'string' ? _rawQuotes[quoteKey].trim().slice(0, 200) : null;
    if (!qt) continue;
    _clauseMatchCount++;
    console.log(`[CLAUSE MATCH] ${fieldKey}: "${qt.slice(0, 60)}${qt.length > 60 ? '…' : ''}"`);
    const prev = (_fev[fieldKey] || { snapshots: [] }).snapshots;
    _fev = {
      ..._fev,
      [fieldKey]: { snapshots: [...prev, {
        fieldKey,
        value:                  normalized[fieldKey] ?? null,
        confidence:             { status: 'estimated', note: 'AI-extracted' },
        sourceFile:             normalized.fileName || null,
        page:                   null,
        section:                null,
        quote:                  qt,
        extractionId:           normalized._jobId || null,
        extractionVersion:      'v1',
        extractionModel:        _extractionModel,
        extractedAt:            _qTs,
        superseded:             false,
        amendmentId:            null,
        reviewerUid:            null,
        reviewerEmail:          null,
        reviewedAt:             _qTs,
        approved:               false,
        manuallyEdited:         false,
        originalExtractedValue: null,
      }]},
    };
  }
  normalized.fieldEvidence = _fev;

  // Populate extraction telemetry for debugging / diagnostics panel
  const _extractMs = Date.now() - _extractStart;
  window.ms_extractionDebug = {
    model:               _extractionModel,
    inputTokens:         _meta.inputTokens  ?? null,
    outputTokens:        _meta.outputTokens ?? null,
    extractionDurationMs: _extractMs,
    OCRUsed:             false,
    OCRConfidence:       null,
    clauseMatches:       _clauseMatchCount,
    fallbackUsed:        normalized._usedFallback || false,
    extractionVersion:   'v1',
    lastExtractedAt:     _qTs,
  };
  console.log('[EXTRACTION] complete', {
    model: _extractionModel, ms: _extractMs,
    clauseMatches: _clauseMatchCount, tokens: _meta.outputTokens,
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
    let _visionTextPromise = null;
    const _usedPdfDirect = !(leaseText && leaseText.length >= 50);
    if (!_usedPdfDirect) {
      extracted = await callClaudeForLease(leaseText);
    } else {
      // Start text extraction concurrently with field extraction — both need the
      // same file but neither depends on the other's result.
      _visionTextPromise = extractTextFromPdfDirect(file).catch(e => {
        console.warn('[extractTextFromPdfDirect:single] failed:', e?.message);
        return null;
      });
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

    // Phase 22A/22C: persist lease document record.
    // For vision-path leases, await the text extraction promise started earlier.
    // UI is already updated (renderTenantFields ran above) so this wait is invisible.
    const _extractedText = _usedPdfDirect
      ? (await _visionTextPromise)
      : leaseText;
    saveLeaseDocument({
      propertyId:      property.id,
      tenantId:        normalized.id || null,
      tenantName:      normalized.tenant_name || null,
      fileName:        file.name,
      fileUrl:         leaseUrl,
      extractedText:   _extractedText,
      parsingStatus:   'success',
      extractionModel: 'claude-3-5-sonnet-20241022',
      usedPdfDirect:   _usedPdfDirect,
    }).catch(e => console.warn('[saveLeaseDocument:single] failed:', e?.message));
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
  document.getElementById('lTabCenter').classList.toggle('active', tab === 'center');
  document.getElementById('leasePanelBulk').style.display   = tab === 'bulk'   ? 'block' : 'none';
  document.getElementById('leasePanelSingle').style.display = tab === 'single' ? 'block' : 'none';
  document.getElementById('leasePanelCenter').style.display = tab === 'center' ? 'block' : 'none';
  if (tab === 'center') {
    const prop = currentProperty();
    if (prop?.id) renderLeaseCenter(prop.id);
  }
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
    let leaseText          = null;
    let extracted          = null;
    let usedPdfDirect      = false;
    let leaseUrl           = null;
    let _visionTextPromise = null; // set when PDF-direct path is taken

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
        // Start text extraction concurrently — runs in the background while field
        // extraction completes. Neither call depends on the other's result.
        _visionTextPromise = extractTextFromPdfDirect(file).catch(e => {
          console.warn('[extractTextFromPdfDirect:bulk] failed:', e?.message);
          return null;
        });
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

    // Phase 15: edge case detection + explainability
    if (norm && window.LeaseIntelligence) {
      const _liCtx = { ocrChars: _meta.ocrChars, usedPdfDirect, ocrText: (!usedPdfDirect && leaseText) ? leaseText.slice(0, 500) : null };
      norm._edgeCases    = window.LeaseIntelligence.detectLeaseEdgeCases(norm, _liCtx);
      norm._explainability = window.LeaseIntelligence.generateLeaseExplainability(norm);
      norm._modelRouting = window.LeaseIntelligence.modelRoutingRecommendation(norm);
      if (norm._edgeCases.edgeCases.length > 0) {
        _meta.edgeCasesDetected = norm._edgeCases.edgeCases.map(e => e.type);
        _conf.score = Math.max(0, _conf.score + norm._edgeCases.totalConfidenceAdjustment);
        _meta.confidenceScore = _conf.score;
        console.log('[LEASE INTELLIGENCE] edge cases:', norm._edgeCases.edgeCases.map(e => e.type + ':' + e.severity).join(', '), '| model routing:', norm._modelRouting.tier, '→', norm._modelRouting.model);
      }
    }

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

    // Phase 22A/22C: persist lease document record.
    // For vision-path leases, await the text extraction promise started earlier.
    // finalizeLeaseJob / failLeaseJob have already updated the UI — this wait is invisible.
    (async () => {
      const _extractedText = usedPdfDirect
        ? (await _visionTextPromise)
        : (leaseText && !leaseText.startsWith('[Claude') ? leaseText : null);
      saveLeaseDocument({
        propertyId:      propertyId,
        tenantId:        norm?.id || null,
        tenantName:      finalEntry.tenant_name || null,
        fileName:        file.name,
        fileUrl:         leaseUrl,
        extractedText:   _extractedText,
        parsingStatus:   status,
        extractionModel: 'claude-3-5-sonnet-20241022',
        usedPdfDirect:   usedPdfDirect,
      }).catch(e => console.warn('[saveLeaseDocument:bulk] failed:', e?.message));
    })();

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
    appendPropertyTimelineEvent(property, { type: 'lease_uploaded', severity: 'info',
      actor: 'User', title: `${total} lease${total !== 1 ? 's' : ''} uploaded`,
      description: `${successCount} of ${total} extracted successfully`,
      metadata: { total, successCount } });
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
  // Delegates to the canonical engine — eliminates independent field-check reimplementation.
  // Returns canonical vocabulary; _reviewStatusPillHtml() maps both hyphenated and underscore forms.
  return deriveTenantReviewState(t).status;
}

function getLeaseReviewNotes(t) {
  if (!t) return ['No lease data available'];
  return deriveTenantReviewState(t).warnings.map(function(w) {
    switch (w.type) {
      case 'missing_sqft':        return 'Square footage not found — verify against lease';
      case 'missing_start_date':  return 'Lease start date missing';
      case 'missing_end_date':    return 'Lease end date missing';
      case 'missing_lease_type':  return 'Lease type could not be determined';
      case 'nnn_cap_missing':     return 'NNN cap percentage not specified';
      case 'fallback_extraction': return 'Lease dates extracted from document text — confirm accuracy';
      case 'low_sqft_confidence': return 'Sqft confidence low — verify against lease';
      case 'pro_rata_overflow':   return 'Pro-rata exceeds 100% — verify square footage';
      default:                    return w.label;
    }
  });
}

function _reviewStatusPillHtml(status) {
  const cfg = {
    'ready':             { cls: 'lrs-ready',        label: '✓ Ready' },
    'verified':          { cls: 'lrs-ready',        label: '✓ Ready' },
    'manually_verified': { cls: 'lrs-ready',        label: '✓ Ready' },
    'needs-review':      { cls: 'lrs-needs-review', label: '⚠ Needs Review' },
    'needs_review':      { cls: 'lrs-needs-review', label: '⚠ Needs Review' },
    'incomplete':        { cls: 'lrs-incomplete',   label: '✕ Incomplete' },
  }[status] || { cls: 'lrs-needs-review', label: '? Unknown' };
  return `<span class="lrs-pill ${cfg.cls}">${cfg.label}</span>`;
}

// ── Tenant-level Review State + Scoring ──────────────────────────────────────
// deriveTenantReviewState is the single source of truth.
// getTenantReviewState / getTenantReviewScore are thin wrappers for call-site compat.

// ── Review engine shims ───────────────────────────────────────────────────────
// Business logic lives in review-engine.js (pure, no global deps).
// These shims maintain backward-compatible global function names and supply
// the live lastResults context for the active-property view.
const _RQ_MISSING_FIELD_TYPES = ReviewEngine.MISSING_FIELD_TYPES;
function deriveTenantReviewState(t) {
  const rv = ReviewEngine.deriveTenantReviewState(t, lastResults);
  // Add missing[] — structural-blocking warnings separated from quality signals.
  // Consumers that only care about which required fields are absent use rv.missing;
  // those that want all quality signals use rv.warnings.
  rv.missing = rv.warnings
    .filter(function(w) { return _RQ_MISSING_FIELD_TYPES.has(w.type); })
    .map(function(w) { return w.label; });
  return rv;
}
function getTenantReviewState(t)    { return ReviewEngine.getTenantReviewState(t, lastResults); }
function getTenantReviewScore(t)    { return ReviewEngine.getTenantReviewScore(t, lastResults); }
// Debug helper: window.ms_debug_review(tenantObject) in the browser console
window.ms_debug_review = function(tenant) { console.table(deriveTenantReviewState(tenant)); };

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
  // Manual override takes precedence — field was corrected by a reviewer.
  const _latestSnap = getLatestFieldEvidence(fieldName, t);
  if (_latestSnap?.manuallyEdited === true) {
    return { status: 'manual', source: 'manual', note: 'Manually corrected' };
  }
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

// ── Lease Field Evidence Panel ────────────────────────────────────────────────

window.__msEvidencePanel = { tenantId: null, fieldKey: null, el: null };

const _LEV_FIELD_LABELS = {
  tenant_name:     'Tenant Name',
  leased_sqft:     'Leased Sq Ft',
  lease_type:      'Lease Type',
  start_date:      'Lease Start',
  end_date:        'Lease End',
  cap:             'CAM Cap',
  proRata:         'Pro-Rata %',
  admin_fee_pct:   'Admin Fee %',
  gross_up_pct:    'Gross-Up %',
  expense_stop:    'Expense Stop',
  audit_rights:    'Audit Rights',
  pro_rata_method: 'Pro-Rata Method',
  renewal_options: 'Renewal Options',
};

// Builds a structured evidence object for a single field.
// Prefers t.fieldEvidence[key] (future pipeline), falls back to _leaseDebug then metadata.
function getFieldEvidence(fieldKey, t) {
  if (!t) return null;
  const value = getEffectiveLeaseField(fieldKey, t) ?? t[fieldKey] ?? null;
  const conf  = getFieldConfidence(fieldKey, t);

  // Prefer persisted snapshot (survives refresh/re-login); fall back to session debug log.
  const latest = getLatestFieldEvidence(fieldKey, t);
  const dbg    = t._jobId ? _leaseDebug.get(t._jobId) : null;
  const snippet = dbg?.ocrText ? dbg.ocrText.slice(0, 400) : null;

  if (latest) {
    // Prefer the snapshot's stored confidence when available; manual edits always show 'Manually corrected'.
    const displayConf = latest.manuallyEdited === true
      ? { status: 'manual', note: 'Manually corrected' }
      : (latest.confidence?.status ? latest.confidence : conf);
    return normalizeLeaseEvidence({ value, confidence: displayConf, source: {
      fileName:          latest.sourceFile       ?? t.fileName ?? null,
      page:              latest.page             ?? null,
      section:           latest.section          ?? null,
      snippet,           // always from session — not stored in snapshots (keeps blob small)
      quote:             latest.quote            ?? null,
      extractionId:      latest.extractionId     ?? t._jobId ?? null,
      extractionVersion: latest.extractionVersion ?? null,
      extractionModel:   latest.extractionModel  ?? null,
      extractedAt:       latest.extractedAt      ?? null,
      superseded:        latest.superseded        ?? false,
      amendmentId:       latest.amendmentId       ?? null,
      reviewerEmail:     latest.reviewerEmail    ?? null,
      reviewerUid:       latest.reviewerUid      ?? null,
      reviewedAt:        latest.reviewedAt        ?? null,
      approved:          latest.approved          ?? null,
      manuallyEdited:    latest.manuallyEdited    ?? null,
    }});
  }

  // No persisted snapshot — build from session metadata only.
  return normalizeLeaseEvidence({ value, confidence: conf, source: {
    fileName:    t.fileName ?? null,
    page:        null,
    snippet,
    quote:       null,
    extractionId: t._jobId ?? null,
  }});
}

// Safe normalization — always returns a complete shape or null.
// source.extractionVersion / reviewerEmail / reviewerUid / reviewedAt /
// approved / manuallyEdited are optional audit fields populated only when
// a persisted evidence snapshot is present.
function normalizeLeaseEvidence(raw) {
  if (!raw) return null;
  const src = raw.source || {};
  return {
    value:      raw.value ?? null,
    confidence: raw.confidence || { status: 'missing', note: '' },
    source: {
      fileName:         (typeof src.fileName    === 'string' && src.fileName.trim())   ? src.fileName.trim()  : null,
      page:             (typeof src.page        === 'number' && src.page > 0)          ? src.page             : null,
      section:          (typeof src.section     === 'string' && src.section.trim())    ? src.section.trim()   : null,
      snippet:          (typeof src.snippet     === 'string' && src.snippet.trim())    ? src.snippet.trim()   : null,
      quote:            (typeof src.quote       === 'string' && src.quote.trim())      ? src.quote.trim()     : null,
      extractionId:     (typeof src.extractionId === 'string' && src.extractionId)    ? src.extractionId     : null,
      extractionVersion:(typeof src.extractionVersion === 'string')                   ? src.extractionVersion: null,
      extractionModel:  (typeof src.extractionModel === 'string' && src.extractionModel) ? src.extractionModel : null,
      extractedAt:      (typeof src.extractedAt  === 'string' && src.extractedAt)     ? src.extractedAt      : null,
      superseded:        src.superseded  != null ? Boolean(src.superseded)  : false,
      amendmentId:      (typeof src.amendmentId  === 'string' && src.amendmentId)     ? src.amendmentId      : null,
      reviewerEmail:    (typeof src.reviewerEmail === 'string' && src.reviewerEmail)   ? src.reviewerEmail    : null,
      reviewerUid:      (typeof src.reviewerUid   === 'string' && src.reviewerUid)     ? src.reviewerUid      : null,
      reviewedAt:       (typeof src.reviewedAt    === 'string' && src.reviewedAt)      ? src.reviewedAt       : null,
      approved:          src.approved       != null ? Boolean(src.approved)       : null,
      manuallyEdited:    src.manuallyEdited != null ? Boolean(src.manuallyEdited) : null,
    },
  };
}

function renderLeaseEvidencePanel(fieldKey, t) {
  const ev       = getFieldEvidence(fieldKey, t);
  const label    = _LEV_FIELD_LABELS[fieldKey] || fieldKey;
  const conf     = ev?.confidence || { status: 'missing', note: 'No extraction data' };
  const src      = ev?.source || {};
  const confIcon = conf.status === 'verified' ? '✓' : conf.status === 'estimated' ? '⚠' : '—';
  const confCls  = 'lfc-' + conf.status;

  const valHtml = ev?.value != null
    ? `<div class="lev-value">${esc(String(ev.value))}</div>`
    : `<div class="lev-value lev-value--missing">Not found in extraction</div>`;

  // Amendment / lineage status
  const hasAmendments   = Array.isArray(t.amendments) && t.amendments.length > 0;
  const isAmendmentSrc  = !!(src.amendmentId);
  const isOriginalLease = hasAmendments && !isAmendmentSrc;

  const srcRows = [];
  if (src.fileName) srcRows.push(
    `<div class="lev-src-row"><span class="lev-src-lbl">Source</span><span class="lev-src-val">${esc(src.fileName)}</span></div>`);
  if (src.page) srcRows.push(
    `<div class="lev-src-row"><span class="lev-src-lbl">Page</span><span class="lev-src-val">${src.page}</span></div>`);
  if (src.section) srcRows.push(
    `<div class="lev-src-row"><span class="lev-src-lbl">Section</span><span class="lev-src-val">${esc(src.section)}</span></div>`);
  if (src.extractionVersion) srcRows.push(
    `<div class="lev-src-row"><span class="lev-src-lbl">Extraction</span><span class="lev-src-val">${esc(src.extractionVersion)}</span></div>`);
  if (src.extractionModel) srcRows.push(
    `<div class="lev-src-row"><span class="lev-src-lbl">Model</span><span class="lev-src-val lev-model-tag">${esc(src.extractionModel)}</span></div>`);
  if (src.extractedAt) srcRows.push(
    `<div class="lev-src-row"><span class="lev-src-lbl">Extracted</span><span class="lev-src-val">${esc(src.extractedAt.slice(0, 10))}</span></div>`);
  if (src.extractionId) srcRows.push(
    `<div class="lev-src-row"><span class="lev-src-lbl">Job ID</span><span class="lev-src-val lev-jobid">${esc(src.extractionId.slice(0, 8))}…</span></div>`);
  // Reviewer attribution — only shown when a persisted snapshot is present
  if (src.reviewerEmail && src.reviewedAt) srcRows.push(
    `<div class="lev-src-row"><span class="lev-src-lbl">Reviewed</span><span class="lev-src-val">${esc(src.reviewerEmail)} · ${esc(src.reviewedAt.slice(0, 10))}</span></div>`);
  if (src.manuallyEdited) srcRows.push(
    `<div class="lev-src-row"><span class="lev-src-lbl">Edit</span><span class="lev-src-val lev-manual-tag">Manually corrected</span></div>`);
  if (src.superseded) srcRows.push(
    `<div class="lev-src-row"><span class="lev-src-lbl">Status</span><span class="lev-src-val lev-superseded-tag">Superseded</span></div>`);
  if (isAmendmentSrc) srcRows.push(
    `<div class="lev-src-row"><span class="lev-src-lbl">Lineage</span><span class="lev-src-val lev-amd-tag">Modified by Amendment</span></div>`);
  if (isOriginalLease) srcRows.push(
    `<div class="lev-src-row"><span class="lev-src-lbl">Lineage</span><span class="lev-src-val lev-orig-tag">Original Lease</span></div>`);

  const quoteHtml = src.quote
    ? `<div class="lev-excerpt-lbl">Extracted quote</div><blockquote class="lev-quote">${esc(src.quote)}</blockquote>`
    : '';
  const snippetHtml = src.snippet
    ? `<div class="lev-excerpt-lbl">Document excerpt</div><div class="lev-snippet">${esc(src.snippet.slice(0, 320))}${src.snippet.length > 320 ? '…' : ''}</div>`
    : '';
  const hasSourceData = !!(src.fileName || src.extractionId);
  const noDataMsg = (!src.snippet && !src.quote)
    ? hasSourceData
      ? `<div class="lev-no-data">Source snippet unavailable.</div>`
      : `<div class="lev-no-data">Source snippet unavailable. Upload a lease PDF to see extraction evidence.</div>`
    : '';

  return `<div class="lev-header"><span class="lev-field-label">${esc(label)}</span>` +
    `<button class="lev-close" onclick="closeLeaseEvidencePanel()" title="Close">&#x2715;</button></div>` +
    `<div class="lev-body"><div class="lev-section-lbl">Extracted value</div>` +
    valHtml +
    `<div class="lev-conf ${confCls}">${confIcon} ${esc(conf.note || conf.status)}</div>` +
    (srcRows.length ? `<div class="lev-src-block">${srcRows.join('')}</div>` : '') +
    quoteHtml + snippetHtml + noDataMsg + `</div>`;
}

function openLeaseEvidencePanel(tenantId, fieldKey) {
  const t = tenantData.find(function(x) { return x && x.id === tenantId; });
  if (!t) return;
  const st = window.__msEvidencePanel;
  // Toggle: clicking the same field again closes the panel
  if (st.el && st.el.style.display !== 'none' && st.tenantId === tenantId && st.fieldKey === fieldKey) {
    closeLeaseEvidencePanel();
    return;
  }
  st.tenantId = tenantId;
  st.fieldKey = fieldKey;
  let panel = st.el;
  if (!panel) {
    panel = document.createElement('div');
    panel.id = '_msEvidencePanel';
    panel.style.cssText =
      'position:fixed;bottom:68px;right:20px;z-index:99997;width:300px;max-height:420px;overflow-y:auto;' +
      'background:#1e293b;border:1px solid rgba(99,102,241,0.35);border-radius:10px;' +
      'box-shadow:0 8px 32px rgba(0,0,0,0.55);font-family:inherit;';
    document.body.appendChild(panel);
    st.el = panel;
  }
  panel.innerHTML = renderLeaseEvidencePanel(fieldKey, t);
  panel.style.display = 'block';
}

function closeLeaseEvidencePanel() {
  const st = window.__msEvidencePanel;
  if (st.el) st.el.style.display = 'none';
  st.tenantId = null;
  st.fieldKey  = null;
}

// Debug helper: window.ms_debug_evidence('leased_sqft', tenantData[0])
window.ms_debug_evidence = function(fieldKey, tenant) {
  const t = tenant || (tenantData && tenantData.find(Boolean));
  if (!t) { console.warn('[EvidencePanel] No tenant data available'); return; }
  const ev = getFieldEvidence(fieldKey || 'leased_sqft', t);
  console.table(ev?.source || {});
  console.log('[EvidencePanel] value:', ev?.value, '| conf:', ev?.confidence?.status, '—', ev?.confidence?.note);
  return ev;
};

// ── Persisted Field Evidence + Reviewer Audit Trail ───────────────────────────
//
// Evidence snapshots are stored in t.fieldEvidence[fieldKey].snapshots[].
// Each snapshot is immutable once appended — history is never mutated.
// The array is persisted inside properties.data.tenants via savePropertyData()
// (no schema changes needed; fieldEvidence is already passed through _stripBlobs
// and normalizeTenant).

// Returns the extraction version tag for a tenant.
// 'v1' on first pass, 'v1-retry' if prior evidence snapshots already exist,
// 'manual' is passed explicitly from confirmFieldOverride paths.
function _extractionVersionTag(t) {
  if (!t) return 'v1';
  const fev = t.fieldEvidence || {};
  const hasHistory = Object.values(fev).some(function(f) {
    return f && Array.isArray(f.snapshots) && f.snapshots.length > 0;
  });
  return hasHistory ? 'v1-retry' : 'v1';
}

// Builds one immutable evidence snapshot object.
// Snippet is intentionally NOT stored — it is re-read from _leaseDebug at
// display time so the Supabase row stays small.
function _mkEvidenceSnapshot(fieldKey, t, opts) {
  const conf = getFieldConfidence(fieldKey, t);
  const user = window.AuthService?.getCurrentUser?.() || null;
  return {
    fieldKey,
    value:                  opts.value !== undefined ? opts.value : (getEffectiveLeaseField(fieldKey, t) ?? t[fieldKey] ?? null),
    confidence:             { status: conf.status, note: conf.note },
    sourceFile:             t.fileName  || null,
    page:                   opts.page   ?? null,
    section:                opts.section ?? null,
    quote:                  opts.quote  != null ? String(opts.quote).slice(0, 200) : null,
    extractionId:           t._jobId    || null,
    extractionVersion:      opts.extractionVersion || _extractionVersionTag(t),
    extractionModel:        opts.extractionModel ?? null,
    extractedAt:            opts.extractedAt     ?? null,
    superseded:             opts.superseded      ?? false,
    amendmentId:            opts.amendmentId     ?? null,
    reviewerUid:            user?.id    || null,
    reviewerEmail:          user?.email || null,
    reviewedAt:             new Date().toISOString(),
    approved:               opts.approved       ?? false,
    manuallyEdited:         opts.manuallyEdited ?? false,
    originalExtractedValue: opts.originalExtractedValue ?? null,
  };
}

// Appends one immutable evidence snapshot to t.fieldEvidence[fieldKey].snapshots.
// Never mutates historical entries. Persists via savePropertyData() (debounced).
// Safe: silently no-ops if tenant is not found.
function persistFieldEvidence(tenantId, fieldKey, opts) {
  const idx = tenantData.findIndex(function(t) { return t && t.id === tenantId; });
  if (idx === -1) return;
  const t = tenantData[idx];

  const snapshot = _mkEvidenceSnapshot(fieldKey, t, opts || {});
  const fev      = t.fieldEvidence || {};
  const prev     = fev[fieldKey]   || { snapshots: [] };

  // Guard: cap at 50 snapshots per field to bound storage growth
  const prevSnaps = Array.isArray(prev.snapshots) ? prev.snapshots : [];
  const nextSnaps = prevSnaps.length < 50
    ? prevSnaps.concat([snapshot])
    : prevSnaps.slice(1).concat([snapshot]); // drop oldest when cap reached

  tenantData[idx] = {
    ...t,
    fieldEvidence: { ...fev, [fieldKey]: { snapshots: nextSnaps } },
  };

  savePropertyData(); // debounced — collapses rapid successive calls

  // Dual-write to normalized table — non-blocking, fail-silent
  const prop = currentProperty();
  if (prop?.id) {
    _writeTenantFieldEvidence(prop.id, tenantId, fieldKey, snapshot);
  }
}

// Returns the most recent evidence snapshot for a field, or null if none.
function getLatestFieldEvidence(fieldKey, t) {
  if (!t) return null;
  const snaps = t.fieldEvidence?.[fieldKey]?.snapshots;
  if (!snaps || !snaps.length) return null;
  return snaps[snaps.length - 1];
}

// Returns all evidence snapshots for a field (oldest first), or [].
function getEvidenceHistory(fieldKey, t) {
  if (!t) return [];
  const snaps = t.fieldEvidence?.[fieldKey]?.snapshots;
  return Array.isArray(snaps) ? snaps : [];
}

// Field evidence auto-loads with the tenant object via loadPropertyData().
// This function is a named accessor for external callers and documentation.
function loadFieldEvidence(tenantId) {
  const t = tenantData.find(function(x) { return x && x.id === tenantId; });
  return t?.fieldEvidence || {};
}

// Structured audit trail entry — stored in activityLog via logActivity().
// tenantId and fieldKey are stored in the detail JSON for structured querying.
// Also dual-writes to tenant_review_audit (Phase 1 normalized table).
function appendReviewAuditEntry(entry) {
  if (!entry || !entry.tenantId) return;
  const user = window.AuthService?.getCurrentUser?.() || null;
  const _araProp = currentProperty();
  console.log('[appendReviewAuditEntry] action:', entry.action, '| tenantId:', entry.tenantId,
    '| propId:', _araProp?.id || 'NULL — dual-write will be skipped',
    '| activePropId:', activePropId || 'null');
  if (!_araProp?.id) {
    console.warn('[appendReviewAuditEntry] currentProperty() is null — normalized audit row will NOT be written. activePropId=' + activePropId);
    if (window.ms_lastDisputeFlow) {
      window.ms_lastDisputeFlow.auditPropNull = true;
      window.ms_lastDisputeFlow.errors.push({ ts: new Date().toISOString(), where: 'appendReviewAuditEntry', reason: 'currentProperty null', activePropId });
      _updateDisputeBadge();
    }
  }
  // Single timestamp shared between the JSON detail and the normalized DB row
  // so both records are unambiguously correlated and the dedup constraint fires.
  const ts = new Date().toISOString();
  const detail = JSON.stringify({
    tenantId:          entry.tenantId,
    fieldKey:          entry.fieldKey          || null,
    action:            entry.action            || 'review',
    oldValue:          entry.oldValue          ?? null,
    newValue:          entry.newValue          ?? null,
    reviewStateBefore: entry.reviewStateBefore || null,
    reviewStateAfter:  entry.reviewStateAfter  || null,
    reviewerUid:       user?.id                || entry.reviewerUid  || null,
    reviewerEmail:     user?.email             || entry.reviewerEmail || null,
    ts,
  });
  logActivity('field_review_audit', entry.label || 'Review action', {
    severity:      entry.severity    || 'info',
    actor:         user?.email       || entry.reviewerEmail || 'Reviewer',
    relatedEntity: entry.tenantName  || entry.tenantId,
    tenantId:      entry.tenantId,
    detail,
  });
  // Dual-write to normalized table — non-blocking, fail-silent (JSON blob is fallback)
  const prop = currentProperty();
  if (prop?.id) {
    _writeTenantReviewAudit(prop.id, entry.tenantId, {
      fieldKey:          entry.fieldKey          || null,
      action:            entry.action            || 'review',
      label:             entry.label             || null,
      severity:          entry.severity          || 'info',
      oldValue:          entry.oldValue          ?? null,
      newValue:          entry.newValue          ?? null,
      reviewStateBefore: entry.reviewStateBefore || null,
      reviewStateAfter:  entry.reviewStateAfter  || null,
      reviewerUid:       user?.id                || entry.reviewerUid   || null,
      reviewerEmail:     user?.email             || entry.reviewerEmail || null,
      clientTs:          ts,
    });
  }
}

// ── Normalized Evidence / Audit Tables — Phase 20 read migration ─────────────
//
// Architecture: tenant_field_evidence and tenant_review_audit are now authoritative
//               for reads. The JSON blob (properties.data.tenants[].fieldEvidence)
//               is no longer written on save and will drain naturally as properties
//               are re-saved under Phase 20.
//
// Writes continue to go to both systems (dual-write) for rollback safety.

window.ms_useNormalizedEvidence = true;
window.ms_useNormalizedAudit    = true;

// ── Dual-write runtime state — populated by every write attempt ───────────────
// Set window.ms_debugDualWriteUI = true before a write to show the floating pill.
// Call ms_dumpDualWrite() or ms_debug_dualwrite() to inspect from mobile.
window.ms_lastDualWrite = window.ms_lastDualWrite || {
  evidence: null,  // last _writeTenantFieldEvidence result
  audit:    null,  // last _writeTenantReviewAudit result
  auth:     null,  // { uid, email } or { uid: null } — last observed session
  property: null,  // { id, name } or { id: null }
  errors:   [],    // all failures appended here (capped at 50)
};
window.ms_syncState = window.ms_syncState || {
  status:         'idle',  // mirrors _syncStatus: idle|pending|local|synced|error
  lastSavedAt:    null,    // ISO timestamp when localStorage write last completed
  lastCloudSyncAt: null,   // ISO timestamp when Supabase write last confirmed
  lastError:      null,    // { ts, message } from last app-level save failure
};
window.ms_extractionDebug = window.ms_extractionDebug || {
  model:               null,   // Claude model used for last extraction
  inputTokens:         null,   // prompt token count from Anthropic response
  outputTokens:        null,   // completion token count from Anthropic response
  extractionDurationMs: null,  // wall-clock time for last extraction call
  OCRUsed:             false,  // true when PDF direct (vision) path was used
  OCRConfidence:       null,   // future: OCR quality score
  clauseMatches:       0,      // count of non-null quotes returned by Claude
  fallbackUsed:        false,  // true when regex date fallback was applied
  extractionVersion:   'v1',   // prompt schema version
  lastExtractedAt:     null,   // ISO timestamp of last completed extraction
};
window.ms_metricsDebug = window.ms_metricsDebug || {
  propertyId:  null,   // property id for which metrics were last derived
  metrics:     null,   // full derivePropertyMetrics() output
  computedAt:  null,   // ISO timestamp of last computation
};
window.ms_timelineDebug = window.ms_timelineDebug || {
  propertyId:  null,
  lastEvent:   null,
  totalEvents: 0,
  updatedAt:   null,
};

// Serializes any field value to a string for DB column storage.
function _evidenceValStr(v) {
  if (v === null || v === undefined) return null;
  return typeof v === 'string' ? v : String(v);
}

// Classifies a Supabase write result into a readable status string.
// 'ok'       — row inserted/returned
// 'no-op'    — ON CONFLICT DO NOTHING fired OR RLS WITH CHECK blocked silently
// 'rls'      — explicit RLS/permission error (code 42501 / PGRST301 / 403)
// 'error'    — any other Supabase/network error
// 'skipped'  — call short-circuited before reaching Supabase
function _dwStatus(data, error) {
  if (error) {
    const c = String(error.code || '');
    const m = String(error.message || '').toLowerCase();
    if (c === '42501' || c === 'PGRST301' || m.includes('permission') || m.includes('rls') || m.includes('policy') || error.status === 403) return 'rls';
    return 'error';
  }
  if (!data || data.length === 0) return 'no-op';
  return 'ok';
}

// Converts a tenant_field_evidence DB row to the in-memory snapshot shape.
function _evidenceRowToSnapshot(row) {
  return {
    value:                  row.value,
    confidence:             { status: row.confidence_status, note: row.confidence_note },
    sourceFile:             row.source_file,
    page:                   row.source_page,
    extractionId:           row.extraction_id,
    extractionVersion:      row.extraction_version,
    reviewerUid:            row.reviewer_uid,
    reviewerEmail:          row.reviewer_email,
    reviewedAt:             row.reviewed_at,
    approved:               row.approved,
    manuallyEdited:         row.manually_edited,
    originalExtractedValue: row.original_extracted_value,
  };
}

// Converts a tenant_review_audit DB row to the in-memory activityLog entry shape.
function _auditRowToActivityEntry(row) {
  return {
    type:      'field_review_audit',
    tenantId:  row.tenant_id,
    timestamp: row.client_ts,
    actor:     row.reviewer_email  ?? null,
    title:     row.label           ?? 'Field review',
    severity:  row.severity        || 'info',
    detail:    JSON.stringify({
      fieldKey:          row.field_key,
      action:            row.action,
      oldValue:          row.old_value,
      newValue:          row.new_value,
      reviewStateBefore: row.review_state_before,
      reviewStateAfter:  row.review_state_after,
      reviewerUid:       row.reviewer_uid,
      reviewerEmail:     row.reviewer_email,
      ts:                row.client_ts,
    }),
  };
}

// Writes one evidence snapshot to tenant_field_evidence.
// Uses ignoreDuplicates=true → INSERT ... ON CONFLICT DO NOTHING.
// Never throws — JSON blob remains the authoritative fallback.
async function _writeTenantFieldEvidence(propId, tenantId, fieldKey, snapshot) {
  if (!db || !propId || !tenantId || !fieldKey || !snapshot) {
    const detail = { db: !!db, propId, tenantId, fieldKey, hasSnapshot: !!snapshot };
    console.warn('[DualWrite:tfe] SKIPPED — missing args', detail);
    window.ms_lastDualWrite.evidence = { ts: new Date().toISOString(), status: 'skipped', detail };
    _updateDualWritePill();
    return;
  }
  const payload = {
    property_id:              propId,
    tenant_id:                tenantId,
    field_key:                fieldKey,
    value:                    _evidenceValStr(snapshot.value),
    confidence_status:        snapshot.confidence?.status              ?? null,
    confidence_note:          snapshot.confidence?.note                ?? null,
    source_file:              snapshot.sourceFile                      ?? null,
    source_page:              snapshot.page                            ?? null,
    extraction_id:            snapshot.extractionId                    ?? null,
    extraction_version:       snapshot.extractionVersion               ?? null,
    reviewer_uid:             snapshot.reviewerUid                     ?? null,
    reviewer_email:           snapshot.reviewerEmail                   ?? null,
    reviewed_at:              snapshot.reviewedAt                      ?? null,
    approved:                 snapshot.approved                        ?? false,
    manually_edited:          snapshot.manuallyEdited                  ?? false,
    original_extracted_value: _evidenceValStr(snapshot.originalExtractedValue),
  };
  const ts = new Date().toISOString();
  console.groupCollapsed('[DualWrite:tfe] INSERT tenant_field_evidence @ ' + ts);
  console.log('payload:', JSON.stringify(payload));
  try {
    const { data: sessionData } = await db.auth.getSession();
    const sess = sessionData?.session;
    const authState = sess ? { uid: sess.user.id, email: sess.user.email } : { uid: null };
    window.ms_lastDualWrite.auth = authState;
    window.ms_lastDualWrite.property = { id: propId };
    console.log('auth:', sess ? 'OK uid=' + sess.user.id : 'NO SESSION — RLS will block (auth.uid() = null)');
    if (!sess) console.error('[DualWrite:tfe] FAIL: no auth session → auth.uid() null → RLS WITH CHECK will reject');

    const { data, error } = await db
      .from('tenant_field_evidence')
      .upsert(payload, { onConflict: 'tenant_id,field_key,reviewed_at', ignoreDuplicates: true })
      .select('id');

    const status = _dwStatus(data, error);
    window.ms_lastDualWrite.evidence = { ts, status, propId, tenantId, fieldKey, rowCount: data?.length ?? 0, error: error || null };

    if (error) {
      console.error('[DualWrite:tfe] ERROR status=' + status, '| code:', error.code, '| msg:', error.message, '| details:', error.details, '| hint:', error.hint);
      if (window.ms_lastDualWrite.errors.length < 50)
        window.ms_lastDualWrite.errors.push({ ts, table: 'tenant_field_evidence', code: error.code, message: error.message, details: error.details, hint: error.hint });
    } else if (status === 'no-op') {
      console.warn('[DualWrite:tfe] no-op — 0 rows returned. Possible causes: (1) ON CONFLICT DO NOTHING fired (duplicate reviewed_at); (2) RLS WITH CHECK blocked silently; (3) PostgREST returned empty on success (add .select() fixes this — already added).');
    } else {
      console.log('[DualWrite:tfe] OK — inserted id:', data[0]?.id);
    }
  } catch (e) {
    console.error('[DualWrite:tfe] EXCEPTION:', e);
    window.ms_lastDualWrite.evidence = { ts, status: 'error', propId, tenantId, fieldKey, rowCount: 0, error: { message: e?.message } };
    if (window.ms_lastDualWrite.errors.length < 50)
      window.ms_lastDualWrite.errors.push({ ts, table: 'tenant_field_evidence', message: e?.message });
  } finally {
    _updateDualWritePill();
    console.groupEnd();
  }
}

// Writes one audit entry to tenant_review_audit.
// clientTs must be the timestamp generated by appendReviewAuditEntry() so that
// the dedup constraint (tenant_id, action, client_ts) fires correctly on retry.
async function _writeTenantReviewAudit(propId, tenantId, entry) {
  if (!db || !propId || !tenantId || !entry) {
    const detail = { db: !!db, propId, tenantId, hasEntry: !!entry };
    console.warn('[DualWrite:tra] SKIPPED — missing args', detail);
    window.ms_lastDualWrite.audit = { ts: new Date().toISOString(), status: 'skipped', detail };
    _updateDualWritePill();
    return;
  }
  const payload = {
    property_id:         propId,
    tenant_id:           tenantId,
    field_key:           entry.fieldKey          ?? null,
    action:              entry.action            || 'review',
    label:               entry.label             ?? null,
    severity:            entry.severity          || 'info',
    old_value:           _evidenceValStr(entry.oldValue),
    new_value:           _evidenceValStr(entry.newValue),
    review_state_before: entry.reviewStateBefore ?? null,
    review_state_after:  entry.reviewStateAfter  ?? null,
    reviewer_uid:        entry.reviewerUid       ?? null,
    reviewer_email:      entry.reviewerEmail     ?? null,
    client_ts:           entry.clientTs          || new Date().toISOString(),
  };
  const ts = new Date().toISOString();
  console.groupCollapsed('[DualWrite:tra] INSERT tenant_review_audit @ ' + ts);
  console.log('payload:', JSON.stringify(payload));
  try {
    const { data: sessionData } = await db.auth.getSession();
    const sess = sessionData?.session;
    const authState = sess ? { uid: sess.user.id, email: sess.user.email } : { uid: null };
    window.ms_lastDualWrite.auth = authState;
    window.ms_lastDualWrite.property = { id: propId };
    console.log('auth:', sess ? 'OK uid=' + sess.user.id : 'NO SESSION — RLS will block (auth.uid() = null)');
    if (!sess) console.error('[DualWrite:tra] FAIL: no auth session → auth.uid() null → RLS WITH CHECK will reject');

    const { data, error } = await db
      .from('tenant_review_audit')
      .upsert(payload, { onConflict: 'tenant_id,action,client_ts', ignoreDuplicates: true })
      .select('id');

    const status = _dwStatus(data, error);
    window.ms_lastDualWrite.audit = { ts, status, propId, tenantId, action: entry.action, rowCount: data?.length ?? 0, error: error || null };

    if (error) {
      console.error('[DualWrite:tra] ERROR status=' + status, '| code:', error.code, '| msg:', error.message, '| details:', error.details, '| hint:', error.hint);
      if (window.ms_lastDualWrite.errors.length < 50)
        window.ms_lastDualWrite.errors.push({ ts, table: 'tenant_review_audit', code: error.code, message: error.message, details: error.details, hint: error.hint });
    } else if (status === 'no-op') {
      console.warn('[DualWrite:tra] no-op — 0 rows returned. Possible causes: (1) ON CONFLICT DO NOTHING fired (duplicate client_ts+action); (2) RLS WITH CHECK blocked silently.');
    } else {
      console.log('[DualWrite:tra] OK — inserted id:', data[0]?.id);
    }
  } catch (e) {
    console.error('[DualWrite:tra] EXCEPTION:', e);
    window.ms_lastDualWrite.audit = { ts, status: 'error', propId, tenantId, action: entry.action, rowCount: 0, error: { message: e?.message } };
    if (window.ms_lastDualWrite.errors.length < 50)
      window.ms_lastDualWrite.errors.push({ ts, table: 'tenant_review_audit', message: e?.message });
  } finally {
    _updateDualWritePill();
    console.groupEnd();
  }
}

// Returns all evidence snapshots for a (tenant, fieldKey) from the normalized
// table. Used when ms_useNormalizedEvidence is true (Phase 2+).
async function getTenantFieldEvidence(tenantId, fieldKey) {
  if (!db || !tenantId) return [];
  try {
    let q = db.from('tenant_field_evidence')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: true });
    if (fieldKey) q = q.eq('field_key', fieldKey);
    const { data, error } = await q;
    if (error) { console.warn('[NormalizedEvidence] read failed:', error.message); return []; }
    return data || [];
  } catch (e) {
    console.warn('[NormalizedEvidence] read error:', e?.message);
    return [];
  }
}

// Returns the full audit trail for a tenant from the normalized table.
// Used when ms_useNormalizedAudit is true (Phase 2+).
async function getTenantReviewAudit(tenantId) {
  if (!db || !tenantId) return [];
  try {
    const { data, error } = await db
      .from('tenant_review_audit')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('client_ts', { ascending: true });
    if (error) { console.warn('[NormalizedAudit] read failed:', error.message); return []; }
    return data || [];
  } catch (e) {
    console.warn('[NormalizedAudit] read error:', e?.message);
    return [];
  }
}

// Backfill: reads t.fieldEvidence from all loaded tenants and writes every
// snapshot to tenant_field_evidence. Safe to re-run — dedup constraint
// silently ignores already-present rows.
// Console usage: await ms_backfillEvidence()
async function backfillEvidenceFromProperties() {
  const prop = currentProperty();
  if (!prop?.id) { console.warn('[Backfill] No active property loaded'); return; }
  const tenants = tenantData.filter(Boolean);
  let written = 0, skipped = 0;
  for (const t of tenants) {
    if (!t.id || !t.fieldEvidence) { skipped++; continue; }
    for (const [fk, fev] of Object.entries(t.fieldEvidence)) {
      const snaps = Array.isArray(fev?.snapshots) ? fev.snapshots : [];
      for (const snap of snaps) {
        await _writeTenantFieldEvidence(prop.id, t.id, fk, snap);
        written++;
      }
    }
  }
  console.log(`[Backfill] Evidence — wrote ${written} snapshots, skipped ${skipped} tenants (no fieldEvidence)`);
  return { written, skipped };
}

// Backfill: scans activityLog for field_review_audit entries and writes each
// to tenant_review_audit. Safe to re-run.
// Console usage: await ms_backfillAudit()
async function backfillAuditFromProperties() {
  const prop = currentProperty();
  if (!prop?.id) { console.warn('[Backfill] No active property loaded'); return; }
  const auditEntries = activityLog.filter(function(e) {
    return e.type === 'field_review_audit' && e.tenantId;
  });
  let written = 0, malformed = 0;
  for (const entry of auditEntries) {
    let parsed = {};
    try { parsed = JSON.parse(entry.detail || '{}'); } catch (_) {}
    await _writeTenantReviewAudit(prop.id, entry.tenantId, {
      fieldKey:          parsed.fieldKey          ?? null,
      action:            parsed.action            || entry.type || 'review',
      label:             entry.title              || null,
      severity:          entry.severity           || 'info',
      oldValue:          parsed.oldValue          ?? null,
      newValue:          parsed.newValue          ?? null,
      reviewStateBefore: parsed.reviewStateBefore ?? null,
      reviewStateAfter:  parsed.reviewStateAfter  ?? null,
      reviewerUid:       parsed.reviewerUid       ?? null,
      reviewerEmail:     parsed.reviewerEmail     || entry.actor || null,
      clientTs:          parsed.ts                || entry.timestamp || new Date().toISOString(),
    });
    written++;
  }
  console.log(`[Backfill] Audit — wrote ${written} entries, ${malformed} malformed skipped`);
  return { written, malformed };
}

// Rollback: re-hydrates tenant.fieldEvidence in the JSON blob from the normalized
// tenant_field_evidence table. Required when rolling back ms_useNormalizedEvidence
// after the blob has been stripped of fieldEvidence by Phase 20 saves.
//
// Full rollback procedure:
//   1. Set window.ms_useNormalizedEvidence = false  (stops stripping fieldEvidence on save)
//   2. await ms_rollbackEvidenceToBlobForProp()     (re-hydrates in-memory tenants + saves blob)
//   3. Deploy flag change to false in script.js for all future sessions
//
// Safe to re-run — overwrites in-memory fieldEvidence and re-saves; does not touch
// tenant_field_evidence rows (normalized table is untouched).
// Console usage: await ms_rollbackEvidenceToBlobForProp()
async function rollbackEvidenceToBlobForProp() {
  const prop = currentProperty();
  if (!prop?.id) { console.warn('[Rollback] No active property loaded'); return; }
  if (window.ms_useNormalizedEvidence) {
    console.warn('[Rollback] ms_useNormalizedEvidence is still true — set it to false first, then re-run');
    return;
  }
  if (!db) { console.warn('[Rollback] No db connection'); return; }
  try {
    const { data: rows, error } = await db
      .from('tenant_field_evidence')
      .select('*')
      .eq('property_id', prop.id)
      .order('created_at', { ascending: true });
    if (error) {
      console.error('[Rollback] Failed to fetch tenant_field_evidence:', error.message);
      return;
    }
    if (!rows?.length) {
      console.warn('[Rollback] No rows in tenant_field_evidence for this property — nothing to restore');
      return { restored: 0, rows: 0 };
    }
    // Reconstruct fieldEvidence keyed by tenant then field
    const evByTenant = {};
    for (const row of rows) {
      if (!evByTenant[row.tenant_id]) evByTenant[row.tenant_id] = {};
      const fk = row.field_key;
      if (!evByTenant[row.tenant_id][fk]) evByTenant[row.tenant_id][fk] = { snapshots: [] };
      evByTenant[row.tenant_id][fk].snapshots.push(_evidenceRowToSnapshot(row));
    }
    // Overlay onto live in-memory tenantData
    let restored = 0;
    tenantData.forEach(t => {
      if (t?.id && evByTenant[t.id]) {
        t.fieldEvidence = evByTenant[t.id];
        restored++;
      }
    });
    console.log(`[Rollback] Restored fieldEvidence for ${restored} tenant(s) from ${rows.length} row(s)`);
    // Persist to blob — ms_useNormalizedEvidence=false so savePropertyData won't strip it
    await savePropertyData();
    console.log('[Rollback] Blob save complete — fieldEvidence is back in properties.data');
    return { restored, rows: rows.length };
  } catch (e) {
    console.error('[Rollback] Exception:', e?.message);
  }
}

// Console helpers — available immediately after page load
window.ms_backfillEvidence              = backfillEvidenceFromProperties;
window.ms_backfillAudit                 = backfillAuditFromProperties;
window.ms_rollbackEvidenceToBlobForProp = rollbackEvidenceToBlobForProp;

// ── ms_dumpDualWrite — mobile-safe compact summary ───────────────────────────
// Returns a plain JSON string — paste it anywhere without needing DevTools.
// Also logs it. Tap the floating pill (when ms_debugDualWriteUI=true) to copy.
window.ms_dumpDualWrite = function() {
  const dw = window.ms_lastDualWrite;
  function errCompact(e) {
    if (!e) return null;
    return { code: e.code, message: e.message, details: e.details, hint: e.hint };
  }
  const summary = {
    dumpTs:   new Date().toISOString(),
    auth:     dw.auth,
    property: dw.property,
    evidence: dw.evidence ? {
      ts:       dw.evidence.ts,
      status:   dw.evidence.status,
      rowCount: dw.evidence.rowCount,
      propId:   dw.evidence.propId,
      tenantId: dw.evidence.tenantId,
      fieldKey: dw.evidence.fieldKey,
      error:    errCompact(dw.evidence.error),
    } : null,
    audit: dw.audit ? {
      ts:       dw.audit.ts,
      status:   dw.audit.status,
      rowCount: dw.audit.rowCount,
      propId:   dw.audit.propId,
      tenantId: dw.audit.tenantId,
      action:   dw.audit.action,
      error:    errCompact(dw.audit.error),
    } : null,
    errorCount: dw.errors.length,
    lastErrors: dw.errors.slice(-3),
  };
  const s = JSON.stringify(summary, null, 2);
  console.log('[ms_dumpDualWrite]', s);
  return s;
};

// ── _pillFallbackCopy — textarea execCommand for mobile Safari ────────────────
function _pillFallbackCopy(text) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:-999px;left:-999px;opacity:0;font-size:16px;';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    return true;
  } catch (_) { return false; }
}

// ── _updateDualWritePill — floating status pill (ms_debugDualWriteUI = true) ──
// Shows AUTH / PROP / TFE / TRA status. Tap to copy ms_dumpDualWrite() output.
// Pill is created on first call when flag is true; updates on every write.
function _updateDualWritePill() {
  if (!window.ms_debugDualWriteUI) return;

  let pill = document.getElementById('_ms_dw_pill');
  if (!pill) {
    pill = document.createElement('div');
    pill.id = '_ms_dw_pill';
    pill.title = 'Tap to copy diagnostic JSON';
    pill.style.cssText = [
      'position:fixed', 'bottom:16px', 'right:12px', 'z-index:99999',
      'background:rgba(15,23,42,0.96)', 'border:1px solid rgba(255,255,255,0.18)',
      'border-radius:10px', 'padding:8px 12px', 'font-family:monospace',
      'font-size:12px', 'line-height:1.7', 'cursor:pointer',
      'min-width:148px', 'box-shadow:0 4px 16px rgba(0,0,0,0.5)',
      '-webkit-tap-highlight-color:transparent', 'user-select:none',
    ].join(';');
    pill.onclick = function() {
      const s = window.ms_dumpDualWrite();
      const flash = function(ok) {
        pill.style.borderColor = ok ? '#4ade80' : '#f87171';
        setTimeout(function() { pill.style.borderColor = 'rgba(255,255,255,0.18)'; }, 900);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(s).then(function() { flash(true); }).catch(function() { flash(_pillFallbackCopy(s)); });
      } else {
        flash(_pillFallbackCopy(s));
      }
    };
    document.body.appendChild(pill);
  }

  const dw = window.ms_lastDualWrite;
  function _ind(label, state) {
    // state: 'ok' | 'no-op' | 'rls' | 'error' | 'skipped' | null
    const ok    = '#4ade80';  // green
    const warn  = '#fbbf24';  // amber
    const fail  = '#f87171';  // red
    const muted = '#475569';  // gray
    let color, sym;
    if (!state)              { color = muted; sym = '·'; }
    else if (state === 'ok') { color = ok;    sym = '✓'; }
    else if (state === 'no-op') { color = warn; sym = '?'; }
    else                     { color = fail;  sym = '✗'; }
    return '<span style="color:' + muted + '">' + label + '</span><span style="color:' + color + '">' + sym + '</span>';
  }

  const authState  = dw.auth  ? (dw.auth.uid  ? 'ok' : 'error') : null;
  const propState  = dw.property ? (dw.property.id ? 'ok' : 'error') : null;
  const tfeState   = dw.evidence ? dw.evidence.status : null;
  const traState   = dw.audit    ? dw.audit.status    : null;
  const errCount   = dw.errors.length;

  pill.innerHTML =
    '<div style="color:#64748b;font-size:10px;letter-spacing:.04em;margin-bottom:2px">DUALWRITE' +
    (errCount ? ' <span style="color:#f87171">(' + errCount + ' err)</span>' : '') + '</div>' +
    _ind('AUTH ', authState) + '&nbsp;&nbsp;' + _ind('PROP ', propState) + '<br>' +
    _ind('TFE  ', tfeState)  + '&nbsp;&nbsp;' + _ind('TRA  ', traState)  +
    '<div style="color:#334155;font-size:9px;margin-top:2px">tap to copy JSON</div>';
}

// ── DB Health modal — Phase 20 UI diagnostic ─────────────────────────────────
// Opens from the "DB Health" button in the header. Calls ms_debug_dualwrite()
// to fire real test inserts, then renders row counts / IDs / errors in-page.

function openDbHealthModal() {
  const modal = document.getElementById('dbHealthModal');
  if (modal) modal.classList.add('open');
}
window.openDbHealthModal = openDbHealthModal;

function closeDbHealthModal() {
  const modal = document.getElementById('dbHealthModal');
  if (modal) modal.classList.remove('open');
}
window.closeDbHealthModal = closeDbHealthModal;

function _dbhEsc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function _dbhStatusCell(status) {
  if (!status) return '<span class="dbh-val dbh-muted">—</span>';
  if (status === 'ok')     return '<span class="dbh-val dbh-ok">&#x2713; ok</span>';
  if (status === 'no-op')  return '<span class="dbh-val dbh-warn">&#x3f; no-op (ON CONFLICT or silent RLS block)</span>';
  if (status === 'skipped') return '<span class="dbh-val dbh-muted">skipped (no property loaded)</span>';
  return '<span class="dbh-val dbh-err">&#x2717; ' + _dbhEsc(status) + '</span>';
}

function _dbhRenderGrid(id, rows) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = rows.map(function(r) {
    return '<span class="dbh-label">' + _dbhEsc(r[0]) + '</span>' + r[1];
  }).join('');
}

function _dbhRenderRowTable(containerId, rows, cols) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (!rows || !rows.length) { el.innerHTML = ''; return; }
  var th = cols.map(function(c) { return '<th>' + _dbhEsc(c) + '</th>'; }).join('');
  var tds = rows.map(function(row) {
    return '<tr>' + cols.map(function(c) {
      return '<td title="' + _dbhEsc(row[c]) + '">' + _dbhEsc(row[c]) + '</td>';
    }).join('') + '</tr>';
  }).join('');
  el.innerHTML = '<table class="dbh-rows-table"><thead><tr>' + th + '</tr></thead><tbody>' + tds + '</tbody></table>';
}

async function runDbHealthDiag() {
  const btn    = document.getElementById('dbhRunBtn');
  const status = document.getElementById('dbhStatusBar');

  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="dbh-spinner"></span>Running…'; }
  if (status) status.textContent = 'Running ms_debug_dualwrite()…';

  var result;
  try {
    result = await window.ms_debug_dualwrite();
  } catch (e) {
    if (status) status.textContent = 'Error: ' + e.message;
    if (btn)    { btn.disabled = false; btn.innerHTML = 'Run Diagnostic — write &amp; read test rows'; }
    return;
  }

  // ── Auth section ──
  const auth = result?.auth || window.ms_lastDualWrite?.auth || {};
  _dbhRenderGrid('dbhAuthGrid', [
    ['Status', auth.ok
      ? '<span class="dbh-val dbh-ok">&#x2713; signed in</span>'
      : '<span class="dbh-val dbh-err">&#x2717; not signed in — RLS will block all writes</span>'],
    ['Email',  '<span class="dbh-val">' + _dbhEsc(auth.email || '—') + '</span>'],
    ['UID',    '<span class="dbh-val">' + _dbhEsc(auth.uid   || '—') + '</span>'],
  ]);

  // ── Property section ──
  var dw   = window.ms_lastDualWrite;
  var prop = dw?.property || {};
  _dbhRenderGrid('dbhPropGrid', [
    ['Property', prop.id
      ? '<span class="dbh-val dbh-ok">&#x2713; ' + _dbhEsc(prop.name || prop.id) + '</span>'
      : '<span class="dbh-val dbh-warn">No active property — open a property first</span>'],
    ['ID', '<span class="dbh-val">' + _dbhEsc(prop.id || '—') + '</span>'],
  ]);

  // ── TFE section ──
  var evStatus = result?.evStatus || dw?.evidence?.status;
  var evRows   = result?.evRows   || [];
  _dbhRenderGrid('dbhTfeGrid', [
    ['Last write', _dbhStatusCell(evStatus)],
    ['Rows read back', '<span class="dbh-val' + (evRows.length > 0 ? ' dbh-ok' : ' dbh-warn') + '">' +
      evRows.length + ' row' + (evRows.length !== 1 ? 's' : '') +
      (evRows.length === 0 ? ' (RLS SELECT may be blocking or no rows written yet)' : '') + '</span>'],
    ['Last field written', '<span class="dbh-val">' + _dbhEsc(dw?.evidence?.fieldKey || '—') + '</span>'],
    ['Last row count', '<span class="dbh-val">' + _dbhEsc(dw?.evidence?.rowCount ?? '—') + '</span>'],
  ]);
  _dbhRenderRowTable('dbhTfeRows', evRows, ['id','tenant_id','field_key','reviewed_at','value']);

  // ── TRA section ──
  var audStatus = result?.audStatus || dw?.audit?.status;
  var audRows   = result?.audRows   || [];
  _dbhRenderGrid('dbhTraGrid', [
    ['Last write', _dbhStatusCell(audStatus)],
    ['Rows read back', '<span class="dbh-val' + (audRows.length > 0 ? ' dbh-ok' : ' dbh-warn') + '">' +
      audRows.length + ' row' + (audRows.length !== 1 ? 's' : '') +
      (audRows.length === 0 ? ' (RLS SELECT may be blocking or no rows written yet)' : '') + '</span>'],
    ['Last action written', '<span class="dbh-val">' + _dbhEsc(dw?.audit?.action || '—') + '</span>'],
    ['Last row count', '<span class="dbh-val">' + _dbhEsc(dw?.audit?.rowCount ?? '—') + '</span>'],
  ]);
  _dbhRenderRowTable('dbhTraRows', audRows, ['id','tenant_id','action','client_ts','severity']);

  // ── CAM reconciliations section (Phase 21) ──
  var cam = await window.ms_debug_cam_persistence(prop.id).catch(function(e) {
    return { skipped: false, error: e?.message || String(e) };
  });
  var _camErrLabel = '';
  if (!cam.skipped && !cam.writeOk) {
    var _parts = [cam.error || 'failed'];
    if (cam.keySource) _parts.push('key=' + cam.keySource);
    if (cam.errorCode) _parts.push('code=' + cam.errorCode);
    if (cam.errorDetail) {
      var _det = cam.errorDetail;
      var _detStr = typeof _det === 'string' ? _det : JSON.stringify(_det);
      _parts.push(_detStr);
    }
    _camErrLabel = _parts.join(' | ');
  }
  var camWriteCell = cam.skipped
    ? '<span class="dbh-val dbh-muted">skipped (' + _dbhEsc(cam.skipReason || 'no property') + ')</span>'
    : (cam.writeOk
        ? '<span class="dbh-val dbh-ok">&#x2713; ok</span>'
        : '<span class="dbh-val dbh-err" style="word-break:break-all;font-size:0.78rem">&#x2717; ' + _dbhEsc(_camErrLabel) + '</span>');
  var camReadCell = cam.skipped
    ? '<span class="dbh-val dbh-muted">—</span>'
    : (cam.readBackOk
        ? '<span class="dbh-val dbh-ok">&#x2713; test row read back</span>'
        : '<span class="dbh-val dbh-err">&#x2717; test row not returned</span>');
  var histRows = cam.historyRows || [];
  var years    = cam.years || [];
  _dbhRenderGrid('dbhCamGrid', [
    ['Write test', camWriteCell],
    ['Read-back test', camReadCell],
    ['History rows', '<span class="dbh-val' + (histRows.length > 0 ? ' dbh-ok' : '') + '">' +
      histRows.length + ' row' + (histRows.length !== 1 ? 's' : '') + '</span>'],
    ['Years on record', '<span class="dbh-val">' + (years.length ? _dbhEsc(years.join(', ')) : '—') + '</span>'],
  ]);
  _dbhRenderRowTable('dbhCamRows', histRows.slice(0, 8), ['year','tenant_name','actual_cam','expected_cam','variance']);

  // ── Errors section ──
  var errors = dw?.errors || [];
  if (cam.error && !cam.skipped) errors = errors.concat([{ table: 'cam_reconciliations', message: cam.error }]);
  var errSec  = document.getElementById('dbhErrorsSection');
  var errList = document.getElementById('dbhErrorsList');
  if (errors.length > 0) {
    if (errSec)  errSec.style.display  = '';
    if (errList) errList.textContent = JSON.stringify(errors.slice(-5), null, 2);
  } else {
    if (errSec) errSec.style.display = 'none';
  }

  // ── Status bar ──
  var camOk = cam.skipped || (cam.writeOk && cam.readBackOk);
  var allOk = evStatus === 'ok' && audStatus === 'ok' && errors.length === 0 && auth.ok && camOk;
  var statusMsg = allOk
    ? '✓ All checks passed — Phase 20 + Phase 21 DB writes and reads confirmed.'
    : (errors.length ? errors.length + ' error(s) recorded — see RLS / Permission Errors below.' :
       (!auth.ok ? 'Not signed in — sign in first, then re-run.' :
        (!prop.id ? 'No property loaded — open a property first.' :
         (!camOk ? 'CAM reconciliation persistence check failed — see cam_reconciliations section.' :
          'Diagnostic complete — review sections above for details.'))));
  if (status) {
    status.innerHTML = (allOk
      ? '<span class="dbh-ok">' + _dbhEsc(statusMsg) + '</span>'
      : '<span class="dbh-warn">' + _dbhEsc(statusMsg) + '</span>');
  }

  if (btn) { btn.disabled = false; btn.innerHTML = '&#x21BB; Re-run Diagnostic'; }
}
window.runDbHealthDiag = runDbHealthDiag;

// ── ms_debug_cam_persistence — Phase 21 CAM reconciliation write/read test ────
// Writes a sentinel test row (year 1900, tenant '__debug_test__') through the
// production /api/cam-reconciliations path, reads it back, queries full history,
// then cleans up the sentinel rows. Non-destructive to real reconciliation data.
// Usage: await ms_debug_cam_persistence(propertyId)
window.ms_debug_cam_persistence = async function(propertyId) {
  const SENTINEL_YEAR = 1900;
  if (!propertyId) return { skipped: true, skipReason: 'no active property' };

  console.group('[ms_debug_cam_persistence] CAM reconciliation persistence test');
  const out = { skipped: false, writeOk: false, readBackOk: false, historyRows: [], years: [], error: null };

  try {
    // 1. Write a sentinel row through the real save path.
    // tenant_id is null — the column is uuid type; a sentinel string would fail type validation.
    // year=1900 is unique enough to identify this test row on read-back.
    const testResults = [{
      tenantId: null, tenantName: '__debug_test__',
      totalAllocated: 1, allocatedAmount: 1, actualCam: 1, expectedCam: 1,
      variance: 0, proRataPercent: 0,
    }];
    const writeRes = await saveCamResults(propertyId, testResults, SENTINEL_YEAR, 1);
    out.writeOk = !!writeRes?.ok;
    if (!writeRes?.ok) {
      out.error       = writeRes?.reason || 'write failed';
      out.errorDetail = writeRes?.detail ?? null;
      out.errorCode   = writeRes?.code   ?? null;
      out.keySource   = writeRes?.keySource ?? null;
    }
    console.log('write:', JSON.stringify(writeRes));

    // 2. Read the sentinel row back — any row at year=1900 for this property is the sentinel.
    const sentinelRows = await loadCamResults(propertyId, SENTINEL_YEAR);
    out.readBackOk = sentinelRows.length > 0;
    console.log('read-back sentinel rows:', sentinelRows.length, '| found test row:', out.readBackOk);

    // 3. Query full history (all years) — the real reconciliation record.
    const history = await loadCamHistory(propertyId);
    out.historyRows = history.filter(r => r.year !== SENTINEL_YEAR);
    out.years = [...new Set(out.historyRows.map(r => r.year))].sort((a, b) => b - a);
    console.log('history rows (excl. sentinel):', out.historyRows.length, '| years:', out.years);

    // 4. Clean up sentinel rows (POST empty rows for the sentinel year deletes them).
    await _authHeaders().then(ah => fetch('/api/cam-reconciliations', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...ah },
      body: JSON.stringify({ propertyId, year: SENTINEL_YEAR, rows: [] }),
    })).then(r => r.json()).then(() => console.log('cleanup: sentinel rows deleted'))
      .catch(e => console.warn('cleanup failed:', e?.message));
  } catch (e) {
    out.error = e?.message || String(e);
    console.error('exception:', out.error);
  }

  console.groupEnd();
  return out;
};

// ── ms_debug_dualwrite — comprehensive fire-and-test diagnostic ───────────────
// Usage (mobile console or desktop): await ms_debug_dualwrite()
// Checks auth, active property, fires test inserts, reads back rows.
// Returns plain object — also stored in ms_lastDualWrite after each write.
window.ms_debug_dualwrite = async function() {
  console.group('[ms_debug_dualwrite] Dual-write diagnostic');

  // 1. Auth
  const { data: sessionData, error: sessionErr } = await db.auth.getSession();
  const sess = sessionData?.session;
  if (sessionErr) console.error('getSession error:', sessionErr);
  const authSummary = sess
    ? { ok: true, uid: sess.user.id, email: sess.user.email, expires: new Date(sess.expires_at * 1000).toISOString() }
    : { ok: false, reason: 'no session — auth.uid() will be null inside RLS' };
  console.log('Auth:', JSON.stringify(authSummary));
  if (!sess) console.error('ALL INSERTS WILL BE BLOCKED — RLS requires authenticated session');

  window.ms_lastDualWrite.auth = sess ? { uid: sess.user.id, email: sess.user.email } : { uid: null };

  // 2. Property + tenants
  console.log('activePropId:', activePropId || '(none)');
  const prop = currentProperty();
  console.log('currentProperty:', prop ? JSON.stringify({ id: prop.id, name: prop.name }) : 'NULL — callers will skip dual-write');
  window.ms_lastDualWrite.property = prop ? { id: prop.id, name: prop.name } : { id: null };

  const validTenants = tenantData.filter(Boolean);
  console.log('tenants loaded:', validTenants.length, validTenants[0] ? '| first: ' + validTenants[0].id : '');

  if (!prop?.id) {
    console.warn('No active property — skipping insert tests. Open a property first.');
    _updateDualWritePill();
    console.groupEnd();
    return { auth: authSummary, propId: null };
  }

  const testTs       = new Date().toISOString();
  const testTenantId = validTenants[0]?.id || 'debug-tenant-' + Date.now();

  // 3. Test insert: tenant_field_evidence
  console.group('INSERT → tenant_field_evidence');
  const evPayload = {
    property_id:       prop.id,
    tenant_id:         testTenantId,
    field_key:         '__debug_test__',
    value:             'debug_value',
    confidence_status: 'verified',
    reviewed_at:       testTs,
    approved:          true,
    manually_edited:   false,
  };
  console.log('payload:', JSON.stringify(evPayload));
  const { data: evData, error: evErr } = await db
    .from('tenant_field_evidence')
    .upsert(evPayload, { onConflict: 'tenant_id,field_key,reviewed_at', ignoreDuplicates: true })
    .select('id,tenant_id,field_key,reviewed_at');
  const evStatus = _dwStatus(evData, evErr);
  console.log('status:', evStatus, '| rows:', evData?.length ?? 0);
  if (evErr)              console.error('ERROR code=' + evErr.code, evErr.message, evErr.details, evErr.hint);
  else if (!evData?.length) console.warn('no-op: 0 rows — ON CONFLICT DO NOTHING or silent RLS block');
  else                    console.log('OK — row id:', evData[0].id);
  window.ms_lastDualWrite.evidence = { ts: testTs, status: evStatus, propId: prop.id, tenantId: testTenantId, fieldKey: '__debug_test__', rowCount: evData?.length ?? 0, error: evErr || null };
  console.groupEnd();

  // 4. Test insert: tenant_review_audit
  console.group('INSERT → tenant_review_audit');
  const audPayload = {
    property_id: prop.id,
    tenant_id:   testTenantId,
    field_key:   '__debug_test__',
    action:      'debug_test',
    severity:    'info',
    client_ts:   testTs,
  };
  console.log('payload:', JSON.stringify(audPayload));
  const { data: audData, error: audErr } = await db
    .from('tenant_review_audit')
    .upsert(audPayload, { onConflict: 'tenant_id,action,client_ts', ignoreDuplicates: true })
    .select('id,tenant_id,action,client_ts');
  const audStatus = _dwStatus(audData, audErr);
  console.log('status:', audStatus, '| rows:', audData?.length ?? 0);
  if (audErr)              console.error('ERROR code=' + audErr.code, audErr.message, audErr.details, audErr.hint);
  else if (!audData?.length) console.warn('no-op: 0 rows — ON CONFLICT DO NOTHING or silent RLS block');
  else                     console.log('OK — row id:', audData[0].id);
  window.ms_lastDualWrite.audit = { ts: testTs, status: audStatus, propId: prop.id, tenantId: testTenantId, action: 'debug_test', rowCount: audData?.length ?? 0, error: audErr || null };
  console.groupEnd();

  // 5. Read-back (confirms RLS SELECT path too)
  console.group('Read-back (last 5 rows per table for this property)');
  const { data: evRows, error: evRErr } = await db.from('tenant_field_evidence')
    .select('id,tenant_id,field_key,reviewed_at,value').eq('property_id', prop.id)
    .order('created_at', { ascending: false }).limit(5);
  console.log('tenant_field_evidence:', JSON.stringify(evRows), evRErr ? 'READ ERR:' + evRErr.message : '');

  const { data: audRows, error: audRErr } = await db.from('tenant_review_audit')
    .select('id,tenant_id,action,client_ts,severity').eq('property_id', prop.id)
    .order('created_at', { ascending: false }).limit(5);
  console.log('tenant_review_audit:', JSON.stringify(audRows), audRErr ? 'READ ERR:' + audRErr.message : '');
  console.groupEnd();

  _updateDualWritePill();
  console.log('--- ms_dumpDualWrite() ---');
  console.log(window.ms_dumpDualWrite());
  console.groupEnd();
  return { auth: authSummary, propId: prop.id, evStatus, audStatus, evRows, audRows };
};

// ── Dispute-flow diagnostics ──────────────────────────────────────────────────
// Tracks the last dispute submission attempt end-to-end: auth → property
// context → save → audit write. Populated by instrumented disputeCharge(),
// submitDispute(), savePropertyData(), and appendReviewAuditEntry().
// Enable floating badge: window.ms_debugDisputeUI = true
window.ms_lastDisputeFlow = window.ms_lastDisputeFlow || {
  ts:             null,   // ISO timestamp of last attempt
  trigger:        null,   // 'disputeCharge' | 'submitDispute'
  auth:           null,   // { uid, email, role } or { uid: null }
  propId:         null,   // activePropId at time of call (null = save will fail)
  propFound:      null,   // whether currentProperty() returned non-null
  saveAttempted:  false,
  saveResult:     null,   // 'ok' | 'skipped-no-propid' | 'error'
  auditPropNull:  false,  // true when appendReviewAuditEntry had no property
  errors:         [],     // failure details (capped at 50)
};

// Creates/updates a floating badge showing AUTH / PROP / WRITE / READ status.
// Only renders when window.ms_debugDisputeUI = true.
function _updateDisputeBadge() {
  if (!window.ms_debugDisputeUI) return;

  let badge = document.getElementById('_ms_dispute_badge');
  if (!badge) {
    badge = document.createElement('div');
    badge.id = '_ms_dispute_badge';
    badge.title = 'Dispute flow diagnostics — tap to copy JSON';
    badge.style.cssText = [
      'position:fixed', 'bottom:80px', 'right:12px', 'z-index:99999',
      'background:rgba(15,23,42,0.96)', 'border:1px solid rgba(255,165,0,0.35)',
      'border-radius:10px', 'padding:8px 12px', 'font-family:monospace',
      'font-size:12px', 'line-height:1.7', 'cursor:pointer',
      'min-width:148px', 'box-shadow:0 4px 16px rgba(0,0,0,0.5)',
      '-webkit-tap-highlight-color:transparent', 'user-select:none',
    ].join(';');
    badge.onclick = function() {
      const s = JSON.stringify(window.ms_lastDisputeFlow, null, 2);
      console.log('[ms_lastDisputeFlow]', s);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(s).then(function() {
          badge.style.borderColor = '#4ade80';
          setTimeout(function() { badge.style.borderColor = 'rgba(255,165,0,0.35)'; }, 900);
        }).catch(function() { _pillFallbackCopy(s); });
      } else { _pillFallbackCopy(s); }
    };
    document.body.appendChild(badge);
  }

  const df = window.ms_lastDisputeFlow;
  const ok   = '#4ade80';
  const warn = '#fbbf24';
  const fail = '#f87171';
  const mute = '#475569';

  function _b(label, color, sym) {
    return '<span style="color:' + mute + '">' + label + '</span><span style="color:' + color + '">' + sym + '</span>';
  }

  const authOk    = df.auth && df.auth.uid;
  // PROP reads live activePropId directly — reflects hydration state immediately,
  // not just after a dispute attempt.
  const propLive  = !!activePropId;
  const writeOk   = df.saveResult === 'ok';
  const writeFail = df.saveResult && df.saveResult !== 'ok';
  const readOk    = !df.auditPropNull && df.ts;

  badge.innerHTML =
    '<div style="color:#92400e;font-size:10px;letter-spacing:.04em;margin-bottom:2px">DISPUTE FLOW' +
    (df.errors.length ? ' <span style="color:' + fail + '">(' + df.errors.length + 'err)</span>' : '') + '</div>' +
    _b('AUTH  ', authOk ? ok : (df.auth ? fail : mute), authOk ? '✓' : (df.auth ? '✗' : '·')) + '&nbsp;&nbsp;' +
    _b('PROP  ', propLive ? ok : fail, propLive ? '✓ ' + activePropId.slice(0,6) : '✗ null') + '<br>' +
    _b('WRITE ', writeOk ? ok : (writeFail ? fail : mute), writeOk ? '✓' : (writeFail ? '✗' : '·')) + '&nbsp;&nbsp;' +
    _b('AUDIT ', df.auditPropNull ? fail : (readOk ? ok : mute), df.auditPropNull ? '✗' : (readOk ? '✓' : '·')) +
    '<div style="color:#334155;font-size:9px;margin-top:2px">tap to copy JSON</div>';
}

// ── ms_testAuditInsert — fire a known row into tenant_review_audit + read it back
// Usage: await ms_testAuditInsert()
// Open a property first — uses currentProperty() or activePropId.
window.ms_testAuditInsert = async function() {
  console.group('[ms_testAuditInsert]');

  // Auth
  const { data: sessionData } = await db.auth.getSession();
  const sess = sessionData?.session;
  console.log('auth:', sess ? 'OK uid=' + sess.user.id : 'NO SESSION — RLS will block');

  // Property
  const prop = currentProperty();
  const propId = prop?.id || activePropId;
  console.log('propId:', propId || 'NULL — cannot insert without property_id');
  console.log('activePropId:', activePropId || 'null');
  console.log('currentProperty():', prop ? { id: prop.id, name: prop.name } : 'null');
  console.log('_props loaded:', _props.length, 'properties');

  if (!propId) {
    console.error('Cannot test — no property loaded. Open a property first, then re-run.');
    console.groupEnd();
    return { ok: false, reason: 'no property' };
  }

  // Insert
  const ts = new Date().toISOString();
  const testRow = {
    property_id: propId,
    tenant_id:   'diag-tenant-' + Date.now(),
    action:      'diag_test_insert',
    severity:    'info',
    label:       'Diagnostic test — safe to delete',
    client_ts:   ts,
  };
  console.log('inserting:', JSON.stringify(testRow));
  const { data: insData, error: insErr } = await db
    .from('tenant_review_audit')
    .upsert(testRow, { onConflict: 'tenant_id,action,client_ts', ignoreDuplicates: true })
    .select('id,property_id,tenant_id,action,client_ts');
  console.log('insert result — data:', insData, '| error:', insErr);
  if (insErr) {
    console.error('INSERT FAILED — code:', insErr.code, '| msg:', insErr.message, '| details:', insErr.details, '| hint:', insErr.hint);
    const rlsKeywords = ['permission', 'policy', 'rls', '42501', 'pgrst301', '403'];
    if (rlsKeywords.some(k => String(insErr.code + insErr.message).toLowerCase().includes(k))) {
      console.error('→ RLS likely cause. Check: does property_id', propId, 'have user_id =', sess?.user?.id, '?');
    }
  } else if (!insData?.length) {
    console.warn('INSERT returned 0 rows (ON CONFLICT DO NOTHING or silent RLS block). Row may not exist.');
    console.warn('→ If RLS is silent, auth.uid()=' + (sess?.user?.id || 'null') + ' may not match property.user_id');
  } else {
    console.log('INSERT OK — id:', insData[0].id);
  }

  // Read back — confirms SELECT RLS too
  console.log('reading back all tenant_review_audit rows for property...');
  const { data: rows, error: readErr } = await db
    .from('tenant_review_audit')
    .select('id,tenant_id,action,client_ts,severity')
    .eq('property_id', propId)
    .order('created_at', { ascending: false })
    .limit(10);
  console.log('read-back:', JSON.stringify(rows), readErr ? '| read error:' + readErr.message : '');

  // Also check properties table ownership
  console.log('verifying property ownership...');
  const { data: propRow, error: propErr } = await db
    .from('properties')
    .select('id,user_id,name')
    .eq('id', propId)
    .single();
  if (propRow) {
    const ownerMatch = propRow.user_id === sess?.user?.id;
    console.log('property.user_id:', propRow.user_id, '| auth.uid:', sess?.user?.id, '| MATCH:', ownerMatch);
    if (!ownerMatch) console.error('→ RLS MISMATCH: property.user_id ≠ auth.uid() — all inserts for this property will be blocked by RLS');
  } else {
    console.error('property row not found or SELECT RLS blocked:', propErr?.message);
  }

  if (window.ms_lastDisputeFlow) {
    window.ms_lastDisputeFlow.auth = sess ? { uid: sess.user.id, email: sess.user.email } : { uid: null };
    window.ms_lastDisputeFlow.propId = propId;
    window.ms_lastDisputeFlow.propFound = !!prop;
    window.ms_lastDisputeFlow.saveResult = insData?.length ? 'ok' : (insErr ? 'error' : 'skipped-no-propid');
    _updateDisputeBadge();
  }

  console.groupEnd();
  return { auth: sess?.user?.id, propId, insData, insErr, rows, propRow };
};

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
  const showEvBtn  = _LFC_EDITABLE.has(key) && td?.id;
  return `<div class="lfc-label">${esc(label)}</div>
    <div class="lfc-value-row">
      <div class="lfc-value ${missingCls}">${val ?? '—'}</div>
      ${editable ? `<button class="lfc-edit-btn" onclick="startFieldOverride('${td.id}','${key}')">Edit</button>` : ''}
      ${showEvBtn ? `<button class="lfc-ev-btn" onclick="openLeaseEvidencePanel('${td.id}','${key}')" title="View extraction evidence">&#x1F50D;</button>` : ''}
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
  const reviewStateBefore = deriveTenantReviewState(t).status;
  logActivity('field_override', `Field overridden — ${fieldName}`, {
    severity: 'info', actor: 'Reviewer',
    relatedEntity: tenantData[idx]?.tenant_name || tenantId,
    detail: `${fieldName}: "${original}" → "${newValue}"`,
  });
  // Append immutable evidence snapshot — survives refresh, re-login, re-extraction.
  // Called after tenantData[idx] is updated so _mkEvidenceSnapshot reads the new value.
  persistFieldEvidence(tenantId, fieldName, {
    value:                  newValue,
    approved:               true,
    manuallyEdited:         true,
    extractionVersion:      'manual',
    originalExtractedValue: original,
  });
  // Structured audit entry — queryable via activityLog
  appendReviewAuditEntry({
    tenantId,
    tenantName:        tenantData[idx]?.tenant_name || tenantId,
    fieldKey:          fieldName,
    action:            'field_override',
    label:             `Field corrected — ${fieldName}`,
    oldValue:          original,
    newValue,
    reviewStateBefore,
    reviewStateAfter:  deriveTenantReviewState(tenantData[idx]).status,
  });
  savePropertyData();
  const _rds1 = (_props || []).find(q => q.id === activePropId);
  if (_rds1) rebuildDerivedState(_rds1, { appendTimeline: true });
  { const _prop = currentProperty();
    if (_prop) appendPropertyTimelineEvent(_prop, { type: 'field_overridden', severity: 'info',
      tenantId, actor: user?.email || 'Reviewer', title: `Field corrected — ${fieldName}`,
      description: `${fieldName}: "${original}" → "${newValue}"`,
      metadata: { fieldName, original, newValue } }); }
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

// One-click approve for all core fields of a tenant that have extracted values.
// Marks review.reviewerConfirmed = true and persists evidence snapshots for each confirmed field.
function quickConfirmTenantFields(tenantId) {
  const idx = tenantData.findIndex(t => t && t.id === tenantId);
  if (idx === -1) return;
  const t = tenantData[idx];
  const CORE_FIELDS = [
    'tenant_name', 'leased_sqft', 'lease_type', 'start_date', 'end_date', 'cap',
    'admin_fee_pct', 'gross_up_pct', 'expense_stop', 'audit_rights',
    'pro_rata_method', 'renewal_options',
  ];
  const user = window.AuthService?.getCurrentUser?.() || null;
  for (const fk of CORE_FIELDS) {
    const val = t[fk] ?? t.reviewOverrides?.[fk]?.override ?? null;
    if (val == null || val === '') continue;
    persistFieldEvidence(tenantId, fk, { approved: true, manuallyEdited: false });
  }
  const reviewStateBefore = deriveTenantReviewState(t).status;
  tenantData[idx] = {
    ...t,
    review: {
      ...t.review,
      reviewerConfirmed: true,
      reviewedAt:  new Date().toISOString(),
      reviewedBy:  user?.email || 'Reviewer',
    },
  };
  appendReviewAuditEntry({
    tenantId,
    tenantName:        tenantData[idx].tenant_name || tenantId,
    action:            'quick_confirm',
    label:             'All fields confirmed',
    severity:          'info',
    reviewStateBefore,
    reviewStateAfter:  deriveTenantReviewState(tenantData[idx]).status,
  });
  savePropertyData();
  const _rds2 = (_props || []).find(q => q.id === activePropId);
  if (_rds2) rebuildDerivedState(_rds2, { appendTimeline: true });
  { const _prop = currentProperty();
    if (_prop) appendPropertyTimelineEvent(_prop, { type: 'review_confirmed', severity: 'success',
      tenantId, actor: user?.email || 'Reviewer', title: `All fields confirmed — ${t.tenant_name || tenantId}`,
      metadata: { tenantId } }); }
  _refreshLfcExpansion(tenantId);
  showToast('✓ All fields confirmed');
}

// ── Amendment Precedence ──────────────────────────────────────────────────────
//
// Amendment PDFs are extracted with the same callClaudeForLease() pipeline.
// Newer amendment values override original lease fields. Original evidence
// snapshots are preserved — new amendment snapshots are appended (never
// mutates historical records). Each amendment gets a unique amendmentId.

// Opens a file picker and triggers amendment upload for the given tenant.
function openAmendmentUpload(tenantId) {
  const inp = document.createElement('input');
  inp.type   = 'file';
  inp.accept = '.pdf,application/pdf';
  inp.style.display = 'none';
  inp.addEventListener('change', (e) => {
    if (e.target.files[0]) handleAmendmentUpload(tenantId, e.target.files[0]);
    inp.remove();
  });
  document.body.appendChild(inp);
  inp.click();
}

// Orchestrates amendment PDF extraction + override application.
async function handleAmendmentUpload(tenantId, file) {
  const idx = tenantData.findIndex(t => t && t.id === tenantId);
  if (idx === -1) return;

  showToast('Reading amendment…', { color: '#0c4a6e', textColor: '#7dd3fc', duration: 8000 });

  try {
    const leaseText = await extractLeaseText(file);
    let extracted;
    if (leaseText && leaseText.length >= 50) {
      extracted = await callClaudeForLease(leaseText);
    } else {
      extracted = await callClaudeWithPdfDirect(file);
    }
    if (!extracted) throw new Error('Could not extract amendment fields');

    const amendmentId = 'amd-' + Date.now();
    applyAmendmentOverrides(tenantId, extracted, amendmentId, file.name);
    // Phase 15: multi-document reasoning after amendment applied
    if (window.LeaseIntelligence) {
      const _liTenant = tenantData.find(t => t && t.id === tenantId);
      if (_liTenant) {
        const _liDocs = window.LeaseIntelligence.buildMultiDocReasoningDocs(_liTenant);
        if (_liDocs.length > 1) {
          _liTenant._multiDocReasoning = window.LeaseIntelligence.reasonMultiDocumentLease(_liDocs);
          _liTenant._explainability    = window.LeaseIntelligence.generateLeaseExplainability(_liTenant);
          _liTenant._modelRouting      = window.LeaseIntelligence.modelRoutingRecommendation(_liTenant);
          console.log('[LEASE INTELLIGENCE] multi-doc reasoning:', Object.keys(_liTenant._multiDocReasoning).length, 'fields | model:', _liTenant._modelRouting.model);
        }
      }
    }
    const _rds3 = (_props || []).find(q => q.id === activePropId);
    if (_rds3) rebuildDerivedState(_rds3, { appendTimeline: true });
    { const _prop = currentProperty();
      if (_prop) appendPropertyTimelineEvent(_prop, { type: 'amendment_uploaded', severity: 'info',
        tenantId, actor: 'User', title: `Amendment uploaded — ${file.name}`,
        metadata: { fileName: file.name, amendmentId } }); }
  } catch (err) {
    showToast('Amendment upload failed: ' + err.message, { color: '#7f1d1d', textColor: '#fca5a5', duration: 5000 });
  }
}

// Applies amendment extraction overrides to an existing tenant.
// For each field that is non-null in the amendment AND differs from the original:
//   - appends a new evidence snapshot tagged with the amendmentId
//   - updates the tenant's live field value
//   - records the override in tenant.amendments[]
// Original snapshots are never mutated.
function applyAmendmentOverrides(tenantId, amNorm, amendmentId, fileName) {
  const idx = tenantData.findIndex(t => t && t.id === tenantId);
  if (idx === -1) return;
  const t = tenantData[idx];

  const COMPARABLE_FIELDS = [
    'tenant_name', 'leased_sqft', 'start_date', 'end_date', 'lease_type', 'cap',
    'admin_fee_pct', 'gross_up_pct', 'expense_stop', 'audit_rights',
    'pro_rata_method', 'renewal_options',
  ];

  const overriddenFields = [];
  let updatedTenant = { ...t };
  const now = new Date().toISOString();

  for (const fk of COMPARABLE_FIELDS) {
    const amVal = amNorm[fk] ?? null;
    if (amVal === null || amVal === '') continue;

    const origVal = t[fk] ?? null;
    // Skip if value is identical — no real change
    if (origVal !== null && String(amVal) === String(origVal)) continue;

    overriddenFields.push(fk);
    console.log(`[AMENDMENT OVERRIDE] ${fk}: "${origVal}" → "${amVal}" (${amendmentId})`);

    // Retrieve the quote from the amendment's injected fieldEvidence snapshot, if available
    const amSnap = amNorm.fieldEvidence?.[fk]?.snapshots?.[0];
    const qt     = amSnap?.quote ?? null;
    const amModel = amSnap?.extractionModel ?? null;

    // Update the live field value on the tenant
    updatedTenant = { ...updatedTenant, [fk]: amVal };

    // Append amendment evidence snapshot (preserves original snapshot history)
    const fev  = updatedTenant.fieldEvidence || {};
    const prev = (fev[fk] || { snapshots: [] }).snapshots;
    updatedTenant.fieldEvidence = {
      ...fev,
      [fk]: { snapshots: [...prev, {
        fieldKey:               fk,
        value:                  amVal,
        confidence:             { status: 'estimated', note: 'AI-extracted from amendment' },
        sourceFile:             fileName || null,
        page:                   null,
        section:                amSnap?.section ?? null,
        quote:                  qt,
        extractionId:           amNorm._jobId || null,
        extractionVersion:      'v1-amendment',
        extractionModel:        amModel,
        extractedAt:            now,
        superseded:             false,
        amendmentId,
        reviewerUid:            null,
        reviewerEmail:          null,
        reviewedAt:             now,
        approved:               false,
        manuallyEdited:         false,
        originalExtractedValue: origVal,
      }]},
    };
  }

  // Build and store the amendment record
  const amendmentEntry = {
    amendmentId,
    uploadedAt:      now,
    fileName:        fileName || null,
    effectiveDate:   amNorm.start_date || null,
    extractedFields: COMPARABLE_FIELDS.reduce((acc, fk) => {
      if (amNorm[fk] != null && amNorm[fk] !== '') acc[fk] = amNorm[fk];
      return acc;
    }, {}),
    overriddenFields,
  };

  updatedTenant = {
    ...updatedTenant,
    amendments: [...(Array.isArray(t.amendments) ? t.amendments : []), amendmentEntry],
  };

  tenantData[idx] = updatedTenant;

  appendReviewAuditEntry({
    tenantId,
    tenantName: updatedTenant.tenant_name || tenantId,
    action:     'amendment_applied',
    label:      `Amendment applied — ${overriddenFields.length} field${overriddenFields.length !== 1 ? 's' : ''} updated`,
    severity:   'info',
    detail:     JSON.stringify({ amendmentId, overriddenFields, fileName }),
  });

  savePropertyData();
  { const _prop = currentProperty();
    if (_prop) appendPropertyTimelineEvent(_prop, { type: 'amendment_applied', severity: 'info',
      tenantId, actor: 'User', title: `Amendment applied — ${overriddenFields.length} field${overriddenFields.length !== 1 ? 's' : ''} modified`,
      description: `Amendment ID: ${amendmentId} | File: ${fileName}`,
      metadata: { amendmentId, overriddenFields: overriddenFields.join(','), fileName },
      relatedEvidenceIds: overriddenFields }); }
  renderBulkResults();
  _refreshLfcExpansion(tenantId);

  const msg = overriddenFields.length > 0
    ? `✓ Amendment applied — ${overriddenFields.length} field${overriddenFields.length !== 1 ? 's' : ''} updated`
    : '✓ Amendment uploaded — no field differences detected';
  showToast(msg, { color: '#14532d', textColor: '#86efac', duration: 4000 });
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
  if (fieldName === 'leased_sqft' || fieldName === 'cap' ||
      fieldName === 'admin_fee_pct' || fieldName === 'gross_up_pct' || fieldName === 'expense_stop') return 'number';
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

// Derives the confidence display level for a tenant card.
// Extracted from the duplicate ternary that appeared in renderBulkResults()
// and renderTenantDetailPanel() — single definition, both callers use this.
function _tenantConfLevel(d) {
  return d._confidence || (d.extractionFailed ? 'failed' : d._needsReview ? 'medium' : null);
}

function renderBulkResults() {
  const el = document.getElementById('bulkResults');
  el.innerHTML = '';
  el.scrollTop = 0;

  // tenantData is the source of truth — contains every file, including failed extractions.
  // Do NOT filter by tenant_name or status here; every file must render a card.
  const tenants = tenantData.filter(t => t && typeof t === 'object');
  const _debugMode = !!(window.DEBUG_LEASES || localStorage.getItem(_lsUserId ? 'ms_debug_leases_' + _lsUserId : 'ms_debug_leases') === '1');

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
    const confLevel = _tenantConfLevel(d);
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

  // Advance onboarding step bar when the first lease is extracted
  if (tenantData.some(t => t && t.tenant_name)) _obSyncState();
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

  // Re-derive review state from current field values and clear _needsReview
  // if all required fields are now present. The original condition only checked
  // name + sqft and missed start_date / end_date / lease_type — fields the user
  // fills in after flagging. deriveTenantReviewState() is the single source of
  // truth and checks all required fields.
  if (d && d._needsReview) {
    const rv = deriveTenantReviewState(d);
    if (rv.status === 'verified' || rv.status === 'manually_verified') {
      d._needsReview = false;
      if (row) {
        row.classList.remove('has-warning', 'has-error');
        const statusEl = document.getElementById(`bstatus-${i}`);
        if (statusEl) statusEl.textContent = '✓';
      }
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

  const _d = tenantData[i];
  if (_d?._userConfirmed) {
    const rvAfter = deriveTenantReviewState(_d).status;
    logActivity('tenant_confirmed', `Tenant confirmed — ${_d.tenant_name || '(unnamed)'}`, {
      severity: 'success', actor: 'Reviewer',
      relatedEntity: _d.tenant_name || '',
      detail: _d.extractionFailed ? 'Manually confirmed after extraction failure' : 'Tenant entry saved',
    });
    // Structured audit trail — persisted in activityLog alongside logActivity
    appendReviewAuditEntry({
      tenantId:         _d.id,
      tenantName:       _d.tenant_name || '(unnamed)',
      action:           'tenant_confirmed',
      label:            `Tenant confirmed — ${_d.tenant_name || '(unnamed)'}`,
      severity:         'success',
      reviewStateAfter: rvAfter,
    });
  }

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

  // Full re-render after the 0.8s flash animation completes.
  // Resolves stale warning banners, status icons, review pills, and queue
  // badges that are only recomputed inside renderBulkResults().
  setTimeout(() => { renderBulkResults(); }, 850);

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

    // Preserve reviewer-approved overrides and evidence history across re-extraction.
    // Without this, retrying a lease would silently discard manual corrections.
    const prevOverrides = t?.reviewOverrides || {};
    const prevEvidence  = t?.fieldEvidence   || {};

    // Merge new norm with prev overrides: for any confirmed override, restore
    // the reviewer-approved value rather than the fresh AI extraction.
    const mergedNorm = { ...(isValid ? norm : {}) };
    if (isValid) {
      Object.keys(prevOverrides).forEach(function(fk) {
        const ov = prevOverrides[fk];
        if (ov?.reviewerConfirmed && fk in mergedNorm) {
          mergedNorm[fk] = ov.override;
        }
      });
    }

    const updated = {
      ...mergedNorm,
      leaseFile:        file,
      leaseExpected:    true,
      fileName:         file.name,
      leaseUrl:         t?.leaseUrl ?? null,
      extractionFailed: !isValid,
      _needsReview:     isPartial,
      _showRetry,
      _error:           isValid ? null : 'Could not identify a tenant — please enter fields manually',
      id:               t?.id ?? crypto.randomUUID(),
      reviewOverrides:  prevOverrides,
      fieldEvidence:    prevEvidence,
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
  rebuildDerivedState(property, { appendTimeline: true });
  appendPropertyTimelineEvent(property, { type: 'invoice_imported', severity: 'info',
    actor: 'User', title: `${total} invoice${total !== 1 ? 's' : ''} imported`,
    metadata: { total, totalAmount: invoiceData.reduce((s,i) => s + (parseFloat(i.amount)||0), 0) } });
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
        ${d._fileUploadError === 'rate-limited'
          ? `<div class="inv-upload-err-banner inv-upload-err-banner--warn">&#x26A0; File not backed up — upload rate limit reached. Invoice data is saved; re-upload this file to attach it.</div>`
          : d._fileUploadError
            ? `<div class="inv-upload-err-banner">&#x26A0; File backup unavailable — invoice data is saved and CAM will run normally</div>`
            : ''}
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

  // Advance onboarding step bar when the first invoice is added
  _obSyncState();
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
  body.innerHTML = '';
  if (fileType && fileType.startsWith('image/')) {
    const img = document.createElement('img');
    img.src = url;
    img.style.cssText = 'max-width:100%;max-height:calc(100vh - 80px);border-radius:8px;object-fit:contain;';
    body.appendChild(img);
  } else {
    const iframe = document.createElement('iframe');
    iframe.src = url;
    iframe.style.cssText = 'width:100%;height:calc(100vh - 80px);border:none;border-radius:8px;';
    body.appendChild(iframe);
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
  const _dcUser = window.AuthService?.getCurrentUser();
  console.log('[disputeCharge] i:', i, '| role:', _dcUser?.role, '| activePropId:', activePropId || 'null',
    '| canEditReview:', window.AccessControl ? window.AccessControl.canEditReview(_dcUser) : 'AccessControl missing');
  if (window.ms_lastDisputeFlow) { window.ms_lastDisputeFlow.ts = new Date().toISOString(); window.ms_lastDisputeFlow.trigger = 'disputeCharge'; }
  if (window.AccessControl && window.AuthService &&
      !window.AccessControl.canEditReview(window.AuthService.getCurrentUser())) {
    console.warn('[disputeCharge] BLOCKED by canEditReview — role:', _dcUser?.role);
    return;
  }
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
    const proRata  = t.totalSqft > 0 ? t.leasedSqft / t.totalSqft : 0;
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
      t.cap ?? null, t.capBaseAmount ?? null,
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

  let html = _buildReconciliationSummaryHtml(fullResults, invoices, propName) + `<div class="summary-bar">
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
          ${flags.map(f => {
            const narrative = (window.ReconciliationExplainer && f.code)
              ? window.ReconciliationExplainer.buildWarningNarrative(f)
              : f.explanation;
            return `
            <div class="rc-flag-item">
              &#x2022; <strong>${esc(f.message)}</strong>
              ${narrative ? `<br><span class="rc-flag-expl">${esc(narrative)}</span>` : ''}
            </div>`;
          }).join('')}
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
                  <div class="ts-detail-formula">${inv.allocation === 'direct' ? fmt(inv.amount) + ' direct charge — full amount to this unit' : fmt(inv.amount) + ' &times; ' + pct + '% = ' + fmt(inv.share)}</div>
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
    const _lvPanelId = `lv-panel-${tdIdx >= 0 ? tdIdx : r.name.replace(/[^a-zA-Z0-9]/g, '-')}`;
    const _liveT  = tenantData.find(t => t && t.id === r.tenantId);
    const _calcSt = _deriveCalcState(r, _liveT);

    html += `<div class="result-card${flags.length ? ' result-card--flagged' : ''}">
      <div class="r-name">${esc(r.name)}${r.unitNumber ? `<span class="rc-unit"> · Unit ${esc(r.unitNumber)}</span>` : ''}<span class="rc-calc-state ${_calcSt.cls}">${_calcSt.label}</span></div>
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
      <div class="result-card-actions">
        <button class="explain-btn" onclick="openExplainPanel('${esc(r.name)}')">&#x1F4CA; View Calculation</button>
        <button class="lv-validate-btn" onclick="_startLeaseValidation('${_lvPanelId}',${tdIdx})">&#x1F50D; Validate Against Lease</button>
        <button class="tenant-stmt-card-btn" onclick="generateTenantStatement('${esc(r.name)}')" title="Generate the tenant-facing CAM statement">&#x1F9FE; Tenant Statement</button>
      </div>
      <div id="${_lvPanelId}" class="lv-panel" style="display:none;"></div>
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
  {
    const _camSave = await saveCamResults(currentProperty()?.id, fullResults, getCamYear(), totalCost)
      .catch(e => ({ ok: false, reason: e?.message || 'network error' }));
    if (!_camSave.ok) _showCamSaveWarning(_camSave);
  }

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
// Shown once per browser session when cam_reconciliations table is absent.
function _showMigrationMissingWarning() {
  if (sessionStorage.getItem('_camMigrationWarned')) return;
  sessionStorage.setItem('_camMigrationWarned', '1');
  showToast(
    '⚠ CAM history unavailable — database migration not applied. Run migrations/003_cam_reconciliations.sql in Supabase SQL Editor.',
    { color: '#78350f', textColor: '#fde68a', duration: 12000 }
  );
}

// Called when saveCamResults returns ok:false. Shows a toast + a persistent
// banner in the results panel so the landlord knows the write failed.
function _showCamSaveWarning(saveResult) {
  let msg;
  if (saveResult.code === 'migration_missing') {
    msg = '⚠ CAM results were not saved — database migration not applied. Run migrations/003_cam_reconciliations.sql in Supabase SQL Editor. Results are visible now but will be lost on browser close.';
  } else if (saveResult.keySource === 'anon') {
    msg = '⚠ CAM results were not saved — SUPABASE_SERVICE_ROLE_KEY is not set on the server. Set it in your deployment environment variables and redeploy.';
  } else {
    msg = `⚠ CAM results were not saved — ${saveResult.reason || 'unknown error'}. Results are visible now but will be lost on browser close.`;
  }
  showToast(msg, { color: '#7f1d1d', textColor: '#fca5a5', duration: 10000 });
  const banner = document.getElementById('camSaveWarningBanner');
  if (banner) {
    banner.textContent = msg;
    banner.style.display = 'block';
  }
}

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
// _errKey() defined near _lsUserKey() — returns uid-scoped localStorage key
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
    const log = JSON.parse(localStorage.getItem(_errKey()) || '[]');
    log.unshift(entry);
    if (log.length > _ERR_MAX) log.length = _ERR_MAX;
    localStorage.setItem(_errKey(), JSON.stringify(log));
  } catch { /* quota — silently skip */ }
}

// Devtools helpers: window._msErrors.get() / .clear()
window._msErrors = {
  get:   ()  => { try { return JSON.parse(localStorage.getItem(_errKey()) || '[]'); } catch { return []; } },
  clear: ()  => { try { localStorage.removeItem(_errKey()); } catch {} },
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
      const store = JSON.parse(_lsGet(_lsUserKey()) || '{}');
      delete store[TEST_ID];
      _lsSet(_lsUserKey(), JSON.stringify(store));
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

// ─── Onboarding ────────────────────────────────────────────────────────────────

function _obKey()   { return _lsUserId ? `ms_ob_v1_${_lsUserId}` : 'ms_ob_v1_anon'; }
function _obGet()   { try { return JSON.parse(_lsGet(_obKey()) || 'null'); } catch { return null; } }
function _obSet(s)  { try { _lsSet(_obKey(), JSON.stringify(s)); } catch (_) {} }
function _obInit()  {
  const s = { steps: [false,false,false,false,false], welcomeSeen: false };
  _obSet(s); return s;
}

// Mark a step complete (0 = Setup, 1 = Leases, 2 = Invoices, 3 = Calculate, 4 = Review)
function _obMarkStep(idx) {
  const s = _obGet() || _obInit();
  if (s.steps[idx]) return;
  s.steps[idx] = true;
  _obSet(s);
}

// Show the welcome modal if the user hasn't seen it and has no real properties
function _maybeShowWelcome(props) {
  const s = _obGet() || _obInit();
  if (s.welcomeSeen) return;
  const realProps = (Array.isArray(props) ? props : _props).filter(p => p.id !== DEMO_PROPERTY_ID);
  if (realProps.length > 0) return; // already has properties
  const modal = document.getElementById('obWelcomeModal');
  if (modal) modal.style.display = 'flex';
}

// Called from welcome modal buttons (global so onclick can reach it)
function obCloseWelcome(action) {
  const s = _obGet() || _obInit();
  s.welcomeSeen = true;
  _obSet(s);
  const modal = document.getElementById('obWelcomeModal');
  if (modal) modal.style.display = 'none';
  if (action === 'property') addNewProperty();
  else if (action === 'demo') { if (typeof loadDemo === 'function') loadDemo(); }
}

// Derive current step from live workflow state and update the step bar + hints
function _obSyncState() {
  const hasLeases   = tenantData.some(t => t && t.tenant_name);
  const hasInvoices = invoiceData.length > 0;
  const hasResults  = lastResults.length > 0;

  // Mark completed steps in localStorage
  const setupEl = document.getElementById('propertyName');
  const sqftEl  = document.getElementById('totalSqft');
  const hasSetup = !!(setupEl?.value?.trim() && setupEl.value.trim() !== 'New Property' && parseFloat(sqftEl?.value) > 0);
  if (hasSetup)    _obMarkStep(0);
  if (hasLeases)   _obMarkStep(1);
  if (hasInvoices) _obMarkStep(2);
  if (hasResults)  _obMarkStep(3);
  if (hasResults)  _obMarkStep(4); // review step auto-marks when results present

  // Advance step bar to the current frontier
  const reached = hasResults ? 'done'
    : hasInvoices ? 'calculate'
    : hasLeases   ? 'invoices'
    : hasSetup    ? 'leases'
    : 'setup';
  updateStepBar(reached);

  // Update contextual hints
  _obUpdateHints(hasSetup, hasLeases, hasInvoices, hasResults);
}

// Inject contextual hints into section placeholders
function _obUpdateHints(hasSetup, hasLeases, hasInvoices, hasResults) {
  const h2 = document.getElementById('obHintLeases');
  const h3 = document.getElementById('obHintInvoices');

  if (h2) {
    if (!hasLeases) {
      h2.innerHTML = '<strong>Step 2 of 5</strong> — Drag &amp; drop your lease PDFs above. '
        + 'AI reads CAM caps, exclusions, and rent schedules automatically. No templates needed.';
      h2.style.display = 'block';
    } else {
      h2.style.display = 'none';
    }
  }

  if (h3) {
    if (hasLeases && !hasInvoices) {
      h3.innerHTML = '<strong>Step 3 of 5</strong> — Upload your CAM expense invoices for the reconciliation year. '
        + 'PDF, image, or Excel GL exports all work. '
        + (hasLeases ? '' : '<a onclick="document.getElementById(\'cardLeases\').scrollIntoView({behavior:\'smooth\'})">Upload leases first ↑</a>');
      h3.style.display = 'block';
    } else {
      h3.style.display = 'none';
    }
  }
}

// ─── Step Progress Bar ────────────────────────────────────────────────────────

function updateStepBar(reached) {
  // 5-step system: setup → leases → invoices → calculate → review
  // Legacy call-site aliases kept for backward compat
  const aliasMap = { upload: 'leases', resolve: 'review' };
  const normalized = aliasMap[reached] || reached;

  const steps = ['setup','leases','invoices','calculate','review'];

  if (normalized === 'done') {
    steps.forEach(s => {
      const el = document.getElementById(`step-${s}`);
      if (!el) return;
      el.classList.remove('active');
      el.classList.add('done');
      const dot = el.querySelector('.step-dot');
      if (dot) dot.innerHTML = '&#x2713;';
    });
    return;
  }

  const idx = steps.indexOf(normalized);
  if (idx === -1) return;

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
  const narrativeHtml = (() => {
    if (!window.ReconciliationExplainer) return '';
    const narr = window.ReconciliationExplainer.buildReconciliationSummaryNarrative(r, td);
    return narr ? `<div class="ep-narrative">${esc(narr)}</div>` : '';
  })();

  const s1 = `
    <div class="ep-section-title">Summary</div>
    ${narrativeHtml}
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

// ─── Reconciliation Calculation Engine Helpers ────────────────────────────────

// Derives calculation state from a ReconciliationResult + live tenant record.
// Returns { state, label, cls } used for calc state badges in panels and reports.
// ── Reconciliation engine shims ───────────────────────────────────────────────
// Business logic lives in reconciliation-engine.js (pure, no global deps).
// evalDate is computed here using getCamYear() so the engine stays pure.
function _deriveCalcState(result, liveT) {
  return ReconciliationEngine.deriveCalcState(result, liveT);
}
function _detectReconciliationIssues(results, property, evaluationDate) {
  return ReconciliationEngine.detectReconciliationIssues(results, property, evaluationDate || `${getCamYear()}-12-31`);
}

// Builds the in-app Reconciliation Summary HTML panel displayed above result cards.
function _buildReconciliationSummaryHtml(results, invoices, propName) {
  if (!results || !results.length) return '';

  const totalPool   = invoices.reduce((s, inv) => s + (parseFloat(inv.amount) || 0), 0);
  const totalBilled = results.reduce((s, r) => s + r.totalAllocated, 0);
  const proRataSum  = results.reduce((s, r) => s + (r.proRataPercent || 0), 0);
  const proRataGap  = parseFloat((100 - proRataSum).toFixed(2));
  const capsCount   = results.filter(r => r.capApplied).length;
  const capTotal    = results.filter(r => r.capApplied).reduce((s, r) => s + (r.capAdjustment || 0), 0);
  const flaggedCnt  = results.filter(r => (r.ambiguityFlags || []).length > 0).length;

  const issues   = _detectReconciliationIssues(results, currentProperty());
  _lastReconIssues = issues; // capture for openDisputeFromFlag()
  const reds     = issues.filter(f => f.severity === 'red');
  const yellows  = issues.filter(f => f.severity === 'yellow');
  const panelCls = reds.length > 0 ? 'rcs-panel--alert' : yellows.length > 0 ? 'rcs-panel--warn' : 'rcs-panel--ok';

  // Allocation integrity badge (Phase 5H) — validate the allocation set produced
  // by this run against the invariant engine. Pure derivation, no side effects.
  const _allocSet = results.map(r => ({
    tenantId:   r.tenantId || r.name,
    tenantName: r.name,
    percent:    r.proRataPercent ?? (r.proRata != null ? r.proRata * 100 : 0),
    amount:     r.totalAllocated ?? r.allocatedAmount ?? 0,
  }));
  const _integrity = AllocationIntegrity.buildIntegritySummary(_allocSet, {
    method: 'leased square footage',
    excludedCount: 0,
  });
  const _balBadgeCls = _integrity.criticalIssueCount > 0 ? 'rcs-balance-badge--critical'
    : !_integrity.balanced                               ? 'rcs-balance-badge--warn'
    :                                                      'rcs-balance-badge--ok';
  const _balBadgeTxt = _integrity.criticalIssueCount > 0 ? '✕ Critical Allocation Error'
    : !_integrity.balanced                               ? '⚠ Needs Review'
    :                                                      '✓ Balanced';
  const _balBadgeHtml = `<span class="rcs-balance-badge ${_balBadgeCls}" title="${esc(_integrity.explainability)}">${_balBadgeTxt}</span>`;

  const proCls   = Math.abs(proRataGap) > 5 ? 'rcs-kpi--alert' : Math.abs(proRataGap) > 2 ? 'rcs-kpi--warn' : '';
  const capsCls  = capsCount > 0 ? 'rcs-kpi--warn' : '';
  const flagCls  = flaggedCnt > 0 ? 'rcs-kpi--warn' : '';

  const issueHtml = issues.length > 0 ? `<div class="rcs-issues">${
    issues.map((f, fi) => `<div class="rcs-issue rcs-issue--${f.severity}">
      <span class="rcs-issue-main">${f.severity === 'red' ? '&#x26D4;' : '&#x26A0;'} ${esc(f.title)}</span>
      <button class="rcs-dispute-btn" onclick="openDisputeFromFlag(${fi})">Open Dispute</button>
    </div>`).join('')
  }</div>` : '';

  const rows = results.map(r => {
    const liveT  = tenantData.find(t => t && t.id === r.tenantId);
    const calcSt = _deriveCalcState(r, liveT);
    const capCell = r.capApplied
      ? `<td class="rcs-td rcs-num rcs-cap-cell">−${fmt(r.capAdjustment)}</td>`
      : `<td class="rcs-td rcs-muted">—</td>`;
    return `<tr class="rcs-row">
      <td class="rcs-td rcs-name-cell">${esc(r.name)}${r.unitNumber ? `<span class="rcs-unit"> · ${esc(r.unitNumber)}</span>` : ''}</td>
      <td class="rcs-td rcs-num">${r.sqFt ? Number(r.sqFt).toLocaleString() : '—'}</td>
      <td class="rcs-td rcs-num">${(r.proRata * 100).toFixed(2)}%</td>
      ${capCell}
      <td class="rcs-td rcs-num rcs-alloc-total">${fmt(r.totalAllocated)}</td>
      <td class="rcs-td"><span class="rc-calc-state ${calcSt.cls}">${calcSt.label}</span></td>
    </tr>`;
  }).join('');

  return `
    <div class="rcs-panel ${panelCls}">
      <div class="rcs-panel-head">
        <span class="rcs-panel-title">&#x1F4CA; Reconciliation Summary</span>
        <span class="rcs-coverage-badge">${totalPool > 0 ? (totalBilled / totalPool * 100).toFixed(1) : '—'}% coverage</span>
        ${_balBadgeHtml}
      </div>
      <div class="rcs-kpis">
        <div class="rcs-kpi"><div class="rcs-kpi-val">${fmt(totalPool)}</div><div class="rcs-kpi-lbl">CAM Pool</div></div>
        <div class="rcs-kpi"><div class="rcs-kpi-val">${fmt(totalBilled)}</div><div class="rcs-kpi-lbl">Total Billed</div></div>
        <div class="rcs-kpi ${proCls}"><div class="rcs-kpi-val">${proRataSum.toFixed(1)}%</div><div class="rcs-kpi-lbl">Pro-Rata Sum</div></div>
        <div class="rcs-kpi ${capsCls}"><div class="rcs-kpi-val">${capsCount > 0 ? capsCount + ' (−' + fmt(capTotal) + ')' : '0'}</div><div class="rcs-kpi-lbl">Caps Applied</div></div>
        <div class="rcs-kpi ${flagCls}"><div class="rcs-kpi-val">${flaggedCnt}</div><div class="rcs-kpi-lbl">Flagged</div></div>
      </div>
      ${issueHtml}
      <div class="rcs-table-wrap">
        <table class="rcs-table">
          <thead><tr>
            <th class="rcs-th">Tenant</th>
            <th class="rcs-th rcs-num">Sqft</th>
            <th class="rcs-th rcs-num">Pro-Rata</th>
            <th class="rcs-th rcs-num">Cap Adj</th>
            <th class="rcs-th rcs-num">Allocated</th>
            <th class="rcs-th">Calc State</th>
          </tr></thead>
          <tbody>${rows}</tbody>
          <tfoot><tr class="rcs-total-row">
            <td class="rcs-td rcs-total-label" colspan="2">TOTAL</td>
            <td class="rcs-td rcs-num">${proRataSum.toFixed(1)}%</td>
            <td class="rcs-td rcs-num">${capsCount > 0 ? '−' + fmt(capTotal) : '—'}</td>
            <td class="rcs-td rcs-num rcs-alloc-total">${fmt(totalBilled)}</td>
            <td class="rcs-td"></td>
          </tr></tfoot>
        </table>
      </div>
    </div>`;
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

  const confLevel = _tenantConfLevel(d);
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
  if (e.key === 'Escape') {
    if (document.getElementById('reviewWorkspace')?.classList.contains('open')) {
      closeReviewWorkspace();
    } else {
      closeLeaseModal();
    }
  }
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
let _camYear = new Date().getFullYear(); // hydrated from scoped key in _lsMigrateAncillaryKeys()
function getCamYear() { return _camYear; }
function setCamYear(y) {
  _camYear = parseInt(y, 10) || new Date().getFullYear();
  localStorage.setItem(_camYearKey(), _camYear);
  const glLbl = document.getElementById('glUploadLabel');
  if (glLbl) glLbl.textContent = `Upload ${_camYear} GL Excel File (.xlsx only)`;
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
  const glLbl = document.getElementById('glUploadLabel');
  if (glLbl) glLbl.textContent = `Upload ${_camYear} GL Excel File (.xlsx only)`;
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

// ─── Dispute Types + Severity ─────────────────────────────────────────────────
const _DISPUTE_TYPES = {
  cam_cap_violation:     { label: 'CAM Cap Violation'     },
  excluded_expense:      { label: 'Excluded Expense'      },
  duplicate_billing:     { label: 'Duplicate Billing'     },
  allocation_mismatch:   { label: 'Allocation Mismatch'   },
  expired_lease_billing: { label: 'Expired Lease Billing' },
  admin_fee_violation:   { label: 'Admin Fee Violation'   },
  unsupported_invoice:   { label: 'Unsupported Invoice'   },
};
const _DISPUTE_SEV = {
  low:      { label: 'Low',      cls: 'dsev-low'  },
  medium:   { label: 'Medium',   cls: 'dsev-med'  },
  high:     { label: 'High',     cls: 'dsev-high' },
  critical: { label: 'Critical', cls: 'dsev-crit' },
};
let _lastReconIssues = []; // last _detectReconciliationIssues() output — used by openDisputeFromFlag
let _dwActiveDid     = null; // active dispute ID in workspace overlay

// ─── Dispute State ────────────────────────────────────────────────────────────
let lastInvoices = []; // [{ id, vendor, category, amount }]
let lastTenants  = []; // [{ name, excludedCategories }]
const disputes   = []; // [{ id, tenantName, invoiceId, vendor, category, tenantShare, reason, timestamp, status, resolution, resolvedAt, hash, disputeType, severity, reviewerNote, leaseClause, history[] }]
let nextDisputeId = 0;

// ─── Activity Log ─────────────────────────────────────────────────────────────
const activityLog = []; // { type, title, detail, severity, timestamp, actor, relatedEntity, financialImpact }

function logActivity(type, title, opts = {}) {
  // Event shaping delegated to AuditService — ensures canonical field set,
  // valid severity, and automatic propertyId tagging on every entry.
  activityLog.unshift(AuditService.shapeEvent(type, title, { ...opts, propertyId: activePropId }));
  if (activityLog.length > 200) activityLog.length = 200;
  savePropertyData(); // persist change — debounced, so rapid events collapse
}

// Direct audit push — bypasses savePropertyData() to avoid re-entrancy during
// save/load callbacks. Use only for migration_applied, snapshot_restored,
// malformed_state_recovered events where the caller already holds the save lock.
function _auditDirect(type, title, opts = {}) {
  activityLog.unshift(AuditService.shapeEvent(type, title, { ...opts, propertyId: activePropId }));
  if (activityLog.length > 200) activityLog.length = 200;
}

// ─── Checkpoint System ────────────────────────────────────────────────────────
// _cpKey() defined near _lsUserKey() — returns uid-scoped localStorage key
const _checkpoints = {};

function _loadCheckpoints() {
  try {
    const raw = localStorage.getItem(_cpKey());
    if (raw) Object.assign(_checkpoints, JSON.parse(raw));
  } catch (e) { }
}

function _saveCheckpoints() {
  try {
    localStorage.setItem(_cpKey(), JSON.stringify(_checkpoints));
  } catch (e) {
    // quota exceeded — trim to 2 per property and retry
    Object.keys(_checkpoints).forEach(id => {
      if (_checkpoints[id].length > 2) _checkpoints[id].length = 2;
    });
    try { localStorage.setItem(_cpKey(), JSON.stringify(_checkpoints)); } catch (_) { }
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

function _setSyncStatus(status, errorMsg) {
  _syncStatus = status;
  if (!window.ms_syncState) window.ms_syncState = { status: 'idle', lastSavedAt: null, lastCloudSyncAt: null, lastError: null };
  window.ms_syncState.status = status;
  const _now = new Date().toISOString();
  if (status === 'local')  window.ms_syncState.lastSavedAt     = _now;
  if (status === 'synced') { _lastSyncAt = new Date(); window.ms_syncState.lastCloudSyncAt = _now; }
  if (status === 'error')  window.ms_syncState.lastError       = { ts: _now, message: errorMsg || 'Unknown error' };
  _renderSyncIndicator();
}

function _renderSyncIndicator() {
  const el = document.getElementById('syncIndicator');
  if (!el) return;
  const cfgMap = {
    idle:     { cls: '',            icon: '',  label: '' },
    pending:  { cls: 'si-pending',  icon: '◌', label: 'Saving…' },
    local:    { cls: 'si-local',    icon: '◎', label: 'Saved locally' },
    synced:   { cls: 'si-synced',   icon: '✓', label: 'Synced to cloud ✓' },
    error:    { cls: 'si-error',    icon: '⚠', label: 'Error saving' },
    conflict: { cls: 'si-conflict', icon: '⚡', label: 'Conflict' },
    recovery: { cls: 'si-recovery', icon: '↩', label: 'Recovery available' },
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
// _rvKey() defined near _lsUserKey() — returns uid-scoped localStorage key
let _reviewMode = false;

function _rvLoad() {
  try { return JSON.parse(localStorage.getItem(_rvKey()) || '{}'); } catch { return {}; }
}
function _rvSave(tokens) {
  try { localStorage.setItem(_rvKey(), JSON.stringify(tokens)); } catch {}
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
  // ── Dispute flow diagnostics ──────────────────────────────────────────────
  const _sdUser = window.AuthService?.getCurrentUser();
  const _sdProp = currentProperty();
  const _sdTs   = new Date().toISOString();
  console.group('[submitDispute] vendor:', vendor, '| tenant:', tenantName);
  console.log('activePropId:', activePropId || 'NULL — saves will be silently skipped');
  console.log('currentProperty():', _sdProp ? JSON.stringify({ id: _sdProp.id, name: _sdProp.name }) : 'NULL');
  console.log('auth user:', _sdUser ? JSON.stringify({ role: _sdUser.role, id: _sdUser.id, email: _sdUser.email }) : 'null');
  console.log('disputes[] before push:', disputes.length);
  if (!activePropId) {
    console.error('[DISPUTE] activePropId missing — dispute cannot persist. _tenantPortalPropId:', window._tenantPortalPropId || 'also null');
    alert('Property context missing — cannot save dispute. Please reload the page and try again.');
    console.groupEnd();
    return;
  }
  if (window.ms_lastDisputeFlow) {
    window.ms_lastDisputeFlow.ts        = _sdTs;
    window.ms_lastDisputeFlow.trigger   = 'submitDispute';
    window.ms_lastDisputeFlow.propId    = activePropId || null;
    window.ms_lastDisputeFlow.propFound = !!_sdProp;
    window.ms_lastDisputeFlow.auth      = _sdUser ? { uid: _sdUser.id, email: _sdUser.email, role: _sdUser.role } : { uid: null };
    window.ms_lastDisputeFlow.saveAttempted = false;
    window.ms_lastDisputeFlow.saveResult    = null;
    _updateDisputeBadge();
  }
  // ─────────────────────────────────────────────────────────────────────────
  const reason = document.getElementById(`dreason-${rowId}`).value.trim();
  if (!reason) {
    document.getElementById(`dreason-${rowId}`).style.borderColor = '#ea580c';
    console.groupEnd();
    return;
  }
  const docInput = document.getElementById(`ddoc-${rowId}`);
  const docName  = docInput && docInput.files[0] ? docInput.files[0].name : null;
  const _dNow = new Date().toISOString();
  disputes.push({
    id:          nextDisputeId++,
    tenantName, invoiceId, vendor, category, tenantShare, reason, docName,
    timestamp:   _dNow,
    status:      'open',
    resolution:  null, resolvedAt: null, hash: null,
    disputeType: null, severity: 'medium', reviewerNote: null, leaseClause: null,
    history:     [{ action: 'opened', by: tenantName || 'Tenant', at: _dNow, note: reason }],
  });
  logActivity('dispute_opened', `Dispute filed — ${vendor || 'Unknown vendor'}`, {
    severity:        'warning',
    actor:           tenantName || 'Tenant',
    relatedEntity:   vendor || '',
    detail:          reason || '',
    financialImpact: tenantShare ? fmt(parseFloat(tenantShare) || 0) : '',
  });
  { const _prop = currentProperty();
    if (_prop) appendPropertyTimelineEvent(_prop, { type: 'dispute_created', severity: 'warning',
      actor: tenantName || 'Tenant', title: `Dispute filed — ${vendor || 'Unknown vendor'}`,
      description: reason || '',
      metadata: { vendor, category, tenantShare, reason },
      relatedDisputeIds: [disputes[disputes.length - 1]?.id].filter(x => x != null) }); }

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
  _refreshDisputeCountUI();
  _refreshTenantDisputeBadge(tenantName);
  // Patch tenant portal card dispute chip if visible (tenant mode)
  const _tenantChip = document.querySelector('.tp-property-meta .tp-meta-item.tp-dispute-count--open, .tp-property-meta .tp-meta-item[class*="dispute"]');
  if (_tenantChip) {
    const _oc = disputes.filter(d => d.status === 'open').length;
    _tenantChip.textContent = `${_oc} open dispute${_oc !== 1 ? 's' : ''}`;
    _tenantChip.classList.add('tp-dispute-count--open');
  }
  console.log('disputes[] after push:', disputes.length);

  console.log('[submitDispute] calling syncPortfolioEntry()...');
  await syncPortfolioEntry();

  console.log('[submitDispute] calling savePropertyData()... activePropId=', activePropId || 'NULL');
  if (window.ms_lastDisputeFlow) window.ms_lastDisputeFlow.saveAttempted = true;
  await savePropertyData(); // persist dispute to Supabase
  const _rds4 = (_props || []).find(q => q.id === activePropId);
  if (_rds4) rebuildDerivedState(_rds4);

  const _sdPropAfter = currentProperty();
  const _sdSaveOk    = !!activePropId && !!_sdPropAfter;
  console.log('[submitDispute] savePropertyData() returned | propId:', activePropId || 'NULL', '| save likely succeeded:', _sdSaveOk);
  if (window.ms_lastDisputeFlow) {
    window.ms_lastDisputeFlow.saveResult = _sdSaveOk ? 'ok' : 'skipped-no-propid';
    if (!_sdSaveOk) window.ms_lastDisputeFlow.errors.push({ ts: new Date().toISOString(), where: 'submitDispute.savePropertyData', reason: 'activePropId null or prop not found' });
    _updateDisputeBadge();
  }
  console.groupEnd();

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

    const typeLabel = d.disputeType && _DISPUTE_TYPES[d.disputeType] ? `<span class="d-type-chip">${_DISPUTE_TYPES[d.disputeType].label}</span>` : '';
    const sevLabel  = d.severity && _DISPUTE_SEV[d.severity] ? `<span class="d-sev-chip ${_DISPUTE_SEV[d.severity].cls}">${_DISPUTE_SEV[d.severity].label}</span>` : '';
    return `
      <div class="dispute-card${isResolved ? ' resolved' : ''}">
        <div class="d-meta">#${d.id + 1} · ${esc(d.tenantName)} · ${fmtTs(d.timestamp)}${typeLabel}${sevLabel}</div>
        <div class="d-title">${esc(d.vendor)} (${esc(d.category)}) — ${fmt(d.tenantShare)}</div>
        <div class="d-reason">"${esc(d.reason)}"</div>
        ${docHtml}
        ${actionsHtml}
        <button class="dw-open-btn" onclick="openDisputeWorkspace(${d.id})">&#x1F4CB; Open Workspace</button>
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

// Updates all live dispute count surfaces from the canonical disputes[] array.
// Call after any mutation to disputes[] (submit, resolve).
function _refreshDisputeCountUI() {
  const openCount = disputes.filter(d => d.status === 'open').length;
  const pKpi = document.getElementById('pKpiDisputes');
  if (pKpi) {
    pKpi.textContent = openCount;
    pKpi.style.color = openCount > 0 ? '#f87171' : '#C9973A';
  }
  const badge = document.getElementById('openDisputeHeadBadge');
  if (badge) badge.textContent = openCount > 0 ? `${openCount} Open` : '';
}

// Patches the per-tenant dispute pill in the CAM report table for one tenant name.
// Mirrors the template at renderReport() lines 10527-10529 — keep in sync if that changes.
function _refreshTenantDisputeBadge(tenantName) {
  if (!tenantName) return;
  const dc = disputes.filter(d => d.tenantName === tenantName).length;
  const oc = disputes.filter(d => d.tenantName === tenantName && d.status === 'open').length;
  const row = document.querySelector(`tr[data-tenant-name="${CSS.escape(tenantName)}"]`);
  if (!row) return;
  const td = row.cells[3];
  if (!td) return;
  td.innerHTML = dc > 0
    ? `<span class="rpt-pill ${oc > 0 ? 'open' : 'closed'}">${dc} (${oc} open)</span>`
    : '—';
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
  if (!d.history) d.history = [];
  d.history.push({
    action:     resolution === 'docs_requested' ? 'docs_requested' : 'resolved',
    by:         'Reviewer',
    at:         d.resolvedAt,
    fromStatus: 'open',
    toStatus:   resolution,
  });
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
    { const _prop = currentProperty();
      if (_prop) appendPropertyTimelineEvent(_prop, { type: 'dispute_resolved', severity: isDocsReq ? 'warning' : 'success',
        actor: 'Landlord', title: evTitle,
        description: d.reason || '',
        metadata: { disputeId: id, resolution, vendor: d.vendor },
        relatedDisputeIds: [id] }); }
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
  _refreshDisputeCountUI();
  syncPortfolioEntry();
}

// ─── Dispute Workspace ────────────────────────────────────────────────────────

function openDisputeWorkspace(disputeId) {
  const el = document.getElementById('disputeWorkspace');
  if (!el) return;
  _dwActiveDid = disputeId;
  _dwRenderAll(disputeId);
  el.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closeDisputeWorkspace() {
  const el = document.getElementById('disputeWorkspace');
  if (el) el.style.display = 'none';
  document.body.style.overflow = '';
  _dwActiveDid = null;
}

function _dwFmtTs(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }); }
  catch (e) { return iso; }
}

function _dwRenderAll(disputeId) {
  const d    = disputes.find(x => x.id === disputeId);
  const body = document.getElementById('dwBody');
  if (!d || !body) return;

  const typeInfo = _DISPUTE_TYPES[d.disputeType] || null;
  const sevInfo  = _DISPUTE_SEV[d.severity || 'medium'] || _DISPUTE_SEV.medium;
  const isOpen   = d.status === 'open';
  const statusMap = { open: 'Open', accepted: 'Accepted', rejected: 'Rejected', docs_requested: 'Docs Requested' };
  const statusCls = { open: 'dw-status-open', accepted: 'dw-status-accepted', rejected: 'dw-status-rejected', docs_requested: 'dw-status-docs' };

  const typeOptions = Object.entries(_DISPUTE_TYPES)
    .map(([k, v]) => `<option value="${k}"${d.disputeType === k ? ' selected' : ''}>${esc(v.label)}</option>`).join('');
  const sevOptions = Object.entries(_DISPUTE_SEV)
    .map(([k, v]) => `<option value="${k}"${(d.severity || 'medium') === k ? ' selected' : ''}>${esc(v.label)}</option>`).join('');

  const histHtml = (d.history || []).length ? (d.history || []).map(h => `
    <div class="dw-hist-entry">
      <div class="dw-hist-dot"></div>
      <div class="dw-hist-body">
        <div class="dw-hist-action">${esc(h.action || '')}${h.fromStatus && h.toStatus ? ` <span class="dw-hist-arrow">${esc(h.fromStatus)} &#x2192; ${esc(h.toStatus)}</span>` : ''}</div>
        <div class="dw-hist-meta">${esc(h.by || '')} &middot; ${_dwFmtTs(h.at)}</div>
        ${h.note ? `<div class="dw-hist-note">&ldquo;${esc(h.note)}&rdquo;</div>` : ''}
      </div>
    </div>`).join('') : '<div class="dw-hist-empty">No history recorded yet.</div>';

  const resolveSection = isOpen ? `
    <div class="dw-section">
      <div class="dw-section-title">Resolve Dispute</div>
      <textarea id="dwResolveNote-${d.id}" class="dw-note-input" rows="2" placeholder="Resolution note (optional)…"></textarea>
      <div class="dw-resolve-btns">
        <button class="dw-res-btn dw-res-accept" onclick="_dwResolveWithNote(${d.id},'accepted')">&#x2705; Accept</button>
        <button class="dw-res-btn dw-res-reject" onclick="_dwResolveWithNote(${d.id},'rejected')">&#x274C; Reject</button>
        <button class="dw-res-btn dw-res-docs"   onclick="_dwResolveWithNote(${d.id},'docs_requested')">&#x1F4C4; Request Docs</button>
      </div>
    </div>` : `
    <div class="dw-resolved-banner dw-resolved-${d.status}">
      ${d.status === 'accepted' ? '&#x2705; Accepted' : d.status === 'rejected' ? '&#x274C; Rejected' : '&#x1F4C4; Docs Requested'} &middot; ${_dwFmtTs(d.resolvedAt)}
    </div>`;

  body.innerHTML = `
    <div class="dw-meta-strip">
      <span class="dw-badge ${statusCls[d.status] || 'dw-status-open'}">${statusMap[d.status] || esc(d.status)}</span>
      ${typeInfo ? `<span class="dw-type-badge">${esc(typeInfo.label)}</span>` : ''}
      <span class="dw-sev-badge ${sevInfo.cls}">${sevInfo.label}</span>
      <span class="dw-meta-id">#${d.id + 1} &middot; ${_dwFmtTs(d.timestamp)}</span>
    </div>

    <div class="dw-detail-grid">
      <div class="dw-detail-item"><div class="dw-lbl">Tenant</div><div class="dw-val">${esc(d.tenantName || '—')}</div></div>
      <div class="dw-detail-item"><div class="dw-lbl">Vendor</div><div class="dw-val">${esc(d.vendor || '—')}</div></div>
      <div class="dw-detail-item"><div class="dw-lbl">Category</div><div class="dw-val">${esc(d.category || '—')}</div></div>
      <div class="dw-detail-item"><div class="dw-lbl">Disputed Amount</div><div class="dw-val dw-amount">${d.tenantShare != null ? fmt(parseFloat(d.tenantShare)) : '—'}</div></div>
    </div>

    <div class="dw-section">
      <div class="dw-section-title">Tenant Reason</div>
      <div class="dw-reason-box">&ldquo;${esc(d.reason || '—')}&rdquo;</div>
    </div>

    ${isOpen ? `
    <div class="dw-section">
      <div class="dw-section-title">Classify Dispute</div>
      <div class="dw-classify-row">
        <div class="dw-field">
          <label class="dw-field-lbl">Dispute Type</label>
          <select class="dw-select" onchange="_dwSaveType(${d.id},this.value)">
            <option value="">— Select type —</option>
            ${typeOptions}
          </select>
        </div>
        <div class="dw-field">
          <label class="dw-field-lbl">Severity</label>
          <select class="dw-select" onchange="_dwSaveSeverity(${d.id},this.value)">${sevOptions}</select>
        </div>
      </div>
    </div>` : ''}

    <div class="dw-section">
      <div class="dw-section-title">Reviewer Notes</div>
      <textarea id="dwNote-${d.id}" class="dw-note-input" rows="3" placeholder="Internal reviewer notes (not shared with tenant)…">${esc(d.reviewerNote || '')}</textarea>
      ${isOpen ? `<button class="dw-save-btn" onclick="_dwSaveNote(${d.id})">Save Note</button>` : ''}
    </div>

    <div class="dw-section">
      <div class="dw-section-title">Lease Clause Reference</div>
      <textarea id="dwClause-${d.id}" class="dw-note-input" rows="2" placeholder="Paste relevant lease clause or section reference…">${esc(d.leaseClause || '')}</textarea>
      ${isOpen ? `<button class="dw-save-btn" onclick="_dwSaveLeaseClause(${d.id})">Save Clause</button>` : ''}
    </div>

    <div class="dw-section">
      <div class="dw-section-title">AI Dispute Explanation</div>
      <div id="dwAiExpl-${d.id}" class="dw-ai-box">
        <div class="dw-ai-hint">Generates a neutral analysis covering financial impact, lease logic, and recommended resolution path.</div>
        <button class="dw-ai-btn" onclick="aiExplainDispute(${d.id})">&#x2728; Generate Explanation</button>
      </div>
    </div>

    ${resolveSection}

    <div class="dw-section">
      <div class="dw-section-title">Resolution History</div>
      <div class="dw-history">${histHtml}</div>
    </div>

    <div class="dw-section">
      <div class="dw-section-title">Export</div>
      <div class="dw-export-row">
        <button class="dw-export-btn" onclick="generateDisputePacket(${d.id})">&#x1F4C4; Dispute Packet</button>
      </div>
    </div>`;

  const titleEl    = document.getElementById('dwTitle');
  const subtitleEl = document.getElementById('dwSubtitle');
  if (titleEl)    titleEl.textContent    = `Dispute #${d.id + 1} — ${d.vendor || 'Unknown vendor'}`;
  if (subtitleEl) subtitleEl.textContent = `${d.tenantName || ''} · ${d.category || ''} · ${d.tenantShare != null ? fmt(parseFloat(d.tenantShare)) : '—'}`;
}

function _dwSaveType(disputeId, typeKey) {
  const d = disputes.find(x => x.id === disputeId);
  if (!d) return;
  d.disputeType = typeKey || null;
  if (!d.history) d.history = [];
  d.history.push({ action: 'type_assigned', by: 'Reviewer', at: new Date().toISOString(), note: typeKey ? (_DISPUTE_TYPES[typeKey]?.label || typeKey) : 'type cleared' });
  logActivity('dispute_type_set', `Dispute #${d.id + 1} type set — ${_DISPUTE_TYPES[typeKey]?.label || typeKey || 'cleared'}`, {
    severity: 'info', actor: 'Reviewer', relatedEntity: d.tenantName || '',
    detail: `Dispute: ${d.vendor || '(no vendor)'}`,
  });
  savePropertyData();
}

function _dwSaveSeverity(disputeId, sev) {
  const d = disputes.find(x => x.id === disputeId);
  if (!d) return;
  d.severity = sev;
  if (!d.history) d.history = [];
  d.history.push({ action: 'severity_set', by: 'Reviewer', at: new Date().toISOString(), note: sev });
  logActivity('dispute_severity_set', `Dispute #${d.id + 1} severity → ${_DISPUTE_SEV[sev]?.label || sev}`, {
    severity: 'info', actor: 'Reviewer', relatedEntity: d.tenantName || '',
    detail: `Dispute: ${d.vendor || '(no vendor)'}`,
  });
  savePropertyData();
  showToast(`Severity set to ${_DISPUTE_SEV[sev]?.label || sev}`);
}

function _dwSaveNote(disputeId) {
  const d  = disputes.find(x => x.id === disputeId);
  const el = document.getElementById(`dwNote-${disputeId}`);
  if (!d || !el) return;
  d.reviewerNote = el.value.trim() || null;
  if (!d.history) d.history = [];
  if (d.reviewerNote) {
    d.history.push({ action: 'note_added', by: 'Reviewer', at: new Date().toISOString(), note: d.reviewerNote.slice(0, 120) });
    logActivity('dispute_note_added', `Reviewer note added — Dispute #${d.id + 1}`, {
      severity: 'info', actor: 'Reviewer', relatedEntity: d.tenantName || '',
      detail: d.reviewerNote.slice(0, 120),
    });
  }
  savePropertyData();
  showToast('Note saved.');
}

function _dwSaveLeaseClause(disputeId) {
  const d  = disputes.find(x => x.id === disputeId);
  const el = document.getElementById(`dwClause-${disputeId}`);
  if (!d || !el) return;
  d.leaseClause = el.value.trim() || null;
  if (!d.history) d.history = [];
  if (d.leaseClause) {
    d.history.push({ action: 'clause_attached', by: 'Reviewer', at: new Date().toISOString(), note: d.leaseClause.slice(0, 100) });
    logActivity('dispute_clause_attached', `Lease clause attached — Dispute #${d.id + 1}`, {
      severity: 'info', actor: 'Reviewer', relatedEntity: d.tenantName || '',
      detail: d.leaseClause.slice(0, 100),
    });
  }
  savePropertyData();
  showToast('Lease clause saved.');
}

async function _dwResolveWithNote(disputeId, resolution) {
  const d    = disputes.find(x => x.id === disputeId);
  if (!d || d.status !== 'open') return;
  const note = (document.getElementById(`dwResolveNote-${disputeId}`)?.value || '').trim();
  if (note) {
    if (!d.history) d.history = [];
    d.history.push({ action: 'resolution_note', by: 'Reviewer', at: new Date().toISOString(), note });
  }
  await resolveDispute(disputeId, resolution);
  _dwRenderAll(disputeId);
}

// Creates a dispute from a reconciliation issue flag and opens the workspace.
function openDisputeFromFlag(flagIdx) {
  const flag = _lastReconIssues[flagIdx];
  if (!flag) return;

  const typeKeyMap = [
    [/expired lease/i,  'expired_lease_billing'],
    [/cap applied/i,    'cam_cap_violation'],
    [/pro-rata/i,       'allocation_mismatch'],
    [/gross-lease/i,    'excluded_expense'],
    [/admin fee/i,      'admin_fee_violation'],
    [/duplicate/i,      'duplicate_billing'],
  ];
  const typeKey = (typeKeyMap.find(([rx]) => rx.test(flag.title)) || [])[1] || null;

  const tenantMatch = flag.title.match(/—\s*([^(—\n]+?)(?:\s*\(|\s*$)/);
  const tenantName  = tenantMatch ? tenantMatch[1].trim() : '';

  const exposureLine = (flag.conditions || []).find(c => /Allocated|Final charge|Shared CAM/i.test(c));
  const exposureM    = exposureLine ? exposureLine.match(/\$([\d,]+\.?\d*)/) : null;
  const exposure     = exposureM ? parseFloat(exposureM[1].replace(/,/g, '')) : 0;

  const now = new Date().toISOString();
  const did = nextDisputeId++;
  disputes.push({
    id:          did,
    tenantName,
    invoiceId:   `flag-${flagIdx}`,
    vendor:      '—',
    category:    'reconciliation',
    tenantShare: exposure,
    reason:      flag.title,
    docName:     null,
    timestamp:   now,
    status:      'open',
    resolution:  null, resolvedAt: null, hash: null,
    disputeType: typeKey,
    severity:    flag.severity === 'red' ? 'high' : 'medium',
    reviewerNote: null, leaseClause: null,
    history:     [{ action: 'opened', by: 'System', at: now, note: `Auto-opened from reconciliation flag: ${flag.title}` }],
  });

  logActivity('dispute_opened', `Dispute opened from reconciliation issue`, {
    severity: 'warning', actor: 'System', relatedEntity: tenantName || lastPropName || 'Property',
    detail: flag.title, financialImpact: exposure > 0 ? fmt(exposure) : '',
  });

  savePropertyData();
  renderOpenDisputes();
  openDisputeWorkspace(did);
}

// AI-powered dispute explanation via the existing explainFetch infrastructure.
async function aiExplainDispute(disputeId) {
  const d   = disputes.find(x => x.id === disputeId);
  const box = document.getElementById(`dwAiExpl-${disputeId}`);
  if (!d || !box) return;

  const btn = box.querySelector('.dw-ai-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Generating…'; }

  const propName  = lastPropName || currentProperty()?.name || 'this property';
  const camYear   = getCamYear() || new Date().getFullYear();
  const typeLabel = _DISPUTE_TYPES[d.disputeType]?.label || d.disputeType || 'General';

  const prompt = `You are a CAM reconciliation expert reviewing a tenant dispute for ${propName} (${camYear} CAM year).

Dispute:
- Type: ${typeLabel}
- Tenant: ${d.tenantName || 'Unknown'}
- Vendor: ${d.vendor || '—'}
- Category: ${d.category || '—'}
- Disputed amount: ${d.tenantShare != null ? '$' + parseFloat(d.tenantShare).toFixed(2) : 'unknown'}
- Tenant reason: "${d.reason || '—'}"${d.leaseClause ? `\n- Lease clause: "${d.leaseClause}"` : ''}

Provide a brief analysis covering:
1. Why this was flagged and what it means
2. Financial impact
3. Relevant lease logic
4. Recommended resolution path

Be neutral, practical, factual. Use markdown.`;

  try {
    const data = await explainFetch({
      model:      MODEL,
      max_tokens: 700,
      system:     'You are a CAM reconciliation expert. Provide concise, neutral dispute analysis. Focus on lease compliance, financial exposure, and resolution paths. Use markdown with headers and bullet points.',
      messages:   [{ role: 'user', content: prompt }],
    });
    const text = data?.content?.[0]?.text || '';
    box.innerHTML = text
      ? `<div class="dw-ai-content">${renderMarkdown(text)}</div>`
      : `<div class="dw-ai-content">${_buildStaticDisputeExplanation(d)}</div>`;
  } catch (e) {
    box.innerHTML = `<div class="dw-ai-content">${_buildStaticDisputeExplanation(d)}</div>`;
  }
}

// Static fallback explanation when AI is unavailable.
function _buildStaticDisputeExplanation(d) {
  const amt       = d.tenantShare != null ? fmt(parseFloat(d.tenantShare)) : 'unknown';
  const vendor    = esc(d.vendor || 'this vendor');
  const cat       = esc(d.category || 'general');
  const explanations = {
    cam_cap_violation:     `<strong>CAM Cap Violation</strong><br>The charge of ${amt} may exceed the contractual CAM cap. Review the cap base amount and percentage in the lease and confirm the final charge is at or below the permitted ceiling before issuing the statement.`,
    excluded_expense:      `<strong>Excluded Expense</strong><br>The tenant's lease may exclude this ${cat} expense from their CAM obligation. Review the exclusion clause and confirm whether ${vendor} charges in this category are recoverable under the lease.`,
    duplicate_billing:     `<strong>Duplicate Billing</strong><br>The charge of ${amt} from ${vendor} may appear more than once. Pull all invoices from this vendor and confirm each entry represents a distinct service period before including in the CAM pool.`,
    allocation_mismatch:   `<strong>Allocation Mismatch</strong><br>The tenant's pro-rata share may not match lease terms. Verify the square footage used matches the lease exhibit and confirm the property total sqft is correct.`,
    expired_lease_billing: `<strong>Expired Lease Billing</strong><br>This tenant's lease may have expired during the CAM year. Confirm current occupancy status and whether a holdover or renewal extends CAM obligations past the original end date.`,
    admin_fee_violation:   `<strong>Admin Fee Violation</strong><br>The management fee included in CAM may exceed the lease-permitted percentage. Locate the fee cap provision and confirm the charged rate is within bounds.`,
    unsupported_invoice:   `<strong>Unsupported Invoice</strong><br>The invoice from ${vendor} for ${amt} may lack adequate documentation. Request itemized backup before including this charge in any tenant billing.`,
  };
  return explanations[d.disputeType] || `<strong>Dispute Analysis</strong><br>Tenant disputes a ${cat} charge of ${amt} from ${vendor}. Review the relevant lease clauses, source invoices, and pro-rata calculations before responding.`;
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

  // ── Structural reconciliation issues (caps, expired leases, pro-rata gaps, lease-type) ──
  {
    const reconIssues = _detectReconciliationIssues(lastResults, currentProperty());
    reconIssues.forEach(f => (f.severity === 'red' ? red : yellow).push(f));
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

  let html = '';
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
      <div class="rpt-exp-section">Amendments</div>
      <div class="rpt-exp-amend-bar">
        ${td && td.amendments && td.amendments.length > 0
          ? `<span class="rpt-exp-amend-count">${td.amendments.length} amendment${td.amendments.length > 1 ? 's' : ''} on file</span>`
          : '<span class="rpt-exp-amend-none">No amendments uploaded</span>'}
        ${td ? `<button class="rpt-exp-amend-btn" onclick="openAmendmentUpload('${esc(td.id || '')}')">+ Add Amendment</button>` : ''}
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

// ─── Dispute Packet Report ────────────────────────────────────────────────────

function generateDisputePacket(disputeId) {
  const d = disputes.find(x => x.id === disputeId);
  if (!d) { showToast('Dispute not found.', { color: '#92400e', textColor: '#fef3c7' }); return; }
  try {
  logActivity('dispute_packet', `Dispute packet generated — #${d.id + 1}`, { severity: 'info', actor: 'User', relatedEntity: d.tenantName || '' });

  const propName  = lastPropName || currentProperty()?.name || 'Property';
  const camYear   = getCamYear() || new Date().getFullYear();
  const now       = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const typeLabel = d.disputeType && _DISPUTE_TYPES[d.disputeType] ? _DISPUTE_TYPES[d.disputeType].label : 'General Dispute';
  const sevLabel  = d.severity && _DISPUTE_SEV[d.severity] ? _DISPUTE_SEV[d.severity].label : 'Medium';

  const statusMap = { open: 'Open', accepted: 'Accepted', rejected: 'Rejected', docs_requested: 'Documentation Requested' };

  function fmtTs(iso) {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }); }
    catch (e) { return iso; }
  }

  // Find related reconciliation result for calculation breakdown
  const recon   = lastResults.find(r => r.name === d.tenantName) || null;
  const liveT   = tenantData.find(t => t && t.tenant_name === d.tenantName) || null;
  const calcSt  = recon ? _deriveCalcState(recon, liveT) : null;

  const calcBreakdown = recon ? `
    <div class="rpt-section-title">Calculation Breakdown</div>
    <table class="rpt-table">
      <tbody>
        <tr><td>Square Footage</td><td style="text-align:right">${recon.sqFt ? Number(recon.sqFt).toLocaleString() : '—'} sqft</td></tr>
        <tr><td>Pro-Rata Share</td><td style="text-align:right">${(recon.proRata * 100).toFixed(2)}%</td></tr>
        <tr><td>Raw Allocation</td><td style="text-align:right">${fmt(recon.capApplied ? recon.totalAllocated + recon.capAdjustment : recon.totalAllocated)}</td></tr>
        ${recon.capApplied ? `<tr><td>Cap Reduction</td><td style="text-align:right;color:#fb923c;">−${fmt(recon.capAdjustment)}</td></tr>` : ''}
        <tr class="total-row"><td>Final CAM Charge</td><td style="text-align:right">${fmt(recon.totalAllocated)}</td></tr>
        ${calcSt ? `<tr><td>Calculation State</td><td style="text-align:right"><span class="rc-calc-state ${calcSt.cls}">${calcSt.label}</span></td></tr>` : ''}
      </tbody>
    </table>` : '';

  // Related invoices
  const relatedInvs = d.invoiceId && d.invoiceId.startsWith('inv-')
    ? (() => {
        const idx = parseInt(d.invoiceId.replace('inv-', ''), 10);
        const inv = lastInvoicesFull[idx];
        return inv ? [inv] : [];
      })()
    : (lastInvoicesFull || []).filter(inv =>
        (inv.vendor || inv.vendorName || '').toLowerCase() === (d.vendor || '').toLowerCase()
      ).slice(0, 5);

  const invRows = relatedInvs.map(inv => `
    <tr>
      <td>${esc(inv.vendor || inv.vendorName || '—')}</td>
      <td>${esc(inv.invoiceDate || '—')}</td>
      <td style="text-align:right">${fmt(inv.amount)}</td>
      <td>${esc(inv.category || '—')}</td>
    </tr>`).join('');

  const histRows = (d.history || []).map(h => `
    <tr>
      <td>${fmtTs(h.at)}</td>
      <td>${esc(h.action || '—')}</td>
      <td>${esc(h.by || '—')}</td>
      <td>${esc(h.note || '—')}</td>
    </tr>`).join('');

  const html = `
    ${_rptHeader(propName, 'Dispute Packet', camYear + ' CAM Year', now, [
      { label: 'Dispute #',   value: d.id + 1 },
      { label: 'Status',      value: statusMap[d.status] || d.status },
      { label: 'Type',        value: typeLabel },
      { label: 'Severity',    value: sevLabel },
    ])}

    <div class="rpt-kpi-row">
      <div class="rpt-kpi"><div class="kpi-val">${esc(d.tenantName || '—')}</div><div class="kpi-lbl">Tenant</div></div>
      <div class="rpt-kpi"><div class="kpi-val">${esc(d.vendor || '—')}</div><div class="kpi-lbl">Vendor</div></div>
      <div class="rpt-kpi"><div class="kpi-val">${esc(d.category || '—')}</div><div class="kpi-lbl">Category</div></div>
      <div class="rpt-kpi"><div class="kpi-val">${d.tenantShare != null ? fmt(parseFloat(d.tenantShare)) : '—'}</div><div class="kpi-lbl">Disputed Amount</div></div>
    </div>

    <div class="rpt-section-title">Tenant Reason</div>
    <div class="rpt-narrative-box">&ldquo;${esc(d.reason || '—')}&rdquo;</div>

    ${d.leaseClause ? `
    <div class="rpt-section-title">Lease Clause Reference</div>
    <div class="rpt-narrative-box rpt-clause-box">${esc(d.leaseClause)}</div>` : ''}

    ${d.reviewerNote ? `
    <div class="rpt-section-title">Reviewer Notes</div>
    <div class="rpt-narrative-box">${esc(d.reviewerNote)}</div>` : ''}

    ${calcBreakdown}

    ${invRows ? `
    <div class="rpt-section-title">Supporting Invoices</div>
    <table class="rpt-table">
      <thead><tr><th>Vendor</th><th>Date</th><th style="text-align:right">Amount</th><th>Category</th></tr></thead>
      <tbody>${invRows}</tbody>
    </table>` : ''}

    ${histRows ? `
    <div class="rpt-section-title">Resolution History</div>
    <table class="rpt-table">
      <thead><tr><th>Date</th><th>Action</th><th>By</th><th>Note</th></tr></thead>
      <tbody>${histRows}</tbody>
    </table>` : ''}

    ${d.hash ? `
    <div class="rpt-section-title">Audit Integrity</div>
    <div class="rpt-hash-box">
      <div class="rpt-hash-lbl">&#x1F517; On-Chain Dispute Hash</div>
      <div class="rpt-hash-val">${d.hash}</div>
    </div>` : ''}

    ${_rptFooter(propName, 'Dispute Packet', now)}`;

  openReport(`Dispute Packet — #${d.id + 1} ${d.tenantName || ''}`, html);
  } catch (e) {
    logError('generateDisputePacket', e, { disputeId });
    showToast('Could not generate dispute packet.', { color: '#92400e', textColor: '#fef3c7' });
  }
}

// ─── Landlord Risk Export ─────────────────────────────────────────────────────

function generateLandlordExport() {
  if (!lastResults.length) { showToast('Run a CAM allocation first.', { color: '#92400e', textColor: '#fef3c7' }); return; }
  try {
  const _expProp = currentProperty();
  if (_expProp) rebuildDerivedState(_expProp); // ensure cached metrics are fresh before export
  const _expDm = _expProp ? (derivePropertyMetrics(_expProp) || {}) : {};
  logActivity('landlord_export', 'Landlord Risk Export generated', { severity: 'info', actor: 'User', relatedEntity: lastPropName || 'Property' });
  { if (_expProp) appendPropertyTimelineEvent(_expProp, { type: 'export_generated', severity: 'info',
      actor: 'User', title: 'Landlord Risk Export generated',
      metadata: { exportType: 'landlord_risk', propName: lastPropName || 'Property' } }); }
  const propName   = lastPropName || 'Property';
  const now        = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const period     = (getCamYear() || new Date().getFullYear()) + ' CAM Year';
  const openD      = disputes.filter(d => d.status === 'open');
  const exposure   = openD.reduce((s, d) => s + (parseFloat(d.tenantShare) || 0), 0);
  const reconIss   = _detectReconciliationIssues(lastResults, currentProperty());
  const redIss     = reconIss.filter(f => f.severity === 'red');
  const yellowIss  = reconIss.filter(f => f.severity === 'yellow');
  const invSusp    = _detectInvoiceSuspicions(invoiceData.filter(inv => inv && inv.vendorName));
  const redSusp    = invSusp.filter(f => f.severity === 'red');
  const proRataSum = lastResults.reduce((s, r) => s + (r.proRataPercent || 0), 0);

  const issueRows = [...redIss, ...yellowIss].map(f => `<tr>
    <td><span style="color:${f.severity === 'red' ? '#f87171' : '#fbbf24'}">${f.severity === 'red' ? '⛔' : '⚠'}</span></td>
    <td>${esc(f.title)}</td>
  </tr>`).join('');

  const disputeRows = openD.map(d => `<tr>
    <td>#${d.id + 1}</td>
    <td>${esc(d.tenantName || '—')}</td>
    <td>${esc(d.vendor || '—')} (${esc(d.category || '—')})</td>
    <td style="text-align:right">${d.tenantShare != null ? fmt(parseFloat(d.tenantShare)) : '—'}</td>
    <td>${d.disputeType ? esc(_DISPUTE_TYPES[d.disputeType]?.label || d.disputeType) : '—'}</td>
    <td>${d.severity ? esc(_DISPUTE_SEV[d.severity]?.label || d.severity) : 'Medium'}</td>
  </tr>`).join('');

  const tenantRows = lastResults.map(r => {
    const liveT  = tenantData.find(t => t && t.id === r.tenantId);
    const calcSt = _deriveCalcState(r, liveT);
    const flagCnt = (r.ambiguityFlags || []).length;
    return `<tr>
      <td>${esc(r.name)}</td>
      <td style="text-align:right">${fmt(r.totalAllocated)}</td>
      <td style="text-align:right">${(r.proRata * 100).toFixed(2)}%</td>
      <td><span class="rc-calc-state ${calcSt.cls}">${calcSt.label}</span></td>
      <td style="text-align:center">${flagCnt > 0 ? `<span style="color:#fbbf24">${flagCnt}</span>` : '—'}</td>
    </tr>`;
  }).join('');

  const _expTotalCAM = _expDm.financialStats?.totalCAM ?? lastTotal;
  const _expOpenDisp = _expDm.disputeStats?.openDisputes ?? openD.length;
  const html = `
    ${_rptHeader(propName, 'Landlord Risk Export', period, now, [
      { label: 'Total CAM',   value: fmt(_expTotalCAM) },
      { label: 'Open Disputes', value: _expOpenDisp },
      { label: 'Exposure',    value: fmt(exposure) },
    ])}

    <div class="rpt-kpi-row">
      <div class="rpt-kpi${redIss.length > 0 ? ' rpt-kpi--alert' : ''}"><div class="kpi-val">${redIss.length}</div><div class="kpi-lbl">Critical Issues</div></div>
      <div class="rpt-kpi${yellowIss.length > 0 ? ' rpt-kpi--warn' : ''}"><div class="kpi-val">${yellowIss.length}</div><div class="kpi-lbl">Warnings</div></div>
      <div class="rpt-kpi${openD.length > 0 ? ' rpt-kpi--warn' : ''}"><div class="kpi-val">${openD.length}</div><div class="kpi-lbl">Open Disputes</div></div>
      <div class="rpt-kpi${exposure > 0 ? ' rpt-kpi--alert' : ''}"><div class="kpi-val">${fmt(exposure)}</div><div class="kpi-lbl">Dispute Exposure</div></div>
      <div class="rpt-kpi${redSusp.length > 0 ? ' rpt-kpi--alert' : ''}"><div class="kpi-val">${redSusp.length}</div><div class="kpi-lbl">Invoice Red Flags</div></div>
      <div class="rpt-kpi${Math.abs(proRataSum - 100) > 5 ? ' rpt-kpi--alert' : ''}"><div class="kpi-val">${proRataSum.toFixed(1)}%</div><div class="kpi-lbl">Pro-Rata Sum</div></div>
    </div>

    ${(redIss.length + yellowIss.length) > 0 ? `
    <div class="rpt-section-title">Reconciliation Issues</div>
    <table class="rpt-table"><tbody>${issueRows}</tbody></table>` : ''}

    ${openD.length > 0 ? `
    <div class="rpt-section-title">Open Disputes — ${fmt(exposure)} Total Exposure</div>
    <table class="rpt-table">
      <thead><tr><th>#</th><th>Tenant</th><th>Charge</th><th style="text-align:right">Amount</th><th>Type</th><th>Severity</th></tr></thead>
      <tbody>${disputeRows}</tbody>
    </table>` : '<div class="rpt-section-title" style="color:#4ade80">&#x2713; No open disputes</div>'}

    <div class="rpt-section-title">Reconciliation Completeness by Tenant</div>
    <table class="rpt-table">
      <thead><tr><th>Tenant</th><th style="text-align:right">Allocated</th><th style="text-align:right">Pro-Rata</th><th>Calc State</th><th style="text-align:center">Flags</th></tr></thead>
      <tbody>${tenantRows}</tbody>
    </table>

    ${(() => {
      const tlItems = derivePropertyTimeline(_expProp || {}).recentActivity.slice(0, 15);
      const tlRows = tlItems.map(ev =>
        `<tr><td>${new Date(ev.timestamp).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' })}</td>
         <td><span style="color:${ev.severity==='critical'?'#f87171':ev.severity==='warning'?'#fbbf24':ev.severity==='success'?'#4ade80':'#818cf8'}">${ev.type}</span></td>
         <td>${esc(ev.title)}</td>
         <td>${esc(ev.actor||'')}</td></tr>`
      ).join('');
      return tlRows ? `
<div class="rpt-section-title">Property Audit Timeline (Recent)</div>
<table class="rpt-table">
  <thead><tr><th>Date</th><th>Event</th><th>Title</th><th>By</th></tr></thead>
  <tbody>${tlRows}</tbody>
</table>` : '';
    })()}
    ${_rptFooter(propName, 'Landlord Risk Export', now)}`;

  openReport('Landlord Risk Export — ' + propName, html);
  } catch (e) {
    logError('generateLandlordExport', e, { propName: lastPropName });
    showToast('Could not generate Landlord Risk Export.', { color: '#92400e', textColor: '#fef3c7' });
  }
}

function generateLeaseReviewPacketReport() {
  try {
    const prop = currentProperty();
    if (!prop) { showToast('Select a property first.', { color: '#92400e', textColor: '#fef3c7' }); return; }
    if (!window.LeaseReviewPackets) { showToast('Lease Review Packets module not loaded.', { color: '#92400e', textColor: '#fef3c7' }); return; }
    const packet = window.LeaseReviewPackets.generateLeaseReviewPacket(prop, { audience: 'landlord' });
    const html   = window.LeaseReviewPackets.formatReviewPacketHtml(packet);
    logActivity('lease_review_packet', 'Lease Review Packet generated', { severity: 'info', actor: 'User', relatedEntity: prop.name || 'Property' });
    openReport('Lease Review Packet — ' + (prop.name || 'Property'), html);
  } catch (e) {
    logError('generateLeaseReviewPacketReport', e, { propName: currentProperty()?.name });
    showToast('Could not generate Lease Review Packet.', { color: '#92400e', textColor: '#fef3c7' });
  }
}

function generateLenderSummaryReport() {
  try {
    const prop = currentProperty();
    if (!prop) { showToast('Select a property first.', { color: '#92400e', textColor: '#fef3c7' }); return; }
    if (!window.LeaseReviewPackets) { showToast('Lease Review Packets module not loaded.', { color: '#92400e', textColor: '#fef3c7' }); return; }
    const packet = window.LeaseReviewPackets.generateLeaseReviewPacket(prop, { audience: 'lender' });
    const html   = window.LeaseReviewPackets.formatReviewPacketHtml(packet);
    logActivity('lender_summary', 'Lender Summary generated', { severity: 'info', actor: 'User', relatedEntity: prop.name || 'Property' });
    openReport('Lender Summary — ' + (prop.name || 'Property'), html);
  } catch (e) {
    logError('generateLenderSummaryReport', e, { propName: currentProperty()?.name });
    showToast('Could not generate Lender Summary.', { color: '#92400e', textColor: '#fef3c7' });
  }
}

function generateTestLabBenchmarkReport() {
  try {
    if (!window.LeaseTestLab) { showToast('Test Lab module not loaded.', { type: 'error', duration: 3000 }); return; }
    const levels = ['easy', 'medium', 'hard', 'nightmare'];
    const suite  = window.LeaseTestLab.runSuite(levels);
    const stats  = window.LeaseTestLab.scoreSuite(suite);
    const html   = window.LeaseTestLab.generateBenchmarkReportHtml(suite, stats);
    logActivity('testlab_benchmark', 'Lease Intelligence Benchmark run', { severity: 'info', actor: 'User' });
    openReport('Lease Intelligence Benchmark — ' + new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }), html);
  } catch (e) {
    logError('generateTestLabBenchmarkReport', e);
    showToast('Benchmark error: ' + (e.message || 'unknown'), { type: 'error', duration: 4000 });
  }
}

// ─── CSV + JSON Exports ───────────────────────────────────────────────────────

function _downloadFile(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function exportReconciliationCSV() {
  if (!lastResults.length) { showToast('Run a CAM allocation first.', { color: '#92400e', textColor: '#fef3c7' }); return; }
  const rows = [
    ['Tenant', 'Unit', 'Sqft', 'Pro-Rata %', 'Cap Applied', 'Cap Reduction', 'Allocated', 'Invoices', 'Avg Confidence', 'Calc State', 'Flags'],
    ...lastResults.map(r => {
      const liveT  = tenantData.find(t => t && t.id === r.tenantId);
      const calcSt = _deriveCalcState(r, liveT);
      return [
        r.name, r.unitNumber || '', r.sqFt || '', (r.proRata * 100).toFixed(2),
        r.capApplied ? 'Yes' : 'No', r.capApplied ? (r.capAdjustment || 0).toFixed(2) : '',
        r.totalAllocated.toFixed(2), r.eligibleCount, r.averageConfidence,
        calcSt.label, (r.ambiguityFlags || []).map(f => f.code).join('; '),
      ];
    }),
  ];
  const csv = rows.map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  _downloadFile(csv, `cam-reconciliation-${lastPropName || 'export'}-${getCamYear() || new Date().getFullYear()}.csv`, 'text/csv');
  logActivity('csv_export', 'Reconciliation CSV exported', { severity: 'info', actor: 'User', relatedEntity: lastPropName || 'Property' });
}

function exportDisputesCSV() {
  if (!disputes.length) { showToast('No disputes to export.', { color: '#92400e', textColor: '#fef3c7' }); return; }
  const rows = [
    ['#', 'Tenant', 'Vendor', 'Category', 'Amount', 'Type', 'Severity', 'Status', 'Reason', 'Reviewer Note', 'Lease Clause', 'Opened', 'Resolved', 'Hash'],
    ...disputes.map(d => [
      d.id + 1, d.tenantName || '', d.vendor || '', d.category || '',
      d.tenantShare != null ? parseFloat(d.tenantShare).toFixed(2) : '',
      d.disputeType ? (_DISPUTE_TYPES[d.disputeType]?.label || d.disputeType) : '',
      d.severity ? (_DISPUTE_SEV[d.severity]?.label || d.severity) : 'Medium',
      d.status || '', d.reason || '', d.reviewerNote || '', d.leaseClause || '',
      d.timestamp || '', d.resolvedAt || '', d.hash || '',
    ]),
  ];
  const csv = rows.map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  _downloadFile(csv, `cam-disputes-${lastPropName || 'export'}.csv`, 'text/csv');
  logActivity('disputes_csv_export', 'Disputes CSV exported', { severity: 'info', actor: 'User', relatedEntity: lastPropName || 'Property' });
}

function exportAuditLog() {
  if (window.AccessControl && window.AuthService && !window.AccessControl.canExportAudit(window.AuthService.getCurrentUser())) return;
  const prop = currentProperty();
  const log  = {
    property:        lastPropName || prop?.name || 'Unknown',
    camYear:         getCamYear() || new Date().getFullYear(),
    exportedAt:      new Date().toISOString(),
    reconciliation:  lastResults.map(r => ({
      tenant: r.name, unit: r.unitNumber, sqFt: r.sqFt,
      proRata: r.proRataPercent, allocated: r.totalAllocated,
      capApplied: r.capApplied, capAdjustment: r.capAdjustment,
      calcState: _deriveCalcState(r, tenantData.find(t => t && t.id === r.tenantId))?.state,
      flags: (r.ambiguityFlags || []).map(f => f.code),
    })),
    tenantReviewState: tenantData.filter(Boolean).map(t => {
      const rv = deriveTenantReviewState(t);
      return {
        id: t.id, name: t.tenant_name,
        reviewState:       rv.status,
        reviewScore:       rv.score,
        reviewerConfirmed: rv.reviewerConfirmed,
        reviewedAt:        rv.reviewedAt,
        reviewedBy:        rv.reviewedBy,
        notes:             rv.notes,
        reviewHistory:     t.review?.history || [],
        overrideCount:     Object.keys(t.reviewOverrides || {}).length,
      };
    }),
    disputes:        disputes.map(d => ({ ...d, history: d.history || [] })),
    activityLog:     activityLog.slice(0, 200),
    reconIssues:     _detectReconciliationIssues(lastResults, prop),
    invoiceSuspicions: _detectInvoiceSuspicions(invoiceData.filter(inv => inv && inv.vendorName)),
  };
  _downloadFile(JSON.stringify(log, null, 2), `cam-audit-log-${lastPropName || 'export'}.json`, 'application/json');
  logActivity('audit_log_export', 'Audit log exported (JSON)', { severity: 'info', actor: 'User', relatedEntity: lastPropName || 'Property' });
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
          ? `<button class="btn-secondary" onclick="event.stopPropagation();openInvFileViewer('${stored.fileUrl.replace(/\\/g,'\\\\').replace(/'/g,"\\'")}','${esc(inv.vendor || inv.vendorName || '')}','${esc(stored.fileType || '')}')">&#x1F4C4; View Invoice</button>`
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
              <div class="ts-detail-formula">${fmt(inv.amount)} &times; ${pct}% = ${fmt(share)}</div>
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
  'dec00000-0000-4000-a000-000000000002', // Whole Health Market
  'dec00000-0000-4000-a000-000000000003', // Summit Coffee & Provisions
  'dec00000-0000-4000-a000-000000000004', // ProActive Physical Therapy
  'dec00000-0000-4000-a000-000000000005', // FitZone Athletics
  'dec00000-0000-4000-a000-000000000006', // Harbor Nail & Beauty Studio
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

// Ensures Cascade Commons exists in Supabase with complete seeded state.
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
    if (!error && row?.data?.camReconciliation?.results?.length > 0 && row?.data?._demoV === 2) {
      console.log('[ensureDemoProperty] already seeded v2 — skip');
      return DEMO_PROPERTY_ID;
    }
  } catch (_) { /* not found — fall through to seed */ }

  console.log('[ensureDemoProperty] seeding Cascade Commons v2…');

  // ── Demo data constants ───────────────────────────────────────────────────
  const PROP_NAME    = 'Cascade Commons';
  const PROP_SQFT    = 47500;
  const CAM_YEAR     = 2025;
  const DEMO_VERSION = 2;

  // capBaseAmount is prior-year CAM so that cap enforcement fires on this demo.
  const demoTenantConfigs = [
    {
      id: _DEMO_TENANT_IDS[0], tenant_name: 'Whole Health Market',
      leased_sqft: '9200', cap: '5', capBaseAmount: '33000',
      excluded_categories: '', audit_rights: '90 days from reconciliation',
      start_date: '2021-01-01', end_date: '2028-12-31', lease_type: 'NNN',
      admin_fee_pct: null,
      _confidenceScore: 94, _confidence: 'high',
      confidence: { tenantName:98, leasedSqft:97, capPercentage:95, leaseType:96 },
    },
    {
      id: _DEMO_TENANT_IDS[1], tenant_name: 'Summit Coffee & Provisions',
      leased_sqft: '1800', cap: '8', capBaseAmount: '6200',
      excluded_categories: 'parking',
      start_date: '2023-03-01', end_date: '2026-02-28', lease_type: 'NNN',
      admin_fee_pct: null,
      _confidenceScore: 91, _confidence: 'high',
      confidence: { tenantName:99, leasedSqft:98, capPercentage:93, excludedCategories:89 },
    },
    {
      id: _DEMO_TENANT_IDS[2], tenant_name: 'ProActive Physical Therapy',
      leased_sqft: '4400', cap: '6', capBaseAmount: '13000',
      excluded_categories: 'management', audit_rights: '45 days from reconciliation',
      start_date: '2022-07-01', end_date: '2027-06-30', lease_type: 'Modified Gross',
      admin_fee_pct: null,
      _confidenceScore: 88, _confidence: 'high',
      confidence: { tenantName:96, leasedSqft:95, capPercentage:91, excludedCategories:94, leaseType:90 },
    },
    {
      id: _DEMO_TENANT_IDS[3], tenant_name: 'FitZone Athletics',
      leased_sqft: '6800', cap: '4', capBaseAmount: '24000',
      excluded_categories: '',
      start_date: '2022-01-01', end_date: '2026-12-31', lease_type: 'NNN',
      admin_fee_pct: null,
      _confidenceScore: 96, _confidence: 'high',
      confidence: { tenantName:99, leasedSqft:97, capPercentage:94 },
    },
    {
      id: _DEMO_TENANT_IDS[4], tenant_name: 'Harbor Nail & Beauty Studio',
      leased_sqft: '1200', cap: null, capBaseAmount: null,
      excluded_categories: '',
      start_date: '2024-02-01', end_date: '2027-01-31', lease_type: 'NNN',
      admin_fee_pct: null,
      _confidenceScore: 97, _confidence: 'high',
      confidence: { tenantName:99, leasedSqft:98, leaseType:95 },
    },
  ];

  const demoInvoiceList = [
    // Insurance (annual)
    { vendorName: 'Meridian Property Insurance', amount: 42000, category: 'insurance',    invoiceDate: '2025-01-15' },
    // Landscaping
    { vendorName: 'Green Valley Landscape',      amount:  4800, category: 'landscaping',  invoiceDate: '2025-01-20' },
    // Q1 utilities
    { vendorName: 'Austin Energy',               amount:  7200, category: 'utilities',    invoiceDate: '2025-03-31' },
    // Q1 janitorial
    { vendorName: 'CleanSpace Commercial',       amount:  5200, category: 'janitorial',   invoiceDate: '2025-03-31' },
    // Q1 management
    { vendorName: 'Cascade Property Management', amount:  7600, category: 'management',   invoiceDate: '2025-03-31' },
    // Q1 security
    { vendorName: 'WatchPoint Security',         amount:  2850, category: 'security',     invoiceDate: '2025-03-31' },
    // Spring HVAC service
    { vendorName: 'ComfortFirst HVAC',           amount:  3400, category: 'maintenance',  invoiceDate: '2025-04-15' },
    // Parking lot repair
    { vendorName: 'PavePro Inc',                 amount:  5700, category: 'repairs',      invoiceDate: '2025-04-22' },
    // Spring landscaping surge
    { vendorName: 'Green Valley Landscape',      amount:  5200, category: 'landscaping',  invoiceDate: '2025-05-01' },
    // Signage & exterior lighting
    { vendorName: 'BrightPath Electrical',       amount:  3800, category: 'maintenance',  invoiceDate: '2025-05-15' },
    // Q2 utilities
    { vendorName: 'Austin Energy',               amount:  7800, category: 'utilities',    invoiceDate: '2025-06-30' },
    // Q2 janitorial
    { vendorName: 'CleanSpace Commercial',       amount:  5200, category: 'janitorial',   invoiceDate: '2025-06-30' },
    // Q2 management
    { vendorName: 'Cascade Property Management', amount:  7600, category: 'management',   invoiceDate: '2025-06-30' },
    // Q2 security
    { vendorName: 'WatchPoint Security',         amount:  2850, category: 'security',     invoiceDate: '2025-06-30' },
    // Summer landscaping
    { vendorName: 'Green Valley Landscape',      amount:  9000, category: 'landscaping',  invoiceDate: '2025-08-01' },
    // Q3 utilities (peak)
    { vendorName: 'Austin Energy',               amount:  8600, category: 'utilities',    invoiceDate: '2025-09-30' },
    // Q3 janitorial
    { vendorName: 'CleanSpace Commercial',       amount:  5200, category: 'janitorial',   invoiceDate: '2025-09-30' },
    // Q3 management
    { vendorName: 'Cascade Property Management', amount:  7600, category: 'management',   invoiceDate: '2025-09-30' },
    // Fall HVAC service
    { vendorName: 'ComfortFirst HVAC',           amount:  3200, category: 'maintenance',  invoiceDate: '2025-10-15' },
    // Q3 security
    { vendorName: 'WatchPoint Security',         amount:  2850, category: 'security',     invoiceDate: '2025-10-31' },
    // General repairs (multiple work orders)
    { vendorName: 'Cascade Handyman Services',   amount: 17100, category: 'repairs',      invoiceDate: '2025-10-31' },
    // Q4 utilities
    { vendorName: 'Austin Energy',               amount:  4900, category: 'utilities',    invoiceDate: '2025-12-31' },
    // Q4 janitorial
    { vendorName: 'CleanSpace Commercial',       amount:  5300, category: 'janitorial',   invoiceDate: '2025-12-31' },
    // Q4 management
    { vendorName: 'Cascade Property Management', amount:  7600, category: 'management',   invoiceDate: '2025-12-31' },
    // Q4 security
    { vendorName: 'WatchPoint Security',         amount:  2850, category: 'security',     invoiceDate: '2025-12-31' },
    // Emergency HVAC repair Nov
    { vendorName: 'ComfortFirst HVAC',           amount:  2900, category: 'maintenance',  invoiceDate: '2025-11-20' },
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
      t.cap ? parseFloat(t.cap) : null,
      t.capBaseAmount ? parseFloat(t.capBaseAmount) : null,
      false, null, t.lease_type || null
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

  const demoDisputes = [
    {
      id: 0,
      tenantName:  'FitZone Athletics',
      invoiceId:   'inv-7',
      vendor:      'PavePro Inc',
      category:    'repairs',
      tenantShare: parseFloat((5700 * (6800 / PROP_SQFT)).toFixed(2)),
      reason:      'Parking lot resurfacing appears to be a capital improvement, not routine maintenance. Tenant requested documentation per lease Section 9.1.',
      timestamp:   new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString(),
      status:      'accepted',
      resolution:  'Landlord provided work order confirming surface seal coat (maintenance, not capital). Charge accepted.',
      resolvedAt:  new Date(Date.now() - 22 * 24 * 60 * 60 * 1000).toISOString(),
      hash: null,
    },
    {
      id: 1,
      tenantName:  'Whole Health Market',
      invoiceId:   'inv-20',
      vendor:      'Cascade Handyman Services',
      category:    'repairs',
      tenantShare: parseFloat((17100 * (9200 / PROP_SQFT)).toFixed(2)),
      reason:      'Invoice references multiple unspecified work orders totaling $17,100. Tenant requests itemized receipts before approving CAM allocation.',
      timestamp:   new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
      status:      'docs_requested',
      resolution:  null, resolvedAt: null, hash: null,
    },
    {
      id: 2,
      tenantName:  'Summit Coffee & Provisions',
      invoiceId:   'inv-25',
      vendor:      'ComfortFirst HVAC',
      category:    'maintenance',
      tenantShare: parseFloat((2900 * (1800 / PROP_SQFT)).toFixed(2)),
      reason:      'Emergency HVAC repair appears to be outside common area scope. Requesting clarification on which unit was serviced.',
      timestamp:   new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
      status:      'open',
      resolution:  null, resolvedAt: null, hash: null,
    },
  ];

  // ── Persist to Supabase ───────────────────────────────────────────────────
  // invoicesFull is intentionally omitted (matches _stripBlobs convention);
  // on load it is re-hydrated from data.invoices via renderProperty.
  const propertyData = {
    _demoVersion:      DEMO_VERSION,
    invoices:          demoInvoiceList.map(inv => ({
      vendorName: inv.vendorName, amount: inv.amount,
      category: inv.category, invoiceDate: inv.invoiceDate,
    })),
    disputes:          demoDisputes,
    camYear:           CAM_YEAR,
    results:           null,
    camReconciliation: { ...camReconciliation, invoicesFull: undefined },
    _demoV:            2,
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

// Pure function — derives risk metadata from a stored property snapshot.
// Runs without globals so it can compute for any prop, not just the active one.
// Shim — delegates to Selectors (selectors.js)
function _buildPropMeta(prop) { return Selectors.buildPropMeta(prop); }

function _fmtCardTs(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ─── Review Queue ─────────────────────────────────────────────────────────────

// Shims — delegate to Selectors / ReviewEngine
function getReviewQueueItems(props) { return Selectors.getReviewQueueItems(props); }
function _rqUrgencyClass(score)     { return ReviewEngine.urgencyClass(score); }

function _rqItemHtml(item) {
  const acked = item.reviewerConfirmed;
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
  const nonAcked = allItems.filter(i => !i.reviewerConfirmed);

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

function markTenantReviewAcknowledged(tenantId, note = null) {
  // Find owning property — tenant may not be in the active tenantData array
  let ownerProp = null, ownerIdx = -1;
  for (const p of _props) {
    const idx = (p.tenants || []).findIndex(t => t && t.id === tenantId);
    if (idx !== -1) { ownerProp = p; ownerIdx = idx; break; }
  }
  if (!ownerProp) return;

  const prev    = ownerProp.tenants[ownerIdx];
  const prevRev = prev.review || {};
  const now     = new Date().toISOString();
  const histEntry = { action: 'approved', by: 'Manual Review', at: now, note: note || null };
  const updated = {
    ...prev,
    review: {
      ...prevRev,
      reviewerConfirmed: true,
      reviewedAt:        now,
      reviewedBy:        'Manual Review',
      history:           [...(prevRev.history || []), histEntry],
    },
  };
  ownerProp.tenants[ownerIdx] = updated;

  // Keep tenantData in sync if this is the active property
  if (ownerProp.id === activePropId) {
    const tdIdx = tenantData.findIndex(t => t && t.id === tenantId);
    if (tdIdx !== -1) tenantData[tdIdx] = updated;
  }

  logActivity('review_acknowledged', `Tenant review acknowledged — ${prev.tenant_name || tenantId}`, {
    severity: 'success', actor: 'Reviewer',
    relatedEntity: prev.tenant_name || tenantId,
    detail: note ? `Note: ${note}` : 'Marked as reviewed',
  });

  saveProperty(ownerProp); // async fire-and-forget — persists to localStorage + Supabase

  // Re-render the property queue so the card reflects confirmed state
  renderPropertyReviewQueue(ownerProp);
  // Refresh homepage banner count if portfolio view is visible
  const portfolioEl = document.getElementById('portfolioDashboard');
  if (portfolioEl && portfolioEl.style.display !== 'none') renderReviewQueue(_props);
}

function _rqPropCardBullets(items) { return Selectors.propCardBullets(items); }

// Compact single-row card for property-level queue.
function _rqCompactItemHtml(item) {
  const acked = item.reviewerConfirmed;
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
    <div class="rq-compact-actions" style="display:flex;gap:4px;align-items:center;">
      <button class="rq-action-btn rq-btn--primary" onclick="openReviewWorkspace('${tid}')">AI Review &#x203A;</button>
      ${acked
        ? `<span class="rq-chip">Ack'd</span>`
        : `<button class="rq-action-btn rq-btn--ack" onclick="markTenantReviewAcknowledged('${tid}')">Ack</button>`}
    </div>
  </div>`;
}

// Property-level queue: grouped by this property, rendered above tenant table.
function renderPropertyReviewQueue(property) {
  const panel = document.getElementById('propertyReviewQueuePanel');
  if (!panel) return;

  const allItems   = getReviewQueueItems([property]);
  const nonAcked   = allItems.filter(i => !i.reviewerConfirmed);
  const ackedItems = allItems.filter(i =>  i.reviewerConfirmed);

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

// ── AI Review Workspace ───────────────────────────────────────────────────────

let _rwActiveTenantId = null;

function openReviewWorkspace(tenantId) {
  let t = null;
  for (const p of _props) {
    const found = (p.tenants || []).find(x => x && x.id === tenantId);
    if (found) { t = found; break; }
  }
  if (!t) t = tenantData.find(x => x && x.id === tenantId);
  if (!t) return;

  _rwActiveTenantId = tenantId;
  document.getElementById('rwTitle').textContent = t.tenant_name || 'Tenant Review';
  const prop = _props.find(p => (p.tenants || []).some(x => x && x.id === tenantId));
  document.getElementById('rwSubtitle').textContent = prop ? (prop.name || '') : '';

  _rwRenderAll(t);
  document.getElementById('reviewWorkspace').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeReviewWorkspace() {
  _rwActiveTenantId = null;
  document.getElementById('reviewWorkspace').classList.remove('open');
  document.body.style.overflow = '';
}

function _rwRenderAll(t) {
  const rv = deriveTenantReviewState(t);
  _rwRenderScoreCard(rv);
  _rwRenderLeaseFields(t);
  _rwRenderWhyFlagged(rv);
  _rwRenderRecommendations(rv);
  _rwRenderActions(t, rv);
  _rwRenderNoteSection(t);
  _rwRenderHistory(t);
  _rwRenderInvoices(t);
}

function _rwRenderScoreCard(rv) {
  const scoreCls = rv.score >= 80 ? 'rw-score-num--high' : rv.score >= 50 ? 'rw-score-num--mid' : 'rw-score-num--low';
  const statusLabels = {
    incomplete:        'Incomplete Data',
    needs_review:      'Needs Review',
    verified:          'Verified',
    manually_verified: 'Manually Verified',
  };
  document.getElementById('rwScoreCard').innerHTML = `
    <div class="rw-score-card">
      <div class="rw-score-num ${scoreCls}">${rv.score}</div>
      <div class="rw-score-meta">
        <div class="rw-score-lbl">Data Quality Score</div>
        <div class="rw-score-status rw-score-status--${rv.status}">${esc(statusLabels[rv.status] || rv.status)}</div>
      </div>
    </div>`;
}

// Returns { label, cls } confidence chip for a field on tenant t.
function _rwConfChip(key, t) {
  if (key !== 'tenant_name' && isFieldManuallyVerified(key, t))
    return { label: 'Manual', cls: 'rw-conf-chip--manual' };
  // leased_sqft has a numeric per-field confidence score
  const numericConf = key === 'leased_sqft'
    ? (t.confidence?.leased_sqft ?? t.confidence?.leasedSqft ?? null)
    : null;
  if (numericConf !== null) {
    if (numericConf >= 80) return { label: 'High',   cls: 'rw-conf-chip--high' };
    if (numericConf >= 50) return { label: 'Medium', cls: 'rw-conf-chip--mid' };
    return { label: 'Low', cls: 'rw-conf-chip--low' };
  }
  const fc = key === 'tenant_name'
    ? { status: t[key] ? 'verified' : 'missing' }
    : getFieldConfidence(key, t);
  if (fc.status === 'verified')  return { label: 'High',   cls: 'rw-conf-chip--high' };
  if (fc.status === 'estimated') return { label: 'Medium', cls: 'rw-conf-chip--mid' };
  if (fc.status === 'missing')   return { label: 'N/A',    cls: 'rw-conf-chip--na' };
  return { label: 'Low', cls: 'rw-conf-chip--low' };
}

// Returns the human-readable extraction method for a field (maps to required fallback states).
function _rwExtractionMethod(key, t) {
  if (key !== 'tenant_name' && isFieldManuallyVerified(key, t)) return 'Manually Entered';
  const val = key === 'tenant_name' ? t[key] : (getEffectiveLeaseField(key, t) ?? t[key]);
  const isEmpty = val === null || val === undefined || String(val).trim() === '';
  if (isEmpty) return 'Not Found';
  if ((key === 'start_date' || key === 'end_date') && (t._usedFallback || t.doc_has_dates === false))
    return 'Estimated from Context';
  if (key === 'lease_type' && t.doc_has_lease_type === false)
    return 'Estimated from Context';
  if (key === 'leased_sqft') {
    const nc = t.confidence?.leased_sqft ?? t.confidence?.leasedSqft;
    if (nc != null && nc < 50) return 'Estimated from Context';
  }
  return 'AI Extraction';
}

function _rwRenderLeaseFields(t) {
  const fields = [
    { key: 'tenant_name', label: 'Tenant Name' },
    { key: 'leased_sqft', label: 'Leased Sq Ft' },
    { key: 'lease_type',  label: 'Lease Type' },
    { key: 'start_date',  label: 'Lease Start' },
    { key: 'end_date',    label: 'Lease End' },
    { key: 'cap',         label: 'CAM Cap' },
  ];
  const confIcon = { verified: '✓', estimated: '⚠', missing: '—' };

  const fieldsHtml = fields.map(({ key, label }) => {
    const isManual = key !== 'tenant_name' && isFieldManuallyVerified(key, t);
    const val = isManual
      ? getEffectiveLeaseField(key, t)
      : (key === 'tenant_name' ? t[key] : (getEffectiveLeaseField(key, t) ?? t[key]));
    const isEmpty = val === null || val === undefined || String(val).trim() === '';

    const conf = key === 'tenant_name'
      ? { status: isEmpty ? 'missing' : 'verified', note: isEmpty ? 'Not found in data' : 'From tenant data' }
      : getFieldConfidence(key, t);

    const method    = _rwExtractionMethod(key, t);
    const chip      = _rwConfChip(key, t);
    const ov        = t.reviewOverrides?.[key];
    const overrideTs = isManual && ov?.reviewedAt ? ` · ${_rwFormatDate(ov.reviewedAt)}` : '';
    // Source document: show filename for document-backed fields, fallback to "—"
    const srcFull   = isManual ? 'Manual entry' : (t.fileName || '—');
    const srcTrunc  = srcFull.length > 26 ? srcFull.slice(0, 23) + '…' : srcFull;

    const valHtml = isEmpty
      ? `<div class="rw-field-value rw-field-value--missing">Not found</div>`
      : `<div class="rw-field-value">${esc(String(val))}</div>`;

    const confRow = `<div class="rw-field-conf rw-fc--${conf.status}">${confIcon[conf.status] || '—'} ${esc(conf.note || conf.status)}</div>`;

    // Evidence button: opens extraction evidence panel for all document-backed fields
    const viewBtn = key !== 'tenant_name'
      ? `<button class="rw-view-src" onclick="openLeaseEvidencePanel('${t.id}','${key}')" title="View extraction evidence">Evidence</button>`
      : '';

    const sourceRow = `
      <div class="rw-field-source">
        <span class="rw-conf-chip ${chip.cls}" title="Confidence level">${chip.label}</span>
        <span class="rw-source-meta" title="${esc(srcFull + overrideTs)}">${esc(method)} · ${esc(srcTrunc)}${esc(overrideTs)}</span>
        ${viewBtn}
      </div>`;

    return `
      <div class="rw-field">
        <div class="rw-field-label">${esc(label)}</div>
        ${valHtml}
        ${confRow}
        ${sourceRow}
      </div>`;
  }).join('');

  const leaseBtn = t.leaseUrl
    ? `<button class="rw-lease-btn" onclick="openLeaseModalFromRw()">&#x1F4C4; View Lease Document</button>`
    : `<div class="rw-empty" style="margin-top:8px;">No lease document uploaded</div>`;

  document.getElementById('rwLeaseFields').innerHTML = fieldsHtml + leaseBtn;
}

function _rwRenderWhyFlagged(rv) {
  if (rv.warnings.length === 0) {
    document.getElementById('rwWhyFlagged').innerHTML = `<div class="rw-empty">No issues detected.</div>`;
    return;
  }
  const warningDetails = {
    missing_lease_type:  'Lease type determines which CAM charges apply. Without it, allocation may be incorrect.',
    missing_sqft:        'Pro-rata share is calculated from square footage. Missing value blocks allocation.',
    missing_start_date:  'Lease term is needed to validate CAM period eligibility.',
    missing_end_date:    'Lease term is needed to validate CAM period eligibility.',
    nnn_cap_missing:     'NNN leases often include CAM caps. Missing cap may over-allocate charges to this tenant.',
    fallback_extraction: 'Data was extracted using a fallback heuristic — less reliable than structured extraction.',
    low_sqft_confidence: 'Extracted square footage confidence is below 70%. Verify against the lease document.',
    pro_rata_overflow:   'Combined pro-rata shares exceed 100%. This indicates a data or configuration error.',
  };
  const icons = { high: '⛔', medium: '⚠', low: 'ℹ' };
  document.getElementById('rwWhyFlagged').innerHTML = rv.warnings.map(w => `
    <div class="rw-warning rw-warning--${esc(w.severity)}">
      <span class="rw-warning-icon">${icons[w.severity] || '⚠'}</span>
      <div>
        <div class="rw-warning-label">${esc(w.label)}</div>
        ${warningDetails[w.type] ? `<div class="rw-warning-detail">${esc(warningDetails[w.type])}</div>` : ''}
      </div>
    </div>`).join('');
}

function _rwRenderRecommendations(rv) {
  const recMap = {
    missing_lease_type:  'Select a lease type (NNN, Gross, or Modified Gross) using Edit Fields below.',
    missing_sqft:        'Enter the leased square footage from the signed lease agreement.',
    missing_start_date:  'Enter the lease commencement date from the lease document.',
    missing_end_date:    'Enter the lease expiration date from the lease document.',
    nnn_cap_missing:     'Check the lease for a CAM expense cap clause and enter the annual cap amount.',
    fallback_extraction: 'Verify all extracted fields against the original lease document.',
    low_sqft_confidence: 'Confirm the square footage by reviewing the lease document directly.',
    pro_rata_overflow:   'Review all tenant square footages — total must not exceed the building GLA.',
  };
  const recs = rv.warnings.filter(w => recMap[w.type]).map(w => recMap[w.type]);
  if (recs.length === 0) {
    document.getElementById('rwRecommended').innerHTML = `<div class="rw-empty">No specific actions required.</div>`;
    return;
  }
  document.getElementById('rwRecommended').innerHTML = recs.map(text => `
    <div class="rw-rec">
      <span class="rw-rec-icon">&#x2192;</span>
      <div class="rw-rec-text">${esc(text)}</div>
    </div>`).join('');
}

function _rwRenderActions(t, rv) {
  const tid = esc(t.id || '');
  const approveBtn = rv.reviewerConfirmed
    ? `<button class="rw-btn rw-btn--approved-done" disabled>&#x2713; Approved</button>`
    : `<button class="rw-btn rw-btn--approve" onclick="rwApprove('${tid}')">&#x2713; Approve</button>`;
  const flagBtn = `<button class="rw-btn rw-btn--flag" onclick="rwFlag('${tid}')">&#x2691; Flag</button>`;
  const editBtn = `<button class="rw-btn rw-btn--edit" onclick="rwOpenTenant('${tid}')">Edit Fields</button>`;
  document.getElementById('rwActions').innerHTML = `<div class="rw-actions-row">${approveBtn}${flagBtn}${editBtn}</div>`;
}

function _rwRenderInvoices(t) {
  const recon = lastResults.find(r => r.name === t.tenant_name);
  const el = document.getElementById('rwInvoiceList');
  if (!recon) {
    el.innerHTML = `<div class="rw-empty">No reconciliation run yet.</div>`;
    return;
  }
  const proRataPct = typeof recon.proRataPercent === 'number' ? recon.proRataPercent : (recon.proRata || 0) * 100;
  const proRataDisplay = proRataPct > 0 ? proRataPct.toFixed(2) + '%' : '—';
  const proRataFill = Math.min(100, proRataPct).toFixed(1);
  const proRataOver = proRataPct > 100;
  const fillColor = proRataOver ? '#f87171' : '#C9973A';
  const totalAllocated = recon.totalAllocated || recon.allocatedAmount || 0;
  const invoices = recon.includedInvoices || [];
  let html = `
    <div class="rw-prorata-row">
      <span class="rw-prorata-label">Pro-rata share</span>
      <span class="rw-prorata-val" style="${proRataOver ? 'color:#f87171;' : ''}">${esc(proRataDisplay)}</span>
    </div>
    <div class="rw-prorata-bar"><div class="rw-prorata-fill" style="width:${proRataFill}%;background:${fillColor};"></div></div>`;
  if (invoices.length === 0) {
    html += `<div class="rw-empty">No invoices allocated.</div>`;
  } else {
    html += invoices.slice(0, 12).map(inv => {
      const name = inv.vendor || inv.description || inv.invoiceId || '—';
      const cat  = inv.category || inv.cat || '';
      const amt  = typeof inv.share === 'number'
        ? '$' + inv.share.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        : '—';
      const conf = inv.matchConfidence != null ? `<span class="rw-invoice-conf">${inv.matchConfidence}% conf</span>` : '';
      return `
        <div class="rw-invoice">
          <div class="rw-invoice-name">${esc(name)}</div>
          ${cat ? `<div class="rw-invoice-cat">${esc(cat)}</div>` : ''}
          <div class="rw-invoice-amt">${esc(amt)}${conf}</div>
        </div>`;
    }).join('');
    if (invoices.length > 12) html += `<div class="rw-empty" style="margin-top:4px;">+${invoices.length - 12} more</div>`;
    html += `
      <div class="rw-total-row">
        <span class="rw-prorata-label">Total Allocated</span>
        <span class="rw-prorata-val" style="color:#C9973A;">$${totalAllocated.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
      </div>`;
  }
  el.innerHTML = html;
}

function _rwFormatDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}

function _rwHistActionLabel(action) {
  return { approved: 'Approved', flagged: 'Flagged', note: 'Note' }[action] || action;
}

function _rwRenderNoteSection(t) {
  const el = document.getElementById('rwNoteSection');
  if (!el) return;
  const tid = esc(t.id || '');
  el.innerHTML = `
    <textarea id="rwNoteInput" class="rw-note-input" placeholder="Add a review note…"></textarea>
    <button class="rw-note-save-btn" onclick="rwSaveNote('${tid}')">Save Note</button>`;
}

function _rwRenderHistory(t) {
  const el = document.getElementById('rwHistory');
  if (!el) return;
  const history = t.review?.history || [];
  if (history.length === 0) {
    el.innerHTML = `<div class="rw-empty">No review history yet.</div>`;
    return;
  }
  el.innerHTML = [...history].reverse().map(h => `
    <div class="rw-history-entry">
      <span class="rw-hist-badge rw-hist--${esc(h.action)}">${esc(_rwHistActionLabel(h.action))}</span>
      <span class="rw-hist-by">${esc(h.by || 'Unknown')}</span>
      <span class="rw-hist-at">${esc(_rwFormatDate(h.at))}</span>
      ${h.note ? `<div class="rw-hist-note">${esc(h.note)}</div>` : ''}
    </div>`).join('');
}

function rwSaveNote(tenantId) {
  const noteText = document.getElementById('rwNoteInput')?.value?.trim();
  if (!noteText) return;
  let ownerProp = null, ownerIdx = -1;
  for (const p of _props) {
    const idx = (p.tenants || []).findIndex(x => x && x.id === tenantId);
    if (idx !== -1) { ownerProp = p; ownerIdx = idx; break; }
  }
  if (!ownerProp) return;
  const prev    = ownerProp.tenants[ownerIdx];
  const prevRev = prev.review || {};
  const entry   = { action: 'note', by: 'Manual Review', at: new Date().toISOString(), note: noteText };
  const updated = {
    ...prev,
    review: { ...prevRev, notes: noteText, history: [...(prevRev.history || []), entry] },
  };
  ownerProp.tenants[ownerIdx] = updated;
  if (ownerProp.id === activePropId) {
    const tdIdx = tenantData.findIndex(x => x && x.id === tenantId);
    if (tdIdx !== -1) tenantData[tdIdx] = updated;
  }
  saveProperty(ownerProp);
  const inp = document.getElementById('rwNoteInput');
  if (inp) inp.value = '';
  _rwRenderHistory(updated);
}

function rwApprove(tenantId) {
  const note = document.getElementById('rwNoteInput')?.value?.trim() || null;
  markTenantReviewAcknowledged(tenantId, note);
  let t = null;
  for (const p of _props) {
    const found = (p.tenants || []).find(x => x && x.id === tenantId);
    if (found) { t = found; break; }
  }
  if (!t) { closeReviewWorkspace(); return; }
  _rwRenderAll(t);
}

function rwFlag(tenantId) {
  const note = document.getElementById('rwNoteInput')?.value?.trim() || null;
  let ownerProp = null, ownerIdx = -1;
  for (const p of _props) {
    const idx = (p.tenants || []).findIndex(x => x && x.id === tenantId);
    if (idx !== -1) { ownerProp = p; ownerIdx = idx; break; }
  }
  if (!ownerProp) return;
  const prev    = ownerProp.tenants[ownerIdx];
  const prevRev = prev.review || {};
  const entry   = { action: 'flagged', by: 'Manual Review', at: new Date().toISOString(), note };
  const updated = {
    ...prev,
    _needsReview: true,
    review: { ...prevRev, reviewerConfirmed: false, history: [...(prevRev.history || []), entry] },
  };
  ownerProp.tenants[ownerIdx] = updated;
  if (ownerProp.id === activePropId) {
    const tdIdx = tenantData.findIndex(x => x && x.id === tenantId);
    if (tdIdx !== -1) tenantData[tdIdx] = updated;
  }
  saveProperty(ownerProp);
  _rwRenderAll(updated);
}

function rwOpenTenant(tenantId) {
  closeReviewWorkspace();
  const idx = tenantData.findIndex(x => x && x.id === tenantId);
  if (idx !== -1) openTenantDetailPanel(idx);
}

function openLeaseModalFromRw() {
  const tenantId = _rwActiveTenantId;
  if (!tenantId) return;
  let t = null;
  for (const p of _props) {
    const found = (p.tenants || []).find(x => x && x.id === tenantId);
    if (found) { t = found; break; }
  }
  if (!t) t = tenantData.find(x => x && x.id === tenantId);
  if (!t?.leaseUrl) return;
  openLeaseModal(t.leaseUrl);
}

// ─────────────────────────────────────────────────────────────────────────────

// Shim — delegates to Selectors (selectors.js)
function portfolioKPIs(props) { return Selectors.portfolioKPIs(props); }

// ── Portfolio Intelligence + Readiness Engine shims ───────────────────────────
// Logic lives in selectors.js (pure, no global deps).
const _RDY_LABELS = Selectors.RDY_LABELS;

// Shims — delegate to Selectors (selectors.js)
function derivePropertyReadiness(p)     { return Selectors.derivePropertyReadiness(p); }
function _piComputePortfolioIntel(props){ return Selectors.computePortfolioIntel(props); }

// ─── Recovered Revenue Dashboard ─────────────────────────────────────────────

function computeRecoveredRevenue(props) {
  const safeProps = Array.isArray(props) ? props : [];
  let capSavings = 0, disputeRecoveries = 0, exclusionSavings = 0, auditCoverage = 0;
  let capCount = 0, disputeCount = 0, exclusionTenantCount = 0, auditCount = 0;
  const byProperty = [];
  const timeline   = [];

  for (const p of safeProps) {
    const recon    = p.camReconciliation ?? p.results ?? {};
    const results  = Array.isArray(recon.results)  ? recon.results  : [];
    const tenants  = Array.isArray(p.tenants)       ? p.tenants      : [];
    const disps    = Array.isArray(p.disputes)      ? p.disputes     : [];
    const invoices = Array.isArray(recon.invoices)  ? recon.invoices : [];
    const totalSqft = p.totalSqft || 1;

    // Cap savings: sum of raw-over-cap reduction where cap fired
    let pCap = 0, pCapN = 0;
    for (const r of results) {
      if (r.capApplied && (r.capAdjustment || 0) > 0) {
        pCap += r.capAdjustment;
        pCapN++;
      }
    }

    // Dispute recoveries: accepted disputes (charge confirmed correct after review)
    let pDisp = 0, pDispN = 0;
    for (const d of disps) {
      if (d.status === 'accepted' && (d.tenantShare || 0) > 0) {
        pDisp += d.tenantShare;
        pDispN++;
        timeline.push({
          date:     d.resolvedAt || d.timestamp,
          tenant:   d.tenantName || '',
          vendor:   d.vendor || d.category || '',
          amount:   d.tenantShare,
          type:     'dispute',
          propName: p.name || '',
        });
      }
    }

    // Exclusion savings: for each excluded category, sum invoice pool × pro-rata
    let pExcl = 0;
    const pExclTenants = new Set();
    for (const t of tenants) {
      const excl = (t.excluded_categories || '')
        .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
      if (!excl.length) continue;
      const sqft = parseFloat(t.leased_sqft) || 0;
      const proRata = sqft / totalSqft;
      for (const cat of excl) {
        const catSum = invoices
          .filter(inv => (inv.category || '').toLowerCase() === cat)
          .reduce((s, inv) => s + (inv.amount || 0), 0);
        pExcl += catSum * proRata;
      }
      pExclTenants.add(t.id || t.tenant_name);
    }

    // Audit scope: CAM allocated to tenants with explicit audit rights
    let pAudit = 0, pAuditN = 0;
    for (const r of results) {
      const t = tenants.find(t => (t.tenant_name || '') === (r.tenantName || ''));
      if (t?.audit_rights === true || t?.audit_rights === 'true') {
        pAudit += (r.totalAllocated || 0);
        pAuditN++;
      }
    }

    capSavings            += pCap;
    disputeRecoveries     += pDisp;
    exclusionSavings      += pExcl;
    auditCoverage         += pAudit;
    capCount              += pCapN;
    disputeCount          += pDispN;
    exclusionTenantCount  += pExclTenants.size;
    auditCount            += pAuditN;

    if (pCap + pDisp + pExcl + pAudit > 0) {
      byProperty.push({
        id: p.id, name: p.name,
        capSavings: pCap,     capCount: pCapN,
        disputes:   pDisp,    disputeCount: pDispN,
        exclusions: pExcl,    exclusionTenants: pExclTenants.size,
        auditCoverage: pAudit, auditCount: pAuditN,
        total: pCap + pDisp + pExcl,
      });
    }
  }

  timeline.sort((a, b) => (b.date || '') > (a.date || '') ? 1 : -1);

  return {
    capSavings, capCount,
    disputeRecoveries, disputeCount,
    exclusionSavings, exclusionTenantCount,
    auditCoverage, auditCount,
    total: capSavings + disputeRecoveries + exclusionSavings,
    byProperty, timeline,
  };
}

function renderRecoveredRevenueDashboard(props) {
  const panel = document.getElementById('rrDashPanel');
  if (!panel) return;
  const safeProps = Array.isArray(props) ? props : [];
  if (safeProps.length === 0) { panel.style.display = 'none'; return; }

  const d = computeRecoveredRevenue(safeProps);
  if (d.total <= 0 && d.auditCoverage <= 0) { panel.style.display = 'none'; return; }

  const fmtV = n => n > 0 ? fmt(n) : '—';
  const plur = (n, word) => n + ' ' + word + (n !== 1 ? 's' : '');

  // 4 KPI tiles
  const tiles = [
    { val: fmtV(d.capSavings),        lbl: 'Cap Savings',        sub: plur(d.capCount, 'tenant'),             cls: 'rr-kpi--green' },
    { val: fmtV(d.disputeRecoveries), lbl: 'Disputes Resolved',  sub: d.disputeCount + ' accepted',           cls: ''             },
    { val: fmtV(d.exclusionSavings),  lbl: 'Exclusion Savings',  sub: plur(d.exclusionTenantCount, 'tenant'), cls: ''             },
    { val: d.auditCoverage > 0 ? fmt(d.auditCoverage) : '—',
                                       lbl: 'Audit Scope',         sub: plur(d.auditCount, 'tenant') + ' w/ rights', cls: 'rr-kpi--blue' },
  ];
  const tilesHtml = tiles.map(t =>
    `<div class="rr-kpi ${t.cls}">
       <div class="rr-kpi-val">${esc(t.val)}</div>
       <div class="rr-kpi-lbl">${esc(t.lbl)}</div>
       <div class="rr-kpi-sub">${esc(t.sub)}</div>
     </div>`
  ).join('');

  // Property breakdown table
  let tableHtml = '';
  if (d.byProperty.length > 0) {
    const rows = d.byProperty.map(p =>
      `<tr>
         <td>${esc(p.name)}</td>
         <td>${p.capSavings > 0 ? esc(fmt(p.capSavings)) : '—'}</td>
         <td>${p.disputes   > 0 ? esc(fmt(p.disputes))   : '—'}</td>
         <td>${p.exclusions > 0 ? esc(fmt(p.exclusions)) : '—'}</td>
         <td>${esc(fmt(p.total))}</td>
       </tr>`
    ).join('');
    tableHtml = `
      <table class="rr-table">
        <thead><tr>
          <th>Property</th><th>Cap Savings</th><th>Disputes</th><th>Exclusions</th><th>Total</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  // Recent recovery events timeline
  let timelineHtml = '';
  if (d.timeline.length > 0) {
    const items = d.timeline.slice(0, 8).map(ev => {
      const ds = ev.date
        ? new Date(ev.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
        : '—';
      const desc = [ev.tenant, ev.vendor].filter(Boolean).join(' — ');
      return `<div class="rr-tl-item">
        <div class="rr-tl-dot rr-tl-dot--${esc(ev.type)}"></div>
        <div class="rr-tl-date">${esc(ds)}</div>
        <div class="rr-tl-desc">${esc(desc)}</div>
        <div class="rr-tl-amt">${esc(fmt(ev.amount))}</div>
      </div>`;
    }).join('');
    timelineHtml = `
      <div>
        <div class="rr-timeline-title">Recent Recovery Events</div>
        ${items}
      </div>`;
  }

  const methodologyHtml = `
    <div class="rr-methodology" style="display:none;">
      <strong>Cap Savings</strong> — Difference between each tenant's raw pro-rata share and their lease cap limit, summed where the cap fired. Money that would have been overbilled without cap enforcement.<br><br>
      <strong>Disputes Resolved</strong> — Sum of dispute amounts where the landlord's position was accepted after review and documentation.<br><br>
      <strong>Exclusion Savings</strong> — For each tenant with excluded expense categories, invoice amounts in those categories × their pro-rata share. Charges correctly omitted per lease terms.<br><br>
      <strong>Audit Scope</strong> — Total CAM billed to tenants with explicit audit rights. Accurate allocation protects against successful audit challenges.
    </div>`;

  panel.style.display = 'block';
  panel.innerHTML = `
    <div class="rr-panel">
      <div class="rr-panel-head">
        <span class="rr-panel-title">Recovered Revenue</span>
        <button class="rr-info-btn"
          onclick="var m=this.nextElementSibling;m.style.display=m.style.display==='block'?'none':'block'">
          How we count this
        </button>
      </div>
      ${methodologyHtml}
      <div class="rr-hero">
        <div class="rr-hero-val">${esc(fmt(d.total))}</div>
        <div class="rr-hero-lbl">Total lease compliance value identified</div>
      </div>
      <div class="rr-kpis">${tilesHtml}</div>
      ${tableHtml}
      ${timelineHtml}
    </div>`;
}

// Renders the Portfolio Intelligence panel above the property grid.
function renderPortfolioIntelligence(props, preRar) {
  const panel = document.getElementById('portfolioIntelPanel');
  if (!panel) return;
  const safeProps = Array.isArray(props) ? props : [];
  if (safeProps.length === 0) { panel.style.display = 'none'; return; }

  const pid      = AcquisitionEngine.computePortfolioIntelligence(safeProps, undefined, preRar);
  const forecast = AcquisitionEngine.computeRevenueForecast(safeProps);

  // ── helpers ───────────────────────────────────────────────────────────
  const fmtM  = v => v >= 1e6 ? '$' + (v / 1e6).toFixed(2) + 'M'
                  : v >= 1e3  ? '$' + Math.round(v / 1e3).toLocaleString('en-US') + 'K'
                  : '$' + Math.round(v).toLocaleString('en-US');
  const fmtSf = v => Math.round(v).toLocaleString('en-US');
  const fmtPct = v => v != null ? v + '%' : '—';

  // ── Metrics grid ──────────────────────────────────────────────────────
  const tile = (val, lbl, cls = '') =>
    `<div class="pid-tile${cls ? ' ' + cls : ''}">
       <div class="pid-tile-val">${val}</div>
       <div class="pid-tile-lbl">${lbl}</div>
     </div>`;

  const rarVal = pid.revenueAtRisk.urgentAnnualAtRisk;
  const metricsGrid = `
  <div class="pid-grid">
    ${tile(pid.propertyCount, 'Properties')}
    ${tile(fmtPct(pid.occupancyRate), 'Occupancy',
           pid.occupancyRate !== null && pid.occupancyRate < 80 ? 'pid-tile--warn' : '')}
    ${tile(pid.walt != null ? pid.walt + ' yrs' : '—', 'WALT')}
    ${tile(rarVal > 0 ? fmtM(rarVal) : '—', 'Revenue at Risk',
           rarVal > 0 ? 'pid-tile--alert' : '')}
    ${tile(pid.expiringCount || '—', 'Expiring Leases',
           pid.expiringCount > 0 ? 'pid-tile--warn' : '')}
    ${tile(pid.urgentCount || '—', 'Urgent Renewals',
           pid.urgentCount  > 0 ? 'pid-tile--alert' : '')}
    ${tile(pid.vacantSqft != null ? fmtSf(pid.vacantSqft) + ' sf' : '—', 'Vacant Sq Ft',
           pid.vacantSqft  > 0 ? 'pid-tile--warn' : '')}
  </div>`;

  // ── Top Risks ─────────────────────────────────────────────────────────
  const riskIcons = { revenue_at_risk: '&#x26A0;&#xFE0F;', vacant_sqft: '&#x1F4CA;', rollover_concentration: '&#x1F501;' };
  const topRisksHtml = pid.topRisks.length ? `
  <div class="pid-section">
    <div class="pid-section-title">Top Risks</div>
    ${pid.topRisks.map((r, i) => `
    <div class="pid-risk-row" onclick="selectProperty('${esc(r.propertyId)}')">
      <span class="pid-risk-rank">${i + 1}</span>
      <span class="pid-risk-icon">${riskIcons[r.riskType] || '⚠️'}</span>
      <div class="pid-risk-body">
        <span class="pid-risk-prop">${esc(r.propertyName)}</span>
        <span class="pid-risk-label">${esc(r.riskLabel)}</span>
      </div>
    </div>`).join('')}
  </div>` : `
  <div class="pid-section">
    <div class="pid-section-title">Top Risks</div>
    <div class="pid-no-risks">&#x2714; No significant risks identified across your portfolio.</div>
  </div>`;

  // ── Revenue Forecast ──────────────────────────────────────────────────
  const forecastHtml = (() => {
    if (forecast.currentAnnualRent === 0) return '';
    const fmtDelta = (d, pct) => {
      if (d === 0) return '<span class="pid-fc-flat">No change</span>';
      const sign = d > 0 ? '+' : '';
      const cls  = d > 0 ? 'pid-fc-up' : 'pid-fc-down';
      return `<span class="${cls}">${sign}${fmtM(Math.abs(d))} (${sign}${pct}%)</span>`;
    };
    const rows = forecast.scenarios.map((s, i) => {
      const highlight = i === 2 ? ' pid-fc-row--highlight' : '';
      return `
      <div class="pid-fc-row${highlight}">
        <span class="pid-fc-label">${esc(s.label)}</span>
        <span class="pid-fc-proj">${fmtM(s.projectedAnnualRent)}</span>
        <span class="pid-fc-delta">${fmtDelta(s.delta, s.deltaPct)}</span>
      </div>`;
    }).join('');

    return `
  <div class="pid-section pid-forecast-section">
    <div class="pid-section-title" style="cursor:pointer" onclick="togglePidForecast()">
      Revenue Forecast — Next 12 Months
      <span id="pidForecastToggle" class="pid-toggle-icon">&#x25BC;</span>
    </div>
    <div id="pidForecastBody" style="display:none">
      <div class="pid-fc-summary">
        <span>Current Annual Rent: <strong>${fmtM(forecast.currentAnnualRent)}</strong></span>
        <span class="pid-fc-sep">·</span>
        <span>Expiring Next 12 Mo: <strong class="pid-fc-expiring">${fmtM(forecast.expiringNext12Rent)}</strong>
          (${forecast.expiringLeaseCount} lease${forecast.expiringLeaseCount !== 1 ? 's' : ''})</span>
      </div>
      <div class="pid-fc-header">
        <span>Scenario</span><span>Projected</span><span>Change</span>
      </div>
      ${rows}
    </div>
  </div>`;
  })();

  // ── Existing reconciliation health (preserved) ────────────────────────
  const intel = _piComputePortfolioIntel(safeProps);
  const hasCritical = intel.totalExpired > 0 || intel.proRataGapProps > 0 || intel.totalExposure > 0;
  const hasWarn     = intel.totalMissingCaps > 0 || intel.totalLowConf > 0 || intel.totalUnresolved > 0;
  const reconCls    = hasCritical ? 'pi-panel--alert' : hasWarn ? 'pi-panel--warn' : 'pi-panel--ok';

  const rdCounts = { reconciled: 0, reconciliation_ready: 0, partially_verified: 0, needs_review: 0, high_risk: 0 };
  for (const p of safeProps) {
    const rd = derivePropertyReadiness(p);
    if (rd.readiness in rdCounts) rdCounts[rd.readiness]++;
  }
  const rdyOrder = [
    { key: 'high_risk',            label: 'High Risk',    cls: 'rdy-high_risk' },
    { key: 'needs_review',         label: 'Needs Review', cls: 'rdy-needs-review' },
    { key: 'partially_verified',   label: 'Partial',      cls: 'rdy-partially_verified' },
    { key: 'reconciliation_ready', label: 'Ready',        cls: 'rdy-reconciliation_ready' },
    { key: 'reconciled',           label: 'Reconciled',   cls: 'rdy-reconciled' },
  ];
  const rdyHtml = rdyOrder
    .filter(r => rdCounts[r.key] > 0)
    .map(r => `<span class="pi-rdy-chip ${r.cls}">${rdCounts[r.key]} ${esc(r.label)}</span>`)
    .join('');
  const pm = (val, lbl, cls = '') =>
    `<div class="pi-metric${cls ? ' ' + cls : ''}"><div class="pi-metric-val">${val}</div><div class="pi-metric-lbl">${lbl}</div></div>`;
  const reconHtml = `
  <div class="pid-section pid-recon-section">
    <div class="pid-section-title">Reconciliation Health</div>
    <div class="pi-metrics">
      ${pm(intel.totalUnresolved || '—', 'Unresolved',     intel.totalUnresolved  > 0 ? 'pi-metric--warn'  : '')}
      ${pm(intel.totalMissingCaps || '—', 'Missing Caps',  intel.totalMissingCaps > 0 ? 'pi-metric--warn'  : '')}
      ${pm(intel.totalLowConf || '—', 'Low Confidence')}
      ${pm(intel.totalExposure > 0 ? '$' + Math.round(intel.totalExposure).toLocaleString('en-US') : '—',
           'Dispute Exposure', intel.totalExposure > 0 ? 'pi-metric--alert' : '')}
    </div>
    ${rdyHtml ? `<div class="pi-rdy-row">${rdyHtml}</div>` : ''}
  </div>`;

  panel.style.display = 'block';
  panel.innerHTML = `
  <div class="pid-panel">
    <div class="pid-panel-head">
      <span class="pid-panel-title">&#x1F4CA; Portfolio Intelligence</span>
    </div>
    ${metricsGrid}
    ${topRisksHtml}
    ${forecastHtml}
    ${reconHtml}
  </div>`;
}

// ── Deep-link navigation helpers ────────────────────────────────────────────

// Navigate to a property then scroll-to + open the detail panel for a specific tenant.
async function navigateToPropertyTenant(propId, tenantName) {
  if (!propId) return;
  await selectProperty(propId);
  if (!tenantName) return;
  setTimeout(function() {
    var row = document.querySelector('tr[data-tenant-name="' + CSS.escape(tenantName) + '"]');
    if (row) {
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      row.classList.add('ac-highlight-row');
      setTimeout(function() { row.classList.remove('ac-highlight-row'); }, 2500);
    }
    var idx = -1;
    for (var i = 0; i < tenantData.length; i++) {
      if (tenantData[i] && tenantData[i].tenant_name === tenantName) { idx = i; break; }
    }
    if (idx >= 0) openTenantDetailPanel(idx);
  }, 150);
}

// Stay on portfolio — scroll the Renewal Pipeline panel into view and highlight matching tenant row.
function scrollToRenewalPipeline(propId, tenantName) {
  var panel = document.getElementById('renewalPipelinePanel');
  if (!panel) return;
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  if (!tenantName) return;
  setTimeout(function() {
    var rows = panel.querySelectorAll('tbody tr');
    for (var i = 0; i < rows.length; i++) {
      var nameEl = rows[i].querySelector('.rp-tenant-name');
      if (nameEl && nameEl.textContent.trim() === tenantName) {
        rows[i].classList.add('ac-highlight-row');
        (function(r) { setTimeout(function() { r.classList.remove('ac-highlight-row'); }, 2500); })(rows[i]);
        break;
      }
    }
  }, 400);
}

// ── Action Center ────────────────────────────────────────────────────────────

function dismissActionCenter() {
  _actionCenterDismissed = true;
  var el = document.getElementById('actionCenterPanel');
  if (el) el.style.display = 'none';
}

function renderActionCenter(props, reviews, preRar) {
  var panel = document.getElementById('actionCenterPanel');
  if (!panel || _actionCenterDismissed) return;
  var safeProps = Array.isArray(props) ? props : [];
  if (safeProps.length === 0) { panel.style.display = 'none'; return; }

  var actions = AcquisitionEngine.computePortfolioActions(safeProps, reviews || [], undefined, preRar);
  var total   = actions.criticalActions.length + actions.warningActions.length + actions.infoActions.length;
  if (total === 0) {
    // All clear — show positive confirmation rather than hiding the panel
    panel.style.display = 'block';
    panel.innerHTML = `
  <div class="ac-panel ac-panel--clean">
    <div class="ac-header">
      <span class="ac-header-title">&#x2705; Portfolio Standing</span>
      <button class="ac-dismiss-btn" onclick="dismissActionCenter()" title="Dismiss">&#x2715;</button>
    </div>
    <div class="ac-clean-body">
      <span class="ac-clean-icon">&#x2714;</span>
      <div class="ac-clean-text">
        <strong>No actions required.</strong>
        Your ${safeProps.length} propert${safeProps.length !== 1 ? 'ies are' : 'y is'} in good standing — no expired leases, open disputes, or urgent renewals.
      </div>
    </div>
  </div>`;
    return;
  }

  const fmtM  = v => v >= 1e6 ? '$' + (v / 1e6).toFixed(1) + 'M'
                  : v >= 1e3  ? '$' + Math.round(v / 1e3) + 'K'
                  : '$' + Math.round(v);
  const fmtSf = v => Math.round(v).toLocaleString('en-US') + ' sf';

  // KPI count chips
  const c = actions.counts;
  const kpiChips = [
    c.expiredLeases > 0         ? `<span class="ac-kpi ac-kpi--critical">${c.expiredLeases} Expired Lease${c.expiredLeases !== 1 ? 's' : ''}</span>` : '',
    c.revenueAtRisk > 0         ? `<span class="ac-kpi ac-kpi--critical">${fmtM(c.revenueAtRisk)} Revenue at Risk</span>` : '',
    c.renewalsRequiringAction > 0 ? `<span class="ac-kpi ac-kpi--warn">${c.renewalsRequiringAction} Renewal${c.renewalsRequiringAction !== 1 ? 's' : ''} Requiring Action</span>` : '',
    c.openCamDisputes > 0       ? `<span class="ac-kpi ac-kpi--warn">${c.openCamDisputes} Open Dispute${c.openCamDisputes !== 1 ? 's' : ''}</span>` : '',
    c.vacantSqft >= 500         ? `<span class="ac-kpi ac-kpi--info">${fmtSf(c.vacantSqft)} Vacant</span>` : '',
    c.acquisitionsAwaitingConversion > 0 ? `<span class="ac-kpi ac-kpi--info">${c.acquisitionsAwaitingConversion} Acquisition${c.acquisitionsAwaitingConversion !== 1 ? 's' : ''} Ready to Convert</span>` : '',
  ].filter(Boolean).join('');

  // Single action item row
  const renderItem = (item, onclick) => {
    const timeStr = item.daysRemaining != null
      ? (item.daysRemaining <= 0 ? Math.abs(item.daysRemaining) + 'd expired' : item.daysRemaining + 'd left')
      : '';
    const badge = timeStr
      ? `<span class="ac-badge ac-badge--${esc(item.severity)}">${esc(timeStr)}</span>` : '';
    const clickAttr = onclick ? ` onclick="${onclick}"` : '';
    return `
    <div class="ac-item"${clickAttr}>
      <span class="ac-dot ac-dot--${esc(item.severity)}"></span>
      <div class="ac-item-body">
        <span class="ac-item-title">${esc(item.title)}</span>
        ${item.detail ? `<span class="ac-item-detail">${esc(item.detail)}</span>` : ''}
      </div>
      ${badge}
    </div>`;
  };

  // Build onclick for each item type
  const itemOnclick = (item, forSection) => {
    const pid = esc(item.propertyId || '');
    const tid = esc(item.tenantName || '');
    const rid = esc(item.reviewId   || '');
    if (forSection === 'critical') {
      // Critical lease expiry: navigate to property + open tenant
      return item.tenantName && item.propertyId
        ? `navigateToPropertyTenant('${pid}','${tid}')`
        : item.propertyId ? `selectProperty('${pid}')` : '';
    }
    if (forSection === 'warning') {
      if (item.type === 'cam_dispute') return item.propertyId ? `selectProperty('${pid}')` : '';
      // Lease expiry warnings → jump to Renewal Pipeline
      return item.tenantName
        ? `scrollToRenewalPipeline('${pid}','${tid}')`
        : item.propertyId ? `selectProperty('${pid}')` : '';
    }
    if (forSection === 'info') {
      if (item.type === 'acquisition_pending') return item.reviewId ? `selectAcquisitionReview('${rid}')` : '';
      return item.propertyId ? `selectProperty('${pid}')` : '';
    }
    return '';
  };

  // Sections with cap at 5/5/3 items
  const buildSection = (items, sectionKey, headHtml, max) => {
    if (items.length === 0) return '';
    const shown = items.slice(0, max);
    const more  = items.length - shown.length;
    const rows  = shown.map(item => renderItem(item, itemOnclick(item, sectionKey))).join('');
    const moreEl = more > 0 ? `<div class="ac-more">+${more} more</div>` : '';
    return `<div class="ac-section">${headHtml}${rows}${moreEl}</div>`;
  };

  const critSection = buildSection(
    actions.criticalActions, 'critical',
    '<div class="ac-section-hd ac-section-hd--critical">&#x1F534; Requires Immediate Action</div>', 5);
  const warnSection = buildSection(
    actions.warningActions, 'warning',
    '<div class="ac-section-hd ac-section-hd--warning">&#x26A0;&#xFE0F; Needs Attention</div>', 5);
  const infoSection = buildSection(
    actions.infoActions, 'info',
    '<div class="ac-section-hd ac-section-hd--info">&#x2139;&#xFE0F; For Your Attention</div>', 3);

  const hCounts = [
    actions.criticalActions.length > 0 ? `<span class="ac-hcount ac-hcount--critical">${actions.criticalActions.length} Critical</span>` : '',
    actions.warningActions.length  > 0 ? `<span class="ac-hcount ac-hcount--warning">${actions.warningActions.length} Warning${actions.warningActions.length !== 1 ? 's' : ''}</span>` : '',
    actions.infoActions.length     > 0 ? `<span class="ac-hcount ac-hcount--info">${actions.infoActions.length} Info</span>` : '',
  ].filter(Boolean).join('');

  panel.style.display = 'block';
  panel.innerHTML = `
  <div class="ac-panel">
    <div class="ac-header">
      <span class="ac-header-title">&#x26A1; Action Center</span>
      <div class="ac-header-counts">${hCounts}</div>
      <button class="ac-dismiss-btn" onclick="dismissActionCenter()" title="Dismiss for this session">&#x2715;</button>
    </div>
    ${kpiChips ? `<div class="ac-kpi-bar">${kpiChips}</div>` : ''}
    ${critSection}${warnSection}${infoSection}
  </div>`;
}

function _renderRenewalPipeline(pipeline) {
  const fmtM  = v => v >= 1e6 ? '$' + (v / 1e6).toFixed(2) + 'M'
                  : v >= 1e3  ? '$' + Math.round(v / 1e3).toLocaleString('en-US') + 'K'
                  : '$' + Math.round(v).toLocaleString('en-US');
  const fmtSf = v => Math.round(v).toLocaleString('en-US');
  const fmtRent = v => v != null && v > 0 ? fmtM(v) : '—';

  const statusLabels = {
    not_started:   'Not Started',
    contacted:     'Contacted',
    negotiating:   'Negotiating',
    proposal_sent: 'Proposal Sent',
    signed:        'Signed',
  };

  const daysBadge = (item) => {
    const d = item.daysRemaining;
    const cls = `rp-days rp-days--${item.priority}`;
    if (d <= 0)  return `<span class="${cls}">Expired ${Math.abs(d)}d ago</span>`;
    return `<span class="${cls}">${d}d left</span>`;
  };

  const kpiBarHtml = `
  <div class="rp-kpi-bar">
    <div class="rp-kpi">
      <div class="rp-kpi-val${pipeline.actionCount > 0 ? ' rp-kpi-val--alert' : ''}">${pipeline.actionCount || '—'}</div>
      <div class="rp-kpi-lbl">Requiring Action</div>
    </div>
    <div class="rp-kpi">
      <div class="rp-kpi-val">${pipeline.actionAnnualRent > 0 ? fmtRent(pipeline.actionAnnualRent) : '—'}</div>
      <div class="rp-kpi-lbl">Annual Rent</div>
    </div>
    <div class="rp-kpi">
      <div class="rp-kpi-val">${pipeline.actionSqft > 0 ? fmtSf(pipeline.actionSqft) + ' sf' : '—'}</div>
      <div class="rp-kpi-lbl">Sq Ft</div>
    </div>
    <div class="rp-kpi" style="margin-left:auto;">
      <div class="rp-kpi-val">${pipeline.totalCount}</div>
      <div class="rp-kpi-lbl">Total in Pipeline</div>
    </div>
  </div>`;

  if (pipeline.items.length === 0) {
    return `
  <div class="rp-panel">
    <div class="rp-panel-head">
      <span class="rp-panel-title">&#x1F4CB; Renewal Pipeline</span>
    </div>
    ${kpiBarHtml}
    <div class="rp-clean">
      <span class="rp-clean-icon">&#x2714;</span>
      <div>
        <strong style="color:#e2e8f0;font-size:0.85rem;">Pipeline clear</strong>
        <div style="font-size:0.76rem;color:#64748b;margin-top:3px;">No leases expiring within 12 months. All renewals are on track.</div>
      </div>
    </div>
  </div>`;
  }

  const rows = pipeline.items.map(item => {
    const renewalTxt = item.renewalOptions
      ? `<span class="rp-renewal">&#x1F501; ${esc(item.renewalOptions)}</span>`
      : `<span class="rp-no-renewal">No options</span>`;
    const statusCls = 'rp-status rp-status--' + (item.status || 'not_started');
    const statusTxt = statusLabels[item.status] || item.status || 'Not Started';
    const suiteTxt  = item.suite ? `<span class="rp-suite">Suite ${esc(item.suite)}</span>` : '';
    return `
    <tr style="cursor:pointer" onclick="navigateToPropertyTenant('${esc(item.propertyId || '')}','${esc(item.tenantName || '')}')">
      <td>
        <span class="rp-tenant-name">${esc(item.tenantName)}</span>${suiteTxt}
      </td>
      <td class="rp-prop">${esc(item.propertyName)}</td>
      <td class="rp-rent">${fmtRent(item.annualRent)}</td>
      <td class="rp-sqft">${item.leasedSqft != null ? fmtSf(item.leasedSqft) + ' sf' : '—'}</td>
      <td>${renewalTxt}</td>
      <td>${daysBadge(item)}</td>
      <td><span class="${statusCls}">${esc(statusTxt)}</span></td>
    </tr>`;
  }).join('');

  return `
  <div class="rp-panel">
    <div class="rp-panel-head">
      <span class="rp-panel-title">&#x1F4CB; Renewal Pipeline</span>
    </div>
    ${kpiBarHtml}
    <div class="rp-table-wrap">
      <table class="rp-table">
        <thead>
          <tr>
            <th>Tenant</th>
            <th>Property</th>
            <th>Annual Rent</th>
            <th>Sq Ft</th>
            <th>Renewal Options</th>
            <th>Timeline</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </div>`;
}

function renderRenewalPipeline(props) {
  const panel = document.getElementById('renewalPipelinePanel');
  if (!panel) return;
  const safeProps = Array.isArray(props) ? props : [];
  if (safeProps.length === 0) { panel.style.display = 'none'; return; }
  const pipeline = AcquisitionEngine.computeRenewalPipeline(safeProps);
  panel.style.display = 'block';
  panel.innerHTML = _renderRenewalPipeline(pipeline);
}

// ── Executive Summary Export ─────────────────────────────────────────────────

function exportPortfolioSummary() {
  const props   = Array.isArray(_props)      ? _props      : [];
  const reviews = Array.isArray(_acqReviews) ? _acqReviews : [];
  if (props.length === 0) {
    showToast('No portfolio data to export. Add properties first.', { color: '#92400e', textColor: '#fef3c7' });
    return;
  }

  const pid      = AcquisitionEngine.computePortfolioIntelligence(props);
  const rar      = AcquisitionEngine.computeRevenueAtRisk(props);
  const pipeline = AcquisitionEngine.computeRenewalPipeline(props);
  const forecast = AcquisitionEngine.computeRevenueForecast(props);
  const actions  = AcquisitionEngine.computePortfolioActions(props, reviews);

  const fmtM   = v => v >= 1e6 ? '$' + (v/1e6).toFixed(2) + 'M' : v >= 1e3 ? '$' + Math.round(v/1e3).toLocaleString('en-US') + 'K' : '$' + Math.round(v).toLocaleString('en-US');
  const fmtSf  = v => Math.round(v).toLocaleString('en-US') + ' sf';
  const today  = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const esc_   = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  const kpis = [
    { val: props.length,   lbl: 'Properties',       cls: '' },
    { val: pid.occupancyRate != null ? pid.occupancyRate + '%' : '—', lbl: 'Occupancy',
      cls: pid.occupancyRate !== null && pid.occupancyRate < 80 ? 'kpi-val--warn' : '' },
    { val: pid.walt != null ? pid.walt + ' yrs' : '—', lbl: 'WALT', cls: '' },
    { val: pid.totalAnnualRent > 0 ? fmtM(pid.totalAnnualRent) : '—', lbl: 'Annual Rent', cls: '' },
    { val: rar.urgentAnnualAtRisk > 0 ? fmtM(rar.urgentAnnualAtRisk) : '—', lbl: 'Revenue at Risk',
      cls: rar.urgentAnnualAtRisk > 0 ? 'kpi-val--risk' : '' },
    { val: pipeline.actionCount || '—', lbl: 'Renewals Requiring Action',
      cls: pipeline.actionCount > 0 ? 'kpi-val--warn' : '' },
    { val: actions.counts.openCamDisputes || '—', lbl: 'Open Disputes',
      cls: actions.counts.openCamDisputes > 0 ? 'kpi-val--warn' : '' },
    { val: actions.counts.vacantSqft >= 500 ? fmtSf(actions.counts.vacantSqft) : '—', lbl: 'Vacant Sq Ft',
      cls: actions.counts.vacantSqft >= 500 ? 'kpi-val--warn' : '' },
  ];

  const kpiGrid = kpis.map(k => `
    <div class="kpi-card">
      <div class="kpi-val ${k.cls}">${esc_(k.val)}</div>
      <div class="kpi-lbl">${esc_(k.lbl)}</div>
    </div>`).join('');

  const topRisksSection = pid.topRisks.length ? `
  <div class="section">
    <div class="section-title">Top Risks</div>
    <table>
      <thead><tr><th>#</th><th>Property</th><th>Risk</th><th>Impact</th></tr></thead>
      <tbody>${pid.topRisks.map((r, i) => `
        <tr>
          <td>${i + 1}</td>
          <td>${esc_(r.propertyName || '—')}</td>
          <td>${esc_(r.riskLabel || r.riskType || '—')}</td>
          <td>${r.impactScore > 0 ? fmtM(r.impactScore) : '—'}</td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>` : '';

  const priorityBadge = p => p === 'critical' ? 'badge-critical' : p === 'high' ? 'badge-warn' : 'badge-ok';
  const pipelineSection = pipeline.items.length ? `
  <div class="section">
    <div class="section-title">Renewal Pipeline — Next 12 Months (${pipeline.items.length} lease${pipeline.items.length !== 1 ? 's' : ''})</div>
    <table>
      <thead><tr><th>Tenant</th><th>Property</th><th>Lease End</th><th>Timeline</th><th>Annual Rent</th><th>Renewal Options</th></tr></thead>
      <tbody>${pipeline.items.slice(0, 20).map(item => `
        <tr>
          <td>${esc_(item.tenantName || '—')}</td>
          <td>${esc_(item.propertyName || '—')}</td>
          <td>${esc_(item.leaseEnd || '—')}</td>
          <td><span class="${priorityBadge(item.priority)}">${item.daysRemaining <= 0 ? 'Expired' : item.daysRemaining + 'd'}</span></td>
          <td>${item.annualRent ? fmtM(item.annualRent) : '—'}</td>
          <td>${esc_(item.renewalOptions || 'None')}</td>
        </tr>`).join('')}
        ${pipeline.items.length > 20 ? `<tr><td colspan="6" style="color:#64748b;font-style:italic">+${pipeline.items.length - 20} more leases</td></tr>` : ''}
      </tbody>
    </table>
  </div>` : '';

  const forecastSection = forecast.currentAnnualRent > 0 ? `
  <div class="section">
    <div class="section-title">Revenue Forecast — Next 12 Months</div>
    <table>
      <thead><tr><th>Scenario</th><th>Projected Annual</th><th>Change</th></tr></thead>
      <tbody>${forecast.scenarios.map(s => {
        const sign = s.delta > 0 ? '+' : '';
        const cls  = s.delta > 0 ? 'color:#16a34a' : s.delta < 0 ? 'color:#dc2626' : 'color:#64748b';
        return `<tr>
          <td>${esc_(s.label)}</td>
          <td style="font-weight:600">${fmtM(s.projectedAnnualRent)}</td>
          <td style="${cls}">${s.delta !== 0 ? sign + fmtM(Math.abs(s.delta)) + ' (' + sign + s.deltaPct + '%)' : 'No change'}</td>
        </tr>`;
      }).join('')}</tbody>
    </table>
  </div>` : '';

  const propSection = `
  <div class="section">
    <div class="section-title">Property Summary</div>
    <table>
      <thead><tr><th>Property</th><th>Tenants</th><th>Total Sqft</th><th>Annual Rent</th><th>Status</th></tr></thead>
      <tbody>${props.map(p => {
        const tens = (p.tenants || []).filter(t => t && !t.extractionFailed);
        const rent = tens.reduce((s, t) => s + (parseFloat(t.base_rent) || 0), 0);
        return `<tr>
          <td style="font-weight:600">${esc_(p.name || '(unnamed)')}</td>
          <td>${tens.length}</td>
          <td>${p.totalSqft ? fmtSf(p.totalSqft) : '—'}</td>
          <td>${rent > 0 ? fmtM(rent) : '—'}</td>
          <td>${esc_(p.status || 'in-progress')}</td>
        </tr>`;
      }).join('')}</tbody>
    </table>
  </div>`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Portfolio Executive Summary — ${today}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1e293b;background:#fff;padding:40px;max-width:960px;margin:0 auto;font-size:14px}
    @media print{body{padding:20px}.no-print{display:none!important}@page{margin:20mm}}
    h1{font-size:1.6rem;font-weight:800;color:#0f172a;margin-bottom:4px}
    .subtitle{font-size:0.82rem;color:#64748b;margin-bottom:32px}
    .section{margin-bottom:28px}
    .section-title{font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#64748b;margin-bottom:10px;padding-bottom:6px;border-bottom:1px solid #e2e8f0}
    .kpi-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:0}
    @media(max-width:600px){.kpi-grid{grid-template-columns:repeat(2,1fr)}}
    .kpi-card{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px}
    .kpi-val{font-size:1.45rem;font-weight:700;color:#0f172a;line-height:1.1}
    .kpi-val--risk{color:#dc2626}.kpi-val--warn{color:#d97706}
    .kpi-lbl{font-size:.68rem;color:#64748b;text-transform:uppercase;letter-spacing:.06em;margin-top:4px}
    table{width:100%;border-collapse:collapse;font-size:.83rem}
    th{background:#f1f5f9;padding:8px 12px;text-align:left;font-size:.68rem;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:#475569;white-space:nowrap}
    td{padding:8px 12px;border-bottom:1px solid #f1f5f9;vertical-align:middle}
    tr:last-child td{border-bottom:none}
    .badge-critical{background:#fee2e2;color:#dc2626;padding:2px 7px;border-radius:10px;font-size:.7rem;font-weight:700;white-space:nowrap}
    .badge-warn{background:#fef3c7;color:#d97706;padding:2px 7px;border-radius:10px;font-size:.7rem;font-weight:700;white-space:nowrap}
    .badge-ok{background:#dcfce7;color:#16a34a;padding:2px 7px;border-radius:10px;font-size:.7rem;font-weight:700;white-space:nowrap}
    .print-btn{background:#0f172a;color:#fff;border:none;padding:10px 22px;border-radius:6px;cursor:pointer;font-size:.85rem;margin-bottom:24px;display:inline-flex;align-items:center;gap:6px}
    .print-btn:hover{background:#1e293b}
    .footer{margin-top:40px;padding-top:14px;border-top:1px solid #e2e8f0;font-size:.7rem;color:#94a3b8;display:flex;justify-content:space-between;flex-wrap:wrap;gap:6px}
  </style>
</head>
<body>
  <button class="print-btn no-print" onclick="window.print()">&#x1F4E4; Print / Save as PDF</button>
  <h1>Portfolio Executive Summary</h1>
  <div class="subtitle">Generated ${today}&nbsp;&nbsp;·&nbsp;&nbsp;${props.length} Propert${props.length !== 1 ? 'ies' : 'y'}&nbsp;&nbsp;·&nbsp;&nbsp;Mainstreet</div>
  <div class="section">
    <div class="section-title">Portfolio Overview</div>
    <div class="kpi-grid">${kpiGrid}</div>
  </div>
  ${topRisksSection}${pipelineSection}${forecastSection}${propSection}
  <div class="footer">
    <span>Mainstreet &nbsp;·&nbsp; Portfolio Executive Summary</span>
    <span>Generated ${today}</span>
  </div>
</body>
</html>`;

  const w = window.open('', '_blank');
  if (w) {
    w.document.write(html);
    w.document.close();
  } else {
    const blob = new Blob([html], { type: 'text/html;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), {
      href: url, download: 'portfolio-summary-' + new Date().toISOString().slice(0, 10) + '.html',
    });
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}

function togglePidForecast() {
  const body = document.getElementById('pidForecastBody');
  const icon = document.getElementById('pidForecastToggle');
  if (!body) return;
  const open = body.style.display !== 'none';
  body.style.display = open ? 'none' : '';
  if (icon) icon.innerHTML = open ? '&#x25BC;' : '&#x25B2;';
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns live invoice statistics for a property by cascading through all
 * persisted invoice sources. Use this instead of reading p.invoices.length
 * directly — property.invoices is guarded and may be empty during tenant
 * portal saves.
 *
 * Source cascade (most → least authoritative):
 *   1. property.invoices[]                          — full objects, written when invoiceData populated
 *   2. property.camReconciliation.invoicesFull[]    — in-session only (stripped before LS/DB save)
 *   3. property.camReconciliation.invoices[]        — simplified list, always persisted after a run
 *   4. property.results.invoices[]                  — legacy fallback for older saved data
 *   5. per-tenant includedInvoices[], deduplicated  — aggregated from reconciliation results
 */
function getPropertyInvoiceStats(p) {
  const camRec = p.camReconciliation ?? p.results ?? null;

  // Source 1: property.invoices (full objects, guarded write)
  let invoices = Array.isArray(p.invoices) && p.invoices.length > 0 ? p.invoices : null;

  // Source 2: camReconciliation.invoicesFull (in-session, stripped before save)
  if (!invoices) {
    const full = camRec?.invoicesFull;
    if (Array.isArray(full) && full.length > 0) invoices = full;
  }

  // Source 3: camReconciliation.invoices (simplified, persisted)
  if (!invoices) {
    const simple = camRec?.invoices;
    if (Array.isArray(simple) && simple.length > 0) invoices = simple;
  }

  // Source 4: legacy results.invoices
  if (!invoices && p.results) {
    const leg = p.results?.invoices;
    if (Array.isArray(leg) && leg.length > 0) invoices = leg;
  }

  // Source 5: aggregate per-tenant includedInvoices, deduplicated by id
  if (!invoices && Array.isArray(camRec?.results) && camRec.results.length > 0) {
    const seen = new Set();
    const agg = [];
    for (const r of camRec.results) {
      if (!Array.isArray(r.includedInvoices)) continue;
      for (const inv of r.includedInvoices) {
        const key = inv.id != null ? String(inv.id)
          : (inv.vendorName || inv.vendor || '') + '|' + (inv.amount || 0) + '|' + (inv.date || inv.invoiceDate || '');
        if (!seen.has(key)) { seen.add(key); agg.push(inv); }
      }
    }
    if (agg.length > 0) invoices = agg;
  }

  if (!invoices || invoices.length === 0) {
    console.log('[INVOICE STATS]', { propertyId: p.id, invoiceCount: 0, vendorCount: 0, totalExpenseAmount: 0, source: 'none' });
    return { totalInvoices: 0, uniqueVendors: 0, totalExpenseAmount: 0 };
  }

  const vendors = new Set();
  let total = 0;
  for (const inv of invoices) {
    const v = inv.vendorName || inv.vendor;
    if (v) vendors.add(v);
    const amt = parseFloat(inv.amount || 0);
    if (!isNaN(amt)) total += amt;
  }

  const source = Array.isArray(p.invoices) && p.invoices.length > 0 ? 'property.invoices'
    : Array.isArray(camRec?.invoicesFull) && camRec.invoicesFull.length > 0 ? 'camRec.invoicesFull'
    : Array.isArray(camRec?.invoices) && camRec.invoices.length > 0 ? 'camRec.invoices'
    : Array.isArray(p.results?.invoices) && p.results.invoices.length > 0 ? 'results.invoices'
    : 'camRec.includedInvoices';

  console.log('[INVOICE STATS]', { propertyId: p.id, invoiceCount: invoices.length, vendorCount: vendors.size, totalExpenseAmount: Math.round(total * 100) / 100, source });

  return { totalInvoices: invoices.length, uniqueVendors: vendors.size, totalExpenseAmount: Math.round(total * 100) / 100 };
}

/**
 * Canonical derived metrics for a property.
 * Pure function — same input → same output. All dashboard cards, exports, and
 * review queues must read counts from this instead of computing independently.
 *
 * @param {object} p  - Property object from _props[] (or loaded via loadPropertyData)
 * @returns {{ propertyId, invoiceStats, disputeStats, reviewStats, financialStats, health, extraction }}
 */
function derivePropertyMetrics(p) {
  if (!p) return null;

  // ── Invoice stats (canonical cascade already in getPropertyInvoiceStats) ───
  const invStats = getPropertyInvoiceStats(p);

  // ── Dispute stats ─────────────────────────────────────────────────────────
  const disputes_arr    = Array.isArray(p.disputes) ? p.disputes : [];
  const openDisputes    = disputes_arr.filter(d => d.status === 'open').length;
  const resolvedDisputes = disputes_arr.filter(d => d.status !== 'open' && d.status != null).length;

  // ── Review stats ──────────────────────────────────────────────────────────
  const tenants_arr = Array.isArray(p.tenants) ? p.tenants : [];
  const reviewStates = tenants_arr.map(t =>
    window.ReviewEngine ? window.ReviewEngine.deriveTenantReviewState(t, []) : { status: 'incomplete', warnings: [] }
  );
  const tenantsNeedingReview = reviewStates.filter(
    rs => rs.status === 'incomplete' || rs.status === 'needs_review'
  ).length;
  const flaggedLeaseCount = reviewStates.filter(rs => rs.warnings && rs.warnings.length > 0).length;
  const amendmentCount = tenants_arr.reduce(
    (s, t) => s + (Array.isArray(t.amendments) ? t.amendments.length : 0), 0
  );
  const unresolvedWarnings = reviewStates.reduce(
    (s, rs) => s + (rs.warnings ? rs.warnings.length : 0), 0
  );

  // ── Financial stats ───────────────────────────────────────────────────────
  const reconSnap    = p.camReconciliation ?? p.results;
  const reconResults = Array.isArray(reconSnap?.results) ? reconSnap.results : [];
  const totalCAM = Math.round(
    reconResults.reduce((s, r) => s + (Number(r.allocatedAmount) || 0), 0)
  );
  const allocationCoveragePct = invStats.totalExpenseAmount > 0
    ? Math.round((totalCAM / invStats.totalExpenseAmount) * 100)
    : null;

  // ── Health (wraps derivePropertyReadiness + dispute/review penalties) ──────
  const rd = (window.Selectors && typeof window.Selectors.derivePropertyReadiness === 'function')
    ? window.Selectors.derivePropertyReadiness(p)
    : { riskScore: 0, readiness: 'needs_review' };
  let healthScore = Math.max(0, Math.min(100, 100 - (rd.riskScore || 0)));
  const reasons = [];
  if (openDisputes > 0) {
    healthScore = Math.max(0, healthScore - Math.min(20, openDisputes * 7));
    reasons.push(`${openDisputes} open dispute${openDisputes !== 1 ? 's' : ''}`);
  }
  if (tenantsNeedingReview > 0) {
    healthScore = Math.max(0, healthScore - Math.min(15, tenantsNeedingReview * 5));
    reasons.push(`${tenantsNeedingReview} tenant${tenantsNeedingReview !== 1 ? 's' : ''} need review`);
  }
  if (invStats.totalInvoices === 0) reasons.push('No invoices loaded');
  const healthStatus = healthScore >= 80 ? 'healthy' : healthScore >= 50 ? 'warning' : 'high-risk';

  // ── Extraction stats ──────────────────────────────────────────────────────
  const tenantsWithEvidence = tenants_arr.filter(
    t => t.fieldEvidence && Object.keys(t.fieldEvidence).length > 0
  ).length;
  const confVals = tenants_arr.map(t => {
    if (t._confidence === 'high')   return 90;
    if (t._confidence === 'medium') return 70;
    if (t._confidence === 'low')    return 40;
    return null;
  }).filter(v => v !== null);
  const avgConfidence = confVals.length
    ? Math.round(confVals.reduce((s, v) => s + v, 0) / confVals.length)
    : null;

  const metrics = {
    propertyId:     p.id,
    invoiceStats:   { totalInvoices: invStats.totalInvoices, uniqueVendors: invStats.uniqueVendors, totalExpenseAmount: invStats.totalExpenseAmount },
    disputeStats:   { totalDisputes: disputes_arr.length, openDisputes, resolvedDisputes },
    reviewStats:    { tenantsNeedingReview, flaggedLeaseCount, amendmentCount, unresolvedWarnings },
    financialStats: { totalCAM, totalAllocated: totalCAM, allocationCoveragePct },
    health:         { score: healthScore, status: healthStatus, reasons },
    extraction:     { tenantsWithEvidence, tenantsMissingEvidence: tenants_arr.length - tenantsWithEvidence, avgConfidence },
  };

  console.log('[DERIVED METRICS]', {
    propertyId:   p.id,
    invoiceCount: invStats.totalInvoices,
    openDisputes,
    healthScore,
    warningCount: unresolvedWarnings,
    sourceVersion: p.derivedStateVersion ?? 0,
  });

  return metrics;
}

/**
 * Computes fresh derived metrics for a property, caches the result on the
 * property object, and updates the debug window object. Call after every
 * mutation: lease upload, amendment, invoice import, dispute submit/resolve,
 * review confirm, sync restore.
 *
 * @param {object} property  - _props[] entry for the active property
 */
function rebuildDerivedState(property, { appendTimeline = false } = {}) {
  if (!property) return;
  const metrics = derivePropertyMetrics(property);
  if (!metrics) return;

  property._derivedMetrics     = metrics;
  property.derivedStateVersion = (property.derivedStateVersion || 0) + 1;

  window.ms_metricsDebug = {
    propertyId:  metrics.propertyId,
    metrics,
    computedAt:  new Date().toISOString(),
  };

  // Mirror key values onto _props[] entry for portfolioKPIs() aggregation
  const entry = (_props || []).find(q => q.id === property.id);
  if (entry && entry !== property) {
    entry.openDisputes        = metrics.disputeStats.openDisputes;
    entry.totalCAM            = metrics.financialStats.totalCAM;
    entry._derivedMetrics     = metrics;
    entry.derivedStateVersion = property.derivedStateVersion;
  }

  if (appendTimeline) {
    appendPropertyTimelineEvent(property, {
      type:        'derived_metrics_rebuilt',
      severity:    'info',
      title:       'Derived metrics rebuilt',
      description: `Health: ${metrics.health.status}, v${property.derivedStateVersion}`,
      metadata:    { healthScore: metrics.health.score, healthStatus: metrics.health.status },
    });
  }
}

function appendPropertyTimelineEvent(property, event) {
  if (!property || !event) return null;
  if (!Array.isArray(property.timeline)) property.timeline = [];
  const now = new Date().toISOString();
  const entry = {
    id:                  event.id || ('tl-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8)),
    timestamp:           event.timestamp || now,
    type:                event.type || 'unknown',
    severity:            (['critical','warning','info','success'].includes(event.severity) ? event.severity : 'info'),
    propertyId:          event.propertyId ?? property.id ?? null,
    tenantId:            event.tenantId   ?? null,
    actor:               event.actor      ?? 'System',
    source:              event.source     ?? null,
    title:               event.title      ?? '',
    description:         event.description ?? '',
    metadata:            (event.metadata && typeof event.metadata === 'object') ? event.metadata : {},
    relatedEvidenceIds:  Array.isArray(event.relatedEvidenceIds)  ? event.relatedEvidenceIds  : [],
    relatedDisputeIds:   Array.isArray(event.relatedDisputeIds)   ? event.relatedDisputeIds   : [],
    relatedInvoiceIds:   Array.isArray(event.relatedInvoiceIds)   ? event.relatedInvoiceIds   : [],
    derivedStateVersion: event.derivedStateVersion ?? property.derivedStateVersion ?? null,
  };
  property.timeline.push(entry);
  if (property.timeline.length > 500) property.timeline = property.timeline.slice(-500);
  window.ms_timelineDebug = {
    propertyId:   property.id,
    lastEvent:    entry,
    totalEvents:  property.timeline.length,
    updatedAt:    now,
  };
  console.log('[TIMELINE]', entry.type, '|', entry.severity, '|', entry.title, '| v' + (entry.derivedStateVersion ?? '?'));
  return entry;
}

function derivePropertyTimeline(property) {
  const tl = Array.isArray(property.timeline) ? property.timeline : [];
  return {
    totalEvents:      tl.length,
    criticalEvents:   tl.filter(e => e.severity === 'critical'),
    recentActivity:   tl.slice(-10).reverse(),
    disputeHistory:   tl.filter(e => e.type === 'dispute_created' || e.type === 'dispute_resolved'),
    amendmentHistory: tl.filter(e => e.type === 'amendment_uploaded' || e.type === 'amendment_applied'),
    extractionHistory:tl.filter(e => ['lease_uploaded','extraction_completed','extraction_warning'].includes(e.type)),
  };
}

function renderPropertyActivity(property) {
  const slot = document.getElementById('propertyActivitySlot');
  if (!slot) return;
  const tl = Array.isArray(property.timeline) ? property.timeline.slice().reverse() : [];
  if (!tl.length) { slot.innerHTML = ''; return; }

  const _SEVERITY_DOT = { critical: 'tl-dot--red', warning: 'tl-dot--yellow', success: 'tl-dot--green', info: 'tl-dot--blue' };
  const _SEVERITY_ICON = { critical: '⛔', warning: '⚠', success: '✓', info: 'ℹ' };
  const _TYPE_LABEL = {
    lease_uploaded: 'Lease', extraction_completed: 'Extraction', extraction_warning: 'Extraction',
    amendment_uploaded: 'Amendment', amendment_applied: 'Amendment', field_overridden: 'Field',
    review_confirmed: 'Review', invoice_imported: 'Invoice', dispute_created: 'Dispute',
    dispute_resolved: 'Dispute', sync_restored: 'Sync', merge_recovered: 'Merge',
    export_generated: 'Export', derived_metrics_rebuilt: 'Metrics',
  };
  const fmtTs = ts => {
    try { const d = new Date(ts); return d.toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' }) + ' ' + d.toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit' }); }
    catch { return ts; }
  };
  const rows = tl.slice(0, 50).map((ev, idx) => {
    const dotCls = _SEVERITY_DOT[ev.severity] || 'tl-dot--blue';
    const icon   = _SEVERITY_ICON[ev.severity] || 'ℹ';
    const lbl    = _TYPE_LABEL[ev.type] || ev.type;
    const metaStr = ev.metadata && Object.keys(ev.metadata).length
      ? Object.entries(ev.metadata).map(([k,v]) => `<span class="pa-meta-kv"><span class="pa-meta-k">${esc(k)}</span><span class="pa-meta-v">${esc(String(v))}</span></span>`).join('')
      : '';
    const expand  = metaStr ? `<details class="pa-meta-row"><summary class="pa-meta-toggle">Details</summary>${metaStr}</details>` : '';
    const tenantHtml = ev.tenantId ? `<span class="tl-entity">Tenant ${esc(ev.tenantId.slice(0,8))}</span>` : '';
    return `<div class="tl-item">
      <div class="tl-track"><div class="tl-dot ${dotCls}"></div>${idx < tl.length - 1 ? '<div class="tl-line"></div>' : ''}</div>
      <div class="tl-content">
        <div class="tl-top">
          <span class="tl-type-badge">${esc(lbl)}</span>
          <span class="pa-sev-icon">${icon}</span>
          <span class="tl-title">${esc(ev.title)}</span>
        </div>
        ${ev.description ? `<div class="tl-detail">${esc(ev.description)}</div>` : ''}
        <div class="tl-meta">
          <span class="tl-ts">${fmtTs(ev.timestamp)}</span>
          ${ev.actor && ev.actor !== 'System' ? `<span class="tl-actor">${esc(ev.actor)}</span>` : ''}
          ${tenantHtml}
        </div>
        ${expand}
      </div>
    </div>`;
  }).join('');

  slot.innerHTML = `<div class="ap-panel" id="propertyActivityPanel">
    <div class="ap-header" onclick="document.getElementById('paBody').classList.toggle('ap-body--open');this.querySelector('.ap-chevron').classList.toggle('ap-chevron--open')">
      <div class="ap-header-left"><span class="ap-title">&#x1F4CB;&nbsp; Property Activity &mdash; ${tl.length} event${tl.length !== 1 ? 's' : ''}</span></div>
      <div class="ap-header-right"><span class="ap-chevron">&#x25BC;</span></div>
    </div>
    <div id="paBody" class="ap-body ap-body--open">
      <div class="tl-list">${rows}</div>
      ${tl.length > 50 ? `<div class="tl-detail" style="padding:6px 0">Showing 50 of ${tl.length} events</div>` : ''}
    </div>
  </div>`;
}

// ── Lease Expiration Alert Panel ──────────────────────────────────────────────

function dismissLeaseAlerts() {
  _leaseAlertsDismissed = true;
  const el = document.getElementById('leaseAlertPanel');
  if (el) el.innerHTML = '';
}

function toggleLeaseAlertMedium() {
  const rows = document.getElementById('laMediumRows');
  const icon = document.getElementById('laMediumToggleIcon');
  if (!rows) return;
  const expanded = rows.style.display !== 'none';
  rows.style.display = expanded ? 'none' : '';
  if (icon) icon.innerHTML = expanded ? '&#x25BC;' : '&#x25B2;';
}

function _renderLeaseAlertPanel(rar) {
  if (_leaseAlertsDismissed || rar.total === 0) return '';

  const fmtDate = iso => {
    const d = new Date(iso + 'T12:00:00');
    return isNaN(d.getTime()) ? iso
      : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };
  const fmtRent = v => v != null && v > 0
    ? '$' + Math.round(v).toLocaleString('en-US') + '/yr'
    : null;

  const renderRow = (alert, tier) => {
    const daysBadge = tier === 'expired'
      ? `<span class="la-days la-days--expired">Expired ${Math.abs(alert.daysToExpiry)}d ago</span>`
      : `<span class="la-days la-days--${tier}">${alert.daysToExpiry}d</span>`;
    const rentStr  = fmtRent(alert.annualRent);
    const rentHtml = rentStr ? `<span class="la-revenue">${rentStr}</span>` : '';
    const renewal  = alert.hasRenewal ? '<span class="la-renewal">&#x1F504;&nbsp;option</span>' : '';
    const suite    = alert.suite ? ` <span class="la-suite">· ${esc(alert.suite)}</span>` : '';
    return `
    <div class="la-row" onclick="navigateToPropertyTenant('${esc(alert.propertyId)}','${esc(alert.tenantName)}')">
      <span class="la-dot la-dot--${tier}"></span>
      <div class="la-tenant">${esc(alert.tenantName)}${suite}</div>
      <div class="la-property">${esc(alert.propertyName)}</div>
      <div class="la-date">${fmtDate(alert.endDate)}</div>
      <div class="la-meta">
        ${daysBadge}${rentHtml}${renewal}
        <button class="la-pipeline-link" onclick="event.stopPropagation();scrollToRenewalPipeline('${esc(alert.propertyId)}','${esc(alert.tenantName)}')" title="View in Renewal Pipeline">Pipeline &#x2193;</button>
      </div>
    </div>`;
  };

  const urgentRows = [
    ...rar.expired.map(a  => renderRow(a, 'expired')),
    ...rar.critical.map(a => renderRow(a, 'critical')),
    ...rar.high.map(a     => renderRow(a, 'high')),
  ].join('');

  const mediumRentNote = rar.byTier?.medium?.annualRent > 0
    ? ` · ${fmtRent(rar.byTier.medium.annualRent)}`
    : '';
  const mediumSection = rar.medium.length ? `
  <div class="la-expander">
    <button class="la-expand-btn" onclick="event.stopPropagation();toggleLeaseAlertMedium()">
      <span id="laMediumToggleIcon">&#x25BC;</span>&nbsp; ${rar.medium.length} more expiring within 6 months${mediumRentNote}
    </button>
    <div id="laMediumRows" style="display:none">
      ${rar.medium.map(a => renderRow(a, 'medium')).join('')}
    </div>
  </div>` : '';

  // Header badge: count + revenue when data is available
  const urgentRentStr = fmtRent(rar.urgentAnnualAtRisk);
  const badgeText = rar.urgent > 0
    ? `${rar.urgent} urgent${urgentRentStr ? ' · ' + urgentRentStr : ''}`
    : `${rar.medium.length} upcoming`;
  const badge = rar.urgent > 0
    ? `<span class="la-count--urgent">${badgeText}</span>`
    : `<span class="la-count--medium">${badgeText}</span>`;

  // Revenue summary row when we have totals
  const rarSummary = rar.totalAnnualAtRisk > 0 ? `
  <div class="la-rar-summary">
    <span class="la-rar-label">Revenue at Risk</span>
    <span class="la-rar-urgent">${fmtRent(rar.urgentAnnualAtRisk) || '—'} urgent</span>
    <span class="la-rar-sep">·</span>
    <span class="la-rar-total">${fmtRent(rar.totalAnnualAtRisk) || '—'} total</span>
    ${rar.totalSqftAtRisk > 0
      ? `<span class="la-rar-sqft">${Math.round(rar.totalSqftAtRisk).toLocaleString('en-US')} sf exposed</span>`
      : ''}
  </div>` : '';

  return `
  <div class="la-panel">
    <div class="la-header">
      <span class="la-title">&#x1F514; Lease Expiration Alerts</span>
      ${badge}
      <button class="la-dismiss" onclick="dismissLeaseAlerts()" title="Dismiss for this session">&#x2715;</button>
    </div>
    ${rarSummary}
    ${urgentRows}
    ${mediumSection}
  </div>`;
}

function renderPortfolio(props) {
  props = props || _props; // handle no-arg calls
  if (!Array.isArray(props)) {
    console.error('[renderPortfolio] called with invalid data:', props);
    return;
  }

  // Per-property metadata (risk, confidence, trend, timestamps)
  const metas = props.map(p => Selectors.buildPropMeta(p));

  // Deterministic sort via Selectors — always has a stable tiebreaker, never returns 0
  const sortedPairs = Selectors.sortProperties(props.map((p, i) => ({ p, m: metas[i] })), _portfolioSort);

  // KPI tiles
  const k = portfolioKPIs(props);
  // Use live dispute count from p.disputes[] — p.openDisputes is only written on save so can be stale
  const liveOpenDisputes = props.reduce((s, p) => s + (p.disputes || []).filter(d => d.status === 'open').length, 0);
  document.getElementById('pKpiProperties').textContent  = k.properties;
  document.getElementById('pKpiCAM').textContent         = k.cam > 0 ? '$' + k.cam.toLocaleString('en-US') : '—';
  document.getElementById('pKpiDisputes').textContent    = liveOpenDisputes;
  document.getElementById('pKpiCritical').textContent    = k.criticalOrElevated;
  document.getElementById('pKpiMissingDocs').textContent = k.totalMissingDocs;
  document.getElementById('pKpiConfidence').textContent  = k.avgConf !== null ? k.avgConf + '%' : '—';

  // Light up non-risk KPIs from muted placeholder to amber once data is populated
  const propEl = document.getElementById('pKpiProperties');
  const camEl  = document.getElementById('pKpiCAM');
  const confEl = document.getElementById('pKpiConfidence');
  if (propEl) propEl.style.color = '#C9973A';
  if (camEl)  camEl.style.color  = k.cam > 0 ? '#C9973A' : '';
  if (confEl) confEl.style.color = k.avgConf !== null ? '#C9973A' : '';

  // Conditional accent on risk-sensitive KPIs
  const critEl = document.getElementById('pKpiCritical');
  const dispEl = document.getElementById('pKpiDisputes');
  const missEl = document.getElementById('pKpiMissingDocs');
  if (critEl) critEl.style.color = k.criticalOrElevated > 0 ? '#f87171' : '#C9973A';
  if (dispEl) dispEl.style.color = liveOpenDisputes       > 0 ? '#f87171' : '#C9973A';
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

  // Revenue-at-Risk + Lease Expiration Alerts
  const rar          = AcquisitionEngine.computeRevenueAtRisk(props);
  const alertPanelEl = document.getElementById('leaseAlertPanel');
  if (alertPanelEl) alertPanelEl.innerHTML = _renderLeaseAlertPanel(rar);

  // Update "At-Risk Properties" KPI sub-value with revenue exposure
  const rarSubEl = document.getElementById('pKpiExpiryRevenue');
  if (rarSubEl) {
    if (rar.urgentAnnualAtRisk > 0) {
      rarSubEl.textContent = '$' + Math.round(rar.urgentAnnualAtRisk).toLocaleString('en-US') + '/yr at risk';
      rarSubEl.style.display = '';
    } else {
      rarSubEl.style.display = 'none';
    }
  }

  // Build per-property expiry lookup for card badges
  const _propAlertMap = new Map();
  const _markProp = (a, tier) => {
    const cur = _propAlertMap.get(a.propertyId);
    if (!cur) { _propAlertMap.set(a.propertyId, { total: 1, tier }); return; }
    cur.total++;
    if (tier === 'expired' || (tier === 'critical' && cur.tier !== 'expired')) cur.tier = tier;
    else if (tier === 'high' && !['expired','critical'].includes(cur.tier)) cur.tier = tier;
  };
  rar.expired.forEach(a  => _markProp(a, 'expired'));
  rar.critical.forEach(a => _markProp(a, 'critical'));
  rar.high.forEach(a     => _markProp(a, 'high'));
  rar.medium.forEach(a   => _markProp(a, 'medium'));

  // Action Center (topmost — shows today's 5-10 priority items)
  renderActionCenter(props, _acqReviews, rar);

  // Portfolio intelligence panel (above cards grid)
  renderPortfolioIntelligence(props, rar);
  renderRenewalPipeline(props);

  // Recovered Revenue Dashboard (below intelligence panel)
  renderRecoveredRevenueDashboard(props);

  // First-time welcome modal (no-op if user already has properties or has seen it)
  _maybeShowWelcome(props);

  // Property cards
  const statusLabel = { reconciled: 'Reconciled', 'in-progress': 'In Progress', disputes: 'Has Open Disputes' };

  document.getElementById('propertyCardsGrid').innerHTML = sortedPairs.map(({ p, m }) => {
    const dm      = p._derivedMetrics || derivePropertyMetrics(p);
    const tenants = Array.isArray(p.tenants) ? p.tenants.length : (Number(p.tenantCount) || 0);
    const cam     = m.total || Number(p.totalCAM) || 0;
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

    const reviewItems   = getReviewQueueItems([p]).filter(i => !i.reviewerConfirmed);
    const reviewChips   = _rqPropCardBullets(reviewItems);
    const pid           = esc(p.id);

    const hasIncomplete   = reviewItems.some(i => i.reviewState === 'incomplete');
    const reviewUrgency   = reviewItems.length === 0 ? '' : hasIncomplete ? ' review--incomplete' : ' review--needs-review';
    const reviewHealth    = Selectors.computeReviewHealth(reviewItems);
    const healthCls       = Selectors.reviewHealthClass(reviewHealth);

    const rd = derivePropertyReadiness(p);
    const rdBadge   = `<span class="ptf-rdy-badge rdy-${rd.readiness}">${esc(_RDY_LABELS[rd.readiness] || rd.readiness)}</span>`;
    const rdInsight = rd.insight ? `<div class="ptf-insight">${esc(rd.insight)}</div>` : '';
    const rdCardCls = rd.readiness === 'high_risk'            ? ' rdy-high-risk-card'
                    : rd.readiness === 'reconciliation_ready' ? ' rdy-ready-card'
                    : rd.readiness === 'reconciled'           ? ' rdy-reconciled-card'
                    : '';

    return `
    <div class="ptf-prop-card status-${status}${activePropId === p.id ? ' active' : ''}${reviewUrgency}${rdCardCls}" onclick="selectProperty('${pid}')">
      <div class="ptf-card-top">
        <div class="ptf-prop-name">${esc(p.name || '—')}</div>
        <div class="ptf-card-badges">
          ${rdBadge}
        </div>
      </div>
      <div class="ptf-status-row">
        <span class="ptf-status-dot ${status}"></span>
        <span>${statusLabel[status] || status}</span>
        ${trendHtml}
      </div>
      ${rdInsight}
      ${(() => {
        const ea = _propAlertMap.get(p.id);
        if (!ea) return '';
        const isExpired = ea.tier === 'expired';
        const isUrgent  = isExpired || ea.tier === 'critical';
        const cls   = isUrgent ? 'ptf-stat--alert' : 'ptf-stat--warn';
        const label = isExpired ? `Expired` : 'Expiring';
        return `<div class="ptf-lease-expiry-banner ptf-lease-expiry--${isUrgent ? 'urgent' : 'warn'}">
          &#x1F514; ${ea.total} lease${ea.total !== 1 ? 's' : ''} ${label}
        </div>`;
      })()}
      <div class="ptf-stats-row">
        <div class="ptf-stat"><strong>${tenants}</strong>Tenants</div>
        ${dm.reviewStats.flaggedLeaseCount > 0
          ? `<div class="ptf-stat ptf-stat--warn"><strong>${dm.reviewStats.flaggedLeaseCount}</strong>Lease Warnings</div>`
          : ''}
        ${dm.disputeStats.openDisputes > 0
          ? `<div class="ptf-stat ptf-stat--alert"><strong>${dm.disputeStats.openDisputes}</strong>Disputes</div>`
          : ''}
        ${m.missingDocs > 0
          ? `<div class="ptf-stat ptf-stat--warn"><strong>${m.missingDocs}</strong>Missing Docs</div>`
          : ''}
      </div>
      ${reviewChips.length > 0 ? `
      <div class="property-review-summary">
        <span class="review-info">
          ${reviewChips.map(c => `<span class="review-chip ${c.cls}">${esc(c.label)}</span>`).join('')}
          <span class="review-health ${healthCls}">${reviewHealth}% Healthy</span>
        </span>
        <button class="review-queue-btn" onclick="event.stopPropagation();selectProperty('${pid}')">AI Review ›</button>
      </div>` : `
      <div class="ptf-card-action-row">
        <button class="ptf-card-open-btn" onclick="event.stopPropagation();selectProperty('${pid}')">Open ›</button>
      </div>`}
      ${cam > 0 ? `<div class="ptf-cam-lbl">CAM Reconciled</div><div class="ptf-cam-val">$${cam.toLocaleString('en-US')}</div>` : ''}
      ${footParts.length ? `<div class="ptf-card-foot">${footParts.join('')}</div>` : ''}
      ${m.avgConf !== null
        ? `<div class="ptf-conf-bar" title="${m.avgConf}% avg. match confidence">
             <div class="ptf-conf-fill" style="width:${m.avgConf}%"></div>
           </div>`
        : ''}
    </div>`;
  }).join('') || `
    <div class="ptf-empty-state">
      <div class="ptf-empty-icon">&#x1F3E2;</div>
      <div class="ptf-empty-title">No properties yet</div>
      <div class="ptf-empty-desc">Add your first property to get CAM reconciliation, cap enforcement, and audit-ready tenant statements — in about 5 minutes.</div>
      <div class="ptf-empty-cta">
        <button class="ptf-empty-btn-primary" onclick="addNewProperty()">+ Create First Property</button>
        <button class="ptf-empty-btn-secondary" onclick="loadDemo()">&#x1F3AF; Try Live Demo</button>
      </div>
    </div>`;

  // Hero identity text always visible — it's the brand anchor.
  // Only hide the first-run CTA ("Start by running a demo…") once the user has properties.
  const hasProps = props.length > 0;
  const startEl = document.querySelector('.start-here');
  if (startEl) startEl.style.display = hasProps ? 'none' : '';

  renderReviewQueue(props);

  document.getElementById('portfolioDashboard').style.display = 'block';
  document.getElementById('propertyBreadcrumb').style.display = 'none';
  document.getElementById('mainWorkflow').style.display       = 'none';
}

async function selectProperty(id) {
  // Tenants use _initTenantPortal() as their data path — they never enter the main workflow
  if (window.AuthService?.getCurrentUser()?.role === 'tenant') return;
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
      rebuildDerivedState(property); // rebuild after LS/DB merge so metrics reflect loaded data
      appendPropertyTimelineEvent(property, { type: 'sync_restored', severity: 'info',
        actor: 'System', title: 'Property state restored from sync',
        metadata: { tenantCount: (property.tenants||[]).length, hasReconciliation: !!(property.camReconciliation ?? property.results) } });
      console.log('[selectProperty] SECOND renderProperty done — mainWorkflow display:', document.getElementById('mainWorkflow')?.style.display, 'portfolio display:', document.getElementById('portfolioDashboard')?.style.display);
    }
  }, 0);
}

async function backToPortfolio() {
  // Tenant: re-show portal instead of landlord portfolio
  if (window.AccessControl && window.AuthService &&
      window.AccessControl.isTenantPortalMode(window.AuthService.getCurrentUser())) {
    _activateTenantPortal();
    return;
  }
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
      rebuildDerivedState(prop);
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
  _renderAcqSection(_acqReviews);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function addNewProperty() {
  if (window.AccessControl && window.AuthService && !window.AccessControl.canAddProperty(window.AuthService.getCurrentUser())) return;
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

  rebuildDerivedState(prop);
  document.getElementById('breadcrumbPropName').textContent = prop.name;
  await saveProperty(prop);
}

function resetWorkflow() {
  // Cancel any pending debounce save from the previous property — prevents a
  // timed-out write from firing after activePropId has already changed.
  clearTimeout(_saveDebounceTimer);
  _saveDebounceTimer = null;

  // Reset tenant data for both modes
  tenantData.splice(0, tenantData.length, null, null, null);
  document.getElementById('bulkResults').innerHTML = '';
  document.getElementById('bulkProgress').style.display = 'none';
  document.getElementById('bulkLeaseInput').value = '';
  switchLeaseTab('bulk');

  invoiceData.length = 0;
  lastResults = []; lastInvoices = []; lastTenants = [];
  lastPropName = ''; lastTotal = 0; lastInvoicesFull = []; lastFullResults = [];
  _lastReconIssues = []; _dwActiveDid = null;
  activityLog.splice(0, activityLog.length);
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
  // Advance step bar once a real name is typed
  if (name && name.trim() && name.trim() !== 'New Property') {
    const sqft = parseFloat(document.getElementById('totalSqft')?.value) || 0;
    if (sqft > 0) _obSyncState();
  }
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
    const stored = JSON.parse(_lsGet(_lsUserKey()) || '{}');
    stored[property.id] = _stripBlobs(property);
    _lsSet(_lsUserKey(), JSON.stringify(stored));
  } catch (e) { }
}

function _lsLoadAll() {
  try {
    const stored = JSON.parse(_lsGet(_lsUserKey()) || '{}');
    const rows = Object.values(stored);
    return rows.length ? rows : null;
  } catch (e) { return null; }
}

function _lsLoad(id) {
  try {
    const stored = JSON.parse(_lsGet(_lsUserKey()) || '{}');
    return stored[id] || null;
  } catch (e) { return null; }
}

// ── Persistence integrity helpers ─────────────────────────────────────────────

/**
 * Normalizes raw property data from any storage source into a canonical shape.
 * Guarantees all arrays/objects are valid. Runs targeted schema migrations.
 * Returns null when input is not an object. Never throws.
 * Sets _schemaVersion and _migrated on the returned object.
 */
function normalizePropertyState(data) {
  if (!data || typeof data !== 'object') return null;
  const schemaVersion = data._schemaVersion || 0;
  let migrated = schemaVersion < STATE_SCHEMA_VERSION;
  let malformed = false;

  const tenants = (() => {
    if (!Array.isArray(data.tenants)) return [];
    return data.tenants.filter(t => {
      if (!t || typeof t !== 'object') { malformed = true; return false; }
      // Reject objects with no identifying tenant fields — not a tenant record.
      if (!t.id && !t.tenant_name && !t.name) { malformed = true; return false; }
      return true;
    }).map(t => normalizeTenant(t));
  })();

  const disputes = (() => {
    if (!Array.isArray(data.disputes)) return [];
    return data.disputes.filter(d => {
      if (!d || typeof d !== 'object' || !d.id) { malformed = true; return false; }
      return true;
    });
  })();

  const activityLogNorm = (() => {
    if (!Array.isArray(data.activityLog)) return [];
    return data.activityLog.filter(e => {
      if (!e || typeof e !== 'object' || !e.type || !e.timestamp) { malformed = true; return false; }
      return true;
    });
  })();

  const invoices = (() => {
    if (!Array.isArray(data.invoices)) return [];
    return data.invoices.filter(i => i && typeof i === 'object');
  })();

  return {
    ...data,
    tenants,
    disputes,
    activityLog: activityLogNorm,
    invoices,
    _schemaVersion: STATE_SCHEMA_VERSION,
    _migrated:      migrated,
    _malformed:     malformed,
  };
}

/**
 * Sanitizes externally-imported property data before merging into app state.
 * Removes NaN values, deduplicates tenant IDs, clamps confidence ranges,
 * discards invalid dates, and enforces known enum values.
 */
function sanitizeImportedPropertyData(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const VALID_DISPUTE_STATUSES = new Set(['open', 'resolved', 'escalated', 'withdrawn']);
  const VALID_REVIEW_STATUSES  = new Set(['verified', 'needs_review', 'incomplete', 'manually_verified']);

  const seenIds = new Set();
  const tenants = (Array.isArray(raw.tenants) ? raw.tenants : [])
    .filter(t => {
      if (!t || typeof t !== 'object') return false;
      const key = t.id || t.tenant_name;
      if (!key || seenIds.has(key)) return false;
      seenIds.add(key);
      return true;
    })
    .map(t => {
      const n = normalizeTenant(t);
      if (n.start_date && isNaN(new Date(n.start_date).getTime())) n.start_date = null;
      if (n.end_date   && isNaN(new Date(n.end_date).getTime()))   n.end_date   = null;
      if (n.confidence && typeof n.confidence === 'object') {
        Object.keys(n.confidence).forEach(k => {
          const v = parseFloat(n.confidence[k]);
          n.confidence[k] = isNaN(v) ? 100 : Math.max(0, Math.min(100, v));
        });
      }
      if (n.review?.status && !VALID_REVIEW_STATUSES.has(n.review.status)) {
        delete n.review.status;
      }
      if (typeof n.leased_sqft === 'number' && isNaN(n.leased_sqft)) n.leased_sqft = null;
      if (typeof n.cap === 'number' && isNaN(n.cap))                  n.cap = null;
      return n;
    });

  const disputes = (Array.isArray(raw.disputes) ? raw.disputes : [])
    .filter(d => d && typeof d === 'object' && d.id)
    .map(d => ({
      ...d,
      status: VALID_DISPUTE_STATUSES.has(d.status) ? d.status : 'open',
      amount: (typeof d.amount === 'number' && !isNaN(d.amount)) ? d.amount : 0,
    }));

  return { ...raw, tenants, disputes };
}

/**
 * Captures a lightweight pre-save snapshot of critical state for recovery.
 * Overwrites any previous snapshot for the same propertyId.
 */
function _captureSnapshot(prop) {
  if (!prop?.id) return;
  _snapshots[prop.id] = {
    propertyId:  prop.id,
    timestamp:   new Date().toISOString(),
    tenants:     (prop.tenants   || []).map(t => ({ ...t })),
    disputes:    (prop.disputes  || []).map(d => ({ ...d })),
    activityLog: [...(prop.activityLog || [])],
    reviewState: (prop.tenants  || []).map(t => ({
      id: t.id, review: { ...(t.review || {}) }, reviewOverrides: { ...(t.reviewOverrides || {}) },
    })),
  };
}

/**
 * Returns the last pre-save snapshot for a given propertyId, or null.
 * Exposed on window for dev/QA console access.
 * Emits a snapshot_restored audit event when called while the property is active.
 */
function recoverLastSnapshot(propertyId) {
  const snap = _snapshots[propertyId] || null;
  if (snap && activePropId === propertyId) {
    _auditDirect('snapshot_restored', 'Recovery snapshot available', {
      severity: 'warning',
      detail:   `Last pre-save snapshot from ${snap.timestamp} — ${snap.tenants.length} tenant(s)`,
      propertyId,
    });
  }
  return snap;
}
window.recoverLastSnapshot = recoverLastSnapshot;

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
  // SECURITY: no client-side auth check here — propertyId comes from the caller.
  // Supabase RLS on the tenants table is the authoritative guard. Add RLS in Phase 8C-hardening.
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

// ─────────────────────────────────────────────────────────────────────────────
// Phase 23 — CAM Validation Against Lease
// ─────────────────────────────────────────────────────────────────────────────

const _LV_ADMIN_KEYWORDS = ['admin', 'administrative', 'management fee', 'mgmt fee', 'property management'];

// Tier 1: deterministic checks using already-extracted tenant fields. Runs
// entirely in-browser — no server call, no Claude. Returns findings instantly.
function _tier1LeaseChecks(tenant, totalExpenses, lineItems, reconciledAt) {
  const findings  = [];
  const today     = new Date();
  const cap       = typeof tenant.admin_fee_pct === 'number' ? tenant.admin_fee_pct : null;
  const auditText = tenant.audit_rights || null;
  const adminFeeEvidence = tenant.fieldEvidence?.admin_fee_pct?.snapshots?.[0];
  const quote     = adminFeeEvidence?.quote || null;

  // MGMT_FEE_CAP ──────────────────────────────────────────────────────────────
  if (cap !== null && totalExpenses > 0) {
    const adminLines = (lineItems || []).filter(li => {
      const cat = (li.category || '').toLowerCase();
      return _LV_ADMIN_KEYWORDS.some(kw => cat.includes(kw));
    });
    if (adminLines.length > 0) {
      const adminTotal = adminLines.reduce((s, li) => s + (li.amount || 0), 0);
      const actualPct  = (adminTotal / totalExpenses) * 100;
      const exceeded   = actualPct > cap + 0.5;   // 0.5% rounding tolerance
      findings.push({
        check: 'MGMT_FEE_CAP', source: 'deterministic',
        severity:    exceeded ? 'warning' : 'info',
        confidence:  'high',
        finding:     exceeded
          ? `Admin fee (${actualPct.toFixed(1)}%) exceeds the ${cap}% lease cap by ${(actualPct - cap).toFixed(1)} percentage points.`
          : `Admin fee (${actualPct.toFixed(1)}%) is within the ${cap}% lease cap.`,
        quote, section: null, page: null,
        explanation: exceeded
          ? `Reconciliation admin fee of $${adminTotal.toLocaleString()} is ${actualPct.toFixed(1)}% of total CAM ($${totalExpenses.toLocaleString()}), exceeding the ${cap}% cap.`
          : null,
      });
    } else {
      findings.push({
        check: 'MGMT_FEE_CAP', source: 'deterministic',
        severity: 'info', confidence: 'high',
        finding: 'No administrative fee line items identified in this reconciliation.',
        quote: null, section: null, page: null, explanation: null,
      });
    }
  } else {
    findings.push({
      check: 'MGMT_FEE_CAP', source: 'deterministic',
      severity: 'info', confidence: 'high',
      finding: cap === null
        ? 'No management fee cap was extracted from the lease.'
        : 'Total expenses are zero — fee cap check skipped.',
      quote: null, section: null, page: null, explanation: null,
    });
  }

  // AUDIT_RIGHTS ──────────────────────────────────────────────────────────────
  if (auditText) {
    const daysMatch = auditText.match(/(\d+)\s+days?/i);
    if (daysMatch && reconciledAt) {
      const days        = parseInt(daysMatch[1], 10);
      const reconDate   = new Date(reconciledAt);
      const windowClose = new Date(reconDate.getTime() + days * 86400000);
      const expired     = today > windowClose;
      const daysLeft    = Math.round((windowClose - today) / 86400000);
      findings.push({
        check: 'AUDIT_RIGHTS', source: 'deterministic',
        severity:   expired ? 'warning' : 'info',
        confidence: 'high',
        finding:    expired
          ? `Audit window closed ${windowClose.toISOString().slice(0,10)} — ${Math.abs(daysLeft)} days have elapsed past the ${days}-day limit.`
          : `Audit window open — ${daysLeft} days remaining (closes ${windowClose.toISOString().slice(0,10)}).`,
        quote: null, section: null, page: null,
        explanation: expired
          ? `The tenant had ${days} days from ${reconDate.toISOString().slice(0,10)} to request an audit. That window has closed.`
          : null,
      });
    } else {
      findings.push({
        check: 'AUDIT_RIGHTS', source: 'deterministic',
        severity: 'info', confidence: 'medium',
        finding: `Audit rights found but deadline could not be computed: "${(auditText || '').slice(0, 80)}"`,
        quote: null, section: null, page: null, explanation: null,
      });
    }
  } else {
    findings.push({
      check: 'AUDIT_RIGHTS', source: 'deterministic',
      severity: 'info', confidence: 'high',
      finding: 'No audit rights clause was extracted from this lease.',
      quote: null, section: null, page: null, explanation: null,
    });
  }

  return findings;
}

// Renders the validation panel HTML for a given findings array and loading state.
function _renderValidationPanel(findings, { loading = false, charsAnalyzed = null, truncated = false, fileUrl = null } = {}) {
  const SEV_ICON  = { critical: '⛔', warning: '⚠️', info: '✅' };
  const SEV_LABEL = { critical: 'CRITICAL', warning: 'REVIEW', info: 'PASSED' };
  const SEV_CLS   = { critical: 'lv-finding--critical', warning: 'lv-finding--warning', info: 'lv-finding--info' };
  const CHECK_LABELS = {
    MGMT_FEE_CAP:      'Management Fee Cap',
    AUDIT_RIGHTS:      'Audit Rights',
    CAM_EXCLUSIONS:    'CAM Exclusions',
    STRUCT_EXCLUSIONS: 'Structural Exclusions',
    TAX_ALLOCATION:    'Tax Allocation',
  };

  const cards = findings.map(f => {
    const icon    = SEV_ICON[f.severity]  || '✅';
    const label   = SEV_LABEL[f.severity] || 'PASSED';
    const cls     = SEV_CLS[f.severity]   || 'lv-finding--info';
    const title   = CHECK_LABELS[f.check] || f.check;
    const qSafe   = f.quote ? f.quote.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') : null;
    const fSafe   = esc(f.finding);
    const eSafe   = f.explanation ? esc(f.explanation) : null;
    const refParts = [f.section, f.page ? `Page ${f.page}` : null].filter(Boolean);

    const quoteHtml = qSafe
      ? `<blockquote class="lv-quote">${qSafe}</blockquote>
         ${refParts.length ? `<div class="lv-citation">${refParts.join(' · ')}</div>` : ''}`
      : '';
    const explanHtml = eSafe ? `<div class="lv-explanation">${eSafe}</div>` : '';
    const viewBtn    = (f.severity !== 'info' && fileUrl)
      ? `<button class="lv-view-btn" onclick="openLeaseModal(${JSON.stringify(fileUrl)})">View in Lease ↗</button>`
      : '';
    const confCls  = { high: 'lv-conf--high', medium: 'lv-conf--medium', low: 'lv-conf--low' }[f.confidence] || 'lv-conf--medium';

    return `<div class="lv-finding ${cls}">
      <div class="lv-finding-hdr">
        <span class="lv-finding-icon">${icon}</span>
        <span class="lv-finding-title">${esc(title)}</span>
        <span class="lv-sev-badge lv-sev-badge--${f.severity}">${label}</span>
        <span class="lv-conf ${confCls}">${f.confidence}</span>
      </div>
      <div class="lv-finding-body">
        <div class="lv-finding-text">${fSafe}</div>
        ${quoteHtml}${explanHtml}${viewBtn}
      </div>
    </div>`;
  }).join('');

  const critCount = findings.filter(f => f.severity === 'critical').length;
  const warnCount = findings.filter(f => f.severity === 'warning').length;
  const statusText = loading
    ? `${findings.length} check${findings.length !== 1 ? 's' : ''} complete · analyzing clauses…`
    : `${findings.length} check${findings.length !== 1 ? 's' : ''}${warnCount ? ` · ${warnCount} review` : ''}${critCount ? ` · ${critCount} critical` : ''}`;

  const metaLine  = !loading && charsAnalyzed
    ? `<div class="lv-meta">Analyzed ${Math.round(charsAnalyzed/1000)}k chars of stored lease text${truncated ? ' (truncated)' : ''}</div>`
    : '';
  const loadingRow = loading
    ? `<div class="lv-loading">&#x23F3; Checking lease clauses…</div>`
    : '';

  return `<div class="lv-header">
    <span class="lv-title">LEASE VALIDATION</span>
    <span class="lv-status">${statusText}</span>
  </div>
  ${cards}${loadingRow}${metaLine}`;
}

// Coordinator: runs Tier 1 immediately, then POSTs to /api/validate-lease for Tier 2.
// panelEl must already be in the DOM; tenant is the tenantData object; recon is a ReconciliationResult.
async function _runLeaseValidation(panelEl, tenant, recon, totalExpenses) {
  if (!panelEl) return;
  panelEl.style.display = 'block';

  const reconciledAt = `${getCamYear() || new Date().getFullYear()}-12-31`;
  const lineItems    = (recon.includedInvoices || []).map(inv => ({
    category: inv.category || inv.invoiceCategory || 'other',
    amount:   inv.amount   || 0,
  }));

  // Tier 1 — instant, no server call
  const t1 = _tier1LeaseChecks(tenant, totalExpenses, lineItems, reconciledAt);
  panelEl.innerHTML = _renderValidationPanel(t1, { loading: true });

  // Look up the lease document for this tenant
  const prop = currentProperty();
  if (!prop?.id) {
    panelEl.innerHTML = _renderValidationPanel(t1, { loading: false });
    return;
  }

  let leaseDoc = null;
  try {
    const docs = await loadLeaseDocuments(prop.id);
    const tName = (tenant.tenant_name || '').toLowerCase().trim();
    const tId   = tenant.id || null;
    leaseDoc = (docs || []).find(d =>
      (tId && d.tenant_id === tId) ||
      (tName && d.tenant_name && d.tenant_name.toLowerCase().trim() === tName)
    ) || null;
  } catch (e) {
    console.warn('[validate-lease] Could not load lease documents:', e.message);
  }

  if (!leaseDoc?.id) {
    // No linked lease document — show Tier 1 findings only
    panelEl.innerHTML = _renderValidationPanel(t1, { loading: false });
    return;
  }

  // Tier 2 — clause search via Claude
  try {
    const resp = await fetch('/api/validate-lease', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', ...(await _authHeaders()) },
      body:    JSON.stringify({
        leaseDocumentId:    leaseDoc.id,
        reconciliationData: { totalExpenses, year: getCamYear(), lineItems },
      }),
    });
    const result = await resp.json().catch(() => ({}));
    if (!resp.ok || result.error) {
      console.error('[validate-lease] Tier 2 error:', result.error);
      panelEl.innerHTML = _renderValidationPanel(t1, { loading: false });
      return;
    }
    const allFindings = [...t1, ...(result.findings || [])];
    panelEl.innerHTML = _renderValidationPanel(allFindings, {
      loading: false, charsAnalyzed: result.charsAnalyzed,
      truncated: result.truncated, fileUrl: result.fileUrl,
    });
  } catch (e) {
    console.error('[validate-lease] Tier 2 fetch failed:', e.message);
    panelEl.innerHTML = _renderValidationPanel(t1, { loading: false });
  }
}

// Entry point wired to the "Validate Against Lease" button in each result card.
// tenantIdx is the tenantData[] index for the row.
function _startLeaseValidation(panelId, tenantIdx) {
  const panelEl = document.getElementById(panelId);
  if (!panelEl) return;

  // Toggle off if already open
  if (panelEl.style.display !== 'none') {
    panelEl.style.display = 'none';
    return;
  }

  const tenant = tenantIdx >= 0 ? (tenantData[tenantIdx] || {}) : {};
  const name   = tenant.tenant_name || '';
  const recon  = (lastResults || []).find(r => r.name === name || r.tenantId === tenant.id);
  if (!recon) {
    panelEl.style.display = 'block';
    panelEl.innerHTML = `<div class="lv-header"><span class="lv-title">LEASE VALIDATION</span></div>
      <div class="lv-error">No reconciliation data found for this tenant.</div>`;
    return;
  }

  _runLeaseValidation(panelEl, tenant, recon, lastTotal);
}

async function saveCamResults(propertyId, fullResults, year, totalExpenses = null) {
  if (!propertyId || !year) return { ok: false, reason: 'missing propertyId or year' };
  const reconciledAt = new Date().toISOString();
  const rows = (fullResults || []).map(r => {
    const actual   = r.actualCam ?? r.totalAllocated ?? null;
    const expected = r.expectedCam ?? null;
    return {
      property_id:      propertyId,
      tenant_id:        r.tenantId,
      tenant_name:      r.tenantName ?? r.name ?? null,
      actual_cam:       actual,
      expected_cam:     expected,
      variance:         (actual !== null && expected !== null)
        ? Math.round((actual - expected) * 100) / 100
        : (r.variance ?? null),
      allocated_amount: r.allocatedAmount ?? r.totalAllocated ?? actual,
      pro_rata_percent: r.proRataPercent ?? (r.proRata != null ? r.proRata * 100 : null),
      total_expenses:   totalExpenses,
      reconciled_at:    reconciledAt,
      year,
    };
  });
  try {
    const resp = await fetch('/api/cam-reconciliations', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', ...(await _authHeaders()) },
      body:    JSON.stringify({ propertyId, year, rows }),
    });
    const result = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      console.error('[saveCamResults] error:', result.error, result.detail);
      return { ok: false, reason: result.error || `HTTP ${resp.status}`, code: result.code, keySource: result.keySource, detail: result.detail };
    }
    console.log('[saveCamResults] persisted', (result.data || []).length, 'row(s) for', propertyId, 'year', year);
    return { ok: true, rows: (result.data || []).length };
  } catch (e) {
    console.error('[saveCamResults] exception:', e?.message);
    return { ok: false, reason: e?.message || 'network error' };
  }
}

async function loadCamResults(propertyId, year) {
  if (!propertyId || !year) return [];
  const resp = await fetch(`/api/cam-reconciliations?propertyId=${encodeURIComponent(propertyId)}&year=${encodeURIComponent(year)}`, {
    headers: await _authHeaders(),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    console.error('[loadCamResults] error:', err.error);
    if (err.code === 'migration_missing') {
      const e = new Error(err.error || 'migration_missing');
      e.code = 'migration_missing';
      throw e;
    }
    return [];
  }
  const { data } = await resp.json();
  return data || [];
}

// Loads all persisted reconciliation rows for a property across every CAM year.
// Returns rows sorted by year (desc) then tenant. Used for historical queries
// and the DB Health diagnostic. Falls back to [] on any error.
async function loadCamHistory(propertyId) {
  if (!propertyId) return [];
  try {
    const resp = await fetch(`/api/cam-reconciliations?propertyId=${encodeURIComponent(propertyId)}&history=all`, {
      headers: await _authHeaders(),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      console.error('[loadCamHistory] error:', err.error);
      return [];
    }
    const { data } = await resp.json();
    return data || [];
  } catch (e) {
    console.error('[loadCamHistory] exception:', e?.message);
    return [];
  }
}
window.ms_loadCamHistory = loadCamHistory;

// ─── Phase 22A: Lease Document Persistence ───────────────────────────────────

async function saveLeaseDocument({ propertyId, tenantId, tenantName, fileName, fileUrl, extractedText, parsingStatus, extractionModel, usedPdfDirect }) {
  if (!propertyId || !fileName) return { ok: false, reason: 'missing propertyId or fileName' };
  try {
    const resp = await fetch('/api/lease-documents', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', ...(await _authHeaders()) },
      body:    JSON.stringify({ propertyId, tenantId, tenantName, fileName, fileUrl, extractedText, parsingStatus, extractionModel, usedPdfDirect }),
    });
    const result = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      console.error('[saveLeaseDocument] error:', result.error, result.detail);
      return { ok: false, reason: result.error || `HTTP ${resp.status}`, code: result.code, keySource: result.keySource, detail: result.detail };
    }
    console.log('[saveLeaseDocument] persisted', fileName, 'for property', propertyId);
    return { ok: true, data: result.data };
  } catch (e) {
    console.error('[saveLeaseDocument] exception:', e?.message);
    return { ok: false, reason: e?.message || 'network error' };
  }
}

async function loadLeaseDocuments(propertyId) {
  if (!propertyId) return [];
  try {
    const resp = await fetch(`/api/lease-documents?propertyId=${encodeURIComponent(propertyId)}`, {
      headers: await _authHeaders(),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      console.error('[loadLeaseDocuments] error:', err.error);
      return [];
    }
    const { data } = await resp.json();
    return data || [];
  } catch (e) {
    console.error('[loadLeaseDocuments] exception:', e?.message);
    return [];
  }
}

async function deleteLeaseDocument(id) {
  if (!id) return { ok: false, reason: 'missing id' };
  try {
    const resp = await fetch(`/api/lease-documents?id=${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: await _authHeaders(),
    });
    const result = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      return { ok: false, reason: result.error || `HTTP ${resp.status}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e?.message || 'network error' };
  }
}

function renderLeaseCenter(propertyId) {
  const panel = document.getElementById('leasePanelCenter');
  if (!panel) return;

  panel.innerHTML = `<div style="padding:16px 0;color:#94a3b8;font-size:0.875rem;">Loading lease documents…</div>`;

  loadLeaseDocuments(propertyId).then(docs => {
    if (!docs.length) {
      panel.innerHTML = `
        <div style="padding:24px 0;text-align:center;color:#64748b;">
          <div style="font-size:2rem;margin-bottom:8px;">📄</div>
          <div style="font-weight:600;margin-bottom:4px;color:#94a3b8;">No leases stored yet</div>
          <div style="font-size:0.8rem;margin-bottom:12px;max-width:320px;margin-left:auto;margin-right:auto;">
            Upload lease PDFs in the <strong style="color:#818cf8;">Upload Leases</strong> tab.
            Once extracted, you can ask questions about any lease here.
          </div>
          <button style="padding:7px 16px;background:#4f46e5;border:none;border-radius:7px;color:#fff;font-size:0.76rem;font-weight:700;cursor:pointer;"
            onclick="switchLeaseTab('bulk')">Go to Upload Leases ↑</button>
        </div>`;
      return;
    }

    const rows = docs.map(doc => {
      const statusColor = { success: '#22c55e', partial: '#f59e0b', failed: '#ef4444', pending: '#94a3b8' }[doc.parsing_status] || '#94a3b8';
      const uploadDate  = doc.created_at ? new Date(doc.created_at).toLocaleDateString() : '—';
      const modelLabel  = doc.used_pdf_direct ? 'PDF vision' : (doc.extraction_model ? 'text' : '—');
      const tenantLabel = doc.tenant_name ? esc(doc.tenant_name) : '<span style="color:#64748b;font-style:italic;">Unknown</span>';
      const safeUrl     = doc.file_url ? doc.file_url.replace(/\\/g, '\\\\').replace(/'/g, "\\'") : '';
      const viewBtn     = doc.file_url
        ? `<button class="lc-view-btn" onclick="openLeaseModal('${safeUrl}')">View</button>`
        : `<span style="color:#475569;font-size:0.75rem;">no file</span>`;
      const askBtn      = `<button class="lc-ask-btn" onclick="_toggleLeaseAsk('${doc.id}')" title="Ask a question about this lease">Ask</button>`;
      const deleteBtn   = `<button class="lc-del-btn" onclick="_deleteLeaseCenterRow('${doc.id}','${propertyId}')">✕</button>`;

      const dataRow = `<tr id="lc-row-${doc.id}">
        <td>${tenantLabel}</td>
        <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(doc.file_name)}">${esc(doc.file_name)}</td>
        <td><span class="lc-status-badge" style="background:${statusColor}22;color:${statusColor};border:1px solid ${statusColor}44;">${esc(doc.parsing_status)}</span></td>
        <td style="color:#94a3b8;">${modelLabel}</td>
        <td style="color:#94a3b8;">${uploadDate}</td>
        <td style="text-align:right;white-space:nowrap;">${viewBtn} ${askBtn} ${deleteBtn}</td>
      </tr>`;

      const askRow = `<tr id="lc-ask-${doc.id}" class="lc-ask-row" style="display:none;">
        <td colspan="6" style="padding:0;">
          <div class="lc-ask-panel">
            <div class="lc-ask-input-row">
              <textarea id="lc-q-${doc.id}" class="lc-ask-textarea"
                placeholder="Ask anything about this lease — CAM terms, renewal options, exclusions…"
                rows="2"
                onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();_submitLeaseQuestion('${doc.id}')}"></textarea>
              <button class="lc-ask-submit-btn" onclick="_submitLeaseQuestion('${doc.id}')">Ask</button>
            </div>
            <div id="lc-ans-${doc.id}" class="lc-answer" style="display:none;"></div>
          </div>
        </td>
      </tr>`;

      return dataRow + askRow;
    }).join('');

    panel.innerHTML = `
      <div style="overflow-x:auto;">
        <table class="lc-table">
          <thead>
            <tr>
              <th>Tenant</th>
              <th>File</th>
              <th>Status</th>
              <th>Method</th>
              <th>Uploaded</th>
              <th></th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }).catch(err => {
    console.error('[renderLeaseCenter] failed:', err?.message);
    panel.innerHTML = `<div style="padding:16px 0;color:#ef4444;font-size:0.875rem;">Failed to load lease documents: ${err?.message || 'unknown error'}</div>`;
  });
}

function _toggleLeaseAsk(docId) {
  const askRow = document.getElementById('lc-ask-' + docId);
  if (!askRow) return;
  const opening = askRow.style.display === 'none';
  askRow.style.display = opening ? 'table-row' : 'none';
  if (opening) {
    const q = document.getElementById('lc-q-' + docId);
    if (q) setTimeout(() => q.focus(), 40);
  }
}

async function _submitLeaseQuestion(docId) {
  const qEl   = document.getElementById('lc-q-'   + docId);
  const ansEl = document.getElementById('lc-ans-' + docId);
  if (!qEl || !ansEl) return;

  const question = qEl.value.trim();
  if (!question) { qEl.focus(); return; }

  ansEl.style.display = 'block';
  ansEl.innerHTML = '<span class="lc-answer-loading">Thinking…</span>';

  try {
    const resp   = await fetch('/api/ask-lease', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', ...(await _authHeaders()) },
      body:    JSON.stringify({ leaseDocumentId: docId, question }),
    });
    const result = await resp.json().catch(() => ({}));
    if (!resp.ok || result.error) {
      ansEl.innerHTML = `<span class="lc-answer-error">${esc(result.error || 'Request failed — check console for details.')}</span>`;
    } else {
      const safe = result.answer
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/\n/g, '<br>');

      // Citation cards — each citation has { quote, section, page }
      const citations = Array.isArray(result.citations) ? result.citations : [];
      let citationsHtml = '';
      if (citations.length > 0) {
        const cards = citations.map(c => {
          if (!c.quote) return '';
          const qSafe = c.quote.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
          const parts = [];
          if (c.section) parts.push(c.section);
          if (c.page)    parts.push(`Page ${c.page}`);
          const metaText = parts.length ? `<div class="lc-citation-meta"><span class="lc-citation-source">${parts.join(' · ')}</span></div>` : '';
          return `<div class="lc-citation"><blockquote class="lc-citation-quote">${qSafe}</blockquote>${metaText}</div>`;
        }).filter(Boolean).join('');
        if (cards) citationsHtml = `<div class="lc-citations-label">Source from lease:</div>${cards}`;
      }

      // "View in Lease" button (opens the stored PDF)
      const viewBtn = result.fileUrl
        ? `<button class="lc-view-lease-btn" onclick="openLeaseModal(${JSON.stringify(result.fileUrl)})">View in Lease ↗</button>`
        : '';

      const kbRead  = result.charsAnalyzed ? Math.round(result.charsAnalyzed / 1000) : null;
      const metaLine = kbRead
        ? `<div class="lc-answer-meta">${result.truncated
            ? `⚠ Only the first ${kbRead}k chars of this lease were analyzed — some clauses may be beyond the read window. Re-upload to store more pages.`
            : `Analyzed ${kbRead}k chars of stored lease text.`
          }</div>`
        : '';
      ansEl.innerHTML = `<div class="lc-answer-text">${safe}</div>${citationsHtml}${viewBtn}${metaLine}`;
    }
  } catch (e) {
    ansEl.innerHTML = `<span class="lc-answer-error">Network error: ${e.message}</span>`;
  }
}

async function _deleteLeaseCenterRow(id, propertyId) {
  if (!confirm('Remove this lease document from the database?')) return;
  const res = await deleteLeaseDocument(id);
  if (res.ok) {
    renderLeaseCenter(propertyId);
  } else {
    alert('Delete failed: ' + (res.reason || 'unknown error'));
  }
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
      headers: { 'Content-Type': 'application/json', ...(await _authHeaders()) },
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
  // Capture snapshot before mutating storage — enables recoverLastSnapshot().
  _captureSnapshot(property);
  // Claim this save's generation. If a newer saveProperty fires before this one
  // resolves, gen will no longer equal _saveGeneration and this completion is stale.
  const gen = ++_saveGeneration;

  _lsSave(property);
  _setSyncStatus('local'); // localStorage write complete; Supabase write pending

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
      timeline:          stripped.timeline          || [],
      // Tenants are persisted here (not only in the tenants table) so that
      // review state, reviewOverrides, capBaseAmount, and confidence fields
      // survive a full Supabase round-trip without needing schema changes.
      tenants:           stripped.tenants           || [],
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
      const { data: { user: _u } } = await db.auth.getUser();
      if (!_u?.id) throw new Error('Not authenticated');
      const { error } = await db.from('properties')
        .upsert({ id, ...payload, user_id: _u.id })
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
    if (gen !== _saveGeneration) return; // stale — a newer save already completed
    _setSyncStatus('synced');
    console.log('[audit] property_saved', { propertyId: property.id, gen, ts: new Date().toISOString() });
  } catch (e) {
    const msg = e?.message || String(e);
    const isNetErr  = /load failed|failed to fetch|networkerror|offline/i.test(msg);

    if (isNetErr) return;
    if (gen !== _saveGeneration) return; // stale error — a newer save supersedes this one

    _setSyncStatus('error', msg);
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

// Schema version — increment when persisted shape changes in a breaking way.
// Stored alongside saved data so loadPropertyData can run targeted migrations.
const STATE_SCHEMA_VERSION = 1;

// Generation counter — only the most recent in-flight saveProperty may update
// sync status. Stale completions (from rapidly-fired saves) silently discard.
let _saveGeneration = 0;

// Lightweight pre-save snapshots keyed by propertyId — used by recoverLastSnapshot().
const _snapshots = {};

let _saveDebounceTimer = null;

// Snapshot current in-memory state back into the canonical _props entry and
// persist to Supabase. Debounced — rapid successive calls collapse into one write.
async function savePropertyData() {
  // SECURITY: tenant mode never sets activePropId, so this guard stops all saves
  // passively. Most other mutating functions (removeInvItem, clearBulkResults, etc.)
  // are similarly protected — they all return early when activePropId/currentProperty()
  // is null. Explicit RBAC guards are only added where passive isolation is insufficient.
  if (!activePropId) {
    console.warn('[savePropertyData] SKIPPED — activePropId is null. Property not selected, or tenant portal mode active.');
    if (window.ms_lastDisputeFlow) {
      window.ms_lastDisputeFlow.saveResult = 'skipped-no-propid';
      window.ms_lastDisputeFlow.errors.push({ ts: new Date().toISOString(), where: 'savePropertyData', reason: 'activePropId null' });
      _updateDisputeBadge();
    }
    return;
  }

  const prop = _props.find(p => p.id === activePropId);
  if (!prop) {
    console.warn('[savePropertyData] SKIPPED — prop not found in _props for activePropId:', activePropId);
    return;
  }

  try {
    const name = document.getElementById('propertyName')?.value?.trim() || '';
    const sqftDom = parseFloat(document.getElementById('totalSqft')?.value) || 0;
    const sqft = prop.totalSqft || sqftDom;

    if (name) prop.name = name;
    if (sqft) prop.totalSqft = sqft;
    // tenantData is the live working buffer; always sync it to prop.tenants before saving
    // so any field edit (even if prop.tenants wasn't updated) is captured.
    // Phase 20: when normalized evidence reads are active, omit fieldEvidence from the
    // JSON blob — the normalized table is authoritative and storing it in both places
    // bloats properties.data unnecessarily.
    if (tenantData.some(t => t !== null)) {
      prop.tenants = tenantData.filter(t => t !== null).map(t => {
        if (!window.ms_useNormalizedEvidence) return t;
        const { fieldEvidence, ...rest } = t;  // eslint-disable-line no-unused-vars
        return rest;
      });
    }
    // Guard: only overwrite invoices when invoiceData is populated. In tenant portal
    // mode invoiceData is always empty — writing it would wipe the property's invoice list.
    if (invoiceData.length > 0) prop.invoices = Array.from(invoiceData);

    prop.disputes    = Array.from(disputes);
    prop.activityLog = [...activityLog];
    // Only overwrite results when this session computed new ones. Without this
    // guard, a tenant portal save (where lastResults is always empty) would wipe
    // the property's CAM reconciliation results on every dispute submission.
    prop.results = lastResults.length ? {
      propId:       prop.id,          // used to verify results belong to this property on load
      results:      lastResults,
      propName:     lastPropName,
      total:        lastTotal,
      invoices:     lastInvoices,
      invoicesFull: lastInvoicesFull,
      tenants:      lastTenants,
      disputes:     Array.from(disputes),
      camRuns:      camRuns.map(r => ({ ...r, timestamp: r.timestamp instanceof Date ? r.timestamp.toISOString() : r.timestamp })),
    } : (prop.results ?? null);

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
// Phase 21: merges normalized cam_reconciliations rows back onto dbData. Overlays
// expectedCam/actualCam/variance per tenant, and — only when the blob snapshot is
// absent — rebuilds a minimal camReconciliation from the rows so results still
// restore. Mutates dbData in place. No-op when camRows is empty.
function _mergeCamReconciliationRows(dbData, camRows) {
  if (!dbData || !Array.isArray(camRows) || !camRows.length) return;

  dbData.tenants = (dbData.tenants || []).map(t => {
    const cam = camRows.find(r => r.tenant_id === t.id);
    if (!cam) return t;
    return { ...t, expectedCam: cam.expected_cam, actualCam: cam.actual_cam, variance: cam.variance };
  });

  // Only rebuild from rows when the authoritative blob snapshot is missing.
  if (dbData.camReconciliation || dbData.results) return;

  const totalSqft    = dbData.totalSqft || 1;
  const invoiceList  = dbData.invoices || [];
  const invoiceCount = invoiceList.length;
  const invoiceTotal = invoiceList.reduce((s, inv) => s + (parseFloat(inv.amount) || 0), 0);

  const snapResults = dbData.tenants
    .filter(t => t.actualCam != null)
    .map(t => ({
      name:             t.tenant_name || '(Unknown)',
      allocatedAmount:  t.actualCam,
      totalAllocated:   t.actualCam,
      proRata:          (Number(t.leased_sqft) || 0) / totalSqft,
      proRataPercent:   ((Number(t.leased_sqft) || 0) / totalSqft) * 100,
      // Per-tenant invoice breakdown isn't recoverable from cam_reconciliations
      // alone; use the full invoice count as the best approximation.
      eligibleCount:    invoiceCount,
      capApplied:       false,
      capAdjustment:    null,
      includedInvoices: [],
      ambiguityFlags:   [],
    }));
  if (!snapResults.length) return;

  console.log('[CamReconciliation] FALLBACK — rebuilding camReconciliation from cam_reconciliations rows', {
    snapResultsLen: snapResults.length, dbTenantsLen: (dbData.tenants || []).length, totalSqft,
  });
  dbData.camReconciliation = {
    propId:       dbData.id,
    propName:     dbData.name || '',
    camYear:      camRows[0]?.year ?? getCamYear(),
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
        timeline:          d.timeline          || [],
        // Full tenant state (review, reviewOverrides, capBaseAmount, confidence)
        // stored in properties.data.tenants. Use when present; fall back to the
        // tenants table (which lacks review fields) for legacy rows.
        tenants:           d.tenants?.length ? d.tenants.map(normalizeTenant) : null,
      };
      console.groupCollapsed('[PIPELINE:4] Supabase read');
      console.log('invoices[0]:', JSON.parse(JSON.stringify(dbData.invoices[0] || {})));
      console.log('camRec.results[0].includedInvoices[0]:', JSON.parse(JSON.stringify(dbData.camReconciliation?.results?.[0]?.includedInvoices?.[0] || {})));
      console.groupEnd();

      // Fetch tenants from their own table — used only when properties.data.tenants
      // is absent (legacy rows predating the full-state persistence introduced here).
      // When dbData.tenants is already populated from properties.data, skip this
      // query to avoid overwriting review/reviewOverrides/capBaseAmount fields.
      const { data: tenantRows } = dbData.tenants
        ? { data: null }
        : await db
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
      }
    }

    // Phase 21: normalized CAM reconciliation read — runs for ALL tenant sources
    // (both the properties.data path and the legacy tenants-table path), not just
    // the legacy branch. Merges persisted per-tenant CAM rows back onto tenants and,
    // when the full snapshot blob is missing, rebuilds a minimal camReconciliation
    // from cam_reconciliations rows so the results section still restores. The blob
    // in properties.data remains the primary source; this is the recovery + history path.
    if (dbData?.tenants?.length) {
      try {
        _mergeCamReconciliationRows(dbData, await loadCamResults(id, getCamYear()));
      } catch (camErr) {
        if (camErr.code === 'migration_missing') _showMigrationMissingWarning();
        console.warn('[CamReconciliation] read failed — relying on blob camReconciliation:', camErr?.message);
      }
    }

    // Phase 20: normalized evidence read — fetch all tenant_field_evidence rows for
    // this property and overlay fieldEvidence on each tenant, making the normalized
    // table authoritative over whatever the JSON blob may still contain.
    if (window.ms_useNormalizedEvidence && dbData?.tenants?.length) {
      try {
        const { data: evidRows } = await db
          .from('tenant_field_evidence')
          .select('*')
          .eq('property_id', id)
          .order('created_at', { ascending: true });
        if (evidRows?.length) {
          const evByTenant = {};
          for (const row of evidRows) {
            if (!evByTenant[row.tenant_id]) evByTenant[row.tenant_id] = {};
            const fk = row.field_key;
            if (!evByTenant[row.tenant_id][fk]) evByTenant[row.tenant_id][fk] = { snapshots: [] };
            evByTenant[row.tenant_id][fk].snapshots.push(_evidenceRowToSnapshot(row));
          }
          dbData.tenants = dbData.tenants.map(t =>
            evByTenant[t.id] ? { ...t, fieldEvidence: evByTenant[t.id] } : t
          );
          console.log('[NormalizedEvidence] overlaid fieldEvidence for', Object.keys(evByTenant).length, 'tenant(s) from tenant_field_evidence');
        }
      } catch (evErr) {
        console.warn('[NormalizedEvidence] read failed — falling back to blob fieldEvidence:', evErr?.message);
      }
    }

    // Phase 20: normalized audit read — fetch tenant_review_audit rows and merge
    // them into the activityLog, replacing any stale field_review_audit blob entries.
    if (window.ms_useNormalizedAudit && dbData) {
      try {
        const { data: auditRows } = await db
          .from('tenant_review_audit')
          .select('*')
          .eq('property_id', id)
          .order('client_ts', { ascending: true });
        if (auditRows?.length) {
          const normalizedEntries = auditRows.map(_auditRowToActivityEntry);
          const nonAuditEntries   = (dbData.activityLog || []).filter(e => e.type !== 'field_review_audit');
          dbData.activityLog = [...nonAuditEntries, ...normalizedEntries]
            .sort((a, b) => new Date(a.timestamp || 0) - new Date(b.timestamp || 0));
          console.log('[NormalizedAudit] merged', auditRows.length, 'audit row(s) from tenant_review_audit');
        }
      } catch (auditErr) {
        console.warn('[NormalizedAudit] read failed — falling back to blob activityLog:', auditErr?.message);
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

  // Disputes: DB is authoritative (tenant may have submitted from another device/session
  // since the landlord's last visit). Also include any LS-only entries that haven't
  // reached Supabase yet (e.g. network failure during save) to prevent local data loss.
  const _dbDisps   = dbData.disputes || [];
  const _lsDisps   = lsData.disputes || [];
  const _lsOnlyDisps = _lsDisps.filter(d => !_dbDisps.some(dd => dd.id === d.id));
  const _mergedDisps = [..._dbDisps, ..._lsOnlyDisps];

  console.groupCollapsed('[PIPELINE:4b] MERGE decision');
  console.log('winner:', lsCount > dbCount ? 'localStorage' : 'supabase', { dbTenants: dbCount, lsTenants: lsCount, dbInvoices: (dbData.invoices||[]).length, lsInvoices: (lsData.invoices||[]).length });
  console.log('base.invoices[0]:', JSON.parse(JSON.stringify(base.invoices?.[0] || {})));
  console.log('[LANDLORD disputes]', { source: 'merge', dbDisputesLen: _dbDisps.length, lsDisputesLen: _lsDisps.length, lsOnlyLen: _lsOnlyDisps.length, mergedLen: _mergedDisps.length, dbDisputes: _dbDisps, lsDisputes: _lsDisps });
  console.groupEnd();

  // Reconciliation results and disputes: always prefer Supabase — both are
  // written immediately after each event and Supabase is the authoritative source.
  // localStorage may lag behind or belong to a different session entirely.
  const merged = {
    ...base,
    disputes:          _mergedDisps,
    results:           dbData.results           ?? base.results           ?? null,
    camReconciliation: dbData.camReconciliation ?? base.camReconciliation ?? null,
  };

  // Run hydration guards — normalizes arrays, enforces canonical shapes, detects
  // schema migrations and malformed entries from old or partially-written saves.
  const norm = normalizePropertyState(merged);
  if (!norm) return merged; // malformed root object — return raw, let caller handle

  if (norm._migrated || norm._malformed) {
    // Queue audit events for emission after renderProperty populates activityLog.
    setTimeout(() => {
      if (activePropId !== id) return;
      if (norm._migrated) {
        _auditDirect('migration_applied', 'State schema upgraded', {
          severity: 'info',
          detail:   `Property data migrated to schema v${STATE_SCHEMA_VERSION}`,
          propertyId: id,
        });
      }
      if (norm._malformed) {
        _auditDirect('malformed_state_recovered', 'Malformed entries removed on load', {
          severity: 'warning',
          detail:   'One or more persisted entries had unexpected shape and were filtered out.',
          propertyId: id,
        });
      }
    }, 200); // after renderProperty's activityLog.splice has run
  }

  return norm;
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
    console.log('[LANDLORD disputes]', { source: 'renderProperty', propId: property.id, disputesLen: savedDisputes.length, disputes: savedDisputes });
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

  // ── Property Timeline ─────────────────────────────────────────────────
  try {
    if (Array.isArray(property.timeline)) {
      renderPropertyActivity(property);
    }
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

  // Sync onboarding step bar + contextual hints from current property state
  _obSyncState();

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

function openDeletePropertyModal() {
  if (!activePropId) return;
  const prop = _props.find(p => p.id === activePropId);
  document.getElementById('delModalPropName').textContent = prop?.name || 'This Property';
  document.getElementById('delModalConfirmBtn').disabled  = false;
  document.getElementById('delModalConfirmBtn').textContent = 'Delete Property';
  document.getElementById('delModalCancelBtn').disabled   = false;
  document.getElementById('deletePropertyModal').classList.add('open');
}

function closeDeletePropertyModal() {
  document.getElementById('deletePropertyModal').classList.remove('open');
}

async function confirmDeleteProperty() {
  if (!activePropId) return;
  const propId   = activePropId;
  const propName = _props.find(p => p.id === propId)?.name || 'Property';

  const confirmBtn = document.getElementById('delModalConfirmBtn');
  const cancelBtn  = document.getElementById('delModalCancelBtn');
  confirmBtn.disabled  = true;
  confirmBtn.textContent = 'Deleting…';
  cancelBtn.disabled   = true;

  try {
    // Delete tenants explicitly (cascade from properties may not cover the tenants table)
    const { error: tenantErr } = await db.from('tenants').delete().eq('property_id', propId);
    if (tenantErr) throw tenantErr;
    // Delete the property — all child tables cascade (cam_reconciliations, lease_documents,
    // lease_jobs, tenant_field_evidence, tenant_review_audit all have ON DELETE CASCADE)
    const { error } = await db.from('properties').delete().eq('id', propId);
    if (error) throw error;
  } catch (e) {
    confirmBtn.disabled  = false;
    confirmBtn.textContent = 'Delete Property';
    cancelBtn.disabled   = false;
    alert('Delete failed: ' + (e.message || String(e)));
    return;
  }

  // Remove from in-memory state
  const idx = _props.findIndex(p => p.id === propId);
  if (idx >= 0) _props.splice(idx, 1);
  const pidx = portfolio.findIndex(p => p.id === propId);
  if (pidx >= 0) portfolio.splice(pidx, 1);

  // Remove from localStorage
  try {
    const stored = JSON.parse(_lsGet(_lsUserKey()) || '{}');
    delete stored[propId];
    _lsSet(_lsUserKey(), JSON.stringify(stored));
  } catch (_) {}

  logActivity('property_deleted', `Property deleted: ${propName}`, { severity: 'warning', actor: 'User' });

  closeDeletePropertyModal();
  activePropId = null;
  renderPortfolio(_props);
  window.scrollTo({ top: 0, behavior: 'smooth' });
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


// ─── Tenant portal ───────────────────────────────────────────────────────────

function _activateTenantPortal() {
  const dashEl = document.getElementById('portfolioDashboard');
  const wfEl   = document.getElementById('mainWorkflow');
  if (dashEl) dashEl.style.display = 'block';
  if (wfEl)   wfEl.style.display   = 'none';
  const msgEl = document.getElementById('tenantPortalMsg');
  if (msgEl)  msgEl.style.display  = 'block';
}

// ── Phase 8C: Tenant portal init ─────────────────────────────────────────────
// Called from init() instead of _activateTenantPortal() for tenant-role users.
// Shows the portal frame, then loads the assigned property (if any) read-only.
async function _initTenantPortal() {
  const user = window.AuthService?.getCurrentUser();
  const assignedIds = (user?.propertyIds || [])
    .filter(id => typeof id === 'string' && id.length > 10);

  _activateTenantPortal(); // always show portal frame + hide workflow

  if (assignedIds.length === 0) return; // no assignment — welcome message only

  try {
    const data = await _loadTenantPropertyData(assignedIds[0]);
    if (data) {
      _renderTenantPropertyView(data);

      // Hydrate property context so dispute saves and audit writes work.
      // activePropId must be set before savePropertyData() / appendReviewAuditEntry()
      // are reachable; without it both functions silently return at their first guard.
      activePropId = data.id;
      window._tenantPortalPropId = data.id;
      if (!_props.find(p => p.id === data.id)) _props.push(data);

      // Seed working arrays from loaded property so savePropertyData() won't
      // overwrite them with empty values (renderProperty is not called in tenant mode).
      disputes.splice(0, disputes.length, ...(data.disputes || []));
      if (data.disputes?.length) nextDisputeId = Math.max(...data.disputes.map(d => (d.id || 0) + 1), 0);
      activityLog.splice(0, activityLog.length, ...(data.activityLog || []));

      console.log('[TenantPortal] property context hydrated — activePropId:', activePropId,
        '| disputes:', disputes.length, '| activityLog:', activityLog.length);
      _updateDisputeBadge();
    }
  } catch (e) {
    console.warn('[TenantPortal] Property load failed:', e?.message);
    // fail silently — welcome message remains visible
  }
}

// Client-side permission check before loading a property for a tenant.
// Defense-in-depth: only loads a property that is explicitly listed in
// user.propertyIds. Supabase RLS is the authoritative server-side boundary.
// NOTE: RLS policy "tenant_read_assigned_property" should be added to the
// properties table before this feature is exposed in production. See Phase 8C-hardening.
async function _loadTenantPropertyData(id) {
  const user = window.AuthService?.getCurrentUser();
  if (!user || user.role !== 'tenant') return null;
  const assigned = Array.isArray(user.propertyIds) ? user.propertyIds : [];
  if (!assigned.includes(id)) {
    console.warn('[TenantPortal] Access denied — property not in user.propertyIds:', id);
    return null;
  }
  return loadPropertyData(id); // existing function — no changes needed
}

// Renders a read-only property summary card inside #tenantPropertyView.
// Never enters #mainWorkflow; never sets activePropId.
function _renderTenantPropertyView(property) {
  const container = document.getElementById('tenantPropertyView');
  if (!container) return;

  const camRec     = property.camReconciliation;
  const hasResults = camRec && Array.isArray(camRec.results) && camRec.results.length > 0;
  const year       = property.camYear || (hasResults ? (camRec.results[0]?.year ?? null) : null) || '—';
  const statusText = hasResults ? `Reconciliation complete · ${year}` : 'Reconciliation pending';
  const _allDisps  = property.disputes || [];
  const _openDisps = _allDisps.filter(d => d.status === 'open').length;
  const _dispChip  = _allDisps.length > 0
    ? `<span class="tp-meta-item${_openDisps > 0 ? ' tp-dispute-count--open' : ''}">${
        _openDisps > 0
          ? `${_openDisps} open dispute${_openDisps !== 1 ? 's' : ''}`
          : `${_allDisps.length} dispute${_allDisps.length !== 1 ? 's' : ''} — resolved`
      }</span>`
    : '';

  container.innerHTML =
    '<div class="tp-property-card">' +
      '<div class="tp-property-hdr">' +
        `<span class="tp-property-name">${esc(property.name || 'Your Property')}</span>` +
        '<span class="rv-ro-badge">READ-ONLY</span>' +
      '</div>' +
      '<div class="tp-property-meta">' +
        (property.totalSqft ? `<span class="tp-meta-item">${Number(property.totalSqft).toLocaleString()} sq ft</span>` : '') +
        `<span class="tp-meta-item${hasResults ? ' tp-cam-status--done' : ''}">${esc(statusText)}</span>` +
        _dispChip +
      '</div>' +
      '<p class="tp-property-note">Your CAM reconciliation data is managed by your property manager. Contact them to request a detailed statement or to dispute a charge.</p>' +
    '</div>';
  container.style.display = 'block';

  // Hide the generic welcome message once a property card is shown
  const welcome = document.getElementById('tenantPortalMsg')
    ?.querySelector('.tenant-portal-welcome');
  if (welcome) welcome.style.display = 'none';
}

// ─── Acquisition Review ───────────────────────────────────────────────────────

async function _loadAcqReviews() {
  try {
    const { data: { user } } = await db.auth.getUser();
    if (!user?.id) return [];
    const { data, error } = await db
      .from('acquisition_reviews')
      .select('id, name, status, data, created_at, updated_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });
    if (error) { console.warn('[acq] load error:', error.message); return []; }
    return data || [];
  } catch (e) {
    console.warn('[acq] _loadAcqReviews failed:', e.message);
    return [];
  }
}

async function _saveAcqReview(review) {
  try {
    const { data: { user } } = await db.auth.getUser();
    if (!user?.id) return;
    const { error } = await db
      .from('acquisition_reviews')
      .upsert({ ...review, user_id: user.id }, { onConflict: 'id' });
    if (error) console.warn('[acq] save error:', error.message);
  } catch (e) {
    console.warn('[acq] _saveAcqReview failed:', e.message);
  }
}

async function _loadAcqReviewsAndRender() {
  const reviews = await _loadAcqReviews();
  _acqReviews = reviews;
  _renderAcqSection(reviews);
}

function _renderAcqSection(reviews) {
  const grid = document.getElementById('acqReviewsGrid');
  if (!grid) return;
  if (!reviews.length) {
    grid.innerHTML = '<div class="acq-empty">No due diligence reviews yet. Start one to analyze a property before acquisition.</div>';
    return;
  }
  grid.innerHTML = reviews.map(r => {
    const d = r.data || {};
    const tenantCount  = (d.tenants  || []).length;
    const invoiceCount = (d.invoices || []).length;
    const date = r.created_at ? new Date(r.created_at).toLocaleDateString() : '';
    const convertedNote = r.status === 'converted' && d.conversionRecord?.convertedAt
      ? `<div class="acq-card-converted-note">Acquired ${new Date(d.conversionRecord.convertedAt).toLocaleDateString()}</div>`
      : '';
    return `
    <div class="acq-card${r.status === 'converted' ? ' converted' : ''}" onclick="selectAcquisitionReview('${esc(r.id)}')">
      <div class="acq-card-name">${esc(r.name)}</div>
      <div class="acq-card-meta">${esc(date)}</div>
      <span class="acq-card-status ${esc(r.status)}">${esc(r.status)}</span>
      ${convertedNote}
      <div class="acq-card-stats">
        <div class="acq-card-stat"><strong>${tenantCount}</strong> Tenants</div>
        <div class="acq-card-stat"><strong>${invoiceCount}</strong> Invoices</div>
      </div>
    </div>`;
  }).join('');
}

async function createAcquisitionReview() {
  const name = prompt('Due diligence review name (e.g. "123 Main Street"):');
  if (!name || !name.trim()) return;
  try {
    const { data: { user } } = await db.auth.getUser();
    if (!user?.id) { alert('Please sign in first.'); return; }
    const id = crypto.randomUUID ? crypto.randomUUID() : _genUUID();
    const review = {
      id,
      user_id:    user.id,
      name:       name.trim(),
      status:     'draft',
      data:       { tenants: [], invoices: [], totalSqFt: 0, documents: [], analysis: null },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const { error } = await db.from('acquisition_reviews').insert(review);
    if (error) {
      const code = error.code || '';
      let hint = '';
      if (code === '42P01') hint = '\n\nFix: run migrations/006_acquisition_reviews.sql in Supabase.';
      else if (code === '42501' || code === 'PGRST301') hint = '\n\nFix: RLS policy blocked the insert — check acq_reviews_owner_all policy.';
      console.error('[acq] create error:', error.code, error.message);
      alert('Could not create review.\n\n' + error.message + hint);
      return;
    }
    _acqReviews.unshift(review);
    _renderAcqSection(_acqReviews);
    selectAcquisitionReview(id);
  } catch (e) {
    console.error('[acq] createAcquisitionReview:', e.message);
    alert('Could not create review.\n\n' + e.message);
  }
}

function selectAcquisitionReview(id) {
  const review = _acqReviews.find(r => r.id === id);
  if (!review) return;
  _activeAcqId        = id;
  _acqActiveTab       = 'risk';
  _acqRentRollSort    = { col: 'tenant_name', dir: 'asc' };
  const d = review.data || {};
  _acqTenants  = Array.isArray(d.tenants)  ? d.tenants  : [];
  _acqInvoices = Array.isArray(d.invoices) ? d.invoices : [];
  _acqSqFt     = d.totalSqFt || 0;

  document.getElementById('portfolioDashboard').style.display = 'none';
  document.getElementById('acqDetailPanel').style.display     = 'block';
  document.getElementById('propertyBreadcrumb').style.display = 'none';
  document.getElementById('mainWorkflow').style.display       = 'none';

  document.getElementById('acqDetailTitle').textContent = review.name;
  const badge = document.getElementById('acqDetailBadge');
  badge.textContent = review.status;
  badge.className = 'acq-detail-badge ' + review.status;
  _renderAcqConvertAction(review);

  const sqftEl = document.getElementById('acqTotalSqft');
  if (sqftEl) sqftEl.value = _acqSqFt || '';

  _renderAcqLeaselist();
  _renderAcqInvoiceList();
  _updateAcqAnalyzeBtn();

  if (d.analysis) {
    _renderAcqReport(d.analysis, document.getElementById('acqReportContainer'));
  } else {
    document.getElementById('acqReportContainer').innerHTML = '';
  }
}

function closeAcquisitionDetail() {
  _activeAcqId = null;
  _acqTenants  = [];
  _acqInvoices = [];
  document.getElementById('acqDetailPanel').style.display     = 'none';
  document.getElementById('portfolioDashboard').style.display = 'block';
  _renderAcqSection(_acqReviews);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── Acquisition → Property conversion ─────────────────────────────────────────

function _renderAcqConvertAction(review) {
  const el = document.getElementById('acqConvertAction');
  if (!el) return;
  const cr = review?.data?.conversionRecord;
  if (cr?.propertyId) {
    el.innerHTML = `<span class="acq-converted-link"
      onclick="event.preventDefault();closeAcquisitionDetail();selectProperty('${esc(cr.propertyId)}')">
      Converted ✓ — Open Property →</span>`;
  } else if (review.status === 'complete') {
    el.innerHTML = `<button class="acq-convert-btn" onclick="_showAcqConvertModal()"
      title="Create a managed property from this acquisition review">
      &#x1F3E2; Acquire Property</button>`;
  } else {
    el.innerHTML = '';
  }
}

function _showAcqConvertModal() {
  const review = _acqReviews.find(r => r.id === _activeAcqId);
  if (!review) return;
  const nameEl = document.getElementById('acqConvertModalName');
  if (nameEl) nameEl.textContent = review.name;
  document.getElementById('acqConvertModal').style.display = 'flex';
}

function _hideAcqConvertModal() {
  document.getElementById('acqConvertModal').style.display = 'none';
}

async function convertAcquisitionToProperty() {
  const review = _acqReviews.find(r => r.id === _activeAcqId);
  if (!review) return;

  // Duplicate prevention
  if (review.data?.conversionRecord?.propertyId) {
    _hideAcqConvertModal();
    alert('This review has already been converted.\nProperty ID: ' + review.data.conversionRecord.propertyId);
    return;
  }

  const confirmBtn = document.getElementById('acqConvertConfirmBtn');
  if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.textContent = 'Converting…'; }

  try {
    // Build the property object from the review (pure engine function)
    const prop = AcquisitionEngine.buildPropertyFromReview(review);

    // Register in _props immediately so portfolio renders without a round-trip
    _props.push(prop);

    // Persist to Supabase — assigns prop.id
    await saveProperty(prop);

    // Sync qualified tenants to the tenants table
    const qualifiedTenants = prop.tenants.filter(
      t => t?.tenant_name && !t?.extractionFailed
    );
    if (prop.id && qualifiedTenants.length) {
      await resyncTenantsToTable(prop.id, qualifiedTenants);
    }

    // Build the conversion record stored back on the review
    const conversionRecord = {
      propertyId:   prop.id,
      propertyName: prop.name,
      convertedAt:  prop._conversionSource.convertedAt,
      occupancyAtAcquisition: prop._conversionSource.occupancyAtAcquisition,
      waltAtAcquisition:      prop._conversionSource.waltAtAcquisition,
    };

    // Mark review as converted (in-memory + DB)
    review.status = 'converted';
    review.data   = Object.assign({}, review.data, { conversionRecord });
    await _saveAcqReview(review);

    // Update detail header badge + action area
    const badge = document.getElementById('acqDetailBadge');
    if (badge) { badge.textContent = 'converted'; badge.className = 'acq-detail-badge converted'; }
    _renderAcqConvertAction(review);

    // Refresh portfolio grid so the card shows 'converted' badge
    _renderAcqSection(_acqReviews);

    _hideAcqConvertModal();

    console.log('[acq] converted review', review.id, '→ property', prop.id);
  } catch (e) {
    console.error('[acq] convertAcquisitionToProperty:', e.message);
    alert('Conversion failed.\n\n' + e.message);
  } finally {
    if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.textContent = 'Acquire Property'; }
  }
}

function _renderAcqLeaselist() {
  const el = document.getElementById('acqLeaseList');
  if (!el) return;
  if (!_acqTenants.length) {
    el.innerHTML = '<li style="color:#475569;font-size:0.78rem;">No leases uploaded</li>';
    return;
  }
  el.innerHTML = _acqTenants.map(t => {
    const name = esc(t.tenant_name || t.tenantName || '(extracting…)');
    const dot  = t._status === 'error' ? 'error' : 'ok';
    return `<li class="acq-file-item"><span class="acq-file-dot ${dot}"></span>${name}</li>`;
  }).join('');
}

function _renderAcqInvoiceList() {
  const el = document.getElementById('acqInvoiceList');
  if (!el) return;
  if (!_acqInvoices.length) {
    el.innerHTML = '<li style="color:#475569;font-size:0.78rem;">No invoices uploaded</li>';
    return;
  }
  el.innerHTML = _acqInvoices.map(inv => {
    const name = esc(inv.vendorName || inv.fileName || '(processing…)');
    const amt  = inv.amount ? ' — $' + parseFloat(inv.amount).toLocaleString() : '';
    const dot  = inv._error ? 'error' : 'ok';
    return `<li class="acq-file-item"><span class="acq-file-dot ${dot}"></span>${name}${amt}</li>`;
  }).join('');
}

function _updateAcqAnalyzeBtn() {
  const btn  = document.getElementById('acqAnalyzeBtn');
  const note = document.getElementById('acqAnalyzeNote');
  if (!btn) return;
  const hasTenants  = _acqTenants.some(t => t.tenant_name || t.tenantName);
  const hasInvoices = _acqInvoices.some(i => i.amount);
  const hasSqFt     = _acqSqFt > 0;
  const ready = hasTenants && hasInvoices && hasSqFt;
  btn.disabled = !ready;
  if (note) {
    note.textContent = !hasTenants  ? 'Upload at least one lease to enable analysis.'
                     : !hasInvoices ? 'Upload at least one invoice to enable analysis.'
                     : !hasSqFt    ? 'Enter total property square footage above.'
                     : 'Ready — click to run risk analysis.';
  }
}

function acqSaveSqft(val) {
  _acqSqFt = parseFloat(val) || 0;
  const review = _acqReviews.find(r => r.id === _activeAcqId);
  if (review) { review.data = review.data || {}; review.data.totalSqFt = _acqSqFt; }
  _updateAcqAnalyzeBtn();
}

async function acqHandleLeaseFiles(fileList) {
  const files = Array.from(fileList);
  if (!files.length) return;
  const review = _acqReviews.find(r => r.id === _activeAcqId);
  if (!review) return;

  for (const file of files) {
    const placeholder = { tenant_name: file.name, _status: 'pending', _fileName: file.name };
    _acqTenants.push(placeholder);
    _renderAcqLeaselist();

    try {
      const leaseText = await extractLeaseText(file);
      let extracted;
      if (leaseText && leaseText.length >= 50) {
        extracted = await callClaudeForLease(leaseText);
      } else {
        extracted = await callClaudeWithPdfDirect(file);
      }
      if (!extracted) throw new Error('Extraction returned null');
      const normalized = normalizeTenant(extracted);
      Object.assign(placeholder, normalized, { _status: 'ok', _fileName: file.name });
    } catch (e) {
      console.warn('[acq] lease extraction failed:', file.name, e.message);
      placeholder.tenant_name = file.name.replace(/\.[^.]+$/, '');
      placeholder._status = 'error';
      placeholder._error  = e.message;
    }

    _renderAcqLeaselist();
    _updateAcqAnalyzeBtn();
  }

  review.data = review.data || {};
  review.data.tenants = _acqTenants.filter(t => t._status !== 'error');
  review.updated_at   = new Date().toISOString();
  _saveAcqReview(review);
  document.getElementById('acqLeaseInput').value = '';
}

async function acqHandleInvoiceFiles(fileList) {
  const files = Array.from(fileList);
  if (!files.length) return;
  const review = _acqReviews.find(r => r.id === _activeAcqId);
  if (!review) return;

  for (const file of files) {
    const placeholder = { vendorName: file.name, amount: null, _status: 'pending', fileName: file.name };
    _acqInvoices.push(placeholder);
    _renderAcqInvoiceList();

    try {
      const d = await callClaude(file, INVOICE_PROMPT);
      if (d) {
        const vendorName = d.vendorName || file.name.replace(/\.(pdf|jpe?g|png|webp)$/i, '');
        let category     = d.category || 'other';
        if (category === 'other') {
          const norm = normalizeCategory(vendorName, '');
          if (norm) category = norm.category;
        }
        Object.assign(placeholder, {
          vendorName:  cleanHTML(vendorName),
          amount:      d.amount || null,
          category,
          invoiceDate: cleanHTML(d.invoiceDate || ''),
          _status:     'ok',
        });
      } else {
        placeholder._status = 'error';
        placeholder._error  = 'Extraction returned null';
      }
    } catch (e) {
      console.warn('[acq] invoice extraction failed:', file.name, e.message);
      placeholder._status = 'error';
      placeholder._error  = e.message;
    }

    _renderAcqInvoiceList();
    _updateAcqAnalyzeBtn();
  }

  review.data = review.data || {};
  review.data.invoices = _acqInvoices.filter(i => i._status !== 'error' && i.amount);
  review.updated_at    = new Date().toISOString();
  _saveAcqReview(review);
  document.getElementById('acqInvoiceInput').value = '';
}

async function runAcquisitionAnalysis() {
  const review = _acqReviews.find(r => r.id === _activeAcqId);
  if (!review) return;
  const btn = document.getElementById('acqAnalyzeBtn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Analyzing…'; }

  try {
    const AE = window.AcquisitionEngine;
    if (!AE) throw new Error('AcquisitionEngine not loaded');

    const tenants  = _acqTenants.filter(t => (t.tenant_name || t.tenantName) && t._status !== 'error');
    const invoices = _acqInvoices.filter(i => i.amount && i._status !== 'error');
    const report   = AE.buildAcquisitionReport(tenants, invoices, _acqSqFt);

    review.data      = review.data || {};
    review.data.analysis = report;
    review.status    = 'complete';
    review.updated_at = new Date().toISOString();

    const badge = document.getElementById('acqDetailBadge');
    if (badge) { badge.textContent = 'complete'; badge.className = 'acq-detail-badge complete'; }

    await _saveAcqReview(review);
    _renderAcqSection(_acqReviews);
    _renderAcqReport(report, document.getElementById('acqReportContainer'));
  } catch (e) {
    console.error('[acq] analysis failed:', e.message);
    const cont = document.getElementById('acqReportContainer');
    if (cont) cont.innerHTML = `<div style="color:#f87171;padding:16px;">Analysis failed: ${esc(e.message)}</div>`;
  }

  if (btn) { btn.disabled = false; btn.textContent = '⚡ Run Analysis'; }
}

function _renderAcqReport(report, container) {
  if (!container) return;
  if (report.error) {
    container.innerHTML = `<div style="color:#f87171;padding:16px;">${esc(report.error)}</div>`;
    return;
  }
  const s   = report.summary;
  const fmt = v => v != null ? '$' + parseFloat(v).toLocaleString('en-US', { maximumFractionDigits: 0 }) : '—';
  const pct = v => v != null ? v + '%' : '—';

  const missedCls  = s.annualMissedRecovery > 0 ? 'danger' : 'safe';
  const recoverCls = s.recoveryRate >= 90 ? 'safe' : s.recoveryRate >= 70 ? '' : 'danger';

  // ── Tenant Summary ──────────────────────────────────────────────────────────
  const tenantSummaryHtml = (() => {
    const ts = report.tenantSummary || [];
    if (!ts.length) return '';
    const fmtDate = iso => {
      if (!iso) return '—';
      const d = new Date(iso + 'T12:00:00');
      return isNaN(d.getTime()) ? String(iso) : d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    };
    const fmtMoney = v => v != null ? '$' + Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 }) : '—';
    const fmtSqft  = v => v != null ? Number(v).toLocaleString('en-US') + ' sf' : '—';
    const rows = ts.map(t => `
      <tr>
        <td class="acq-ts-name">${esc(t.tenant_name)}</td>
        <td>${esc(t.suite || '—')}</td>
        <td>${fmtSqft(t.leased_sqft)}</td>
        <td class="acq-ts-term">${fmtDate(t.lease_start)}&nbsp;–&nbsp;${fmtDate(t.lease_end)}</td>
        <td>${fmtMoney(t.base_rent)}/yr</td>
        <td class="acq-ts-renewal">${esc(t.renewal_options || '—')}</td>
        <td>${fmtMoney(t.security_deposit)}</td>
        <td class="acq-ts-cam">${esc(t.cam_structure || '—')}</td>
      </tr>`).join('');
    return `
    <div class="acq-ts-section">
      <div class="acq-section-sub" style="margin-top:0">Tenant Summary</div>
      <div class="acq-ts-scroll">
        <table class="acq-ts-table">
          <thead><tr>
            <th>Tenant</th><th>Suite</th><th>Sq Ft</th><th>Lease Term</th>
            <th>Base Rent/yr</th><th>Renewal</th><th>Deposit</th><th>CAM Structure</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
  })();

  const kpis = `
  <div class="acq-kpi-row">
    <div class="acq-kpi"><div class="acq-kpi-val ${recoverCls}">${pct(s.recoveryRate)}</div><div class="acq-kpi-lbl">Recovery Rate</div></div>
    <div class="acq-kpi"><div class="acq-kpi-val ${missedCls}">${fmt(s.annualMissedRecovery)}</div><div class="acq-kpi-lbl">Annual Missed Recovery</div></div>
    <div class="acq-kpi"><div class="acq-kpi-val ${s.capLeakageAnnualized > 0 ? 'danger' : 'safe'}">${fmt(s.capLeakageAnnualized)}</div><div class="acq-kpi-lbl">Annualized Cap Leakage</div></div>
    <div class="acq-kpi"><div class="acq-kpi-val">${s.tenantCount}</div><div class="acq-kpi-lbl">Tenants</div></div>
    <div class="acq-kpi"><div class="acq-kpi-val">${s.openAuditWindows}</div><div class="acq-kpi-lbl">Open Audit Windows</div></div>
  </div>`;

  const icons = { cap_leakage: '⚠️', structural_gap: '🔒', operational_gap: '🔧',
                  unusual_exclusions: '📋', renewal_risk: '📅' };

  const riskItems = report.topRisks.map(r => `
    <div class="acq-risk-item">
      <span class="acq-risk-icon">${icons[r.type] || '⚠️'}</span>
      <div>
        <div class="acq-risk-label">${esc(r.label)}</div>
        <div class="acq-risk-detail">${esc(r.detail)}</div>
      </div>
      ${r.annualImpact ? `<div class="acq-risk-impact">${fmt(r.annualImpact)}/yr</div>` : ''}
    </div>`).join('');

  const topRisksHtml = report.topRisks.length
    ? `<div class="acq-top-risks"><h3>&#x26A0;&#xFE0F; Top Risks</h3>${riskItems}</div>`
    : '';

  // ── Citation-backed findings ───────────────────────────────────────────────
  const findingsHtml = (() => {
    const ff = (report.findings || []);
    if (!ff.length) return '';
    const typeIcons = { cap_leakage: '⚠️', unusual_exclusion: '📋', audit_window: '🕐',
                        underbilling: '💸', renewal_risk: '📅' };
    const items = ff.map(f => {
      const citHtml = f.citation
        ? `<div class="acq-finding-cite">&#x201C;${esc(f.citation.text)}&#x201D;</div>`
        : '';
      const valHtml = f.annualValue
        ? `<div class="acq-risk-impact">${fmt(f.annualValue)}/yr</div>`
        : '';
      return `
      <div class="acq-finding-item">
        <span class="acq-risk-icon">${typeIcons[f.type] || '⚠️'}</span>
        <div class="acq-finding-body">
          <div class="acq-finding-header">
            <span class="acq-finding-tenant">${esc(f.tenantName)}</span>
            <span class="acq-finding-label">${esc(f.label)}</span>
          </div>
          ${citHtml}
        </div>
        ${valHtml}
      </div>`;
    }).join('');
    return `<div class="acq-section-sub">Key Findings with Lease Citations</div>
    <div class="acq-findings-list">${items}</div>`;
  })();

  // ── Tenant-level recon table ───────────────────────────────────────────────
  const rows = (report.underbilling || []).map(r => {
    const badgeCls = r.cause === 'none' ? 'none' : r.cause;
    return `
    <tr>
      <td>${esc(r.tenantName)}</td>
      <td>${fmt(r.fullLiability)}</td>
      <td>${fmt(r.allocatedAmount)}</td>
      <td>${fmt(r.gap)}</td>
      <td><span class="acq-risk-badge ${badgeCls}">${esc(r.cause)}</span></td>
    </tr>`;
  }).join('');

  const tenantTable = rows ? `
  <div class="acq-section-sub">Tenant-Level Reconciliation</div>
  <table class="acq-risk-table">
    <thead><tr>
      <th>Tenant</th><th>Full Liability</th><th>Allocated</th><th>Gap</th><th>Cause</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>` : '';

  // ── Audit windows ──────────────────────────────────────────────────────────
  const auditChips = (report.auditWindows || []).map(w =>
    `<span class="acq-audit-chip ${esc(w.windowStatus)}">${esc(w.tenantName)} — ${esc(w.windowStatus)}</span>`
  ).join('');
  const auditHtml = auditChips
    ? `<div class="acq-section-sub">Audit Windows</div><div>${auditChips}</div>`
    : '';

  // ── Renewal risk ───────────────────────────────────────────────────────────
  const renewalHtml = (() => {
    const rr = (report.renewalRisk || []);
    if (!rr.length) return '';
    const chips = rr.map(r => {
      const cls  = r.riskLevel === 'critical' ? 'acq-audit-chip expired'
                 : r.riskLevel === 'high'     ? 'acq-audit-chip closing'
                 : 'acq-audit-chip unknown';
      const days = r.daysToExpiry !== null
        ? (r.daysToExpiry < 0 ? 'Expired' : `${r.daysToExpiry}d`)
        : '?';
      return `<span class="${cls}">${esc(r.tenantName)} — ${days}</span>`;
    }).join('');
    return `<div class="acq-section-sub">Lease Expiry Risk</div><div>${chips}</div>`;
  })();

  // ── Pro-rata flags ─────────────────────────────────────────────────────────
  const proRataHtml = (() => {
    const pr = (report.proRataRisk || []).filter(r => r.isNonStandard);
    if (!pr.length) return '';
    const chips = pr.map(r =>
      `<span class="acq-audit-chip closing">${esc(r.tenantName)} — ${esc(r.proRataMethod || 'unknown')}</span>`
    ).join('');
    return `<div class="acq-section-sub">Non-Standard Pro-Rata Methods</div><div>${chips}</div>`;
  })();

  const exportBar = `
  <div class="acq-export-bar">
    <button class="acq-export-btn" onclick="acqExportPdf()">&#x1F4E5; Export PDF</button>
    <span class="acq-export-note">PDF export coming soon — full report with citations.</span>
  </div>`;

  const riskTabContent = `${kpis}${topRisksHtml}${findingsHtml}${tenantTable}${auditHtml}${renewalHtml}${proRataHtml}${exportBar}`;
  const rrTabContent   = _renderRentRollTab(report.rentRoll, report.tenantSummary || []);

  container.innerHTML = `
  <div class="acq-report">
    <div class="acq-report-tabs">
      <button class="acq-tab${_acqActiveTab === 'risk'    ? ' active' : ''}" data-tab="risk"     onclick="switchAcqTab('risk')">Risk Analysis</button>
      <button class="acq-tab${_acqActiveTab === 'rentroll'? ' active' : ''}" data-tab="rentroll" onclick="switchAcqTab('rentroll')">&#x1F4CA;&nbsp;Rent Roll</button>
    </div>
    <div id="acqTabRisk" class="acq-tab-pane"${_acqActiveTab !== 'risk'     ? ' style="display:none"' : ''}>
      ${riskTabContent}
    </div>
    <div id="acqTabRentRoll" class="acq-tab-pane"${_acqActiveTab !== 'rentroll' ? ' style="display:none"' : ''}>
      ${rrTabContent}
    </div>
  </div>`;
}

// ── Tab switching ──────────────────────────────────────────────────────────────
function switchAcqTab(tab) {
  _acqActiveTab = tab;
  const risk = document.getElementById('acqTabRisk');
  const rr   = document.getElementById('acqTabRentRoll');
  if (risk) risk.style.display = tab === 'risk'     ? '' : 'none';
  if (rr)   rr.style.display   = tab === 'rentroll' ? '' : 'none';
  document.querySelectorAll('.acq-tab').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });
}

// ── Rent Roll helpers ──────────────────────────────────────────────────────────
function _acqSortTenantSummary(ts) {
  const { col, dir } = _acqRentRollSort;
  return ts.sort((a, b) => {
    let va = a[col], vb = b[col];
    if (va == null) va = dir === 'asc' ? '￿' : '';
    if (vb == null) vb = dir === 'asc' ? '￿' : '';
    if (typeof va === 'number' && typeof vb === 'number')
      return dir === 'asc' ? va - vb : vb - va;
    return dir === 'asc'
      ? String(va).localeCompare(String(vb))
      : String(vb).localeCompare(String(va));
  });
}

function _renderRentRollRows(ts) {
  const fmtMoney = v => v != null ? '$' + Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 }) : '—';
  const fmtSqft  = v => v != null ? Number(v).toLocaleString('en-US') : '—';
  const fmtDate  = iso => {
    if (!iso) return '—';
    const d = new Date(iso + 'T12:00:00');
    return isNaN(d.getTime()) ? String(iso) : d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  };
  return ts.map(t => `
    <tr>
      <td class="acq-ts-name">${esc(t.tenant_name)}</td>
      <td>${esc(t.suite || '—')}</td>
      <td>${fmtSqft(t.leased_sqft)}</td>
      <td class="acq-ts-term">${fmtDate(t.lease_start)}&nbsp;–&nbsp;${fmtDate(t.lease_end)}</td>
      <td>${fmtMoney(t.base_rent)}</td>
      <td class="acq-ts-renewal">${esc(t.renewal_options || '—')}</td>
      <td>${fmtMoney(t.security_deposit)}</td>
      <td class="acq-ts-cam">${esc(t.cam_structure || '—')}</td>
    </tr>`).join('');
}

function _sortAcqRentRoll(col) {
  if (_acqRentRollSort.col === col) {
    _acqRentRollSort.dir = _acqRentRollSort.dir === 'asc' ? 'desc' : 'asc';
  } else {
    _acqRentRollSort = { col, dir: 'asc' };
  }
  const review = _acqReviews.find(r => r.id === _activeAcqId);
  if (!review?.data?.analysis?.tenantSummary) return;
  const tbody = document.getElementById('acqRentRollTbody');
  if (!tbody) return;
  tbody.innerHTML = _renderRentRollRows(_acqSortTenantSummary([...review.data.analysis.tenantSummary]));
  document.querySelectorAll('.acq-sort-th').forEach(th => {
    th.classList.remove('sort-asc', 'sort-desc');
    if (th.dataset.col === col) th.classList.add(_acqRentRollSort.dir === 'asc' ? 'sort-asc' : 'sort-desc');
  });
}

function _renderRentRollTab(rentRoll, tenantSummary) {
  if (!rentRoll) return '<div style="color:#64748b;padding:16px 0;">Run analysis to generate the rent roll.</div>';

  const occ   = rentRoll.occupancy   || {};
  const walt  = rentRoll.walt        || {};
  const rr    = rentRoll.rolloverRisk || { expiring12: { count:0, sqft:0, pctOfOccupied:0, tenants:[] }, expiring24: { count:0, sqft:0, pctOfOccupied:0, tenants:[] }, totalOccupied: 0 };
  const sched = rentRoll.expirationSchedule || [];

  const fmtPct  = v => v != null ? v + '%' : '—';
  const fmtSqft = v => v != null ? Number(v).toLocaleString('en-US') + ' sf' : '—';

  const kpiCards = `
  <div class="acq-kpi-row">
    <div class="acq-kpi">
      <div class="acq-kpi-val ${occ.occupancyRate >= 90 ? 'safe' : occ.occupancyRate >= 70 ? '' : 'danger'}">${fmtPct(occ.occupancyRate)}</div>
      <div class="acq-kpi-lbl">Occupancy</div>
    </div>
    <div class="acq-kpi">
      <div class="acq-kpi-val ${occ.vacantSqft > 0 ? 'danger' : 'safe'}">${fmtSqft(occ.vacantSqft)}</div>
      <div class="acq-kpi-lbl">Vacant Sq Ft</div>
    </div>
    <div class="acq-kpi">
      <div class="acq-kpi-val">${walt.walt != null ? walt.walt + ' yrs' : '—'}</div>
      <div class="acq-kpi-lbl">WALT</div>
    </div>
    <div class="acq-kpi">
      <div class="acq-kpi-val ${rr.expiring12.count > 0 ? 'danger' : 'safe'}">${rr.expiring12.count}</div>
      <div class="acq-kpi-lbl">Exp. ≤12 Mo</div>
    </div>
    <div class="acq-kpi">
      <div class="acq-kpi-val ${rr.expiring24.count > 0 ? '' : 'safe'}">${rr.expiring24.count}</div>
      <div class="acq-kpi-lbl">Exp. ≤24 Mo</div>
    </div>
  </div>`;

  const sortIcon = col => {
    if (_acqRentRollSort.col !== col) return '<span class="acq-sort-icon">&#x21C5;</span>';
    return _acqRentRollSort.dir === 'asc'
      ? '<span class="acq-sort-icon active">&#x2191;</span>'
      : '<span class="acq-sort-icon active">&#x2193;</span>';
  };

  const COLS = [
    { key: 'tenant_name',      label: 'Tenant' },
    { key: 'suite',            label: 'Suite' },
    { key: 'leased_sqft',      label: 'Sq Ft' },
    { key: 'lease_end',        label: 'Lease Term' },
    { key: 'base_rent',        label: 'Base Rent/yr' },
    { key: 'renewal_options',  label: 'Renewal' },
    { key: 'security_deposit', label: 'Deposit' },
    { key: 'cam_structure',    label: 'CAM Structure' },
  ];
  const thead = COLS.map(c =>
    `<th class="acq-sort-th" data-col="${c.key}" onclick="_sortAcqRentRoll('${c.key}')">${esc(c.label)} ${sortIcon(c.key)}</th>`
  ).join('');

  const tbody = _renderRentRollRows(_acqSortTenantSummary([...tenantSummary]));

  const maxSchedSqft = sched.length ? Math.max(1, ...sched.map(r => r.sqft)) : 1;
  const schedRows = sched.map(r => `
    <tr>
      <td>${r.year}</td>
      <td>${r.count}</td>
      <td>${Number(r.sqft).toLocaleString('en-US')} sf</td>
      <td><div class="acq-exp-bar-wrap"><div class="acq-exp-bar" style="width:${Math.round((r.sqft / maxSchedSqft) * 100)}%"></div></div></td>
    </tr>`).join('');

  const schedHtml = sched.length ? `
  <div class="acq-section-sub">Lease Expiration Schedule</div>
  <table class="acq-ts-table acq-exp-sched">
    <thead><tr><th>Year</th><th>Leases</th><th>Sq Ft</th><th style="min-width:120px"></th></tr></thead>
    <tbody>${schedRows}</tbody>
  </table>` : '';

  const rollCard = (data, cls, label) => `
  <div class="acq-rollover-card ${data.count > 0 ? cls : ''}">
    <div class="acq-rollover-period">${label}</div>
    <div class="acq-rollover-count">${data.count} lease${data.count !== 1 ? 's' : ''}</div>
    <div class="acq-rollover-sqft">${Number(data.sqft).toLocaleString('en-US')} sf &nbsp;·&nbsp; ${data.pctOfOccupied}% of occupied</div>
    ${data.tenants.length ? `<div class="acq-rollover-names">${data.tenants.map(esc).join(', ')}</div>` : ''}
  </div>`;

  return `
  ${kpiCards}
  <div class="acq-section-sub">Rent Roll</div>
  <div class="acq-ts-scroll">
    <table class="acq-ts-table">
      <thead><tr>${thead}</tr></thead>
      <tbody id="acqRentRollTbody">${tbody}</tbody>
    </table>
  </div>
  <div class="acq-rr-export-bar">
    <button class="acq-export-btn" onclick="acqExportRentRollCsv()">&#x1F4E5; Export CSV</button>
  </div>
  ${schedHtml}
  <div class="acq-section-sub">Lease Rollover Risk</div>
  <div class="acq-rollover-grid">
    ${rollCard(rr.expiring12, 'danger', 'Expiring ≤12 Months')}
    ${rollCard(rr.expiring24, 'warn',   'Expiring ≤24 Months')}
  </div>`;
}

function acqExportRentRollCsv() {
  const review = _acqReviews.find(r => r.id === _activeAcqId);
  if (!review?.data?.analysis?.tenantSummary?.length) {
    alert('No rent roll data to export. Run analysis first.');
    return;
  }
  const ts = review.data.analysis.tenantSummary;
  const headers = ['Tenant','Suite','Sq Ft','Lease Start','Lease End',
                   'Base Rent/yr','Renewal Options','Security Deposit','CAM Structure'];
  const escape  = v => { const s = String(v ?? ''); return s.includes(',') || s.includes('"') || s.includes('\n') ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const lines   = [headers, ...ts.map(t => [
    t.tenant_name || '', t.suite || '', t.leased_sqft ?? '',
    t.lease_start || '', t.lease_end || '', t.base_rent ?? '',
    t.renewal_options || '', t.security_deposit ?? '', t.cam_structure || '',
  ])].map(r => r.map(escape).join(','));
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), {
    href: url, download: (review.name || 'rent-roll').replace(/[^a-z0-9_\-]/gi, '_') + '.csv',
  });
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function acqExportPdf() {
  alert('PDF export is coming soon. The full report with citations and evidence appendix will be available in the next release.');
}

function _genUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  _loadCheckpoints();

  // Show developer-only UI elements on localhost only
  const isLocalDev = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (isLocalDev) {
    const dbhBtn = document.getElementById('dbHealthBtn');
    if (dbhBtn) dbhBtn.style.removeProperty('display');
    const testLabSlot = document.getElementById('testLabReportSlot');
    if (testLabSlot) testLabSlot.style.removeProperty('display');
  }

  // ── Tenant portal mode — bypass portfolio for tenant-role users ───────────
  // SECURITY: tenant check must come before review-mode check so that a tenant
  // navigating to a #review/<token> URL cannot enter the reviewer workflow.
  if (window.AccessControl && window.AuthService &&
      window.AccessControl.isTenantPortalMode(window.AuthService.getCurrentUser())) {
    await _initTenantPortal();
    return;
  }

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
    _loadAcqReviewsAndRender();
  } catch (e) {
    const isNet = /load failed|failed to fetch|networkerror|offline/i.test(e?.message || '');
    if (!isNet) logError('init.loadProperties', e, {});
    else console.warn('[init] offline — loading from localStorage');
    // Show the dashboard with zero properties — never hide it on a transient error.
    // This keeps the user on the correct screen instead of the empty workflow.
    _props = [];
    portfolio.splice(0, portfolio.length);
    renderPortfolio([]);
    _renderAcqSection([]);
    document.getElementById('portfolioDashboard').style.display = 'block';
    document.getElementById('mainWorkflow').style.display       = 'none';
  }
}

