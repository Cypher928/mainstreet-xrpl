'use strict';
/**
 * test-dispute-polish.js — dispute workflow polish verification.
 * Covers: scannable AI explanation parsing/rendering, evidence citation chips
 * (live vs honest "not on file" placeholder), dispute packet structure
 * (executive summary, evidence index, sign-off), brand consistency, and mobile
 * spacing/tap targets in the dispute form.
 */
let pw; try { pw = require('playwright'); } catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }
const { chromium } = pw;
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = '/home/user/mainstreet-xrpl', PORT = 8755;
const MIME = { '.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.ico':'image/x-icon' };
let pass = 0, fail = 0;
const ok  = m => { console.log('  \x1b[32m✓\x1b[0m ' + m); pass++; };
const bad = (m, d) => { console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? ' — ' + d : '')); fail++; };
const sec = m => console.log('\n── ' + m + ' ──');

const SRC = fs.readFileSync(path.join(ROOT, 'test-e2e-activity-timeline.js'), 'utf8');
const SUPABASE_MOCK = SRC.slice(SRC.indexOf('const SUPABASE_MOCK = `') + 'const SUPABASE_MOCK = `'.length, SRC.indexOf('`;\n\n(async'));

const srv = http.createServer((rq, rs) => {
  let f = path.join(ROOT, rq.url === '/' ? '/index.html' : rq.url).split('?')[0];
  fs.readFile(f, (e, d) => { if (e) { rs.writeHead(404); rs.end(); return; } rs.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); rs.end(d); });
});

const MODEL_OUTPUT = [
  'STATUS: Might get questions',
  'WHY: The vendor name is generic and the category may read as capital work.',
  'SUGGESTION: Add the work order number and a one-line scope note to the line item.',
  'EVIDENCE: Lease clause, Invoice, Work order',
].join('\n');

