import SwiftUI
import UIKit

enum MemorySummonStage {
    case running
    case rummaging
    case carrying
    case landing
    case revealed
}

struct OmoAtlasPlayer: View {
    let asset: String
    let poster: String
    let columns: Int
    let rows: Int
    let frameCount: Int
    var loop = true

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var frames: [UIImage] = []
    @State private var startedAt = Date()

    var body: some View {
        Group {
            if reduceMotion || frames.isEmpty {
                Image(poster).resizable().scaledToFit()
            } else {
                TimelineView(.periodic(from: .now, by: 1 / 24)) { context in
                    Image(uiImage: frame(at: context.date))
                        .resizable()
                        .scaledToFit()
                }
            }
        }
        .task(id: asset) {
            guard !reduceMotion, frames.isEmpty else { return }
            frames = await OmoAtlasCache.shared.frames(
                asset: asset,
                columns: columns,
                rows: rows,
                count: frameCount
            )
            startedAt = .now
        }
        .accessibilityHidden(true)
    }

    private func frame(at date: Date) -> UIImage {
        let rawIndex = Int(max(0, date.timeIntervalSince(startedAt)) * 24)
        let index = loop ? rawIndex % frames.count : min(rawIndex, frames.count - 1)
        return frames[index]
    }
}

private actor OmoAtlasCache {
    static let shared = OmoAtlasCache()
    private var cache: [String: [UIImage]] = [:]

    func frames(asset: String, columns: Int, rows: Int, count: Int) -> [UIImage] {
        let key = "\(asset)-\(columns)x\(rows)-\(count)"
        if let cached = cache[key] { return cached }
        guard let source = UIImage(named: asset), let image = source.cgImage else { return [] }
        let width = image.width / columns
        let height = image.height / rows
        guard width > 0, height > 0 else { return [] }

        let result = (0..<count).compactMap { index -> UIImage? in
            let rect = CGRect(
                x: (index % columns) * width,
                y: (index / columns) * height,
                width: width,
                height: height
            )
            guard let frame = image.cropping(to: rect) else { return nil }
            return UIImage(cgImage: frame, scale: source.scale, orientation: source.imageOrientation)
        }
        cache[key] = result
        return result
    }
}

struct OmoSparkBurst: View {
    let trigger: Int
    var tint = Color.yellow
    @State private var expanded = false

    var body: some View {
        ZStack {
            ForEach(0..<12, id: \.self) { index in
                Image(index.isMultiple(of: 3) ? "OmoParticleGlow" : "OmoParticleSpark")
                    .resizable()
                    .renderingMode(.template)
                    .foregroundStyle(tint.opacity(0.8))
                    .frame(width: index.isMultiple(of: 3) ? 18 : 10, height: index.isMultiple(of: 3) ? 18 : 10)
                    .offset(expanded ? destination(for: index) : .zero)
                    .scaleEffect(expanded ? 0.35 : 1.15)
                    .opacity(expanded ? 0 : 1)
            }
        }
        .onAppear(perform: play)
        .onChange(of: trigger) { _, _ in play() }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    private func destination(for index: Int) -> CGSize {
        let angle = CGFloat(index) / 12 * .pi * 2
        let radius = CGFloat(72 + (index % 3) * 18)
        return CGSize(width: cos(angle) * radius, height: sin(angle) * radius)
    }

    private func play() {
        expanded = false
        withAnimation(.easeOut(duration: 0.72)) { expanded = true }
    }
}

struct OmoOrbit: View {
    @State private var turns = false

    var body: some View {
        ZStack {
            Ellipse()
                .trim(from: 0.08, to: 0.82)
                .stroke(Color.white.opacity(0.6), style: StrokeStyle(lineWidth: 5, lineCap: .round))
                .frame(width: 320, height: 155)
                .rotationEffect(.degrees(turns ? 342 : -18))
            ForEach(0..<6, id: \.self) { index in
                Circle()
                    .fill(index.isMultiple(of: 2) ? Color.yellow : Color.white)
                    .frame(width: 5, height: 5)
                    .offset(x: CGFloat(index - 3) * 42, y: CGFloat(index.isMultiple(of: 2) ? -64 : 58))
                    .opacity(turns ? 0.25 : 0.9)
            }
        }
        .onAppear {
            withAnimation(.linear(duration: 1.5).repeatForever(autoreverses: false)) { turns = true }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}


struct SpringPressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.965 : 1)
            .brightness(configuration.isPressed ? -0.04 : 0)
            .animation(.spring(response: 0.24, dampingFraction: 0.72), value: configuration.isPressed)
    }
}
