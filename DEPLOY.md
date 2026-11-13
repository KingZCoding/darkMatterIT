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
   - refuses the commit unless its `mailer/Dockerfile` is **byte-identical** to the approved copy on the Pi
     (`/usr/local/sbin/darkmatterits-mailer.Dockerfile`, see "Changing the mailer Dockerfile" below);
   - copies it into `/data/sites/newsite` with fixed modes (dirs 755, files 644, owner admin), keeping `mailer/.env`;
   - right before compose runs, `/usr/local/sbin/deploy-darkmatterits-preup-check` refuses any symlink in
     `/data/sites/newsite` (outside its `.git`), a `.env` at its root (compose would read `COMPOSE_*` settings
     from it; `mailer/.env` is the only `.env`), or a `docker-compose.yml` that differs from the checked copy,
     and `mailer/Dockerfile` is compared with the approved copy once more;
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
- exactly one service builds: `darkmatter-mailer`, with `build: ./mailer` (a plain folder, no `dockerfile:`
  or other options), so `mailer/Dockerfile` is the only Dockerfile compose reads;
- that Dockerfile has one `FROM` on a pinned list (`node:24-alpine@sha256:...`, by digest) and no `--from`, `--mount`,
  `ONBUILD` or `# syntax=`-style directives, so a build can't read other projects' images on the Pi.
  The Dockerfile must also be plain printable ASCII (tabs and LF or CRLF line ends allowed): no byte-order
  mark, no Unicode spaces or other non-ASCII characters, no control characters such as form feed, no lone
  carriage returns, and no line ending in two backslashes; heredocs (`<<`), `//` lines and quote or
  backslash characters inside `--` flags are refused.

Those Dockerfile rules are a denylist, run in CI and on the Pi. The Pi does not rely on them alone
(Cody, 2026-11-13: "Exact-match approved copy"): it keeps ONE approved mailer Dockerfile,
`/usr/local/sbin/darkmatterits-mailer.Dockerfile` (root, mode 644; in `/usr/local/sbin` because secwatch
already watches that folder, so a change made outside the install raises a tamper alert), and a deploy is
refused unless the commit's `mailer/Dockerfile` is byte-for-byte that file. The check is
`/usr/local/sbin/deploy-darkmatterits-dockerfile-check`; it also refuses a symlinked Dockerfile and any second
spelling such as `mailer/dockerfile`.

To use something new in `docker-compose.yml`, extend `deploy/pi/darkmatterits-compose-check` on purpose,
add a good and a bad case under `deploy/pi/test/`, and re-run the install.

### Changing the mailer Dockerfile

1. Edit `mailer/Dockerfile` on a branch. If it needs something the denylist refuses, extend
   `deploy/pi/darkmatterits-compose-check` on purpose, with a good and a bad case under `deploy/pi/test/`.
