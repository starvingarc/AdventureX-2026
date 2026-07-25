# Recallo v0.6 Web interaction validation

Validation date: 2026-07-24

Final execution environment: `bridge-amax:/data1/yuxiao/recallo-v062-integration`

## DECISIONS

- Keep one visible recall entry on Today. The stack still accepts click, keyboard, long press, and upward drag.
- Use the shared presentation phases: `home`, `summoning`, `recall`, `scratching`, `revealed`, `assessing`, `checkpoint`, `stowing`, and `paused`.
- Compose ten mascot states from the five licensed in-repository poses instead of adding untracked assets.
- Use Canvas `destination-out` with a 26 px brush and a deterministic 12 by 7 coverage grid. Reveal at 45%.
- Store card index, scratch paths, covered cells, coverage, assessment, and resume phase in `localStorage`.
- A completed checkpoint advances before stowing; an incomplete card keeps its card index and scratch progress.
- First summon uses 1450 ms, later summons use 700 ms, and Reduce Motion uses 180 ms.
- Rarity communicates knowledge potential only. It is not affected by recall feedback.

## RISKS

- This file is an interaction demo backed by fixtures. It does not prove SwiftUI compilation or API integration.
- CSS-composed props and state transitions are suitable for MVP validation, but final production art may need per-state transparent assets.
- Browser visibility changes intentionally restore through the paused screen; automated reload tests must resume before continuing.
- The demo preserves state per browser origin. Schema migrations for future state versions are not included.

## OPEN QUESTIONS

- Whether production should expose a manual pause button in addition to background pause.
- Whether a completed session should select the next due card locally or always ask the server.
- Whether the card edge at checkpoint needs a stronger visual hint after usability testing.

## TEST EVIDENCE

All commands below ran on `bridge-amax`; no project code or tests ran locally.

### Static parsing

```text
PASS inline-script-parse 2/2
```

### Playwright, Chromium, 375 by 812

```text
PASS {
  "viewport": "375x812",
  "overflow": 0,
  "keyboard": true,
  "touch": true,
  "mouseButtons": true,
  "firstMs": 1450,
  "nextMs": 700,
  "reducedMs": 180,
  "restoredCoverage": 0.14285714285714285,
  "completedAndIncompleteStow": true,
  "threeTabs": true
}
```

The browser flow covered mouse, keyboard, and touch completion paths; scratch reveal; remembered, fuzzy, and forgotten feedback; checkpoint; next card; completed stow; incomplete stow; three-tab navigation; reload restoration; and Reduce Motion.
