#!/usr/bin/env node
import fs from "fs";
import os from "os";
import path from "path";
import child_process from "child_process";

type CheckResult = { status: "PASS" | "FAIL"; reason?: string; fix?: string };

function runDiagnostics(targetPath: string) {
  const absPath = path.resolve(targetPath);
  const results: CheckResult[] = [];

  const checks: ((p: string) => CheckResult)[] = [
    checkExists,
    checkReadable,
    checkWritable,
    checkParentDir,
    checkNonEmpty,
    checkExtension,
    checkNoBOM,
    checkLineEndings,
    checkNoTrailingWhitespace,
    checkNotSymlink,
    checkJsonValid,
    checkPkgName,
    checkPkgVersion,
    checkPkgScriptsTest,
    checkPkgScriptsBuild,
    checkPkgMainExists,
    checkPkgDeps,
    checkPkgVersionRanges,
    checkPkgEngines,
    checkPkgPrivate,
    checkNodeModulesExists,
    checkExtraneousPackages,
    checkOutdatedDeps,
    checkAudit,
    checkLockfileExists,
    checkLockfileSync,
    checkNoSecrets,
    checkEnvFileIgnored,
    checkNoEval,
    checkNoExecInjection,
    checkHelmet,
    checkFileSize,
    checkNoSyncIO,
    checkMemoryUsage,
    checkNoInfiniteLoops,
    checkTestsDir,
    checkTestFiles,
    checkTestFramework,
    checkTestsPass,
    checkReadme,
    checkReadmeUsage,
    checkLicense,
    checkChangelog,
    checkGitDir,
    checkGitignore,
    checkNoLargeFiles,
    checkBranch,
    checkNoUncommitted,
    checkNodeVersion,
    checkNodeEnv,
  ];

  for (const check of checks) {
    results.push(check(absPath));
  }

  // Output summary
  let failures = results.filter((r) => r.status === "FAIL").length;
  console.log(`Diagnostic run on: ${absPath}`);
  console.log("──────────────────────────────────────────────");
  results.forEach((r, idx) => {
    const icon = r.status === "PASS" ? "✔" : "✘";
    console.log(`[${icon}] Check ${idx + 1}`);
    if (r.reason) console.log(`    Reason: ${r.reason}`);
    if (r.fix) console.log(`    Fix:    ${r.fix}`);
  });
  console.log("\nSummary:");
  console.log(`  Checks run: ${results.length}`);
  console.log(`  Failures:   ${failures}`);
  console.log(`  Status:     ${failures === 0 ? "FOUNDATION OK" : "FOUNDATION BLOCKED"}`);
}

// ============================================================================
//  1–10: File System
// ============================================================================
function checkExists(p: string): CheckResult {
  try {
    fs.accessSync(p, fs.constants.F_OK);
    return { status: "PASS" };
  } catch {
    return { status: "FAIL", reason: "File not found", fix: "Create the file or correct the path" };
  }
}

function checkReadable(p: string): CheckResult {
  try {
    fs.accessSync(p, fs.constants.R_OK);
    return { status: "PASS" };
  } catch {
    return { status: "FAIL", reason: "File not readable", fix: "Adjust permissions (chmod +r)" };
  }
}

function checkWritable(p: string): CheckResult {
  try {
    fs.accessSync(p, fs.constants.W_OK);
    return { status: "PASS" };
  } catch {
    return { status: "FAIL", reason: "File not writable", fix: "Adjust permissions (chmod +w)" };
  }
}

function checkParentDir(p: string): CheckResult {
  const dir = path.dirname(p);
  try {
    fs.accessSync(dir, fs.constants.F_OK);
    return { status: "PASS" };
  } catch {
    return { status: "FAIL", reason: "Parent directory missing", fix: "Create parent directories" };
  }
}

function checkNonEmpty(p: string): CheckResult {
  try {
    const stats = fs.statSync(p);
    if (stats.size === 0)
      return { status: "FAIL", reason: "File is empty", fix: "Populate with valid content" };
    return { status: "PASS" };
  } catch {
    return { status: "PASS" };
  }
}

