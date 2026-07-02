# FixCord – Project Diagnostics

A lightweight, function‑based diagnostic tool that runs **50 checks** on your project’s `package.json` and surrounding environment.

## Usage

```bash
# Run against package.json (default)
npx tsx fixcord-extended.ts

# Or specify any file
npx tsx fixcord-extended.ts path/to/your/file.json
```

Checks covered

· File system (permissions, BOM, line endings, etc.)
· package.json fields (name, version, scripts, engines, …)
· Dependency health (outdated, vulnerabilities, lockfile sync)
· Security (secrets, eval, exec, Helmet)
· Performance (file size, sync I/O, memory)
· Testing (directory, framework, passing tests)
· Documentation (README, LICENSE, CHANGELOG)
· Git hygiene (.gitignore, large files, branch, uncommitted changes)
· Node environment (version, NODE_ENV)

Each check prints ✔ PASS or ✘ FAIL with a reason and a fix suggestion.

Output summary

```
Diagnostic run on: /path/to/package.json
──────────────────────────────────────────────
[✔] Check 1
[✘] Check 2
    Reason: File not readable
    Fix:    Adjust permissions (chmod +r)
...
Summary:
  Checks run: 50
  Failures:   0
  Status:     FOUNDATION OK
```

Deploy to GitHub

Just clone this repo, run npm install, and you’re good to go.

---

No classes, no “majors” – just a simple function that gives you a clear health report.

```
