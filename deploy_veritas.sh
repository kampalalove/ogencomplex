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

# 2. Apply schema
npx wrangler d1 execute veritas_kb --command "
CREATE TABLE IF NOT EXISTS decision_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_name TEXT NOT NULL UNIQUE,
  condition_json TEXT NOT NULL,
  action_text TEXT NOT NULL,
  evidence_source TEXT,
  priority TEXT DEFAULT 'medium',
  category TEXT DEFAULT 'general',
  active INTEGER DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_active ON decision_rules(active);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rule_name ON decision_rules(rule_name);
"

# 3. Bulk insert 20+ rules idempotently
cat > more_rules.sql << 'SQL'
INSERT OR IGNORE INTO decision_rules (rule_name, condition_json, action_text, evidence_source, priority, category, active) VALUES
('high_temperature_shutdown', '{"field":"temperature_c","op":">","value":85}', 'Initiate thermal shutdown and inspect cooling path.', 'manuals/thermal_policy_v1.pdf', 'high', 'safety', 1),
('low_battery_return', '{"field":"battery_pct","op":"<","value":20}', 'Return to base and preserve reserve power.', 'manuals/power_policy_v1.pdf', 'high', 'energy', 1),
('critical_battery_land', '{"field":"battery_pct","op":"<","value":10}', 'Land immediately at the nearest safe location.', 'manuals/power_policy_v1.pdf', 'critical', 'energy', 1),
('gps_loss_hover', '{"field":"gps_quality","op":"<","value":3}', 'Hold position and switch to visual-inertial fallback.', 'manuals/navigation_policy_v1.pdf', 'high', 'navigation', 1),
('wind_limit_abort', '{"field":"wind_mps","op":">","value":14}', 'Abort mission and return along validated corridor.', 'manuals/weather_policy_v1.pdf', 'high', 'weather', 1),
('rain_detected_abort', '{"field":"weather_detected","op":"contains","value":"rain"}', 'Abort outdoor mission and protect exposed electronics.', 'manuals/weather_policy_v1.pdf', 'medium', 'weather', 1),
('restricted_zone_stop', '{"field":"zone","op":"==","value":"restricted"}', 'Stop route execution and request operator authorization.', 'manuals/airspace_policy_v1.pdf', 'critical', 'compliance', 1),
('payload_overweight_block', '{"field":"payload_kg","op":">","value":5}', 'Block takeoff until payload is reduced or vehicle class is changed.', 'manuals/payload_policy_v1.pdf', 'high', 'safety', 1),
('latency_high_degrade', '{"field":"control_latency_ms","op":">","value":250}', 'Degrade autonomy mode and increase control margins.', 'manuals/control_policy_v1.pdf', 'medium', 'control', 1),
('obstacle_detected_pause', '{"field":"obstacle_detected","op":"==","value":"true"}', 'Pause movement and recompute collision-free path.', 'manuals/perception_policy_v1.pdf', 'high', 'perception', 1),
('low_humidity_static_risk', '{"field":"humidity_pct","op":"<","value":20}', 'Enable static-discharge precautions before handling sensitive electronics.', 'manuals/environment_policy_v1.pdf', 'medium', 'environment', 1),
('high_current_draw_inspect', '{"field":"current_amp","op":">","value":45}', 'Inspect propulsion and power bus for overload before continuing.', 'manuals/electrical_policy_v1.pdf', 'high', 'electrical', 1),
('pressure_high_relief', '{"field":"pressure_kpa","op":">","value":130}', 'Open relief path and verify pressure regulator behavior.', 'manuals/pressure_policy_v1.pdf', 'high', 'safety', 1),
('pressure_low_leak_check', '{"field":"pressure_kpa","op":"<","value":80}', 'Check for leaks and isolate the affected subsystem.', 'manuals/pressure_policy_v1.pdf', 'medium', 'maintenance', 1),
('vibration_high_land', '{"field":"vibration_g","op":">","value":2.5}', 'Land and inspect frame, mounts, bearings, and propellers.', 'manuals/mechanical_policy_v1.pdf', 'high', 'mechanical', 1),
('camera_fault_degrade', '{"field":"camera_status","op":"contains","value":"fault"}', 'Degrade perception stack and switch to redundant sensor mode.', 'manuals/perception_policy_v1.pdf', 'high', 'perception', 1),
('lidar_fault_slow', '{"field":"lidar_status","op":"contains","value":"fault"}', 'Reduce speed envelope and require visual confirmation.', 'manuals/perception_policy_v1.pdf', 'medium', 'perception', 1),
('memory_pressure_restart', '{"field":"memory_pct","op":">","value":90}', 'Restart non-critical services and preserve mission ledger.', 'manuals/compute_policy_v1.pdf', 'medium', 'compute', 1),
('cpu_hot_throttle', '{"field":"cpu_temp_c","op":">","value":95}', 'Throttle compute workload and prioritize control loop tasks.', 'manuals/compute_policy_v1.pdf', 'high', 'compute', 1),
('packet_loss_high_rtb', '{"field":"packet_loss_pct","op":">","value":15}', 'Return to base using autonomous failsafe route.', 'manuals/comms_policy_v1.pdf', 'high', 'communications', 1),
('geofence_margin_low_stop', '{"field":"geofence_margin_m","op":"<","value":10}', 'Stop lateral movement and move away from geofence boundary.', 'manuals/airspace_policy_v1.pdf', 'critical', 'compliance', 1),
('operator_override_required', '{"field":"mode","op":"==","value":"manual_override_required"}', 'Request operator review before autonomous continuation.', 'manuals/operator_policy_v1.pdf', 'high', 'operations', 1),
('maintenance_due_block', '{"field":"flight_hours_since_service","op":">","value":50}', 'Block non-emergency missions until maintenance inspection is complete.', 'manuals/maintenance_policy_v1.pdf', 'medium', 'maintenance', 1),
('night_ops_lighting_check', '{"field":"mission_profile","op":"contains","value":"night"}', 'Verify anti-collision lighting and night-ops checklist.', 'manuals/night_ops_policy_v1.pdf', 'medium', 'operations', 1),
('unknown_anomaly_hold', '{"field":"anomaly_detected","op":"==","value":"true"}', 'Hold state, preserve evidence, and request operator adjudication.', 'manuals/anomaly_policy_v1.pdf', 'high', 'safety', 1);
SQL
npx wrangler d1 execute veritas_kb --file=more_rules.sql

