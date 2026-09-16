#!/bin/bash
set -euo pipefail

echo "📦 Deploying Veritas Worker..."

if [ ! -f "wrangler.toml" ]; then
  echo "❌ wrangler.toml not found. Run this from the veritas-worker directory."
  exit 1
fi

if [ ! -f "src/index.ts" ]; then
  echo "❌ src/index.ts not found. This script expects the Veritas Worker entrypoint at src/index.ts."
  exit 1
fi

if grep -q 'your-d1-database-id-here' wrangler.toml; then
  echo "❌ wrangler.toml still contains the placeholder D1 database_id."
  echo "   Create D1 and replace it first:"
  echo "   npx wrangler d1 create veritas_kb"
  echo "   npx wrangler d1 execute veritas_kb --file=../schema.sql"
  echo "   npx wrangler d1 execute veritas_kb --file=../more_rules.sql"
  exit 1
fi

if grep -q 'YOUR_KV_NAMESPACE_ID' wrangler.toml; then
  echo "❌ wrangler.toml still contains the placeholder KV_VERITAS namespace id."
  echo "   Create KV and replace it first:"
  echo "   npx wrangler kv:namespace create KV_VERITAS"
  exit 1
fi

if [ ! -d "node_modules" ] && [ -f "package.json" ]; then
  npm install
fi

if ! npx wrangler whoami >/dev/null 2>&1; then
  echo "❌ Wrangler is not authenticated. Run: npx wrangler login"
  exit 1
fi

if [ -n "${API_KEY:-}" ]; then
  printf "%s" "$API_KEY" | npx wrangler secret put API_KEY
else
  echo "⚠️  API_KEY environment variable not set."
  echo "   If the API key secret is not already configured, run:"
  echo "   npx wrangler secret put API_KEY"
fi

if [ -n "${JWT_SECRET:-}" ]; then
  printf "%s" "$JWT_SECRET" | npx wrangler secret put JWT_SECRET
else
  echo "⚠️  JWT_SECRET environment variable not set."
  echo "   If tier-2 JWT support requires it, run:"
  echo "   npx wrangler secret put JWT_SECRET"
fi

npx wrangler deploy

echo "✅ Deployment complete!"
echo "🧪 Test with: curl https://veritas-worker.<your-subdomain>.workers.dev/health"
