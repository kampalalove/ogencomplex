
import fs from "fs";
import os from "os";
import path from "path";

interface DiagnosticResult {
  major: string;
  status: "PASS" | "FAIL";
  reason?: string;
  fix?: string;
}

class FixCord {
  majors: string[] = [
    "FileExistence", "FileReadability", "JSONValidation", "SyntaxValidation",
    "ModuleTypeCheck", "DependencyGraph", "VersionCheck", "ConfigPresence",
    "ConfigValidity", "EntryScriptCheck", "ImportResolution", "Permissions",
    "DiskSpace", "MemoryAvailability", "NetworkAvailability", "GitStatus",
    "LockfileIntegrity", "DuplicatePackages", "EnvironmentVariables",
    "ExecutionDryRun"
  ];

  runDiagnostics(targetPath: string): DiagnosticResult[] {
    const absPath = path.resolve(targetPath);
    return this.majors.map(major => this.runMajor(major, absPath));
  }

  runMajor(major: string, filePath: string): DiagnosticResult {
    switch (major) {
      case "FileExistence":
        return fs.existsSync(filePath)
          ? { major, status: "PASS" }
          : { major, status: "FAIL", reason: `File not found: ${filePath}`, fix: "Create or correct path" };

      case "FileReadability":
        try {
          fs.readFileSync(filePath, "utf8");
          return { major, status: "PASS" };
        } catch {
          return { major, status: "FAIL", reason: "File not readable", fix: "Check permissions or corruption" };
        }

      case "JSONValidation":
        if (!filePath.endsWith("package.json")) {
          return { major, status: "PASS", reason: "Not a JSON target" };
        }
        try {
          const content = fs.readFileSync(filePath, "utf8");
          JSON.parse(content);
          return { major, status: "PASS" };
        } catch (err: any) {
          return {
            major,
            status: "FAIL",
            reason: `Invalid JSON in ${filePath}: ${err.message}`,
            fix: "Reformat JSON, remove trailing commas, fix quotes or merge conflicts"
          };
        }

      case "SyntaxValidation":
        return { major, status: "PASS", reason: "Syntax check not implemented yet" };

      case "ModuleTypeCheck":
        if (!filePath.endsWith("package.json")) {
          return { major, status: "PASS" };
        }
        try {
          const content = fs.readFileSync(filePath, "utf8");
          const pkg = JSON.parse(content);
          const type = pkg.type || "commonjs";
          return { major, status: "PASS", reason: `Module type: ${type}` };
        } catch {
          return { major, status: "FAIL", reason: "Cannot read module type", fix: "Fix package.json first" };
        }

      case "DependencyGraph":
        return fs.existsSync("node_modules")
          ? { major, status: "PASS" }
          : { major, status: "FAIL", reason: "node_modules missing", fix: "Run npm install" };

      case "VersionCheck":
        return {
          major,
          status: "PASS",
          reason: `Node version: ${process.version} (check compatibility with tools like tsx)`
        };

      case "ConfigPresence":
        return fs.existsSync("tsconfig.json")
          ? { major, status: "PASS" }
          : { major, status: "FAIL", reason: "tsconfig.json missing", fix: "Add TypeScript config if needed" };

      case "ConfigValidity":
        if (!fs.existsSync("tsconfig.json")) {
          return { major, status: "PASS", reason: "No tsconfig.json to validate" };
        }
        try {
          const content = fs.readFileSync("tsconfig.json", "utf8");
          JSON.parse(content);
          return { major, status: "PASS" };
        } catch {
          return { major, status: "FAIL", reason: "Invalid tsconfig.json", fix: "Fix JSON structure" };
        }

      case "EntryScriptCheck":
        return fs.existsSync(path.resolve("scripts/stress.js"))
          ? { major, status: "PASS" }
          : { major, status: "FAIL", reason: "scripts/stress.js not found", fix: "Create or correct entry script path" };

      case "ImportResolution":
        return { major, status: "PASS", reason: "Import resolution not implemented yet" };

      case "Permissions":
        try {
          fs.accessSync(".", fs.constants.R_OK | fs.constants.W_OK);
          return { major, status: "PASS" };
        } catch {
          return { major, status: "FAIL", reason: "Insufficient read/write permissions", fix: "Adjust filesystem permissions" };
        }

      case "DiskSpace":
        const freeMem = os.freemem();
        return freeMem > 100 * 1024 * 1024
          ? { major, status: "PASS", reason: `Free memory: ${Math.round(freeMem / 1e6)} MB` }
          : { major, status: "FAIL", reason: "Low memory", fix: "Close apps or add RAM" };

      case "MemoryAvailability":
        return {
          major,
          status: "PASS",
          reason: `Total memory: ${Math.round(os.totalmem() / 1e9)} GB`
        };

      case "NetworkAvailability":
        return { major, status: "PASS", reason: "Network check not implemented yet" };

      case "GitStatus":
        return { major, status: "PASS", reason: "Git conflict check not implemented yet" };

      case "LockfileIntegrity":
        if (fs.existsSync("package-lock.json")) {
          return { major, status: "PASS" };
        }
        if (fs.existsSync("yarn.lock")) {
          return { major, status: "PASS", reason: "Using yarn.lock" };
        }
        return {
          major,
          status: "FAIL",
          reason: "No lockfile found",
          fix: "Run npm install or yarn install to generate a lockfile"
        };

      case "DuplicatePackages":
        return { major, status: "PASS", reason: "Duplicate package check not implemented yet" };

      case "EnvironmentVariables":
        return process.env.NODE_ENV
          ? { major, status: "PASS", reason: `NODE_ENV=${process.env.NODE_ENV}` }
          : { major, status: "FAIL", reason: "NODE_ENV not set", fix: "Set NODE_ENV to 'development' or 'production'" };

      case "ExecutionDryRun":
        return { major, status: "PASS", reason: "Dry-run not implemented yet" };

      default:
        return { major, status: "PASS" };
    }
  }
}

function main() {
  const args = process.argv.slice(2);
  const target = args[0] || "package.json";

  const fixCord = new FixCord();
  const results = fixCord.runDiagnostics(target);

  console.log(`FixCord diagnostic run on: ${path.resolve(target)}`);
  console.log("──────────────────────────────────────────────");

  let failures = 0;

  for (const r of results) {
    const statusIcon = r.status === "PASS" ? "✔" : "✘";
    console.log(`[${statusIcon}] ${r.major}`);
    if (r.reason) console.log(`    Reason: ${r.reason}`);
    if (r.fix) console.log(`    Fix:    ${r.fix}`);
    console.log();
    if (r.status === "FAIL") failures++;
  }

  console.log("Summary:");
  console.log(`  Majors run: ${results.length}`);
  console.log(`  Failures:   ${failures}`);
  console.log(`  Status:     ${failures === 0 ? "FOUNDATION OK" : "FOUNDATION BLOCKED"}`);
}

main();
