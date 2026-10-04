#!/usr/bin/env bash
# tools/migrate/apply-migration.sh — apply ONE approved migration to the PILOT
# Supabase project through the Management API, as a tracked migration, at most
# once per approval. This is the procedure that applied 044 (2026-10-03) and 045
# (2026-10-04), generalised; docs/MIGRATION_RUNBOOK.md explains it in plain words.
#
#   Endpoint  POST https://api.supabase.com/v1/projects/<ref>/database/migrations
#   Body      { "name": <migration name>, "query": <the .sql file, verbatim> }
#   Header    Idempotency-Key: <one UUID per approval, kept in a file>
#   Token     SUPABASE_ACCESS_TOKEN in the environment, or typed at a silent
#             prompt. A scoped personal access token with ONLY "Database →
#             Migrations: read-write" on the Pilot project is enough (045 used
#             one). The token is never printed, never written to a file that
#             outlives the call, and never on a command line.
#
# USAGE (run from the folder that holds this script):
#   ./apply-migration.sh <name>            send once, e.g. 046_acquisition_general_ledger
#   ./apply-migration.sh <name> --check    verify files, build body.json, send nothing
#   ./apply-migration.sh <name> --probe    read-only: can this token read Pilot's
#                                          migration history? Is <name> already there?
#   ./apply-migration.sh <name> --resend   same key again; only after a read-only
#                                          check showed <name> ABSENT; asks for a phrase
#
# WHAT MUST BE NEXT TO THIS SCRIPT (or in the repository layout):
#   <name>.sql       the migration, byte for byte the reviewed file
#   <name>.approval  written by the person who approved it (tools/migrate/
#                    approvals/); holds project_ref, sql_md5, sql_bytes. The
#                    script refuses to send unless the file matches the approval
#                    and the approval names the Pilot project.
#
# SAFETY RULES, all enforced below:
#   · Only the Pilot project ref is accepted. Any other ref, Production included,
#     is refused before anything is read from the network.
#   · Before a send, a read-only GET of the migration history must return 200
#     and must NOT already contain <name>; otherwise nothing is sent.
#   · One send per run; a second plain run is refused once .attempt-<name>
#     exists. --resend reuses the same Idempotency-Key and needs a typed phrase.
#   · Only HTTP 200/201 is ACCEPTED. Everything else — any other status, any
#     curl error, any timeout — is NOT CONCLUSIVE and the database must be read
#     before anything else is done. The script never retries on its own.
set -u
set -o pipefail

PILOT_REF="bhmktujbxdbvdmpybmad"              # mainstreet-pilot. The only project this script serves.
API_BASE="https://api.supabase.com/v1/projects"
UUID_RE='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'

cd "$(dirname "$0")" || exit 1
NAME="${1:-}"
MODE="${2:-send}"
case "$NAME" in ''|--*) echo "usage: $0 <migration_name> [--check | --probe | --resend]"; exit 64 ;; esac
case "$MODE" in --check|--probe|send|--resend) ;; *) echo "usage: $0 <migration_name> [--check | --probe | --resend]"; exit 64 ;; esac
printf '%s' "$NAME" | grep -Eq '^[0-9]{3}[a-z]?_[A-Za-z0-9_]+$' || { echo "migration name '$NAME' is not of the form NNN_snake_case. Nothing sent."; exit 64; }
NUM="${NAME%%_*}"

LOG_FILE="apply-$NAME.log"
say() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" | tee -a "$LOG_FILE"; }
die() { say "ERROR: $1"; exit "${2:-1}"; }
say "---- run start, migration=$NAME, mode=$MODE"

# ── 1 · locate the files: next to the script first, then the repository layout ─
if [ -f "$NAME.sql" ]; then SQL_FILE="$NAME.sql"; elif [ -f "../../migrations/$NAME.sql" ]; then SQL_FILE="../../migrations/$NAME.sql"; else die "$NAME.sql not found next to this script or under migrations/. Nothing sent." 2; fi
if [ -f "$NAME.approval" ]; then APPROVAL="$NAME.approval"; elif [ -f "approvals/$NAME.approval" ]; then APPROVAL="approvals/$NAME.approval"; else die "$NAME.approval not found: this migration has no recorded approval. Nothing sent." 2; fi

