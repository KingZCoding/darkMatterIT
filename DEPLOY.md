# Deploying darkmatterits.com

## How it runs

```
browser ──HTTPS──▶ VPS nginx (TLS, security headers, CSP)
                     ▼  WireGuard
                   Pi 10.50.0.3:8085 ── darkmatter-site (nginx-unprivileged, serves public/)
                                          └── /api/support only ──▶ darkmatter-mailer (Node, port 3000, internal only)
```

On the Pi the project lives in `/data/sites/newsite` (compose project name `newsite`).
The mailer's settings are in `/data/sites/newsite/mailer/.env` on the Pi only; it is never committed
and a deploy never overwrites it. Variables are listed in `mailer/.env.example`: `SUPPORT_TO`, `FROM_EMAIL`,
`SMTP_USER`, `SMTP_PASS`, optional `PORT`, `SMTP_HOST`, `SMTP_PORT`, `SUPPORT_DAILY_CAP` (100), `CONFIRM_DAILY_CAP` (50).

## How a deploy happens

The Pi **pulls**; GitHub never reaches the Pi.

1. Every push and pull request runs `.github/workflows/check.yml` on GitHub-hosted runners. It only checks:
   mailer tests, JS syntax, no scripts/dotfiles/symlinks, the compose allowlist, `docker compose config`, `nginx -t`.
2. On the Pi, `deploy-darkmatterits.timer` runs `/usr/local/sbin/deploy-darkmatterits` as root every 5 minutes. It:
   - fetches `main` from GitHub over HTTPS (public repo, no credentials) into a root-only repo;
   - does nothing if that commit is already live, or failed before;
   - asks GitHub's public API whether the **push-to-main run of `check.yml`** passed for that exact commit
     (other workflows, apps, forks and PR runs don't count), and waits if it hasn't finished;
   - extracts the commit into a root-only staging folder with the commit's `.gitattributes` neutralised,
     refuses symlinks/submodules, checks `docker-compose.yml` against a strict allowlist
     (`/usr/local/sbin/darkmatterits-compose-check`, before compose reads it), then runs `compose-guard`;
   - copies it into `/data/sites/newsite` with fixed modes (dirs 755, files 644, owner admin), keeping `mailer/.env`;
   - rebuilds with `docker compose up -d --build --force-recreate`, waits for the mailer's healthcheck,
     checks nothing exited or restarted and the site answers on 10.50.0.3:8085;
   - records the commit and prunes only this project's old images.

So a merge to `main` goes live within about 5 minutes of its check passing. Branches, forks and PRs can't deploy.
Output goes to the journal only: `journalctl -t deploy-darkmatterits` (and `journalctl -u deploy-darkmatterits`).

State: `/var/lib/deploy-darkmatterits/`: `deployed` (live commit), `failed` (commit that failed to deploy; not retried),
`ci_failed` (commit whose CI failed; a passing re-run is picked up), `pinned` (set by a rollback), `repo.git`, `stage/`.

The compose allowlist only permits the shapes this project uses (services with image/build, ./relative volumes and
env_file, ports on 10.50.0.3 or loopback, no `$` anywhere, no top-level volumes/networks/include). To use something
new in `docker-compose.yml`, extend `deploy/pi/darkmatterits-compose-check` on purpose and re-run the install.

## One-time Pi setup

From this repo on your computer (needs the `pi` SSH host). Git Bash:

```bash
d=$(ssh pi 'mktemp -d') && scp deploy/pi/install.sh deploy/pi/deploy-darkmatterits* deploy/pi/darkmatterits-compose-check "pi:$d/" && ssh pi "sudo bash $d/install.sh"
```

PowerShell:

```powershell
$d = ssh pi 'mktemp -d'; scp deploy/pi/install.sh deploy/pi/deploy-darkmatterits deploy/pi/deploy-darkmatterits.service deploy/pi/deploy-darkmatterits.timer deploy/pi/darkmatterits-compose-check "pi:$d/"; ssh pi "sudo bash $d/install.sh"
```

It installs `/usr/local/sbin/deploy-darkmatterits`, `/usr/local/sbin/darkmatterits-compose-check` and
`/etc/systemd/system/deploy-darkmatterits.{service,timer}`
(root-owned), pauses and rebaselines `secwatch` around the change, enables the timer and does a first check.
Re-run it the same way to update the deploy script. There is no GitHub runner, sudo rule or token for this repo.

## Manual deploy, retry, rollback

On the Pi:

```bash
sudo deploy-darkmatterits --now            # deploy the newest main now, without waiting for CI
sudo deploy-darkmatterits --now <commit>   # roll back to any commit on main; held until main moves
journalctl -t deploy-darkmatterits -n 50   # what happened
```

A commit that failed to deploy is not retried automatically; push a fix, or use `--now`.
A rollback stays in place until a new commit lands on main (or you run `--now` without a commit).

## Old method (removed)

The old workflow SSHed GitHub → VPS → "gateway" → "worker" and ran `deploy.sh` from
`/data/sites/newsite/public`. That path never existed on the Pi and every run since March 2026 failed.
The repo secrets `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY` are no longer used and can be deleted.
