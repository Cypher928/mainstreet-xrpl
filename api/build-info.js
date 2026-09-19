/**
 * api/build-info.js — which deployment is this?
 * ============================================================================
 * A pilot session spent two hours producing history that could never become
 * durable, because the browser was on a hostname serving a build that predated
 * the feature under test. Nothing in the app could say so: index.html, its
 * modules and the database all answered correctly for the code that was
 * actually running, and there was no way to ask which code that was.
 *
 * This endpoint is the answer. There is no build step in this repository, so
 * no static asset can carry the commit — but a serverless function can, because
 * Vercel sets these in the deployment's own environment. build-stamp.js reads
 * it once at startup and logs one line beside the Supabase target.
 *
 * NOTHING SECRET LIVES HERE. A commit SHA, a branch name, an environment name
 * and a deployment id are public facts about a deployment; they are printed in
 * every build log and carried in the deployment URL. This file must never grow
 * a field that reads process.env for anything else.
 *
 * Answered with no-store. A cached answer is the one thing an endpoint whose
 * entire job is "which build is live" must never give.
 */
'use strict';

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({
    commit:   (process.env.VERCEL_GIT_COMMIT_SHA || '').trim() || null,
    ref:      (process.env.VERCEL_GIT_COMMIT_REF || '').trim() || null,
    env:      (process.env.VERCEL_ENV            || '').trim() || 'local',
    deployId: (process.env.VERCEL_DEPLOYMENT_ID  || '').trim() || null,
  });
};
