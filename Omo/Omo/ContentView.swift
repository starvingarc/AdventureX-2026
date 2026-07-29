import PhotosUI
import SwiftUI

enum OmoTheme {
    static let background = Color(red: 0.93, green: 0.94, blue: 0.73)
    static let surface = Color(red: 1.00, green: 0.98, blue: 0.92)
    static let primary = Color(red: 0.58, green: 0.65, blue: 0.27)
    static let ink = Color(red: 0.24, green: 0.24, blue: 0.21)
    static let muted = Color(red: 0.49, green: 0.49, blue: 0.43)
    static let warning = Color(red: 0.88, green: 0.49, blue: 0.36)
    static let mist = Color(red: 0.91, green: 0.94, blue: 0.95)
    static let recall = Color(red: 0.98, green: 0.79, blue: 0.70)
    static let success = Color(red: 0.87, green: 0.92, blue: 0.82)
    static let pageInset: CGFloat = 24
    static let radius: CGFloat = 20
}

struct ContentView: View {
    @EnvironmentObject private var store: OmoStore
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var showsAdd = false
    @State private var showsSettings = false
    @State private var showsLaunch = !ProcessInfo.processInfo.arguments.contains("-OmoSkipLaunch")

    var body: some View {
        ZStack {
            OmoTheme.background.ignoresSafeArea()
            currentPage
                .id(store.selectedTab)
                .transition(.opacity.combined(with: .scale(scale: 0.985)))
        }
        .task {
            await store.load()
            #if DEBUG
            let arguments = ProcessInfo.processInfo.arguments
            if arguments.contains("-OmoOpenLibrary") { store.selectedTab = .library }
            if arguments.contains("-OmoAutoRecall") { store.draw() }
            #endif
        }
        .sheet(isPresented: $showsAdd) {
            AddScreenshotView()
                .environmentObject(store)
        }
        .sheet(isPresented: $showsSettings) {
            SettingsView()
        }
        .onChange(of: showsAdd) { _, isPresented in
            guard !isPresented, let card = store.pendingCard else { return }
            store.pendingCard = nil
            Task { @MainActor in
                try? await Task.sleep(for: .milliseconds(250))
                store.presentedCard = card
            }
        }
        .fullScreenCover(item: $store.presentedCard) { card in
            LibraryCardDetailView(card: card)
        }
        .overlay(alignment: .top) {
            if !store.message.isEmpty, store.selectedTab != .today {
                Text(store.message)
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(OmoTheme.ink)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
                    .background(.ultraThinMaterial, in: Capsule())
                    .padding(.top, 8)
                    .onTapGesture { store.message = "" }
            }
        }
        .overlay {
            if showsLaunch {
                OmoLaunchScene()
                    .transition(.opacity.combined(with: .scale(scale: 1.04)))
                    .zIndex(10)
            }
        }
        .animation(reduceMotion ? .none : .easeInOut(duration: 0.25), value: store.selectedTab)
        .task {
            guard showsLaunch else { return }
            try? await Task.sleep(for: .milliseconds(reduceMotion ? 180 : 1250))
            withAnimation(.easeOut(duration: reduceMotion ? 0.12 : 0.35)) { showsLaunch = false }
        }
    }

    @ViewBuilder
    private var currentPage: some View {
        switch store.selectedTab {
        case .today:
            RecallHomeView(
                onOpenLibrary: { store.selectedTab = .library },
                onOpenProfile: { store.selectedTab = .profile },
                onOpenSettings: { showsSettings = true }
            )
        case .library:
            LibraryView(onAdd: { showsAdd = true })
        case .profile:
            ProfileView()
        }
    }
}

