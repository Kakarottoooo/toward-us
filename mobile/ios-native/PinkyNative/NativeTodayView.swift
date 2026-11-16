import CryptoKit
import SwiftUI

struct NativeTodayView: View {
    let api: PinkyAPI
    let userId: String
    let language: PinkyLanguage
    let paired: Bool
    let onPair: () -> Void
    var onDiscuss: ((String) -> Void)? = nil

    @Environment(\.scenePhase) private var scenePhase
    @State private var tab: Page = .daily
    @State private var together: NativeTogetherPage?
    @State private var deck: NativeDeck?
    @State private var dailyId: String?
    @State private var cardId: String?
    @State private var expandedHistory = false
    @State private var error: String?
    @State private var viewerId: String?
    @State private var readSerial = 0

    private enum Page: String, Hashable { case daily, deck }
    private var query: [URLQueryItem] {
        [.init(name: "language", value: language.rawValue), .init(name: "timezone", value: TimeZone.current.identifier)]
    }
    private var questions: [NativeDailyMessage] {
        Array((together?.conversation.messages ?? []).filter { $0.kind == "daily_question" }.reversed())
    }
    private var selectedQuestion: NativeDailyMessage? {
        questions.first { $0.id == dailyId } ?? questions.first
    }
    private var visibleCard: NativeDeckCard? {
        guard let deck else { return nil }
        return deck.cards.first { $0.id == cardId }
            ?? deck.cards.first { card in deck.rounds.contains { $0.cardId == card.id && $0.answers[userId] == nil } }
            ?? deck.cards.first
    }
    private var partnerName: String {
        together?.members.first { $0.id != userId }?.name ?? language.text("TA", "Your partner", "Tu pareja")
    }
    private var refreshKey: String { "\(userId):\(tab.rawValue):\(paired):\(language.rawValue):\(scenePhase == .active)" }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Picker(language.text("题卡", "Cards", "Tarjetas"), selection: $tab) {
                    Text(language.text("今天", "Today", "Hoy")).tag(Page.daily)
                    Text(language.text("更多玩法", "More games", "Más juegos")).tag(Page.deck)
                }
                .pickerStyle(.segmented)
                .accessibilityIdentifier("native-play-card-tabs")
                if let error {
                    Label(error, systemImage: "exclamationmark.circle")
                        .font(.subheadline).foregroundStyle(.secondary)
                    Button(language.text("重试", "Try again", "Reintentar")) { Task { await refresh() } }
                }
                if let viewerId, viewerId != userId {
                    ProgressView()
                } else if tab == .daily {
                    dailyContent
                } else {
                    deckContent
                }
            }
            .frame(maxWidth: 560)
            .padding(18)
            .frame(maxWidth: .infinity)
        }
        .refreshable { await refresh() }
        .scrollDismissesKeyboard(.interactively)
        .task(id: refreshKey) {
            if viewerId != userId {
                together = nil
                deck = nil
                dailyId = nil
                cardId = nil
                viewerId = userId
            }
            error = nil
            guard scenePhase == .active else { return }
            await refresh()
            while !Task.isCancelled, paired {
                let needsQuestion = tab == .daily && selectedQuestion == nil
                let delay: UInt64 = needsQuestion ? 4_000_000_000 : 12_000_000_000
                do { try await Task.sleep(nanoseconds: delay) } catch { return }
                await refresh()
            }
        }
    }

    @ViewBuilder
    private var dailyContent: some View {
        if !paired {
            VStack(alignment: .leading, spacing: 10) {
                Label(language.text("每天一起玩一点", "A little play every day", "Un rato juntos cada día"), systemImage: "sparkles")
                    .font(.headline)
                Text(language.text("配对后，你们各自作答，再一起揭晓。", "Pair with your partner to answer separately and reveal together.", "Vincúlense para responder por separado y ver las respuestas juntos."))
                    .foregroundStyle(.secondary)
                Button(language.text("邀请伴侣", "Pair with your partner", "Vincularse en pareja"), action: onPair)
                    .buttonStyle(.borderedProminent)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        } else {
            if let question = selectedQuestion {
                dailyCard(question)
                if questions.count > 1 {
                    DisclosureGroup(language.text("以前的每日题", "Past daily cards", "Tarjetas anteriores"), isExpanded: $expandedHistory) {
                        VStack(alignment: .leading, spacing: 12) {
                            ForEach(questions.prefix(25)) { previous in
                                Button {
                                    dailyId = previous.id == questions.first?.id ? nil : previous.id
                                    expandedHistory = false
                                } label: {
                                    HStack(alignment: .top, spacing: 8) {
                                        Text(previous.prompt(in: language)).multilineTextAlignment(.leading)
                                        Spacer(minLength: 4)
                                        if previous.id == question.id { Image(systemName: "checkmark") }
                                    }
                                }
                                .buttonStyle(.borderless)
                            }
                        }
                        .padding(.top, 12)
                    }
                    if dailyId != nil {
                        Button(language.text("回到今天", "Back to today", "Volver a hoy")) { dailyId = nil }
                    }
                }
            } else if error == nil {
                ProgressView(language.text("Pinky 正在准备每日题…", "Pinky is preparing your daily card…", "Pinky está preparando su tarjeta…"))
            }
            if together?.readOnly == false {
                NativePlanView(
                    api: api, userId: userId, language: language,
                    questionId: selectedQuestion.flatMap { $0.revealed ? $0.id : nil }
                )
            }
        }
    }

    private func dailyCard(_ question: NativeDailyMessage) -> some View {
        let config = question.dailyPlay
        let options = config?.variants[language.rawValue]?.options ?? config?.variants["zh"]?.options ?? []
        let kind = config?.kind ?? "text"
        return NativePlayableCard(
            draftId: "daily:\(question.id)", userId: userId, language: language, partnerName: partnerName,
            title: question.day == NativePlayDate.day(Date()) ? dailyTitle(kind) : language.text("每日题", "Daily card", "Tarjeta diaria"),
            prompt: question.prompt(in: language), kind: kind, options: options, aboutUserId: config?.aboutUserId,
            answers: question.answers ?? [:], revealed: question.revealed, canReply: together?.readOnly == false,
            onDiscuss: discussion(for: question),
            send: { draft in
                let body = NativePlayAnswerRequest(draft: draft, kind: kind, language: language)
                let updated: NativeConversationResponse = try await api.post("/api/together/daily/\(question.id)/answer", body: body)
                if let previous = together, updated.conversation.version >= previous.conversation.version {
                    together = NativeTogetherPage(conversation: updated.conversation, members: previous.members, readOnly: previous.readOnly)
                }
            },
            recover: { await refresh() }
        )
        .id(question.id)
    }

    private func discussion(for question: NativeDailyMessage) -> (() -> Void)? {
        guard question.revealed, together?.readOnly == false, let onDiscuss else { return nil }
        let variants = question.dailyPlay?.variants
        let followup = variants?[language.rawValue]?.followup ?? variants?["zh"]?.followup
        let prompt = question.prompt(in: language)
        let draft = followup ?? language.text("我想接着聊聊「\(prompt)」。", "I’d like to talk more about “\(prompt)”.", "Me gustaría seguir hablando de «\(prompt)».")
        return { onDiscuss(draft) }
    }

    private func dailyTitle(_ kind: String) -> String {
        switch kind {
        case "choice": language.text("今日二选一", "Today’s quick pick", "Elección del día")
        case "guess": language.text("猜 TA 怎么选", "Guess the pick", "Adivina su elección")
        case "draw": language.text("一起画一画", "Draw together", "Dibujen juntos")
        default: language.text("今日一问", "Today’s question", "Pregunta del día")
        }
    }

    @ViewBuilder
    private var deckContent: some View {
        if let deck, let card = visibleCard {
            let round = deck.rounds.first { $0.cardId == card.id }
            let subject = round?.aboutUserId ?? (card.type == "guess" ? userId : nil)
            Picker(language.text("换一道题", "Choose a card", "Elige una tarjeta"), selection: Binding(
                get: { card.id }, set: { cardId = $0 }
            )) {
                ForEach(deck.cards) { choice in Text(choice.title).tag(choice.id) }
            }
            .pickerStyle(.menu)
            if !paired {
                VStack(alignment: .leading, spacing: 12) {
                    Text(card.prompt).font(.title2.weight(.semibold))
                    Button(language.text("邀请伴侣一起玩", "Pair up to play", "Vincúlense para jugar"), action: onPair)
                        .buttonStyle(.borderedProminent)
                }
                .nativePlayPanel()
            } else {
                NativePlayableCard(
                    draftId: "deck:\(card.id):\(subject ?? "")", userId: userId, language: language, partnerName: partnerName,
                    title: card.title, prompt: card.prompt, kind: card.type, options: card.options, aboutUserId: subject,
                    answers: round?.answers ?? [:], revealed: round?.revealed == true, canReply: !deck.readOnly,
                    onDiscuss: nil,
                    send: { draft in
                        let body = NativePlayAnswerRequest(draft: draft, kind: card.type, language: language, aboutUserId: subject)
                        let updated: NativeDeck = try await api.post("/api/together/play/\(card.id)/answer", body: body)
                        if updated.version >= (self.deck?.version ?? 0) { self.deck = updated }
                    },
                    recover: { await refresh() }
                )
                .id("\(card.id):\(subject ?? "")")
                if let round, round.revealed {
                    NativeDeckReplies(
                        api: api, language: language, userId: userId, partnerName: partnerName,
                        card: card, replies: round.replies, readOnly: deck.readOnly
                    ) { updated in
                        if updated.version >= (self.deck?.version ?? 0) { self.deck = updated }
                    }
                    .id(round.id)
                    if !deck.readOnly {
                        NativePlanView(api: api, userId: userId, language: language, questionId: round.id, preferPending: false)
                    }
                }
            }
        } else if error == nil {
            ProgressView(language.text("载入题卡…", "Loading cards…", "Cargando tarjetas…"))
        }
    }

    @MainActor
    private func refresh() async {
        // A pull-to-refresh and the foreground poll can overlap. Ignore an older response after a save.
        guard paired || tab == .deck else { return }
        let page = tab
        readSerial &+= 1
        let serial = readSerial
        do {
            if page == .daily {
                let result: NativeTogetherPage = try await api.get("/api/together", query: query)
                guard !Task.isCancelled, serial == readSerial else { return }
                if result.conversation.version >= (together?.conversation.version ?? 0) { together = result }
            } else {
                let result: NativeDeck = try await api.get("/api/together/play", query: query)
                guard !Task.isCancelled, serial == readSerial else { return }
                if result.version >= (deck?.version ?? 0) { deck = result }
                if paired && together == nil {
                    let shared: NativeTogetherPage = try await api.get("/api/together", query: query)
                    guard !Task.isCancelled, serial == readSerial else { return }
                    if shared.conversation.version >= (together?.conversation.version ?? 0) { together = shared }
                }
            }
            if page == tab { error = nil }
        } catch {
            if !Task.isCancelled, serial == readSerial, page == tab { self.error = error.localizedDescription }
        }
    }
}

