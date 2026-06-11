#!/bin/bash
set -euo pipefail

echo "🚀 Veritas Engine - Corrected Deployment + Extensions"

require_command() {
    if ! command -v "$1" >/dev/null 2>&1; then
        echo "❌ FATAL: Missing required command: $1"
        exit 1
    fi
}

require_command node
require_command npm
require_command npx
require_command grep
require_command cut
require_command tr
require_command head
require_command sed

for REQUIRED_FILE in schema.sql more_rules.sql veritas-worker/src/index.ts veritas-worker/wrangler.toml; do
    if [ ! -f "$REQUIRED_FILE" ]; then
        echo "❌ FATAL: Required file missing: $REQUIRED_FILE"
        exit 1
    fi
done

API_KEY_VALUE="${API_KEY:-}"
if [ -z "$API_KEY_VALUE" ]; then
    if command -v openssl >/dev/null 2>&1; then
        API_KEY_VALUE=$(openssl rand -hex 24)
    else
        API_KEY_VALUE="replace-with-a-strong-random-api-key"
    fi
fi

# 1. Create D1 database and capture ID reliably
echo "📦 Creating D1 database..."
CREATE_OUTPUT=$(npx wrangler d1 create veritas_kb 2>&1 || true)
DB_ID=$(echo "$CREATE_OUTPUT" | grep -oE 'database_id = [a-f0-9-]+' | head -1 | cut -d'=' -f2 | tr -d ' ')
if [ -z "$DB_ID" ]; then
    echo "❌ FATAL: Could not extract database ID from wrangler output."
    echo "Output was: $CREATE_OUTPUT"
    exit 1
fi
echo "✅ Database ID: $DB_ID"

# 2. Apply schema and seed rules
echo "🗄️  Applying D1 schema..."
npx wrangler d1 execute veritas_kb --file=schema.sql
echo "📜 Seeding Veritas rules..."
npx wrangler d1 execute veritas_kb --file=more_rules.sql

# 3. Create R2 bucket (ignore already-exists failures)
echo "🪣 Ensuring R2 bucket exists..."
npx wrangler r2 bucket create veritas-assets >/dev/null 2>&1 || true

# 4. Prepare Worker deployment directory
rm -rf worker
mkdir -p worker
cp -R veritas-worker/src worker/src
cp veritas-worker/wrangler.toml worker/wrangler.toml
sed -i.bak "s/database_id = \"your-d1-database-id-here\"/database_id = \"$DB_ID\"/" worker/wrangler.toml
rm -f worker/wrangler.toml.bak

# 5. Deploy Worker
echo "🌐 Deploying Worker..."
cd worker
printf "%s" "$API_KEY_VALUE" | npx wrangler secret put API_KEY
DEPLOY_OUTPUT=$(npx wrangler deploy 2>&1)
echo "$DEPLOY_OUTPUT"
WORKER_URL=$(echo "$DEPLOY_OUTPUT" | grep -oE 'https://[^[:space:]]+workers\.dev' | head -1 || true)
if [ -z "$WORKER_URL" ]; then
    WORKER_URL="https://veritas-worker.your-subdomain.workers.dev"
    echo "⚠️  Could not auto-detect Worker URL. Using fallback: $WORKER_URL"
fi
cd ..

# 6. Create frontend with dynamic Worker URL and API key UX
mkdir -p public
cat > public/index.html << EOF
<!DOCTYPE html>
<html>
<head><title>Veritas Engine</title><style>body{font-family:system-ui;margin:2rem;max-width:900px}label{display:block;margin:.5rem 0}input{margin-left:.5rem}a{color:#2563eb}pre{background:#f8fafc;padding:1rem;overflow:auto}</style></head>
<body>
<h1>⚖️ Veritas Engine</h1>
<label>API Key: <input id="apiKey" type="password" style="min-width:24rem" placeholder="Paste API key"></label>
<button id="saveKey">Save API Key Locally</button>
<h2>Inputs</h2>
<div id="form"></div>
<button id="advise">Get Advice</button>
<button id="loadRules">Load Active Rules</button>
<pre id="output"></pre>
<script>
const WORKER_URL = "$WORKER_URL";
const keyInput = document.getElementById("apiKey");
keyInput.value = localStorage.getItem("veritas_api_key") || "";
document.getElementById("saveKey").onclick = () => {
  localStorage.setItem("veritas_api_key", keyInput.value.trim());
  document.getElementById("output").innerText = "API key saved in this browser.";
};
function authHeaders() {
  return { "Content-Type": "application/json", "X-API-Key": keyInput.value.trim() };
}
async function loadFields() {
  const res = await fetch(WORKER_URL + "/rule_fields");
  const { fields } = await res.json();
  const form = document.getElementById("form");
  form.innerHTML = "";
  fields.forEach(f => {
    const label = document.createElement("label");
    label.innerText = f + ": ";
    const input = document.createElement("input");
    input.name = f;
    input.type = f === "fire_detected" ? "text" : "number";
    label.appendChild(input);
    form.appendChild(label);
  });
}
document.getElementById("advise").onclick = async () => {
  const inputs = Object.fromEntries([...document.querySelectorAll("#form input")].map(i => [i.name, i.value]));
  const res = await fetch(WORKER_URL + "/advise", {
    method: "POST",
    body: JSON.stringify(inputs),
    headers: authHeaders()
  });
  const data = await res.json();
  renderAdvice(data);
};
document.getElementById("loadRules").onclick = async () => {
  const res = await fetch(WORKER_URL + "/rules", { headers: { "X-API-Key": keyInput.value.trim() } });
  const data = await res.json();
  document.getElementById("output").innerText = JSON.stringify(data, null, 2);
};
function renderAdvice(data) {
  const lines = (data.matches || []).map(m => {
    const link = m.evidence_url ? "\\nEvidence: " + m.evidence_url : "";
    return "[" + m.priority + "] " + m.rule + " - " + m.action + link;
  });
  document.getElementById("output").innerText = lines.length ? lines.join("\\n\\n") : JSON.stringify(data, null, 2);
}
loadFields().catch(error => {
  document.getElementById("output").innerText = "Failed to load fields: " + error.message;
});
</script>
</body>
</html>
EOF

# 7. Deploy Pages
echo "📄 Deploying frontend..."
PAGES_OUTPUT=$(npx wrangler pages deploy public --project-name veritas-ui 2>&1)
echo "$PAGES_OUTPUT"
PAGES_URL=$(echo "$PAGES_OUTPUT" | grep -oE 'https://[^[:space:]]+pages\.dev' | head -1 || true)
if [ -z "$PAGES_URL" ]; then
    PAGES_URL="https://veritas-ui.pages.dev"
fi

echo "✅ Veritas Engine deployed!"
echo "🌍 Worker URL: $WORKER_URL"
echo "🌍 Frontend URL: $PAGES_URL"
echo "🔑 API key: $API_KEY_VALUE"
echo "🪣 Upload evidence with: npx wrangler r2 object put veritas-assets/manuals/thermal_emergency.pdf --file=./local.pdf"
echo "🧪 Test with: curl $WORKER_URL/health"
echo "🧪 Auth test: curl -H 'X-API-Key: $API_KEY_VALUE' $WORKER_URL/rules"
