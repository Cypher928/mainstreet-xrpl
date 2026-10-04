#!/usr/bin/env bash
# tools/migrate/test-checkers.sh — the verification checkers against deliberately
# wrong evidence. Every wrong case must exit non-zero and print NOT VERIFIED /
# UNEXPLAINED (or a usage error); only the faithful case may print VERIFIED /
# EXPLAINED. Uses 045's real approval and the real 045 inventories recorded on
# 2026-10-04 (copied under live-matrix/ as evidence). No network.
#   bash tools/migrate/test-checkers.sh
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
T=$(mktemp -d "${TMPDIR:-/tmp}/checkers-test.XXXXXX"); trap 'rm -rf "$T"' EXIT
NAME=045_acquisition_member_write_rules
KEY=82ffaede-02cb-497e-9bd5-ab8f1d490b87
GOOD_DETAIL='20261004184427 | statements=1 | md5=5ee571956613b4cf0beab2a36bbbcd2b | sha256=39311540872b645d0565b684442b4da455eb464634cddf4890929c36ffd6d656 | bytes=19462 | created_by set=true | idem=82ffaede-02cb-497e-9bd5-ab8f1d490b87 | rollback=0'
record() { # marker rows named detail newest
  printf '[{"k":"now","v":"x"},{"k":"project marker present (Pilot only)","v":"%s"},{"k":"migration rows","v":"%s"},{"k":"rows named %s","v":"%s"},{"k":"row detail","v":"%s"},{"k":"is the newest row","v":"%s"},{"k":"previous newest row","v":"20261003173521 044_acquisition_conversion_safeguards md5=4dbff7aa548199572f24c9e2e32ff200"}]' "$1" "$2" "$NAME" "$3" "$4" "$5" > "$T/r.json"; }
