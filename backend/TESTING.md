# Backend testing

Install the lockfile-pinned backend dependencies before running tests:

```bash
npm ci --prefix backend --ignore-scripts
```

The canonical backend gate syntax-checks every `.js`, `.mjs`, and `.cjs` source
below `backend/src`, `backend/scripts`, and `backend/test-fixtures`, excluding
nested `node_modules`. Test execution discovers only matching `*.test.*` files
below `backend/src`; no individual source or test path is maintained by hand:

```bash
npm --prefix backend run check
npm --prefix backend run test:all
npm --prefix backend run check:v2
```

- `check` syntax-checks all three source scopes, then runs every test below `src`.
- `test:all` runs the complete `src` test inventory without the syntax pass.
- `check:v2` applies discovery only to `backend/src/v2`.

## Deterministic screenshot HTTP E2E

`src/flow/serverScreenshotE2E.test.js` covers the localhost-only lifecycle:

```text
async screenshot upload
→ job polling
→ persisted card
→ canonical/idempotent assessment
→ schedule and mastery update
→ card deletion
→ empty list
```

It also covers the race where device-data deletion wins while the fixture model is
running; the stale task is cancelled and cannot recreate a card.

The fixture providers are enabled only when both conditions are true:

```text
NODE_ENV=test
RECALLO_E2E_FIXTURE_MODE=1
```

The provider hashes decoded bytes and accepts only the two SHA-256 values recorded
in `test-fixtures/capture-gallery/manifest.json`; plain base64 and image data URLs
are supported. Unknown or malformed images are rejected rather than assigned a
fictional platform. The HTTP E2E test uploads both registered platforms, sets its
environment inside an isolated Node test process, and explicitly disables database
and external-provider credentials. Production and development requests never
receive fixture providers, even if the fixture flag is accidentally present.

This deterministic suite does not replace live Postgres migration/concurrency,
durable-worker restart, Xcode, or real Qwen/TikHub platform validation.
