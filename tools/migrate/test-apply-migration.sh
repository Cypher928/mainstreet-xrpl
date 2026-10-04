#!/usr/bin/env bash
# tools/migrate/test-apply-migration.sh — offline tests for apply-migration.sh.
# A fake `curl` on PATH answers the two requests (history GET, migration POST)
# with whatever FAKE_GET / FAKE_POST say and FAILS LOUDLY if the token ever
# appears in curl's arguments. No network. No Supabase. Run: bash tools/migrate/test-apply-migration.sh
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
T=$(mktemp -d "${TMPDIR:-/tmp}/apply-mig-test.XXXXXX"); trap 'rm -rf "$T"' EXIT
mkdir -p "$T/bin" "$T/run"
cat > "$T/bin/curl" <<'EOF'
#!/usr/bin/env bash
out=""; url=""; post=0
for a in "$@"; do case "$a" in *sbp_*|*SECRET*) echo "TOKEN LEAKED IN CURL ARGV" >&2; exit 99;; esac; done
while [ $# -gt 0 ]; do case "$1" in --output) out="$2"; shift 2;; -X) post=1; shift 2;; https://*) url="$1"; shift;; *) shift;; esac; done
echo "$url post=$post" >> "$FAKE_LOG"
DEF_POST='{"success":true}'; DEF_GET='[{"version":"20261003173521","name":"044_acquisition_conversion_safeguards"}]'
if [ "$post" = 1 ]; then printf '%s' "${FAKE_POST_BODY:-$DEF_POST}" > "$out"; [ "${FAKE_POST:-200}" = "28" ] && exit 28; printf '%s' "${FAKE_POST:-200}"; exit 0; fi
printf '%s' "${FAKE_GET_BODY:-$DEF_GET}" > "$out"; printf '%s' "${FAKE_GET:-200}"
EOF
chmod +x "$T/bin/curl"
export FAKE_LOG="$T/curl.log"
TOKEN="sbp_$(printf '%040d' 7)"
cp "$HERE/apply-migration.sh" "$T/run/"
printf -- '-- test migration\nselect 1;\n' > "$T/run/099_test_migration.sql"
MD5=$(md5sum "$T/run/099_test_migration.sql" | cut -c1-32); SHA=$(sha256sum "$T/run/099_test_migration.sql" | cut -c1-64); BYTES=$(wc -c < "$T/run/099_test_migration.sql" | tr -d ' ')
approval() { cat > "$T/run/099_test_migration.approval" <<EOF
migration_name=${5:-099_test_migration}
project_ref=${1:-bhmktujbxdbvdmpybmad}
sql_md5=${2:-$MD5}
sql_sha256=${4:-$SHA}
sql_bytes=${3:-$BYTES}
approved_on=2026-10-04
EOF
}
pass=0; fail=0
run() { # name, expected exit, expected text, env...
  local name="$1" want_exit="$2" want_text="$3"; shift 3
  local out; out=$(cd "$T/run" && env PATH="$T/bin:$PATH" "$@" 2>&1); local code=$?
  if [ "$code" = "$want_exit" ] && printf '%s' "$out" | grep -q -- "$want_text"; then pass=$((pass+1)); echo "  ok   $name"; else fail=$((fail+1)); echo "  FAIL $name (exit $code, wanted $want_exit / '$want_text')"; printf '%s\n' "$out" | sed 's/^/       /' | tail -6; fi
}
reset() { rm -f "$T/run/.idempotency-key-"* "$T/run/.attempt-"* "$T/run/response-"* "$T/run/body-"* "$T/run/apply-"*.log; : > "$FAKE_LOG"; }

echo "apply-migration.sh offline tests"
approval; reset
run "check mode sends nothing and reads no token"           0 "CHECK complete"            env -u SUPABASE_ACCESS_TOKEN ./apply-migration.sh 099_test_migration --check
grep -q "starts with sbp_" "$T/run/apply-099_test_migration.log" 2>/dev/null && { fail=$((fail+1)); echo "  FAIL token characters written to the log"; } || { pass=$((pass+1)); echo "  ok   no token characters in the log"; }
[ ! -s "$FAKE_LOG" ] && { pass=$((pass+1)); echo "  ok   check mode made no request"; } || { fail=$((fail+1)); echo "  FAIL check mode made a request"; }
run "probe: token can read history, migration absent"      0 "PROBE complete"            env SUPABASE_ACCESS_TOKEN="$TOKEN" ./apply-migration.sh 099_test_migration --probe
run "send: accepted on HTTP 200, one POST"                  0 "ACCEPTED: HTTP 200"        env SUPABASE_ACCESS_TOKEN="$TOKEN" ./apply-migration.sh 099_test_migration
[ "$(grep -c 'post=1' "$FAKE_LOG")" = 1 ] && { pass=$((pass+1)); echo "  ok   exactly one POST was made"; } || { fail=$((fail+1)); echo "  FAIL POST count: $(grep -c 'post=1' "$FAKE_LOG")"; }
run "second plain run refused (attempt recorded)"           10 "previous attempt"         env SUPABASE_ACCESS_TOKEN="$TOKEN" ./apply-migration.sh 099_test_migration
K1=$(cat "$T/run/.idempotency-key-099_test_migration")
run "key file is reused, not replaced"                      10 "reusing Idempotency-Key"  env SUPABASE_ACCESS_TOKEN="$TOKEN" ./apply-migration.sh 099_test_migration
[ "$(cat "$T/run/.idempotency-key-099_test_migration")" = "$K1" ] && { pass=$((pass+1)); echo "  ok   key unchanged across runs"; } || { fail=$((fail+1)); echo "  FAIL key changed"; }
reset
run "send refused when history already holds the name"     10 "ALREADY RECORDED"         env SUPABASE_ACCESS_TOKEN="$TOKEN" FAKE_GET_BODY='[{"version":"20261004184427","name":"099_test_migration"}]' ./apply-migration.sh 099_test_migration
[ "$(grep -c 'post=1' "$FAKE_LOG")" = 0 ] && { pass=$((pass+1)); echo "  ok   no POST when already recorded"; } || { fail=$((fail+1)); echo "  FAIL POST made despite existing record"; }
reset
run "probe 401: invalid token, nothing sent"                7 "HTTP 401"                  env SUPABASE_ACCESS_TOKEN="$TOKEN" FAKE_GET=401 ./apply-migration.sh 099_test_migration
run "probe 403: missing permission, nothing sent"           7 "HTTP 403"                  env SUPABASE_ACCESS_TOKEN="$TOKEN" FAKE_GET=403 FAKE_GET_BODY='{"message":"Missing required permission(s): database_migrations_read"}' ./apply-migration.sh 099_test_migration
[ "$(grep -c 'post=1' "$FAKE_LOG")" = 0 ] && { pass=$((pass+1)); echo "  ok   401/403 probes made no POST"; } || { fail=$((fail+1)); echo "  FAIL POST made after failed probe"; }
reset
run "POST 403 is NOT CONCLUSIVE, attempt recorded"          7 "NOT CONCLUSIVE: HTTP 403"  env SUPABASE_ACCESS_TOKEN="$TOKEN" FAKE_POST=403 ./apply-migration.sh 099_test_migration
[ -s "$T/run/.attempt-099_test_migration" ] && { pass=$((pass+1)); echo "  ok   attempt file written on a non-conclusive send"; } || { fail=$((fail+1)); echo "  FAIL attempt file missing"; }
reset
run "POST timeout (curl 28) is NOT CONCLUSIVE"              6 "timed out"                 env SUPABASE_ACCESS_TOKEN="$TOKEN" FAKE_POST=28 ./apply-migration.sh 099_test_migration
reset
approval zhsuhehgehbzkmzurzyf
run "approval naming another project (Production ref) refused before any request" 3 "serves only the Pilot project" env SUPABASE_ACCESS_TOKEN="$TOKEN" ./apply-migration.sh 099_test_migration
[ ! -s "$FAKE_LOG" ] && { pass=$((pass+1)); echo "  ok   no request for a non-Pilot approval"; } || { fail=$((fail+1)); echo "  FAIL a request was made for a non-Pilot approval"; }
approval bhmktujbxdbvdmpybmad 00000000000000000000000000000000
run "approval md5 mismatch refused"                         3 "does not match the approval" env SUPABASE_ACCESS_TOKEN="$TOKEN" ./apply-migration.sh 099_test_migration
approval bhmktujbxdbvdmpybmad "$MD5" "$BYTES" "$(printf '%064d' 0)"
run "approval sha256 mismatch refused (md5 and size equal)"  3 "does not match the approval" env SUPABASE_ACCESS_TOKEN="$TOKEN" ./apply-migration.sh 099_test_migration
approval bhmktujbxdbvdmpybmad "$MD5" "$BYTES" "$SHA" 098_other_migration
run "approval written for another migration name refused" 3 "is for '098_other_migration'" env SUPABASE_ACCESS_TOKEN="$TOKEN" ./apply-migration.sh 099_test_migration
approval; printf 'applied_by=token sbp_%040d leaked here\n' 1 >> "$T/run/099_test_migration.approval"
run "approval carrying something token-shaped refused"      3 "token-shaped"              env SUPABASE_ACCESS_TOKEN="$TOKEN" ./apply-migration.sh 099_test_migration --check
approval; rm -f "$T/run/099_test_migration.approval"
run "missing approval refused"                              2 "no recorded approval"      env SUPABASE_ACCESS_TOKEN="$TOKEN" ./apply-migration.sh 099_test_migration
approval; reset
run "token with whitespace refused"                         5 "space or line break"       env SUPABASE_ACCESS_TOKEN="sbp_abc def" ./apply-migration.sh 099_test_migration
run "bad migration name refused"                            64 "not of the form"          env SUPABASE_ACCESS_TOKEN="$TOKEN" ./apply-migration.sh "rm -rf" --check
reset
run "no token and no terminal: refused"                     5 "no token"                  env -u SUPABASE_ACCESS_TOKEN ./apply-migration.sh 099_test_migration --probe </dev/null
grep -rq "sbp_" "$T/run"/*.log "$T/run"/.attempt-* "$T/run"/response-* 2>/dev/null && { fail=$((fail+1)); echo "  FAIL token found in a state file"; } || { pass=$((pass+1)); echo "  ok   token absent from every log/state/response file"; }
echo; echo "RESULT: $pass passed, $fail failed"
[ "$fail" = 0 ]
