# AGENTS.md

## Cursor Cloud specific instructions

### What this branch contains
The current branch holds a single self-contained static page, `index.html` ("The OGEN Complex — Coming Soon"). There is no package manager, build system, or dependency manifest on this branch. Most other product code lives on separate unmerged branches; do not assume their files exist here.

### Running the app (dev)
Serve the static site from the repo root with any static file server, e.g.:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000/`. `python3` and `node` are preinstalled in the base image, so no dependency installation is required.

### Lint / test / build
There are no configured lint, test, or build steps on this branch (no `package.json`, `Makefile`, or CI config). `index.html` is plain HTML/CSS served as-is. There is nothing to compile.
