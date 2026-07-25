import SwiftUI

struct V2BottomNavigationBar: View {
    @Binding var selectedTab: V2HomeTab

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: V2BottomNavMetrics.capsuleRadius, style: .continuous)
                .fill(V2Color.surfaceNav)
                .frame(width: V2BottomNavMetrics.capsuleSize.width, height: V2BottomNavMetrics.capsuleSize.height)
                .v2Shadow()

            HStack(spacing: 0) {
                ForEach(V2HomeTab.visibleTabs) { tab in
                    navItem(tab)
                        .frame(maxWidth: .infinity)
                }
            }
            .frame(width: V2BottomNavMetrics.capsuleSize.width - 22)
        }
        .frame(width: V2BottomNavMetrics.designSize.width, height: V2BottomNavMetrics.designSize.height)
    }

    private func navItem(_ tab: V2HomeTab) -> some View {
        V2BottomNavItem(
            tab: tab,
            isSelected: selectedTab == tab
        ) {
            selectedTab = tab
        }
    }
}

enum V2BottomNavPlacement {
    static let bottomPadding: CGFloat = 12
}

private enum V2BottomNavMetrics {
    static let designSize = CGSize(width: 357, height: 94)
    static let capsuleSize = CGSize(width: 349, height: 86)
    static let capsuleRadius: CGFloat = 29
}

struct V2BottomNavItem: View {
    let tab: V2HomeTab
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 2) {
                if let assetName = isSelected ? tab.selectedAssetName : tab.inactiveAssetName {
                    Image(assetName)
                        .resizable()
                        .renderingMode(.original)
                        .frame(width: 32, height: 32)
                }

                Text(tab.title)
                    .font(V2Typography.navLabel)
                    .foregroundStyle(isSelected ? V2Color.primary : V2Color.textPrimary)
                    .frame(height: 16)
            }
            .frame(width: 56, height: 58)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(tab.title)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
        .accessibilityIdentifier("v2.tab.\(tab.id)")
    }
}

struct V2UploadTabButton: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            ZStack(alignment: .topLeading) {
                Circle()
                    .fill(V2Color.uploadButtonFill)
                    .frame(width: V2UploadTabMetrics.circleDiameter, height: V2UploadTabMetrics.circleDiameter)
                    .overlay {
                        Circle()
                            .stroke(V2Color.uploadButtonStroke, lineWidth: V2UploadTabMetrics.circleStrokeWidth)
                    }
                    .v2Shadow()
                    .position(V2UploadTabMetrics.circleCenter)

                V2UploadPlusShape()
                    .stroke(
                        V2Color.primary,
                        style: StrokeStyle(
                            lineWidth: V2UploadTabMetrics.plusStrokeWidth,
                            lineCap: .round,
                            lineJoin: .round
                        )
                    )
            }
            .frame(width: V2UploadTabMetrics.canvasSize.width, height: V2UploadTabMetrics.canvasSize.height)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("上传")
    }
}

private enum V2UploadTabMetrics {
    static let canvasSize = CGSize(width: 60, height: 60)
    static let circleCenter = CGPoint(x: 30, y: 26)
    static let circleDiameter: CGFloat = 52
    static let circleStrokeWidth: CGFloat = 2
    static let plusStrokeWidth: CGFloat = 2
    static let plusVertical = (start: CGPoint(x: 30, y: 16.9307), end: CGPoint(x: 30, y: 34.4655))
    static let plusHorizontal = (start: CGPoint(x: 20.9307, y: 26), end: CGPoint(x: 38.4655, y: 26))
}

private struct V2UploadPlusShape: Shape {
    func path(in rect: CGRect) -> Path {
        Path { path in
            path.move(to: V2UploadTabMetrics.plusVertical.start)
            path.addLine(to: V2UploadTabMetrics.plusVertical.end)
            path.move(to: V2UploadTabMetrics.plusHorizontal.start)
            path.addLine(to: V2UploadTabMetrics.plusHorizontal.end)
        }
    }
}

#Preview("V2 Bottom Navigation") {
    ZStack {
        V2Color.pageGreenBackground
            .ignoresSafeArea()

        V2BottomNavigationBar(selectedTab: .constant(.learning))
    }
}
