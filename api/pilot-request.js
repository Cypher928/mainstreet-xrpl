/**
 * api/pilot-request.js — receives a pilot request from the marketing page.
 * ============================================================================
 * The three "Request a Pilot" buttons on home.html used to be mailto: links,
 * which hand off to whichever application owns the mail protocol — that is why
 * clicking one could open an unrelated browser. They now open an in-page modal
 * that posts here.
 *
 * Storage goes to the SAME Supabase project the rest of the serverless
 * functions talk to, chosen by api/_pilot-target.js: production on production,
 * the isolated pilot project on every preview. A marketing lead is not worth
 * a second connection story.
 *
 * REQUIRES a table. Run this in the SQL editor of each project this will serve
 * — the pilot project to test on a preview, the production project before this
 * ever reaches production. See docs/PILOT_REQUESTS_SETUP.md.
 *
 *   create table if not exists public.pilot_requests (
 *     id          uuid primary key default gen_random_uuid(),
 *     created_at  timestamptz not null default now(),
 *     name        text not null,
 *     company     text not null,
 *     email       text not null,
 *     properties  text not null,
 *     lease_name  text,
 *     lease_path  text,
 *     source      text,
 *     user_agent  text
 *   );
 *   alter table public.pilot_requests enable row level security;
 *   -- no policies: the service role bypasses RLS, and nothing else may read it
 *
 * The storage bucket is OPTIONAL. Without it the request still saves and the
 * row records the filename; only the attached file is not kept.
 *
 * If the table is absent this returns 503 with the reason rather than a cheerful
 * 200. A lead that silently evaporates is worse than one that visibly fails —
 * the modal shows the address so the visitor can still reach us.
 */
'use strict';

const target = require('./_pilot-target.js');
const { checkRate, sendRateLimited } = require('./_rate-limit');
const { checkEncodedSize, MAX_UPLOAD_BYTES } = require('../request-limits.js');

// ── SEC-6 (audit part 4): why this endpoint is public, and what bounds it ────
//
// It is UNAUTHENTICATED BY DESIGN and that is correct: it backs the "Request a
// Pilot" form on home.html, which anonymous visitors fill in. Requiring a login
// to ask for a login is not a security control, it is a broken funnel. The
// service role is used because the pilot_requests table has RLS on with no
// policies — nothing but this endpoint may read or write it, which is the right
// shape for a lead store.
//
// What was genuinely missing is everything that bounds an open endpoint:
//
//   1. NO RATE LIMIT. Every other handler limits by user id; there is no user
//      here, so this had nothing at all. Anyone could POST unlimited rows and
//      files into the same Supabase project that holds customer data. Now
//      limited by client IP.
//
//   2. NO FILE TYPE CHECK. api/upload.js validates extension against MIME;
//      this accepted arbitrary bytes with an arbitrary Content-Type. The
//      pilot-requests bucket is private (docs/PILOT_REQUESTS_SETUP.md), so this
//      was storage abuse rather than malware hosting — but an open write path
//      with no type check is a liability either way.
//
//   3. A LYING SIZE CONSTANT. MAX_FILE was 8 MB against a ~4.5 MB platform
//      body limit, so it fails closed by accident rather than by design. It now
//      uses the shared ceiling in request-limits.js.
//
// What is deliberately NOT added: an origin/referer allowlist. Both headers are
// trivially forged, so it would filter honest browsers and nothing else. Rate
// limiting is the control that actually bites. A captcha is the next step if
// abuse appears — it is a product decision, not a code one.

