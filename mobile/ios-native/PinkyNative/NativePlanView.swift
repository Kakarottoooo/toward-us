import SwiftUI

struct NativePlanView: View {
    let api: PinkyAPI
    let userId: String
    let language: PinkyLanguage
    let questionId: String?
    var preferPending = true

    @Environment(\.scenePhase) private var scenePhase
    @State private var plan: NativePlanState?
    @State private var draftPicks: Set<String>?
    @State private var pinnedQuestion: String?
    @State private var candidate: NativePlanIdea?
    @State private var date = Date()
    @State private var useTime = false
    @State private var editingIdea = false
    @State private var newIdea = ""
    @State private var confirmVersion: Int?
    @State private var saving = false
    @State private var readSerial = 0
    @State private var loaded = false
    @State private var error: String?
    @State private var calendarPlan: NativeCalendarSelection?
    @FocusState private var typing: Bool

    private var selected: Set<String> { draftPicks ?? Set(plan?.mine ?? []) }
    private var queryKey: String { "\(questionId ?? ""):\(pinnedQuestion ?? ""):\(language.rawValue):\(scenePhase == .active)" }

    var body: some View {
        Group {
            if plan != nil || questionId != nil || error != nil {
                VStack(alignment: .leading, spacing: 14) {
                    Label(language.text("答完就约一个", "Make a plan together", "Hagan un plan juntos"), systemImage: "calendar.badge.plus")
                        .font(.subheadline.weight(.semibold)).foregroundStyle(PinkyTheme.accent)
                    if let plan {
                        if plan.questionId != questionId && preferPending {
                            Text(plan.questionTitle).font(.subheadline).foregroundStyle(.secondary)
                        }
                        if let offer = plan.offer, offer.status == "pending" || offer.status == "confirmed" {
                            offerView(offer, plan: plan)
                        } else if let candidate {
                            proposal(candidate, plan: plan)
                        } else {
                            if let offer = plan.offer { resolution(offer.status) }
                            picks(plan)
                        }
                        if preferPending, let questionId, plan.questionId != questionId, plan.offer?.status != "pending" {
                            Button(language.text("看看今天的点子", "See today’s ideas", "Ver las ideas de hoy")) {
                                pinnedQuestion = questionId
                            }
                        }
                    } else if !loaded {
                        ProgressView(language.text("载入计划…", "Loading plans…", "Cargando planes…"))
                    }
                    if let error {
                        Text(error).font(.subheadline).foregroundStyle(.secondary)
                        Button(language.text("重新载入", "Reload", "Volver a cargar")) { Task { await refresh() } }
                    }
                }
                .nativePlayPanel()
            }
        }
        .task(id: queryKey) {
            guard scenePhase == .active else { return }
            await refresh()
            while !Task.isCancelled {
                let active = plan?.offer?.status == "pending" || (plan?.saved == true && plan?.partnerReady == false)
                let delay: UInt64 = active ? 5_000_000_000 : 15_000_000_000
                do { try await Task.sleep(nanoseconds: delay) } catch { return }
                await refresh()
            }
        }
        .sheet(item: $calendarPlan) { calendar in
            NavigationStack {
                NativeCalendarReceipt(api: api, language: language, selection: calendar)
            }
        }
    }

