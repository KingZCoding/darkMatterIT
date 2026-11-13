#!/usr/bin/env bash
# Tests for deploy/pi/deploy-darkmatterits-dockerfile-check (task D3-fix2, Cody 2026-11-13:
# "Exact-match approved copy").
#
# What it proves: the deploy builds only when mailer/Dockerfile is byte-for-byte the approved
# copy. Identical passes (also with CRLF on both sides); one byte different, a trailing newline
# added, the approved copy missing, mailer/Dockerfile missing, a second `dockerfile` spelling,
# or a symlink in place of either file are refused; a wrong argument count is a usage error.
#
# The approved path is a stub in a temp folder, passed as an argument exactly as the deploy
# passes its own hard-coded path; the script reads no environment variable, so nothing outside
# the deploy script can redirect it (see the header of the script under test).
# Needs only bash, find, cmp and ln (no Docker, no root), so it runs in CI and on Git Bash:
#
#   bash deploy/pi/test/test-dockerfile-approved.sh                # test the repo's copy
#   bash deploy/pi/test/test-dockerfile-approved.sh /path/to/copy  # test another copy
#
# Symlink cases are SKIPPED where this user can't create symlinks (Windows without Developer
# Mode); CI sets REQUIRE_SYMLINKS=1 so a skip fails there.
# Exit 0 = every case behaved, 1 = otherwise.
set -uo pipefail

here=$(cd "$(dirname "$0")" && pwd)
check=${1:-$here/../deploy-darkmatterits-dockerfile-check}
tmp=$(mktemp -d "${TMPDIR:-/tmp}/D3F2-approved-test.XXXXXX")
trap 'rm -rf -- "$tmp"' EXIT
export MSYS=winsymlinks:nativestrict   # real links, not Git Bash copies

passed=0; failed=0; skipped=0
approved=$tmp/approved/mailer.Dockerfile

# fresh: a project whose mailer/Dockerfile and the approved copy are the same bytes.
fresh() {
  rm -rf -- "$tmp/project" "$tmp/approved"
  mkdir -p "$tmp/project/mailer" "$tmp/approved"
  printf 'FROM node:24-alpine\nCMD ["node", "server.js"]\n' > "$tmp/project/mailer/Dockerfile"
  cp "$tmp/project/mailer/Dockerfile" "$approved"
}

# expect NAME WANT [TEXT]: run the check; WANT is ok or refused; TEXT must appear in a refusal.
expect() {
  local name=$1 want=$2 text=${3:-} out code
  out=$(bash "$check" "$tmp/project" "$approved" 2>&1); code=$?
  if { [ "$want" = ok ] && [ "$code" = 0 ]; } ||
     { [ "$want" = refused ] && [ "$code" = 1 ] && [[ "$out" == *"$text"* ]]; }; then
    echo "PASS  $name"; passed=$((passed + 1))
  else
    echo "FAIL  $name (want $want${text:+: $text}; exit $code)"; echo "      $out"; failed=$((failed + 1))
  fi
}
make_link() { ln -s "$1" "$2" 2>/dev/null && [ -L "$2" ]; }
skip() { echo "SKIP  $1 (this OS won't create symlinks)"; skipped=$((skipped + 1)); }

fresh
expect "identical Dockerfile passes" ok

fresh; printf 'FROM node:24-alpine\r\nCMD ["node", "server.js"]\r\n' | tee "$approved" > "$tmp/project/mailer/Dockerfile"
expect "identical CRLF Dockerfile passes (bytes, not lines, are compared)" ok

fresh; printf 'FROM node:24-alpinf\nCMD ["node", "server.js"]\n' > "$tmp/project/mailer/Dockerfile"
expect "one byte different is refused" refused "differs from the approved copy"

fresh; printf '\n' >> "$tmp/project/mailer/Dockerfile"
expect "an extra trailing newline is refused" refused "differs from the approved copy"

fresh; printf 'FROM node:24-alpine\r\nCMD ["node", "server.js"]\r\n' > "$tmp/project/mailer/Dockerfile"
expect "same lines with CRLF instead of LF is refused" refused "differs from the approved copy"

fresh; rm "$approved"
expect "approved copy missing is refused" refused "no approved Dockerfile"

fresh; rm "$approved"; mkdir "$approved"
expect "approved path is a folder is refused" refused "no approved Dockerfile"

fresh; rm "$tmp/project/mailer/Dockerfile"
expect "mailer/Dockerfile missing is refused" refused "mailer/Dockerfile is missing"

fresh; rm -r "$tmp/project/mailer"
expect "mailer folder missing is refused" refused "is missing or not a plain folder"

# Only on a case-sensitive filesystem can `dockerfile` sit next to `Dockerfile`.
fresh; printf 'FROM localimg\n' > "$tmp/project/mailer/dockerfile"
if [ "$(find "$tmp/project/mailer" -iname dockerfile | wc -l)" -ge 2 ]; then
  expect "a second 'dockerfile' spelling is refused" refused "other Dockerfile spellings"
else
  echo "SKIP  a second 'dockerfile' spelling (case-insensitive filesystem)"; skipped=$((skipped + 1))
fi

fresh; cp "$tmp/project/mailer/Dockerfile" "$tmp/real"; rm "$tmp/project/mailer/Dockerfile"
if make_link "$tmp/real" "$tmp/project/mailer/Dockerfile"; then
  expect "mailer/Dockerfile as a symlink (even to identical bytes) is refused" refused "not a plain file"
else skip "mailer/Dockerfile as a symlink"; fi

fresh; cp "$approved" "$tmp/real-approved"; rm "$approved"
if make_link "$tmp/real-approved" "$approved"; then
  expect "approved copy as a symlink is refused" refused "no approved Dockerfile"
else skip "approved copy as a symlink"; fi

out=$(bash "$check" "$tmp/project" 2>&1); code=$?
if [ "$code" = 2 ]; then echo "PASS  wrong argument count is a usage error"; passed=$((passed + 1))
else echo "FAIL  wrong argument count (exit $code)"; failed=$((failed + 1)); fi

echo
echo "$passed/$((passed + failed)) approved-Dockerfile cases behaved as expected, $skipped skipped"
if [ "$skipped" != 0 ] && [ "${REQUIRE_SYMLINKS:-0}" = 1 ]; then
  echo "REQUIRE_SYMLINKS=1 but $skipped case(s) were skipped"; exit 1
fi
[ "$failed" = 0 ]
