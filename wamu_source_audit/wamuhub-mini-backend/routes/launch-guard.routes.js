import express from "express";
import { validateRegion, expandRegions } from "../lib/regions.js";

export function aggregateRegionalResults(regionalResults) {
  const hasBlock = regionalResults.some((r) => r.status === "BLOCK");
  const hasWarn = regionalResults.some((r) => r.status === "WARN");

  const status = hasBlock ? "BLOCK" : hasWarn ? "WARN" : "PASS";

  let incident_family = "regional_ok";
  if (hasBlock) {
    incident_family = "regional_failure";
  } else if (hasWarn) {
    incident_family = "regional_degradation";
  }

  const passing = regionalResults.filter((r) => r.status === "PASS");
  const failing = regionalResults.filter((r) => r.status !== "PASS");

  let summary = "All required regions passed.";
  if (failing.length > 0) {
    const passNames = passing.map((r) => r.region).join(", ");
    const failNames = failing.map((r) => r.region).join(", ");
    summary = passNames
      ? `Checks passed in ${passNames} but failed in ${failNames}.`
      : `Checks failed in ${failNames}.`;
  }

  const evidence = regionalResults.map((r) =>
    `${r.region}: ${r.summary || `status ${r.status}`}`
  );

  const next_actions = hasBlock
    ? [
        "inspect regional edge routing",
        "verify certificate and CDN propagation in failing regions",
        "re-run all regions before release",
      ]
    : hasWarn
      ? [
          "review degraded regions",
          "compare latency and health responses across regions",
          "re-run before release",
        ]
      : ["proceed with release"];

  return {
    status,
    incident_family,
    summary,
    regions: regionalResults.map((r) => ({
      region: r.region,
      status: r.status,
    })),
    evidence,
    next_actions,
  };
}

async function defaultRunSingleRegionCheck({ url, release_id, region }) {
  throw new Error("Wire in your existing single-region probe flow here.");
}

export function createLaunchGuardRouter({
  runSingleRegionCheck = defaultRunSingleRegionCheck,
} = {}) {
  const router = express.Router();

  router.post("/run-check", async (req, res) => {
    try {
      const { url, release_id, region } = req.body || {};

      if (!url) {
        return res.status(400).json({
          error: 'Missing required field: "url"',
        });
      }

      const selectedRegion = validateRegion(region);
      const targetRegions = expandRegions(selectedRegion);

      const regionalResults = await Promise.all(
        targetRegions.map((targetRegion) =>
          runSingleRegionCheck({
            url,
            release_id,
            region: targetRegion,
          })
        )
      );

      if (targetRegions.length === 1) {
        const result = regionalResults[0];
        return res.json({
          ...result,
          regions: [{ region: result.region, status: result.status }],
        });
      }

      return res.json(aggregateRegionalResults(regionalResults));
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        error: error.message || "Internal server error",
      });
    }
  });

  return router;
}

export default createLaunchGuardRouter();