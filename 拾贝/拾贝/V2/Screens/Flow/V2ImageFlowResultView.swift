import SwiftUI

struct V2ImageFlowResultView: View {
    let response: ImageFlowResponse
    let onBack: () -> Void

    @State private var revealedQuestionIDs: Set<String> = []

    private var review: ImageFlowResponse.Review? {
        response.review
    }

    private var questions: [ImageFlowResponse.Question] {
        review?.units?.flatMap { $0.questions ?? [] } ?? []
    }

    private var isUnsourcedImage: Bool {
        response.sourceStatus == "unsourced_image"
            || response.source?.sourceStatus == "unsourced_image"
            || response.provenance?.status == "not_found"
    }

    var body: some View {
        V2FlowScreen(title: "截图复习", onBack: onBack) {
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 16) {
                    sourceCard
                    summaryCard

                    if let overview = response.videoOverview,
                       overview.summary?.isEmpty == false {
                        overviewCard(overview)
                    }

                    if !questions.isEmpty {
                        Text("复习卡")
                            .font(V2Typography.sectionTitle)
                            .foregroundStyle(V2Color.textPrimary)
                            .padding(.top, 4)

                        ForEach(Array(questions.enumerated()), id: \.element.id) { index, question in
                            questionCard(question, index: index)
                        }
                    }
                }
                .v2PageColumn()
                .padding(.top, 18)
                .padding(.bottom, 48)
            }
        }
    }

    private var sourceCard: some View {
        V2InfoCard {
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .top, spacing: 10) {
                    Image(systemName: isUnsourcedImage ? "photo.badge.exclamationmark" : "checkmark.seal.fill")
                        .font(.system(size: 20))
                        .foregroundStyle(isUnsourcedImage ? Color.orange : V2Color.primaryAction)

                    VStack(alignment: .leading, spacing: 4) {
                        Text(response.source?.title ?? response.link?.title ?? review?.title ?? "已识别内容")
                            .font(V2Typography.bodyEmphasis)
                            .foregroundStyle(V2Color.textPrimary)
                            .fixedSize(horizontal: false, vertical: true)

                        Text(sourceMetadata)
                            .font(V2Typography.caption)
                            .foregroundStyle(V2Color.textMuted)

                        if isUnsourcedImage {
                            Label(
                                "未找到 TikHub 原始来源；3 张卡片由 Qwen Plus 仅根据截图生成",
                                systemImage: "exclamationmark.magnifyingglass"
                            )
                            .font(V2Typography.caption)
                            .foregroundStyle(Color.orange)
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(.top, 3)
                        }

                        if response.sourceFallback == true {
                            Label(
                                response.message ?? "未获取到字幕，本卡片基于截图文字和发布文案生成",
                                systemImage: "text.viewfinder"
                            )
                            .font(V2Typography.caption)
                            .foregroundStyle(V2Color.textSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(.top, 3)
                        }
                    }
                }

                if !isUnsourcedImage,
                   let urlString = response.source?.url ?? response.link?.url,
                   let url = URL(string: urlString) {
                    Link(destination: url) {
                        Label("打开原内容", systemImage: "arrow.up.right.square")
                            .font(V2Typography.label)
                            .foregroundStyle(V2Color.primaryAction)
                    }
                }
            }
        }
    }

    private var summaryCard: some View {
        V2InfoCard {
            VStack(alignment: .leading, spacing: 12) {
                Text(isUnsourcedImage ? "截图理解 · 未溯源" : "截图附近")
                    .font(V2Typography.label)
                    .foregroundStyle(V2Color.primaryAction)

                Text(review?.summaryCard?.text ?? "已生成截图附近的复习内容。")
                    .font(V2Typography.body)
                    .foregroundStyle(V2Color.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)

                if let tags = review?.tags, !tags.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 6) {
                            ForEach(tags, id: \.self) { tag in
                                Text(tag)
                                    .font(V2Typography.caption)
                                    .foregroundStyle(V2Color.textSecondary)
                                    .padding(.horizontal, 9)
                                    .padding(.vertical, 5)
                                    .background(V2Color.pageGreenBackground.opacity(0.72))
                                    .clipShape(Capsule())
                            }
                        }
                    }
                }
            }
        }
    }

    private func overviewCard(_ overview: ImageFlowResponse.VideoOverview) -> some View {
        V2InfoCard(shadow: V2Shadow.subtleGreen) {
            VStack(alignment: .leading, spacing: 12) {
                Text(isUnsourcedImage ? "截图知识地图 · 未溯源" : "全片概览")
                    .font(V2Typography.bodyEmphasis)
                    .foregroundStyle(V2Color.textPrimary)

                Text(overview.summary ?? "")
                    .font(V2Typography.bodySmall)
                    .foregroundStyle(V2Color.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)

                ForEach(overview.highlights ?? [], id: \.self) { highlight in
                    HStack(alignment: .top, spacing: 8) {
                        Circle()
                            .fill(V2Color.primaryAction)
                            .frame(width: 6, height: 6)
                            .padding(.top, 7)
                        Text(highlight)
                            .font(V2Typography.bodySmall)
                            .foregroundStyle(V2Color.textPrimary)
                    }
                }
            }
        }
    }

    private func questionCard(_ question: ImageFlowResponse.Question, index: Int) -> some View {
        let isRevealed = revealedQuestionIDs.contains(question.id)
        let answer = question.options?.first(where: { $0.id == question.correctOptionId })?.text ?? ""

        return Button {
            withAnimation(.easeInOut(duration: 0.18)) {
                if isRevealed {
                    revealedQuestionIDs.remove(question.id)
                } else {
                    revealedQuestionIDs.insert(question.id)
                }
            }
        } label: {
            V2InfoCard(border: isRevealed ? V2Color.primaryAction.opacity(0.55) : nil) {
                VStack(alignment: .leading, spacing: 12) {
                    HStack {
                        Text("卡片 \(index + 1)")
                            .font(V2Typography.label)
                            .foregroundStyle(V2Color.primaryAction)
                        Spacer()
                        Image(systemName: isRevealed ? "chevron.up" : "chevron.down")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(V2Color.textMuted)
                    }

                    Text(question.knowledgePoint ?? question.stem ?? "核心知识点")
                        .font(V2Typography.bodyEmphasis)
                        .foregroundStyle(V2Color.textPrimary)

                    if let stem = question.stem, stem != question.knowledgePoint {
                        Text(stem)
                            .font(V2Typography.bodySmall)
                            .foregroundStyle(V2Color.textSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    if isRevealed {
                        Divider()
                            .overlay(V2Color.borderSoftGreen)

                        if !answer.isEmpty {
                            Label(answer, systemImage: "checkmark.circle.fill")
                                .font(V2Typography.bodySmallEmphasis)
                                .foregroundStyle(V2Color.primaryAction)
                        }

                        if let explanation = question.explanation, !explanation.isEmpty {
                            Text(explanation)
                                .font(V2Typography.bodySmall)
                                .foregroundStyle(V2Color.textSecondary)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    } else {
                        Text("点击查看答案")
                            .font(V2Typography.caption)
                            .foregroundStyle(V2Color.textMuted)
                    }
                }
            }
        }
        .buttonStyle(.plain)
    }

    private var sourceMetadata: String {
        let account = response.source?.account ?? response.link?.account ?? response.ocr?.identity?.account
        let platform = response.source?.platform ?? response.link?.platform ?? response.ocr?.identity?.platform
        let timestamp = response.source?.focus?.timestampSeconds ?? response.ocr?.identity?.timestampSeconds
        return [
            account,
            platformLabel(platform),
            isUnsourcedImage ? "未找到 TikHub 来源" : nil,
            timestamp.map { "截图位置 \(formatTime($0))" }
        ]
        .compactMap { $0 }
        .filter { !$0.isEmpty }
        .joined(separator: " · ")
    }

    private func platformLabel(_ platform: String?) -> String? {
        switch platform {
        case "douyin": return "抖音"
        case "xiaohongshu": return "小红书"
        case "bilibili": return "哔哩哔哩"
        case "youtube": return "YouTube"
        default: return platform
        }
    }

    private func formatTime(_ seconds: Double) -> String {
        let value = max(0, Int(seconds.rounded()))
        let hours = value / 3_600
        let minutes = value % 3_600 / 60
        let remaining = value % 60
        if hours > 0 {
            return String(format: "%d:%02d:%02d", hours, minutes, remaining)
        }
        return String(format: "%d:%02d", minutes, remaining)
    }
}
