import SwiftUI
import UIKit
import PhotosUI
import ImageIO
import UniformTypeIdentifiers

struct NativeDistanceView: View {
    let api: PinkyAPI
    let userId: String
    let language: PinkyLanguage
    let paired: Bool
    let onPair: () -> Void

    @Environment(\.scenePhase) private var scenePhase
    @FocusState private var noteFocused: Bool
    @State private var board: Board?
    @State private var serverOffset: TimeInterval = 0
    @State private var mode: Mode = .note
    @State private var note = ""
    @State private var strokes: [PinkyStroke] = []
    @State private var photoSelection: PhotosPickerItem?
    @State private var photo: Data?
    @State private var preparingPhoto = false
    @State private var privatePhotoId: String?
    @State private var pendingIds: [Mode: String] = [:]
    @State private var joiningId: String?
    @State private var feltId: String?
    @State private var loading = false
    @State private var sending = false
    @State private var changingTouch = false
    @State private var offline = false
    @State private var loadFailure: String?
    @State private var actionFailure: String?
    @State private var sent = false

    private enum Mode: String, CaseIterable, Codable { case note, doodle, photo }

    private struct Card: Decodable, Identifiable {
        let cardId: String
        let userId: String
        let kind: Mode
        let at: String
        let text: String?
        let strokes: [PinkyStroke]?
        let photoId: String?
        var id: String { userId + ":" + cardId }

        enum CodingKeys: String, CodingKey {
            case cardId = "id"
            case userId, kind, at, text, strokes, photoId
        }
    }

    private struct Touch: Decodable {
        let id: String
        let userId: String?
        let expiresAt: Double
        let matched: Bool
        let joinId: String?
    }

    private struct Board: Decodable {
        let version: Int
        let now: Double
        let cards: [Card]
        let touch: Touch?
        let partner: String
        let readOnly: Bool
    }

    private struct CardInput: Encodable {
        let id: String
        let kind: Mode
        let language: String
        var text: String?
        var strokes: [PinkyStroke]?
        var photoId: String?
    }

    private struct TouchInput: Encodable {
        let action: String
        let id: String
        let language: String
    }

    private struct UploadedPhoto: Decodable {
        struct StoredPhoto: Decodable { let id: String }
        let photo: StoredPhoto
    }

