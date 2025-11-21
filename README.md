```markdown
# Node + Vite + MapLibre App (Auto-select API server, GH Pages ready)

This project uses Vite for the frontend, MapLibre for mapping, humanize-duration for friendly timing display, and gh-pages for easy deployment to GitHub Pages.

Key points
- Build-time API base: Vite exposes environment variables prefixed with VITE_ (e.g. VITE_API_BASE). Use the .env.* files to control which API base gets baked into the build.
  - .env (or .env.development) — defaults used while developing with `vite` (hot reload).
  - .env.production — values used when running `vite build`.
- Runtime fallback: if VITE_API_BASE is not set at build time the app falls back at runtime to:
  - http://localhost:8080 when the page is loaded on localhost
  - https://geo.jaxartes.net otherwise
- No backend required in this repo. The app talks directly to the API you specify (or the runtime fallback).

Files I added/updated
- vite.config.js — sets base from VITE_BASE or package.json homepage; dev proxy for /api.
- .env — development defaults (VITE_API_BASE=http://localhost:8080).
- .env.production — production defaults (VITE_API_BASE=https://geo.jaxartes.net).
- src/main.js — now uses import.meta.env.VITE_API_BASE (build-time) with a runtime fallback.
- package.json — scripts for dev/build/deploy (gh-pages).

How to make a production build that uses the remote server
- The simplest way is to rely on .env.production which already contains:
  VITE_API_BASE=https://geo.jaxartes.net
- Then run:
  npm install
  npm run build
  npm run deploy
- The dist/ artifacts will have the API base baked in. You do not need to rely on runtime hostname detection after this build.

If you need to override VITE_API_BASE at build time (CI or manual), you can:
- Edit .env.production before building, or
- Provide VITE_API_BASE in the environment for the build command:
  - Unix/macOS: VITE_API_BASE="https://geo.jaxartes.net" npm run build
  - Windows (PowerShell): $env:VITE_API_BASE="https://geo.jaxartes.net"; npm run build

Deploying to GitHub Pages
- By default `npm run deploy` runs a build then publishes dist/ to the gh-pages branch.
- If your repo is a project site (https://<user>.github.io/<repo>), set VITE_BASE (or package.json "homepage") to "/<repo>/" so built assets reference the correct base path.
  - Example: add to .env.production:
    VITE_BASE=/my-repo/
  - Or add in package.json: "homepage": "https://<user>.github.io/<repo>"

Notes
- I left the optional server.js in the project in case you want to serve dist via node in some environments; it is not required for gh-pages.
- This setup gives you both: an easy way to bake the remote API at build time (recommended for gh-pages) and a robust runtime fallback for quick local testing.

```