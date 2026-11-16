import Foundation
import SwiftUI

struct NativeChatView: View {
    let api: PinkyAPI
    let userId: String
    let language: PinkyLanguage
    let paired: Bool
    var canReadShared = false
    var relationshipId: String? = nil
    var playFollowup: Binding<String?> = .constant(nil)
    let onPair: () -> Void

    var body: some View {
        NativeChatPane(api: api, userId: userId, language: language, paired: paired,
                       canReadShared: canReadShared, playFollowup: playFollowup, onPair: onPair)
            .id(ChatIdentity(userId: userId, relationshipId: relationshipId, paired: paired, canReadShared: canReadShared))
    }
}

private struct ChatIdentity: Hashable {
    let userId: String
    let relationshipId: String?
    let paired: Bool
    let canReadShared: Bool
}

private enum ChatChannel: Hashable {
    case privateChat, together
}

private struct ChatMessage: Decodable, Identifiable {
    struct Translation: Decodable { let text: String? }

    let id: String
    let role: String
    let text: String?
    let actorUserId: String?
    let i18n: [String: String]?
    let translations: [String: Translation]?
    let cards: [ChatCard]?
    let photoIds: [String]?

    func content(in language: PinkyLanguage) -> String {
        i18n?[language.rawValue] ?? translations?[language.rawValue]?.text ?? text ?? ""
    }
}

private struct ChatCard: Decodable, Identifiable {
    let id: String
    let title: String?
    let text: String?
    let kind: String?
    let status: String?
    let digest: String?
    let openOn: String?

    var canShare: Bool {
        kind == "partner_message" && status == "draft" && digest != nil && !(text ?? "").isEmpty
    }
}

private struct ChatSession: Decodable {
    let id: String
    let version: Int?
    let messages: [ChatMessage]
    let earlierPages: Int?
}

private struct ChatMember: Decodable {
    let id: String
    let name: String
}

private struct PrivateChatResponse: Decodable { let session: ChatSession }
private struct SharedChatResponse: Decodable {
    let conversation: ChatSession
    let members: [ChatMember]
    let readOnly: Bool
}
private struct SharedSendResponse: Decodable { let conversation: ChatSession }
private struct ChatHistory: Decodable {
    let messages: [ChatMessage]
    let more: Bool?
}

private struct ChatStart: Encodable {
    let language: String
    let timezone: String
}

private struct ChatTurn: Encodable {
    let text: String
    let itemId: String
    let language: String
    let timezone: String
}

private struct ChatShare: Encodable {
    let cardId: String
    let digest: String
    let confirm = true
}

private struct ChatLane {
    var session: ChatSession?
    var earlier: [ChatMessage] = []
    var earlierPage = 0
    var hasMoreShared = true
    var members: [ChatMember] = []
    var readOnly = false
    var loaded = false
    var loading = false
    var paging = false
    var sending = false
    var issue: String?
    var draft = ""
    var retry: ChatTurn?
    var epoch = 0

    var messages: [ChatMessage] {
        var ids = Set<String>()
        return (earlier + (session?.messages ?? [])).filter { ids.insert($0.id).inserted }
    }

    func hasEarlier(_ channel: ChatChannel) -> Bool {
        if channel == .privateChat { return earlierPage < (session?.earlierPages ?? 0) }
        return hasMoreShared && !(session?.messages.isEmpty ?? true)
    }

    // Reads and write receipts can arrive out of order. Keep the latest revision of the same record.
    mutating func apply(_ next: ChatSession) {
        if let session, session.id == next.id,
           let previous = session.version, let incoming = next.version, incoming < previous { return }
        if session?.id != next.id || session?.messages.first?.id != next.messages.first?.id {
            earlier = []
            earlierPage = 0
            hasMoreShared = true
        }
        session = next
    }
}

@MainActor private final class ChatModel: ObservableObject {
    @Published var lanes: [ChatChannel: ChatLane] = [:]

    subscript(_ channel: ChatChannel) -> ChatLane {
        get { lanes[channel] ?? ChatLane() }
        set { lanes[channel] = newValue }
    }

