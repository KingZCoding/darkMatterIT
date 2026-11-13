#!/usr/bin/env python3
"""Test runner for the Pi's compose allowlist (deploy/pi/darkmatterits-compose-check).

What it proves
--------------
Every rule the allowlist enforces has a case that must PASS and a case that must be REFUSED,
and each refused case is refused for the RIGHT reason (its `# expect:` text must appear in the
checker's output), so a case can't pass by tripping some unrelated rule. Added for task D3
(audit 2026-11-13); run in CI by .github/workflows/check.yml and by hand:

    python deploy/pi/test/run-compose-cases.py                 # test the repo's copy
    python deploy/pi/test/run-compose-cases.py --check PATH    # test another copy (e.g. the Pi's)

Case files (first lines carry `# expect: ok` or `# expect: <text in the refusal>`):
  compose-cases/{good,bad}/*.yml          a whole docker-compose.yml; built with the real
                                          mailer/Dockerfile next to it
  dockerfile-cases/{good,bad}/*.Dockerfile  a mailer/Dockerfile; checked with the real
                                          docker-compose.yml next to it
Generated here (too big or too repetitive to commit): a file just over 64 KB, one exactly 64 KB,
an alias bomb, and a file with exactly the 20 aliases allowed.

The checker runs as a subprocess, exactly as the Pi runs it, each case in its own temp folder.
Exit 0 = every case behaved, 1 = at least one did not.
"""
from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
REAL_COMPOSE = os.path.join(REPO, "docker-compose.yml")
REAL_DOCKERFILE = os.path.join(REPO, "mailer", "Dockerfile")
EXPECT_RE = re.compile(r"^# expect: (.+)$", re.MULTILINE)
MAX_BYTES = 64 * 1024        # must match the checker
TIME_LIMIT = 10              # seconds; the alias bomb must be refused well inside this


def read(path: str) -> str:
    with open(path, encoding="utf-8") as f:
        return f.read()


def run_case(check: str, compose_text: str, dockerfile_text: str) -> tuple[int, str, float]:
    """Run the checker on a temp project folder; return (exit code, combined output, seconds)."""
    with tempfile.TemporaryDirectory(prefix="D3-compose-case-") as tmp:
        os.makedirs(os.path.join(tmp, "mailer"))
        with open(os.path.join(tmp, "docker-compose.yml"), "w", encoding="utf-8", newline="\n") as f:
            f.write(compose_text)
        with open(os.path.join(tmp, "mailer", "Dockerfile"), "w", encoding="utf-8", newline="\n") as f:
            f.write(dockerfile_text)
        start = time.monotonic()
        try:
            p = subprocess.run([sys.executable, check, os.path.join(tmp, "docker-compose.yml")],
                               capture_output=True, text=True, timeout=TIME_LIMIT * 3)
        except subprocess.TimeoutExpired:   # e.g. an alias bomb being expanded: a failure, not a crash
            return 124, "timed out", time.monotonic() - start
        return p.returncode, p.stdout + p.stderr, time.monotonic() - start


def verdict(name: str, expect: str, code: int, out: str, seconds: float) -> bool:
    """Print one result line; True when the case behaved as expected."""
    if expect == "ok":
        good = code == 0
    else:
        good = code == 1 and expect in out
    if seconds > TIME_LIMIT:
        good = False
    print(f"{'PASS' if good else 'FAIL'}  {name}  (expect: {expect}; exit {code}; {seconds:.2f}s)")
    if not good:
        print("      checker said: " + out.strip().replace("\n", "\n      "))
    return good


def file_cases() -> list[tuple[str, str, str, str]]:
    """(name, expect, compose text, dockerfile text) for every committed case file."""
    cases = [("real docker-compose.yml + mailer/Dockerfile", "ok", read(REAL_COMPOSE), read(REAL_DOCKERFILE))]
    for kind in ("good", "bad"):
        folder = os.path.join(HERE, "compose-cases", kind)
        for fn in sorted(os.listdir(folder)):
            text = read(os.path.join(folder, fn))
            cases.append((f"compose/{kind}/{fn}", EXPECT_RE.search(text).group(1).strip(), text, read(REAL_DOCKERFILE)))
        folder = os.path.join(HERE, "dockerfile-cases", kind)
        for fn in sorted(os.listdir(folder)):
            text = read(os.path.join(folder, fn))
            cases.append((f"dockerfile/{kind}/{fn}", EXPECT_RE.search(text).group(1).strip(), read(REAL_COMPOSE), text))
    for name, expect, _, _ in cases:   # a typo'd header must not turn a bad case into a good one
        if name.split("/")[1:2] == ["bad"] and expect == "ok":
            raise SystemExit(f"{name}: a bad case can't expect ok")
    return cases


def generated_cases() -> list[tuple[str, str, str, str]]:
    """Size and alias cases built from the real compose file."""
    real = read(REAL_COMPOSE)
    dockerfile = read(REAL_DOCKERFILE)
    pad = MAX_BYTES - len(real.encode("utf-8")) - 1          # -1 for the newline after the padding
    exact = real + "#" * pad + "\n"
    assert len(exact.encode("utf-8")) == MAX_BYTES
    # Billion laughs: 9 levels of 9 aliases each = 72 alias events (and 9^9 strings if expanded).
    bomb = 'x-l0: &l0 ["lol"]\n' + "".join(
        f"x-l{i}: &l{i} [{', '.join([f'*l{i - 1}'] * 9)}]\n" for i in range(1, 10))
    # The real file has 2 aliases (*logging twice); 18 more makes exactly the limit of 20.
    twenty = real + "x-many: [" + ", ".join(["*logging"] * 18) + "]\n"
    return [
        ("generated/exactly-64KB", "ok", exact, dockerfile),
        ("generated/over-64KB", f"file is over {MAX_BYTES} bytes", exact + "#\n", dockerfile),
        ("generated/twenty-aliases", "ok", twenty, dockerfile),
        ("generated/alias-bomb", "more than 20 YAML aliases", real + bomb, dockerfile),
        ("generated/twenty-one-aliases", "more than 20 YAML aliases",
         twenty.replace("x-many: [", "x-many: [*logging, "), dockerfile),
    ]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--check", default=os.path.join(REPO, "deploy", "pi", "darkmatterits-compose-check"),
                    help="the allowlist script to test (default: the repo's copy)")
    args = ap.parse_args()
    results = [verdict(n, e, *run_case(args.check, c, d)) for n, e, c, d in file_cases() + generated_cases()]
    failed = results.count(False)
    print(f"\n{len(results) - failed}/{len(results)} cases behaved as expected")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