function checkExtension(p: string): CheckResult {
  if (path.extname(p) !== ".json") {
    return { status: "FAIL", reason: "File extension is not .json", fix: "Rename to .json" };
  }
  return { status: "PASS" };
}

function checkNoBOM(p: string): CheckResult {
  try {
    const buf = fs.readFileSync(p);
    if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
      return { status: "FAIL", reason: "UTF-8 BOM present", fix: "Strip BOM (e.g., with `sed` or editors)" };
    }
    return { status: "PASS" };
  } catch {
    return { status: "PASS" };
  }
}

function checkLineEndings(p: string): CheckResult {
  try {
    const content = fs.readFileSync(p, "utf8");
    if (content.includes("\r\n")) {
      return { status: "FAIL", reason: "CRLF line endings", fix: "Convert to LF (dos2unix)" };
    }
    return { status: "PASS" };
  } catch {
    return { status: "PASS" };
  }
}

function checkNoTrailingWhitespace(p: string): CheckResult {
  try {
    const content = fs.readFileSync(p, "utf8");
    if (/\s+$/m.test(content)) {
      return { status: "FAIL", reason: "Trailing whitespace found", fix: "Trim lines (editor/lint)" };
    }
    return { status: "PASS" };
  } catch {
    return { status: "PASS" };
  }
}

function checkNotSymlink(p: string): CheckResult {
  try {
    const stats = fs.lstatSync(p);
    if (stats.isSymbolicLink()) {
      return { status: "FAIL", reason: "File is a symlink", fix: "Resolve or remove symlink" };
    }
    return { status: "PASS" };
  } catch {
    return { status: "PASS" };
  }
}

// ============================================================================
// 11–20: package.json fields
// ============================================================================
function checkJsonValid(p: string): CheckResult {
  try {
    JSON.parse(fs.readFileSync(p, "utf8"));
    return { status: "PASS" };
  } catch {
    return { status: "FAIL", reason: "Invalid JSON", fix: "Fix JSON syntax" };
  }
}

function checkPkgName(p: string): CheckResult {
  try {
    const json = JSON.parse(fs.readFileSync(p, "utf8"));
    if (!json.name || json.name.trim() === "") {
      return { status: "FAIL", reason: "Missing or empty 'name' field", fix: "Add a name" };
    }
    return { status: "PASS" };
  } catch {
    return { status: "PASS" };
  }
}

function checkPkgVersion(p: string): CheckResult {
  try {
    const json = JSON.parse(fs.readFileSync(p, "utf8"));
    if (!json.version || !/^\d+\.\d+\.\d+/.test(json.version)) {
      return { status: "FAIL", reason: "Invalid or missing version (semver required)", fix: "Set version to x.y.z" };
    }
    return { status: "PASS" };
  } catch {
    return { status: "PASS" };
  }
}

function checkPkgScriptsTest(p: string): CheckResult {
  try {
    const json = JSON.parse(fs.readFileSync(p, "utf8"));
    if (!json.scripts || !json.scripts.test) {
      return { status: "FAIL", reason: "No 'test' script defined", fix: "Add \"test\": \"...\"" };
    }
    return { status: "PASS" };
  } catch {
    return { status: "PASS" };
  }
}

function checkPkgScriptsBuild(p: string): CheckResult {
  try {
    const json = JSON.parse(fs.readFileSync(p, "utf8"));
    if (!json.scripts || !json.scripts.build) {
      return { status: "FAIL", reason: "No 'build' script defined", fix: "Add \"build\": \"...\"" };
    }
    return { status: "PASS" };
  } catch {
    return { status: "PASS" };
  }
}

function checkPkgMainExists(p: string): CheckResult {
  try {
    const json = JSON.parse(fs.readFileSync(p, "utf8"));
    const main = json.main || json.exports || "index.js";
    const mainPath = path.resolve(path.dirname(p), main);
    if (!fs.existsSync(mainPath)) {
      return { status: "FAIL", reason: `Entry point "${main}" not found`, fix: "Update main/exports path" };
    }
    return { status: "PASS" };
  } catch {
    return { status: "PASS" };
  }
}