    @ViewBuilder
    private func picks(_ plan: NativePlanState) -> some View {
        if plan.partnerReady && plan.saved {
            let matchedIdeas = plan.ideas.filter { plan.matches.contains($0.id) }
            if matchedIdeas.isEmpty {
                Text(language.text("这次还没选到一起，可以修改选择或补充一个点子。", "No matches yet. Change a pick or add your own idea.", "Aún no coincidieron. Cambia una elección o añade tu idea."))
                    .font(.subheadline)
            } else {
                Text(language.text("你们都想试试", "You both want to try", "A los dos les apetece")).font(.headline)
                ForEach(matchedIdeas) { idea in
                    Button {
                        date = Calendar.current.date(byAdding: .day, value: 1, to: Date()) ?? Date()
                        useTime = false
                        candidate = idea
                    } label: {
                        Label(idea.title, systemImage: "calendar.badge.plus")
                    }
                    .buttonStyle(.bordered)
                    .disabled(saving || draftPicks != nil)
                }
            }
        } else if plan.saved {
            Label(language.text("选择已保存，等 TA 一起揭晓。", "Picks saved. Wait for your partner to reveal the matches.", "Elecciones guardadas. Espera a tu pareja para ver las coincidencias."), systemImage: "lock")
                .font(.subheadline).foregroundStyle(.secondary)
        } else {
            Text(language.text("各自选想做的事，等双方都选完再看共同选项。", "Pick what you’d like to do. Matches appear after you both choose.", "Elijan lo que les apetece. Las coincidencias aparecen cuando ambos eligen."))
                .font(.subheadline).foregroundStyle(.secondary)
        }
        ForEach(plan.ideas) { idea in
            let isSelected = selected.contains(idea.id)
            Button {
                var next = selected
                if isSelected { next.remove(idea.id) } else { next.insert(idea.id) }
                draftPicks = next == Set(plan.mine) && plan.saved ? nil : next
            } label: {
                HStack(alignment: .top, spacing: 10) {
                    Image(systemName: isSelected ? "checkmark.circle.fill" : "circle").foregroundStyle(PinkyTheme.accent)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(idea.title).font(.subheadline.weight(.semibold))
                        if !idea.detail.isEmpty {
                            Text(idea.detail).font(.footnote).foregroundStyle(.secondary)
                        }
                    }
                    Spacer(minLength: 0)
                }
                .multilineTextAlignment(.leading)
                .padding(10)
                .background(PinkyTheme.accent.opacity(isSelected ? 0.12 : 0.04), in: RoundedRectangle(cornerRadius: 12))
            }
            .buttonStyle(.plain)
            .accessibilityAddTraits(isSelected ? [.isSelected] : [])
            .disabled(saving)
        }
        HStack(alignment: .center, spacing: 8) {
            Button(selected.isEmpty ? language.text("先跳过", "Skip ideas", "Omitir ideas") : language.text("保存选择", "Save picks", "Guardar elecciones")) {
                let body = NativePlanAction(action: "save_picks", language: language.rawValue, ideaIds: selected.sorted())
                Task {
                    if await send(body, plan: plan) { draftPicks = nil }
                }
            }
            .buttonStyle(.borderedProminent)
            .disabled(saving || (plan.saved && draftPicks == nil))
            if !plan.ideas.contains(where: { $0.id == "custom" }), !editingIdea {
                Button(language.text("补充点子", "Add an idea", "Añadir una idea")) { editingIdea = true }
                    .disabled(saving)
            }
        }
        if editingIdea {
            TextField(language.text("两个人都能看到这个点子", "An idea you’ll both see", "Una idea que ambos verán"), text: $newIdea)
                .textFieldStyle(.roundedBorder).focused($typing)
                .onChange(of: newIdea) { _, value in
                    if value.utf16.count > 80 {
                        var limited = String(value.prefix(80))
                        while limited.utf16.count > 80 { limited.removeLast() }
                        newIdea = limited
                    }
                }
            HStack {
                Button(language.text("加入点子", "Add idea", "Añadir idea")) {
                    typing = false
                    let body = NativePlanAction(action: "add_idea", language: language.rawValue, title: newIdea)
                    Task {
                        if await send(body, plan: plan) {
                            newIdea = ""
                            editingIdea = false
                        }
                    }
                }
                .disabled(saving || newIdea.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                Button(language.text("取消", "Cancel", "Cancelar")) {
                    typing = false
                    editingIdea = false
                }
                .disabled(saving)
            }
        }
    }

