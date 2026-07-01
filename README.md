# Veritas Decision Engine

A Cloudflare Worker + D1 advisory system that evaluates sensor readings against configurable decision rules.

## Architecture

- **Worker** (`src/index.js`) — HTTP API deployed on Cloudflare Workers
- **D1 Database** (`veritas_kb`) — SQLite-based rules store
- **Frontend** (`public/`) — Static UI deployed on Cloudflare Pages

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Create the D1 database

```bash
npm run db:create
```

Copy the `database_id` from the output into `wrangler.toml`.

### 3. Initialize the schema and seed rules

```bash
npm run db:schema
npm run db:seed
```

For local development:

```bash
npm run db:schema:local
npm run db:seed:local
```

### 4. Run locally

```bash
npm run dev
```

### 5. Test the API

```bash
curl -X POST http://localhost:8787/advise \
  -H "Content-Type: application/json" \
  -d '{"temperature": 90, "voltage_drop": 20, "calibration_days": 400}'
```

Expected response:

```json
{
  "matches": [
    { "rule": "Power fluctuation", "action": "Switch to backup power and test regulator.", "priority": "high" },
    { "rule": "Expired calibration", "action": "Redo calibration immediately; flag as non-compliant.", "priority": "high" }
  ]
}
```

### 6. Deploy

```bash
npm run deploy
```

### 7. (Optional) Set API key

```bash
npx wrangler secret put API_KEY
```

### 8. Deploy frontend

```bash
npm run deploy:pages
```

## Endpoints

| Method | Path     | Description                        |
|--------|----------|------------------------------------|
| POST   | `/advise`| Evaluate readings against rules    |
| GET    | `/rules` | List all decision rules            |
| GET    | `/`      | Health check                       |

## Decision Rules

Rules are stored in D1 and consist of:

| Field     | Description                          |
|-----------|--------------------------------------|
| rule      | Human-readable rule name             |
| condition | Expression like `voltage_drop > 10`  |
| action    | Recommended action text              |
| priority  | `low` or `high`                      |

Seed rules (from `sql/more_rules.sql`):

| Rule                | Condition              | Priority |
|---------------------|------------------------|----------|
| Low humidity        | `humidity < 30`        | low      |
| Power fluctuation   | `voltage_drop > 10`    | high     |
| Expired calibration | `calibration_days > 365`| high    |