private struct NativeTogetherPage: Decodable {
    let conversation: NativePlayConversation
    let members: [Member]
    let readOnly: Bool
    struct Member: Decodable { let id: String; let name: String }
}

private struct NativePlayConversation: Decodable {
    let version: Int
    let messages: [NativeDailyMessage]
}

private struct NativeConversationResponse: Decodable {
    let conversation: NativePlayConversation
}

private struct NativeDailyMessage: Decodable, Identifiable {
    let id: String
    let kind: String
    let text: String?
    let day: String?
    let i18n: [String: String]?
    let translations: [String: Translation]?
    let dailyPlay: Play?
    let answers: [String: NativePlayAnswer]?

    var revealed: Bool { (answers?.count ?? 0) == 2 }
    func prompt(in language: PinkyLanguage) -> String { i18n?[language.rawValue] ?? translations?[language.rawValue]?.text ?? text ?? "" }

    struct Translation: Decodable { let text: String? }
    struct Play: Decodable {
        let kind: String
        let aboutUserId: String?
        let variants: [String: Variant]
        struct Variant: Decodable { let options: [String]?; let followup: String? }
    }
}

private struct NativeDeck: Decodable {
    let cards: [NativeDeckCard]
    let rounds: [Round]
    let version: Int
    let readOnly: Bool
    struct Round: Decodable {
        let id: String
        let cardId: String
        let aboutUserId: String?
        let answers: [String: NativePlayAnswer]
        let revealed: Bool
        let replies: [NativeDeckReply]
    }
}

