import Foundation

#if DEBUG || OMO_TESTING
struct KnowledgeLibraryDebugConfiguration {
    let usesMockSearch: Bool
    let searchMode: DebugMockKnowledgeLibrarySearcher.Mode
    let speechTranscript: String?
    let speechDenied: Bool
    let initialQuery: String?

    static func current(arguments: [String] = ProcessInfo.processInfo.arguments) -> Self {
        let mode: DebugMockKnowledgeLibrarySearcher.Mode
        if arguments.contains("-OmoLibrarySearchFailure") {
            mode = .failure
        } else if arguments.contains("-OmoLibrarySearchNoResults") {
            mode = .noResults
        } else {
            mode = .matching
        }
        return Self(
            usesMockSearch: arguments.contains("-OmoLibraryMockSearch")
                || arguments.contains("-OmoLibrarySearchFailure")
                || arguments.contains("-OmoLibrarySearchNoResults")
                || arguments.contains("-OmoLibraryFixture"),
            searchMode: mode,
            speechTranscript: value(after: "-OmoLibraryVoiceTranscript", in: arguments),
            speechDenied: arguments.contains("-OmoLibrarySpeechDenied"),
            initialQuery: value(after: "-OmoLibraryQuery", in: arguments)
        )
    }

    private static func value(after flag: String, in arguments: [String]) -> String? {
        guard let index = arguments.firstIndex(of: flag), arguments.indices.contains(index + 1) else {
            return nil
        }
        return arguments[index + 1]
    }
}

enum KnowledgeLibraryDebugFixtures {
    static let cards: [MemoryCard] = [
        make("library-01", "截图可能削弱记忆，因为它会触发认知卸载：用户认为设备已经替自己保存。", semantic: "认知卸载", rarity: "SSR"),
        make("library-02", "提取练习比反复阅读更能暴露自己真正没有掌握的部分。", semantic: "提取练习", rarity: "SR"),
        make("library-03", "先形成自己的答案，再查看解释，能减少熟悉感造成的掌握错觉。", semantic: "熟悉感", rarity: "R"),
        make("library-04", "产品的 Magic Moment 应该尽早由用户自己的高价值内容触发，而不是由预设示例替代。", semantic: "用户自己的高价值内容", rarity: "SSR"),
        make("library-05", "通知可以用一条具体知识向用户提问，在 App 外制造一次真实的“我到底还记不记得”。", semantic: "向用户提问", rarity: "SR"),
        make("library-06", "信息被忘记时通常不痛，真正的痛发生在需要调用却只能想起模糊印象的时候。", semantic: "需要调用", rarity: "R"),
        make("library-07", "低成本保存动作负责捕捉注意力，后续的二次唤醒流程负责把短暂印象变成可调用知识。", semantic: "二次唤醒", rarity: "SR"),
        make("library-08", "来源恢复失败时仍可基于截图生成最低证据等级的卡片，并邀请用户稍后补充链接升格。", semantic: nil, rarity: "R"),
        make("library-09", "稀有度描述知识节点的核心潜力，只作为视觉装饰，不代表抽取概率或用户掌握程度。", semantic: "核心潜力", rarity: "SSR"),
        make("library-10", "一次复习只突出一个主要动作：先回忆，揭示后再自评。", semantic: "一个主要动作", rarity: "SR"),
        make("library-11", "知识库负责完整浏览和取回；主动回忆牌组才使用句内遮挡。", semantic: "主动回忆牌组", rarity: "R"),
        make("library-12", "新的搜索请求必须使旧请求失效，避免较慢的旧结果覆盖用户刚刚提交的新意图。", semantic: "旧请求失效", rarity: "SR")
    ]

    private static func make(
        _ id: String,
        _ knowledge: String,
        semantic: String?,
        rarity: String
    ) -> MemoryCard {
        MemoryCard(
            id: id,
            coreKnowledge: knowledge,
            hiddenSemantic: semantic,
            recallCue: "这条知识的关键机制是什么？",
            answer: semantic ?? knowledge,
            explanation: "这是为知识库界面验收创建的合成解释，不来自真实用户数据。",
            sourceTitle: "Omo 合成验收资料",
            sourceAccount: "Omo Test",
            sourcePlatform: "fixture",
            sourceUrl: nil,
            sourceStatus: "screenshot_only",
            sourceProvider: nil,
            sourceConfidence: nil,
            rarity: rarity,
            createdAt: "2026-08-03T00:00:00Z",
            masteryStage: "sealed",
            nextReviewAt: "2026-08-03T00:00:00Z",
            reviewCount: 0,
            successfulRecallCount: 0,
            lastAssessment: nil
        )
    }
}

extension OmoStore {
    func applyKnowledgeLibraryDebugArguments(_ arguments: [String]) {
        guard let index = arguments.firstIndex(of: "-OmoLibraryFixture"),
              arguments.indices.contains(index + 1) else { return }
        switch arguments[index + 1] {
        case "many":
            cards = KnowledgeLibraryDebugFixtures.cards
            message = ""
        case "empty":
            cards = []
            message = ""
        default:
            break
        }
    }
}
#endif

@MainActor
enum KnowledgeLibraryDependencies {
    static func makeSearcher(
        arguments: [String] = ProcessInfo.processInfo.arguments
    ) -> any KnowledgeLibrarySearching {
        #if DEBUG || OMO_TESTING
        let configuration = KnowledgeLibraryDebugConfiguration.current(arguments: arguments)
        if configuration.usesMockSearch {
            return DebugMockKnowledgeLibrarySearcher(mode: configuration.searchMode)
        }
        #endif
        return APIKnowledgeLibrarySearcher()
    }

    static func makeSpeechTranscriber() -> any KnowledgeLibrarySpeechTranscribing {
        #if DEBUG || OMO_TESTING
        let configuration = KnowledgeLibraryDebugConfiguration.current()
        if configuration.speechTranscript != nil || configuration.speechDenied {
            return DebugKnowledgeLibrarySpeechTranscriber(
                transcript: configuration.speechTranscript,
                denied: configuration.speechDenied
            )
        }
        #endif
        return AppleKnowledgeLibrarySpeechTranscriber()
    }

    static var initialQuery: String? {
        #if DEBUG || OMO_TESTING
        KnowledgeLibraryDebugConfiguration.current().initialQuery
        #else
        nil
        #endif
    }
}