private struct TodayView: View {
    @EnvironmentObject private var store: OmoStore
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var breathing = false
    let onAdd: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("今日")
                    .font(.system(size: 26, weight: .bold))
                Spacer()
                Button(action: onAdd) {
                    Image(systemName: "plus")
                        .font(.system(size: 18, weight: .semibold))
                        .frame(width: 44, height: 44)
                        .background(OmoTheme.surface, in: Circle())
                }
                .buttonStyle(SpringPressStyle())
                .accessibilityLabel("添加截图")
            }
            .foregroundStyle(OmoTheme.ink)
            .padding(.horizontal, OmoTheme.pageInset)
            .padding(.top, 12)

            Spacer(minLength: 20)

            if store.isLoading {
                ProgressView("正在寻找记忆")
                    .tint(OmoTheme.primary)
            } else if store.dueCards.isEmpty {
                emptyState
            } else {
                drawState
            }

            Spacer()
        }
    }

    private var emptyState: some View {
        VStack(spacing: 20) {
            Image("OmoPoseStretch")
                .resizable()
                .scaledToFit()
                .frame(width: 210, height: 210)
                .offset(y: breathing ? -7 : 4)
                .rotationEffect(.degrees(breathing ? 1.5 : -1.5))
            Text(store.cards.isEmpty ? "还没有可以唤醒的记忆" : "今天的记忆都收好了")
                .font(.title3.bold())
                .foregroundStyle(OmoTheme.ink)
            Text(store.cards.isEmpty ? "先添加一张社媒截图" : "它们会在合适的时间回来")
                .foregroundStyle(OmoTheme.muted)
            if store.cards.isEmpty {
                PrimaryButton(title: "添加内容", action: onAdd)
            }
        }
        .padding(.horizontal, OmoTheme.pageInset)
        .onAppear(perform: startBreathing)
    }

    private var drawState: some View {
        VStack(spacing: 18) {
            Text("今天，唤醒一点记忆")
                .font(.title2.bold())
                .foregroundStyle(OmoTheme.ink)
            Text("从自己的过去抽一张")
                .foregroundStyle(OmoTheme.muted)

            BreathingCardDeck(active: breathing)

            PrimaryButton(title: "召回一张", systemImage: "sparkles", action: store.draw)
            Text("还有 \(store.dueCards.count) 张在等你，随时可以停下")
                .font(.caption)
                .foregroundStyle(OmoTheme.muted)
        }
        .padding(.horizontal, OmoTheme.pageInset)
        .onAppear(perform: startBreathing)
    }

    private func startBreathing() {
        guard !reduceMotion, !breathing else { return }
        withAnimation(.easeInOut(duration: 2.2).repeatForever(autoreverses: true)) {
            breathing = true
        }
    }
}

private struct LibraryView: View {
    @EnvironmentObject private var store: OmoStore
    let onAdd: () -> Void

    var body: some View {
        NavigationStack {
            Group {
                if store.cards.isEmpty {
                    ContentUnavailableView(
                        "知识库还是空的",
                        systemImage: "rectangle.stack.badge.plus",
                        description: Text("添加截图后，记忆卡会出现在这里。")
                    )
                } else {
                    List {
                        ForEach(store.cards) { card in
                            Button {
                                store.presentedCard = card
                            } label: {
                                MemoryCardRow(card: card)
                            }
                            .buttonStyle(.plain)
                            .listRowBackground(OmoTheme.surface)
                            .swipeActions {
                                Button("删除", role: .destructive) {
                                    Task { await store.delete(card) }
                                }
                            }
                        }
                    }
                    .scrollContentBackground(.hidden)
                }
            }
            .background(OmoTheme.background)
            .navigationTitle("知识库")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        store.selectedTab = .today
                    } label: {
                        Label("返回首页", systemImage: "chevron.left")
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button(action: onAdd) { Image(systemName: "plus") }
                        .accessibilityLabel("添加截图")
                }
            }
        }
    }
}

private struct MemoryCardRow: View {
    let card: MemoryCard

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                RarityBadge(value: card.rarity)
                Text("掌握 · \(card.masteryTitle)")
                    .font(.caption)
                    .foregroundStyle(OmoTheme.primary)
                Spacer()
                Text(card.nextReviewText)
                    .font(.caption)
                    .foregroundStyle(OmoTheme.muted)
            }
            Text(card.coreKnowledge)
                .font(.body.weight(.semibold))
                .foregroundStyle(OmoTheme.ink)
                .multilineTextAlignment(.leading)
            Text(card.sourceTitle)
                .font(.caption)
                .foregroundStyle(OmoTheme.muted)
                .lineLimit(1)
            if card.sourceIsVerified {
                Label("TickHub 已核验", systemImage: "checkmark.seal.fill")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(OmoTheme.primary)
            }
        }
        .padding(.vertical, 8)
    }
}