2. Merge to `main` as usual. The Pi will refuse that commit (journal: "mailer/Dockerfile differs from the
   approved copy on the Pi; re-run the Pi install from this commit to approve it"); the live site keeps running.
3. On your computer, check out that exact commit of `main` (clean, nothing edited), and re-run the one-time
   Pi setup below. It refuses a Dockerfile the denylist rejects, installs the new approved copy, prints its
   sha256, clears the commit's failed mark and runs a first check, which deploys it.

A rollback (`--now <commit>`) to a commit with a different `mailer/Dockerfile` is refused the same way. Approve
that commit's Dockerfile with today's scripts (never run an old commit's install: it would put back older deploy
scripts). Git Bash, from a clean checkout of the newest `main`:

```bash
git show <commit>:mailer/Dockerfile > mailer/Dockerfile
d=$(ssh pi 'mktemp -d') && scp deploy/pi/install.sh deploy/pi/deploy-darkmatterits* deploy/pi/darkmatterits-compose-check mailer/Dockerfile "pi:$d/" && ssh pi "sudo bash $d/install.sh"
git checkout -- mailer/Dockerfile
```

The install's first check (a normal deploy of `main`) refuses `main` only if `main` is not live yet (its
Dockerfile is no longer the approved one); if `main` is already live it just exits "already live", before the
Dockerfile gate, and nothing is refused. Either is expected. Then run the rollback. After a successful
`sudo deploy-darkmatterits --now <commit>` the rollback pin holds until `main` moves, so nothing deploys
`main` by itself. To go forward again, re-run the install from the newest `main` (so the approved copy is
`main`'s Dockerfile again) AND THEN run `sudo deploy-darkmatterits --now`, or wait for a new commit on `main`.
Every commit that passes today's allowlist (see "You can only roll back" below) has the same digest-pinned
`mailer/Dockerfile` as the approved copy, so today no rollback needs this. (Older Dockerfiles use the bare
`FROM node:24-alpine`, which the install's denylist check refuses to approve anyway.)

Builds still use the Pi's default builder, which can see every local image on the Pi; the approved-copy rule
and the Dockerfile rules above are what stop a build reading another project's image. A dedicated BuildKit builder for this project
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
   `deploy/pi/darkmatterits-compose-check`, and every test case under `deploy/pi/test/compose-cases/` and
   `deploy/pi/test/dockerfile-cases/` that uses the pinned reference (all good cases, and every bad case whose
   intended refusal is NOT the image; otherwise those bad cases are refused for the wrong reason and fail).
3. Run `python deploy/pi/test/run-compose-cases.py` and `bash deploy/pi/test/test-dockerfile-approved.sh`,
   then merge to `main` as usual.
4. The Pi refuses that commit until its install is re-run (the live site keeps running): the allowlist on the
   Pi is a root-owned copy, so it refuses the new digest, and when the `FROM` line changed, `mailer/Dockerfile`
   no longer matches the Pi's approved copy either (journal: "mailer/Dockerfile differs from the approved copy
   on the Pi"). Re-run the one-time Pi setup below from a clean checkout of that exact `main` commit, as in
   "Changing the mailer Dockerfile" step 3: it installs the new allowlist, approves the new Dockerfile and runs
   a first check, which deploys it. Do not run the install from a branch before the merge: it would approve a
   Dockerfile that the live `main` does not have.

## One-time Pi setup

From this repo on your computer (needs the `pi` SSH host). Git Bash:

```bash
d=$(ssh pi 'mktemp -d') && scp deploy/pi/install.sh deploy/pi/deploy-darkmatterits* deploy/pi/darkmatterits-compose-check mailer/Dockerfile "pi:$d/" && ssh pi "sudo bash $d/install.sh"
```

PowerShell:

```powershell
$d = ssh pi 'mktemp -d'; scp deploy/pi/install.sh deploy/pi/deploy-darkmatterits deploy/pi/deploy-darkmatterits-preup-check deploy/pi/deploy-darkmatterits-dockerfile-check deploy/pi/deploy-darkmatterits.service deploy/pi/deploy-darkmatterits.timer deploy/pi/darkmatterits-compose-check mailer/Dockerfile "pi:$d/"; ssh pi "sudo bash $d/install.sh"
```

Run it from a clean checkout of the commit whose `mailer/Dockerfile` should be approved (normally the newest
`main`): the Dockerfile you copy becomes the approved copy.

It installs `/usr/local/sbin/deploy-darkmatterits`, `/usr/local/sbin/darkmatterits-compose-check`,
`/usr/local/sbin/deploy-darkmatterits-preup-check`, `/usr/local/sbin/deploy-darkmatterits-dockerfile-check`,
the approved `/usr/local/sbin/darkmatterits-mailer.Dockerfile` and
`/etc/systemd/system/deploy-darkmatterits.{service,timer}`
(root-owned), pauses and rebaselines `secwatch` around the change, enables the timer and does a first check.
Re-run it the same way to update the deploy script or approve a new `mailer/Dockerfile`. There is no GitHub runner, sudo rule or token for this repo.

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

**You can only roll back to a commit whose `docker-compose.yml` and `mailer/Dockerfile` pass today's allowlist**
and whose `mailer/Dockerfile` matches the approved copy (see "Changing the mailer Dockerfile" for approving an
older one). The Pi checks the old commit with the allowlist it has installed now, not the one from back then.
Since the base images were pinned by digest (task D3b), the only commits on `main` that pass are cf23583 and
392bfaa (task D3b's own commits, which reached `main` through the merge that brought D3b in after task D3), that
merge commit, and everything after it. Every other commit is refused, so `--now` on it fails without touching the
running site:
- 6c32cad up to 44c596e (the last commit before that merge), which includes every commit of task D3
  (867cad8 to 44c596e): they use bare image tags (`nginxinc/nginx-unprivileged:1.27-alpine`,
  `FROM node:24-alpine`), which are not on the pinned list;
- fe07fe1, 770582e and everything older: `nginx:alpine`, port `8085:80`, no read-only hardening.

## Old method (removed)

The old workflow SSHed GitHub → VPS → "gateway" → "worker" and ran `deploy.sh` from
`/data/sites/newsite/public`. That path never existed on the Pi and every run since March 2026 failed.
The repo secrets `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY` are no longer used and can be deleted.
