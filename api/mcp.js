'use strict';
/**
 * api/mcp.js — the HTTP surface for the read-only property-record capabilities.
 *
 * ONE ENDPOINT, and deliberately thin. Everything that decides anything lives
 * in api/_mcp-transport.js, which speaks no HTTP and can therefore be asserted
 * without a socket. This file turns a Node request into a plain object, hands it
 * over, and turns the answer back into a response.
 *
 * THE LINE THAT MATTERS IS `TRANSPORT.serve(request)`.
 *
 * `serve` takes a second parameter carrying the capability layer's test seams —
 * sbFetch, authFetch, deps. It is not passed here, and it cannot be: there is no
 * expression in this file that could produce it from `req`. That is how a caller
 * is prevented from supplying its own database transport or its own auth
 * resolver, and test-m9 asserts that this call site still has exactly one
 * argument.
 *
 * READ-ONLY. No write reaches the database through this endpoint. The nine
 * capabilities behind it read; the hydrator's transport refuses a non-GET
 * outright rather than merely never issuing one.
 */

const TRANSPORT = require('./_mcp-transport.js');

/** Body may already be parsed by the platform, or arrive as a raw stream. */
async function _readBody(req) {
  if (req.body !== undefined && req.body !== null && typeof req.body === 'object') {
    return req.body;
  }
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch (_e) { return null; }
  }
  if (typeof req.on !== 'function') return null;
  const text = await new Promise(function (resolve) {
    let buf = '';
    req.on('data', function (c) { buf += c; if (buf.length > 262144) { buf = ''; req.destroy(); } });
    req.on('end', function () { resolve(buf); });
    req.on('error', function () { resolve(''); });
  });
  if (!text) return null;
  try { return JSON.parse(text); } catch (_e) { return null; }
}

module.exports = async function handler(req, res) {
  let body = null;
  try {
    body = await _readBody(req);
  } catch (_e) {
    body = null;
  }

  const result = await TRANSPORT.serve({
    httpMethod: req.method,
    headers: req.headers || {},
    body: body,
    ip: (req.socket && req.socket.remoteAddress) || null,
    // There is no clock field on this object at all — serve() reads nowMs from
    // its seam parameter, which this call does not pass, so asOf comes from the
    // server clock and nothing a request carries can reach it.
  });

  const headers = result.headers || {};
  for (const k of Object.keys(headers)) res.setHeader(k, headers[k]);
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');

  if (result.body === null) return res.status(result.status).end();
  return res.status(result.status).json(result.body);
};

module.exports.TRANSPORT = TRANSPORT;
