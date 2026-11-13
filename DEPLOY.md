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
   mailer tests, JS syntax, no scripts/dotfiles/symlinks, the compose allowlist and its test cases
   (`deploy/pi/test/`), `docker compose config`, `nginx -t`.
2. On the Pi, `deploy-darkmatterits.timer` runs `/usr/local/sbin/deploy-darkmatterits` as root every 5 minutes. It:
   - fetches `main` from GitHub over HTTPS (public repo, no credentials) into a root-only repo;
   - does nothing if that commit is already live, or failed before;
   - asks GitHub's public API whether the **push-to-main run of `check.yml`** passed for that exact commit
     (other workflows, apps, forks and PR runs don't count), and waits if it hasn't finished;
   - extracts the commit into a root-only staging folder with the commit's `.gitattributes` neutralised,
     refuses symlinks/submodules, checks `docker-compose.yml` and the Dockerfiles it builds against a strict
     allowlist (`/usr/local/sbin/darkmatterits-compose-check`, under `timeout 60`, before compose reads it),
     then runs `compose-guard`;
   - copies it into `/data/sites/newsite` with fixed modes (dirs 755, files 644, owner admin), keeping `mailer/.env`;
   - right before compose runs, `/usr/local/sbin/deploy-darkmatterits-preup-check` refuses any symlink in
     `/data/sites/newsite` (outside its `.git`), a `.env` at its root (compose would read `COMPOSE_*` settings
     from it; `mailer/.env` is the only `.env`), or a `docker-compose.yml` that differs from the checked copy;
   - rebuilds with `docker compose up -d --build --force-recreate`, waits for the mailer's healthcheck,
     checks nothing exited or restarted and the site answers on 10.50.0.3:8085;
   - records the commit and prunes only this project's old images.

So a merge to `main` goes live within about 5 minutes of its check passing. Branches, forks and PRs can't deploy.
Output goes to the journal only: `journalctl -t deploy-darkmatterits` (and `journalctl -u deploy-darkmatterits`).

State: `/var/lib/deploy-darkmatterits/`: `deployed` (live commit), `failed` (commit that failed to deploy; not retried),
`ci_failed` (commit whose CI failed; a passing re-run is picked up), `pinned` (set only by a rollback that
deployed successfully; a failed `--now` clears it), `repo.git`, `stage/`.

The compose allowlist only permits the shapes this project uses, and requires the hardening:
- every service has `read_only: true`, `cap_drop: [ALL]` and `security_opt: [no-new-privileges:true]`;
- volumes are read-only `./src:/dst:ro` only, never `./.`, `.git` or anything named `.env*`;
- `env_file` is exactly `./mailer/.env`; `container_name` starts with `darkmatter-`;
- `image:` is on a pinned list (`nginxinc/nginx-unprivileged:1.27-alpine@sha256:...`, by digest), and only `darkmatter-site`
  publishes a port, exactly `10.50.0.3:8085:8080`;
- no `$` anywhere, no top-level volumes/networks/include, no duplicate keys, at most 64 KB and 20 YAML aliases;
- a built Dockerfile has one `FROM` on a pinned list (`node:24-alpine@sha256:...`, by digest) and no `--from`, `--mount`,
  `ONBUILD` or `# syntax=`-style directives, so a build can't read other projects' images on the Pi.

To use something new in `docker-compose.yml` or `mailer/Dockerfile`, extend
`deploy/pi/darkmatterits-compose-check` on purpose, add a good and a bad case under `deploy/pi/test/`,
and re-run the install.

Builds still use the Pi's default builder, which can see every local image on the Pi; the Dockerfile rules
above are what stop a build reading another project's image. A dedicated BuildKit builder for this project
(Cody's 2026-11-13 decision) is **not set up yet**: every way to run one on the Pi needs a privileged or
seccomp/AppArmor-unconfined container, which secwatch and the Pi's no-privileged-containers rule refuse. The
options are in `.claude/handoffs/builder-D3.md` (task D3) for Cody to choose.

## Updating base images
Both base images are pinned by digest (`name:tag@sha256:...`) because a tag can move, and a local image
on the Pi tagged the same would win over the registry. The bare tag is refused by the allowlist.
1. Look up the new multi-arch index digest (must include linux/arm64 for the Pi and linux/amd64 for CI):
   get an anonymous token from `https://auth.docker.io/token?service=registry.docker.io&scope=repository:<repo>:pull`
   (`<repo>` is `library/node` or `nginxinc/nginx-unprivileged`), then `HEAD`
   `https://registry-1.docker.io/v2/<repo>/manifests/<tag>` with
   `Accept: application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json`
   and read `Docker-Content-Digest`.
2. Change it in every place: `mailer/Dockerfile` (`FROM`), `docker-compose.yml` (`image:`),
   `.github/workflows/check.yml` (nginx -t step), `PINNED_BASE_IMAGES` / `PINNED_IMAGES` in
   `deploy/pi/darkmatterits-compose-check`, and the good test cases under `deploy/pi/test/`.
3. Run `python deploy/pi/test/run-compose-cases.py`, then push as usual.
4. Re-run the Pi install (see "One-time Pi setup") BEFORE the deploy that carries the new digest: the
   allowlist on the Pi is a root-owned copy, so until it is re-installed it refuses the new digest.

## One-time Pi setup

From this repo on your computer (needs the `pi` SSH host). Git Bash:

```bash
d=$(ssh pi 'mktemp -d') && scp deploy/pi/install.sh deploy/pi/deploy-darkmatterits* deploy/pi/darkmatterits-compose-check "pi:$d/" && ssh pi "sudo bash $d/install.sh"
```

PowerShell:

```powershell
$d = ssh pi 'mktemp -d'; scp deploy/pi/install.sh deploy/pi/deploy-darkmatterits deploy/pi/deploy-darkmatterits-preup-check deploy/pi/deploy-darkmatterits.service deploy/pi/deploy-darkmatterits.timer deploy/pi/darkmatterits-compose-check "pi:$d/"; ssh pi "sudo bash $d/install.sh"
```

It installs `/usr/local/sbin/deploy-darkmatterits`, `/usr/local/sbin/darkmatterits-compose-check`,
`/usr/local/sbin/deploy-darkmatterits-preup-check` and
`/etc/systemd/system/deploy-darkmatterits.{service,timer}`
(root-owned), pauses and rebaselines `secwatch` around the change, enables the timer and does a first check.
Re-run it the same way to update the deploy script. There is no GitHub runner, sudo rule or token for this repo.

## Manual deploy, retry, rollback

On the Pi:

```bash
sudo deploy-darkmatterits --now            # deploy the newest main now, without waiting for CI
sudo deploy-darkmatterits --now <commit>   # roll back to an earlier commit on main; held until main moves
journalctl -t deploy-darkmatterits -n 50   # what happened
```

A commit that failed to deploy is not retried automatically; push a fix, or use `--now`.
A rollback stays in place until a new commit lands on main (or you run `--now` without a commit).
If the rollback deploy fails, it is not held: the timer goes back to deploying main.

**You can only roll back to a commit whose `docker-compose.yml` and `mailer/Dockerfile` pass today's allowlist.**
The Pi checks the old commit with the allowlist it has installed now, not the one from back then. Since the
base images were pinned by digest (cf23583), that means cf23583 and later. Commits from 6c32cad up to
cf23583's parent (a4d2157) are refused too: they use bare image tags (`nginxinc/nginx-unprivileged:1.27-alpine`,
`FROM node:24-alpine`), which are not on the pinned list. fe07fe1, 770582e and everything older are refused
(`nginx:alpine`, port `8085:80`, no read-only hardening). In every refused case `--now` fails without touching
the running site.

## Old method (removed)

The old workflow SSHed GitHub → VPS → "gateway" → "worker" and ran `deploy.sh` from
`/data/sites/newsite/public`. That path never existed on the Pi and every run since March 2026 failed.
The repo secrets `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY` are no longer used and can be deleted.
