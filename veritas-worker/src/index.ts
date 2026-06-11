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
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/health" && request.method === "GET") {
      return Response.json({ status: "ok", timestamp: new Date().toISOString() }, { headers: corsHeaders });
    }

    if (path === "/rule_fields" && request.method === "GET") {
      const { results } = await env.D1_VERITAS.prepare("SELECT condition_json FROM decision_rules WHERE active = 1").all();
      const fields = new Set<string>();
      for (const row of results) {
        try {
          const condition = JSON.parse(String(row.condition_json));
          for (const field of extractConditionFields(condition)) fields.add(field);
        } catch (error) {}
      }
      return Response.json({ fields: Array.from(fields).sort() }, { headers: corsHeaders });
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
        "SELECT rule_name, condition_json, action_text, priority, category, evidence_source FROM decision_rules WHERE active = 1 ORDER BY priority DESC, category, rule_name"
      ).all();
      return Response.json({ rules: results }, { headers: corsHeaders });
    }

    if (path === "/advise" && request.method === "POST") {
      const payload = await request.json<Record<string, unknown>>();
      const { results } = await env.D1_VERITAS.prepare(
        "SELECT rule_name, condition_json, action_text, evidence_source, priority, category FROM decision_rules WHERE active = 1 ORDER BY priority DESC, rule_name"
      ).all();
      const matches = [];

      for (const row of results) {
        let condition;
        try {
          condition = JSON.parse(String(row.condition_json));
        } catch (error) {
          continue;
        }

        if (!evaluateCondition(payload, condition)) continue;

        const evidenceKey = typeof row.evidence_source === "string" ? row.evidence_source : "";
        const match: Record<string, unknown> = {
          rule: row.rule_name,
          rule_name: row.rule_name,
          action: row.action_text,
          action_text: row.action_text,
          priority: row.priority,
          category: row.category,
          evidence: evidenceKey,
        };
        if (evidenceKey) match.evidence_url = await signedEvidenceUrl(url.origin, evidenceKey, env.API_KEY);
        matches.push(match);
      }

      return Response.json({ matches }, { headers: corsHeaders });
    }

    return new Response("Not Found", { status: 404, headers: corsHeaders });
  },
};

function extractConditionFields(condition: Record<string, unknown>): string[] {
  if (typeof condition.field === "string") return [condition.field];
  return Object.keys(condition);
}

function evaluateCondition(payload: Record<string, unknown>, condition: Record<string, unknown>): boolean {
  if (typeof condition.field === "string" && typeof condition.op === "string") {
    return evaluateOperation(payload[condition.field], condition.op, condition.value);
  }

  return Object.entries(condition).every(([field, spec]) => {
    if (!(field in payload)) return false;
    if (typeof spec === "boolean" || typeof spec === "number" || typeof spec === "string") {
      return payload[field] === spec;
    }
    if (!spec || typeof spec !== "object") return false;
    return Object.entries(spec as Record<string, unknown>).every(([op, expected]) => evaluateOperation(payload[field], op, expected));
  });
}

function evaluateOperation(actualRaw: unknown, op: string, expected: unknown): boolean {
  const actual = normalizeValue(actualRaw);
  const normalizedExpected = normalizeValue(expected);

  if (op === ">" || op === "gt") {
    return typeof actual === "number" && typeof normalizedExpected === "number" && actual > normalizedExpected;
  }
  if (op === "<" || op === "lt") {
    return typeof actual === "number" && typeof normalizedExpected === "number" && actual < normalizedExpected;
  }
  if (op === ">=" || op === "gte") {
    return typeof actual === "number" && typeof normalizedExpected === "number" && actual >= normalizedExpected;
  }
  if (op === "<=" || op === "lte") {
    return typeof actual === "number" && typeof normalizedExpected === "number" && actual <= normalizedExpected;
  }
  if (op === "==" || op === "eq") {
    return actual === normalizedExpected;
  }
  if (op === "contains") {
    return typeof actual === "string" && actual.includes(String(normalizedExpected));
  }
  return false;
}

function normalizeValue(value: unknown): unknown {
  if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) {
    return Number(value);
  }
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}

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