private struct NativeDeckCard: Decodable, Identifiable {
    let id: String
    let type: String
    let title: String
    let prompt: String
    let options: [String]
    let followup: String
}

private struct NativeDeckReply: Decodable, Identifiable {
    let id: String
    let userId: String
    let text: String
}

private struct NativePlayAnswer: Decodable {
    let text: String?
    let choice: Int?
    let drawing: [PinkyStroke]?
}

private struct NativePlayDraft: Codable, Equatable {
    var text = ""
    var choice: Int?
    var strokes: [PinkyStroke] = []
    var useWords = false
    var deferred = false

    init() {}
    init(answer: NativePlayAnswer, kind: String) {
        text = answer.text ?? ""
        choice = answer.choice
        strokes = answer.drawing ?? []
        useWords = kind == "draw" && answer.drawing == nil
    }
}

private struct NativePlayAnswerRequest: Encodable {
    let language: String
    let text: String?
    let choice: Int?
    let drawing: [PinkyStroke]?
    let aboutUserId: String?

    init(draft: NativePlayDraft, kind: String, language: PinkyLanguage, aboutUserId: String? = nil) {
        self.language = language.rawValue
        self.aboutUserId = aboutUserId
        let isChoice = kind == "choice" || kind == "guess"
        let isDrawing = kind == "draw" && !draft.useWords
        text = isChoice || isDrawing ? nil : draft.text.trimmingCharacters(in: .whitespacesAndNewlines)
        choice = isChoice ? draft.choice : nil
        drawing = isDrawing ? draft.strokes : nil
    }
}