private struct LibraryCardDetailView: View {
    let card: MemoryCard
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    HStack {
                        RarityBadge(value: card.rarity)
                        Spacer()
                        Text("掌握 · \(card.masteryTitle)")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(OmoTheme.primary)
                    }
                    Text(card.coreKnowledge)
                        .font(.title3.bold())
                        .foregroundStyle(OmoTheme.ink)
                    Text(card.answer)
                        .font(.body.weight(.semibold))
                        .foregroundStyle(OmoTheme.ink)
                    Text(card.explanation)
                        .foregroundStyle(OmoTheme.muted)
                    Divider()
                    Text(card.sourceTitle)
                        .font(.subheadline.weight(.semibold))
                    if card.sourceIsVerified,
                       let value = card.sourceUrl,
                       let url = URL(string: value) {
                        Link(destination: url) {
                            Label("查看原文", systemImage: "arrow.up.right.square")
                                .frame(minHeight: 44)
                        }
                    }
                }
                .padding(OmoTheme.pageInset)
            }
            .background(OmoTheme.background)
            .navigationTitle("完整知识")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                Button("完成") { dismiss() }
            }
        }
    }
}

private struct ProfileView: View {
    @EnvironmentObject private var store: OmoStore

    var body: some View {
        VStack(spacing: 24) {
            HStack {
                Button {
                    store.selectedTab = .today
                } label: {
                    Image(systemName: "chevron.left")
                        .frame(width: 44, height: 44)
                }
                .accessibilityLabel("返回首页")
                Text("我的")
                    .font(.system(size: 26, weight: .bold))
                Spacer()
            }
            Image("OmoPoseHeart")
                .resizable()
                .scaledToFit()
                .frame(width: 190, height: 190)
            Text("Omo")
                .font(.title.bold())
            Text("你负责截图，Omo 负责让它回来。")
                .foregroundStyle(OmoTheme.muted)
            HStack(spacing: 12) {
                StatView(value: store.cards.count, label: "记忆卡")
                StatView(value: store.cards.reduce(0) { $0 + $1.reviewCount }, label: "已召回")
            }
            Spacer()
        }
        .foregroundStyle(OmoTheme.ink)
        .padding(OmoTheme.pageInset)
    }
}

private struct SettingsView: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section("复习") {
                    Label("默认每轮最多 10 张", systemImage: "rectangle.stack")
                    Label("刮开 80% 后进行自评", systemImage: "hand.draw")
                }
            }
            .navigationTitle("Settings")
            .toolbar {
                Button("完成") { dismiss() }
            }
        }
    }
}

private struct AddScreenshotView: View {
    @EnvironmentObject private var store: OmoStore
    @Environment(\.dismiss) private var dismiss
    @State private var selection: PhotosPickerItem?
    @State private var pulse = false

    var body: some View {
        let isCreating = store.isCreating
        NavigationStack {
            VStack(spacing: 24) {
                Spacer()
                ZStack {
                    if isCreating {
                        OmoOrbit().scaleEffect(0.7)
                        OmoAtlasPlayer(
                            asset: "OmoMotionRunAtlas",
                            poster: "OmoMotionRunPoster",
                            columns: 6,
                            rows: 6,
                            frameCount: 32
                        )
                    } else {
                        Image("OmoPoseRun")
                            .resizable()
                            .scaledToFit()
                            .offset(y: pulse ? -6 : 3)
                    }
                }
                .frame(width: 220, height: 220)
                Text("把截图变成记忆卡")
                    .font(.title2.bold())
                Text("Omo 会读取截图并提炼一个值得再次想起的知识点。")
                    .foregroundStyle(OmoTheme.muted)
                    .multilineTextAlignment(.center)

                PhotosPicker(selection: $selection, matching: .images) {
                    Label(isCreating ? "正在生成" : "选择截图", systemImage: "photo")
                        .frame(maxWidth: .infinity)
                        .frame(height: 54)
                        .foregroundStyle(.white)
                        .background(OmoTheme.primary, in: RoundedRectangle(cornerRadius: 16))
                }
                .disabled(isCreating)
                .buttonStyle(SpringPressStyle())

                if isCreating {
                    ProgressView("正在识别标题并通过 TickHub 核对来源")
                        .tint(OmoTheme.primary)
                }
                Spacer()
            }
            .padding(OmoTheme.pageInset)
            .background(OmoTheme.background.ignoresSafeArea())
            .navigationTitle("添加内容")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                Button("关闭") { dismiss() }
            }
            .onChange(of: selection) { _, item in
                guard let item else { return }
                Task {
                    guard let data = try? await item.loadTransferable(type: Data.self) else {
                        store.message = "无法读取这张图片。"
                        return
                    }
                    if await store.createCard(from: data) { dismiss() }
                    selection = nil
                }
            }
            .onAppear {
                withAnimation(.easeInOut(duration: 1.1).repeatForever(autoreverses: true)) { pulse = true }
            }
        }
    }
}

