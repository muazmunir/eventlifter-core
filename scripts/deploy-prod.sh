#!/usr/bin/env bash
# Production deploy for ewentcast.com — run on the Ubuntu server from app root.
set -euo pipefail

APP_NAME="${PM2_APP_NAME:-channel-manager}"
APP_PORT="${PORT:-3002}"
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"

cd "$APP_DIR"
export PORT="$APP_PORT"
export NODE_ENV=production

echo "==> Stopping $APP_NAME (avoid mixed .next while building)..."
pm2 stop "$APP_NAME" 2>/dev/null || true

echo "==> Installing dependencies..."
npm ci

echo "==> Clean production build..."
rm -rf .next
npm run build

echo "==> Verifying critical static chunks exist..."
node <<'NODE'
const fs = require('fs');
const path = require('path');
const indexPath = path.join('.next', 'server', 'app', 'index.html');
if (!fs.existsSync(indexPath)) {
  console.error('Missing .next/server/app/index.html — build failed?');
  process.exit(1);
}
const html = fs.readFileSync(indexPath, 'utf8');
const chunks = [...html.matchAll(/\/_next\/static\/chunks\/([^"']+\.js)/g)].map((m) => m[1]);
const missing = chunks.filter((c) => !fs.existsSync(path.join('.next', 'static', 'chunks', c)));
if (missing.length) {
  console.error('Build HTML references missing chunk files:');
  missing.forEach((c) => console.error('  -', c));
  process.exit(1);
}
console.log(`OK — ${chunks.length} homepage chunks present on disk.`);
NODE

echo "==> Starting $APP_NAME on port $APP_PORT..."
if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
  pm2 restart "$APP_NAME" --update-env
else
  pm2 start node_modules/next/dist/bin/next --name "$APP_NAME" -- start -p "$APP_PORT"
fi
pm2 save

echo "==> Done. Test: curl -I http://127.0.0.1:$APP_PORT"
