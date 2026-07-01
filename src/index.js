export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS headers for frontend access
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Optional API key authentication
    const apiKey = env.API_KEY;
    if (apiKey) {
      const authHeader = request.headers.get('Authorization');
      if (authHeader !== 'Bearer ' + apiKey) {
        return Response.json(
          { error: 'Unauthorized' },
          { status: 401, headers: corsHeaders }
        );
      }
    }

    if (url.pathname === '/advise' && request.method === 'POST') {
      return handleAdvise(request, env, corsHeaders);
    }

    if (url.pathname === '/rules' && request.method === 'GET') {
      return handleListRules(env, corsHeaders);
    }

    return Response.json(
      { status: 'ok', service: 'veritas-engine' },
      { headers: corsHeaders }
    );
  },
};

async function handleAdvise(request, env, corsHeaders) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: 'Invalid JSON body' },
      { status: 400, headers: corsHeaders }
    );
  }

  const { temperature, voltage_drop, calibration_days, humidity } = body;
  const matches = [];

  const { results } = await env.DB.prepare(
    'SELECT rule, condition, action, priority FROM decision_rules'
  ).all();

  for (const row of results) {
    if (evaluateCondition(row.condition, { temperature, voltage_drop, calibration_days, humidity })) {
      matches.push({
        rule: row.rule,
        action: row.action,
        priority: row.priority,
      });
    }
  }

  return Response.json({ matches }, { headers: corsHeaders });
}

async function handleListRules(env, corsHeaders) {
  const { results } = await env.DB.prepare(
    'SELECT rule, condition, action, priority FROM decision_rules ORDER BY id'
  ).all();

  return Response.json({ rules: results }, { headers: corsHeaders });
}

function evaluateCondition(condition, params) {
  // Parse simple conditions like "voltage_drop > 10"
  const match = condition.match(/^(\w+)\s*(>|<|>=|<=|==|!=)\s*(-?\d+(?:\.\d+)?)$/);
  if (!match) return false;

  const [, variable, operator, thresholdStr] = match;
  const value = params[variable];
  if (value === undefined || value === null) return false;

  const threshold = parseFloat(thresholdStr);

  switch (operator) {
    case '>':  return value > threshold;
    case '<':  return value < threshold;
    case '>=': return value >= threshold;
    case '<=': return value <= threshold;
    case '==': return value === threshold;
    case '!=': return value !== threshold;
    default:   return false;
  }
}
