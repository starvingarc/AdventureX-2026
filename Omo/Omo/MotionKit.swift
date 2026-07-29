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

struct ScratchRevealCanvas: View {
    let answer: String
    @Binding var progress: CGFloat
    let onReveal: () -> Void

    @State private var paths: [[CGPoint]] = []
    @State private var covered: Set<Int> = []
    private let columns = 12
    private let rows = 6

    var body: some View {
        GeometryReader { geometry in
            Canvas { context, size in
                let text = context.resolve(
                    Text(answer).font(.body.weight(.semibold)).foregroundStyle(Color(red: 0.58, green: 0.65, blue: 0.27))
                )
                context.draw(text, in: CGRect(x: 18, y: 18, width: size.width - 36, height: size.height - 36))

                context.drawLayer { layer in
                    let cover = Path(roundedRect: CGRect(origin: .zero, size: size), cornerRadius: 16)
                    layer.fill(cover, with: .color(Color(red: 0.90, green: 0.90, blue: 0.72)))
                    layer.blendMode = .destinationOut
                    for pathPoints in paths where pathPoints.count > 1 {
                        var path = Path()
                        path.move(to: rendered(pathPoints[0], in: size))
                        for point in pathPoints.dropFirst() { path.addLine(to: rendered(point, in: size)) }
                        layer.stroke(path, with: .color(.black), style: StrokeStyle(lineWidth: 30, lineCap: .round, lineJoin: .round))
                    }
                }
            }
            .drawingGroup()
            .overlay {
                if progress < 0.12 {
                    Label("刮开涂层，找回这句话", systemImage: "hand.draw.fill")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Color(red: 0.49, green: 0.49, blue: 0.43))
                        .allowsHitTesting(false)
                }
            }
            .contentShape(RoundedRectangle(cornerRadius: 16))
            .gesture(
                DragGesture(minimumDistance: 2)
                    .onChanged { value in
                        if paths.isEmpty || value.translation == .zero { paths.append([]) }
                        paths[paths.count - 1].append(normalized(value.location, in: geometry.size))
                        mark(value.location, in: geometry.size)
                    }
            )
        }
        .frame(minHeight: 112)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("被遮住的答案")
        .accessibilityValue("已刮开 \(Int(progress * 100))%")
        .accessibilityAction(named: "完整揭晓", onReveal)
    }

    private func normalized(_ point: CGPoint, in size: CGSize) -> CGPoint {
        CGPoint(x: min(1, max(0, point.x / size.width)), y: min(1, max(0, point.y / size.height)))
    }

    private func rendered(_ point: CGPoint, in size: CGSize) -> CGPoint {
        CGPoint(x: point.x * size.width, y: point.y * size.height)
    }

    private func mark(_ point: CGPoint, in size: CGSize) {
        let column = min(columns - 1, max(0, Int(point.x / size.width * CGFloat(columns))))
        let row = min(rows - 1, max(0, Int(point.y / size.height * CGFloat(rows))))
        for x in max(0, column - 1)...min(columns - 1, column + 1) {
            for y in max(0, row - 1)...min(rows - 1, row + 1) { covered.insert(y * columns + x) }
        }
        progress = CGFloat(covered.count) / CGFloat(columns * rows)
        if progress >= 0.42 { onReveal() }
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
