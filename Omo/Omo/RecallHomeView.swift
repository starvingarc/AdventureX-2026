import PhotosUI
import SwiftUI

struct RecallHomeView: View {
    @EnvironmentObject private var store: OmoStore
    let onOpenLibrary: () -> Void
    let onOpenProfile: () -> Void
    let onOpenSettings: () -> Void

    @State private var selectedScreenshot: PhotosPickerItem?
    @State private var selectionError = ""
    @State private var deck: [MemoryCard] = []
    @State private var isRoundActive = false

    var body: some View {
        RecallHomeScaffold(
            mascotIsInteractive: !store.dueCards.isEmpty && !isRoundActive,
            mascotHint: "点击开始抽取这一轮知识卡",
            onMascotTap: beginRound,
            onOpenProfile: onOpenProfile,
            onOpenSettings: onOpenSettings
        ) {
            if isRoundActive {
                ZStack(alignment: .topLeading) {
                    RecallRoundView(
                        cards: deck,
                        onAssess: assess,
                        onComplete: finishRound
                    )

                    persistentHomeActions
                }
                .frame(
                    width: RecallHomeMetrics.referenceSize.width,
                    height: RecallHomeMetrics.referenceSize.height,
                    alignment: .topLeading
                )
            } else if store.cards.isEmpty {
                firstLaunchContent
            } else {
                idleContent
            }
        }
        .onChange(of: selectedScreenshot) { _, item in
            loadScreenshot(from: item)
        }
    }

    private var firstLaunchContent: some View {
        ZStack(alignment: .topLeading) {
            Text("上传第一张知识截屏")
                .font(.system(size: 24, weight: .bold, design: .rounded))
                .foregroundStyle(RecallPalette.coral)
                .multilineTextAlignment(.center)
                .minimumScaleFactor(0.82)
                .frame(width: RecallHomeMetrics.promptFrame.width, height: RecallHomeMetrics.promptFrame.height)
                .position(x: RecallHomeMetrics.promptFrame.midX, y: RecallHomeMetrics.promptFrame.midY)

            statusText

            Image("FirstLaunchFolder")
                .resizable()
                .scaledToFit()
                .frame(width: RecallHomeMetrics.folderFrame.width, height: RecallHomeMetrics.folderFrame.height)
                .position(x: RecallHomeMetrics.folderFrame.midX, y: RecallHomeMetrics.folderFrame.midY)
                .accessibilityHidden(true)

            Image("FirstLaunchArrow")
                .resizable()
                .scaledToFit()
                .frame(width: RecallHomeMetrics.uploadArrowFrame.width, height: RecallHomeMetrics.uploadArrowFrame.height)
                .position(x: RecallHomeMetrics.uploadArrowFrame.midX, y: RecallHomeMetrics.uploadArrowFrame.midY)
                .accessibilityHidden(true)

            uploadPicker(label: "上传第一张知识截屏")
        }
    }

    private var idleContent: some View {
        ZStack(alignment: .topLeading) {
            if !store.dueCards.isEmpty {
                Image("FirstLaunchArrow")
                    .resizable()
                    .renderingMode(.template)
                    .scaledToFit()
                    .scaleEffect(x: 1, y: -1)
                    .foregroundStyle(RecallPalette.teal.opacity(0.78))
                    .frame(width: RecallHomeMetrics.mascotArrowFrame.width, height: RecallHomeMetrics.mascotArrowFrame.height)
                    .position(x: RecallHomeMetrics.mascotArrowFrame.midX, y: RecallHomeMetrics.mascotArrowFrame.midY)
                    .accessibilityHidden(true)
            }

            persistentHomeActions
        }
    }