private struct RecallView: View {
    enum Phase { case summoning, recall, revealed, saving, complete }

    @EnvironmentObject private var store: OmoStore
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var card: MemoryCard
    @State private var phase: Phase = .summoning
    @State private var summonStage: MemorySummonStage = .running
    @State private var scratchProgress: CGFloat = 0
    @State private var contentEntered = false
    @State private var selectedAssessment: MemoryAssessment?
    @State private var reactionTrigger = 0
    @State private var error = ""

    init(card: MemoryCard) {
        _card = State(initialValue: card)
    }

    var body: some View {
        ZStack {
            background
                .ignoresSafeArea()
                .animation(.easeInOut(duration: 0.42), value: phase)
            switch phase {
            case .summoning:
                summonView.transition(.opacity)
            case .recall, .revealed:
                recallView.transition(.opacity.combined(with: .scale(scale: 0.98)))
            case .saving:
                savingView.transition(.opacity.combined(with: .scale(scale: 0.94)))
            case .complete:
                completeView.transition(.opacity.combined(with: .scale(scale: 0.88)))
            }
        }
        .task { await playSummon() }
    }

    private var background: Color {
        switch phase {
        case .summoning, .saving: OmoTheme.mist
        case .recall: OmoTheme.recall
        case .revealed: OmoTheme.surface
        case .complete: OmoTheme.success
        }
    }