# 4. Create R2 bucket (idempotent-ish; ignore if it already exists)
echo "🪣 Ensuring R2 bucket exists..."
npx wrangler r2 bucket create veritas-assets >/dev/null 2>&1 || true

# 5. Create Worker directory and files
mkdir -p worker/src
cat > worker/src/index.ts << 'EOF'
export interface Env {
  D1_VERITAS: D1Database;
  R2_VERITAS: R2Bucket;
  API_KEY: string;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-API-Key",
};

const publicPaths = ["/health", "/rule_fields"];

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

    if (path === "/evidence" && request.method === "GET") {
      return handleEvidence(url, env);
    }

    if (!publicPaths.includes(path)) {
      const apiKey = request.headers.get("X-API-Key");
      const expectedKey = env.API_KEY;
      if (!expectedKey || apiKey !== expectedKey) {
        return new Response("Unauthorized", { status: 401, headers: corsHeaders });
      }
    }

    if (path === "/rules" && request.method === "GET") {
      const { results } = await env.D1_VERITAS.prepare(
        "SELECT rule_name, condition_json, action_text, evidence_source, priority, category FROM decision_rules WHERE active = 1 ORDER BY category, priority, rule_name"
      ).all();
      return Response.json({ rules: results }, { headers: corsHeaders });
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
        if (hit) {
          const evidenceKey = typeof row.evidence_source === "string" ? row.evidence_source : "";
          const match: Record<string, unknown> = {
            rule: row.rule_name,
            action: row.action_text,
            evidence: evidenceKey,
            priority: row.priority,
            category: row.category,
          };
          if (evidenceKey) match.evidence_url = await signedEvidenceUrl(url.origin, evidenceKey, env.API_KEY);
          matches.push(match);
        }
      }
      return Response.json({ matches }, { headers: corsHeaders });
    }

    return new Response("Not Found", { status: 404, headers: corsHeaders });
  }
};

async function handleEvidence(url: URL, env: Env): Promise<Response> {
  const key = url.searchParams.get("key") || "";
  const exp = Number(url.searchParams.get("exp") || "0");
  const sig = url.searchParams.get("sig") || "";
  if (!key || !exp || !sig) return new Response("Missing signed evidence parameters", { status: 400, headers: corsHeaders });
  if (Date.now() > exp * 1000) return new Response("Evidence link expired", { status: 401, headers: corsHeaders });
  if (sig !== await signEvidence(key, exp, env.API_KEY)) return new Response("Invalid evidence signature", { status: 401, headers: corsHeaders });

  const object = await env.R2_VERITAS.get(key);
  if (!object) return new Response("Evidence not found", { status: 404, headers: corsHeaders });
  return new Response(object.body, {
    headers: {
      ...corsHeaders,
      "Content-Type": object.httpMetadata?.contentType || "application/octet-stream",
      "Cache-Control": "private, max-age=3600",
    },
  });
}

async function signedEvidenceUrl(origin: string, key: string, apiKey: string): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const sig = await signEvidence(key, exp, apiKey);
  return `${origin}/evidence?key=${encodeURIComponent(key)}&exp=${exp}&sig=${sig}`;
}

async function signEvidence(key: string, exp: number, secret: string): Promise<string> {
  const material = new TextEncoder().encode(`${key}:${exp}:${secret}`);
  const digest = await crypto.subtle.digest("SHA-256", material);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}
EOF

cat > worker/wrangler.toml << EOF
name = "veritas-engine"
main = "src/index.ts"
compatibility_date = "2025-05-29"
[[d1_databases]]
binding = "D1_VERITAS"
database_name = "veritas_kb"
database_id = "$DB_ID"

[[r2_buckets]]
binding = "R2_VERITAS"
bucket_name = "veritas-assets"
EOF

# 6. Deploy Worker
echo "🌐 Deploying Worker..."
cd worker
printf "%s" "$API_KEY_VALUE" | npx wrangler secret put API_KEY
DEPLOY_OUTPUT=$(npx wrangler deploy 2>&1)
echo "$DEPLOY_OUTPUT"
WORKER_URL=$(echo "$DEPLOY_OUTPUT" | grep -oE 'https://[^[:space:]]+workers\.dev' | head -1 || true)
if [ -z "$WORKER_URL" ]; then
    WORKER_URL="https://veritas-engine.your-subdomain.workers.dev"
    echo "⚠️  Could not auto-detect Worker URL. Using fallback: $WORKER_URL"
fi
cd ..

# 7. Create frontend with dynamic worker URL and API key UX
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
    input.type = f.includes("detected") || f === "zone" || f.endsWith("status") || f === "mode" || f === "mission_profile" ? "text" : "number";
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

# 8. Deploy Pages
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
echo "🪣 Upload evidence with: npx wrangler r2 object put veritas-assets/manuals/thermal_policy_v1.pdf --file=./local.pdf"
echo "🧪 Test with: curl $WORKER_URL/health"
echo "🧪 Auth test: curl -H 'X-API-Key: $API_KEY_VALUE' $WORKER_URL/rules"