    func load(_ channel: ChatChannel, api: PinkyAPI, language: PinkyLanguage,
              hasShared: Bool, quiet: Bool = false) async {
        var state = self[channel]
        guard !state.sending, !state.paging, !(quiet && state.loading) else { return }
        if channel == .together && !hasShared {
            // A change of pairing can revoke access while this screen remains open.
            self[channel] = ChatLane(epoch: state.epoch + 1)
            return
        }
        state.epoch += 1
        let epoch = state.epoch
        state.loading = true
        if !quiet && state.retry == nil { state.issue = nil }
        self[channel] = state
        defer { if self[channel].epoch == epoch { self[channel].loading = false } }

        do {
            var loaded = state
            switch channel {
            case .privateChat:
                if let id = state.session?.id {
                    do {
                        let result: PrivateChatResponse = try await api.get("/api/assistant/sessions/" + id)
                        loaded.apply(result.session)
                    } catch let error as PinkyAPIError where error.statusCode == 404 {
                        loaded.session = nil
                        loaded.earlier = []
                        loaded.earlierPage = 0
                        try await latestPrivate(&loaded, api: api)
                    }
                } else {
                    try await latestPrivate(&loaded, api: api)
                }
            case .together:
                let result: SharedChatResponse = try await api.get("/api/together", query: [
                    URLQueryItem(name: "language", value: language.rawValue),
                    URLQueryItem(name: "timezone", value: TimeZone.current.identifier)
                ])
                loaded.apply(result.conversation)
                loaded.members = result.members
                loaded.readOnly = result.readOnly
            }

            guard !Task.isCancelled, self[channel].epoch == epoch else { return }
            loaded.draft = self[channel].draft
            loaded.retry = self[channel].retry
            loaded.loaded = true
            loaded.issue = loaded.retry == nil ? nil : self[channel].issue
            self[channel] = loaded
        } catch {
            guard !Task.isCancelled, self[channel].epoch == epoch else { return }
            if let status = (error as? PinkyAPIError)?.statusCode,
               [401, 403, 409].contains(status), channel == .together {
                // A stale shared transcript should disappear when the server stops authorizing it.
                self[channel] = ChatLane(issue: error.localizedDescription, epoch: epoch)
            } else if !quiet || !self[channel].loaded {
                self[channel].issue = error.localizedDescription
            }
        }
    }

    private func latestPrivate(_ lane: inout ChatLane, api: PinkyAPI) async throws {
        do {
            let result: PrivateChatResponse = try await api.get("/api/assistant/sessions/latest")
            lane.apply(result.session)
        } catch let error as PinkyAPIError where error.statusCode == 404 {
            lane.session = nil
        }
    }

    func loadEarlier(_ channel: ChatChannel, api: PinkyAPI) async {
        let state = self[channel]
        guard let session = state.session, state.hasEarlier(channel),
              !state.loading, !state.sending, !state.paging else { return }
        let epoch = state.epoch
        self[channel].paging = true
        self[channel].issue = nil
        defer { if self[channel].epoch == epoch { self[channel].paging = false } }

        do {
            let result: ChatHistory
            switch channel {
            case .privateChat:
                result = try await api.get("/api/assistant/sessions/" + session.id + "/earlier", query: [
                    URLQueryItem(name: "page", value: String(state.earlierPage + 1))
                ])
            case .together:
                guard let first = state.messages.first else { return }
                result = try await api.get("/api/together/history", query: [
                    URLQueryItem(name: "before", value: first.id), URLQueryItem(name: "limit", value: "35")
                ])
            }
            guard !Task.isCancelled, self[channel].epoch == epoch else { return }
            self[channel].earlier.insert(contentsOf: result.messages, at: 0)
            if channel == .privateChat { self[channel].earlierPage += 1 }
            else { self[channel].hasMoreShared = result.more == true }
        } catch {
            guard !Task.isCancelled, self[channel].epoch == epoch else { return }
            self[channel].issue = error.localizedDescription
        }
    }