    private var summonView: some View {
        VStack(spacing: 18) {
            VStack(spacing: 6) {
                Text("正在从你的过去召回")
                    .font(.system(.title2, design: .rounded, weight: .bold))
                Text(summonCaption)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(OmoTheme.muted)
                    .contentTransition(.numericText())
            }

            ZStack {
                Image("RecallFolder")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 128, height: 128)
                    .offset(x: -126, y: 118)
                    .rotationEffect(.degrees(summonStage == .rummaging ? -5 : 0))
                    .scaleEffect(summonStage == .rummaging ? 1.08 : 1)

                if summonStage == .landing || summonStage == .revealed {
                    OmoOrbit()
                        .transition(.scale.combined(with: .opacity))
                    ForEach(0..<2, id: \.self) { index in
                        RoundedRectangle(cornerRadius: 26)
                            .fill(OmoTheme.surface.opacity(index == 0 ? 0.55 : 0.75))
                            .frame(width: 238, height: 318)
                            .rotationEffect(.degrees(index == 0 ? -7 : 6))
                            .offset(x: index == 0 ? -17 : 16, y: 13)
                    }

                    VStack(spacing: 18) {
                        RarityBadge(value: card.rarity)
                        Image(systemName: "sparkles")
                            .font(.system(size: 42, weight: .light))
                            .foregroundStyle(OmoTheme.primary)
                            .symbolEffect(.breathe, options: .repeating)
                        Text("一段记忆正在苏醒")
                            .font(.title3.bold())
                        Text("掌握 · \(card.masteryTitle)")
                            .font(.caption)
                            .foregroundStyle(OmoTheme.muted)
                    }
                    .frame(width: 238, height: 318)
                    .background(OmoTheme.surface, in: RoundedRectangle(cornerRadius: 26))
                    .shadow(color: OmoTheme.primary.opacity(0.25), radius: 16, y: 10)
                    .transition(.offset(y: 130).combined(with: .scale(scale: 0.55)).combined(with: .opacity))

                    if summonStage == .revealed {
                        OmoSparkBurst(trigger: 1, tint: rarityColor)
                    }
                }

                summonMascot
                    .frame(width: 112, height: 112)
                    .offset(summonMascotOffset)
                    .transition(.opacity)
            }
            .frame(height: 390)
            .animation(reduceMotion ? .none : .spring(response: 0.42, dampingFraction: 0.76), value: summonStage)

            Button("跳过过场", action: finishSummon)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(OmoTheme.muted)
                .frame(minWidth: 88, minHeight: 44)
        }
        .padding(.horizontal, OmoTheme.pageInset)
        .foregroundStyle(OmoTheme.ink)
    }

    @ViewBuilder
    private var summonMascot: some View {
        switch summonStage {
        case .running:
            OmoAtlasPlayer(asset: "OmoMotionRunAtlas", poster: "OmoMotionRunPoster", columns: 6, rows: 6, frameCount: 32)
        case .rummaging:
            OmoAtlasPlayer(asset: "OmoMotionRummageAtlas", poster: "OmoMotionRummagePoster", columns: 6, rows: 6, frameCount: 32)
        case .carrying:
            OmoAtlasPlayer(asset: "OmoMotionCarryReturnAtlas", poster: "OmoMotionCarryReturnPoster", columns: 6, rows: 2, frameCount: 10, loop: false)
        case .landing, .revealed:
            Image("OmoPoseApprove").resizable().scaledToFit()
        }
    }

    private var recallView: some View {
        VStack(spacing: 16) {
            HStack {
                Button { dismiss() } label: {
                    Image(systemName: "xmark").frame(width: 44, height: 44)
                }
                Spacer()
                Text("唤醒一张记忆").font(.headline)
                Spacer()
                Color.clear.frame(width: 44, height: 44)
            }

            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    HStack {
                        RarityBadge(value: card.rarity)
                        Spacer()
                        Text("掌握 · \(card.masteryTitle)")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(OmoTheme.primary)
                    }
                    Text("先别看答案")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(OmoTheme.muted)
                    Text(card.recallCue)
                        .font(.title2.bold())
                        .foregroundStyle(OmoTheme.ink)
                        .fixedSize(horizontal: false, vertical: true)

                    if phase == .recall {
                        ScratchRevealCanvas(answer: card.answer, progress: $scratchProgress) {
                            reveal()
                        }
                        Button("直接揭晓", action: reveal)
                            .frame(maxWidth: .infinity, minHeight: 44)
                            .foregroundStyle(OmoTheme.muted)
                    } else {
                        VStack(alignment: .leading, spacing: 12) {
                            Divider()
                            Text(card.coreKnowledge)
                                .font(.title3.bold())
                                .foregroundStyle(OmoTheme.primary)
                            Text(card.answer).font(.body.weight(.semibold))
                            Text(card.explanation).foregroundStyle(OmoTheme.muted)
                            sourceEvidence
                        }
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                    }
                }
                .padding(22)
                .background(OmoTheme.surface, in: RoundedRectangle(cornerRadius: 24))
                .shadow(color: OmoTheme.primary.opacity(0.15), radius: 10, y: 6)
                .rotation3DEffect(.degrees(contentEntered ? 0 : 12), axis: (x: 1, y: 0, z: 0), anchor: .bottom)
                .offset(y: contentEntered ? 0 : 34)
                .opacity(contentEntered ? 1 : 0)
                .overlay {
                    if phase == .revealed {
                        OmoSparkBurst(trigger: reactionTrigger, tint: OmoTheme.primary)
                    }
                }

                if phase == .revealed {
                    VStack(spacing: 12) {
                        Text("刚才想起来了吗？")
                            .foregroundStyle(OmoTheme.muted)
                        HStack(spacing: 8) {
                            ForEach(MemoryAssessment.allCases) { value in
                                AssessmentButton(value: value) { submit(value) }
                            }
                        }
                    }
                    .padding(.top, 18)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                }
            }
        }
        .padding(.horizontal, OmoTheme.pageInset)
        .foregroundStyle(OmoTheme.ink)
        .onAppear {
            withAnimation(reduceMotion ? .none : .spring(response: 0.55, dampingFraction: 0.8)) {
                contentEntered = true
            }
        }
    }

    private var savingView: some View {
        VStack(spacing: 22) {
            ZStack {
                if selectedAssessment != .remembered {
                    Image("OmoParticlePuff")
                        .resizable()
                        .renderingMode(.template)
                        .foregroundStyle(OmoTheme.muted.opacity(0.16))
                        .frame(width: 230, height: 230)
                }
                Image(feedbackPose)
                    .resizable()
                    .scaledToFit()
                    .frame(width: 200, height: 200)
                    .symbolEffect(.bounce, options: .nonRepeating, value: reactionTrigger)
                if selectedAssessment == .remembered {
                    OmoSparkBurst(trigger: reactionTrigger, tint: .yellow)
                }
            }
            .frame(height: 230)
            Text(error.isEmpty ? feedbackTitle : "结果还没有保存")
                .font(.title2.bold())
            Text(feedbackDetail)
                .foregroundStyle(OmoTheme.muted)
                .multilineTextAlignment(.center)
            if error.isEmpty {
                ProgressView().tint(OmoTheme.primary)
            } else {
                Text(error).foregroundStyle(OmoTheme.muted)
                PrimaryButton(title: "返回重试") {
                    phase = .revealed
                    error = ""
                }
            }
        }
        .padding(OmoTheme.pageInset)
        .foregroundStyle(OmoTheme.ink)
    }

    private var completeView: some View {
        VStack(spacing: 22) {
            ZStack {
                OmoOrbit().scaleEffect(0.8)
                OmoSparkBurst(trigger: reactionTrigger + 1, tint: OmoTheme.primary)
                OmoSparkBurst(trigger: reactionTrigger + 2, tint: .yellow).scaleEffect(0.72)
                Image("OmoPoseHeart")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 220, height: 220)
                    .symbolEffect(.breathe, options: .repeating)
            }
            .frame(height: 250)
            Text("记忆已经收好了")
                .font(.title.bold())
            Text("掌握 · \(card.masteryTitle)")
                .foregroundStyle(OmoTheme.primary)
            Text(card.nextReviewText)
                .foregroundStyle(OmoTheme.muted)
            PrimaryButton(title: "完成", systemImage: "checkmark") { dismiss() }
        }
        .padding(OmoTheme.pageInset)
        .foregroundStyle(OmoTheme.ink)
    }

    private func reveal() {
        guard phase == .recall else { return }
        withAnimation(reduceMotion ? .none : .spring(response: 0.4, dampingFraction: 0.82)) {
            scratchProgress = 1
            phase = .revealed
        }
        reactionTrigger += 1
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
    }

    private func submit(_ assessment: MemoryAssessment) {
        selectedAssessment = assessment
        reactionTrigger += 1
        withAnimation(.spring(response: 0.38, dampingFraction: 0.76)) { phase = .saving }
        UINotificationFeedbackGenerator().notificationOccurred(assessment == .remembered ? .success : .warning)
        Task {
            do {
                card = try await store.assess(card, as: assessment)
                try? await Task.sleep(for: .milliseconds(reduceMotion ? 180 : 900))
                withAnimation(.spring(response: 0.5, dampingFraction: 0.74)) { phase = .complete }
            } catch {
                self.error = error.localizedDescription
            }
        }
    }

    private var summonCaption: String {
        switch summonStage {
        case .running: "Omo 正赶去旧收藏里"
        case .rummaging: "翻一翻，应该就在这里"
        case .carrying: "找到了，正在带回来"
        case .landing: "记忆正在落到你手里"
        case .revealed: "准备好了吗？"
        }
    }

    private var summonMascotOffset: CGSize {
        switch summonStage {
        case .running: CGSize(width: 124, height: 130)
        case .rummaging: CGSize(width: -86, height: 118)
        case .carrying: CGSize(width: -8, height: 128)
        case .landing, .revealed: CGSize(width: 126, height: 132)
        }
    }

    private var rarityColor: Color {
        switch card.rarity {
        case "SSR": .purple
        case "SR": .orange
        default: OmoTheme.primary
        }
    }

    private var feedbackPose: String {
        switch selectedAssessment {
        case .remembered: "OmoPoseApprove"
        case .fuzzy: "OmoPoseConfused"
        case .forgot: "OmoPoseDejected"
        case nil: "OmoPoseDazed"
        }
    }

    private var feedbackTitle: String {
        switch selectedAssessment {
        case .remembered: "抓住了这段记忆"
        case .fuzzy: "轮廓已经回来了"
        case .forgot: "没关系，下次再见"
        case nil: "正在收好这段记忆"
        }
    }

    private var feedbackDetail: String {
        switch selectedAssessment {
        case .remembered: "Omo 会把它放远一点，等需要时再回来。"
        case .fuzzy: "下一次会更快出现，让模糊慢慢变清楚。"
        case .forgot: "它会更早回来，不让这段内容再次积灰。"
        case nil: "正在更新下一次召回时间。"
        }
    }

    @ViewBuilder
    private var sourceEvidence: some View {
        if card.sourceIsVerified,
           let value = card.sourceUrl,
           let url = URL(string: value) {
            Link(destination: url) {
                Label("TickHub 已核验 · \(card.sourceTitle)", systemImage: "checkmark.seal.fill")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(OmoTheme.primary)
                    .lineLimit(2)
            }
        } else {
            Label("仅依据截图 · \(card.sourceTitle)", systemImage: "photo")
                .font(.caption)
                .foregroundStyle(OmoTheme.muted)
                .lineLimit(2)
        }
    }

    private func playSummon() async {
        guard phase == .summoning else { return }
        if reduceMotion {
            try? await Task.sleep(for: .milliseconds(180))
            finishSummon()
            return
        }
        guard await advance(after: 360, to: .rummaging) else { return }
        guard await advance(after: 620, to: .carrying) else { return }
        guard await advance(after: 520, to: .landing) else { return }
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        guard await advance(after: 500, to: .revealed) else { return }
        try? await Task.sleep(for: .milliseconds(420))
        finishSummon()
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("-OmoAutoDemo") {
            try? await Task.sleep(for: .milliseconds(650))
            reveal()
            try? await Task.sleep(for: .milliseconds(650))
            submit(.remembered)
        }
        #endif
    }

    private func advance(after milliseconds: Int, to stage: MemorySummonStage) async -> Bool {
        try? await Task.sleep(for: .milliseconds(milliseconds))
        guard !Task.isCancelled, phase == .summoning else { return false }
        withAnimation(.spring(response: 0.4, dampingFraction: 0.76)) { summonStage = stage }
        return true
    }

    private func finishSummon() {
        guard phase == .summoning else { return }
        withAnimation(.easeOut(duration: reduceMotion ? 0.12 : 0.28)) { phase = .recall }
    }
}

