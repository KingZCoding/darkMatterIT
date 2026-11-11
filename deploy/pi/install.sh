#!/usr/bin/env bash
# One-time Pi setup for the darkmatterits deploy. Run as root on the Pi (see DEPLOY.md):
#
#   scp deploy/pi/install.sh deploy/pi/deploy-darkmatterits pi:/tmp/
#   gh api -X POST repos/KingZCoding/darkMatterIT/actions/runners/registration-token --jq .token \
#     | ssh pi 'sudo bash /tmp/install.sh /tmp/deploy-darkmatterits'
#
# The runner registration token is read from stdin (never put on a command line).
# Idempotent: re-running reinstalls the helper and sudoers rule and skips runner
# registration if the runner is already configured.
set -euo pipefail

HELPER_SRC=${1:?usage: install.sh <path to deploy-darkmatterits>}
REPO_URL=https://github.com/KingZCoding/darkMatterIT
RUNNER_SRC=/opt/actions-runner                 # ghostlightsocial's runner, used only as a binary source
RUNNER_DIR=/opt/actions-runner-darkmatterit
RUNNER_USER=ghrunner
SUDOERS=/etc/sudoers.d/ghrunner-deploy-darkmatterits

[ "$(id -u)" = 0 ] || { echo "run as root" >&2; exit 1; }
for b in rsync flock curl docker; do command -v "$b" >/dev/null || { echo "missing $b" >&2; exit 1; }; done
[ -x /usr/local/sbin/compose-guard ] || { echo "missing /usr/local/sbin/compose-guard" >&2; exit 1; }
[ -f /data/sites/newsite/mailer/.env ] || { echo "missing /data/sites/newsite/mailer/.env" >&2; exit 1; }

echo "== Install deploy helper"
bash -n "$HELPER_SRC"
install -m 750 -o root -g root "$HELPER_SRC" /usr/local/sbin/deploy-darkmatterits

echo "== Install sudoers rule (ghrunner may run only the helper)"
tmp=$(mktemp)
echo "$RUNNER_USER ALL=(root) NOPASSWD: /usr/local/sbin/deploy-darkmatterits $RUNNER_DIR/_work/*" > "$tmp"
visudo -cf "$tmp"
install -m 440 -o root -g root "$tmp" "$SUDOERS"
rm -f "$tmp"
visudo -c >/dev/null

echo "== Runner for $REPO_URL in $RUNNER_DIR"
if [ -f "$RUNNER_DIR/.runner" ]; then
  echo "already configured, skipping registration"
else
  read -r TOKEN
  [ -n "${TOKEN:-}" ] || { echo "no registration token on stdin" >&2; exit 1; }
  install -d -m 755 -o "$RUNNER_USER" -g "$RUNNER_USER" "$RUNNER_DIR"
  rsync -a --exclude _work --exclude _diag --exclude .runner --exclude '.credentials*' \
    --exclude .service --chown="$RUNNER_USER:$RUNNER_USER" "$RUNNER_SRC/" "$RUNNER_DIR/"
  cd "$RUNNER_DIR"
  sudo -u "$RUNNER_USER" ./config.sh --unattended --url "$REPO_URL" --token "$TOKEN" \
    --name DarkMatterIT-site --labels pi,darkmatterits --work _work --replace
  ./svc.sh install "$RUNNER_USER"
fi
cd "$RUNNER_DIR"
./svc.sh start || true
./svc.sh status | head -5

rm -f "$HELPER_SRC" "$0"
echo "== Done. Push to main (or run the workflow) to deploy."
