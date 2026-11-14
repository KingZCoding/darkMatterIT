#!/usr/bin/env bash
# Tests for the site's name on the Pi (task R1, Cody 2026-11-13: "Full rename").
#
# What it proves: the Pi deploy uses the folder /data/sites/darkmatterits and the compose project
# darkmatterits (the old name "newsite" was retired on 2026-11-13), in every place that decides it:
#   1. deploy/pi/deploy-darkmatterits sets exactly DEST=/data/sites/darkmatterits and PROJECT=darkmatterits,
#      and COMPOSE still uses both (so a deploy can't drift back to the old folder or project);
#   2. deploy/pi/install.sh checks /data/sites/darkmatterits/mailer/.env (the same folder as DEST);
#   3. docker-compose.yml's header names the new folder and project;
#   4. no tracked file mentions "newsite" except as dated history: every line that contains it must also
#      say "until 2026-11-13" (e.g. "was called newsite until 2026-11-13"). A new line that calls newsite
#      the current name fails here.
# Needs only bash, git, grep and sed (no Docker, no root), so it runs in CI (.github/workflows/check.yml)
# and on Git Bash:
#
#   bash deploy/pi/test/test-site-name.sh            # check this repo
#   bash deploy/pi/test/test-site-name.sh /other/repo  # check another checkout (used by revert-checks)
#
# Exit 0 = every check passed, 1 = otherwise (each failure is printed as FAIL: ...).
set -uo pipefail

here=$(cd "$(dirname "$0")" && pwd)
repo=${1:-$here/../../..}
repo=$(cd "$repo" && pwd)
deploy=$repo/deploy/pi/deploy-darkmatterits
install=$repo/deploy/pi/install.sh
compose=$repo/docker-compose.yml

passed=0; failed=0
ok()   { echo "ok   $*"; passed=$((passed + 1)); }
bad()  { echo "FAIL: $*"; failed=$((failed + 1)); }

# assignment FILE NAME: prints the value of the first top-level `NAME=value` line in FILE (no quotes expected).
assignment() { sed -n "s/^$2=\\(.*\\)\$/\\1/p" "$1" | head -n 1; }

# 1. The deploy script's destination and project.
dest=$(assignment "$deploy" DEST)
project=$(assignment "$deploy" PROJECT)
[ "$dest" = /data/sites/darkmatterits ] && ok "deploy-darkmatterits DEST=$dest" \
  || bad "deploy-darkmatterits DEST is '$dest', expected /data/sites/darkmatterits"
[ "$project" = darkmatterits ] && ok "deploy-darkmatterits PROJECT=$project" \
  || bad "deploy-darkmatterits PROJECT is '$project', expected darkmatterits"
# Exactly one DEST= and one PROJECT= line: a second assignment further down would silently win.
[ "$(grep -c '^DEST=' "$deploy")" = 1 ] && ok "one DEST= line" || bad "deploy-darkmatterits has more or less than one DEST= line"
[ "$(grep -c '^PROJECT=' "$deploy")" = 1 ] && ok "one PROJECT= line" || bad "deploy-darkmatterits has more or less than one PROJECT= line"
# The compose command is built from those two variables (not a literal folder or project).
if grep -q '^COMPOSE=(docker compose --project-directory "\$DEST" --project-name "\$PROJECT" -f "\$DEST/docker-compose.yml")$' "$deploy"; then
  ok "COMPOSE uses \$DEST and \$PROJECT"
else
  bad "deploy-darkmatterits COMPOSE= line no longer uses \$DEST and \$PROJECT"
fi

# 2. The installer checks the same folder's mailer/.env.
if grep -q '^\[ -f /data/sites/darkmatterits/mailer/\.env \]' "$install"; then
  ok "install.sh checks /data/sites/darkmatterits/mailer/.env"
else
  bad "install.sh does not check /data/sites/darkmatterits/mailer/.env"
fi

# 3. The compose file's header (first line) names the new folder and project.
if head -n 1 "$compose" | grep -q '/data/sites/darkmatterits, compose project "darkmatterits"'; then
  ok "docker-compose.yml header names /data/sites/darkmatterits and project darkmatterits"
else
  bad "docker-compose.yml first line does not name /data/sites/darkmatterits and project darkmatterits"
fi

# 4. "newsite" only as dated history. git grep reads tracked files only (no .git, no node_modules).
# -I skips binary files. This script itself is excluded: it has to spell the old name to look for it.
hits=$(git -C "$repo" grep -n -I -i 'newsite' -- . ':(exclude)deploy/pi/test/test-site-name.sh' || true)
current=$(printf '%s\n' "$hits" | grep -v 'until 2026-11-13' | grep -v '^$' || true)
if [ -z "$current" ]; then
  ok "every mention of newsite is dated history ($(printf '%s\n' "$hits" | grep -c . ) line(s))"
else
  bad "these lines mention newsite without 'until 2026-11-13' (is it still called that somewhere?):"
  printf '      %s\n' "$current"
fi

echo "site-name tests: $passed passed, $failed failed"
[ "$failed" = 0 ]