private struct OmoTabBar: View {
    @Binding var selection: OmoTab
    @Namespace private var selectionAnimation

    var body: some View {
        HStack(spacing: 0) {
            ForEach(OmoTab.allCases) { tab in
                Button {
                    selection = tab
                } label: {
                    VStack(spacing: 4) {
                        Image(systemName: tab.symbol)
                            .font(.system(size: 22, weight: .semibold))
                        Text(tab.title).font(.caption.weight(.semibold))
                    }
                    .frame(maxWidth: .infinity, minHeight: 62)
                    .foregroundStyle(selection == tab ? OmoTheme.primary : OmoTheme.ink)
                    .background {
                        if selection == tab {
                            RoundedRectangle(cornerRadius: 20)
                                .fill(OmoTheme.background.opacity(0.78))
                                .matchedGeometryEffect(id: "selected-tab", in: selectionAnimation)
                        }
                    }
                    .clipShape(RoundedRectangle(cornerRadius: 20))
                }
                .buttonStyle(SpringPressStyle())
            }
        }
        .padding(8)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 28))
        .shadow(color: OmoTheme.primary.opacity(0.18), radius: 12, y: 6)
    }
}

private struct RarityBadge: View {
    let value: String

    var body: some View {
        Text(value)
            .font(.caption.bold())
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(color.opacity(0.16), in: Capsule())
            .foregroundStyle(color)
    }

