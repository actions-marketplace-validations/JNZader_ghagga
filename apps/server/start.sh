#!/bin/sh
set -e

echo "🔄 Running database migrations..."
cd /app/packages/db && npx tsx src/migrate.ts
cd /app

echo "🚀 Starting GHAGGA server..."
node apps/server/dist/index.js