    private var identity: String { "\(userId):\(paired)" }
    private var locked: Bool { !paired || board?.readOnly != false }
    private var stopped: Bool { locked || offline }
    private var noteDraft: Binding<String> {
        Binding(get: { note }, set: { value in
            note = String(value.prefix(180))
            pendingIds[.note] = nil
            sent = false
        })
    }
    private var drawingDraft: Binding<[PinkyStroke]> {
        Binding(get: { strokes }, set: { value in
            strokes = value
            pendingIds[.doodle] = nil
            sent = false
        })
    }
    private var maySend: Bool {
        switch mode {
        case .note: !note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        case .doodle: !strokes.isEmpty
        case .photo: photo != nil && !preparingPhoto
        }
    }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 18) {
                if !paired {
                    ContentUnavailableView {
                        Label(language.text("远远也能在一起", "Together from afar", "Juntos a la distancia"), systemImage: "heart")
                    } description: {
                        Text(language.text("配对后可以互相留小卡、一起碰一下。", "Link with your partner to leave little cards and tap together.", "Vincúlense para enviarse tarjetas y darse un toque."))
                    } actions: {
                        Button(language.text("和 TA 配对", "Link with your partner", "Vincular con mi pareja"), action: onPair)
                            .buttonStyle(.borderedProminent)
                    }
                } else {
                    if let loadFailure {
                        VStack(alignment: .leading, spacing: 8) {
                            Label(loadFailure, systemImage: "exclamationmark.circle")
                                .font(.subheadline)
                            Button(language.text("重试", "Try again", "Reintentar")) {
                                Task { await refresh() }
                            }
                            .buttonStyle(.bordered)
                            .disabled(loading)
                        }
                    }
                    if let actionFailure {
                        Label(actionFailure, systemImage: "exclamationmark.circle")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .accessibilityAddTraits(.updatesFrequently)
                    }
                    if board == nil && loadFailure == nil {
                        ProgressView(language.text("正在打开你们的小角落…", "Opening your space…", "Abriendo su espacio…"))
                            .frame(maxWidth: .infinity, minHeight: 120)
                    }
                    if board?.readOnly == true {
                        Text(language.text("这个空间目前仅可查看。", "This space is currently read-only.", "Por ahora este espacio es de solo lectura."))
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                    touchPanel
                    composer
                    if let board { recent(board) }
                }
            }
            .padding()
            .frame(maxWidth: 620)
            .frame(maxWidth: .infinity, alignment: .center)
        }
        .background(Color(uiColor: .systemGroupedBackground))
        .scrollDismissesKeyboard(.interactively)
        .refreshable { await refresh() }
        .task(id: "\(identity):\(language.rawValue):\(scenePhase == .active)") {
            guard paired, scenePhase == .active else { return }
            await refresh()
            while !Task.isCancelled {
                let interval: Duration = activeTouch(at: .now) == nil ? .seconds(3) : .milliseconds(800)
                do { try await Task.sleep(for: interval) } catch { return }
                await refresh()
            }
        }
        .task(id: photoSelection) { await preparePhoto(photoSelection) }
        .onChange(of: identity) { _, _ in reset() }
        .onChange(of: mode) { _, _ in
            noteFocused = false
            sent = false
            actionFailure = nil
        }
    }

    private var touchPanel: some View {
        GroupBox {
            TimelineView(.periodic(from: .now, by: 0.25)) { time in
                let touch = activeTouch(at: time.date)
                let waiting = touch?.userId == userId && touch?.matched == false
                VStack(alignment: .leading, spacing: 10) {
                    if touch?.matched == true {
                        Label(language.text("你们碰到了。", "Your touches met.", "Sus toques se encontraron."), systemImage: "heart.fill")
                            .font(.headline)
                            .foregroundStyle(Color.accentColor)
                    } else {
                        Text(touchCopy(touch, waiting: waiting))
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                        if let touch {
                            let left = max(0, Int(ceil(touch.expiresAt / 1000 - serverTime(near: time.date))))
                            Text(language.text("还剩 \(left) 秒", "\(left) seconds left", "Quedan \(left) segundos"))
                                .font(.caption.monospacedDigit())
                                .foregroundStyle(.secondary)
                        }
                        Button {
                            noteFocused = false
                            Task { await updateTouch(cancel: waiting) }
                        } label: {
                            Label(waiting ? language.text("取消等待", "Cancel waiting", "Dejar de esperar") : language.text("碰一下", "Tap together", "Tocar"), systemImage: waiting ? "xmark.circle" : "heart")
                                .frame(minHeight: 36)
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(stopped || changingTouch)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        } label: {
            Label(language.text("一起碰一下", "Tap together", "Un toque juntos"), systemImage: "heart")
        }
    }

    private var composer: some View {
        GroupBox {
            VStack(alignment: .leading, spacing: 12) {
                Picker(language.text("小卡类型", "Card type", "Tipo de tarjeta"), selection: $mode) {
                    ForEach(Mode.allCases, id: \.self) { item in
                        Text(modeLabel(item)).tag(item)
                    }
                }
                .pickerStyle(.segmented)
                .disabled(sending || locked)

                switch mode {
                case .note:
                    TextField(language.text("留一句话…", "Leave a little note…", "Deja una nota…"), text: noteDraft, axis: .vertical)
                        .lineLimit(3...5)
                        .textFieldStyle(.roundedBorder)
                        .focused($noteFocused)
                        .accessibilityLabel(language.text("小纸条", "Little note", "Nota"))
                        .disabled(sending || locked)
                case .doodle:
                    PinkyDrawingCanvas(strokes: drawingDraft, language: language, editable: !sending && !locked)
                case .photo:
                    photoComposer
                }

                Button {
                    noteFocused = false
                    Task { await sendCard() }
                } label: {
                    Label(sending ? language.text("发送中…", "Sending…", "Enviando…") : language.text("送给 TA", "Send to your partner", "Enviar a tu pareja"), systemImage: "paperplane")
                        .frame(minHeight: 36)
                }
                .buttonStyle(.borderedProminent)
                .disabled(stopped || sending || !maySend)

                if sent {
                    Label(language.text("小卡已放进你们的异地空间。", "Your little card is in your shared space.", "La tarjeta está en su espacio compartido."), systemImage: "checkmark.circle")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            .padding(.top, 4)
        } label: {
            Label(language.text("给 TA 留张小卡", "Leave a little card", "Déjale una tarjeta"), systemImage: "envelope")
        }
    }

    private var photoComposer: some View {
        VStack(alignment: .leading, spacing: 10) {
            if preparingPhoto {
                ProgressView(language.text("正在读取照片…", "Preparing photo…", "Preparando la foto…"))
            } else if let photo, let image = UIImage(data: photo) {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFit()
                    .frame(maxHeight: 180)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .accessibilityLabel(language.text("待发送的照片", "Photo to send", "Foto para enviar"))
            }
            HStack {
                PhotosPicker(selection: $photoSelection, matching: .images, preferredItemEncoding: .compatible) {
                    Label(photo == nil ? language.text("选择照片", "Choose photo", "Elegir foto") : language.text("换一张", "Choose another", "Elegir otra"), systemImage: "photo")
                        .frame(minHeight: 34)
                }
                .disabled(sending || locked)
                if photoSelection != nil {
                    Button(language.text("移除", "Remove", "Quitar"), role: .destructive) {
                        photoSelection = nil
                        photo = nil
                    }
                    .disabled(sending || locked)
                }
            }
            .buttonStyle(.bordered)
            Text(language.text("内测期间，照片可能在服务器更新后失效。", "During beta, photos may expire after a server update.", "Durante la beta, las fotos pueden caducar tras una actualización."))
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
    }

    private func recent(_ board: Board) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(language.text("最近的小卡", "Recent little cards", "Tarjetas recientes"))
                .font(.headline)
            if board.cards.isEmpty {
                Text(language.text("你们送出的小卡会留在这里。", "The cards you send appear here.", "Las tarjetas que envíen aparecerán aquí."))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            ForEach(board.cards.reversed()) { card in
                GroupBox {
                    Group {
                        switch card.kind {
                        case .note:
                            Text(card.text ?? "")
                                .textSelection(.enabled)
                        case .doodle:
                            PinkyDrawingCanvas(strokes: .constant(card.strokes ?? []), language: language, editable: false)
                        case .photo:
                            if let id = card.photoId {
                                DistancePhoto(api: api, id: id, language: language)
                            }
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                } label: {
                    HStack {
                        Text(card.userId == userId ? language.text("你", "You", "Tú") : board.partner)
                        Spacer()
                        Text(cardTime(card.at))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
    }

    private func refresh() async {
        guard paired, !loading, !sending, !changingTouch else { return }
        loading = true
        defer { loading = false }
        do {
            let remote: Board = try await api.get("/api/play-distance", query: [URLQueryItem(name: "language", value: language.rawValue)])
            guard !Task.isCancelled else { return }
            apply(remote)
            loadFailure = nil
            offline = false
        } catch {
            guard !Task.isCancelled else { return }
            offline = (error as? URLError).map { [.notConnectedToInternet, .networkConnectionLost].contains($0.code) } ?? false
            loadFailure = offline
                ? language.text("现在离线，还可以写草稿。", "You’re offline. You can still work on your draft.", "Sin conexión. Puedes seguir preparando el borrador.")
                : language.text("暂时没能刷新小卡。", "Couldn’t refresh your cards.", "No se pudieron actualizar las tarjetas.")
        }
    }

    private func apply(_ remote: Board) {
        if let board, (remote.version, remote.now) < (board.version, board.now) { return }
        board = remote
        serverOffset = remote.now / 1000 - Date.now.timeIntervalSince1970
        if scenePhase == .active, let touch = activeTouch(at: .now), touch.matched,
           let joiningId, touch.joinId == joiningId, feltId != touch.id {
            feltId = touch.id
            self.joiningId = nil
            UIImpactFeedbackGenerator(style: .soft).impactOccurred()
        }
    }

    private func updateTouch(cancel: Bool) async {
        guard !stopped, !changingTouch else { return }
        let id: String
        if cancel {
            guard let touch = activeTouch(at: .now), !touch.matched, touch.userId == userId else { return }
            id = touch.id
            joiningId = nil
        } else {
            id = UUID().uuidString.lowercased()
            joiningId = id
        }
        changingTouch = true
        actionFailure = nil
        defer { changingTouch = false }
        do {
            let body = TouchInput(action: cancel ? "leave" : "join", id: id, language: language.rawValue)
            let remote: Board = try await api.post("/api/play-distance/touch", body: body)
            guard !Task.isCancelled else { return }
            apply(remote)
        } catch {
            guard !Task.isCancelled else { return }
            actionFailure = language.text("没能更新碰一下的状态，请重试。", "Couldn’t update the tap. Try again.", "No se pudo actualizar el toque. Inténtalo de nuevo.")
        }
    }

    private func sendCard() async {
        guard !stopped, !sending, maySend else { return }
        let kind = mode
        let id = pendingIds[kind] ?? UUID().uuidString.lowercased()
        pendingIds[kind] = id
        sending = true
        sent = false
        actionFailure = nil
        defer { sending = false }

        do {
            var body = CardInput(id: id, kind: kind, language: language.rawValue)
            switch kind {
            case .note: body.text = note.trimmingCharacters(in: .whitespacesAndNewlines)
            case .doodle: body.strokes = strokes
            case .photo:
                guard let photo else { return }
                if privatePhotoId == nil {
                    let result: UploadedPhoto = try await api.upload("/api/photos", data: photo, contentType: "image/jpeg")
                    guard !Task.isCancelled else { return }
                    privatePhotoId = result.photo.id
                }
                body.photoId = privatePhotoId
            }
            let remote: Board = try await api.post("/api/play-distance/cards", body: body)
            guard !Task.isCancelled else { return }
            apply(remote)
            pendingIds[kind] = nil
            switch kind {
            case .note: note = ""
            case .doodle: strokes = []
            case .photo:
                photoSelection = nil
                photo = nil
                privatePhotoId = nil
            }
            sent = true
        } catch {
            guard !Task.isCancelled else { return }
            actionFailure = language.text("小卡没发出去，草稿还在。", "The card didn’t send. Your draft is still here.", "La tarjeta no se envió. El borrador sigue aquí.")
        }
    }

    private func preparePhoto(_ selection: PhotosPickerItem?) async {
        photo = nil
        privatePhotoId = nil
        pendingIds[.photo] = nil
        guard let selection else { preparingPhoto = false; return }
        preparingPhoto = true
        actionFailure = nil
        defer { if selection == photoSelection { preparingPhoto = false } }

        do {
            guard let original = try await selection.loadTransferable(type: Data.self), original.count <= 40_000_000 else {
                throw CocoaError(.fileReadTooLarge)
            }
            let resized = await Task.detached(priority: .userInitiated) { Self.normalizePhoto(original) }.value
            guard !Task.isCancelled, selection == photoSelection else { return }
            guard let resized else { throw CocoaError(.fileReadCorruptFile) }
            photo = resized
            sent = false
        } catch {
            guard !Task.isCancelled, selection == photoSelection else { return }
            actionFailure = language.text("没能读取照片，请换一张。", "Couldn’t read this photo. Choose another.", "No se pudo leer la foto. Elige otra.")
        }
    }

    nonisolated private static func normalizePhoto(_ original: Data) -> Data? {
        guard let source = CGImageSourceCreateWithData(original as CFData, nil),
              let thumbnail = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceThumbnailMaxPixelSize: 1_440,
              ] as CFDictionary) else { return nil }
        guard let buffer = CFDataCreateMutable(nil, 0),
              let destination = CGImageDestinationCreateWithData(buffer, UTType.jpeg.identifier as CFString, 1, nil) else { return nil }
        CGImageDestinationAddImage(destination, thumbnail, [kCGImageDestinationLossyCompressionQuality: 0.83] as CFDictionary)
        guard CGImageDestinationFinalize(destination), CFDataGetLength(buffer) < 8 * 1024 * 1024 else { return nil }
        return buffer as Data
    }

    private func serverTime(near date: Date) -> TimeInterval { date.timeIntervalSince1970 + serverOffset }

    private func activeTouch(at date: Date) -> Touch? {
        guard let touch = board?.touch, touch.expiresAt / 1000 > serverTime(near: date) else { return nil }
        return touch
    }

    private func touchCopy(_ touch: Touch?, waiting: Bool) -> String {
        if waiting { return language.text("等 TA 也点一下。", "Waiting for your partner to tap.", "Esperando el toque de tu pareja.") }
        if touch != nil { return language.text("TA 刚点了，你也可以点一下。", "Your partner tapped. You can tap too.", "Tu pareja tocó. Tú también puedes tocar.") }
        return language.text("同时在线时，10 秒内各点一下。", "When you’re both online, tap within 10 seconds of each other.", "Si están en línea, toquen con menos de 10 segundos de diferencia.")
    }

    private func modeLabel(_ mode: Mode) -> String {
        switch mode {
        case .note: language.text("小纸条", "Note", "Nota")
        case .doodle: language.text("随手画", "Doodle", "Dibujo")
        case .photo: language.text("照片", "Photo", "Foto")
        }
    }

    private func cardTime(_ value: String) -> String {
        let iso = ISO8601DateFormatter()
        iso.formatOptions.insert(.withFractionalSeconds)
        guard let date = iso.date(from: value) else { return "" }
        return date.formatted(.dateTime.month().day().hour().minute().locale(Locale(identifier: language.rawValue == "zh" ? "zh-Hans" : language.rawValue)))
    }

    private func reset() {
        board = nil
        note = ""
        strokes = []
        photoSelection = nil
        photo = nil
        privatePhotoId = nil
        pendingIds = [:]
        joiningId = nil
        feltId = nil
        sent = false
        offline = false
        loadFailure = nil
        actionFailure = nil
    }
}

private struct DistancePhoto: View {
    let api: PinkyAPI
    let id: String
    let language: PinkyLanguage

    @State private var image: UIImage?
    @State private var failed = false

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFit()
                    .frame(maxHeight: 220)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .accessibilityLabel(language.text("收到的照片", "Shared photo", "Foto compartida"))
            } else if failed {
                VStack(alignment: .leading, spacing: 6) {
                    Text(language.text("这张照片暂时不能显示。", "This photo is unavailable.", "Esta foto no está disponible."))
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    Button(language.text("重试", "Try again", "Reintentar")) { Task { await load() } }
                        .buttonStyle(.bordered)
                }
            } else {
                ProgressView()
                    .frame(maxWidth: .infinity, minHeight: 80)
            }
        }
        .task(id: id) { await load() }
    }

    private func load() async {
        guard UUID(uuidString: id) != nil else { failed = true; return }
        failed = false
        do {
            let data = try await api.data("/api/photos/\(id)", query: [URLQueryItem(name: "w", value: "480")])
            guard !Task.isCancelled else { return }
            image = UIImage(data: data)
            failed = image == nil
        } catch {
            if !Task.isCancelled { failed = true }
        }
    }
}
