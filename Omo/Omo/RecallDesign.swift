import SwiftUI

enum RecallPalette {
    static let background = Color(red: 1.00, green: 0.61, blue: 0.43)
    static let panel = Color(red: 0.99, green: 0.89, blue: 0.78)
    static let card = Color(red: 0.99, green: 0.90, blue: 0.79)
    static let teal = Color(red: 0.38, green: 0.53, blue: 0.53)
    static let tealSoft = Color(red: 0.58, green: 0.72, blue: 0.71)
    static let ink = Color(red: 0.18, green: 0.34, blue: 0.34)
    static let coral = Color(red: 0.92, green: 0.42, blue: 0.27)
    static let drawer = Color(red: 0.99, green: 0.91, blue: 0.81)
    static let scrim = Color.black.opacity(0.26)
    static let error = Color(red: 0.68, green: 0.22, blue: 0.18)
}

enum RecallHomeMetrics {
    static let referenceSize = CGSize(width: 402, height: 874)
    static let menuFrame = CGRect(x: 25, y: 43, width: 70, height: 70)
    static let mascotFrame = CGRect(x: 209, y: 105, width: 170, height: 170)
    static let panelFrame = CGRect(x: 13, y: 265, width: 376, height: 588)
    static let promptFrame = CGRect(x: 78, y: 476, width: 246, height: 54)
    static let statusFrame = CGRect(x: 92, y: 534, width: 218, height: 48)
    static let folderFrame = CGRect(x: 6, y: 623, width: 220, height: 220)
    static let uploadFrame = CGRect(x: 296, y: 733, width: 70, height: 73)
    static let uploadArrowFrame = CGRect(x: 249, y: 587, width: 90, height: 100)
    static let mascotArrowFrame = CGRect(x: 193, y: 168, width: 90, height: 105)
    static let cardStackFrame = CGRect(x: 70, y: 322, width: 262, height: 184)
    static let ratingFrame = CGRect(x: 58, y: 536, width: 286, height: 82)
    static let errorFrame = CGRect(x: 88, y: 622, width: 226, height: 44)
    static let drawerMaxWidth: CGFloat = 286
    static let drawerWidthRatio: CGFloat = 0.76

    static func scale(for size: CGSize) -> CGFloat {
        min(1, min(size.width / referenceSize.width, size.height / referenceSize.height))
    }
}

enum RecallCardMetrics {
    static let cornerRadius: CGFloat = 18
    static let contentInset: CGFloat = 22
    static let scratchHeight: CGFloat = 64
    static let brushDiameter: CGFloat = 34
    static let visibleLayerCount = 4
}

enum RecallRatingMetrics {
    static let trackHeight: CGFloat = 16
    static let knobSize = CGSize(width: 44, height: 38)
    static let nodeDiameter: CGFloat = 18
    static let totalHeight: CGFloat = 82
}
