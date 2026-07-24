#!/usr/bin/env python3
"""Long-lived JSONL faster-whisper worker.

Keeping model weights in memory removes the 2-4 second model startup cost from
every screenshot. One request is processed at a time per worker; Node manages a
small bounded pool for long-video chunks.
"""

import json
import sys


MODELS = {}


def model_for(request):
    from faster_whisper import WhisperModel

    key = (
        request.get("model", "small"),
        request.get("device", "auto"),
        request.get("compute_type", "int8"),
        max(1, int(request.get("cpu_threads", 2))),
    )
    if key not in MODELS:
        MODELS.clear()
        MODELS[key] = WhisperModel(
            key[0],
            device=key[1],
            compute_type=key[2],
            cpu_threads=key[3],
            num_workers=1,
        )
    return MODELS[key]


def run(request):
    model = model_for(request)
    if request.get("action") == "warm":
        return {"warmed": True}
    language = str(request.get("language", "auto")).lower()
    segments, _info = model.transcribe(
        request["audio"],
        language=None if language in ("", "auto", "automatic", "detect") else language,
        vad_filter=True,
        beam_size=max(1, int(request.get("beam_size", 1))),
        initial_prompt=request.get("initial_prompt") or None,
    )
    normalized = []
    text_parts = []
    for index, segment in enumerate(segments, start=1):
        text = (segment.text or "").strip()
        if not text:
            continue
        normalized.append({
            "id": f"transcript-{index:03d}",
            "start": float(segment.start),
            "end": float(segment.end),
            "text": text,
        })
        text_parts.append(text)
    return {"text": " ".join(text_parts), "segments": normalized}


def main():
    for line in sys.stdin:
        try:
            request = json.loads(line)
            response = {"id": request.get("id"), "result": run(request)}
        except Exception as exc:  # keep worker alive for the next request
            response = {"id": request.get("id") if "request" in locals() else None, "error": str(exc)}
        print(json.dumps(response, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
