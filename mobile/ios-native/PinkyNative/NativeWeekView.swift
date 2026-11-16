import SwiftUI

struct NativeWeekView: View {
    let api: PinkyAPI
    let userId: String
    let language: PinkyLanguage
    let paired: Bool
    let onPair: () -> Void

    @Environment(\.scenePhase) private var scenePhase
    @State private var week: Week?
    @State private var pet: Pet?
    @State private var loading = false
    @State private var failure: String?

    private struct Week: Decodable {
        let timezone: String
        let today: String
        let start: String
        let end: String
        let counts: [String: Int]
        let targets: [String: Int]
        let days: [String]
    }

    private struct Pet: Decodable {
        let level: Int
        let points: Int
        let floor: Int
        let next: Int
    }

    private struct Together: Decodable {
        let pet: Pet?
    }

    private var identity: String { "\(userId):\(paired):\(language.rawValue)" }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                if !paired {
                    ContentUnavailableView {
                        Label(language.text("这周一起做", "This week together", "Esta semana juntos"), systemImage: "calendar")
                    } description: {
                        Text(language.text("配对后可以看到你们共同完成的事。", "Link with your partner to see what you complete together.", "Vincúlense para ver lo que completan juntos."))
                    } actions: {
                        Button(language.text("和 TA 配对", "Link with your partner", "Vincular con mi pareja"), action: onPair)
                            .buttonStyle(.borderedProminent)
                    }
                } else if let week {
                    GroupBox {
                        VStack(alignment: .leading, spacing: 18) {
                            Text(range(week))
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                            dayStrip(week)
                            goal(week, key: "cards", symbol: "sparkles", title: language.text("翻开三张本周每日题", "Reveal three of this week’s daily cards", "Revelen tres cartas de esta semana"))
                            goal(week, key: "games", symbol: "gamecontroller", title: language.text("完成本周开的一局游戏", "Finish a game you start this week", "Terminen un juego que empiecen esta semana"))
                            goal(week, key: "notes", symbol: "heart", title: language.text("两人各留一张小卡或点一次想你了", "Each leave a little card or send a Thinking of you", "Cada uno deja una tarjeta o envía un «Pensé en ti»"))
                        }
                        .padding(.top, 4)
                    } label: {
                        Label(language.text("这周一起做", "This week together", "Esta semana juntos"), systemImage: "calendar")
                    }
                    if let pet {
                        GroupBox {
                            VStack(alignment: .leading, spacing: 9) {
                                Text(language.text("等级 \(pet.level)", "Level \(pet.level)", "Nivel \(pet.level)"))
                                    .font(.headline)
                                ProgressView(value: Double(max(0, min(pet.points - pet.floor, pet.next - pet.floor))), total: Double(max(1, pet.next - pet.floor))) {
                                    Text(language.text("小家伙的成长", "Little one’s growth", "Crecimiento de su pequeño"))
                                } currentValueLabel: {
                                    Text(language.text("离下一级还有 \(max(0, pet.next - pet.points)) 点", "\(max(0, pet.next - pet.points)) points to the next level", "\(max(0, pet.next - pet.points)) puntos para el siguiente nivel"))
                                }
                            }
                            .padding(.top, 4)
                        } label: {
                            Label(language.text("小家伙", "Our little one", "Nuestro pequeño"), systemImage: "pawprint.fill")
                        }
                    }
                } else if failure == nil {
                    ProgressView(language.text("正在查看本周进度…", "Loading your week…", "Cargando su semana…"))
                        .frame(maxWidth: .infinity, minHeight: 180)
                }

