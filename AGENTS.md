# AGENTS.md

## Cursor Cloud specific instructions

### What this branch contains
- The checked-out `main` branch is a **single static page**: `index.html` ("The OGEN Complex — Coming Soon"). There is **no** `package.json`, lockfile, build system, or backend service here.
- Most other product code (Cloudflare Workers, Veritas engine, etc.) lives on **separate unmerged branches**. Do not assume their files exist on this branch.

### Running the site (development)
- No dependencies to install. Serve the static file with any static server:
  - `python3 -m http.server 8000` (from the repo root), then open `http://localhost:8000/`.
- There is no lint/test/build tooling on this branch. "Build" is a no-op; the page is plain HTML/CSS with no JavaScript.
