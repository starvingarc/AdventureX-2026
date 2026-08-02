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
            store.applyKnowledgeLibraryDebugArguments(arguments)
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
            KnowledgeLibraryView(
                cards: store.cards,
                onBack: { store.selectedTab = .today },
                onAdd: { showsAdd = true },
                onOpenCard: { store.presentedCard = $0 }
            )
        case .profile:
            ProfileView(onBack: { store.selectedTab = .today })
        }
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