function checkPkgDeps(p: string): CheckResult {
  try {
    const json = JSON.parse(fs.readFileSync(p, "utf8"));
    const deps = json.dependencies || {};
    const devDeps = json.devDependencies || {};
    if (Object.keys(deps).length === 0 && Object.keys(devDeps).length === 0) {
      return { status: "FAIL", reason: "No dependencies or devDependencies", fix: "Add dependencies if needed" };
    }
    return { status: "PASS" };
  } catch {
    return { status: "PASS" };
  }
}

function checkPkgVersionRanges(p: string): CheckResult {
  try {
    const json = JSON.parse(fs.readFileSync(p, "utf8"));
    const allDeps = { ...json.dependencies, ...json.devDependencies };
    for (const [name, range] of Object.entries(allDeps)) {
      if (range === "*" || range === "latest" || range === "x.x.x") {
        return { status: "FAIL", reason: `Overly permissive version for "${name}": ${range}`, fix: "Pin to ^ or ~" };
      }
    }
    return { status: "PASS" };
  } catch {
    return { status: "PASS" };
  }
}

function checkPkgEngines(p: string): CheckResult {
  try {
    const json = JSON.parse(fs.readFileSync(p, "utf8"));
    if (!json.engines || !json.engines.node) {
      return { status: "FAIL", reason: "No 'engines.node' specified", fix: 'Add "engines": { "node": ">=16" }' };
    }
    return { status: "PASS" };
  } catch {
    return { status: "PASS" };
  }
}

function checkPkgPrivate(p: string): CheckResult {
  try {
    const json = JSON.parse(fs.readFileSync(p, "utf8"));
    const isApp = !!json.scripts && !!json.scripts.start;
    if (isApp && json.private !== true) {
      return { status: "FAIL", reason: "Application package should be private", fix: 'Set "private": true' };
    }
    if (!isApp && json.private === true) {
      return { status: "FAIL", reason: "Library package should not be private", fix: 'Remove "private" or set false' };
    }
    return { status: "PASS" };
  } catch {
    return { status: "PASS" };
  }
}

// ============================================================================
// 21–26: Dependency Health
// ============================================================================
function checkNodeModulesExists(p: string): CheckResult {
  const root = path.dirname(p);
  const nm = path.join(root, "node_modules");
  if (!fs.existsSync(nm)) {
    return { status: "FAIL", reason: "node_modules not found", fix: "Run npm install" };
  }
  return { status: "PASS" };
}

function checkExtraneousPackages(p: string): CheckResult {
  try {
    const root = path.dirname(p);
    const result = child_process.execSync("npm ls --depth=0 --json", { cwd: root, encoding: "utf8" });
    const data = JSON.parse(result);
    if (data.problems && data.problems.some((p: string) => p.includes("extraneous"))) {
      return { status: "FAIL", reason: "Extraneous packages detected", fix: "Run npm prune" };
    }
    return { status: "PASS" };
  } catch {
    return { status: "PASS" };
  }
}

function checkOutdatedDeps(p: string): CheckResult {
  try {
    const root = path.dirname(p);
    const result = child_process.execSync("npm outdated --json", { cwd: root, encoding: "utf8" });
    const outdated = JSON.parse(result);
    if (Object.keys(outdated).length > 0) {
      return { status: "FAIL", reason: "Outdated dependencies found", fix: "Run npm update" };
    }
    return { status: "PASS" };
  } catch (e: any) {
    if (e.stdout) {
      try {
        const outdated = JSON.parse(e.stdout);
        if (Object.keys(outdated).length > 0) {
          return { status: "FAIL", reason: "Outdated dependencies found", fix: "Run npm update" };
        }
      } catch {
        // ignore
      }
    }
    return { status: "PASS" };
  }
}

function checkAudit(p: string): CheckResult {
  try {
    const root = path.dirname(p);
    const result = child_process.execSync("npm audit --json", { cwd: root, encoding: "utf8" });
    const data = JSON.parse(result);
    if (data.metadata && data.metadata.vulnerabilities && data.metadata.vulnerabilities.total > 0) {
      return { status: "FAIL", reason: "Vulnerabilities found", fix: "Run npm audit fix" };
    }
    return { status: "PASS" };
  } catch (e: any) {
    if (e.stdout) {
      try {
        const data = JSON.parse(e.stdout);
        if (data.metadata && data.metadata.vulnerabilities && data.metadata.vulnerabilities.total > 0) {
          return { status: "FAIL", reason: "Vulnerabilities found", fix: "Run npm audit fix" };
        }
      } catch {
        // ignore
      }
    }
    return { status: "PASS" };
  }
}