srv.listen(PORT, '127.0.0.1', async () => {
  let browser;
  try { browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] }); }
  catch (_) { browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] }); }
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', m => logs.push({ t: m.type(), x: m.text() }));
  page.on('pageerror', e => logs.push({ t: 'PAGEERROR', x: e.message }));
  await page.route('**/supabase-js**', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: '/*mock*/' }));
  await page.addInitScript(SUPABASE_MOCK);

  try {
    await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForFunction(() => { const a = document.getElementById('appContent'); return a && a.style.display !== 'none' && a.style.display !== ''; }, null, { timeout: 45000 });
    await page.evaluate(() => loadDemo());
    await page.waitForFunction(() => { const el = document.getElementById('mainWorkflow'); return el && el.style.display !== 'none'; }, null, { timeout: 45000 });
    await page.waitForTimeout(400);

    sec('AI explanation — shorter and scannable');
    const parsed = await page.evaluate((t) => {
      const p = window.AIExplanation && AIExplanation.parse(t);
      return p ? { status: p.status, why: p.why, sugg: p.suggestion, ev: p.evidence } : null;
    }, MODEL_OUTPUT);
    parsed ? ok('structured output parses into sections') : bad('parse failed');
    (parsed && parsed.status === 'Might get questions') ? ok('STATUS extracted') : bad('status', parsed && parsed.status);
    (parsed && /vendor name is generic/.test(parsed.why)) ? ok('WHY extracted as one scannable line') : bad('why', parsed && parsed.why);
    (parsed && /work order number/.test(parsed.sugg)) ? ok('SUGGESTION extracted') : bad('suggestion');
    (parsed && parsed.ev.length === 3) ? ok('EVIDENCE parsed into 3 citation kinds') : bad('evidence', JSON.stringify(parsed && parsed.ev));

    const rendered = await page.evaluate((t) => {
      const html = AIExplanation.render(t, { sources: { 'invoice': { url: 'https://m/inv.pdf', label: 'PavePro invoice' } } });
      const d = document.createElement('div'); d.innerHTML = html; document.body.appendChild(d);
      const r = {
        statusChip: !!d.querySelector('.aix-status'),
        rows: d.querySelectorAll('.aix-row').length,
        live: d.querySelectorAll('.aix-chip--live').length,
        todo: d.querySelectorAll('.aix-chip--todo').length,
        liveIsLink: !!d.querySelector('a.aix-chip--live[href]'),
        todoSaysNotOnFile: /not on file/i.test(d.innerHTML),
        len: d.textContent.replace(/\s+/g, ' ').trim().length,
      };
      d.remove(); return r;
    }, MODEL_OUTPUT);
    rendered.statusChip ? ok('renders a status chip (scan in one glance)') : bad('no status chip');
    (rendered.rows === 2) ? ok('renders Why + Suggestion as labelled rows') : bad('rows', String(rendered.rows));
    (rendered.len < 400) ? ok('explanation is compact (' + rendered.len + ' chars, was a markdown wall)') : bad('too long', String(rendered.len));

    sec('Evidence citations — links when real, honest placeholder when not');
    (rendered.live === 1 && rendered.liveIsLink) ? ok('a record that IS on file renders as a live citation link') : bad('live chip', JSON.stringify(rendered));
    (rendered.todo === 2) ? ok('records not on file render as placeholders, not dead links') : bad('todo chips', String(rendered.todo));
    rendered.todoSaysNotOnFile ? ok('placeholders say "not on file" (never implies a document exists)') : bad('no honest label');

    const fallback = await page.evaluate(() => {
      const html = AIExplanation.render('This charge looks fine to me, no structure here.', {});
      return /aix--raw/.test(html) && /looks fine/.test(html);
    });
    fallback ? ok('free-form model output degrades safely (shown unchanged)') : bad('fallback broken');

    sec('Dispute packet — professional report structure');
    const packet = await page.evaluate(() => {
      let captured = '';
      const orig = window.openReport;
      window.openReport = (title, html) => { captured = html; };
      // Use a real dispute id — the demo does not necessarily start at 0.
      try { generateDisputePacket(disputes[0].id); } catch (e) { captured = 'ERROR:' + e.message; }
      window.openReport = orig;
      return {
        err: captured.startsWith('ERROR:') ? captured : (captured ? null : 'packet produced no output'),
        exec: /rpt-exec/.test(captured) && /Executive Summary/.test(captured),
        evIndex: /Evidence Index/.test(captured) && /rpt-evidence-index/.test(captured),
        flags: (captured.match(/rpt-ev-flag/g) || []).length,
        signoff: /rpt-signoff/.test(captured) && /Prepared by/.test(captured),
        brand: /MainStreet CAM Platform/.test(captured),
        oldBrand: /Mainstreet CAM Platform/.test(captured),
      };
    });
    packet.err ? bad('packet threw', packet.err) : ok('dispute packet generates without error');
    packet.exec ? ok('Executive Summary leads the packet (CBRE/JLL-style)') : bad('no exec summary');
    packet.evIndex ? ok('Evidence Index lists every supporting record') : bad('no evidence index');
    (packet.flags >= 6) ? ok('each evidence row flags On file / Not attached (' + packet.flags + ')') : bad('flags', String(packet.flags));
    packet.signoff ? ok('Prepared-by / Date sign-off block closes the report') : bad('no signoff');

    sec('Brand consistency (rough edge fixed)');
    packet.brand ? ok('report cover/footer reads "MainStreet"') : bad('brand not applied');
    !packet.oldBrand ? ok('no remaining "Mainstreet" (lowercase s) in reports') : bad('old brand still present');
    const heroBrand = await page.evaluate(() => {
      const h = document.querySelector('.hero-title');
      return h ? h.textContent.trim() : '';
    });
    (heroBrand === '' || heroBrand === 'MainStreet') ? ok('landing hero brand consistent') : bad('hero brand', heroBrand);

    sec('Console errors');
    const errs = logs.filter(l => (l.t === 'error' || l.t === 'PAGEERROR')
      && !/favicon|Failed to load resource|ERR_CERT|\[saveCamResults\]|\[loadCamResults\]|net::ERR/.test(l.x));
    errs.length === 0 ? ok('no unexpected console errors') : bad('console errors', JSON.stringify(errs.slice(0, 4)));
    await ctx.close();

    sec('Mobile — dispute workflow spacing and tap targets (390px)');
    const mctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const mp = await mctx.newPage();
    await mp.route('**/supabase-js**', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: '/*mock*/' }));
    await mp.addInitScript(SUPABASE_MOCK);
    await mp.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'networkidle', timeout: 30000 });
    await mp.waitForFunction(() => { const a = document.getElementById('appContent'); return a && a.style.display !== 'none' && a.style.display !== ''; }, { timeout: 10000 });
    await mp.evaluate(() => loadDemo());
    await mp.waitForFunction(() => { const el = document.getElementById('mainWorkflow'); return el && el.style.display !== 'none'; }, { timeout: 15000 });
    await mp.waitForTimeout(400);
    const m = await mp.evaluate(() => {
      // Mount a dispute form to measure real rendered styles.
      const host = document.createElement('div');
      host.innerHTML = '<div class="dispute-form"><div class="dispute-form-title">T</div>' +
        '<textarea id="mTa"></textarea><div class="dispute-form-btns">' +
        '<button class="d-submit-btn" id="mSub">Flag as Disputed</button>' +
        '<button class="d-cancel-btn" id="mCan">Cancel</button></div></div>';
      document.body.appendChild(host);
      const ta = document.getElementById('mTa'), sub = document.getElementById('mSub'), can = document.getElementById('mCan');
      const r = {
        taFont: parseFloat(getComputedStyle(ta).fontSize),
        subH: Math.round(sub.getBoundingClientRect().height),
        canH: Math.round(can.getBoundingClientRect().height),
        noOverflow: document.documentElement.scrollWidth <= window.innerWidth + 1,
      };
      host.remove(); return r;
    });
    (m.taFont >= 16) ? ok('dispute textarea is 16px (no iOS zoom-on-focus): ' + m.taFont + 'px') : bad('textarea font', String(m.taFont));
    (m.subH >= 44) ? ok('"Flag as Disputed" tap height ' + m.subH + 'px (>=44)') : bad('submit tap target', String(m.subH));
    (m.canH >= 44) ? ok('"Cancel" tap height ' + m.canH + 'px (>=44)') : bad('cancel tap target', String(m.canH));
    m.noOverflow ? ok('no horizontal overflow at 390px') : bad('page overflows');
    await mctx.close();
  } catch (e) {
    bad('UNCAUGHT', e.message);
    logs.slice(-20).forEach(l => console.error('   ' + l.t + ': ' + l.x));
  } finally {
    await browser.close(); srv.close();
    console.log('\n' + (fail === 0 ? '\x1b[32m' : '\x1b[31m') + 'RESULT: ' + pass + ' passed, ' + fail + ' failed\x1b[0m');
    process.exit(fail === 0 ? 0 : 1);
  }
});
