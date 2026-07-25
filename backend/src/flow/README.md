# Screenshot-to-evidence-card flow

This directory is the single orchestration boundary for the screenshot flow:

`screenshot -> Qwen vision identity -> strict platform match -> evidence -> CaptureMemoryCardV2 -> schedule`

The primary output is one evidence-bound memory card, or an explicit
`archive_only` / `needs_confirmation` disposition. A card contains three recall
variants (`semantic_cloze`, `true_false`, and `multiple_choice`) over the same
evidence; these are not three independent cards.

## Files

- `index.js`: orchestrates the complete flow and exposes `runImageFlow`.
- `vision.js`: sends the original screenshot to the configured Qwen vision model and returns a bounded source identity.
- `search.js`: searches Bilibili, Douyin, or Xiaohongshu through TikHub and normalizes platform-tagged candidates.
- `source.js`: stable adapter to the existing article/video platform extractors.
- `captureMemoryCard.js`: defines and validates the `CaptureMemoryCardV2` one-card contract, evidence references, rarity, and recall variants.
- `reviewSchedule.js`: computes the real `nextReviewAt`, interval, and schedule state.
- `captureMemoryRepository.js` / `captureMemoryStore.js`: persist captures, evidence-backed cards, feedback attempts, and schedules.
- `review.js`: legacy adapter that mirrors a validated memory card into the old review contract.
- `cli.mjs`: local command-line entry for end-to-end testing.
- `index.test.js`: flow orchestration and search-query tests.

The iOS client sends compressed JPEG/PNG/WebP bytes to this flow. The production
path does not invoke Apple Vision, PaddleOCR, or Tesseract. `ocrText` remains a
test/development compatibility input and is not the app's primary path.

## Output contract

Consumers should read:

- `captureAnalysis.disposition`: `create_card`, `archive_only`, or `needs_confirmation`;
- `captureAnalysis.memoryCard`: the single `CaptureMemoryCardV2` card when the disposition is `create_card`;
- `schedule.nextReviewAt`: the persisted next review time;
- Evidence IDs on the card and every recall variant.

`review`, `videoOverview`, chapter summaries, and three-question arrays are
compatibility mirrors for older clients and diagnostics. They are not the source
of truth for new product behavior. New code must not turn the three recall
variants back into three independently scheduled cards or a chapter map.

## Source and video behavior

The flow only exposes a bounded screenshot identity (`platform`, `contentKind`,
`title`, `account`, and an explicit player timestamp). It rejects a weak or
cross-platform ambiguous match instead of summarizing unrelated content. For
videos, source blocks around the screenshot location become Evidence Regions for
the one-card generator. Whole-content summaries may still be emitted as legacy
diagnostic mirrors, but they do not replace card evidence.

Subtitle tracks are always preferred. Bilibili uses its public subtitle metadata
before a fallback. For videos without captions, TikHub supplies the Bilibili DASH
audio stream, avoiding a direct yt-dlp scrape. `qwen3-asr-flash-filetrans` first
tries that stream directly. If the source CDN blocks Qwen, production deployments
with `SHIBEI_PUBLIC_BASE_URL` download the audio once, create a random short-lived
`/api/asr-media/<token>` URL, and revoke it after the task. The installed local
`faster-whisper` fallback is for local development or background work on long
videos, not a seconds-level request.

`CAPTURE_PLATFORMS=bilibili,douyin,xiaohongshu` is the production default. A known
platform is searched only through its own adapter. Cross-platform search is allowed
only when the visual model returns `unknown`, and similarly scored results from
different platforms are treated as ambiguous and rejected. Xiaohongshu image notes
use the public-text adapter instead of the video pipeline.

## Fixture test mode

The deterministic fixture benchmark is test-only:

```bash
npm --prefix backend run benchmark:capture-memory-fixtures
```

It injects synthetic Bilibili/Douyin identities, search results, evidence, and
model outputs into `runImageFlow`. Its report is explicitly tagged
`deterministic_contract_fixture_not_real_screenshot`. It does not enable a
production fixture mode, read a real screenshot gallery, call Qwen/TikHub, or
measure network, download, ASR, model quality, latency, or cost.

Production must use the configured vision, platform, extraction, generation, and persistence providers.