    func send(_ channel: ChatChannel, api: PinkyAPI, language: PinkyLanguage, mention: Bool) async {
        var state = self[channel]
        let draft = state.draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !draft.isEmpty, state.loaded, !state.sending, !state.readOnly else { return }
        let wasMentioned = draft.range(of: #"\bPinky\b|@agent"#, options: [.regularExpression, .caseInsensitive]) != nil
        let body = mention && channel == .together && !wasMentioned ? "@Pinky " + draft : draft
        guard body.utf16.count <= 2000 else {
            self[channel].issue = language.text("文字太长，请缩短一点。", "Please shorten this message.", "Acorta el mensaje.")
            return
        }
        let request = state.retry.flatMap { $0.text == body ? $0 : nil } ?? ChatTurn(
            text: body, itemId: UUID().uuidString, language: language.rawValue,
            timezone: TimeZone.current.identifier
        )
        state.retry = request
        state.sending = true
        state.loading = false
        state.paging = false
        state.issue = nil
        state.epoch += 1
        let epoch = state.epoch
        self[channel] = state
        defer { if self[channel].epoch == epoch { self[channel].sending = false } }

        do {
            let reply: ChatSession
            switch channel {
            case .privateChat:
                let id: String
                if let existing = state.session?.id { id = existing }
                else {
                    // A fresh account has no conversation until its first explicit send.
                    let created: PrivateChatResponse = try await api.post("/api/assistant/sessions", body: ChatStart(
                        language: language.rawValue, timezone: TimeZone.current.identifier
                    ))
                    guard self[channel].epoch == epoch else { return }
                    self[channel].apply(created.session)
                    id = created.session.id
                }
                let result: PrivateChatResponse = try await api.post("/api/assistant/sessions/" + id + "/messages", body: request)
                reply = result.session
            case .together:
                let result: SharedSendResponse = try await api.post("/api/together/messages", body: request)
                reply = result.conversation
            }
            guard self[channel].epoch == epoch else { return }
            self[channel].apply(reply)
            self[channel].retry = nil
            self[channel].draft = ""
        } catch {
            guard self[channel].epoch == epoch else { return }
            // A timeout can happen after the server received the turn. Keep its item ID for retry.
            self[channel].issue = error.localizedDescription
        }
    }

    func confirmShare(_ card: ChatCard, api: PinkyAPI) async -> Bool {
        let channel = ChatChannel.privateChat
        var state = self[channel]
        guard let session = state.session, let digest = card.digest,
              card.canShare, !state.sending, !state.loading else { return false }
        state.epoch += 1
        let epoch = state.epoch
        state.sending = true
        state.paging = false
        state.issue = nil
        self[channel] = state
        defer { if self[channel].epoch == epoch { self[channel].sending = false } }
        do {
            let response: PrivateChatResponse = try await api.post(
                "/api/assistant/sessions/" + session.id + "/share-confirm",
                body: ChatShare(cardId: card.id, digest: digest)
            )
            guard self[channel].epoch == epoch else { return false }
            self[channel].apply(response.session)
            return true
        } catch {
            guard self[channel].epoch == epoch else { return false }
            self[channel].issue = error.localizedDescription
            return false
        }
    }
}

@MainActor private struct NativeChatPane: View {
    let api: PinkyAPI
    let userId: String
    let language: PinkyLanguage
    let paired: Bool
    let canReadShared: Bool
    let playFollowup: Binding<String?>
    let onPair: () -> Void

    @Environment(\.scenePhase) private var scene
    @StateObject private var model = ChatModel()
    @State private var channel = ChatChannel.privateChat
    @State private var askPinky = false
    @State private var review: ChatCard?
    @FocusState private var composing: Bool

    private var state: ChatLane { model[channel] }
    private var hasShared: Bool { paired || canReadShared }
    private var privateTitle: String { language.text("只有我", "Just me", "Solo yo") }
    private var sharedTitle: String { language.text("我们俩", "Us", "Nosotros") }

    private struct Refresh: Equatable {
        let channel: ChatChannel
        let language: String
        let hasShared: Bool
        let active: Bool
    }

