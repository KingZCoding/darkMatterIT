#!/usr/bin/env bash
# Tests for deploy/pi/deploy-darkmatterits-preup-check (task D3, audit 2026-11-13).
#
# What it proves: the check the Pi runs right before `docker compose up` refuses a project folder
# with a symlink outside .git, a root .env (file, folder or dangling link), or a
# docker-compose.yml that differs from the checked stage copy - and passes a clean folder, a
# symlink inside .git, and mailer/.env. Needs only bash, find, cmp and ln (no Docker, no root),
# so it runs in CI (.github/workflows/check.yml) and on Git Bash:
#
#   bash deploy/pi/test/test-preup-check.sh                # test the repo's copy
#   bash deploy/pi/test/test-preup-check.sh /path/to/copy  # test another copy
#
# Symlink cases need an OS that lets this user create symlinks. Windows without Developer Mode
# can't, so there they are reported as SKIP; CI sets REQUIRE_SYMLINKS=1 so a skip fails there.
#
# Exit 0 = every case behaved (skips allowed unless REQUIRE_SYMLINKS=1), 1 = otherwise.
set -uo pipefail

here=$(cd "$(dirname "$0")" && pwd)
check=${1:-$here/../deploy-darkmatterits-preup-check}
tmp=$(mktemp -d "${TMPDIR:-/tmp}/D3-preup-test.XXXXXX")
trap 'rm -rf -- "$tmp"' EXIT
# Git Bash makes copies instead of symlinks unless told otherwise; real links are the point here.
export MSYS=winsymlinks:nativestrict

passed=0; failed=0; skipped=0

# fresh_project: a clean STAGE and DEST pair like the deploy leaves them after rsync.
fresh_project() {
  rm -rf -- "$tmp/stage" "$tmp/dest"
  mkdir -p "$tmp/stage" "$tmp/dest/mailer" "$tmp/dest/public" "$tmp/dest/.git"
  printf 'services: {}\n' > "$tmp/stage/docker-compose.yml"
  cp "$tmp/stage/docker-compose.yml" "$tmp/dest/docker-compose.yml"
  printf 'X=1\n' > "$tmp/dest/mailer/.env"
}

# expect NAME WANT [TEXT]: run the check; WANT is ok or refused; TEXT must appear in a refusal.
expect() {
  local name=$1 want=$2 text=${3:-} out code
  out=$(bash "$check" "$tmp/stage" "$tmp/dest" 2>&1); code=$?
  if { [ "$want" = ok ] && [ "$code" = 0 ]; } ||
     { [ "$want" = refused ] && [ "$code" = 1 ] && [[ "$out" == *"$text"* ]]; }; then
    echo "PASS  $name"; passed=$((passed + 1))
  else
    echo "FAIL  $name (want $want${text:+: $text}; exit $code)"; echo "      $out"; failed=$((failed + 1))
  fi
}

# make_link TARGET LINK: create a real symlink. Returns 1 (and the caller skips the case) when
# the OS won't - a copy instead of a link would make the case meaningless.
make_link() {
  ln -s "$1" "$2" 2>/dev/null && [ -L "$2" ]
}

# skip NAME: record a symlink case that could not be set up on this machine.
skip() { echo "SKIP  $1 (this OS won't create symlinks)"; skipped=$((skipped + 1)); }

fresh_project
expect "clean folder passes" ok

fresh_project
if make_link / "$tmp/dest/.git/escape"; then expect "a symlink inside .git is ignored" ok
else skip "a symlink inside .git is ignored"; fi

fresh_project; mkdir -p "$tmp/dest/foo"
if make_link / "$tmp/dest/foo/.env"; then expect "symlink swapped in for foo/.env (the audit's attack)" refused "symlinks in"
else skip "symlink swapped in for foo/.env (the audit's attack)"; fi

fresh_project
if make_link "$tmp/dest/public" "$tmp/dest/public2"; then expect "any symlink outside .git" refused "symlinks in"
else skip "any symlink outside .git"; fi

fresh_project; printf 'services: {evil: {}}\n' > "$tmp/dest/docker-compose.yml"
expect "compose file rewritten after the check" refused "differs from the checked copy"

fresh_project; rm "$tmp/dest/docker-compose.yml"
expect "compose file missing from the folder" refused "differs from the checked copy"

fresh_project; printf 'COMPOSE_PROJECT_NAME=x\n' > "$tmp/dest/.env"
expect "root .env file" refused ".env exists"

fresh_project; mkdir "$tmp/dest/.env"
expect "root .env folder" refused ".env exists"

fresh_project
if make_link "$tmp/nowhere" "$tmp/dest/.env"; then expect "root .env dangling symlink" refused ".env exists"
else skip "root .env dangling symlink"; fi

out=$(bash "$check" "$tmp/stage" 2>&1); code=$?
if [ "$code" = 2 ]; then echo "PASS  wrong argument count is a usage error"; passed=$((passed + 1));
else echo "FAIL  wrong argument count (exit $code)"; failed=$((failed + 1)); fi

echo
echo "$passed/$((passed + failed)) preup-check cases behaved as expected, $skipped skipped"
if [ "$skipped" != 0 ] && [ "${REQUIRE_SYMLINKS:-0}" = 1 ]; then
  echo "REQUIRE_SYMLINKS=1 but $skipped symlink case(s) were skipped"; exit 1
fi
[ "$failed" = 0 ]
