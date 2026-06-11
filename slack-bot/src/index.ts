export interface Env {
  VERITAS_WORKER_URL: string;
  API_KEY: string;
  SLACK_SIGNING_SECRET?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("Not Found", { status: 404 });
    }

    const rawBody = await request.text();
    if (env.SLACK_SIGNING_SECRET && !(await verifySlackSignature(request, rawBody, env.SLACK_SIGNING_SECRET))) {
      return new Response("bad_signature", { status: 401 });
    }

    const form = new URLSearchParams(rawBody);
    const command = form.get("command") || "/veritas";
    const text = form.get("text") || "";
    const payload = parseKeyValuePairs(text);

    if (Object.keys(payload).length === 0) {
      return Response.json({
        response_type: "ephemeral",
        text: `Usage: ${command} temperature_c=90 battery_pct=12 zone=restricted`,
      });
    }

    const adviseResp = await fetch(`${env.VERITAS_WORKER_URL.replace(/\/$/, "")}/advise`, {
      method: "POST",
      headers: {
        "X-API-Key": env.API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!adviseResp.ok) {
      return Response.json({
        response_type: "ephemeral",
        text: `Veritas request failed: ${adviseResp.status} ${await adviseResp.text()}`,
      });
    }

    const advice = await adviseResp.json<{ matches?: VeritasMatch[] }>();
    return Response.json({
      response_type: "in_channel",
      text: formatSlackResponse(advice.matches || []),
    });
  },
};

interface VeritasMatch {
  rule?: string;
  action?: string;
  evidence?: string;
  evidence_url?: string;
  priority?: string;
  category?: string;
}

function parseKeyValuePairs(text: string): Record<string, string | number> {
  const payload: Record<string, string | number> = {};
  for (const token of text.match(/(?:[^\s"]+|"[^"]*")+/g) || []) {
    const [rawKey, ...valueParts] = token.split("=");
    if (!rawKey || valueParts.length === 0) continue;
    const rawValue = valueParts.join("=").replace(/^"|"$/g, "");
    const numeric = Number(rawValue);
    payload[rawKey] = rawValue.trim() !== "" && !Number.isNaN(numeric) ? numeric : rawValue;
  }
  return payload;
}

function formatSlackResponse(matches: VeritasMatch[]): string {
  if (matches.length === 0) {
    return "No active Veritas rules matched this payload.";
  }

  return matches.map(match => {
    const priority = String(match.priority || "medium").toUpperCase();
    const evidence = match.evidence_url ? `\nEvidence: ${match.evidence_url}` : "";
    return `*${priority}* ${match.rule || "rule"}\n${match.action || "No action provided."}${evidence}`;
  }).join("\n\n");
}

async function verifySlackSignature(request: Request, rawBody: string, secret: string): Promise<boolean> {
  const timestamp = request.headers.get("X-Slack-Request-Timestamp") || "";
  const signature = request.headers.get("X-Slack-Signature") || "";
  if (!timestamp || !signature) return false;

  const ageSeconds = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(ageSeconds) || ageSeconds > 300) return false;

  const base = `v0:${timestamp}:${rawBody}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(base));
  const expected = `v0=${[...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("")}`;
  return timingSafeEqual(expected, signature);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
