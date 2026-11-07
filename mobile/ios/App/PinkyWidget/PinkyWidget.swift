import SwiftUI
import WidgetKit

/// Pinky on the home screen and lock screen: days together, the couple's streak and who has shown up today, the next date.
/// Tapping it opens the app. It refreshes about every 30 minutes, and right away when the app signs in or out.
struct PinkyEntry: TimelineEntry {
    let date: Date
    let content: WidgetContent
}

struct PinkyProvider: TimelineProvider {
    func placeholder(in context: Context) -> PinkyEntry { PinkyEntry(date: Date(), content: .ready(.sample)) }

    func getSnapshot(in context: Context, completion: @escaping (PinkyEntry) -> Void) {
        Task {
            var content = await WidgetLoader.load()
            // The widget gallery shows a sample instead of a sign-in prompt, so people can see what they are adding.
            if case .ready = content {} else if context.isPreview { content = .ready(.sample) }
            completion(PinkyEntry(date: Date(), content: content))
        }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<PinkyEntry>) -> Void) {
        Task {
            let now = Date()
            let entry = PinkyEntry(date: now, content: await WidgetLoader.load())
            completion(Timeline(entries: [entry], policy: .after(now.addingTimeInterval(30 * 60))))
        }
    }
}

struct PinkyWidgetEntryView: View {
    @Environment(\.widgetFamily) private var family
    let entry: PinkyEntry

    var body: some View {
        let accessory = family == .accessoryCircular || family == .accessoryRectangular
        if #available(iOSApplicationExtension 17.0, *) {
            PinkyWidgetContent(content: entry.content, family: family)
                .containerBackground(for: .widget) { accessory ? Color.clear : PinkyPalette.ivory }
        } else {
            PinkyWidgetContent(content: entry.content, family: family)
                .padding(accessory ? 0 : 16)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(accessory ? Color.clear : PinkyPalette.ivory)
        }
    }
}

@main
struct PinkyWidget: Widget {
    var body: some WidgetConfiguration {
        let lang = PinkyLanguage.device
        return StaticConfiguration(kind: "PinkyWidget", provider: PinkyProvider()) { entry in
            PinkyWidgetEntryView(entry: entry)
        }
        .configurationDisplayName("Pinky")
        .description(lang.say("在一起的天数、一起打卡的连续天数和下一个日子。", "Days together, your streak and the next date.", "Días juntos, vuestra racha y la próxima fecha."))
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular, .accessoryCircular])
    }
}
