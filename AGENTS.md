# AGENTS.md

## Cursor Cloud specific instructions

This repository is a single static HTML page (`index.html`) for "The OGEN Complex" — a "Coming Soon" landing page. There is no package manager, build step, backend, database, or dependencies.

### Running / previewing

- There is nothing to install. `python3` is available in the base image.
- Serve the page locally for previewing:
  ```bash
  python3 -m http.server 8000
  ```
  Then open `http://localhost:8000/`. You can also open `index.html` directly in a browser.

### Lint / test / build

- No linters, tests, or build tooling exist in this repo. There are no `package.json`, lockfiles, Makefile, or CI configs.
