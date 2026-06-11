#!/bin/bash
set -euo pipefail

echo "🚀 Veritas Engine - Corrected Deployment"

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

# 1. Create D1 database and capture ID reliably
echo "📦 Creating D1 database..."
CREATE_OUTPUT=$(npx wrangler d1 create veritas_kb 2>&1)
DB_ID=$(echo "$CREATE_OUTPUT" | grep -oE 'database_id = [a-f0-9-]+' | head -1 | cut -d'=' -f2 | tr -d ' ')
if [ -z "$DB_ID" ]; then
    echo "❌ FATAL: Could not extract database ID from wrangler output."
    echo "Output was: $CREATE_OUTPUT"
    exit 1
fi
echo "✅ Database ID: $DB_ID"

# 2. Apply schema
npx wrangler d1 execute veritas_kb --command "
CREATE TABLE IF NOT EXISTS decision_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_name TEXT NOT NULL,
  condition_json TEXT NOT NULL,
  action_text TEXT NOT NULL,
  evidence_source TEXT,
  priority TEXT DEFAULT 'medium',
  category TEXT DEFAULT 'general',
  active INTEGER DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_active ON decision_rules(active);
"

# 3. Insert sample rules
npx wrangler d1 execute veritas_kb --command "
INSERT INTO decision_rules (rule_name, condition_json, action_text, evidence_source, priority, category, active) VALUES
('high_temperature_shutdown', '{\"field\":\"temperature_c\",\"op\":\">\",\"value\":85}', 'Initiate thermal shutdown and inspect cooling path.', 'thermal_policy_v1', 'high', 'safety', 1),
('low_battery_return', '{\"field\":\"battery_pct\",\"op\":\"<\",\"value\":20}', 'Return to base and preserve reserve power.', 'power_policy_v1', 'high', 'energy', 1),
('critical_battery_land', '{\"field\":\"battery_pct\",\"op\":\"<\",\"value\":10}', 'Land immediately at the nearest safe location.', 'power_policy_v1', 'critical', 'energy', 1),
('gps_loss_hover', '{\"field\":\"gps_quality\",\"op\":\"<\",\"value\":3}', 'Hold position and switch to visual-inertial fallback.', 'navigation_policy_v1', 'high', 'navigation', 1),
('wind_limit_abort', '{\"field\":\"wind_mps\",\"op\":\">\",\"value\":14}', 'Abort mission and return along validated corridor.', 'weather_policy_v1', 'high', 'weather', 1),
('rain_detected_abort', '{\"field\":\"weather_detected\",\"op\":\"contains\",\"value\":\"rain\"}', 'Abort outdoor mission and protect exposed electronics.', 'weather_policy_v1', 'medium', 'weather', 1),
('restricted_zone_stop', '{\"field\":\"zone\",\"op\":\"==\",\"value\":\"restricted\"}', 'Stop route execution and request operator authorization.', 'airspace_policy_v1', 'critical', 'compliance', 1),
('payload_overweight_block', '{\"field\":\"payload_kg\",\"op\":\">\",\"value\":5}', 'Block takeoff until payload is reduced or vehicle class is changed.', 'payload_policy_v1', 'high', 'safety', 1),
('latency_high_degrade', '{\"field\":\"control_latency_ms\",\"op\":\">\",\"value\":250}', 'Degrade autonomy mode and increase control margins.', 'control_policy_v1', 'medium', 'control', 1),
('obstacle_detected_pause', '{\"field\":\"obstacle_detected\",\"op\":\"==\",\"value\":\"true\"}', 'Pause movement and recompute collision-free path.', 'perception_policy_v1', 'high', 'perception', 1);
"

