#!/usr/bin/env bash
# daily-limitless-sync.sh
#
# Runs the Limitless tournament sync, rebuilds the app, and restarts the service.
# Designed for cron on the VPS:  0 6 * * * /srv/championslab/scripts/daily-limitless-sync.sh >> /srv/championslab/logs/limitless-sync.log 2>&1

set -euo pipefail

PROJECT_DIR="/srv/championslab"
LOG_PREFIX="[$(date '+%Y-%m-%d %H:%M:%S')]"

cd "$PROJECT_DIR"

echo "$LOG_PREFIX Starting Limitless tournament sync..."

# Run the sync script
npx tsx scripts/sync-limitless-tournaments.ts 2>&1
SYNC_EXIT=$?

if [ $SYNC_EXIT -ne 0 ]; then
  echo "$LOG_PREFIX ✗ Sync failed with exit code $SYNC_EXIT"
  exit 1
fi

# Check if simulation-data.ts actually changed
if git diff --quiet src/lib/simulation-data.ts 2>/dev/null; then
  echo "$LOG_PREFIX No changes in simulation-data.ts — skipping rebuild."
  exit 0
fi

echo "$LOG_PREFIX Changes detected — rebuilding..."

# Build
NODE_OPTIONS="--max-old-space-size=3072" node node_modules/.bin/next build --webpack 2>&1
BUILD_EXIT=$?

if [ $BUILD_EXIT -ne 0 ]; then
  echo "$LOG_PREFIX ✗ Build failed with exit code $BUILD_EXIT"
  # Revert the source change so we don't leave a broken state
  git checkout src/lib/simulation-data.ts 2>/dev/null || true
  exit 1
fi

# Restart service
sudo systemctl restart championslab
echo "$LOG_PREFIX ✅ Sync complete — service restarted."
