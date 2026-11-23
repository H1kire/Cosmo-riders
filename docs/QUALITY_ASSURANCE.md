# Cosmo-riders — Quality Assurance

## Purpose

This document describes the checks that actually run in the repository. The pipeline is designed to reject broken source references and production artifacts before they are published to GitHub Pages. It does not claim to replace browser-based testing of WebGL, rendering quality, or simulation behavior.

All development and publishing checks are scoped to the `test` branch. The `main` branch is not a target of this workflow.

## Local commands

Run from the repository root with Node.js 20 or newer:

| Command | What it verifies |
|---|---|
| `npm test` | Deterministic regression tests for physics, rendering contracts, procedural surfaces, and formatting. |
| `npm run audit:static` | Project-specific source and architecture invariants in `scripts/audit.ts`. |
| `npm run audit:types` | TypeScript compiler diagnostics (`tsc --noEmit`). |
| `npm run audit:imports` | Relative static imports, dynamic imports, Worker URLs, file existence, and exact path casing. |
| `npm run audit:assets` | Local `src`, `href`, `poster`, and CSS `url()` references in HTML/CSS, including Vite's `public/` asset convention. |
| `npm run audit:build` | Production Vite build followed by verification of generated entry points and assets. |
| `npm run audit:deployment` | Built `dist/` pages, JavaScript/CSS extensions and files, absence of raw TypeScript, relative Vite base, Pages workflow gates, and `.nojekyll`. |
| `npm run audit` / `npm run audit:all` | Runs regression tests, all source checks, production build, and deployment-artifact checks in sequence. |
| `npm run audit:live` | Checks the published root and `/lab/` pages and validates the HTTP Content-Type of their JavaScript and CSS. Requires `PAGES_URL` only when testing a non-default URL. |

`npm run check` remains an alias for the complete audit.

## Automated audit layers

### Static source checks

The existing architecture audit checks browser entry points and DOM contracts, required rendering modules, procedural surface generation and Worker transfer behavior, SI constants, selected physics/rendering invariants, and runtime JavaScript syntax. The import audit independently resolves local module and Worker references.

These checks are intentionally explicit. They are not a general-purpose semantic proof of all TypeScript behavior, and a string-based architecture invariant must be updated when a valid architecture change intentionally replaces the checked contract.

### Type and build checks

TypeScript compilation is run separately. The production build compiles the browser TypeScript through Vite; the browser is not expected to execute raw `.ts` files.

The distribution audit checks both generated entry pages (`/` and `/lab/`), script and stylesheet references, file existence, output extensions, and the presence of `.nojekyll`.

### Integration and regression checks

The Node test suite is the automated regression layer. Tests cover the implemented physics, procedural generation, LOD policies, shader contracts, and formatting. They are not end-to-end browser tests and do not instantiate a real WebGL context.

### Deployment checks

The single Pages workflow runs the full audit before uploading the artifact. Pull requests targeting `test` run the build and checks but do not publish. Pushes to `test` and manual dispatches may publish only after the build job succeeds. A post-deployment smoke check fetches both published pages and verifies JavaScript and CSS MIME types.

## Manual browser verification

The following checks cannot be reliably proven by the current Node-only test setup and must be performed in a real browser after meaningful renderer or UI changes:

1. Open the published root page and `/lab/`; reload each page directly.
2. Inspect DevTools Console and Network for uncaught exceptions, failed requests, 404s, and MIME errors.
3. Confirm the WebGL2 context initializes; test the fallback path with WebGL disabled or unavailable.
4. Change focus between the Sun, planets, and moons; verify the same scene remains visible and camera transitions remain stable.
5. Zoom, orbit, and pan at global and local scales; verify LOD transitions and surface maps.
6. Toggle atmosphere, clouds, shadows, HDR, and quality presets; check for shader compile/link errors.
7. Observe memory and frame-time behavior during repeated zoom/focus changes. Record hardware, browser, scene, and measurement method; do not infer GPU execution time from CPU submission time.

A successful GitHub Actions run is not proof that the rendered game is visually correct or performant.

## Extending the audit

When adding a subsystem:

- Add deterministic unit tests for pure calculations and state transitions.
- Add integration tests for cross-module contracts where they can be exercised without a browser.
- Add source-reference checks only for stable architectural requirements.
- Add asset references to the appropriate source page or stylesheet and ensure the build audit sees them.
- For WebGL features, add shader-source validation and, where practical, a browser test that compiles and links the shader in a real WebGL2 context.
- Document any required manual test and the expected observable result.

Do not weaken or remove a failing check merely to make CI green. Update the check only when the underlying contract has intentionally changed and the replacement is covered.

## Result interpretation

- **PASS** — the automated check completed successfully.
- **FAIL** — the check found a concrete violation; fix it before publishing.
- **BLOCKED** — an external dependency or environment prevented a check from running.
- **NOT RUN** — the check was not executed.

The live smoke test runs after deployment, so it can report a failure after the artifact has already been published. It is a post-publication availability/MIME check, not a pre-publication gate.