    private func proposal(_ idea: NativePlanIdea, plan: NativePlanState) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(idea.title).font(.headline)
            DatePicker(language.text("日期", "Date", "Fecha"), selection: $date,
                       in: Calendar.current.startOfDay(for: Date())..., displayedComponents: .date)
            Toggle(language.text("选择具体时间", "Include a time", "Incluir una hora"), isOn: $useTime)
            if useTime {
                DatePicker(language.text("时间", "Time", "Hora"), selection: $date, displayedComponents: .hourAndMinute)
                Text(language.text("按你的本地时间", "In your local time", "En tu hora local"))
                    .font(.footnote).foregroundStyle(.secondary)
            }
            HStack {
                Button(language.text("把时间发给 TA", "Propose this date", "Proponer esta fecha")) {
                    let body = NativePlanAction(action: "propose", language: language.rawValue, version: plan.version,
                        ideaId: idea.id, date: NativePlayDate.day(date), time: useTime ? NativePlayDate.time(date) : "",
                        timezone: TimeZone.current.identifier)
                    Task {
                        if await send(body, plan: plan) { candidate = nil }
                    }
                }
                .buttonStyle(.borderedProminent).disabled(saving)
                Button(language.text("返回点子", "Back to ideas", "Volver a las ideas")) { candidate = nil }.disabled(saving)
            }
        }
    }

    @ViewBuilder
    private func offerView(_ offer: NativePlanOffer, plan: NativePlanState) -> some View {
        let displayDate = NativePlayDate.display(day: offer.date, dueAt: offer.dueAt, language: language)
        Text(offer.title).font(.headline)
        Text(displayDate).font(.subheadline)
        if offer.status == "confirmed" {
            Label(language.text("已经加进共同日历", "On your shared calendar", "En su calendario compartido"), systemImage: "checkmark.circle")
                .foregroundStyle(PinkyTheme.accent)
            if let id = offer.milestoneId {
                Button(language.text("打开共同日历", "Open shared calendar", "Abrir calendario compartido")) {
                    calendarPlan = NativeCalendarSelection(id: id, title: offer.title)
                }
                .buttonStyle(.bordered)
            }
        } else {
            let own = offer.proposedBy == userId
            Text(own
                 ? language.text("等 TA 确认后再加入日历。", "It goes on the calendar once your partner confirms.", "Se añadirá al calendario cuando tu pareja confirme.")
                 : language.text("接受后就会加入你们的共同日历。", "Accept to add this to your shared calendar.", "Acepta para añadirlo a su calendario compartido."))
                .font(.subheadline).foregroundStyle(.secondary)
            HStack {
                if !own {
                    Button(language.text("确认并加入日历", "Confirm and add", "Confirmar y añadir")) { confirmVersion = plan.version }
                        .buttonStyle(.borderedProminent).disabled(saving)
                }
                Button(own ? language.text("撤回时间", "Withdraw", "Retirar") : language.text("时间不合适", "Decline", "Rechazar")) {
                    let body = NativePlanAction(action: own ? "cancel" : "decline", language: language.rawValue, version: plan.version)
                    Task { _ = await send(body, plan: plan) }
                }
                .disabled(saving)
            }
            .confirmationDialog(
                language.text("加入共同日历吗？", "Add to your shared calendar?", "¿Añadir al calendario compartido?"),
                isPresented: Binding(get: { confirmVersion != nil }, set: { if !$0 { confirmVersion = nil } }),
                titleVisibility: .visible,
                presenting: confirmVersion
            ) { version in
                Button(language.text("确认", "Confirm", "Confirmar")) {
                    let body = NativePlanAction(action: "accept", language: language.rawValue, version: version)
                    Task { _ = await send(body, plan: plan) }
                }
            } message: { _ in
                Text(offer.title + " · " + displayDate)
            }
        }
    }

    @ViewBuilder
    private func resolution(_ status: String) -> some View {
        switch status {
        case "declined": Text(language.text("这个时间没约成，可以换一天。", "That time did not work. Try another day.", "Esa hora no funcionó. Prueben otro día."))
        case "cancelled": Text(language.text("上一个时间已撤回。", "The previous proposal was withdrawn.", "Retiraron la propuesta anterior."))
        case "removed": Text(language.text("这个计划已从日历移除。", "This plan was removed from the calendar.", "El plan se eliminó del calendario."))
        default: EmptyView()
        }
    }

    @MainActor
    private func apply(_ result: NativePlanState?) {
        if result?.questionId != plan?.questionId {
            candidate = nil
            draftPicks = nil
            editingIdea = false
            newIdea = ""
        } else if let candidate, let result, !result.matches.contains(candidate.id) {
            self.candidate = nil
        }
        plan = result
        if let result, result.offer?.status == "pending" || result.offer?.status == "confirmed" {
            pinnedQuestion = result.questionId
        }
    }

    @MainActor
    private func refresh() async {
        guard !saving else { return }
        readSerial &+= 1
        let serial = readSerial
        do {
            let exact = pinnedQuestion ?? (preferPending ? nil : questionId)
            let route = exact.map { "/api/play-plans/\($0)" } ?? "/api/play-plans"
            var query = [URLQueryItem(name: "language", value: language.rawValue)]
            if exact == nil, let questionId { query.append(.init(name: "questionId", value: questionId)) }
            let response: NativePlanResponse = try await api.get(route, query: query)
            if !Task.isCancelled, !saving, serial == readSerial {
                apply(response.plan)
                error = nil
                loaded = true
            }
        } catch {
            if !Task.isCancelled, serial == readSerial {
                self.error = error.localizedDescription
                loaded = true
            }
        }
    }

    @MainActor
    private func send(_ body: NativePlanAction, plan: NativePlanState) async -> Bool {
        guard !saving, self.plan?.questionId == plan.questionId else { return false }
        saving = true
        readSerial &+= 1
        error = nil
        do {
            let response: NativePlanResponse = try await api.post("/api/play-plans/\(plan.questionId)", body: body)
            apply(response.plan)
            saving = false
            return true
        } catch {
            saving = false
            let message = error.localizedDescription
            await refresh()
            self.error = message
            return false
        }
    }
}

