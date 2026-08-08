import AVFAudio
import Foundation
import Speech

enum KnowledgeLibrarySpeechEvent: Equatable, Sendable {
    case listening
    case transcript(String, isFinal: Bool)
    case denied
    case unavailable
    case failed(String)
    case stopped
}

enum KnowledgeLibrarySpeechState: Equatable {
    case idle
    case listening
    case denied
    case unavailable
    case failed(String)
}

@MainActor
protocol KnowledgeLibrarySpeechTranscribing: AnyObject {
    var events: AsyncStream<KnowledgeLibrarySpeechEvent> { get }
    func start() async
    func stop()
}

@MainActor
final class AppleKnowledgeLibrarySpeechTranscriber: KnowledgeLibrarySpeechTranscribing {
    let events: AsyncStream<KnowledgeLibrarySpeechEvent>

    private let recognizer: SFSpeechRecognizer?
    private let audioEngine = AVAudioEngine()
    private var eventContinuation: AsyncStream<KnowledgeLibrarySpeechEvent>.Continuation?
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    private var inputTapInstalled = false

    init(locale: Locale = Locale(identifier: "zh-CN")) {
        recognizer = SFSpeechRecognizer(locale: locale)
        var continuation: AsyncStream<KnowledgeLibrarySpeechEvent>.Continuation?
        events = AsyncStream { continuation = $0 }
        eventContinuation = continuation
    }

    deinit {
        recognitionTask?.cancel()
        if inputTapInstalled { audioEngine.inputNode.removeTap(onBus: 0) }
    }

    func start() async {
        guard !audioEngine.isRunning else { return }
        guard await requestPermissions() else {
            eventContinuation?.yield(.denied)
            return
        }
        guard let recognizer, recognizer.isAvailable else {
            eventContinuation?.yield(.unavailable)
            return
        }

        do {
            try beginRecognition(using: recognizer)
            eventContinuation?.yield(.listening)
        } catch {
            stopAudio(yieldStopped: false)
            eventContinuation?.yield(.failed("语音输入启动失败，请重试。"))
        }
    }

    func stop() {
        stopAudio(yieldStopped: true)
    }

    private func requestPermissions() async -> Bool {
        async let speech = withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { status in
                continuation.resume(returning: status == .authorized)
            }
        }
        async let microphone = withCheckedContinuation { continuation in
            AVAudioApplication.requestRecordPermission { granted in
                continuation.resume(returning: granted)
            }
        }
        let speechAllowed = await speech
        let microphoneAllowed = await microphone
        return speechAllowed && microphoneAllowed
    }

    private func beginRecognition(using recognizer: SFSpeechRecognizer) throws {
        stopAudio(yieldStopped: false)
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        recognitionRequest = request

        let audioSession = AVAudioSession.sharedInstance()
        try audioSession.setCategory(.record, mode: .measurement, options: [.duckOthers])
        try audioSession.setActive(true, options: .notifyOthersOnDeactivation)

        let inputNode = audioEngine.inputNode
        let format = inputNode.outputFormat(forBus: 0)
        inputNode.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
            request.append(buffer)
        }
        inputTapInstalled = true
        audioEngine.prepare()
        try audioEngine.start()

        recognitionTask = recognizer.recognitionTask(with: request) { [weak self] result, error in
            Task { @MainActor in
                guard let self else { return }
                if let result {
                    let value = result.bestTranscription.formattedString
                    self.eventContinuation?.yield(.transcript(value, isFinal: result.isFinal))
                    if result.isFinal { self.stopAudio(yieldStopped: false) }
                } else if error != nil {
                    self.stopAudio(yieldStopped: false)
                    self.eventContinuation?.yield(.failed("没有听清，请重试或改用文字输入。"))
                }
            }
        }
    }

    private func stopAudio(yieldStopped: Bool) {
        if audioEngine.isRunning { audioEngine.stop() }
        if inputTapInstalled {
            audioEngine.inputNode.removeTap(onBus: 0)
            inputTapInstalled = false
        }
        recognitionRequest?.endAudio()
        recognitionRequest = nil
        recognitionTask?.cancel()
        recognitionTask = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        if yieldStopped { eventContinuation?.yield(.stopped) }
    }
}

#if DEBUG || OMO_TESTING
@MainActor
final class DebugKnowledgeLibrarySpeechTranscriber: KnowledgeLibrarySpeechTranscribing {
    let events: AsyncStream<KnowledgeLibrarySpeechEvent>
    private let transcript: String?
    private let denied: Bool
    private var eventContinuation: AsyncStream<KnowledgeLibrarySpeechEvent>.Continuation?
    private var task: Task<Void, Never>?

    init(transcript: String?, denied: Bool = false) {
        self.transcript = transcript
        self.denied = denied
        var continuation: AsyncStream<KnowledgeLibrarySpeechEvent>.Continuation?
        events = AsyncStream { continuation = $0 }
        eventContinuation = continuation
    }

    func start() async {
        task?.cancel()
        guard !denied else {
            eventContinuation?.yield(.denied)
            return
        }
        eventContinuation?.yield(.listening)
        guard let transcript else { return }
        task = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(380))
            guard !Task.isCancelled else { return }
            self?.eventContinuation?.yield(.transcript(transcript, isFinal: true))
        }
    }

    func stop() {
        task?.cancel()
        task = nil
        eventContinuation?.yield(.stopped)
    }
}
#endif
