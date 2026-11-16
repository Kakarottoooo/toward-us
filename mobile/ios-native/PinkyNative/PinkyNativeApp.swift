import SwiftUI

enum PinkyTheme {
    static let accent = Color(red: 0.55, green: 0.21, blue: 0.36)
    static let paper = Color(uiColor: .systemGroupedBackground)
    static let ink = Color.primary
}

@main
struct PinkyNativeApp: App {
    @StateObject private var account = PinkyAccount()
    @AppStorage("pinky.native.language") private var language: PinkyLanguage = .preferred
    @Environment(\.scenePhase) private var scenePhase
    @State private var launchInvite: String?

    var body: some Scene {
        WindowGroup {
            Group {
                if account.checking {
                    ProgressView(language.text("正在打开 Pinky…", "Opening Pinky…", "Abriendo Pinky…"))
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if let user = account.identity?.user {
                    if user.aiConsentAt == nil {
                        NativeConsentView(account: account, language: language)
                    } else {
                        NativeMainView(account: account, user: user, language: $language, launchInvite: $launchInvite)
                            .id(user.id)
                    }
                } else {
                    NativeAuthView(account: account, language: $language)
                }
            }
            .tint(PinkyTheme.accent)
            .task { await account.restore() }
            .onChange(of: scenePhase) { _, phase in
                if phase == .active, account.identity?.user != nil {
                    Task { await account.restore() }
                }
            }
            .onChange(of: language) { _, selected in
                Task { await account.changeLanguage(selected) }
            }
            .onOpenURL { url in
                guard url.scheme == "pinky-ios", url.host == "invite",
                      let code = nativeInviteCode(url.lastPathComponent) else { return }
                launchInvite = code
            }
        }
    }
}

private struct NativeMainView: View {
    @ObservedObject var account: PinkyAccount
    let user: PinkyUser
    @Binding var language: PinkyLanguage
    @Binding var launchInvite: String?
    @State private var pairingOpen = false
    @State private var incomingCode: String?
    @State private var followup: String?
    @State private var selected = MainTab.chat

    private enum MainTab: Hashable { case chat, play, settings }

    var body: some View {
        let paired = account.identity?.pairing?.active == true
        let readablePair = (account.identity?.pairing?.members.count ?? 0) == 2
        TabView(selection: $selected) {
            NavigationStack {
                NativeChatView(api: account.api, userId: user.id, language: language, paired: paired,
                               canReadShared: readablePair, relationshipId: account.identity?.pairing?.id,
                               playFollowup: $followup, onPair: showPairing)
                    .navigationTitle("Pinky")
                    .navigationBarTitleDisplayMode(.inline)
            }
            .tabItem { Label(language.text("聊天", "Chat", "Chat"), systemImage: "bubble.left.and.bubble.right") }
            .tag(MainTab.chat)

            NavigationStack {
                NativePlayHome(api: account.api, userId: user.id, language: language, paired: paired, onPair: showPairing,
                               onDiscuss: { text in followup = text; selected = .chat })
                    .id(account.identity?.pairing?.id)
            }
            .tabItem { Label(language.text("一起玩", "Play", "Jugar"), systemImage: "heart.square") }
            .tag(MainTab.play)

            NavigationStack {
                NativeSettingsView(account: account, user: user, language: $language, onPair: showPairing)
            }
            .tabItem { Label(language.text("设置", "Settings", "Ajustes"), systemImage: "gearshape") }
            .tag(MainTab.settings)
        }
        .onChange(of: launchInvite, initial: true) { _, code in
            guard let code else { return }
            incomingCode = code
            pairingOpen = true
            launchInvite = nil
        }
        .sheet(isPresented: $pairingOpen, onDismiss: { incomingCode = nil }) {
            NavigationStack {
                NativePairingView(account: account, language: language, initialCode: incomingCode ?? "")
            }
        }
    }

    private func showPairing() {
        account.clearWarning()
        pairingOpen = true
    }
}

private struct NativePlayHome: View {
    let api: PinkyAPI
    let userId: String
    let language: PinkyLanguage
    let paired: Bool
    let onPair: () -> Void
    let onDiscuss: (String) -> Void
    @State private var tab = Section.today

    private enum Section: Hashable { case today, week, distance }

    var body: some View {
        VStack(spacing: 0) {
            Picker(language.text("一起玩", "Play together", "Jugar juntos"), selection: $tab) {
                Text(language.text("今天", "Today", "Hoy")).tag(Section.today)
                Text(language.text("这周", "This Week", "Semana")).tag(Section.week)
                Text(language.text("异地", "From Afar", "Distancia")).tag(Section.distance)
            }
            .pickerStyle(.segmented)
            .padding(.horizontal)
            .padding(.vertical, 8)
            switch tab {
            case .today:
                NativeTodayView(api: api, userId: userId, language: language, paired: paired, onPair: onPair, onDiscuss: onDiscuss)
            case .week:
                NativeWeekView(api: api, userId: userId, language: language, paired: paired, onPair: onPair)
            case .distance:
                NativeDistanceView(api: api, userId: userId, language: language, paired: paired, onPair: onPair)
            }
        }
        .navigationTitle(language.text("一起玩", "Play Together", "Jugar Juntos"))
        .navigationBarTitleDisplayMode(.inline)
    }
}

func nativeInviteCode(_ raw: String) -> String? {
    let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    let token = URLComponents(string: trimmed)?.queryItems?.first(where: { $0.name == "invite" })?.value ?? trimmed
    let code = token.uppercased()
    return code.range(of: "^[A-Z2-9]{8}$", options: .regularExpression) != nil ? code : nil
}
