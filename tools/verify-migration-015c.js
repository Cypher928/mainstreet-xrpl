'use strict';
/**
 * tools/verify-migration-015c.js — 015c's proof lives in verify-migration-015b.js.
 *
 *   node tools/verify-migration-015c.js
 *
 * 015c is a forward-only companion to 015b (service_role gains INSERT on
 * tenant_invitations, nothing else), so it is verified on the same two
 * throwaway databases 015b is built on: sections 10–13 of that verifier apply
 * 015c after 015b, require the exact privilege matrices before and after, run
 * the B1 gate's issue call as the service role, prove the rollback restores
 * 015b's set, and pin the order (015b re-run after 015c removes the grant;
 * 015c re-run restores it). Running the two as one script keeps the matrices
 * in one place and the cluster built once. This file exists so the runbook's
 * check (tools/verify-migration-<name>*.js) finds a verifier for 015c; it runs
 * the combined verifier and exits with its code. No Supabase project is
 * contacted.
 */
const { spawnSync } = require('child_process');
const path = require('path');

const r = spawnSync(process.execPath, [path.join(__dirname, 'verify-migration-015b.js')], { stdio: 'inherit', env: process.env });
process.exit(r.status === null ? 1 : r.status);
