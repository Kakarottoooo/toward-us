import SwiftUI

private func consentCopy(_ language: PinkyLanguage) -> String {
    language.text(
        "Pinky 通过 OpenAI、Anthropic 这样的第三方 AI 生成回复。你发给 Pinky 的内容会发送给这些服务处理。",
        "Pinky uses third-party AI, including OpenAI and Anthropic, to generate replies. Content you send to Pinky is shared with these services for processing.",
        "Pinky usa IA de terceros, como OpenAI y Anthropic, para responder. El contenido que envías a Pinky se comparte con estos servicios para su procesamiento."
    )
}

private struct NativeWarning: View {
    let message: String?

    var body: some View {
        if let message {
            Label(message, systemImage: "exclamationmark.circle")
                .foregroundStyle(.red)
                .font(.subheadline)
                .accessibilityAddTraits(.updatesFrequently)
        }
    }
}

struct NativeAuthView: View {
    @ObservedObject var account: PinkyAccount
    @Binding var language: PinkyLanguage
    @Environment(\.colorScheme) private var colorScheme
    @FocusState private var focus: Field?
    @State private var name = ""
    @State private var email = ""
    @State private var password = ""
    @State private var creating = false
    @State private var recovery = false
    @State private var showingPassword = false
    @State private var validation: String?

    private enum Field: Hashable { case name, email, password, visiblePassword }

