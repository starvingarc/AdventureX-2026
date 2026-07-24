#!/usr/bin/env python3
import argparse
import json
import sys


def main():
    parser = argparse.ArgumentParser(description="Transcribe audio with faster-whisper and emit normalized JSON.")
    parser.add_argument("--audio", required=True)
    parser.add_argument("--model", default="small")
    parser.add_argument("--device", default="auto")
    parser.add_argument("--compute-type", default="int8")
    parser.add_argument("--language", default="auto")
    parser.add_argument("--beam-size", type=int, default=1)
    parser.add_argument("--cpu-threads", type=int, default=2)
    parser.add_argument("--initial-prompt", default="")
    args = parser.parse_args()

    try:
        from faster_whisper import WhisperModel
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        return 2

    try:
        model = WhisperModel(
            args.model,
            device=args.device,
            compute_type=args.compute_type,
            cpu_threads=max(1, args.cpu_threads),
            num_workers=1,
        )
        segments, _info = model.transcribe(
            args.audio,
            language=None if args.language.lower() in ("", "auto", "automatic", "detect") else args.language,
            vad_filter=True,
            beam_size=max(1, args.beam_size),
            initial_prompt=args.initial_prompt or None,
        )
        normalized_segments = []
        text_parts = []
        for index, segment in enumerate(segments, start=1):
            text = (segment.text or "").strip()
            if not text:
                continue
            normalized_segments.append({
                "id": f"transcript-{index:03d}",
                "start": float(segment.start),
                "end": float(segment.end),
                "text": text,
            })
            text_parts.append(text)
        print(json.dumps({
            "text": " ".join(text_parts),
            "segments": normalized_segments,
        }, ensure_ascii=False))
        return 0
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