    @ViewBuilder
    private var persistentHomeActions: some View {
        Button(action: onOpenLibrary) {
            Image("FirstLaunchFolder")
                .resizable()
                .scaledToFit()
                .frame(
                    width: RecallHomeMetrics.folderFrame.width,
                    height: RecallHomeMetrics.folderFrame.height
                )
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .position(
            x: RecallHomeMetrics.folderFrame.midX,
            y: RecallHomeMetrics.folderFrame.midY
        )
        .accessibilityLabel("打开知识库")

        uploadPicker(label: "上传新的知识截屏")
    }

    @ViewBuilder
    private var statusText: some View {
        let text = selectionError.isEmpty ? store.message : selectionError
        if store.isCreating || !text.isEmpty {
            Text(store.isCreating ? "正在整理第一张知识卡" : text)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(text.isEmpty ? RecallPalette.teal : RecallPalette.error)
                .multilineTextAlignment(.center)
                .lineLimit(2)
                .frame(width: RecallHomeMetrics.statusFrame.width, height: RecallHomeMetrics.statusFrame.height)
                .position(x: RecallHomeMetrics.statusFrame.midX, y: RecallHomeMetrics.statusFrame.midY)
        }
    }

    private func uploadPicker(label: String) -> some View {
        let isCreating = store.isCreating
        return PhotosPicker(selection: $selectedScreenshot, matching: .images, photoLibrary: .shared()) {
            Image("FirstLaunchUpload")
                .resizable()
                .frame(width: RecallHomeMetrics.uploadFrame.width, height: RecallHomeMetrics.uploadFrame.height)
                .opacity(isCreating ? 0.62 : 1)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(isCreating)
        .position(x: RecallHomeMetrics.uploadFrame.midX, y: RecallHomeMetrics.uploadFrame.midY)
        .accessibilityLabel(label)
        .accessibilityHint("打开系统照片选择器，只选择一张截图")
    }

    private func loadScreenshot(from item: PhotosPickerItem?) {
        guard let item, !store.isCreating else { return }
        selectionError = ""
        Task {
            defer { selectedScreenshot = nil }
            guard let data = try? await item.loadTransferable(type: Data.self), !data.isEmpty else {
                selectionError = "读取图片失败，请重新选择。"
                return
            }
            if await store.createCard(from: data) {
                store.pendingCard = nil
            }
        }
    }

    private func beginRound() {
        let candidates = store.nextRecallDeck
        guard !candidates.isEmpty else { return }
        deck = candidates
        UISelectionFeedbackGenerator().selectionChanged()
        withAnimation(.spring(response: 0.48, dampingFraction: 0.84)) {
            isRoundActive = true
        }
    }

    private func assess(_ card: MemoryCard, as assessment: MemoryAssessment) async throws {
        _ = try await store.assess(card, as: assessment)
    }

    private func finishRound() {
        withAnimation(.easeOut(duration: 0.22)) {
            isRoundActive = false
            deck = []
        }
    }
}

private struct RecallHomeScaffold<Content: View>: View {
    let mascotIsInteractive: Bool
    let mascotHint: String
    let onMascotTap: () -> Void
    let onOpenProfile: () -> Void
    let onOpenSettings: () -> Void
    @ViewBuilder let content: Content

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var drawerIsOpen = false
    @State private var mascotBreathes = false

    init(
        mascotIsInteractive: Bool,
        mascotHint: String,
        onMascotTap: @escaping () -> Void,
        onOpenProfile: @escaping () -> Void,
        onOpenSettings: @escaping () -> Void,
        @ViewBuilder content: () -> Content
    ) {
        self.mascotIsInteractive = mascotIsInteractive
        self.mascotHint = mascotHint
        self.onMascotTap = onMascotTap
        self.onOpenProfile = onOpenProfile
        self.onOpenSettings = onOpenSettings
        self.content = content()
    }

    var body: some View {
        GeometryReader { geometry in
            let scale = RecallHomeMetrics.scale(for: geometry.size)
            let canvasSize = CGSize(
                width: RecallHomeMetrics.referenceSize.width * scale,
                height: RecallHomeMetrics.referenceSize.height * scale
            )
            ZStack(alignment: .leading) {
                RecallPalette.background.ignoresSafeArea()
                referenceCanvas
                    .frame(width: RecallHomeMetrics.referenceSize.width, height: RecallHomeMetrics.referenceSize.height)
                    .scaleEffect(scale)
                    .frame(width: canvasSize.width, height: canvasSize.height)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .allowsHitTesting(!drawerIsOpen)
                    .accessibilityHidden(drawerIsOpen)

                if drawerIsOpen {
                    RecallPalette.scrim
                        .ignoresSafeArea()
                        .contentShape(Rectangle())
                        .onTapGesture { drawerIsOpen = false }
                    drawer(width: min(RecallHomeMetrics.drawerMaxWidth, geometry.size.width * RecallHomeMetrics.drawerWidthRatio))
                        .transition(.move(edge: .leading))
                }
            }
            .animation(reduceMotion ? nil : .spring(response: 0.32, dampingFraction: 0.88), value: drawerIsOpen)
        }
    }

    private var referenceCanvas: some View {
        ZStack(alignment: .topLeading) {
            Image("FirstLaunchPanel")
                .resizable()
                .frame(width: RecallHomeMetrics.panelFrame.width, height: RecallHomeMetrics.panelFrame.height)
                .position(x: RecallHomeMetrics.panelFrame.midX, y: RecallHomeMetrics.panelFrame.midY)
                .accessibilityHidden(true)

            Button { drawerIsOpen = true } label: {
                Image("FirstLaunchMenu")
                    .resizable()
                    .frame(width: RecallHomeMetrics.menuFrame.width, height: RecallHomeMetrics.menuFrame.height)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .position(x: RecallHomeMetrics.menuFrame.midX, y: RecallHomeMetrics.menuFrame.midY)
            .accessibilityLabel("打开菜单")

            mascot
            content
        }
    }

    @ViewBuilder
    private var mascot: some View {
        let image = Image("OmoPoseStretch")
            .resizable()
            .scaledToFit()
            .frame(width: RecallHomeMetrics.mascotFrame.width, height: RecallHomeMetrics.mascotFrame.height)
            .scaleEffect(mascotIsInteractive && mascotBreathes && !reduceMotion ? 1.035 : 1)

        if mascotIsInteractive {
            Button(action: onMascotTap) { image.contentShape(Rectangle()) }
                .buttonStyle(.plain)
                .position(x: RecallHomeMetrics.mascotFrame.midX, y: RecallHomeMetrics.mascotFrame.midY)
                .accessibilityLabel("哦莫 记忆伙伴")
                .accessibilityHint(mascotHint)
                .task { startBreathing() }
        } else {
            image
                .position(x: RecallHomeMetrics.mascotFrame.midX, y: RecallHomeMetrics.mascotFrame.midY)
                .accessibilityHidden(true)
        }
    }

    private func drawer(width: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Omo")
                .font(.system(size: 24, weight: .bold, design: .rounded))
                .foregroundStyle(RecallPalette.ink)
                .padding(.bottom, 16)
            drawerButton("Profile", symbol: "person.crop.circle", action: onOpenProfile)
            drawerButton("Settings", symbol: "gearshape", action: onOpenSettings)
            Spacer()
        }
        .padding(.horizontal, 24)
        .padding(.top, 72)
        .frame(width: width)
        .frame(maxHeight: .infinity, alignment: .topLeading)
        .background(RecallPalette.drawer)
        .clipShape(UnevenRoundedRectangle(bottomTrailingRadius: 28, topTrailingRadius: 28, style: .continuous))
        .ignoresSafeArea()
        .accessibilityAddTraits(.isModal)
    }

    private func drawerButton(_ title: String, symbol: String, action: @escaping () -> Void) -> some View {
        Button {
            drawerIsOpen = false
            action()
        } label: {
            Label(title, systemImage: symbol)
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(RecallPalette.ink)
                .frame(maxWidth: .infinity, minHeight: 56, alignment: .leading)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func startBreathing() {
        guard !reduceMotion, !mascotBreathes else { return }
        withAnimation(.easeInOut(duration: 1.6).repeatForever(autoreverses: true)) {
            mascotBreathes = true
        }
    }
}