    private var accent: Color {
        colorScheme == .dark ? Color(red: 0.67, green: 0.76, blue: 1) : Color(red: 0.03, green: 0.22, blue: 0.65)
    }
    private var canvas: Color {
        colorScheme == .dark ? Color(uiColor: .systemBackground) : Color(red: 0.98, green: 0.96, blue: 0.93)
    }
    private var surface: Color {
        colorScheme == .dark ? Color(uiColor: .secondarySystemBackground) : .white
    }
    private var title: String {
        creating ? language.text("创建账号", "Create your account", "Crea tu cuenta")
                 : language.text("欢迎回来", "Welcome back", "Hola de nuevo")
    }
    private var action: String {
        creating ? language.text("创建账号", "Create account", "Crear cuenta")
                 : language.text("登录", "Sign in", "Iniciar sesión")
    }
    private var emailLabel: String { language.text("邮箱", "Email", "Correo") }
    private var passwordLabel: String { language.text("密码", "Password", "Contraseña") }
    private var nameLabel: String { language.text("你的称呼", "Your name", "Tu nombre") }
    private var passwordFocus: Field { showingPassword ? .visiblePassword : .password }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 30) {
                HStack(spacing: 11) {
                    Image("PinkyMark")
                        .resizable()
                        .scaledToFit()
                        .frame(width: 45, height: 45)
                        .clipShape(.rect(cornerRadius: 13))
                        .accessibilityHidden(true)
                    Text("Pinky")
                        .font(.title2.bold())
                    Spacer()
                    NativeLanguageMenu(language: $language)
                        .frame(minHeight: 44)
                        .disabled(account.busy)
                }

                VStack(alignment: .leading, spacing: 20) {
                    Text(title)
                        .font(.system(.largeTitle, design: .rounded).weight(.bold))
                        .accessibilityAddTraits(.isHeader)

                    VStack(alignment: .leading, spacing: 15) {
                        if creating { nameInput }
                        emailInput
                        passwordInput
                    }

                    if !creating {
                        Button(language.text("忘记密码？", "Forgot password?", "¿Olvidaste tu contraseña?")) {
                            focus = nil
                            resetMessages()
                            recovery = true
                        }
                        .frame(minHeight: 44)
                        .frame(maxWidth: .infinity, alignment: .trailing)
                        .disabled(account.busy)
                        .font(.subheadline.weight(.semibold))
                        .padding(.top, -12)
                    }

                    if let message = validation ?? account.warning {
                        VStack(alignment: .leading, spacing: 3) {
                            NativeWarning(message: message)
                            if validation == nil && account.restoreFailed {
                                Button(language.text("重试连接", "Try connecting again", "Volver a conectar")) {
                                    Task { await account.restore() }
                                }
                                .frame(minHeight: 44)
                            }
                        }
                    }
                    submitButton
                }

                VStack(spacing: 0) {
                    Text(creating ? language.text("已经有账号？", "Already have an account?", "¿Ya tienes una cuenta?")
                                  : language.text("第一次使用 Pinky？", "New to Pinky?", "¿Primera vez en Pinky?"))
                        .foregroundStyle(.secondary)
                    Button(creating ? language.text("去登录", "Sign in", "Inicia sesión")
                                    : language.text("创建账号", "Create an account", "Crea una cuenta")) {
                        focus = nil
                        creating.toggle()
                        password = ""
                        showingPassword = false
                        resetMessages()
                    }
                    .fontWeight(.semibold)
                    .frame(minHeight: 44)
                    .disabled(account.busy)
                }
                .font(.subheadline)
                .frame(maxWidth: .infinity)
            }
            .frame(maxWidth: 460)
            .padding(.horizontal, 26)
            .padding(.top, 22)
            .padding(.bottom, 22)
            .frame(maxWidth: .infinity)
        }
        .background(canvas.ignoresSafeArea())
        .tint(accent)
        .scrollDismissesKeyboard(.interactively)
        .sheet(isPresented: $recovery, onDismiss: account.clearWarning) {
            NavigationStack {
                NativeRecoveryView(account: account, initialEmail: email, language: language)
            }
        }
    }

    private var nameInput: some View {
        field(nameLabel, highlighted: focus == .name) {
            TextField(nameLabel, text: $name, prompt: Text(language.text("你希望我们怎么称呼你", "What should we call you?", "¿Cómo te llamamos?")))
                .textContentType(.givenName)
                .submitLabel(.next)
                .focused($focus, equals: .name)
                .onSubmit { focus = .email }
        }
    }

    private var emailInput: some View {
        field(emailLabel, highlighted: focus == .email) {
            TextField(emailLabel, text: $email, prompt: Text(verbatim: "name@example.com"))
                .keyboardType(.emailAddress)
                .textContentType(.username)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .accessibilityIdentifier("pinky-email")
                .submitLabel(.next)
                .focused($focus, equals: .email)
                .onSubmit { focus = passwordFocus }
        }
    }

    private var passwordInput: some View {
        field(passwordLabel, highlighted: focus == passwordFocus) {
            HStack(spacing: 8) {
                Group {
                    if showingPassword {
                        TextField(passwordLabel, text: $password, prompt: Text(passwordPrompt))
                            .focused($focus, equals: .visiblePassword)
                    } else {
                        SecureField(passwordLabel, text: $password, prompt: Text(passwordPrompt))
                            .focused($focus, equals: .password)
                    }
                }
                .textContentType(creating ? .newPassword : .password)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .accessibilityIdentifier("pinky-password")
                .submitLabel(creating ? .go : .done)
                .onSubmit(submit)

                Button {
                    let wasFocused = focus == passwordFocus
                    showingPassword.toggle()
                    if wasFocused { focus = passwordFocus }
                } label: {
                    Image(systemName: showingPassword ? "eye.slash" : "eye")
                        .font(.body)
                        .frame(width: 44, height: 44)
                        .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
                .accessibilityLabel(showingPassword ? language.text("隐藏密码", "Hide password", "Ocultar contraseña")
                                                     : language.text("显示密码", "Show password", "Mostrar contraseña"))
            }
        }
    }

    private var passwordPrompt: String {
        creating ? language.text("至少 10 个字符", "At least 10 characters", "Al menos 10 caracteres")
                 : language.text("输入密码", "Enter your password", "Escribe tu contraseña")
    }

    private func field<Content: View>(_ label: String, highlighted: Bool, @ViewBuilder input: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(label)
                .font(.subheadline.weight(.semibold))
                .accessibilityHidden(true)
            input()
                .padding(.leading, 15)
                .padding(.trailing, 10)
                .frame(minHeight: 54)
                .background(surface, in: .rect(cornerRadius: 14))
                .overlay {
                    RoundedRectangle(cornerRadius: 14)
                        .strokeBorder(highlighted ? accent : Color.primary.opacity(0.16), lineWidth: highlighted ? 2 : 1)
                        .allowsHitTesting(false)
                }
                .disabled(account.busy)
        }
    }

    private var submitButton: some View {
        Button(action: submit) {
            HStack(spacing: 9) {
                if account.busy { ProgressView().tint(colorScheme == .dark ? .black : .white) }
                Text(account.busy ? language.text("请稍候…", "Please wait…", "Espera un momento…") : action)
                    .font(.headline)
            }
            .foregroundStyle(colorScheme == .dark ? Color.black : .white)
            .frame(maxWidth: .infinity, minHeight: 54)
            .background(accent, in: .rect(cornerRadius: 14))
            .contentShape(.rect(cornerRadius: 14))
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("pinky-auth-submit")
        .disabled(account.busy)
    }

    private func submit() {
        guard !account.busy else { return }
        if creating && name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            validation = language.text("请输入你的称呼。", "Enter your name.", "Escribe tu nombre.")
            focus = .name
            return
        }
        let trimmedEmail = email.trimmingCharacters(in: .whitespacesAndNewlines)
        let emailParts = trimmedEmail.split(separator: "@", omittingEmptySubsequences: false)
        guard emailParts.count == 2, emailParts.allSatisfy({ !$0.isEmpty }),
              !trimmedEmail.contains(where: \.isWhitespace) else {
            validation = language.text("请检查邮箱地址。", "Check your email address.", "Revisa tu dirección de correo.")
            focus = .email
            return
        }
        guard !password.isEmpty else {
            validation = language.text("请输入密码。", "Enter your password.", "Escribe tu contraseña.")
            focus = passwordFocus
            return
        }
        if creating && password.count < 10 {
            validation = language.text("密码至少要有 10 个字符。", "Use at least 10 characters for your password.",
                                       "Usa al menos 10 caracteres para tu contraseña.")
            focus = passwordFocus
            return
        }
        resetMessages()
        focus = nil
        showingPassword = false
        Task {
            let success = await account.authenticate(email: trimmedEmail, password: password, name: creating ? name : nil, language: language)
            if success { password = "" }
        }
    }

    private func resetMessages() {
        validation = nil
        account.clearWarning()
    }
}

