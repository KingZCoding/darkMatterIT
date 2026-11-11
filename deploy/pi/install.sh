#!/usr/bin/env bash
# One-time Pi setup for the darkmatterits pull deploy. Run from this repo on your PC (see DEPLOY.md):
#
#   d=$(ssh pi 'mktemp -d') && scp deploy/pi/install.sh deploy/pi/deploy-darkmatterits* "pi:$d/" && ssh pi "sudo bash $d/install.sh"
#
# Installs, all root-owned:
#   /usr/local/sbin/deploy-darkmatterits                    the deploy script
#   /etc/systemd/system/deploy-darkmatterits.{service,timer} runs it every 5 minutes
# Nothing else: no GitHub runner, no sudo rule, no tokens. Safe to re-run to update the script.
set -euo pipefail

[ "$(id -u)" = 0 ] || { echo "run with sudo" >&2; exit 1; }
SRC=$(cd "$(dirname "$0")" && pwd)
for f in deploy-darkmatterits deploy-darkmatterits.service deploy-darkmatterits.timer; do
  [ -f "$SRC/$f" ] || { echo "missing $SRC/$f" >&2; exit 1; }
done
for b in docker git rsync curl python3 flock; do command -v "$b" >/dev/null || { echo "missing $b" >&2; exit 1; }; done
[ -x /usr/local/sbin/compose-guard ] || { echo "missing /usr/local/sbin/compose-guard" >&2; exit 1; }
[ -f /data/sites/newsite/mailer/.env ] || { echo "missing /data/sites/newsite/mailer/.env" >&2; exit 1; }

# secwatch watches /usr/local/sbin and systemd units. Pause it so this install doesn't send a
# tamper alert. On exit the timer is ALWAYS started again; it is rebaselined only on success.
SECWATCH_PAUSED=0
resume_secwatch() {
  local status=$?
  set +e
  if [ "$SECWATCH_PAUSED" = 1 ]; then
    if [ "$status" = 0 ]; then
      echo "== Rebaseline secwatch"
      python3 -I /usr/local/sbin/secwatch.py --rebaseline || echo "!! secwatch rebaseline failed; expect one tamper alert for this install" >&2
    else
      echo "!! install failed (exit $status); secwatch not rebaselined, so it will report what changed" >&2
    fi
    systemctl start secwatch.timer || echo "!! could not start secwatch.timer - start it by hand" >&2
  fi
  # Remove the staged copy, but only if it is the mktemp folder from DEPLOY.md.
  case "$SRC" in /tmp/tmp.*) rm -rf -- "$SRC" ;; esac
  exit "$status"
}
trap resume_secwatch EXIT
if systemctl is-active --quiet secwatch.timer; then
  echo "== Pause secwatch"
  systemctl stop secwatch.timer
  SECWATCH_PAUSED=1
fi

echo "== Install deploy script and timer"
sed -i 's/\r$//' "$SRC/deploy-darkmatterits" "$SRC"/deploy-darkmatterits.service "$SRC"/deploy-darkmatterits.timer
bash -n "$SRC/deploy-darkmatterits"
install -m 750 -o root -g root "$SRC/deploy-darkmatterits" /usr/local/sbin/deploy-darkmatterits
install -m 644 -o root -g root "$SRC/deploy-darkmatterits.service" /etc/systemd/system/deploy-darkmatterits.service
install -m 644 -o root -g root "$SRC/deploy-darkmatterits.timer" /etc/systemd/system/deploy-darkmatterits.timer
systemctl daemon-reload
systemd-analyze verify /etc/systemd/system/deploy-darkmatterits.service /etc/systemd/system/deploy-darkmatterits.timer
systemctl enable --now deploy-darkmatterits.timer

echo "== First check (fetches main; deploys only if GitHub's check job passed on it)"
/usr/local/sbin/deploy-darkmatterits || echo "!! first run reported a problem; see: journalctl -t deploy-darkmatterits" >&2
systemctl list-timers deploy-darkmatterits.timer --no-pager
echo "== Done. Merging to main deploys within about 5 minutes of the check passing."