private struct NativePlayableCard: View {
    let draftId: String
    let userId: String
    let language: PinkyLanguage
    let partnerName: String
    let title: String
    let prompt: String
    let kind: String
    let options: [String]
    let aboutUserId: String?
    let answers: [String: NativePlayAnswer]
    let revealed: Bool
    let canReply: Bool
    let onDiscuss: (() -> Void)?
    let send: (NativePlayDraft) async throws -> Void
    let recover: () async -> Void

    @State private var draft = NativePlayDraft()
    @State private var editing = false
    @State private var saving = false
    @State private var loaded = false
    @State private var error: String?
    @FocusState private var writing: Bool

    private var key: String { userId + ":" + draftId }
    private var mine: NativePlayAnswer? { answers[userId] }
    private var partner: NativePlayAnswer? { answers.first { $0.key != userId }?.value }
    private var textLimit: Int { draftId.hasPrefix("deck:") ? 400 : 600 }
    private var ready: Bool {
        if !options.isEmpty { return draft.choice.map { options.indices.contains($0) } ?? false }
        if kind == "draw" && !draft.useWords { return !draft.strokes.isEmpty }
        return !draft.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Label(title, systemImage: kind == "draw" ? "paintbrush.pointed" : "sparkles")
                .font(.subheadline.weight(.semibold)).foregroundStyle(PinkyTheme.accent)
            Text(prompt).font(.title2.weight(.bold)).accessibilityAddTraits(.isHeader)
            if kind == "guess" {
                Text(aboutUserId == userId
                     ? language.text("这题关于你，选你真的会做的事。", "Pick what you would actually do.", "Elige lo que realmente harías.")
                     : language.text("猜猜 TA 会怎么选。", "Guess what your partner will choose.", "Adivina qué elegirá tu pareja."))
                    .font(.subheadline).foregroundStyle(.secondary)
            }
            if revealed {
                if let mine, let partner, let left = mine.choice, let right = partner.choice {
                    Text(left == right
                         ? (kind == "guess" ? language.text("猜中了！", "You guessed it!", "¡Acertaron!") : language.text("你们选到一起了", "You picked the same", "Eligieron lo mismo"))
                         : language.text("你们选得不一样", "You picked differently", "Eligieron distinto"))
                        .font(.subheadline.weight(.semibold)).foregroundStyle(PinkyTheme.accent)
                }
                if let mine { answer(mine, name: language.text("你的答案", "Your answer", "Tu respuesta")) }
                if let partner { answer(partner, name: partnerName) }
                if let onDiscuss {
                    Button(language.text("接着聊这题", "Keep talking", "Seguir hablando"), action: onDiscuss)
                        .buttonStyle(.bordered)
                }
            } else if let mine, !editing {
                answer(mine, name: language.text("你的答案", "Your answer", "Tu respuesta"))
                Label(language.text("等 TA 回答后一起揭晓", "You’ll reveal together after your partner answers", "Verán las dos respuestas cuando tu pareja responda"), systemImage: "lock")
                    .font(.subheadline).foregroundStyle(.secondary)
                if canReply {
                    Button(language.text("修改答案", "Edit answer", "Editar respuesta")) {
                        draft = NativePlayDraft(answer: mine, kind: kind)
                        editing = true
                    }
                }
            } else if canReply {
                if draft.deferred {
                    Button(language.text("继续作答", "Continue answering", "Seguir respondiendo")) { draft.deferred = false }
                        .buttonStyle(.borderedProminent)
                } else {
                    editor
                    Label(language.text("双方都回答后才会揭晓", "Answers stay private until you both respond", "Las respuestas son privadas hasta que ambos respondan"), systemImage: "lock")
                        .font(.footnote).foregroundStyle(.secondary)
                    HStack {
                        Button {
                            Task { await submit() }
                        } label: {
                            if saving { ProgressView().tint(.white) }
                            else { Text(language.text("锁好我的答案", "Seal my answer", "Sellar mi respuesta")) }
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(!ready || saving || !loaded)
                        if mine == nil {
                            Button(language.text("稍后", "Later", "Después")) {
                                writing = false
                                draft.deferred = true
                            }
                            .disabled(saving)
                        }
                    }
                }
            }
            if let error { Text(error).font(.footnote).foregroundStyle(.secondary) }
        }
        .nativePlayPanel()
        .task(id: key) {
            guard !revealed else {
                NativeDraftFile.store(nil, key: key)
                return
            }
            if let stored = NativeDraftFile.load(key: key) {
                draft = stored
                editing = mine != nil
            }
            loaded = true
        }
        .task(id: draft) {
            guard loaded, !revealed else { return }
            do { try await Task.sleep(nanoseconds: 250_000_000) } catch { return }
            if !Task.isCancelled { preserveDraft() }
        }
        .onDisappear { if loaded { preserveDraft() } }
        .onChange(of: revealed) { _, nowRevealed in
            if nowRevealed {
                writing = false
                NativeDraftFile.store(nil, key: key)
            }
        }
    }