struct NativeLanguageMenu: View {
    @Binding var language: PinkyLanguage

    var body: some View {
        Menu {
            Picker(language.text("语言", "Language", "Idioma"), selection: $language) {
                ForEach(PinkyLanguage.allCases) { option in
                    Text(option.label).tag(option)
                }
            }
        } label: {
            Label(language.label, systemImage: "globe")
        }
        .accessibilityLabel(language.text("更改语言", "Change language", "Cambiar idioma"))
    }
}

struct NativeConsentView: View {
    @ObservedObject var account: PinkyAccount
    let language: PinkyLanguage

    var body: some View {
        NavigationStack {
            Form {
                Section(language.text("使用 AI 前", "Before using AI", "Antes de usar IA")) {
                    Text(consentCopy(language))
                    NativeLegalLinks(api: account.api, language: language)
                }
                Section {
                    Button(language.text("同意并继续", "Agree and continue", "Aceptar y continuar")) {
                        Task { await account.setConsent(true, language: language) }
                    }
                    .accessibilityIdentifier("pinky-consent-agree")
                    Button(language.text("退出登录", "Sign out", "Cerrar sesión"), role: .cancel) {
                        Task { await account.signOut() }
                    }
                    NativeWarning(message: account.warning)
                }
                .disabled(account.busy)
            }
            .navigationTitle("Pinky")
        }
    }
}