# ── 2 · the approval names THIS project and THIS file ────────────────────────
aval() { grep -E "^$1=" "$APPROVAL" | head -1 | cut -d= -f2- | tr -d '[:space:]'; }
A_REF=$(aval project_ref); A_NAME=$(aval migration_name); A_MD5=$(aval sql_md5); A_SHA=$(aval sql_sha256); A_BYTES=$(aval sql_bytes); A_ON=$(aval approved_on)
[ "$A_NAME" = "$NAME" ] || die "$APPROVAL is for '$A_NAME', not '$NAME'. Nothing sent." 3
[ "$A_REF" = "$PILOT_REF" ] || die "$APPROVAL names project '$A_REF'. This script serves only the Pilot project $PILOT_REF; Production is never applied from here. Nothing sent." 3
printf '%s' "$A_MD5" | grep -Eq '^[0-9a-f]{32}$' || die "$APPROVAL has no valid sql_md5. Nothing sent." 3
printf '%s' "$A_SHA" | grep -Eq '^[0-9a-f]{64}$' || die "$APPROVAL has no valid sql_sha256. Nothing sent." 3
grep -Eq 'sbp_[0-9a-f]{20,}|Bearer ' "$APPROVAL" && die "$APPROVAL contains something token-shaped. Approvals never hold secrets. Nothing sent." 3
printf '%s' "$A_BYTES" | grep -Eq '^[0-9]+$' || die "$APPROVAL has no valid sql_bytes. Nothing sent." 3
[ -n "$A_ON" ] || die "$APPROVAL has no approved_on date. Nothing sent." 3
if command -v md5sum >/dev/null 2>&1; then ACTUAL_MD5=$(md5sum "$SQL_FILE" | cut -c1-32); else ACTUAL_MD5=$(md5 -q "$SQL_FILE"); fi
ACTUAL_BYTES=$(wc -c < "$SQL_FILE" | tr -d ' ')
if command -v sha256sum >/dev/null 2>&1; then ACTUAL_SHA=$(sha256sum "$SQL_FILE" | cut -c1-64); else ACTUAL_SHA=$(shasum -a 256 "$SQL_FILE" | cut -c1-64); fi
[ "$ACTUAL_MD5" = "$A_MD5" ] && [ "$ACTUAL_SHA" = "$A_SHA" ] && [ "$ACTUAL_BYTES" = "$A_BYTES" ] \
  || die "$SQL_FILE md5=$ACTUAL_MD5 sha256=$ACTUAL_SHA bytes=$ACTUAL_BYTES does not match the approval (md5=$A_MD5 sha256=$A_SHA bytes=$A_BYTES). Nothing sent." 3
say "OK approval: $APPROVAL (approved_on=$A_ON) matches $SQL_FILE md5=$ACTUAL_MD5 sha256=$ACTUAL_SHA bytes=$ACTUAL_BYTES, project=$PILOT_REF"

# ── 3 · request body built from the file bytes; proven to round-trip exactly ─
BODY_FILE="body-$NAME.json"
python3 - "$SQL_FILE" "$NAME" "$BODY_FILE" "$A_MD5" <<'PY' || die "could not build/verify the request body. Nothing sent." 4
import json, hashlib, sys
sql_path, name, body_path, expected = sys.argv[1:5]
sql = open(sql_path, 'rb').read()
open(body_path, 'w', encoding='utf-8').write(json.dumps({"name": name, "query": sql.decode('utf-8')}, ensure_ascii=False))
back = json.load(open(body_path, encoding='utf-8'))['query'].encode('utf-8')
assert back == sql, "body does not round-trip to the file bytes"
assert hashlib.md5(back).hexdigest() == expected, "embedded query md5 differs from the approval"
print("OK body: embedded query md5=" + hashlib.md5(back).hexdigest() + " bytes=" + str(len(back)) + " -> " + body_path)
PY

# ── 4 · idempotency key: one UUID per approval, never replaced once it exists ─
KEY_FILE=".idempotency-key-$NAME"; ATTEMPT_FILE=".attempt-$NAME"; RESPONSE_FILE="response-$NAME.json"
if [ -f "$KEY_FILE" ]; then
  [ "$(wc -l < "$KEY_FILE" | tr -d ' ')" -le 1 ] || die "$KEY_FILE has more than one line. Not touching it. Nothing sent." 8
  IDEMPOTENCY_KEY=$(tr -d '[:space:]' < "$KEY_FILE")
  printf '%s' "$IDEMPOTENCY_KEY" | grep -Eq "$UUID_RE" || die "$KEY_FILE does not contain one valid UUID. Not touching it. Nothing sent." 8
  say "OK key: reusing Idempotency-Key from $KEY_FILE ($IDEMPOTENCY_KEY)"
else
  [ -f "$ATTEMPT_FILE" ] && die "$ATTEMPT_FILE exists but $KEY_FILE is missing: an earlier attempt's key is gone. Not generating a new one. Nothing sent." 9
  IDEMPOTENCY_KEY=$(python3 -c 'import uuid; print(uuid.uuid4())') || die "could not generate a UUID. Nothing sent." 4
  umask 077; printf '%s\n' "$IDEMPOTENCY_KEY" > "$KEY_FILE"; umask 022
  say "OK key: new Idempotency-Key saved to $KEY_FILE ($IDEMPOTENCY_KEY)"