private struct NativePlanResponse: Decodable { let plan: NativePlanState? }

private struct NativePlanState: Decodable {
    let questionId: String
    let questionTitle: String
    let version: Int
    let ideas: [NativePlanIdea]
    let mine: [String]
    let saved: Bool
    let partnerReady: Bool
    let matches: [String]
    let offer: NativePlanOffer?
}

private struct NativePlanIdea: Decodable, Identifiable {
    let id: String
    let title: String
    let detail: String
}

private struct NativePlanOffer: Decodable {
    let title: String
    let date: String
    let dueAt: String?
    let status: String
    let proposedBy: String
    let milestoneId: String?
}

private struct NativePlanAction: Encodable {
    let action: String
    let language: String
    var version: Int?
    var ideaIds: [String]?
    var title: String?
    var ideaId: String?
    var date: String?
    var time: String?
    var timezone: String?
}

private struct NativeCalendarSelection: Identifiable {
    let id: String
    let title: String
}

private struct NativeCalendarReceipt: View {
    let api: PinkyAPI
    let language: PinkyLanguage
    let selection: NativeCalendarSelection

    @Environment(\.dismiss) private var dismiss
    @State private var milestone: Milestone?
    @State private var loading = true
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            if let milestone {
                Label(milestone.title ?? selection.title, systemImage: "calendar")
                    .font(.title2.weight(.semibold))
                if let date = milestone.date { Text(NativePlayDate.display(day: date, dueAt: milestone.dueAt, language: language)) }
            } else if loading {
                ProgressView(language.text("正在载入日历…", "Loading your calendar…", "Cargando el calendario…"))
            } else {
                Text(error ?? language.text("这条计划当前不在共同日历里。", "This plan is no longer on the shared calendar.", "Este plan ya no está en el calendario compartido."))
                Button(language.text("刷新", "Refresh", "Actualizar")) { Task { await read() } }
            }
            Spacer()
        }
        .padding(22)
        .frame(maxWidth: .infinity, alignment: .leading)
        .navigationTitle(language.text("共同日历", "Shared calendar", "Calendario compartido"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button(language.text("完成", "Done", "Listo")) { dismiss() }
            }
        }
        .task { await read() }
    }

    @MainActor
    private func read() async {
        loading = true
        defer { loading = false }
        do {
            let response: Home = try await api.get("/api/relationship/home", query: [
                .init(name: "language", value: language.rawValue), .init(name: "timezone", value: TimeZone.current.identifier)
            ])
            milestone = response.graph.milestones.first { $0.id == selection.id && $0.archivedAt == nil && $0.withdrawnAt == nil }
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    private struct Home: Decodable {
        let graph: Graph
        struct Graph: Decodable { let milestones: [Milestone] }
    }
    private struct Milestone: Decodable {
        let id: String
        let title: String?
        let date: String?
        let dueAt: String?
        let archivedAt: String?
        let withdrawnAt: String?
    }
}

enum NativePlayDate {
    static func day(_ date: Date) -> String { formatter("yyyy-MM-dd").string(from: date) }
    static func time(_ date: Date) -> String { formatter("HH:mm").string(from: date) }
    static func display(day: String, dueAt: String?, language: PinkyLanguage) -> String {
        let local = DateFormatter()
        local.locale = Locale(identifier: language.text("zh_Hans", "en", "es"))
        local.dateStyle = .medium
        if let dueAt {
            let iso = ISO8601DateFormatter()
            iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let date = iso.date(from: dueAt) ?? ISO8601DateFormatter().date(from: dueAt) {
                local.timeStyle = .short
                return local.string(from: date)
            }
        }
        return formatter("yyyy-MM-dd").date(from: day).map { local.string(from: $0) } ?? day
    }

    private static func formatter(_ format: String) -> DateFormatter {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = .current
        formatter.dateFormat = format
        return formatter
    }
}