    @ViewBuilder
    private var editor: some View {
        if !options.isEmpty {
            ForEach(Array(options.enumerated()), id: \.offset) { index, label in
                Button { draft.choice = index } label: {
                    HStack {
                        Text(label).multilineTextAlignment(.leading)
                        Spacer(minLength: 4)
                        Image(systemName: draft.choice == index ? "largecircle.fill.circle" : "circle")
                    }.frame(maxWidth: .infinity, alignment: .leading)
                }
                .buttonStyle(.bordered)
                .accessibilityAddTraits(draft.choice == index ? [.isSelected] : [])
                .disabled(saving)
            }
        } else {
            if kind == "draw", !draft.useWords {
                PinkyDrawingCanvas(strokes: $draft.strokes, language: language, editable: !saving)
            } else {
                TextField(language.text("写下你的答案…", "Write your answer…", "Escribe tu respuesta…"), text: $draft.text, axis: .vertical)
                    .lineLimit(2...8)
                    .textFieldStyle(.roundedBorder)
                    .focused($writing)
                    .disabled(saving)
                    .onChange(of: draft.text) { _, value in
                        if value.utf16.count > textLimit { draft.text = nativePlayBoundedText(value, limit: textLimit) }
                    }
            }
            if kind == "draw" {
                Button(draft.useWords ? language.text("改用画布", "Use the canvas", "Usar el lienzo") : language.text("用一句话描述", "Describe it in words", "Descríbelo con palabras")) {
                    writing = false
                    draft.useWords.toggle()
                }
                .disabled(saving)
            }
        }
    }

