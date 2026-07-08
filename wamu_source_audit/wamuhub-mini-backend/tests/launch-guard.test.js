import test from "node:test";
import assert from "node:assert/strict";
import express from "express";

import {
  createLaunchGuardRouter,
  aggregateRegionalResults,
} from "../routes/launch-guard.routes.js";

async function requestJson(app, method, path, body) {
  const server = app.listen(0);

  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });

    const json = await response.json();
    return { status: response.status, json };
  } finally {
    server.close();
  }
}

function buildApp(runSingleRegionCheck) {
  const app = express();
  app.use(express.json());
  app.use(createLaunchGuardRouter({ runSingleRegionCheck }));
  return app;
}

test("POST /run-check with single region returns single-region result", async () => {
  const app = buildApp(async ({ region }) => ({
    region,
    status: "PASS",
    incident_family: "regional_ok",
    summary: "all required probes passed",
    evidence: [`${region} passed`],
    next_actions: ["proceed with release"],
  }));

  const res = await requestJson(app, "POST", "/run-check", {
    url: "https://example.com",
    region: "us-east-1",
  });

  assert.equal(res.status, 200);
  assert.equal(res.json.status, "PASS");
  assert.equal(res.json.region, "us-east-1");
  assert.deepEqual(res.json.regions, [
    { region: "us-east-1", status: "PASS" },
  ]);
});

test('POST /run-check with region "all" returns regions[]', async () => {
  const app = buildApp(async ({ region }) => ({
    region,
    status: "PASS",
    summary: "all required probes passed",
  }));

  const res = await requestJson(app, "POST", "/run-check", {
    url: "https://example.com",
    region: "all",
  });

  assert.equal(res.status, 200);
  assert.equal(res.json.status, "PASS");
  assert.equal(Array.isArray(res.json.regions), true);
  assert.equal(res.json.regions.length, 3);
});

test('POST /run-check with mixed regional failure returns top-level BLOCK', async () => {
  const app = buildApp(async ({ region }) => {
    if (region === "eu-west-1") {
      return {
        region,
        status: "BLOCK",
        summary: "TLS handshake timeout",
      };
    }

    return {
      region,
      status: "PASS",
      summary: "all required probes passed",
    };
  });

  const res = await requestJson(app, "POST", "/run-check", {
    url: "https://example.com",
    region: "all",
  });

  assert.equal(res.status, 200);
  assert.equal(res.json.status, "BLOCK");
  assert.equal(res.json.incident_family, "regional_failure");
  assert.deepEqual(res.json.regions, [
    { region: "us-east-1", status: "PASS" },
    { region: "eu-west-1", status: "BLOCK" },
    { region: "ap-south-1", status: "PASS" },
  ]);
});

test("POST /run-check with invalid region returns 400", async () => {
  const app = buildApp(async ({ region }) => ({
    region,
    status: "PASS",
    summary: "all required probes passed",
  }));

  const res = await requestJson(app, "POST", "/run-check", {
    url: "https://example.com",
    region: "mars-1",
  });

  assert.equal(res.status, 400);
  assert.match(res.json.error, /Invalid region/);
});

test("aggregateRegionalResults returns BLOCK when any region blocks", () => {
  const result = aggregateRegionalResults([
    { region: "us-east-1", status: "PASS", summary: "ok" },
    { region: "eu-west-1", status: "BLOCK", summary: "TLS failed" },
    { region: "ap-south-1", status: "PASS", summary: "ok" },
  ]);

  assert.equal(result.status, "BLOCK");
  assert.equal(result.incident_family, "regional_failure");
});