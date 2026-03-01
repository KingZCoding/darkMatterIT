#!/usr/bin/env bash
set -e

echo "=== Deploy started on $(hostname) ==="

cd /data/sites/newsite/public

echo "Pulling latest code..."
git fetch origin
git checkout main
git pull origin main

echo "Rebuilding containers..."
docker compose build

echo "Restarting containers..."
docker compose up -d

echo "=== Deploy complete ==="
