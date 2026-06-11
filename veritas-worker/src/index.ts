export interface Env {
  D1_VERITAS: D1Database;
  R2_VERITAS: R2Bucket;
  API_KEY: string;
}

type Expr = Record<string, unknown>;

type EvalResult = {
  matches: boolean;
  confidence: number;
};

type Match = {
  rule_name: string;
  rule: string;
  action_text: string;
  action: string;
  priority: number;
  category: string;
  severity: string;
  domain: string;
  confidence: number;
  evidence: string;
  evidence_url?: string;
};

interface RuleRow {
  id?: number;
  rule_name: string;
  condition_json: string;
  action_text: string;
  priority: number;
  category: string | null;
  severity: string | null;
  domain: string | null;
  confidence_factors: string | null;
  evidence_source: string | null;
  active?: number;
  created_at?: string;
  updated_at?: string;
}

interface RuleInput {
  rule_name: string;
  condition_json: Expr | string;
  action_text: string;
  priority?: number;
  category?: string;
  severity?: string;
  domain?: string;
  confidence_factors?: Expr | string | null;
  evidence_source?: string | null;
  active?: number;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-API-Key",
};

const publicPaths = ["/health", "/rule_fields"];

const DOMAIN_FIELDS: Record<string, string[]> = {
  aerospace: ["altitude", "aoa", "angle_of_attack", "mach", "wing_load"],
  biomedical: ["heart_rate", "oxygen_saturation", "blood_pressure"],
  mechanical: ["vibration", "torque", "rpm", "temperature"],
  electrical: ["current", "voltage", "resistance"],
  chemical: ["pressure", "temperature", "ph", "flow_rate"],
  environmental: ["humidity", "air_quality", "wind_speed"],
  fire: ["temperature", "smoke", "flame_detected", "fire_detected"],
  nuclear: ["radiation", "coolant_temp", "neutron_flux"],
};

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
      return json({ domains: DOMAIN_FIELDS });
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
        `SELECT id, rule_name, condition_json, action_text, priority, category, severity, domain,
                confidence_factors, evidence_source, active, created_at, updated_at
         FROM decision_rules
         WHERE active = 1
         ORDER BY priority DESC, category, rule_name`
      ).all<RuleRow>();
      return json({ rules: results.map(formatRule) });
    }

    if (path === "/rules" && request.method === "POST") {
      const input = validateRuleInput(await request.json<Partial<RuleInput>>(), true);
      const contradiction = checkContradiction(JSON.parse(input.condition_json));
      if (contradiction) return new Response(`Contradictory rule: ${contradiction}`, { status: 400, headers: corsHeaders });

      await env.D1_VERITAS.prepare(
        `INSERT INTO decision_rules
         (rule_name, condition_json, action_text, priority, category, severity, domain, confidence_factors, evidence_source, active, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
      )
        .bind(
          input.rule_name,
          input.condition_json,
          input.action_text,
          input.priority,
          input.category,
          input.severity,
          input.domain,
          input.confidence_factors,
          input.evidence_source,
          input.active,
        )
        .run();
      await writeAuditLog(env, "rule_create", { rule_name: input.rule_name });
      return json({ success: true, rule: input }, { status: 201 });
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
      const contradiction = checkContradiction(JSON.parse(input.condition_json));
      if (contradiction) return new Response(`Contradictory rule: ${contradiction}`, { status: 400, headers: corsHeaders });

      await env.D1_VERITAS.prepare(
        `UPDATE decision_rules
         SET condition_json = ?, action_text = ?, priority = ?, category = ?, severity = ?, domain = ?,
             confidence_factors = ?, evidence_source = ?, active = ?, updated_at = CURRENT_TIMESTAMP
         WHERE rule_name = ?`
      )
        .bind(
          input.condition_json,
          input.action_text,
          input.priority,
          input.category,
          input.severity,
          input.domain,
          input.confidence_factors,
          input.evidence_source,
          input.active,
          ruleName,
        )
        .run();
      await writeAuditLog(env, "rule_update", { rule_name: ruleName });
      return json({ success: true, rule: input });
    }

    if (ruleName && request.method === "DELETE") {
      await env.D1_VERITAS.prepare(
        "UPDATE decision_rules SET active = 0, updated_at = CURRENT_TIMESTAMP WHERE rule_name = ?"
      ).bind(ruleName).run();
      await writeAuditLog(env, "rule_delete", { rule_name: ruleName });
      return json({ success: true, rule_name: ruleName });
    }

    if (path === "/logs" && request.method === "GET") {
      const limit = clampLimit(Number(url.searchParams.get("limit") || "50"));
      const { results } = await env.D1_VERITAS.prepare(
        "SELECT id, ts, payload, matches, entropy, risk_index, inferred_domain, event_type FROM advice_log ORDER BY id DESC LIMIT ?"
      ).bind(limit).all();
      return json({ logs: results.map(parseLogRow) });
    }

    if (path === "/advise" && request.method === "POST") {
      const payload = await request.json<Record<string, unknown>>();
      const inferredDomain = inferDomain(payload);

      const { results } = await env.D1_VERITAS.prepare(
        `SELECT rule_name, condition_json, action_text, evidence_source, priority, category, severity, domain, confidence_factors
         FROM decision_rules
         WHERE active = 1`
      ).all<RuleRow>();

      const matches: Match[] = [];
      for (const rule of results) {
        let condition: Expr;
        try {
          condition = JSON.parse(String(rule.condition_json));
        } catch (error) {
          continue;
        }

        const result = evaluateCondition(condition, payload);
        if (!result.matches) continue;

        const evidenceKey = typeof rule.evidence_source === "string" ? rule.evidence_source : "";
        const match: Match = {
          rule_name: rule.rule_name,
          rule: rule.rule_name,
          action_text: rule.action_text,
          action: rule.action_text,
          priority: Number(rule.priority || 0),
          category: rule.category || "general",
          severity: normalizeSeverity(rule.severity),
          domain: rule.domain || inferredDomain,
          confidence: roundConfidence(result.confidence),
          evidence: evidenceKey,
        };
        if (evidenceKey) match.evidence_url = `${url.origin}/evidence/${encodeEvidenceKey(evidenceKey)}`;
        matches.push(match);
      }

      matches.sort((a, b) => {
        const sevDiff = severityRank(b.severity) - severityRank(a.severity);
        if (sevDiff !== 0) return sevDiff;
        if (a.priority !== b.priority) return b.priority - a.priority;
        return b.confidence - a.confidence;
      });

      const entropy = computeEntropy(matches);
      const riskIndex = computeRiskIndex(matches);
      const ts = Date.now();
      const meta = {
        evaluated: results.length,
        matched: matches.length,
        entropy,
        risk_index: riskIndex,
        inferred_domain: inferredDomain,
        payload_fields: Object.keys(payload).sort(),
        ts,
      };

      await env.D1_VERITAS.prepare(
        "INSERT INTO advice_log (ts, payload, matches, entropy, risk_index, inferred_domain, event_type) VALUES (?, ?, ?, ?, ?, ?, ?)"
      )
        .bind(
          ts,
          JSON.stringify(payload),
          JSON.stringify(matches.map(m => ({ rule: m.rule_name, confidence: m.confidence }))),
          entropy,
          riskIndex,
          inferredDomain,
          "advise",
        )
        .run();

      return json({ matches, meta });
    }

    return new Response("Not found", { status: 404, headers: corsHeaders });
  },
};

function evalOp(op: string, val: unknown, target: unknown): EvalResult {
  const actual = normalizeValue(val);
  const expected = normalizeValue(target);

  if ((op === "gt" || op === ">") && isNumberPair(actual, expected)) {
    const match = actual > expected;
    return { matches: match, confidence: match ? Math.min(1, (actual - expected) / denominator(expected)) : 0 };
  }
  if ((op === "gte" || op === ">=") && isNumberPair(actual, expected)) {
    const match = actual >= expected;
    return { matches: match, confidence: match ? Math.min(1, (actual - expected + 0.01) / denominator(expected)) : 0 };
  }
  if ((op === "lt" || op === "<") && isNumberPair(actual, expected)) {
    const match = actual < expected;
    return { matches: match, confidence: match ? Math.min(1, (expected - actual) / denominator(expected)) : 0 };
  }
  if ((op === "lte" || op === "<=") && isNumberPair(actual, expected)) {
    const match = actual <= expected;
    return { matches: match, confidence: match ? Math.min(1, (expected - actual + 0.01) / denominator(expected)) : 0 };
  }
  if (op === "eq" || op === "==") {
    const match = actual === expected;
    return { matches: match, confidence: match ? 1 : 0 };
  }
  if (op === "ne" || op === "!=") {
    const match = actual !== expected;
    return { matches: match, confidence: match ? 0.9 : 0 };
  }
  if (op === "contains") {
    const match = typeof actual === "string" && actual.includes(String(expected));
    return { matches: match, confidence: match ? 0.85 : 0 };
  }
  return { matches: false, confidence: 0 };
}

function evalBetween(val: unknown, lowRaw: unknown, highRaw: unknown): EvalResult {
  const actual = normalizeValue(val);
  const low = normalizeValue(lowRaw);
  const high = normalizeValue(highRaw);
  if (!isNumberPair(actual, low) || !isNumberPair(actual, high)) return { matches: false, confidence: 0 };
  const matches = actual >= low && actual <= high;
  if (!matches) return { matches, confidence: 0 };
  const mid = (low + high) / 2;
  const range = Math.max((high - low) / 2, 1e-9);
  return { matches, confidence: Math.max(0, 1 - Math.abs(actual - mid) / range) };
}

function evalIn(val: unknown, set: unknown[]): EvalResult {
  const actual = normalizeValue(val);
  const matches = set.map(normalizeValue).includes(actual);
  return { matches, confidence: matches ? 0.95 : 0 };
}

function evaluateCondition(condition: Expr, payload: Record<string, unknown>): EvalResult {
  const confidences: number[] = [];

  if (typeof condition.field === "string" && typeof condition.op === "string") {
    return evaluateCondition({ [condition.field]: { [condition.op]: condition.value } }, payload);
  }

  for (const [field, expr] of Object.entries(condition)) {
    if (field === "all" && Array.isArray(expr)) {
      for (const sub of expr) {
        const result = evaluateCondition(sub as Expr, payload);
        if (!result.matches) return { matches: false, confidence: 0 };
        confidences.push(result.confidence);
      }
      continue;
    }

    if (field === "any" && Array.isArray(expr)) {
      let anyMatch = false;
      let maxConfidence = 0;
      for (const sub of expr) {
        const result = evaluateCondition(sub as Expr, payload);
        if (result.matches) {
          anyMatch = true;
          maxConfidence = Math.max(maxConfidence, result.confidence);
        }
      }
      if (!anyMatch) return { matches: false, confidence: 0 };
      confidences.push(maxConfidence);
      continue;
    }

    const payloadVal = payload[field];
    if (payloadVal === undefined) return { matches: false, confidence: 0 };

    if (expr !== null && typeof expr === "object" && !Array.isArray(expr)) {
      for (const [op, target] of Object.entries(expr as Expr)) {
        let result: EvalResult;
        if (op === "between" && Array.isArray(target) && target.length === 2) {
          result = evalBetween(payloadVal, target[0], target[1]);
        } else if (op === "in" && Array.isArray(target)) {
          result = evalIn(payloadVal, target);
        } else {
          result = evalOp(op, payloadVal, target);
        }
        if (!result.matches) return { matches: false, confidence: 0 };
        confidences.push(result.confidence);
      }
    } else {
      const matches = normalizeValue(payloadVal) === normalizeValue(expr);
      if (!matches) return { matches: false, confidence: 0 };
      confidences.push(1);
    }
  }

  const confidence = confidences.length
    ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length
    : 1;
  return { matches: true, confidence };
}

function inferDomain(payload: Record<string, unknown>): string {
  const present = Object.keys(payload);
  for (const [domain, fields] of Object.entries(DOMAIN_FIELDS)) {
    if (fields.some(field => present.includes(field))) return domain;
  }
  return "general";
}

function computeEntropy(matches: Match[]): number {
  if (matches.length === 0) return 0;
  const severityCounts: Record<string, number> = { CRITICAL: 0, WARNING: 0, INFO: 0 };
  for (const match of matches) {
    severityCounts[normalizeSeverity(match.severity)] += 1;
  }
  let entropy = 0;
  for (const count of Object.values(severityCounts)) {
    const p = count / matches.length;
    if (p > 0) entropy -= p * Math.log2(p);
  }
  return roundMetric(entropy);
}

function computeRiskIndex(matches: Match[]): number {
  if (matches.length === 0) return 0;
  const totalRisk = matches.reduce((sum, match) => {
    const weight = match.severity === "CRITICAL" ? 1 : match.severity === "WARNING" ? 0.5 : 0.2;
    return sum + (match.priority / 100) * weight * match.confidence;
  }, 0);
  return roundMetric(Math.min(1, totalRisk / matches.length));
}

async function getRule(env: Env, ruleName: string): Promise<RuleRow | null> {
  return env.D1_VERITAS.prepare(
    `SELECT id, rule_name, condition_json, action_text, priority, category, severity, domain,
            confidence_factors, evidence_source, active, created_at, updated_at
     FROM decision_rules
     WHERE rule_name = ?`
  ).bind(ruleName).first<RuleRow>();
}

function validateRuleInput(input: Partial<RuleInput>, requireAll: boolean): RuleInput {
  if (!input.rule_name || typeof input.rule_name !== "string") throw new Error("rule_name is required");
  if (requireAll && !input.action_text) throw new Error("action_text is required");
  if (input.condition_json === undefined) throw new Error("condition_json is required");

  const condition = typeof input.condition_json === "string"
    ? JSON.parse(input.condition_json)
    : input.condition_json;
  const confidenceFactors = input.confidence_factors
    ? typeof input.confidence_factors === "string" ? JSON.parse(input.confidence_factors) : input.confidence_factors
    : null;

  return {
    rule_name: input.rule_name,
    condition_json: JSON.stringify(condition),
    action_text: String(input.action_text || ""),
    priority: Number(input.priority || 0),
    category: input.category || "general",
    severity: normalizeSeverity(input.severity),
    domain: input.domain || null,
    confidence_factors: confidenceFactors ? JSON.stringify(confidenceFactors) : null,
    evidence_source: input.evidence_source || null,
    active: input.active === 0 ? 0 : 1,
  };
}

function checkContradiction(condition: Expr): string | null {
  if (Array.isArray(condition.all)) {
    for (const sub of condition.all) {
      const contradiction = checkContradiction(sub as Expr);
      if (contradiction) return contradiction;
    }
  }
  if (Array.isArray(condition.any)) return null;

  for (const [field, expr] of Object.entries(condition)) {
    if (field === "all" || field === "any") continue;
    if (!expr || typeof expr !== "object" || Array.isArray(expr)) continue;
    const spec = expr as Record<string, unknown>;
    const gt = numberSpec(spec.gt ?? spec[">"]);
    const gte = numberSpec(spec.gte ?? spec[">="]);
    const lt = numberSpec(spec.lt ?? spec["<"]);
    const lte = numberSpec(spec.lte ?? spec["<="]);
    const lower = gt ?? gte;
    const upper = lt ?? lte;
    if (lower !== null && upper !== null && lower >= upper) return `${field} lower bound >= upper bound`;
    if (Array.isArray(spec.between) && spec.between.length === 2) {
      const low = numberSpec(spec.between[0]);
      const high = numberSpec(spec.between[1]);
      if (low === null || high === null || low > high) return `${field} has invalid between range`;
    }
    if (Array.isArray(spec.in) && spec.in.length === 0) return `${field} has empty in set`;
  }
  return null;
}

function numberSpec(value: unknown): number | null {
  const normalized = normalizeValue(value);
  return typeof normalized === "number" ? normalized : null;
}

function formatRule(rule: RuleRow): Record<string, unknown> {
  return {
    ...rule,
    condition_json: safeJsonParse(rule.condition_json),
    confidence_factors: safeJsonParse(rule.confidence_factors),
    severity: normalizeSeverity(rule.severity),
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
  if (!object) return new Response("Not found", { status: 404, headers: corsHeaders });
  const headers = new Headers(corsHeaders);
  headers.set("Content-Type", object.httpMetadata?.contentType || "application/octet-stream");
  headers.set("Cache-Control", "public, max-age=3600");
  return new Response(object.body, { headers });
}

function encodeEvidenceKey(key: string): string {
  return key.split("/").map(encodeURIComponent).join("/");
}

async function writeAuditLog(env: Env, eventType: string, payload: unknown, matches: unknown = null): Promise<void> {
  await env.D1_VERITAS.prepare(
    "INSERT INTO advice_log (ts, payload, matches, entropy, risk_index, inferred_domain, event_type) VALUES (?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(Date.now(), JSON.stringify(payload), JSON.stringify(matches), null, null, null, eventType)
    .run();
}

function parseLogRow(row: Record<string, unknown>): Record<string, unknown> {
  return {
    ...row,
    payload: safeJsonParse(row.payload),
    matches: safeJsonParse(row.matches),
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

function normalizeValue(value: unknown): unknown {
  if (typeof value === "string") {
    if (value === "true") return true;
    if (value === "false") return false;
    if (value.trim() !== "" && !Number.isNaN(Number(value))) return Number(value);
  }
  return value;
}

function normalizeSeverity(value: unknown): string {
  const normalized = String(value || "WARNING").toUpperCase();
  return ["CRITICAL", "WARNING", "INFO"].includes(normalized) ? normalized : "WARNING";
}

function severityRank(severity: string): number {
  if (severity === "CRITICAL") return 3;
  if (severity === "WARNING") return 2;
  if (severity === "INFO") return 1;
  return 0;
}

function isNumberPair(a: unknown, b: unknown): a is number {
  return typeof a === "number" && typeof b === "number";
}

function denominator(target: number): number {
  return Math.max(Math.abs(target * 2), 1);
}

function roundConfidence(value: number): number {
  return Math.max(0, Math.min(1, Math.round(value * 1000) / 1000));
}

function roundMetric(value: number): number {
  return Math.round(value * 1000) / 1000;
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