struct NativePairingView: View {
    @ObservedObject var account: PinkyAccount
    let language: PinkyLanguage
    let initialCode: String
    @Environment(\.dismiss) private var dismiss
    @State private var code = ""

    var body: some View {
        let pairing = account.identity?.pairing
        Form {
            if pairing?.active == true {
                Section(language.text("我们俩", "Us", "Nosotros")) {
                    ForEach(pairing?.members ?? []) { member in
                        Label(member.name, systemImage: "person.crop.circle")
                    }
                }
            } else {
                Section(language.text("加进共同空间", "Join a shared space", "Únete al espacio compartido")) {
                    TextField(language.text("邀请码或链接", "Invite code or link", "Código o enlace"), text: $code)
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled()
                        .accessibilityIdentifier("pinky-join-code")
                    Button(language.text("加入", "Join", "Unirme")) {
                        guard let parsed = nativeInviteCode(code) else { return }
                        Task {
                            if await account.join(code: parsed, language: language) { dismiss() }
                        }
                    }
                    .accessibilityIdentifier("pinky-join-submit")
                    .disabled(nativeInviteCode(code) == nil || account.busy)
                }
                Section(language.text("邀请对方", "Invite your partner", "Invita a tu pareja")) {
                    if let invitation = pairing?.invitation, !expired(invitation) {
                        LabeledContent(language.text("邀请码", "Code", "Código"), value: invitation.code)
                            .monospaced()
                            .textSelection(.enabled)
                        ShareLink(item: account.api.invitationURL(code: invitation.code)) {
                            Label(language.text("分享邀请链接", "Share invite", "Compartir invitación"), systemImage: "square.and.arrow.up")
                        }
                    } else {
                        Button(language.text("生成邀请", "Create invite", "Crear invitación")) {
                            Task { await account.invite(language: language) }
                        }
                        .disabled(account.busy)
                    }
                }
            }
            NativeWarning(message: account.warning)
        }
        .navigationTitle(language.text("伴侣配对", "Pair with your partner", "Vincula a tu pareja"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button(language.text("关闭", "Close", "Cerrar")) { dismiss() }
            }
        }
        .task {
            if code.isEmpty { code = initialCode }
            await account.restore()
            // Invitation state is refreshed only while this sheet is open.
            while !Task.isCancelled && account.identity?.pairing?.active != true {
                do { try await Task.sleep(for: .seconds(6)) } catch { return }
                if account.identity?.pairing?.invitation != nil && !account.busy { await account.restore() }
            }
        }
    }

    private func expired(_ invitation: PinkyPairing.Invitation) -> Bool {
        guard let value = invitation.expiresAt else { return false }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return (formatter.date(from: value) ?? .distantFuture) < Date()
    }
}

struct NativeSettingsView: View {
    @ObservedObject var account: PinkyAccount
    let user: PinkyUser
    @Binding var language: PinkyLanguage
    let onPair: () -> Void
    @State private var action: AccountAction?

