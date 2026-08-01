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
 * REQUIRES a table. Run this once per project:
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

  let supabase;
  try {
    const { createClient } = require('@supabase/supabase-js');
    // target exports { name, url, anonKey, serviceRoleKey, network } — `url`,
    // not `supabaseUrl`. Checked against the module rather than assumed.
    supabase = createClient(target.url, target.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  } catch (e) {
    return res.status(503).json({ error: 'Request store is not reachable' });
  }

  // The file is best-effort: a failed upload must not lose the request itself.
  if (fileBuf) {
    try {
      const safe = leaseName.replace(/[^\w.\-]+/g, '_');
      const path = `pilot-requests/${Date.now()}-${safe}`;
      const up = await supabase.storage.from('pilot-requests').upload(path, fileBuf, {
        contentType: clean(body.lease.type, 100) || 'application/octet-stream',
        upsert: false,
      });
      if (!up.error) leasePath = path;
    } catch (e) { /* keep leasePath null; the row still records the filename */ }
  }

  const { error } = await supabase.from('pilot_requests').insert({
    name, company, email, properties,
    lease_name: leaseName, lease_path: leasePath,
    source: clean(req.headers && req.headers.referer, 300) || 'home',
    user_agent: clean(req.headers && req.headers['user-agent'], 300),
  });

  if (error) {
    // Surfaced, never swallowed. The modal shows the address so the visitor has
    // a way through even when this fails.
    console.error('[pilot-request] insert failed:', error.message);
    return res.status(503).json({ error: 'Could not record the request' });
  }

  return res.status(200).json({ ok: true, storedLease: !!leasePath });
};
