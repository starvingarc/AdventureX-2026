import AppKit
import Foundation
import Vision

struct OCRPayload: Encodable {
    let provider: String
    let text: String
    let lines: [String]
    let latencyMs: Int
}

struct ErrorPayload: Encodable {
    let code: String
    let error: String
}

func emit<T: Encodable>(_ payload: T) {
    let encoder = JSONEncoder()
    guard let data = try? encoder.encode(payload), let value = String(data: data, encoding: .utf8) else {
        print("{\"code\":\"ocr_failed\",\"error\":\"JSON encoding failed\"}")
        return
    }
    print(value)
}

let startedAt = Date()
guard CommandLine.arguments.count > 1 else {
    emit(ErrorPayload(code: "ocr_input_missing", error: "image path is required"))
    exit(2)
}

let imageURL = URL(fileURLWithPath: CommandLine.arguments[1])
guard let image = NSImage(contentsOf: imageURL) else {
    emit(ErrorPayload(code: "ocr_failed", error: "image cannot be opened"))
    exit(1)
}

var proposedRect = NSRect(origin: .zero, size: image.size)
guard let cgImage = image.cgImage(forProposedRect: &proposedRect, context: nil, hints: nil) else {
    emit(ErrorPayload(code: "ocr_failed", error: "image cannot be decoded"))
    exit(1)
}

let request = VNRecognizeTextRequest()
request.recognitionLevel = ProcessInfo.processInfo.environment["APPLE_VISION_OCR_LEVEL"] == "fast" ? .fast : .accurate
request.recognitionLanguages = ["zh-Hans", "en-US"]
request.usesLanguageCorrection = false
request.minimumTextHeight = 0.008
// Short-video accounts and captions live in the lower quarter. Scan the full
// screenshot and let the platform-aware identity parser remove navigation UI.
request.regionOfInterest = CGRect(x: 0, y: 0, width: 1, height: 1)

do {
    try VNImageRequestHandler(cgImage: cgImage, orientation: .up).perform([request])
    let observations = (request.results ?? []).sorted { left, right in
        if abs(left.boundingBox.maxY - right.boundingBox.maxY) > 0.015 {
            return left.boundingBox.maxY > right.boundingBox.maxY
        }
        return left.boundingBox.minX < right.boundingBox.minX
    }
    let lines = observations.compactMap { $0.topCandidates(1).first?.string.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
    emit(OCRPayload(
        provider: "apple-vision",
        text: lines.joined(separator: "\n"),
        lines: lines,
        latencyMs: Int(Date().timeIntervalSince(startedAt) * 1000)
    ))
} catch {
    emit(ErrorPayload(code: "ocr_failed", error: String(describing: error)))
    exit(1)
}