pass=0; fail=0
expect() { # label want_exit want_text cmd...
  local label="$1" want="$2" text="$3"; shift 3
  local out; out=$("$@" 2>&1); local code=$?
  if [ "$code" = "$want" ] && printf '%s' "$out" | grep -q -- "$text"; then pass=$((pass+1)); echo "  ok   $label"; else fail=$((fail+1)); echo "  FAIL $label (exit $code, wanted $want / '$text')"; printf '%s\n' "$out" | sed 's/^/       /' | tail -4; fi
}
CR="node $HERE/check-record.js"; CI="node $HERE/check-inventory.js"
echo "check-record.js"
record 1 45 1 "$GOOD_DETAIL" true
expect "faithful record → VERIFIED"                                   0 "VERIFIED"      $CR $NAME "$T/r.json" --expect-rows 45 --key $KEY
expect "no --key: refused as usage error (cannot pass without it)"     64 "required"     $CR $NAME "$T/r.json" --expect-rows 45
expect "no --expect-rows: refused as usage error"                      64 "required"     $CR $NAME "$T/r.json" --key $KEY
record 1 44 0 "none" n/a
expect "missing migration record → NOT VERIFIED"                      1 "NOT VERIFIED" $CR $NAME "$T/r.json" --expect-rows 45 --key $KEY
record 1 45 1 "${GOOD_DETAIL/39311540872b645d0565b684442b4da455eb464634cddf4890929c36ffd6d656/0000000000000000000000000000000000000000000000000000000000000000}" true
expect "wrong sha256 (md5 and bytes right) → NOT VERIFIED"             1 "recorded sha256" $CR $NAME "$T/r.json" --expect-rows 45 --key $KEY
record 1 45 1 "${GOOD_DETAIL/5ee571956613b4cf0beab2a36bbbcd2b/deadbeefdeadbeefdeadbeefdeadbeef}" true
expect "wrong md5 → NOT VERIFIED"                                     1 "recorded md5"  $CR $NAME "$T/r.json" --expect-rows 45 --key $KEY
record 1 45 1 "${GOOD_DETAIL/bytes=19462/bytes=19461}" true
expect "wrong byte count → NOT VERIFIED"                              1 "recorded bytes" $CR $NAME "$T/r.json" --expect-rows 45 --key $KEY
record 1 46 2 "$GOOD_DETAIL ;; $GOOD_DETAIL" true
expect "recorded twice → NOT VERIFIED"                                1 "want exactly 1" $CR $NAME "$T/r.json" --expect-rows 46 --key $KEY
record 1 45 1 "$GOOD_DETAIL" false
expect "not the newest row → NOT VERIFIED"                            1 "not the newest" $CR $NAME "$T/r.json" --expect-rows 45 --key $KEY
record 1 45 1 "${GOOD_DETAIL/idem=82ffaede-02cb-497e-9bd5-ab8f1d490b87/idem=null}" true
expect "no idempotency key on the row → NOT VERIFIED"                 1 "idempotency_key" $CR $NAME "$T/r.json" --expect-rows 45 --key $KEY
record 1 45 1 "$GOOD_DETAIL" true
expect "key differs from the one the script printed → NOT VERIFIED"   1 "the key the script printed" $CR $NAME "$T/r.json" --expect-rows 45 --key 00000000-0000-4000-8000-000000000000
expect "history count differs from before+1 → NOT VERIFIED"           1 "migration rows" $CR $NAME "$T/r.json" --expect-rows 46 --key $KEY
record 0 45 1 "$GOOD_DETAIL" true
expect "Pilot marker absent (not Pilot) → NOT VERIFIED"              1 "not Pilot"     $CR $NAME "$T/r.json" --expect-rows 45 --key $KEY
record 1 45 1 "${GOOD_DETAIL/statements=1/statements=3}" true
expect "recorded as several statements → NOT VERIFIED"                1 "statements="   $CR $NAME "$T/r.json" --expect-rows 45 --key $KEY
printf 'not json at all' > "$T/r.json"
expect "garbage instead of a result → non-zero"                       1 "no JSON array" $CR $NAME "$T/r.json" --expect-rows 45 --key $KEY
expect "unknown migration name (no approval) → non-zero"              1 "no approval"   $CR 099_no_such_migration "$T/r.json" --expect-rows 1 --key $KEY
expect "unsafe name → usage error"                                    64 "usage"         $CR "045; drop" "$T/r.json" --expect-rows 45 --key $KEY
# malformed approval: copy the tree, damage the approval, run from the copy
mkdir -p "$T/mig/approvals" "$T/mig/live-matrix"; cp "$HERE"/check-record.js "$T/mig/"; cp "$HERE/approvals/$NAME.approval" "$T/mig/approvals/"
sed -i.bak '/^sql_sha256=/d' "$T/mig/approvals/$NAME.approval"
record 1 45 1 "$GOOD_DETAIL" true
expect "approval missing its sha256 line → NOT VERIFIED"              1 "recorded sha256" node "$T/mig/check-record.js" $NAME "$T/r.json" --expect-rows 45 --key $KEY
printf 'garbage\n' > "$T/mig/approvals/$NAME.approval"
expect "approval reduced to garbage → NOT VERIFIED"                   1 "NOT VERIFIED"  node "$T/mig/check-record.js" $NAME "$T/r.json" --expect-rows 45 --key $KEY

echo "check-inventory.js"
B="$HERE/live-matrix/$NAME.inventory-before.txt"; A="$HERE/live-matrix/$NAME.inventory-after.txt"
expect "faithful 045 before/after → EXPLAINED"                        0 "EXPLAINED"     $CI $NAME "$B" "$A"
{ cat "$A"; echo "pol|public.tenants|sneaky_policy|ALL|PERMISSIVE|anon|true|true"; } > "$T/after1.txt"
expect "an extra policy the migration never names → UNEXPLAINED"     1 "UNEXPLAINED"   $CI $NAME "$B" "$T/after1.txt"
grep -v "^trg|tenants|tenants_delete_guard" "$A" > "$T/after2.txt" 2>/dev/null; [ "$(wc -l < "$T/after2.txt")" -lt "$(wc -l < "$A")" ] || { grep -v "^fn|resync_property_tenants" "$A" > "$T/after2.txt"; }
expect "a pre-existing object silently removed → UNEXPLAINED"         1 "UNEXPLAINED"   $CI $NAME "$B" "$T/after2.txt"
{ cat "$A"; echo "pri|public.properties|anon|DELETE,INSERT,SELECT"; } > "$T/after3.txt"
expect "a grant the migration names but did not intend is still only EXPLAINED by name (documented limit)" 0 "EXPLAINED" $CI $NAME "$B" "$T/after3.txt"
expect "missing input file → non-zero"                                1 ""              $CI $NAME "$B" "$T/nope.txt"
expect "unsafe name → usage error"                                    64 "usage"         $CI "045; drop" "$B" "$A"
echo; echo "RESULT: $pass passed, $fail failed"
[ "$fail" = 0 ]
