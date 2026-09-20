# The public demo — `/demo`

A judge opens `https://www.mainstreet-review.com/demo` and is inside Cascade
Commons. No account, no sign-in, no database, nothing saved. What they are
looking at is the shipping product — the same Command Center, the same CAM
engine, the same evidence viewer — reading from a frozen copy of the demo seed
held in their own tab.

## Why it is built this way

The obvious approach is a dedicated demo account that everyone signs into. It
cannot be made safe here, and the reason is in the database rather than in the
site:

```
properties            properties_owner_all        ALL   {authenticated}
tenants               tenants_owner_all           ALL   {authenticated}
lease_jobs            lease_jobs_owner_all        ALL   {authenticated}
cam_reconciliations   cam_recon_owner_all         ALL   {authenticated}
lease_documents       lease_docs_owner_all        ALL   {authenticated}
tenant_field_evidence tfe_owner_all               ALL   {authenticated}
```

Every policy is `FOR ALL`. There is no SELECT-only grant and no policy for the
`anon` role at all, so the data has exactly two states: unreachable, or fully
writable. **Any session that can show a judge the demo can also delete it**, and
change the account's password. Hiding the credentials in a server endpoint
protects the password, not the data — what the endpoint returns is a privileged
session. A client-side "read-only mode" is not a boundary either, because the
token is in the browser and the console is one keystroke away.

Sharing one account is also wrong for reasons that have nothing to do with
security. Merely arriving writes: the stale-job reaper PATCHes `lease_jobs` on
every sign-in, twice, because of the duplicate-invocation defect. And judges
would collide — one presses Calculate and every other judge watching sees it,
because there is one row, not one per visitor.

So `/demo` has no rows. There is nothing to protect.

## The pieces

| File | What it does |
|---|---|
| `demo-snapshot.js` | The seed, frozen. Generated, never hand-edited. |
| `demo-store.js` | Replaces the Supabase client with an in-memory stand-in; closes the network. |
| `demo-shell.js` | Banner, opens on Cascade Commons, refuses actions that would mislead. |
| `tools/build-demo-snapshot.js` | Runs the real seeders and writes the snapshot. |
| `test-e2e-public-demo.js` | Proves all of the above, in a browser. |

Two lines in `index.html` load the first two before `supabase-config.js`, and
one line loads the third at the end. All three self-detect the route and return
immediately anywhere else, so `/app` and production are untouched by their
presence — `test-e2e-public-demo.js` section G asserts exactly that.

**The snapshot is not a fixture.** `tools/build-demo-snapshot.js` boots the real
`index.html` in a real browser, runs the real `ensureDemoProperty()` and
`ensureNorthgateDemo()`, and writes down what they produced. It refuses to write
at all unless Cascade comes back at seed v9 with 26 of 26 invoices documented.
Re-run it whenever the seed changes:

```
node tools/build-demo-snapshot.js            # writes demo-snapshot.js
node tools/build-demo-snapshot.js --check    # exit 1 if missing or stale
```

## The guarantees, and what enforces each

| Promise | Enforced by |
|---|---|
| No credentials anywhere | Nothing authenticates. There is no key to leak. |
| No database connection | `window.supabase` is replaced before `script.js:46` destructures `createClient` from it. |
| No writes escape the tab | Every mutation lands in a JavaScript object that dies with the tab. |
| Nothing persists | `localStorage` and `sessionStorage` are replaced with in-memory equivalents for this route. |
| Fails closed | `fetch` and `XMLHttpRequest` refuse Supabase and `/api` outright, so an unanticipated path cannot reach the network. |
| Isolated per visitor | The snapshot is deep-copied on load. |

The storage replacement is not belt-and-braces; it was a real leak. The app
keeps caches keyed by user id — `_ms_props_v2_<uid>`, `mainstreet_ckpt_v1_<uid>`,
`ms_camYear_<uid>` — and those were landing in real `localStorage`, so a
visitor's edits survived a reload and the next person on a shared laptop would
have inherited them. That makes "read-only demonstration data" a half-truth, so
the storage is now in-memory too.

## Two things the demo has to say differently

**The lease terms are put back by hand.** `loadProperties()` rebuilds
`property.tenants` from the normalized `tenants` table, which has nine columns
and no room for `capBaseAmount` or `excluded_categories`. The rebuilt tenants
carry a cap percentage with nothing to apply it to, so the reconciliation ran
uncapped: Whole Health Market billed **$66,629.23** instead of the **$34,650.00**
its lease caps it at, and Summit's unapplied parking exclusion vanished with its
"needs confirmation". Four of five billable, all of it wrong. A signed-in
session never shows this, because `ensureDemoProperty()` puts the rich objects
straight into `_props`. `demo-shell.js` restores them from the snapshot — the
same seeded objects, put back where the round-trip dropped them.

**Two sentences are rewritten.** Press Calculate and the app says, correctly for
itself, that results "weren't saved to the server … contact support"; the header
chip says "Synced to cloud ✓". On this route there is no server, nothing was
lost, there is no support to contact and there is no cloud. Both are corrected
in `demo-shell.js` rather than in `script.js`, because the product's own wording
is right for the product and this route is the exception.

## What is disabled, and what that means

File inputs are disabled and destructive controls are greyed, with a toast that
says why. **This is honesty, not security.** No write can leave the tab whatever
a visitor clicks; without the refusals they could reasonably believe they had
edited the demonstration data for everyone. The refusal is a statement to the
user, not a lock on a door — there is no door.

XRPL stays as it is everywhere else: the settlement shown is the real mainnet
transaction, linked to the public ledger, and nothing in the product can sign or
move funds. `/api/rlusd-settlement` is unreachable from here in any case.

## Verifying

```
node test-e2e-public-demo.js
```

Twenty-seven checks in a real browser: boots with no account and no login
screen; **zero** requests to Supabase or `/api`, asserted against a recording of
every request the page attempts rather than against a stub; opens on Cascade
Commons; reports seed v9, 26 documented invoices, 3 of 5 billable and Whole
Health Market at its capped $34,650.00; survives a deliberate tamper-then-reload
with the seed intact and nothing in `localStorage`; shows the banner; and does
none of it on `/app`.