    var body: some View {
        Form {
            Section(language.text("账号", "Account", "Cuenta")) {
                LabeledContent(user.name, value: user.email)
                Button(action: onPair) { Label(language.text("伴侣配对", "Partner pairing", "Vincular pareja"), systemImage: "person.2") }
                Picker(language.text("语言", "Language", "Idioma"), selection: $language) {
                    ForEach(PinkyLanguage.allCases) { option in Text(option.label).tag(option) }
                }
            }
            Section(language.text("隐私与恢复", "Privacy and recovery", "Privacidad y recuperación")) {
                NativeLegalLinks(api: account.api, language: language)
                Button(language.text("生成恢复码", "Generate recovery code", "Generar código de recuperación")) {
                    account.clearWarning()
                    action = .recover
                }
                Button(language.text("撤回 AI 同意", "Withdraw AI consent", "Retirar consentimiento de IA")) {
                    account.clearWarning()
                    action = .withdraw
                }
            }
            Section {
                Button(account.widgetEnabled ? language.text("停用小组件", "Disable widget", "Desactivar widget")
                       : language.text("连接小组件", "Connect widget", "Conectar widget")) {
                    Task { await account.setWidget(!account.widgetEnabled) }
                }
                .disabled(account.busy || !account.widgetAvailable)
            } header: {
                Text(language.text("主屏幕和锁屏", "Home and Lock Screen", "Inicio y bloqueo"))
            } footer: {
                if account.widgetAvailable {
                    Text(language.text("小组件只显示在一起和连续来访的天数。连接后，可在 iPhone 的小组件列表中添加 Pinky。",
                                       "The widget shows only days together and your streak. Connect it, then add Pinky from the iPhone widget gallery.",
                                       "El widget solo muestra los días juntos y la racha. Conéctalo y añade Pinky en la galería de widgets."))
                } else {
                    Text(language.text("此安装包尚未获得小组件的 App Group 权限。",
                                       "This build does not yet have the widget App Group entitlement.",
                                       "Esta compilación aún no tiene permiso para el grupo del widget."))
                }
            }
            Section {
                Button(language.text("退出登录", "Sign out", "Cerrar sesión")) {
                    Task { await account.signOut() }
                }
                if account.identity?.pairing?.active == true {
                    Button(language.text("结束配对", "End pairing", "Terminar vínculo"), role: .destructive) {
                        account.clearWarning()
                        action = .leave
                    }
                }
                Button(language.text("删除账号", "Delete account", "Eliminar cuenta"), role: .destructive) {
                    account.clearWarning()
                    action = .delete
                }
            }
            .disabled(account.busy)
            NativeWarning(message: account.warning)
        }
        .navigationTitle(language.text("设置", "Settings", "Ajustes"))
        .sheet(item: $action, onDismiss: account.clearWarning) { selected in
            NavigationStack {
                NativeConfirmAccountAction(account: account, language: language, action: selected)
            }
        }
    }
}

private enum AccountAction: String, Identifiable {
    case recover, withdraw, leave, delete
    var id: String { rawValue }
}

private struct NativeConfirmAccountAction: View {
    @ObservedObject var account: PinkyAccount
    let language: PinkyLanguage
    let action: AccountAction
    @Environment(\.dismiss) private var dismiss
    @State private var password = ""
    @State private var recoveryCode: String?
    @State private var confirmed = false

    private var title: String {
        switch action {
        case .recover: return language.text("生成新恢复码", "Generate a recovery code", "Generar código de recuperación")
        case .withdraw: return language.text("撤回 AI 同意", "Withdraw AI consent", "Retirar consentimiento de IA")
        case .leave: return language.text("结束配对", "End pairing", "Terminar vínculo")
        case .delete: return language.text("删除我的账号", "Delete my account", "Eliminar mi cuenta")
        }
    }

    private var explanation: String {
        switch action {
        case .recover: return language.text("新码会替换旧码，只显示一次。", "The new code replaces your old one and is shown once.", "El código nuevo reemplaza al anterior y se muestra una vez.")
        case .withdraw: return language.text("若之后想继续使用 AI，需要再次同意。", "You can agree again if you later want to use AI.", "Podrás aceptar de nuevo si más adelante quieres usar IA.")
        case .leave: return language.text("确认后，你们的共同空间将只能查看。", "After confirmation, your shared space becomes read-only.", "Al confirmar, el espacio compartido pasa a ser de solo lectura.")
        case .delete: return language.text("账号将被永久删除。此操作无法撤销。", "Your account will be permanently deleted. This cannot be undone.", "Tu cuenta se eliminará de forma permanente. No se puede deshacer.")
        }
    }

