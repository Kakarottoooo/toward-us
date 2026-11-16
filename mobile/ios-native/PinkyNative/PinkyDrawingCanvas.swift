import SwiftUI

/// A native sketch canvas using the same normalized strokes as both play APIs.
struct PinkyDrawingCanvas: View {
    @Binding var strokes: [PinkyStroke]
    let language: PinkyLanguage
    let editable: Bool

    @Environment(\.colorScheme) private var colorScheme
    @State private var selectedInk: String = "rose"
    @GestureState private var penDown = false
    @State private var activeStroke: Int?
    private let inks = ["rose", "blue", "ink"]
    private let extent: CGFloat = 255
    private let maxStrokes = 16
    private let maxPoints = 480

    private var pointsCount: Int { strokes.reduce(0) { $0 + $1.points.count } }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            GeometryReader { geometry in
                sketch
                    .contentShape(Rectangle())
                    .gesture(
                        DragGesture(minimumDistance: 0)
                            .updating($penDown) { _, down, _ in down = true }
                            .onChanged { addPoint($0.location, size: geometry.size) },
                        including: editable ? .all : .none
                    )
            }
            .aspectRatio(1.65, contentMode: .fit)
            .background(Color(uiColor: .secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 17))
            .overlay(RoundedRectangle(cornerRadius: 17).strokeBorder(.quaternary, lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: 17))
            .accessibilityLabel(language.text("画布", "Drawing canvas", "Lienzo"))
            .accessibilityValue(
                strokes.isEmpty
                    ? language.text("空白", "Blank", "Vacío")
                    : language.text("有绘画笔迹", "Contains a sketch", "Contiene un dibujo")
            )
            .onChange(of: penDown) { _, down in
                if !down { activeStroke = nil }
            }

            if editable {
                HStack(spacing: 8) {
                    ForEach(inks, id: \.self) { ink in
                        Button {
                            selectedInk = ink
                        } label: {
                            ZStack {
                                Circle().fill(color(for: ink)).frame(width: 22, height: 22)
                                if ink == selectedInk {
                                    Circle().strokeBorder(color(for: ink), lineWidth: 2).frame(width: 30, height: 30)
                                }
                            }
                            .frame(minWidth: 44, minHeight: 44)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(inkLabel(ink))
                        .accessibilityAddTraits(ink == selectedInk ? .isSelected : [])
                    }
                    Spacer(minLength: 0)
                    Button {
                        activeStroke = nil
                        if !strokes.isEmpty { strokes.removeLast() }
                    } label: {
                        Image(systemName: "arrow.uturn.backward")
                            .frame(minWidth: 44, minHeight: 44)
                    }
                    .accessibilityLabel(language.text("撤销一笔", "Undo last stroke", "Deshacer trazo"))
                    .disabled(strokes.isEmpty || penDown)

                    Button {
                        activeStroke = nil
                        strokes = []
                    } label: {
                        Image(systemName: "trash")
                            .frame(minWidth: 44, minHeight: 44)
                    }
                    .accessibilityLabel(language.text("清空画布", "Clear drawing", "Borrar dibujo"))
                    .disabled(strokes.isEmpty || penDown)
                }
                .buttonStyle(.plain)

                if strokes.count >= maxStrokes || pointsCount >= maxPoints {
                    Text(language.text("画布快满了，可以撤销一笔再画。", "Undo a stroke to make more room.", "Deshaz un trazo para seguir dibujando."))
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    private var sketch: some View {
        Canvas { context, size in
            for stroke in strokes.prefix(maxStrokes) {
                let points = stroke.points.prefix(maxPoints).compactMap { point -> CGPoint? in
                    guard point.count == 2,
                          (0...255).contains(point[0]), (0...255).contains(point[1]) else { return nil }
                    return CGPoint(x: CGFloat(point[0]) * size.width / extent, y: CGFloat(point[1]) * size.height / extent)
                }
                guard let first = points.first else { continue }
                let ink = color(for: stroke.color)
                if points.count == 1 {
                    let dot = CGRect(x: first.x - 1.75, y: first.y - 1.75, width: 3.5, height: 3.5)
                    context.fill(Path(ellipseIn: dot), with: .color(ink))
                } else {
                    var line = Path()
                    line.move(to: first)
                    line.addLines(Array(points.dropFirst()))
                    context.stroke(line, with: .color(ink), style: StrokeStyle(lineWidth: 3.5, lineCap: .round, lineJoin: .round))
                }
            }
        }
    }

    private func addPoint(_ point: CGPoint, size: CGSize) {
        guard editable, size.width > 0, size.height > 0, point.x.isFinite, point.y.isFinite, pointsCount < maxPoints else { return }
        let x = Int((min(1, max(0, point.x / size.width)) * extent).rounded())
        let y = Int((min(1, max(0, point.y / size.height)) * extent).rounded())
        if let index = activeStroke, strokes.indices.contains(index) {
            let stroke = strokes[index]
            if let last = stroke.points.last, last.count == 2, abs(x - last[0]) + abs(y - last[1]) < 2 { return }
            strokes[index] = PinkyStroke(color: stroke.color, points: stroke.points + [[x, y]])
        } else if strokes.count < maxStrokes {
            activeStroke = strokes.count
            strokes.append(PinkyStroke(color: selectedInk, points: [[x, y]]))
        }
    }

    private func color(for ink: String) -> Color {
        switch ink {
        case "rose": Color(red: 0.76, green: 0.29, blue: 0.43)
        case "blue": Color(red: 0.23, green: 0.39, blue: 0.60)
        default: colorScheme == .dark ? .white : Color(red: 0.30, green: 0.20, blue: 0.25)
        }
    }

    private func inkLabel(_ ink: String) -> String {
        switch ink {
        case "rose": language.text("粉色", "Rose", "Rosa")
        case "blue": language.text("蓝色", "Blue", "Azul")
        default: language.text("墨色", "Ink", "Tinta")
        }
    }
}
