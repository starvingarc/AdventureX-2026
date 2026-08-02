# Active recall reintegration acceptance evidence

Validated on 2026-08-02 against branch `codex/continue-from-latest-main`, based on team main commit `cb23265`.

## Environment

- Primary device: `Recallo Audit iPhone 17 Pro` (`7921F57F-018A-471E-997D-F23EACC4A1EE`)
- Runtime: iOS 26.5
- API: explicit local Fixture mode (`OMO_DEMO_MODE=1`) with a temporary JSON store
- Secondary build target: iPhone SE (3rd generation), iOS 26.5

The Fixture run validates app/API integration and interaction state. It does not claim production Qwen or TikHub quality; production configuration remains fail-closed and is covered by backend tests.

## Screenshots

| File | Evidence |
| --- | --- |
| `01-empty-home.png` | First-use empty home keeps the Figma composition and points to upload. |
| `02-populated-home.png` | A populated home points to Omo as the draw entry instead of showing upload onboarding. |
| `03-covered-four-layer-deck.png` | Default draw presents the covered inline semantic and the approved four-layer stack while folder/upload remain visible. |
| `04-partial-scratch.png` | A partial scratch reveals only the touched semantic area and does not show self-rating. |
| `05-revealed-rating-cancel.png` | At least 80% coverage reveals the complete weighted semantic and four-position self-rating control; returning to the left cancels without changing cards. |
| `06-submit-failure-retry.png` | Failed assessment stays on the revealed card, preserves the selected slider position, and exposes an inline retry action. |
| `07-library-full-cards.png` | The Library shows complete knowledge cards directly, with no scratch interaction. |
| `08-profile-preserved.png` | The team's current Profile screen remains reachable from the side menu. |
| `09-card-full-context.png` | Card details are an optional sheet; the semantic has stronger weight/color and source status is visible. |
| `10-upload-photo-picker.png` | The persistent plus button opens the iOS single-photo picker during a recall round. |

## Interaction results

- Partial scratch: pass; rating stays hidden.
- 80% reveal: pass; the semantic completes and the rating appears.
- Cancel at the far-left position: pass; the current card remains.
- Submit `forgot`, `fuzzy`, and `remembered`: pass; each value persisted exactly once and advanced to a resealed card.
- Offline submit and retry: pass; the failed selection remained visible and retry succeeded after the API returned.
- Details sheet, Library, Profile, and in-round photo picker: pass.
- Reduce Motion and accessibility-large text smoke checks: pass without clipping or loss of primary controls.
- Small-screen compile: pass on iPhone SE (3rd generation), iOS 26.5.

## Automated gates

- Backend syntax check: pass.
- Backend tests: 31 passed, 0 failed.
- Documentation check: 18 Markdown files and 147 wiki links passed.
- iOS unit tests: 10 passed, 0 failed.
- Primary and iPhone SE Simulator builds: pass.
