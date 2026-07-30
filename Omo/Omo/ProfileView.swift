import SwiftUI

/// “我的”页面：标题 → Omo 身份区 → 记忆足迹 → 今日召回状态面板。
///
/// 数据合同：只读 `store.cards.count`、全部 `reviewCount` 之和与
/// `store.dueCards.count`；无账号、设置、通知或任何新持久化入口。
///
/// 布局策略：默认字号下内容压缩进一屏，ScrollView 仅作为小屏与
/// Accessibility 大字号（强制纵向）的兜底，不把滚动本身当设计。
///
/// 艺术指导（参考 agent-ui-atlas）：
/// - 日式清新：编辑式留白、小面积强调、克制秩序（页首大标题 + 细线 + 段落节奏）。
/// - 斯堪的纳维亚：暖中性表面与功能宁静（`OmoTheme.surface` 低阴影卡片）。
/// - 有机亲自然：大地绿流动曲线（`OmoBlobShape` 鹅卵石形舞台与状态徽章）。
/// - 可爱极简：圆润吉祥物舞台与胶囊 chip（`OmoPoseHeart` + leaf 徽章）。
/// - 原研哉白盒画廊：细分割线、克制字体，内容本身提供色彩（身份区不套卡片盒）。
/// - 便当网格：非对称信息分组（双统计卡 + 通栏自解释状态面板，而非同质卡片堆）。
struct ProfileView: View {
    // MARK: - Environment

    @EnvironmentObject private var store: OmoStore

    // MARK: - 非 View 计算属性

    private var metrics: ProfileMetrics {
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("-OmoProfileLargeFixture") {
            return ProfileMetrics(cardCount: 123_456, recallCount: 987_654, dueCount: 4_321)
        }
        #endif
        return ProfileMetrics(
            cardCount: store.cards.count,
            recallCount: store.cards.reduce(0) { $0 + $1.reviewCount },
            dueCount: store.dueCards.count
        )
    }

    // MARK: - body

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                header
                ProfileIdentityHero()
                    .padding(.top, 20)
                ProfileFootprintSection(metrics: metrics)
                    .padding(.top, 22)
                ProfileRecallSection(dueCount: metrics.dueCount)
                    .padding(.top, 18)
            }
            .padding(.horizontal, OmoTheme.pageInset)
            .padding(.top, 12)
            .padding(.bottom, 12)
        }
        .foregroundStyle(OmoTheme.ink)
        .scrollIndicators(.hidden)
    }

    // MARK: - View helpers

    private var header: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("我的")
                .font(.largeTitle.bold())
                .accessibilityAddTraits(.isHeader)
            ProfileHairline()
        }
    }
}

// MARK: - 私有样式 token 与形状

private struct ProfileMetrics {
    let cardCount: Int
    let recallCount: Int
    let dueCount: Int
}

/// 有机鹅卵石形：单位空间内的闭合贝塞尔曲线，随绘制矩形缩放，
/// 不依赖任何设备尺寸或绝对坐标。
private struct OmoBlobShape: Shape {
    func path(in rect: CGRect) -> Path {
        func point(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
            CGPoint(x: rect.minX + x * rect.width, y: rect.minY + y * rect.height)
        }
        var path = Path()
        path.move(to: point(0.52, 0.02))
        path.addCurve(to: point(0.96, 0.32), control1: point(0.76, 0.00), control2: point(0.92, 0.10))
        path.addCurve(to: point(0.78, 0.86), control1: point(1.00, 0.54), control2: point(0.94, 0.74))
        path.addCurve(to: point(0.30, 0.91), control1: point(0.66, 0.96), control2: point(0.45, 0.99))
        path.addCurve(to: point(0.04, 0.38), control1: point(0.12, 0.82), control2: point(-0.02, 0.62))
        path.addCurve(to: point(0.52, 0.02), control1: point(0.08, 0.16), control2: point(0.28, 0.04))
        path.closeSubpath()
        return path
    }
}

private struct ProfileHairline: View {
    var body: some View {
        Rectangle()
            .fill(OmoTheme.ink.opacity(0.10))
            .frame(height: 1)
            .frame(maxWidth: .infinity)
            .accessibilityHidden(true)
    }
}

