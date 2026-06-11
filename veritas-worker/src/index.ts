export interface Env {
  D1_VERITAS: D1Database;
  R2_VERITAS: R2Bucket;
  API_KEY: string;
}

interface RuleRow {
  id?: number;
  rule_name: string;
  condition_json: string;
  action_text: string;
  priority: number;
  category: string | null;
  evidence_source: string | null;
  active?: number;
  created_at?: string;
  updated_at?: string;
}

interface RuleInput {
  rule_name: string;
  condition_json: Record<string, unknown> | string;
  action_text: string;
  priority?: number;
  category?: string;
  evidence_source?: string | null;
  active?: number;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
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
      return json({ status: "ok", timestamp: Date.now() });
    }

    if (path === "/rule_fields" && request.method === "GET") {
      return json({ fields: await getRuleFields(env) });
    }

    if (!publicPaths.includes(path)) {
      const apiKey = request.headers.get("X-API-Key");
      if (!env.API_KEY || apiKey !== env.API_KEY) {
        return new Response("Unauthorized", { status: 401, headers: corsHeaders });
      }
    }

    if (path.startsWith("/evidence/") && request.method === "GET") {
      return handleEvidence(path.slice("/evidence/".length), env);
    }

    if (path === "/rules" && request.method === "GET") {
      const { results } = await env.D1_VERITAS.prepare(
        "SELECT id, rule_name, condition_json, action_text, priority, category, evidence_source, active, created_at, updated_at FROM decision_rules WHERE active = 1 ORDER BY priority DESC, category, rule_name"
      ).all<RuleRow>();
      return json({ rules: results.map(formatRule) });
    }

    if (path === "/rules" && request.method === "POST") {
      const input = validateRuleInput(await request.json<Partial<RuleInput>>(), true);
      await env.D1_VERITAS.prepare(
        `INSERT INTO decision_rules (rule_name, condition_json, action_text, priority, category, evidence_source, active, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
      )
        .bind(input.rule_name, input.condition_json, input.action_text, input.priority, input.category, input.evidence_source, input.active)
        .run();
      await writeAuditLog(env, "rule_create", { rule_name: input.rule_name });
      return json({ created: true, rule: input }, { status: 201 });
    }

    const ruleName = routeParam(path, "/rules/");
    if (ruleName && request.method === "GET") {
      const rule = await getRule(env, ruleName);
      if (!rule) return new Response("Rule not found", { status: 404, headers: corsHeaders });
      return json({ rule: formatRule(rule) });
    }

    if (ruleName && (request.method === "PUT" || request.method === "PATCH")) {
      const existing = await getRule(env, ruleName);
      if (!existing) return new Response("Rule not found", { status: 404, headers: corsHeaders });
      const input = validateRuleInput({ ...formatRule(existing), ...(await request.json<Partial<RuleInput>>()), rule_name: ruleName }, true);
      await env.D1_VERITAS.prepare(
        `UPDATE decision_rules
         SET condition_json = ?, action_text = ?, priority = ?, category = ?, evidence_source = ?, active = ?, updated_at = CURRENT_TIMESTAMP
         WHERE rule_name = ?`
      )
        .bind(input.condition_json, input.action_text, input.priority, input.category, input.evidence_source, input.active, ruleName)
        .run();
      await writeAuditLog(env, "rule_update", { rule_name: ruleName });
      return json({ updated: true, rule: input });
    }

    if (ruleName && request.method === "DELETE") {
      await env.D1_VERITAS.prepare(
        "UPDATE decision_rules SET active = 0, updated_at = CURRENT_TIMESTAMP WHERE rule_name = ?"
      ).bind(ruleName).run();
      await writeAuditLog(env, "rule_delete", { rule_name: ruleName });
      return json({ deleted: true, rule_name: ruleName });
    }

    if (path === "/logs" && request.method === "GET") {
      const limit = clampLimit(Number(url.searchParams.get("limit") || "50"));
      const { results } = await env.D1_VERITAS.prepare(
        "SELECT id, event_type, payload_json, matches_json, created_at FROM advice_log ORDER BY id DESC LIMIT ?"
      ).bind(limit).all();
      return json({ logs: results.map(parseLogRow) });
    }

    if (path === "/advise" && request.method === "POST") {
      const payload = await request.json<Record<string, unknown>>();
      const { results } = await env.D1_VERITAS.prepare(
        "SELECT rule_name, condition_json, action_text, evidence_source, priority, category FROM decision_rules WHERE active = 1 ORDER BY priority DESC, rule_name"
      ).all<RuleRow>();
      const matches = [];

      for (const row of results) {
        let condition;
        try {
          condition = JSON.parse(String(row.condition_json));
        } catch (error) {
          continue;
        }

        if (!matchesCondition(condition, payload)) continue;

        const evidenceKey = typeof row.evidence_source === "string" ? row.evidence_source : "";
        const match: Record<string, unknown> = {
          rule_name: row.rule_name,
          rule: row.rule_name,
          action_text: row.action_text,
          action: row.action_text,
          priority: row.priority,
          category: row.category,
          evidence: evidenceKey,
        };
        if (evidenceKey) match.evidence_url = `${url.origin}/evidence/${encodeEvidenceKey(evidenceKey)}`;
        matches.push(match);
      }

      const meta = {
        evaluated: results.length,
        matched: matches.length,
        ts: Date.now(),
        payload_fields: Object.keys(payload).sort(),
      };
      await writeAuditLog(env, "advise", payload, matches);
      return json({ matches, meta });
    }

    return new Response("Not found", { status: 404, headers: corsHeaders });
  },
};

function matchesCondition(condition: Record<string, unknown>, payload: Record<string, unknown>): boolean {
  if (typeof condition.field === "string" && typeof condition.op === "string") {
    return evaluateOperation(payload[condition.field], condition.op, condition.value);
  }

  return Object.entries(condition).every(([field, expr]) => {
    const val = payload[field];
    if (val === undefined) return false;
    if (expr !== null && typeof expr === "object" && !Array.isArray(expr)) {
      return Object.entries(expr as Record<string, unknown>).every(([op, target]) => evaluateOperation(val, op, target));
    }
    return normalizeValue(val) === normalizeValue(expr);
  });
}

function evaluateOperation(actualRaw: unknown, op: string, expectedRaw: unknown): boolean {
  const actual = normalizeValue(actualRaw);
  const expected = normalizeValue(expectedRaw);

  if (op === "gt" || op === ">") return isNumberPair(actual, expected) && actual > expected;
  if (op === "gte" || op === ">=") return isNumberPair(actual, expected) && actual >= expected;
  if (op === "lt" || op === "<") return isNumberPair(actual, expected) && actual < expected;
  if (op === "lte" || op === "<=") return isNumberPair(actual, expected) && actual <= expected;
  if (op === "eq" || op === "==") return actual === expected;
  if (op === "ne" || op === "!=") return actual !== expected;
  if (op === "contains") return typeof actual === "string" && actual.includes(String(expected));
  if (op === "in") return Array.isArray(expected) && expected.map(normalizeValue).includes(actual);
  if (op === "between") {
    if (!Array.isArray(expected) || expected.length !== 2) return false;
    const min = normalizeValue(expected[0]);
    const max = normalizeValue(expected[1]);
    return isNumberPair(actual, min) && isNumberPair(actual, max) && actual >= min && actual <= max;
  }
  return false;
}

function isNumberPair(a: unknown, b: unknown): a is number {
  return typeof a === "number" && typeof b === "number";
}

function normalizeValue(value: unknown): unknown {
  if (typeof value === "string") {
    if (value === "true") return true;
    if (value === "false") return false;
    if (value.trim() !== "" && !Number.isNaN(Number(value))) return Number(value);
  }
  return value;
}

async function getRuleFields(env: Env): Promise<string[]> {
  const { results } = await env.D1_VERITAS.prepare("SELECT condition_json FROM decision_rules WHERE active = 1").all();
  const fields = new Set<string>();
  for (const row of results) {
    try {
      const condition = JSON.parse(String(row.condition_json));
      if (typeof condition.field === "string") fields.add(condition.field);
      else Object.keys(condition).forEach(field => fields.add(field));
    } catch (error) {}
  }
  return Array.from(fields).sort();
}

async function getRule(env: Env, ruleName: string): Promise<RuleRow | null> {
  return env.D1_VERITAS.prepare(
    "SELECT id, rule_name, condition_json, action_text, priority, category, evidence_source, active, created_at, updated_at FROM decision_rules WHERE rule_name = ?"
  ).bind(ruleName).first<RuleRow>();
}

function validateRuleInput(input: Partial<RuleInput>, requireAll: boolean): RuleInput {
  if (!input.rule_name || typeof input.rule_name !== "string") throw new Error("rule_name is required");
  if (requireAll && !input.action_text) throw new Error("action_text is required");
  if (input.condition_json === undefined) throw new Error("condition_json is required");

  const condition = typeof input.condition_json === "string"
    ? JSON.parse(input.condition_json)
    : input.condition_json;

  return {
    rule_name: input.rule_name,
    condition_json: JSON.stringify(condition),
    action_text: String(input.action_text || ""),
    priority: Number(input.priority || 0),
    category: input.category || "general",
    evidence_source: input.evidence_source || null,
    active: input.active === 0 ? 0 : 1,
  };
}

function formatRule(rule: RuleRow): Record<string, unknown> {
  let condition: unknown = rule.condition_json;
  try {
    condition = JSON.parse(String(rule.condition_json));
  } catch (error) {}
  return {
    ...rule,
    condition_json: condition,
  };
}

function routeParam(path: string, prefix: string): string | null {
  if (!path.startsWith(prefix)) return null;
  const value = path.slice(prefix.length);
  return value ? decodeURIComponent(value) : null;
}

async function handleEvidence(encodedKey: string, env: Env): Promise<Response> {
  const key = decodeURIComponent(encodedKey);
  if (!key || key.includes("..")) {
    return new Response("Invalid evidence key", { status: 400, headers: corsHeaders });
  }

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

function encodeEvidenceKey(key: string): string {
  return key.split("/").map(encodeURIComponent).join("/");
}

async function writeAuditLog(env: Env, eventType: string, payload: unknown, matches: unknown = null): Promise<void> {
  await env.D1_VERITAS.prepare(
    "INSERT INTO advice_log (event_type, payload_json, matches_json) VALUES (?, ?, ?)"
  ).bind(eventType, JSON.stringify(payload), JSON.stringify(matches)).run();
}

function parseLogRow(row: Record<string, unknown>): Record<string, unknown> {
  return {
    ...row,
    payload_json: safeJsonParse(row.payload_json),
    matches_json: safeJsonParse(row.matches_json),
  };
}

function safeJsonParse(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch (error) {
    return value;
  }
}

function clampLimit(value: number): number {
  if (!Number.isFinite(value)) return 50;
  return Math.max(1, Math.min(250, Math.floor(value)));
}

function json(body: unknown, init: ResponseInit = {}): Response {
  return Response.json(body, {
    ...init,
    headers: {
      ...corsHeaders,
      ...(init.headers || {}),
    },
  });
}
