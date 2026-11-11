# Deploying darkmatterits.com

## How it runs

```
browser ──HTTPS──▶ VPS nginx (TLS, security headers, CSP)
                     │  /etc/nginx/sites-enabled/darkmatterit.conf
                     ▼  WireGuard
                   Pi 10.50.0.3:8085 ── darkmatter-site (nginx-unprivileged, serves public/)
                                          └── /api/support only ──▶ darkmatter-mailer (Node, port 3000, internal only)
```

On the Pi the project lives in `/data/sites/newsite` (compose project name `newsite`).
The mailer's settings are in `/data/sites/newsite/mailer/.env` on the Pi only; it is never committed
and the deploy never overwrites it. Variables are listed in `mailer/.env.example`: `SUPPORT_TO`, `FROM_EMAIL`, `SMTP_USER`, `SMTP_PASS`,
optional `PORT`, `SMTP_HOST`, `SMTP_PORT`, `SUPPORT_DAILY_CAP` (100), `CONFIRM_DAILY_CAP` (50).

## How a deploy happens

Push (or merge) to `main` → `.github/workflows/deploy.yml`:

1. **check** (GitHub-hosted, every branch): mailer tests (`npm test`), JS syntax, no scripts/dotfiles in `public/`, `docker compose config`, `nginx -t`.
2. **deploy** (self-hosted runner on the Pi, labels `self-hosted, pi, darkmatterits`): runs
   `sudo -n /usr/local/sbin/deploy-darkmatterits "$GITHUB_WORKSPACE"`.

The runner user (`ghrunner`) has no Docker access and no general sudo. The one root-owned helper it may run:
- refuses checkouts outside `/opt/actions-runner-darkmatterit/_work` and checkouts containing symlinks;
- stages a root-only copy, then runs the resolved compose config through `/usr/local/sbin/compose-guard`
  (no privileged containers, host namespaces, docker socket, host paths, or ports on all interfaces —
  published ports must be on `10.50.0.3` or loopback);
- rsyncs the code into `/data/sites/newsite` (keeps `.git` and `mailer/.env`), runs `docker compose up -d --build`,
  waits for the mailer's Docker healthcheck, checks nothing exited or restarted and the site answers, and prunes old images.

Server pieces (installed on the Pi by `deploy/pi/install.sh`; the helper's source is `deploy/pi/deploy-darkmatterits`):
- `/usr/local/sbin/deploy-darkmatterits` — the helper
- `/etc/sudoers.d/ghrunner-deploy-darkmatterits` — lets `ghrunner` run only that helper
- `/opt/actions-runner-darkmatterit` + `actions.runner.*.DarkMatterIT-site.service` — the runner for this repo
  (the existing `/opt/actions-runner` belongs to ghostlightsocial; GitHub runners are per repo)

## One-time Pi setup

From this repo on your computer (needs `gh` logged in and the `pi` SSH host):

```bash
scp deploy/pi/install.sh deploy/pi/deploy-darkmatterits pi:/tmp/
gh api -X POST repos/KingZCoding/darkMatterIT/actions/runners/registration-token --jq .token | ssh pi 'sudo bash /tmp/install.sh /tmp/deploy-darkmatterits'
```

Also set **Settings → Actions → General → Fork pull request workflows** to
"Require approval for all external contributors", because this public repo now has a self-hosted runner.

## Manual deploy / rollback

On the Pi as `admin`:

```bash
cd /data/sites/newsite
git fetch origin && git checkout <commit>   # or main
sudo docker compose -p newsite up -d --build
```

## Old method (removed)

The old workflow SSHed GitHub → VPS → "gateway" → "worker" and ran `deploy.sh` from
`/data/sites/newsite/public`. That path never existed on the Pi and every run since March 2026 failed.
The repo secrets `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY` are no longer used and can be deleted.