# 4. Create Worker directory and files
mkdir -p worker/src
cat > worker/src/index.ts << 'EOF'
export interface Env { D1_VERITAS: D1Database; }

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/health" && request.method === "GET") {
      return Response.json({ status: "veritas_online" }, { headers: corsHeaders });
    }

    if (path === "/rule_fields" && request.method === "GET") {
      const { results } = await env.D1_VERITAS.prepare("SELECT condition_json FROM decision_rules WHERE active = 1").all();
      const fields = new Set<string>();
      for (const row of results) {
        try {
          const cond = JSON.parse(String(row.condition_json));
          if (cond.field) fields.add(cond.field);
        } catch (e) {}
      }
      return Response.json({ fields: Array.from(fields) }, { headers: corsHeaders });
    }

    if (path === "/advise" && request.method === "POST") {
      const payload = await request.json<Record<string, unknown>>();
      const { results } = await env.D1_VERITAS.prepare("SELECT rule_name, condition_json, action_text, evidence_source, priority, category FROM decision_rules WHERE active = 1").all();
      const matches = [];
      for (const row of results) {
        let cond;
        try { cond = JSON.parse(String(row.condition_json)); } catch (e) { continue; }
        const { field, op, value } = cond;
        if (!field || !op || value === undefined) continue;
        if (!(field in payload)) continue;
        let userVal = payload[field];
        if (typeof userVal === "string" && !isNaN(Number(userVal))) userVal = Number(userVal);
        let hit = false;
        if (op === ">" && typeof userVal === "number") hit = userVal > value;
        else if (op === "<" && typeof userVal === "number") hit = userVal < value;
        else if (op === "==") hit = userVal === value;
        else if (op === "contains" && typeof userVal === "string") hit = userVal.includes(String(value));
        if (hit) matches.push({ rule: row.rule_name, action: row.action_text, evidence: row.evidence_source, priority: row.priority, category: row.category });
      }
      return Response.json({ matches }, { headers: corsHeaders });
    }

    return new Response("Not Found", { status: 404, headers: corsHeaders });
  }
};
EOF

# Remove deprecated type = "esm" line
cat > worker/wrangler.toml << EOF
name = "veritas-engine"
main = "src/index.ts"
compatibility_date = "2025-05-29"
[[d1_databases]]
binding = "D1_VERITAS"
database_name = "veritas_kb"
database_id = "$DB_ID"
EOF

# 5. Deploy Worker
echo "🌐 Deploying Worker..."
cd worker
DEPLOY_OUTPUT=$(npx wrangler deploy 2>&1)
echo "$DEPLOY_OUTPUT"
WORKER_URL=$(echo "$DEPLOY_OUTPUT" | grep -oE 'https://[^[:space:]]+workers\.dev' | head -1 || true)
if [ -z "$WORKER_URL" ]; then
    WORKER_URL="https://veritas-engine.your-subdomain.workers.dev"
    echo "⚠️  Could not auto-detect Worker URL. Using fallback: $WORKER_URL"
fi
cd ..

# 6. Create frontend with dynamic worker URL
mkdir -p public
cat > public/index.html << EOF
<!DOCTYPE html>
<html>
<head><title>Veritas Engine</title><style>body{font-family:system-ui;margin:2rem}label{display:block;margin:.5rem 0}input{margin-left:.5rem}</style></head>
<body>
<h1>⚖️ Veritas Engine</h1>
<div id="form"></div>
<button id="advise">Get Advice</button>
<pre id="output"></pre>
<script>
const WORKER_URL = "$WORKER_URL";
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
    input.type = f.includes("detected") || f === "zone" ? "text" : "number";
    label.appendChild(input);
    form.appendChild(label);
  });
}
document.getElementById("advise").onclick = async () => {
  const inputs = Object.fromEntries([...document.querySelectorAll("input")].map(i => [i.name, i.value]));
  const res = await fetch(WORKER_URL + "/advise", {
    method: "POST",
    body: JSON.stringify(inputs),
    headers: { "Content-Type": "application/json" }
  });
  const data = await res.json();
  document.getElementById("output").innerText = JSON.stringify(data, null, 2);
};
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
echo "🧪 Test with: curl $WORKER_URL/health"