                if let failure, paired {
                    VStack(alignment: .leading, spacing: 10) {
                        Label(failure, systemImage: "exclamationmark.circle")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                        Button(language.text("重试", "Try again", "Reintentar")) {
                            Task { await refresh(includePet: true) }
                        }
                        .buttonStyle(.bordered)
                        .disabled(loading)
                    }
                }
            }
            .padding()
            .frame(maxWidth: 620)
            .frame(maxWidth: .infinity, alignment: .center)
        }
        .background(Color(uiColor: .systemGroupedBackground))
        .refreshable { await refresh(includePet: true) }
        .onChange(of: identity) { _, _ in
            week = nil
            pet = nil
            failure = nil
        }
        .task(id: identity + ":" + String(scenePhase == .active)) {
            guard paired, scenePhase == .active else { return }
            await refresh(includePet: true)
            while !Task.isCancelled {
                do { try await Task.sleep(for: .seconds(20)) } catch { return }
                await refresh(includePet: false)
            }
        }
    }

    private func refresh(includePet: Bool) async {
        guard paired, !loading else { return }
        loading = true
        defer { loading = false }
        let lang = URLQueryItem(name: "language", value: language.rawValue)
        do {
            let remote: Week = try await api.get("/api/play-week", query: [lang])
            guard !Task.isCancelled else { return }
            week = remote
            failure = nil
            if includePet {
                let zone = URLQueryItem(name: "timezone", value: TimeZone.current.identifier)
                let together: Together? = try? await api.get("/api/together", query: [lang, zone])
                if !Task.isCancelled, let together { pet = together.pet }
            }
        } catch {
            guard !Task.isCancelled else { return }
            failure = language.text("暂时没法刷新共同进度。", "Couldn’t refresh your shared progress.", "No se pudo actualizar su progreso.")
        }
    }

    private func dayStrip(_ week: Week) -> some View {
        let days = calendarDays(week.start)
        return HStack(spacing: 4) {
            ForEach(days, id: \.key) { day in
                let complete = week.days.contains(day.key)
                let current = day.key == week.today
                VStack(spacing: 6) {
                    Text(day.short)
                        .font(.caption2.weight(current ? .bold : .regular))
                        .lineLimit(1)
                        .minimumScaleFactor(0.65)
                    Image(systemName: complete ? "checkmark.circle.fill" : current ? "circle.inset.filled" : "circle")
                        .font(.system(size: 17, weight: .medium))
                        .foregroundStyle(complete || current ? Color.accentColor : Color.secondary.opacity(0.45))
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(day.full)
                .accessibilityValue(complete ? language.text("有共同活动", "Activity completed together", "Actividad compartida") : language.text("暂无共同活动", "No shared activity", "Sin actividad compartida"))
                .frame(maxWidth: .infinity)
            }
        }
    }

    private func goal(_ week: Week, key: String, symbol: String, title: String) -> some View {
        let target = max(1, week.targets[key] ?? 1)
        let value = max(0, week.counts[key] ?? 0)
        return ProgressView(value: Double(min(target, value)), total: Double(target)) {
            Label(title, systemImage: symbol)
                .font(.subheadline.weight(.medium))
        } currentValueLabel: {
            Text("\(min(target, value)) / \(target)")
                .font(.caption.monospacedDigit())
                .foregroundStyle(.secondary)
        }
    }

    private func range(_ week: Week) -> String {
        let format = DateFormatter()
        format.locale = Locale(identifier: language.rawValue == "zh" ? "zh-Hans" : language.rawValue)
        format.timeZone = .gmt
        format.setLocalizedDateFormatFromTemplate("MMMd")
        guard let first = isoDay(week.start), let last = isoDay(week.end) else { return "" }
        return "\(format.string(from: first)) – \(format.string(from: last))"
    }

    private struct DayLabel {
        let key: String
        let short: String
        let full: String
    }

    private func calendarDays(_ start: String) -> [DayLabel] {
        guard let first = isoDay(start) else { return [] }
        let key = DateFormatter()
        key.locale = Locale(identifier: "en_US_POSIX")
        key.timeZone = .gmt
        key.dateFormat = "yyyy-MM-dd"
        let local = DateFormatter()
        local.locale = Locale(identifier: language.rawValue == "zh" ? "zh-Hans" : language.rawValue)
        local.timeZone = .gmt
        return (0..<7).map { offset in
            let date = first.addingTimeInterval(Double(offset) * 86_400)
            local.setLocalizedDateFormatFromTemplate("EEEEE")
            let short = local.string(from: date)
            local.setLocalizedDateFormatFromTemplate("EEEEMMMMd")
            return DayLabel(key: key.string(from: date), short: short, full: local.string(from: date))
        }
    }

    private func isoDay(_ value: String) -> Date? {
        ISO8601DateFormatter().date(from: value + "T12:00:00Z")
    }
}