fi

if [ "$MODE" = "--check" ]; then
  say "CHECK complete. Sent nothing; did not read a token. Files: $BODY_FILE, $KEY_FILE (if new), $LOG_FILE."
  exit 0
fi

# ── 5 · token: environment, else a silent prompt. Never printed, never in argv ─
if [ -z "${SUPABASE_ACCESS_TOKEN:-}" ]; then
  if [ -t 0 ]; then
    printf 'Paste the Supabase access token and press Enter (nothing appears as you paste): '
    IFS= read -r -s SUPABASE_ACCESS_TOKEN; echo
  fi
fi
[ -n "${SUPABASE_ACCESS_TOKEN:-}" ] || die "no token: set SUPABASE_ACCESS_TOKEN or run in a terminal to be prompted. Nothing sent." 5
printf '%s' "$SUPABASE_ACCESS_TOKEN" | grep -Eq '[[:space:]]' && die "the token contains a space or line break (paste problem). Nothing sent." 5
case "$SUPABASE_ACCESS_TOKEN" in sbp_*) TOKEN_KIND="an sbp_ personal access token";; *) TOKEN_KIND="NOT an sbp_ token (check what was pasted)";; esac
say "OK token: ${#SUPABASE_ACCESS_TOKEN} characters, $TOKEN_KIND (value never shown or written)"
umask 077
CURL_CFG=$(mktemp "${TMPDIR:-/tmp}/apply-mig.XXXXXX") || die "could not create temp file. Nothing sent." 4
PROBE_OUT=$(mktemp "${TMPDIR:-/tmp}/apply-mig-probe.XXXXXX") || { rm -f "$CURL_CFG"; die "could not create temp file. Nothing sent." 4; }
trap 'rm -f "$CURL_CFG" "$PROBE_OUT"' EXIT
printf 'header = "Authorization: Bearer %s"\n' "$SUPABASE_ACCESS_TOKEN" > "$CURL_CFG"
unset SUPABASE_ACCESS_TOKEN
umask 022

# ── 6 · read-only probe of the migration history (auth + double-apply guard) ──
if PROBE_HTTP=$(curl --silent --show-error --connect-timeout 30 --max-time 60 --config "$CURL_CFG" \
     --output "$PROBE_OUT" --write-out '%{http_code}' "$API_BASE/$PILOT_REF/database/migrations" 2>>"$LOG_FILE"); then PROBE_EXIT=0; else PROBE_EXIT=$?; fi
if [ "$PROBE_EXIT" -ne 0 ]; then say "PROBE: NETWORK PROBLEM (curl exit $PROBE_EXIT). Nothing sent."; exit 6; fi
case "$PROBE_HTTP" in
  200) ;;
  401) say "PROBE: HTTP 401 — the token is invalid or incomplete. Nothing sent."; exit 7 ;;
  403) say "PROBE: HTTP 403 — the token lacks 'Database → Migrations' permission on $PILOT_REF, or belongs to another account. Message: $(head -c 200 "$PROBE_OUT" | tr -d '\n')"; say "Nothing sent."; exit 7 ;;
  *)   say "PROBE: HTTP $PROBE_HTTP — $(head -c 200 "$PROBE_OUT" | tr -d '\n'). Nothing sent."; exit 7 ;;
esac
PROBE_SUMMARY=$(python3 - "$PROBE_OUT" "$NAME" <<'PY' 2>/dev/null
import json, sys
d = json.load(open(sys.argv[1])); rows = d if isinstance(d, list) else d.get('migrations', [])
rows = sorted(rows, key=lambda r: str(r.get('version', '')))
present = [r for r in rows if r.get('name') == sys.argv[2]]
print("entries=%d newest=%s %s present=%d" % (len(rows), rows[-1].get('version','?') if rows else '-', rows[-1].get('name','?') if rows else '-', len(present)))
PY
)
say "PROBE: HTTP 200, history readable — $PROBE_SUMMARY"
case "$PROBE_SUMMARY" in *"present=0"*) ;; *"present="*) say "$NAME is ALREADY RECORDED on $PILOT_REF. Nothing sent. Verify the database read-only; do not re-run."; exit 10 ;; *) say "could not parse the history. Nothing sent."; exit 7 ;; esac
if [ "$MODE" = "--probe" ]; then say "PROBE complete: this token can use the migrations endpoint and $NAME is absent. Sent nothing."; exit 0; fi

# ── 7 · one attempt per approval; --resend is gated ──────────────────────────
RESEND_PHRASE="$NUM ABSENT ON $PILOT_REF"
if [ "$MODE" = "send" ]; then
  [ -f "$ATTEMPT_FILE" ] && die "a previous attempt is recorded in $ATTEMPT_FILE. Verify the database read-only first; a second send needs --resend. Nothing sent." 10