    private func answer(_ answer: NativePlayAnswer, name: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(name).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
            if let drawing = answer.drawing, !drawing.isEmpty {
                PinkyDrawingCanvas(strokes: .constant(drawing), language: language, editable: false)
            } else {
                let index = answer.choice
                Text(index.flatMap { options.indices.contains($0) ? options[$0] : nil } ?? answer.text ?? "")
                    .textSelection(.enabled)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(PinkyTheme.accent.opacity(0.08), in: RoundedRectangle(cornerRadius: 14))
    }

    private func preserveDraft() {
        NativeDraftFile.store(!revealed && (mine == nil || editing) && draft != NativePlayDraft() ? draft : nil, key: key)
    }

    @MainActor
    private func submit() async {
        guard !saving, canReply, ready, !revealed else { return }
        saving = true
        writing = false
        error = nil
        let submitted = draft
        defer { saving = false }
        do {
            try await send(submitted)
            editing = false
            draft = NativePlayDraft()
            NativeDraftFile.store(nil, key: key)
        } catch {
            self.error = error.localizedDescription
            // Another device or the partner may have completed the round while we were editing.
            await recover()
        }
    }
}

private enum NativeDraftFile {
    static func url(for key: String) -> URL? {
        guard let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else { return nil }
        var folder = support.appendingPathComponent("PinkyPlayDrafts", isDirectory: true)
        if !FileManager.default.fileExists(atPath: folder.path) {
            try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.complete])
            var values = URLResourceValues()
            values.isExcludedFromBackup = true
            try? folder.setResourceValues(values)
        }
        let digest = SHA256.hash(data: Data(key.utf8)).map { String(format: "%02x", $0) }.joined()
        return folder.appendingPathComponent(digest)
    }

    static func load(key: String) -> NativePlayDraft? {
        guard let url = url(for: key), let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(NativePlayDraft.self, from: data)
    }

    static func store(_ draft: NativePlayDraft?, key: String) {
        guard let url = url(for: key) else { return }
        if let draft, let data = try? JSONEncoder().encode(draft) {
            try? data.write(to: url, options: [.atomic, .completeFileProtection])
        } else {
            try? FileManager.default.removeItem(at: url)
        }
    }
}

extension View {
    func nativePlayPanel() -> some View {
        self.padding(18)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 24))
            .overlay { RoundedRectangle(cornerRadius: 24).strokeBorder(PinkyTheme.accent.opacity(0.13)) }
    }
}

private func nativePlayBoundedText(_ text: String, limit: Int) -> String {
    var limited = String(text.prefix(limit))
    while limited.utf16.count > limit { limited.removeLast() }
    return limited
}

private struct NativeDeckReplies: View {
    let api: PinkyAPI
    let language: PinkyLanguage
    let userId: String
    let partnerName: String
    let card: NativeDeckCard
    let replies: [NativeDeckReply]
    let readOnly: Bool
    let onUpdate: (NativeDeck) -> Void

    @State private var text = ""
    @State private var requestId = UUID().uuidString
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(language.text("接着聊这题", "Keep talking", "Seguir hablando")).font(.headline)
            if !card.followup.isEmpty {
                Text(card.followup).font(.subheadline).foregroundStyle(.secondary)
            }
            ForEach(replies) { reply in
                Text(reply.userId == userId ? language.text("你", "You", "Tú") : partnerName)
                    .font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                Text(reply.text)
            }
            if !readOnly {
                TextField(language.text("写给 TA…", "Write to your partner…", "Escribe a tu pareja…"), text: $text, axis: .vertical)
                    .lineLimit(1...5)
                    .textFieldStyle(.roundedBorder)
                    .disabled(busy)
                    .onChange(of: text) { _, value in
                        requestId = UUID().uuidString
                        if value.utf16.count > 600 { text = nativePlayBoundedText(value, limit: 600) }
                    }
                Button(language.text("发送回复", "Send reply", "Enviar respuesta")) { Task { await send() } }
                    .buttonStyle(.borderedProminent)
                    .disabled(busy || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
            if let error { Text(error).font(.footnote).foregroundStyle(.secondary) }
        }
        .nativePlayPanel()
    }

    @MainActor
    private func send() async {
        guard !busy, !readOnly else { return }
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        busy = true
        error = nil
        defer { busy = false }
        do {
            let updated: NativeDeck = try await api.post("/api/together/play/\(card.id)/reply",
                body: ReplyRequest(text: trimmed, clientId: requestId, language: language.rawValue))
            text = ""
            requestId = UUID().uuidString
            onUpdate(updated)
        } catch {
            self.error = error.localizedDescription
        }
    }

    struct ReplyRequest: Encodable {
        let text: String
        let clientId: String
        let language: String
    }
}