function checkLockfileExists(p: string): CheckResult {
  const root = path.dirname(p);
  const lockFiles = ["package-lock.json", "yarn.lock", "pnpm-lock.yaml"];
  for (const lf of lockFiles) {
    if (fs.existsSync(path.join(root, lf))) {
      return { status: "PASS" };
    }
  }
  return { status: "FAIL", reason: "No lockfile found", fix: "Generate one (npm install)" };
}

function checkLockfileSync(p: string): CheckResult {
  const root = path.dirname(p);
  try {
    const result = child_process.execSync("npm install --dry-run --json", { cwd: root, encoding: "utf8" });
    const data = JSON.parse(result);
    if (data.added && data.added.length > 0) {
      return { status: "FAIL", reason: "Lockfile out of sync with package.json", fix: "Run npm install" };
    }
    return { status: "PASS" };
  } catch {
    return { status: "PASS" };
  }
}

// ============================================================================
// 27–32: Security
// ============================================================================
function checkNoSecrets(p: string): CheckResult {
  try {
    const content = fs.readFileSync(p, "utf8");
    const patterns = [/password\s*[:=]\s*['"][^'"]+['"]/i, /secret\s*[:=]\s*['"][^'"]+['"]/i, /api[_-]?key\s*[:=]\s*['"][^'"]+['"]/i];
    for (const pat of patterns) {
      if (pat.test(content)) {
        return { status: "FAIL", reason: "Potential secret exposed in file", fix: "Use environment variables" };
      }
    }
    return { status: "PASS" };
  } catch {
    return { status: "PASS" };
  }
}

function checkEnvFileIgnored(p: string): CheckResult {
  const root = path.dirname(p);
  const gitignore = path.join(root, ".gitignore");
  if (!fs.existsSync(gitignore)) {
    return { status: "FAIL", reason: ".gitignore missing", fix: "Create .gitignore" };
  }
  const content = fs.readFileSync(gitignore, "utf8");
  if (!/\.env/.test(content)) {
    return { status: "FAIL", reason: ".env not in .gitignore", fix: "Add .env to .gitignore" };
  }
  return { status: "PASS" };
}