    private var color: Color {
        switch value {
        case "SSR": .purple
        case "SR": .orange
        default: OmoTheme.primary
        }
    }
}

private struct PrimaryButton: View {
    let title: String
    var systemImage: String?
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if let systemImage { Image(systemName: systemImage) }
                Text(title)
            }
            .font(.headline)
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity, minHeight: 54)
            .background(OmoTheme.primary, in: RoundedRectangle(cornerRadius: 16))
            .shadow(color: OmoTheme.primary.opacity(0.24), radius: 9, y: 5)
        }
        .buttonStyle(SpringPressStyle())
    }
}

private struct AssessmentButton: View {
    let value: MemoryAssessment
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 5) {
                Image(systemName: symbol).font(.headline)
                Text(value.title).font(.caption.weight(.semibold))
            }
            .foregroundStyle(color)
            .frame(maxWidth: .infinity, minHeight: 58)
            .background(OmoTheme.surface, in: RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(color.opacity(0.45)))
        }
        .buttonStyle(SpringPressStyle())
    }

    private var symbol: String {
        switch value {
        case .remembered: "checkmark.circle.fill"
        case .fuzzy: "circle.lefthalf.filled"
        case .forgot: "arrow.counterclockwise"
        }
    }

    private var color: Color {
        switch value {
        case .remembered: OmoTheme.primary
        case .fuzzy: .orange
        case .forgot: OmoTheme.muted
        }
    }
}

