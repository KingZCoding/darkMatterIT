#!/usr/bin/env bash
# Pi setup for the darkmatterits pull deploy. Run from this repo on your PC, from a clean checkout
# of the commit whose mailer/Dockerfile you want to approve (see DEPLOY.md):
#
#   d=$(ssh pi 'mktemp -d') && scp deploy/pi/install.sh deploy/pi/deploy-darkmatterits* deploy/pi/darkmatterits-compose-check mailer/Dockerfile "pi:$d/" && ssh pi "sudo bash $d/install.sh"
#
# Installs, all root-owned:
#   /usr/local/sbin/deploy-darkmatterits                     the deploy script
#   /usr/local/sbin/darkmatterits-compose-check              the compose allowlist it runs
#   /usr/local/sbin/deploy-darkmatterits-preup-check         its last check before `compose up`
#   /usr/local/sbin/deploy-darkmatterits-dockerfile-check    the approved-Dockerfile gate (D3-fix2)
#   /usr/local/sbin/darkmatterits-mailer.Dockerfile          THE approved mailer Dockerfile (644, not
#                                                            executable): a deploy builds only if the
#                                                            commit's mailer/Dockerfile is byte-identical
#   /etc/systemd/system/deploy-darkmatterits.{service,timer} runs it every 5 minutes
# Nothing else: no GitHub runner, no sudo rule, no tokens. Safe to re-run to update the scripts,
# and re-running it is HOW a changed mailer/Dockerfile is approved (Cody 2026-11-13,
# "Exact-match approved copy"). The approved copy sits in /usr/local/sbin because secwatch
# already watches /usr/local/sbin/*, so a change made outside this script raises a tamper alert.
set -euo pipefail

FILES=(deploy-darkmatterits darkmatterits-compose-check deploy-darkmatterits-preup-check
       deploy-darkmatterits-dockerfile-check deploy-darkmatterits.service deploy-darkmatterits.timer
       Dockerfile)
APPROVED_DOCKERFILE=/usr/local/sbin/darkmatterits-mailer.Dockerfile   # must match deploy-darkmatterits
STATE=/var/lib/deploy-darkmatterits                                  # the deploy's state folder

[ "$(id -u)" = 0 ] || { echo "run with sudo" >&2; exit 1; }
SRC=$(cd "$(dirname "$0")" && pwd)
for f in "${FILES[@]}"; do
  [ -f "$SRC/$f" ] || { echo "missing $SRC/$f" >&2; exit 1; }
done
for b in docker git rsync curl python3 flock timeout cmp find sha256sum; do command -v "$b" >/dev/null || { echo "missing $b" >&2; exit 1; }; done
python3 -I -c 'import yaml' || { echo "missing python3-yaml" >&2; exit 1; }
[ -x /usr/local/sbin/compose-guard ] || { echo "missing /usr/local/sbin/compose-guard" >&2; exit 1; }
[ -f /data/sites/newsite/mailer/.env ] || { echo "missing /data/sites/newsite/mailer/.env" >&2; exit 1; }

# Check everything before touching the system, so a bad file can't leave a half-install.
# CRLF -> LF for the scripts only. The Dockerfile is approved byte-for-byte as copied, never
# rewritten: the deploy compares it to the commit's bytes, so a rewrite would only make every
# deploy refuse (the repo's .gitattributes keeps it LF on checkout).
for f in "${FILES[@]}"; do [ "$f" = Dockerfile ] || sed -i 's/\r$//' "$SRC/$f"; done
bash -n "$SRC/deploy-darkmatterits"
bash -n "$SRC/deploy-darkmatterits-preup-check"
bash -n "$SRC/deploy-darkmatterits-dockerfile-check"
python3 -I -c 'import ast, sys; ast.parse(open(sys.argv[1]).read())' "$SRC/darkmatterits-compose-check"
# Never approve a Dockerfile the denylist rejects (one FROM, node:24-alpine pinned by digest, no --from/--mount,
# heredocs, directives...): the approved copy is what the deploy trusts on the Pi.
python3 -I "$SRC/darkmatterits-compose-check" --dockerfile "$SRC/Dockerfile" \
  || { echo "refusing to approve this mailer/Dockerfile (see above)" >&2; exit 1; }

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

# Order matters: the approved Dockerfile copy goes in BEFORE the new deploy script. The deploy timer is
# not stopped during an install, so if it fires mid-install the new script must already find an approved
# copy; otherwise it would refuse ("no approved Dockerfile") and mark main failed, and that mark could land
# after the `rm -f failed` below and stick. (test-dockerfile-approved.sh asserts this order.)
echo "== Approve mailer/Dockerfile ($APPROVED_DOCKERFILE)"
if ! cmp -s -- "$SRC/Dockerfile" "$APPROVED_DOCKERFILE"; then
  # A newly approved Dockerfile is exactly what can make the commit that last failed deployable
  # (its failure is sticky and would otherwise wait for a new commit), so give it one more try.
  rm -f -- "$STATE/failed"
fi
install -m 644 -o root -g root "$SRC/Dockerfile" "$APPROVED_DOCKERFILE"
sha256sum "$APPROVED_DOCKERFILE"
echo "== Install deploy script, compose allowlist, pre-up check, Dockerfile gate and timer"
install -m 750 -o root -g root "$SRC/deploy-darkmatterits" /usr/local/sbin/deploy-darkmatterits
install -m 755 -o root -g root "$SRC/darkmatterits-compose-check" /usr/local/sbin/darkmatterits-compose-check
install -m 750 -o root -g root "$SRC/deploy-darkmatterits-preup-check" /usr/local/sbin/deploy-darkmatterits-preup-check
install -m 750 -o root -g root "$SRC/deploy-darkmatterits-dockerfile-check" /usr/local/sbin/deploy-darkmatterits-dockerfile-check
install -m 644 -o root -g root "$SRC/deploy-darkmatterits.service" /etc/systemd/system/deploy-darkmatterits.service
install -m 644 -o root -g root "$SRC/deploy-darkmatterits.timer" /etc/systemd/system/deploy-darkmatterits.timer
systemctl daemon-reload
systemd-analyze verify /etc/systemd/system/deploy-darkmatterits.service /etc/systemd/system/deploy-darkmatterits.timer \
  || echo "!! systemd-analyze reported warnings (above); continuing" >&2
systemctl enable deploy-darkmatterits.timer

# The first check runs here, before the timer starts, so the two can't race for the lock.
echo "== First check (fetches main; deploys only once main's CI run has passed)"
/usr/local/sbin/deploy-darkmatterits || echo "!! first run reported a problem; see: journalctl -t deploy-darkmatterits" >&2
systemctl start deploy-darkmatterits.timer
systemctl list-timers deploy-darkmatterits.timer --no-pager
echo "== Done. A merge to main deploys within about 5 minutes of its CI run passing."