    var body: some View {
        VStack(spacing: 0) {
            Picker(language.text("聊天空间", "Conversation space", "Espacio de conversación"), selection: $channel) {
                Text(privateTitle).tag(ChatChannel.privateChat)
                Text(sharedTitle).tag(ChatChannel.together)
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, 20)
            .padding(.vertical, 12)

            if channel == .together && !hasShared {
                ContentUnavailableView {
                    Label(language.text("和 TA 一起用 Pinky", "Use Pinky with your partner", "Usa Pinky con tu pareja"),
                          systemImage: "person.2")
                } description: {
                    Text(language.text("配对以后，你们会有一个共同的聊天空间。",
                                       "Pair to open your shared conversation.",
                                       "Vincúlense para abrir su conversación compartida."))
                } actions: {
                    Button(language.text("去配对", "Pair with your partner", "Vincular pareja")) {
                        composing = false
                        onPair()
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                }
            } else {
                boundary
                timeline
                if state.readOnly || (channel == .together && !paired) {
                    if let issue = state.issue {
                        Label(issue, systemImage: "exclamationmark.circle")
                            .font(.footnote)
                            .padding(.horizontal, 20)
                    }
                    if state.loaded {
                        Label(language.text("你可以回看这段对话。", "You can revisit this conversation.", "Puedes volver a leer esta conversación."),
                              systemImage: "lock")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                            .padding(.vertical, 12)
                    }
                } else {
                    composer
                }
            }
        }
        .background(PinkyTheme.paper)
        .tint(PinkyTheme.accent)
        .onChange(of: channel) { _, _ in composing = false }
        .onChange(of: playFollowup.wrappedValue, initial: true) { _, _ in openPlayFollowup() }
        .onChange(of: model[.together].sending) { _, sending in
            if !sending { openPlayFollowup() }
        }
        .task(id: Refresh(channel: channel, language: language.rawValue, hasShared: hasShared, active: scene == .active)) {
            guard scene == .active else { return }
            let selected = channel
            await model.load(selected, api: api, language: language, hasShared: hasShared)
            // Refresh a visible shared room only. The server's shared timeline is the source of truth.
            if selected == .together && paired {
                while !Task.isCancelled {
                    do { try await Task.sleep(for: .seconds(7)) } catch { return }
                    await model.load(selected, api: api, language: language, hasShared: hasShared, quiet: true)
                }
            }
        }
        .sheet(item: $review, content: shareSheet)
    }

    private func openPlayFollowup() {
        let shared = model[.together]
        guard paired, !shared.readOnly, !shared.sending,
              let followup = playFollowup.wrappedValue,
              !followup.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        let prior = shared.draft
        model[.together].draft =
            prior.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? followup : prior + "\n\n" + followup
        channel = .together
        playFollowup.wrappedValue = nil
    }

    private var boundary: some View {
        let isPrivate = channel == .privateChat
        return Label(isPrivate
            ? language.text("私人对话 · 只有你和 Pinky", "Private · You and Pinky", "Privado · Solo tú y Pinky")
            : language.text("共同对话 · TA 也能看到", "Shared · Your partner can see this", "Compartido · Tu pareja también lo ve"),
            systemImage: isPrivate ? "lock.fill" : "person.2.fill")
        .font(.footnote.weight(.semibold))
        .foregroundStyle(PinkyTheme.ink)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 22)
        .padding(.bottom, 12)
    }

    @State private var tailVisible = false

    private var timeline: some View {
        let items = state.messages
        let tail = items.last?.id
        let selected = channel

        return ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 11) {
                    if !state.loaded && state.loading {
                        ProgressView(language.text("正在加载消息", "Loading messages", "Cargando mensajes"))
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 30)
                    } else if items.isEmpty && state.loaded {
                        ContentUnavailableView(
                            selected == .privateChat
                                ? language.text("想聊什么？", "What’s on your mind?", "¿Qué tienes en mente?")
                                : language.text("和 TA 打个招呼", "Say hello", "Saluda a tu pareja"),
                            systemImage: selected == .privateChat ? "sparkles" : "bubble.left.and.bubble.right",
                            description: Text(selected == .privateChat
                                ? language.text("也可以用系统键盘上的话筒说出来。", "You can also use your keyboard’s microphone.", "También puedes dictar con el micrófono del teclado.")
                                : language.text("你们发出的消息会留在这里。", "Messages you send together appear here.", "Sus mensajes compartidos aparecerán aquí."))
                        )
                    }

