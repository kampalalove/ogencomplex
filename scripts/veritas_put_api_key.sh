#!/bin/bash
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Usage: $0 <api-key> [comment]"
  exit 1
fi

KEY="$1"
COMMENT="${2:-manual}"
HASH=$(printf "%s" "$KEY" | sha256sum | cut -d' ' -f1)
VALUE=$(printf '{"tier":1,"comment":"%s"}' "$COMMENT")

npx wrangler kv:key put "apikey:${HASH}" --binding KV_VERITAS --value "$VALUE"

echo "Stored tier-1 API key hash in KV_VERITAS:"
echo "apikey:${HASH}"