    var body: some View {
        Form {
            Text(explanation)
            if let recoveryCode {
                Text(recoveryCode).monospaced().textSelection(.enabled)
            } else {
                if action != .withdraw {
                    SecureField(language.text("当前密码", "Current password", "Contraseña actual"), text: $password)
                        .textContentType(.password)
                }
                Toggle(language.text("我已了解并确认", "I understand and confirm", "Lo entiendo y confirmo"), isOn: $confirmed)
                Button(title, role: action == .delete || action == .leave ? .destructive : nil) {
                    Task { await apply() }
                }
                .disabled(!confirmed || account.busy || (action != .withdraw && password.isEmpty))
            }
            NativeWarning(message: account.warning)
        }
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button(language.text("关闭", "Close", "Cerrar")) { dismiss() }
            }
        }
    }

    private func apply() async {
        switch action {
        case .recover:
            recoveryCode = await account.recoveryCode(password: password, language: language)
            if recoveryCode != nil { password = "" }
        case .withdraw:
            if await account.setConsent(false, language: language) { dismiss() }
        case .leave:
            if await account.leave(password: password, language: language) { dismiss() }
        case .delete:
            if await account.deleteAccount(password: password, language: language) { dismiss() }
        }
    }
}

private struct NativeRecoveryView: View {
    @ObservedObject var account: PinkyAccount
    let initialEmail: String
    let language: PinkyLanguage
    @Environment(\.dismiss) private var dismiss
    @State private var email = ""
    @State private var code = ""
    @State private var password = ""
    @State private var notice: String?

    var body: some View {
        Form {
            TextField(language.text("邮箱", "Email", "Correo"), text: $email)
                .textContentType(.emailAddress).keyboardType(.emailAddress)
                .textInputAutocapitalization(.never).autocorrectionDisabled()
            Section(language.text("邮件找回", "Recover by email", "Recuperar por correo")) {
                Button(language.text("发送重置邮件", "Send reset email", "Enviar correo de restablecimiento")) {
                    Task {
                        if await account.requestPasswordLink(email: email, language: language) {
                            notice = language.text("如果该邮箱能接收重置链接，请查看收件箱。", "If a reset link can be sent to this address, check your inbox.", "Si se puede enviar un enlace a esta dirección, revisa tu bandeja.")
                        }
                    }
                }
                .disabled(email.isEmpty || account.busy)
            }
            Section(language.text("使用恢复码", "Use a recovery code", "Usar un código de recuperación")) {
                TextField(language.text("恢复码", "Recovery code", "Código de recuperación"), text: $code)
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                SecureField(language.text("新密码", "New password", "Contraseña nueva"), text: $password)
                    .textContentType(.newPassword)
                Button(language.text("设置新密码", "Set new password", "Fijar contraseña nueva")) {
                    Task {
                        if await account.reset(email: email, code: code, password: password, language: language) {
                            password = ""
                            code = ""
                            notice = language.text("密码已更新。请用新密码登录。", "Password updated. Sign in with your new password.", "Contraseña actualizada. Inicia sesión con la nueva.")
                        }
                    }
                }
                .disabled(email.isEmpty || code.isEmpty || password.count < 10 || account.busy)
            }
            if let notice { Text(notice) }
            NativeWarning(message: account.warning)
        }
        .navigationTitle(language.text("恢复账号", "Recover account", "Recuperar cuenta"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button(language.text("关闭", "Close", "Cerrar")) { dismiss() }
            }
        }
        .onAppear { if email.isEmpty { email = initialEmail } }
    }
}

private struct NativeLegalLinks: View {
    let api: PinkyAPI
    let language: PinkyLanguage

    var body: some View {
        if let policy = URL(string: "/privacy?lang=" + language.rawValue, relativeTo: api.baseURL),
           let terms = URL(string: "/terms?lang=" + language.rawValue, relativeTo: api.baseURL) {
            Link(language.text("隐私政策", "Privacy policy", "Política de privacidad"), destination: policy)
            Link(language.text("使用条款", "Terms of use", "Condiciones de uso"), destination: terms)
        }
    }
}