private struct ProfileSectionHeader: View {
    let title: String

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(title)
                .font(.headline)
                .accessibilityAddTraits(.isHeader)
            Capsule()
                .fill(OmoTheme.primary.opacity(0.55))
                .frame(width: 24, height: 3)
                .accessibilityHidden(true)
        }
    }
}

// MARK: - 身份区

/// Omo 身份区：有机形状舞台上的吉祥物 + 名称、角色 chip 与一句关系说明。
/// 普通字号优先紧凑横排（舞台左、文字右）；Accessibility 字号或宽度不足时
/// 转为竖排居中，避免大号 Dynamic Type 下文字被挤进窄列而过度膨胀。
private struct ProfileIdentityHero: View {
    // MARK: Environment

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    // MARK: 常量

    /// 装饰性舞台尺寸固定，不随 Dynamic Type 放大，防止身份区整体膨胀。
    private let stageSize: CGFloat = 120

    // MARK: 非 View 计算属性

    private var usesVerticalLayout: Bool { dynamicTypeSize.isAccessibilitySize }

    // MARK: body

    var body: some View {
        Group {
            if usesVerticalLayout {
                verticalLayout
            } else {
                ViewThatFits(in: .horizontal) {
                    horizontalLayout
                    verticalLayout
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Omo，你的记忆伙伴")
        .accessibilityValue("你负责截图，Omo 负责让它回来")
    }

    // MARK: View helpers

    private var horizontalLayout: some View {
        HStack(alignment: .center, spacing: 16) {
            mascotStage
            identityCopy(alignment: .leading)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var verticalLayout: some View {
        VStack(spacing: 14) {
            mascotStage
            identityCopy(alignment: .center)
        }
        .frame(maxWidth: .infinity)
    }

    private func identityCopy(alignment: HorizontalAlignment) -> some View {
        VStack(alignment: alignment, spacing: 7) {
            Text("Omo")
                .font(.title.bold())
            Text("你的记忆伙伴")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(OmoTheme.primary)
                .padding(.horizontal, 10)
                .padding(.vertical, 5)
                .background(OmoTheme.primary.opacity(0.13), in: Capsule())
                .lineLimit(1)
                .minimumScaleFactor(0.75)
            Text("你负责截图，Omo 负责让它回来。")
                .font(.subheadline)
                .foregroundStyle(OmoTheme.muted)
                .multilineTextAlignment(alignment == .center ? .center : .leading)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var mascotStage: some View {
        ZStack(alignment: .topTrailing) {
            ZStack {
                OmoBlobShape()
                    .fill(OmoTheme.primary.opacity(0.12))
                    .rotationEffect(.degrees(-9))
                    .offset(x: -6, y: 7)
                OmoBlobShape()
                    .fill(
                        LinearGradient(
                            colors: [OmoTheme.success, OmoTheme.mist],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                Image("OmoPoseHeart")
                    .resizable()
                    .scaledToFit()
                    .padding(16)
            }
            Circle()
                .fill(OmoTheme.surface)
                .frame(width: 30, height: 30)
                .overlay {
                    Image(systemName: "leaf.fill")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(OmoTheme.primary)
                }
                .shadow(color: OmoTheme.primary.opacity(0.18), radius: 4, y: 2)
                .offset(x: 6, y: -3)
        }
        .frame(width: stageSize, height: stageSize)
        .accessibilityHidden(true)
    }
}

// MARK: - 记忆足迹

private struct ProfileFootprintSection: View {
    // MARK: Environment

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    // MARK: 常量

    let metrics: ProfileMetrics

    // MARK: body

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            ProfileSectionHeader(title: "记忆足迹")
            if dynamicTypeSize.isAccessibilitySize {
                stackedStats
            } else {
                ViewThatFits(in: .horizontal) {
                    sideBySideStats
                    stackedStats
                }
            }
        }
    }

    // MARK: View helpers

    private var sideBySideStats: some View {
        HStack(alignment: .top, spacing: 12) {
            cardsStat
            recallsStat
        }
    }

    private var stackedStats: some View {
        VStack(spacing: 12) {
            cardsStat
            recallsStat
        }
    }

    private var cardsStat: some View {
        ProfileStatCard(
            value: metrics.cardCount,
            label: "记忆卡",
            unit: "张",
            systemImage: "rectangle.stack.fill",
            tint: OmoTheme.primary
        )
    }

    private var recallsStat: some View {
        ProfileStatCard(
            value: metrics.recallCount,
            label: "已召回",
            unit: "次",
            systemImage: "sparkles",
            tint: OmoTheme.warning
        )
    }
}

private struct ProfileStatCard: View {
    // MARK: 常量

    let value: Int
    let label: String
    let unit: String
    let systemImage: String
    let tint: Color

    // MARK: body

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Image(systemName: systemImage)
                .font(.headline)
                .foregroundStyle(tint)
                .frame(width: 38, height: 38)
                .background(tint.opacity(0.14), in: Circle())
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 2) {
                Text(label)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(OmoTheme.muted)
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Text(value, format: .number)
                        .font(.system(.title, design: .rounded, weight: .bold))
                        .monospacedDigit()
                        .lineLimit(1)
                        .minimumScaleFactor(0.55)
                    Text(unit)
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(OmoTheme.muted)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(
            OmoTheme.surface,
            in: RoundedRectangle(cornerRadius: OmoTheme.radius, style: .continuous)
        )
        .shadow(color: OmoTheme.primary.opacity(0.10), radius: 10, y: 5)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
        .accessibilityValue("\(value.formatted()) \(unit)")
    }
}

// MARK: - 今日召回状态

/// 通栏自解释状态面板：标题文案本身即区段说明，不再叠加独立 section header；
/// 与统计卡形成便当式非对称对比。有 due 时强调待召回数量；无 due 时明确
/// 显示 0 张的收好状态。
private struct ProfileRecallSection: View {
    // MARK: Environment

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    // MARK: 常量

    let dueCount: Int

    // MARK: 非 View 计算属性

    private var hasDue: Bool { dueCount > 0 }

    private var tint: Color { hasDue ? OmoTheme.warning : OmoTheme.primary }

    private var statusIcon: String { hasDue ? "clock.fill" : "checkmark.circle.fill" }

    private var title: String { hasDue ? "今天还有记忆在等你" : "今天的记忆已收好" }

    private var detail: String {
        hasDue
            ? "回到“今日”，从 \(dueCount.formatted()) 张待召回记忆中抽取一张。"
            : "新的召回时刻到来时，会在“今日”提醒你。"
    }

    private var statusAccessibilityValue: String { "待召回 \(dueCount.formatted()) 张" }

    // MARK: body

    var body: some View {
        panel
    }

    // MARK: View helpers

    private var panel: some View {
        Group {
            if dynamicTypeSize.isAccessibilitySize {
                stackedContent
            } else {
                ViewThatFits(in: .horizontal) {
                    sideBySideContent
                    stackedContent
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(
            OmoTheme.surface,
            in: RoundedRectangle(cornerRadius: OmoTheme.radius, style: .continuous)
        )
        .shadow(color: OmoTheme.primary.opacity(0.10), radius: 10, y: 5)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(title)
        .accessibilityValue(statusAccessibilityValue)
        .accessibilityHint(detail)
    }

    private var sideBySideContent: some View {
        HStack(spacing: 14) {
            statusBadge
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.headline)
                Text(detail)
                    .font(.subheadline)
                    .foregroundStyle(OmoTheme.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 8)
            dueFigure(alignment: .trailing)
        }
    }

    private var stackedContent: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 14) {
                statusBadge
                Text(title)
                    .font(.headline)
            }
            Text(detail)
                .font(.subheadline)
                .foregroundStyle(OmoTheme.muted)
                .fixedSize(horizontal: false, vertical: true)
            dueFigure(alignment: .leading)
        }
    }

    private var statusBadge: some View {
        ZStack {
            OmoBlobShape()
                .fill(tint.opacity(0.16))
            Image(systemName: statusIcon)
                .font(.headline)
                .foregroundStyle(tint)
        }
        .frame(width: 48, height: 48)
        .accessibilityHidden(true)
    }

    private func dueFigure(alignment: HorizontalAlignment) -> some View {
        VStack(alignment: alignment, spacing: 1) {
            Text(dueCount, format: .number)
                .font(.system(.title2, design: .rounded, weight: .bold))
                .monospacedDigit()
                .foregroundStyle(tint)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            Text("张待召回")
                .font(.caption)
                .foregroundStyle(OmoTheme.muted)
        }
    }
}
