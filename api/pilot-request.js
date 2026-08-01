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

const MAX_FILE = 8 * 1024 * 1024;
const PROPS = ['1', '2–5', '6–20', '21–50', '50+', '2-5', '6-20', '21-50'];

function clean(v, max) {
  return typeof v === 'string' ? v.trim().slice(0, max || 200) : '';
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
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

  let leaseName = null, leasePath = null, fileBuf = null;
  if (body.lease && typeof body.lease === 'object' && body.lease.data) {
    leaseName = clean(body.lease.name, 240) || 'lease';
    try { fileBuf = Buffer.from(String(body.lease.data), 'base64'); } catch (e) { fileBuf = null; }
    if (fileBuf && fileBuf.length > MAX_FILE) {
      return res.status(413).json({ error: 'Sample lease is larger than 8MB' });
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
          'Content-Type': clean(body.lease.type, 100) || 'application/octet-stream',
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