function checkNoEval(p: string): CheckResult {
  try {
    const content = fs.readFileSync(p, "utf8");
    if (/eval\s*\(/g.test(content)) {
      return { status: "FAIL", reason: "eval() used", fix: "Refactor to avoid eval" };
    }
    return { status: "PASS" };
  } catch {
    return { status: "PASS" };
  }
}

function checkNoExecInjection(p: string): CheckResult {
  try {
    const content = fs.readFileSync(p, "utf8");
    if (/child_process\.exec\s*\(/g.test(content)) {
      return { status: "FAIL", reason: "child_process.exec() with user input is dangerous", fix: "Use execFile or spawn" };
    }
    return { status: "PASS" };
  } catch {
    return { status: "PASS" };
  }
}

function checkHelmet(p: string): CheckResult {
  try {
    const root = path.dirname(p);
    const pkgJson = JSON.parse(fs.readFileSync(p, "utf8"));
    const deps = { ...pkgJson.dependencies, ...pkgJson.devDependencies };
    if (deps.helmet) {
      return { status: "PASS" };
    } else {
      if (deps.express || deps.koa) {
        return { status: "FAIL", reason: "Helmet security middleware not installed", fix: "npm install helmet" };
      }
      return { status: "PASS" };
    }
  } catch {
    return { status: "PASS" };
  }
}

// ============================================================================
// 33–36: Performance
// ============================================================================
function checkFileSize(p: string): CheckResult {
  try {
    const stats = fs.statSync(p);
    const sizeMB = stats.size / (1024 * 1024);
    if (sizeMB > 1) {
      return { status: "FAIL", reason: `File size ${sizeMB.toFixed(2)} MB > 1 MB`, fix: "Split or compress" };
    }
    return { status: "PASS" };
  } catch {
    return { status: "PASS" };
  }
}

function checkNoSyncIO(p: string): CheckResult {
  try {
    const content = fs.readFileSync(p, "utf8");
    if (/readFileSync|writeFileSync|accessSync|statSync/g.test(content) && !p.includes("test")) {
      return { status: "FAIL", reason: "Synchronous file I/O used in code", fix: "Use async/await versions" };
    }
    return { status: "PASS" };
  } catch {
    return { status: "PASS" };
  }
}

function checkMemoryUsage(p: string): CheckResult {
  try {
    const mem = process.memoryUsage();
    if (mem.heapUsed / mem.heapTotal > 0.8) {
      return { status: "FAIL", reason: "High heap usage (>80%)", fix: "Profile memory leaks" };
    }
    return { status: "PASS" };
  } catch {
    return { status: "PASS" };
  }
}

function checkNoInfiniteLoops(p: string): CheckResult {
  try {
    const content = fs.readFileSync(p, "utf8");
    if (/while\s*\(\s*true\s*\)|for\s*\(\s*;\s*;\s*\)/g.test(content)) {
      return { status: "FAIL", reason: "Potential infinite loop found", fix: "Add termination condition" };
    }
    return { status: "PASS" };
  } catch {
    return { status: "PASS" };
  }
}

// ============================================================================
// 37–42: Testing
// ============================================================================
function checkTestsDir(p: string): CheckResult {
  const root = path.dirname(p);
  const testDirs = ["test", "__tests__", "tests"];
  for (const td of testDirs) {
    if (fs.existsSync(path.join(root, td))) {
      return { status: "PASS" };
    }
  }
  return { status: "FAIL", reason: "No test directory found", fix: "Create a test directory" };
}

function checkTestFiles(p: string): CheckResult {
  const root = path.dirname(p);
  const testPatterns = [".test.", ".spec.", "__tests__"];
  const testDir = ["test", "__tests__", "tests"].find(d => fs.existsSync(path.join(root, d)));
  if (!testDir) return { status: "FAIL", reason: "No test files found", fix: "Add at least one test" };
  const files = fs.readdirSync(path.join(root, testDir));
  if (files.some(f => testPatterns.some(p => f.includes(p)))) {
    return { status: "PASS" };
  }
  return { status: "FAIL", reason: "No test files with .test. or .spec. pattern", fix: "Create a test file" };
}

function checkTestFramework(p: string): CheckResult {
  try {
    const json = JSON.parse(fs.readFileSync(p, "utf8"));
    const deps = { ...json.devDependencies, ...json.dependencies };
    const frameworks = ["jest", "mocha", "vitest", "ava", "tape", "jasmine"];
    if (frameworks.some(fw => deps[fw])) {
      return { status: "PASS" };
    }
    return { status: "FAIL", reason: "No test framework installed", fix: "npm install --save-dev jest" };
  } catch {
    return { status: "PASS" };
  }
}

function checkTestsPass(p: string): CheckResult {
  try {
    const root = path.dirname(p);
    child_process.execSync("npm test -- --passWithNoTests", { cwd: root, stdio: "ignore" });
    return { status: "PASS" };
  } catch {
    return { status: "FAIL", reason: "Tests failed", fix: "Fix failing tests" };
  }
}

// ============================================================================
// 43–46: Documentation
// ============================================================================
function checkReadme(p: string): CheckResult {
  const root = path.dirname(p);
  if (fs.existsSync(path.join(root, "README.md"))) {
    return { status: "PASS" };
  }
  return { status: "FAIL", reason: "README.md missing", fix: "Create a README" };
}

function checkReadmeUsage(p: string): CheckResult {
  const root = path.dirname(p);
  const readmePath = path.join(root, "README.md");
  if (!fs.existsSync(readmePath)) return { status: "PASS" };
  const content = fs.readFileSync(readmePath, "utf8");
  if (/```(bash|sh|js|ts|javascript)/g.test(content)) {
    return { status: "PASS" };
  }
  return { status: "FAIL", reason: "README lacks usage example", fix: "Add a code example" };
}

function checkLicense(p: string): CheckResult {
  const root = path.dirname(p);
  const licenseFiles = ["LICENSE", "LICENSE.md", "LICENCE", "LICENCE.md"];
  for (const lf of licenseFiles) {
    if (fs.existsSync(path.join(root, lf))) {
      return { status: "PASS" };
    }
  }
  return { status: "FAIL", reason: "License file missing", fix: "Add a license (e.g., MIT)" };
}

function checkChangelog(p: string): CheckResult {
  const root = path.dirname(p);
  const changelogFiles = ["CHANGELOG.md", "CHANGELOG", "HISTORY.md"];
  for (const cf of changelogFiles) {
    if (fs.existsSync(path.join(root, cf))) {
      return { status: "PASS" };
    }
  }
  return { status: "FAIL", reason: "Changelog missing", fix: "Add CHANGELOG.md" };
}

// ============================================================================
// 47–50: Git Hygiene & Environment
// ============================================================================
function checkGitDir(p: string): CheckResult {
  const root = path.dirname(p);
  if (fs.existsSync(path.join(root, ".git"))) {
    return { status: "PASS" };
  }
  return { status: "FAIL", reason: "Not a Git repository", fix: "git init" };
}

function checkGitignore(p: string): CheckResult {
  const root = path.dirname(p);
  if (fs.existsSync(path.join(root, ".gitignore"))) {
    return { status: "PASS" };
  }
  return { status: "FAIL", reason: ".gitignore missing", fix: "Create .gitignore" };
}

function checkNoLargeFiles(p: string): CheckResult {
  const root = path.dirname(p);
  try {
    const output = child_process.execSync("git ls-files", { cwd: root, encoding: "utf8" });
    const files = output.split("\n").filter(Boolean);
    for (const f of files) {
      const fullPath = path.join(root, f);
      if (fs.existsSync(fullPath)) {
        const stats = fs.statSync(fullPath);
        if (stats.size > 100 * 1024 * 1024) {
          return { status: "FAIL", reason: `Large file tracked: ${f} (${(stats.size / (1024*1024)).toFixed(1)} MB)`, fix: "Use Git LFS or remove" };
        }
      }
    }
    return { status: "PASS" };
  } catch {
    return { status: "PASS" };
  }
}

function checkBranch(p: string): CheckResult {
  const root = path.dirname(p);
  try {
    const branch = child_process.execSync("git rev-parse --abbrev-ref HEAD", { cwd: root, encoding: "utf8" }).trim();
    if (branch !== "main" && branch !== "master") {
      return { status: "FAIL", reason: `Not on main/master branch (currently ${branch})`, fix: "Switch to main branch" };
    }
    return { status: "PASS" };
  } catch {
    return { status: "PASS" };
  }
}

function checkNoUncommitted(p: string): CheckResult {
  const root = path.dirname(p);
  try {
    const status = child_process.execSync("git status --porcelain", { cwd: root, encoding: "utf8" });
    if (status.length > 0) {
      return { status: "FAIL", reason: "Uncommitted changes exist", fix: "Commit or stash changes" };
    }
    return { status: "PASS" };
  } catch {
    return { status: "PASS" };
  }
}

function checkNodeVersion(p: string): CheckResult {
  try {
    const json = JSON.parse(fs.readFileSync(p, "utf8"));
    const engine = json.engines?.node;
    if (!engine) return { status: "PASS" };
    const current = process.version.slice(1);
    const major = parseInt(current.split(".")[0], 10);
    const required = engine.match(/\d+/);
    if (required) {
      const reqMajor = parseInt(required[0], 10);
      if (major < reqMajor) {
        return { status: "FAIL", reason: `Node version ${current} < required ${engine}`, fix: "Use nvm or upgrade" };
      }
    }
    return { status: "PASS" };
  } catch {
    return { status: "PASS" };
  }
}

function checkNodeEnv(p: string): CheckResult {
  if (process.env.NODE_ENV) {
    return { status: "PASS" };
  }
  return { status: "FAIL", reason: "NODE_ENV not set", fix: "Set NODE_ENV (e.g., export NODE_ENV=development)" };
}

runDiagnostics(process.argv[2] || "package.json");