// A sample lease attached to a lead. Same allowlist shape as api/upload.js.
const LEAD_FILE_TYPES = {
  pdf:  'application/pdf',
  doc:  'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

function _clientIp(req) {
  const fwd = (req.headers && (req.headers['x-forwarded-for'] || req.headers['x-real-ip'])) || '';
  // x-forwarded-for is a comma-separated chain; the first entry is the client.
  const first = String(fwd).split(',')[0].trim();
  return first || 'unknown';
}
const PROPS = ['1', '2–5', '6–20', '21–50', '50+', '2-5', '6-20', '21-50'];

function clean(v, max) {
  return typeof v === 'string' ? v.trim().slice(0, max || 200) : '';
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Bound before any parsing work. 10 lead submissions per minute per IP is far
  // above any honest use of a contact form.
  {
    const rl = checkRate('ip:' + _clientIp(req), 10, 60000);
    if (!rl.ok) return sendRateLimited(res, rl);
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  if (!body || typeof body !== 'object') return res.status(400).json({ error: 'Malformed request' });

  const name = clean(body.name, 120);
  const company = clean(body.company, 160);
  const email = clean(body.email, 200);
  const properties = clean(body.properties, 20);

  if (!name || !company || !email || !properties) {
    return res.status(400).json({ error: 'Name, company, email and properties are all required' });
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).json({ error: 'That email address is not valid' });
  }
  // Bound the select rather than trusting the client's option list.
  if (PROPS.indexOf(properties) === -1) {
    return res.status(400).json({ error: 'Unrecognised property count' });
  }

  let leaseName = null, leasePath = null, fileBuf = null, leaseMime = null;
  if (body.lease && typeof body.lease === 'object' && body.lease.data) {
    leaseName = clean(body.lease.name, 240) || 'lease';

    // Type first — before decoding megabytes of base64 for a file we will not keep.
    const ext = (leaseName.split('.').pop() || '').toLowerCase();
    leaseMime = Object.prototype.hasOwnProperty.call(LEAD_FILE_TYPES, ext) ? LEAD_FILE_TYPES[ext] : null;
    if (!leaseMime) {
      return res.status(400).json({
        error: `A sample lease must be one of: ${Object.keys(LEAD_FILE_TYPES).join(', ')}.`,
      });
    }

    const sizeVerdict = checkEncodedSize(String(body.lease.data).length, 'sample lease');
    if (!sizeVerdict.ok) return res.status(413).json({ error: sizeVerdict.error });

    try { fileBuf = Buffer.from(String(body.lease.data), 'base64'); } catch (e) { fileBuf = null; }
    if (fileBuf && fileBuf.length > MAX_UPLOAD_BYTES) {
      return res.status(413).json({ error: `A sample lease must be under ${(MAX_UPLOAD_BYTES / 1048576).toFixed(1)} MB.` });
    }
  }

  // Direct REST, like every other function here. The first version used
  // @supabase/supabase-js — which is NOT a dependency of this project (package
  // .json carries only xrpl), so the require threw on every request and this
  // endpoint returned 503 unconditionally. The form could never have worked.
  const BASE = (target.url || '').replace(/\/+$/, '');
  const KEY = target.serviceRoleKey;
  if (!BASE || !KEY) {
    console.error('[pilot-request] no', target.name, 'url/service key configured');
    return res.status(503).json({ error: 'Request store is not configured' });
  }
  const auth = { apikey: KEY, Authorization: `Bearer ${KEY}` };

  // Best-effort: a failed upload must not lose the request itself. If the
  // bucket does not exist the row still records the filename.
  if (fileBuf) {
    try {
      const safe = leaseName.replace(/[^\w.\-]+/g, '_');
      const key = `${Date.now()}-${safe}`;
      const up = await fetch(`${BASE}/storage/v1/object/pilot-requests/${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: Object.assign({}, auth, {
          // The MIME we validated from the extension — never the caller's claim.
          'Content-Type': leaseMime,
          'x-upsert': 'false',
        }),
        body: fileBuf,
      });
      if (up.ok) leasePath = `pilot-requests/${key}`;
      else console.warn('[pilot-request] lease upload failed:', up.status);
    } catch (e) { console.warn('[pilot-request] lease upload threw:', e.message); }
  }

  let ins;
  try {
    ins = await fetch(`${BASE}/rest/v1/pilot_requests`, {
      method: 'POST',
      headers: Object.assign({}, auth, {
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      }),
      body: JSON.stringify({
        name, company, email, properties,
        lease_name: leaseName, lease_path: leasePath,
        source: clean(req.headers && req.headers.referer, 300) || 'home',
        user_agent: clean(req.headers && req.headers['user-agent'], 300),
      }),
    });
  } catch (e) {
    console.error('[pilot-request] insert threw:', e.message);
    return res.status(503).json({ error: 'Could not reach the request store' });
  }

  if (!ins.ok) {
    // Surfaced, never swallowed. The modal shows the address so the visitor has
    // a way through even when this fails.
    const detail = await ins.text().catch(function () { return ''; });
    console.error('[pilot-request] insert failed:', ins.status, detail.slice(0, 300));
    return res.status(503).json({
      error: ins.status === 404 || /does not exist/i.test(detail)
        ? 'The pilot_requests table has not been created yet'
        : 'Could not record the request',
    });
  }

  return res.status(200).json({ ok: true, storedLease: !!leasePath });
};
