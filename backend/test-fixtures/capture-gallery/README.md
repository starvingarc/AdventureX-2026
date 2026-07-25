# Synthetic capture fixture gallery

This gallery contains repository-authored screenshots for deterministic backend
and HTTP E2E tests. The images imitate only broad platform layout cues; they do
not copy posts, creator identities, screenshots, or assets from Bilibili, Douyin,
or PR #1.

- `bilibili-recall.png`: expected platform `bilibili`.
- `douyin-spacing.png`: expected platform `douyin`.
- `sources/*.html`: small, self-contained sources with synthetic copy and CSS.
- `manifest.json`: provenance, expected platform, dimensions, and SHA-256 hashes.

No fixture contains personal information. Rebuild all PNG files and the manifest
with the lockfile-pinned Playwright dependency:

```bash
npm ci --prefix backend --ignore-scripts
npm --prefix backend run fixtures:capture-gallery
```

Chromium rendering is reproducible for the same browser build, operating system,
and font set. The committed hashes are integrity checks for the generated inputs,
not a promise of identical pixels across different Chromium or font versions.
