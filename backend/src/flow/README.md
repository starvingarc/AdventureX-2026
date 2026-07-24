# Screenshot-to-review flow

This directory is the single orchestration boundary for the screenshot flow:

`screenshot -> identity OCR -> strict link match -> full transcript -> core review + video overview`

## Files

- `index.js`: orchestrates the complete flow and exposes `runImageFlow`.
- `ocr.js`: Node wrapper for the server-side OCR fallback.
- `ocr.py`: PaddleOCR/Tesseract fallback used when iOS OCR text is absent.
- `search.js`: searches Bilibili/Douyin/Xiaohongshu through TikHub and normalizes link candidates; generic web search remains optional.
- `source.js`: stable adapter to the existing article/video platform extractors.
- `review.js`: stable adapter to the fast one-call summary and question generator.
- `cli.mjs`: local command-line entry for end-to-end testing.
- `image_flow_demo.ipynb`: one-image executable walkthrough using `image3.jpg`.
- `index.test.js`: flow orchestration and search-query tests.

The iOS app performs the primary OCR with Apple Vision in
`拾贝/拾贝/Services/ImageOCR.swift`, then sends only compact OCR text to this flow.
Media providers, persistence, queues, review state, and iOS screens remain outside
this folder because they are reusable downstream modules rather than flow orchestration.

## Video behavior

The flow only exposes the screenshot identity (`title`, `account`, and an explicit
player timestamp). It rejects a weak title match instead of summarizing an unrelated
video. One full transcript powers two output sections:

- `review`: cards and a core summary from the timestamp window, or from OCR keywords
  matched against timestamped transcript blocks when the player time is absent.
- `contentOverview`: the shared complete-content summary returned for both videos and articles.
- `videoOverview`: backward-compatible alias for a video's whole-transcript summary.
- `articleOverview`: article-specific alias populated from the full TikHub article body.

Platform routing is explicit: Bilibili uses TikHub APP video search (plus a title/creator fallback),
WeChat uses TikHub WeChat article search and article detail, and Zhihu pins use user search,
user pins, then pin detail. Article screenshots never enter the ASR path.

Subtitle tracks are always preferred. Bilibili uses its public subtitle metadata
before a fallback. For videos without captions, TikHub supplies the Bilibili DASH
audio stream, avoiding a direct yt-dlp scrape. `qwen3-asr-flash-filetrans` first
tries that stream directly. If the source CDN blocks Qwen, production deployments
with `SHIBEI_PUBLIC_BASE_URL` download the audio once, create a random short-lived
`/api/asr-media/<token>` URL, and revoke it after the task. The installed local
`faster-whisper` fallback is for local development or background work on long
videos, not a seconds-level request.