                    if state.hasEarlier(selected) {
                        Button {
                            let anchor = items.first?.id
                            Task {
                                await model.loadEarlier(selected, api: api)
                                if let anchor {
                                    await Task.yield()
                                    proxy.scrollTo(anchor, anchor: .top)
                                }
                            }
                        } label: {
                            if state.paging { ProgressView() }
                            else { Text(language.text("更早的消息", "Earlier messages", "Mensajes anteriores")) }
                        }
                        .buttonStyle(.bordered)
                        .disabled(state.paging)
                        .frame(maxWidth: .infinity)
                    }

                    ForEach(items) { item in
                        message(item, channel: selected)
                            .id(item.id)
                    }

                    Color.clear.frame(height: 1).id("chat-bottom")
                        .onAppear { tailVisible = true }
                        .onDisappear { tailVisible = false }
                        .accessibilityHidden(true)
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 12)
            }
            .scrollDismissesKeyboard(.interactively)
            .refreshable { await model.load(selected, api: api, language: language, hasShared: hasShared) }
            .task(id: selected) {
                proxy.scrollTo("chat-bottom", anchor: .bottom)
            }
            .onChange(of: tail) { previous, incoming in
                guard incoming != nil, previous == nil || tailVisible || state.sending else { return }
                proxy.scrollTo("chat-bottom", anchor: .bottom)
            }
        }
    }

    private func message(_ item: ChatMessage, channel selected: ChatChannel) -> some View {
        let mine = item.role == "user" || item.actorUserId == userId
        let author = mine ? language.text("你", "You", "Tú")
            : (item.role == "assistant" || item.role == "agent" ? "Pinky"
               : model[selected].members.first { $0.id == item.actorUserId }?.name
                 ?? language.text("TA", "Your partner", "Tu pareja"))
        let content = item.content(in: language)
        let photoCount = item.photoIds?.count ?? 0

        return HStack {
            if mine { Spacer(minLength: 22) }
            VStack(alignment: .leading, spacing: 6) {
                Text(author).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                if !content.isEmpty {
                    Text(content)
                        .font(.body)
                        .textSelection(.enabled)
                }
                if photoCount > 0 {
                    Label(language.text("照片 \(photoCount) 张", "\(photoCount) photos", "\(photoCount) fotos"), systemImage: "photo")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                if selected == .privateChat, let cards = item.cards {
                    ForEach(cards) { card in
                        cardSummary(card)
                    }
                }
            }
            .foregroundStyle(PinkyTheme.ink)
            .padding(.horizontal, 14)
            .padding(.vertical, 11)
            .background(mine ? PinkyTheme.accent.opacity(0.12) : Color.primary.opacity(0.055),
                        in: RoundedRectangle(cornerRadius: 17))
            if !mine { Spacer(minLength: 22) }
        }
    }

    private func cardSummary(_ card: ChatCard) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            if let title = card.title, !title.isEmpty { Text(title).font(.subheadline.weight(.semibold)) }
            if let text = card.text, !text.isEmpty { Text(text).font(.subheadline).textSelection(.enabled) }
            if card.canShare {
                Label(language.text("仅你可见的草稿", "Draft only you can see", "Borrador visible solo para ti"),
                      systemImage: "lock")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                if paired {
                    Button(language.text("确认发给 TA…", "Review and share…", "Revisar y compartir…")) {
                        composing = false
                        review = card
                    }
                    .buttonStyle(.bordered)
                    .disabled(state.sending)
                }
            } else if card.kind == "partner_message" && card.status == "shared" {
                Label(language.text("已确认发送", "Sharing confirmed", "Envío confirmado"), systemImage: "checkmark.circle")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(9)
        .background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 11))
    }

    private var composer: some View {
        let selected = channel
        let draft = Binding<String>(
            get: { model[selected].draft },
            set: { model[selected].draft = String($0.prefix(2000)) }
        )
        return VStack(alignment: .leading, spacing: 6) {
            if let issue = state.issue {
                HStack(spacing: 8) {
                    Label(issue, systemImage: "exclamationmark.circle")
                        .font(.footnote)
                    Spacer(minLength: 0)
                    if state.retry == nil {
                        Button(language.text("重试", "Retry", "Reintentar")) {
                            Task { await model.load(selected, api: api, language: language, hasShared: hasShared) }
                        }
                        .buttonStyle(.borderless)
                    }
                }
                .foregroundStyle(PinkyTheme.ink)
            }
            if state.sending {
                HStack {
                    ProgressView()
                    Text(language.text("正在发送…", "Sending…", "Enviando…"))
                        .font(.footnote).foregroundStyle(.secondary)
                }
                .accessibilityElement(children: .combine)
            }
            HStack(alignment: .bottom, spacing: 8) {
                if selected == .together {
                    Button {
                        askPinky.toggle()
                    } label: {
                        Image(systemName: "at")
                            .frame(minWidth: 32, minHeight: 32)
                    }
                    .buttonStyle(.bordered)
                    .tint(askPinky ? PinkyTheme.accent : .secondary)
                    .accessibilityLabel(language.text("叫 Pinky 来帮忙", "Ask Pinky to help", "Pedir ayuda a Pinky"))
                    .accessibilityAddTraits(askPinky ? .isSelected : [])
                    .disabled(state.sending)
                }

                TextField(selected == .privateChat
                    ? language.text("和 Pinky 聊聊", "Message Pinky", "Escribe a Pinky")
                    : language.text("发到「我们俩」", "Message Us", "Escribe en Nosotros"),
                    text: draft, axis: .vertical)
                    .lineLimit(1...5)
                    .textFieldStyle(.roundedBorder)
                    .focused($composing)
                    .disabled(state.sending || !state.loaded)

                Button {
                    composing = false
                    let mention = askPinky
                    Task {
                        await model.send(selected, api: api, language: language, mention: mention)
                        if model[selected].retry == nil && selected == .together { askPinky = false }
                    }
                } label: {
                    Image(systemName: "arrow.up")
                        .font(.headline.weight(.bold))
                        .frame(minWidth: 26, minHeight: 30)
                }
                .buttonStyle(.borderedProminent)
                .accessibilityLabel(selected == .privateChat
                    ? language.text("私下发给 Pinky", "Send privately to Pinky", "Enviar en privado a Pinky")
                    : language.text("发到「我们俩」", "Send to Us", "Enviar en Nosotros"))
                .disabled(state.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ||
                          state.sending || !state.loaded)
            }
        }
        .padding(.horizontal, 17)
        .padding(.vertical, 10)
        .background(.bar)
    }

    private func shareSheet(_ card: ChatCard) -> some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 17) {
                    Text(card.text ?? "").textSelection(.enabled)
                    if let date = card.openOn {
                        Label(date, systemImage: "calendar")
                        Text(language.text("这封信到选定日期才会揭晓。", "This letter opens on the selected date.", "Esta carta se abre en la fecha elegida."))
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                    if let issue = model[.privateChat].issue {
                        Label(issue, systemImage: "exclamationmark.circle")
                            .font(.footnote)
                    }
                    Button {
                        Task {
                            if await model.confirmShare(card, api: api) { review = nil }
                        }
                    } label: {
                        if model[.privateChat].sending { ProgressView().tint(.white) }
                        else { Text(language.text("确认分享给 TA", "Confirm sharing", "Confirmar y compartir")) }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(model[.privateChat].sending || !paired)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(22)
            }
            .navigationTitle(language.text("分享前核对", "Review before sharing", "Revisa antes de compartir"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(language.text("取消", "Cancel", "Cancelar")) { review = nil }
                        .disabled(model[.privateChat].sending)
                }
            }
        }
        .tint(PinkyTheme.accent)
        .presentationDetents([.medium, .large])
        .interactiveDismissDisabled(model[.privateChat].sending)
    }
}