else
  [ -s "$ATTEMPT_FILE" ] || die "--resend given but $ATTEMPT_FILE has no earlier attempt. Use a plain run. Nothing sent." 11
  ATTEMPT_RE='^([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z) mode=(send|--resend) key=([0-9a-fA-F-]{36})$'
  LINE_NO=0
  while IFS= read -r LINE || [ -n "$LINE" ]; do
    LINE_NO=$((LINE_NO + 1))
    [[ "$LINE" =~ $ATTEMPT_RE ]] || die "$ATTEMPT_FILE line $LINE_NO is malformed. Inconsistent attempt history; not sending." 11
    [ "${BASH_REMATCH[3]}" = "$IDEMPOTENCY_KEY" ] || die "$ATTEMPT_FILE line $LINE_NO records a different key than $KEY_FILE. Not sending." 11
  done < "$ATTEMPT_FILE"
  say "RESEND requested after $LINE_NO earlier attempt(s) with key $IDEMPOTENCY_KEY. The probe above showed $NAME absent."
  say "To continue, type exactly: $RESEND_PHRASE"
  ( : < /dev/tty ) 2>/dev/null || die "no terminal available to read the confirmation from. Nothing sent." 12
  printf 'confirmation> ' > /dev/tty 2>/dev/null
  IFS= read -r TYPED < /dev/tty 2>/dev/null || die "no confirmation entered. Nothing sent." 12
  [ "$TYPED" = "$RESEND_PHRASE" ] || die "confirmation did not match. Nothing sent." 12
  say "RESEND confirmed by operator (phrase matched; the probe is the evidence)."
fi

# ── 8 · send once; capture curl's exit code immediately; never retry ─────────
say "sending POST $API_BASE/$PILOT_REF/database/migrations name=$NAME idempotency-key=$IDEMPOTENCY_KEY (max 300 s)"
if [ -s "$ATTEMPT_FILE" ] && [ -n "$(tail -c1 "$ATTEMPT_FILE")" ]; then printf '\n' >> "$ATTEMPT_FILE"; fi
printf '%s mode=%s key=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$MODE" "$IDEMPOTENCY_KEY" >> "$ATTEMPT_FILE"
umask 077; : > "$RESPONSE_FILE"; umask 022
if HTTP=$(curl --silent --show-error --connect-timeout 30 --max-time 300 \
  --config "$CURL_CFG" \
  --output "$RESPONSE_FILE" --write-out '%{http_code}' \
  -X POST "$API_BASE/$PILOT_REF/database/migrations" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $IDEMPOTENCY_KEY" \
  --data-binary @"$BODY_FILE" 2>>"$LOG_FILE"); then CURL_EXIT=0; else CURL_EXIT=$?; fi
rm -f "$CURL_CFG" "$PROBE_OUT"; trap - EXIT
say "curl exit=$CURL_EXIT http=${HTTP:-none}; response body in $RESPONSE_FILE (never contains the token)"

# ── 9 · outcome: only 200/201 is ACCEPTED; everything else is NOT CONCLUSIVE ──
VERIFY="Have the migration history read read-only before doing anything else. Keep $KEY_FILE and $ATTEMPT_FILE. Do not re-run this script."
if [ "$CURL_EXIT" -ne 0 ]; then
  case "$CURL_EXIT" in
    28)      say "NOT CONCLUSIVE: curl timed out (exit 28). The request may have reached Supabase and may have run." ;;
    6|7|35)  say "NOT CONCLUSIVE: curl exit $CURL_EXIT (DNS/connect/TLS). Execution is unlikely but not ruled out." ;;
    *)       say "NOT CONCLUSIVE: curl exit $CURL_EXIT." ;;
  esac
  say "$VERIFY"; exit 6
fi
case "$HTTP" in
  200|201) say "ACCEPTED: HTTP $HTTP. $NAME was sent once and accepted. Next: read-only verification (record, objects, fingerprint). Do not re-run."; exit 0 ;;
  401|403) say "NOT CONCLUSIVE: HTTP $HTTP (token rejected or lacks Migrations read-write). Execution is unlikely but not ruled out. Message: $(head -c 200 "$RESPONSE_FILE" | tr -d '\n')"; say "$VERIFY"; exit 7 ;;
  429)     say "NOT CONCLUSIVE: HTTP 429 (rate limited). Execution is unlikely but not ruled out."; say "$VERIFY"; exit 7 ;;
  *)       say "NOT CONCLUSIVE: HTTP $HTTP. Message: $(head -c 200 "$RESPONSE_FILE" | tr -d '\n')"; say "$VERIFY"; exit 7 ;;
esac