private struct BreathingCardDeck: View {
    let active: Bool

    var body: some View {
        ZStack {
            ForEach(0..<3, id: \.self) { index in
                RoundedRectangle(cornerRadius: 26)
                    .fill(OmoTheme.surface.opacity(0.56 + Double(index) * 0.17))
                    .frame(width: 245, height: 310)
                    .rotationEffect(.degrees(Double(index - 1) * (active ? 6.5 : 4.5)))
                    .offset(
                        x: CGFloat(index - 1) * (active ? 15 : 11),
                        y: CGFloat(2 - index) * 8 + (active && index == 2 ? -8 : 2)
                    )
                    .shadow(color: OmoTheme.primary.opacity(0.16), radius: active ? 13 : 8, y: 7)
            }
            Image("OmoPoseSmirk")
                .resizable()
                .scaledToFit()
                .frame(width: 158, height: 158)
                .offset(y: active ? -8 : 5)
                .rotationEffect(.degrees(active ? 2 : -2))
            Image(systemName: "sparkles")
                .foregroundStyle(OmoTheme.primary.opacity(0.75))
                .font(.title2)
                .offset(x: 78, y: active ? -84 : -66)
                .symbolEffect(.pulse, options: .repeating)
        }
        .frame(height: 340)
        .accessibilityHidden(true)
    }
}

private struct OmoLaunchScene: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var arrived = false

    var body: some View {
        ZStack {
            OmoTheme.background.ignoresSafeArea()
            OmoOrbit()
                .scaleEffect(arrived ? 1 : 0.55)
                .opacity(arrived ? 0.7 : 0)
            OmoSparkBurst(trigger: arrived ? 1 : 0, tint: OmoTheme.primary)
            VStack(spacing: 4) {
                Image("OmoPoseStretch")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 230, height: 230)
                    .offset(y: arrived ? 0 : 80)
                    .rotationEffect(.degrees(arrived ? 0 : -8))
                Text("Omo")
                    .font(.system(size: 42, weight: .black, design: .rounded))
                    .foregroundStyle(OmoTheme.ink)
                Text("让值得记住的，再回来一次")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(OmoTheme.muted)
            }
            .scaleEffect(arrived ? 1 : 0.72)
            .opacity(arrived ? 1 : 0)
        }
        .onAppear {
            withAnimation(reduceMotion ? .easeOut(duration: 0.12) : .spring(response: 0.65, dampingFraction: 0.68)) {
                arrived = true
            }
        }
        .accessibilityElement(children: .combine)
    }
}

private struct StatView: View {
    let value: Int
    let label: String

    var body: some View {
        VStack(spacing: 6) {
            Text(value, format: .number).font(.title.bold())
            Text(label).font(.caption).foregroundStyle(OmoTheme.muted)
        }
        .frame(maxWidth: .infinity)
        .padding(20)
        .background(OmoTheme.surface, in: RoundedRectangle(cornerRadius: OmoTheme.radius))
    }
}
