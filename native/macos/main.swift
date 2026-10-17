// A tiny pixel Claude that sits on top of the Claude Code input, in a transparent window glued to
// its VS Code window. Drawn natively (no web view) so it costs almost nothing.
//
// It is started by the extension and talks to it only through stdin/stdout, one JSON object per line;
// it never touches the network.
//   stdin  (extension → overlay): {"type":"look", "mood":…, "level":…, "eyes":…, "theme":…, "tooltip":…},
//                                  {"type":"feed","kinds":[…]}, {"type":"focus","focused":bool},
//                                  {"type":"init","unit":…}, {"type":"quit"}
//   stdout (overlay → extension): {"type":"ready"}, {"type":"compact","force":bool}
import Cocoa

let vscodeBundleIds: Set<String> = [
    "com.microsoft.VSCode", "com.microsoft.VSCodeInsiders", "com.vscodium", "com.visualstudio.code.oss",
]

func send(_ obj: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: obj),
          let line = String(data: data, encoding: .utf8) else { return }
    FileHandle.standardOutput.write((line + "\n").data(using: .utf8)!)
}

func rgb(_ r: CGFloat, _ g: CGFloat, _ b: CGFloat, _ a: CGFloat = 1) -> NSColor {
    NSColor(srgbRed: r / 255, green: g / 255, blue: b / 255, alpha: a)
}

/// What the extension wants the mascot to look like right now.
struct Look: Equatable {
    /// idle, working, vibe, sleep, hibernate (the usage limit is hit) or gym (the gym reminder).
    var mood = "idle"
    /// How much of the usage quota is gone: ok, tired (≥ 80 %) or nearly (≥ 95 %).
    var level = "ok"
    var blackEyes = false
    var lightTheme = false
    /// For recording a demo: play exactly this animation, over and over.
    var demo: String?
}

// MARK: - sprite

/// The Claude mascot, front view, on the top edge of the Claude Code input. Every animation is a
/// row of 22 × 22 frames from Sprites.swift. What it plays depends on the mood and quota level the
/// extension sends; when idle it strolls along the input and picks a calm pastime now and then.
final class OctopusView: NSView {
    var look = Look() {
        didSet {
            if look.mood != oldValue.mood { moodChanged(from: oldValue.mood) }
            if look.level != oldValue.level || look.demo != oldValue.demo { pick = 0 }
            if look.blackEyes != oldValue.blackEyes || look.lightTheme != oldValue.lightTheme { needsDisplay = true }
        }
    }
    var unit: CGFloat = 2.5
    var onClick: ((Bool) -> Void)?
    var onDrag: ((CGFloat, CGFloat) -> Void)?
    var onDragEnd: (() -> Void)?
    var hovering = false

    override var isFlipped: Bool { true }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

    // The window is a strip along the input; the mascot walks inside it. Units are art pixels.
    // Frames keep their feet on row 19, so a 21-row strip leaves one empty row below them.
    static let stripW: CGFloat = 100, stripH: CGFloat = 21
    static let cell = CGFloat(Sprites.size)
    static func size(unit: CGFloat) -> NSSize { NSSize(width: stripW * unit, height: stripH * unit) }

    static let body = rgb(217, 119, 87)
    static let eyeWhite = NSColor.white
    static let eyeBlack = rgb(43, 27, 20)
    static let propOnDark = rgb(230, 232, 236)
    static let propOnLight = rgb(163, 168, 178)
    static let darkProp = rgb(26, 26, 26) // sunglasses, laptop screen
    static let symbolColor = rgb(90, 176, 240) // blue: notes, sweat
    static let red = rgb(229, 83, 75) // an empty battery
    static let grey = rgb(139, 144, 153) // headphones, laptop logo, weight plates
    static let green = rgb(63, 185, 80) // the "$" of quota being eaten
    static var symbolCache: [String: NSImage] = [:]

    /// A system symbol filled with one colour, cached.
    static func tinted(_ name: String, _ color: NSColor = symbolColor) -> NSImage? {
        let key = name + color.description
        if let img = symbolCache[key] { return img }
        guard let base = NSImage(systemSymbolName: name, accessibilityDescription: nil)?
            .withSymbolConfiguration(.init(pointSize: 40, weight: .bold)) else { return nil }
        let img = NSImage(size: base.size, flipped: false) { rect in
            base.draw(in: rect)
            color.set()
            rect.fill(using: .sourceAtop)
            return true
        }
        symbolCache[key] = img
        return img
    }

    // World state.
    var x: CGFloat = 39 // left edge of the 22-wide frame, in units
    var dir: CGFloat = 1 // walking direction; walking frames are mirrored when it goes left
    var targetX: CGFloat = 39
    /// Walk on the spot (for the demo GIF, where every animation has its own cell).
    var inPlace = false
    var anim = "idle"
    var animTime: Double = 0 // seconds into the current animation
    var t: Double = 0 // simulation clock
    /// Seconds before the brain picks the next pastime (only counts down when nothing forces one).
    var pick: Double = 0
    var pastime = "idle"
    /// What it eats: a green "$" for the quota each answer costs, and an emoji for what Claude read
    /// or did (the kinds come from the extension).
    static let food: [String: String] = [
        "token": "$", "file": "📄", "edit": "✏️", "cmd": "💻", "search": "🔍", "web": "🌐",
        "agent": "🤖", "prompt": "💬", "think": "💡", "image": "🖼️", "todo": "✅", "tool": "🔧",
    ]

    /// One-shot animations waiting to play (stretch, eating), each with the emoji to drop if any.
    var queue: [(anim: String, icon: String?)] = []
    var icon: String?

    /// The part of the strip it may walk on (frame left edge, in units): the whole strip, cut down
    /// to what lies inside the VS Code window (the strip may stick out after a drag). Frames have 3
    /// empty columns on each side.
    var visibleMin: CGFloat = -.infinity
    var visibleMax: CGFloat = .infinity
    var minX: CGFloat { max(-3, visibleMin) }
    var maxX: CGFloat { max(minX, min(Self.stripW - Self.cell + 3, visibleMax)) }

    var current: Anim { Sprites.anims[anim] ?? Sprites.anims["idle"]! }
    var frameIndex: Int {
        let a = current
        let f = Int(animTime * fps(a))
        return a.loops ? f % a.frames.count : min(f, a.frames.count - 1)
    }
    var onceDone: Bool { !current.loops && animTime * fps(current) >= Double(current.frames.count) }

    /// Eating slows to half speed when the quota is nearly gone.
    func fps(_ a: Anim) -> Double { anim == "eating" && look.level == "nearly" ? a.fps / 2 : a.fps }

    /// Where the creature is drawn, in view coordinates: also the only area that takes clicks.
    var spriteRect: NSRect {
        NSRect(x: (x + 3) * unit, y: 9 * unit, width: 16 * unit, height: 11 * unit)
    }

    func feed(_ kinds: [String]) {
        guard look.mood != "hibernate" else { return }
        let waiting = queue.filter { $0.anim == "eating" }.count
        for k in kinds.prefix(max(0, 4 - waiting)) {
            queue.append(("eating", Self.food[k] ?? Self.food["tool"]!))
        }
    }

    func moodChanged(from old: String) {
        // Waking up (from a nap, or when the limit resets) starts with a stretch.
        if (old == "sleep" || old == "hibernate") && look.mood != "sleep" && look.mood != "hibernate" {
            queue.removeAll { $0.anim == "stretch" }
            queue.insert(("stretch", nil), at: 0)
        }
        if look.mood == "hibernate" { queue.removeAll() }
        pick = 0
    }

    func play(_ name: String) {
        if anim != name { anim = name; animTime = 0 }
    }

    // MARK: brain

    /// The animation the mood and quota call for, or nil when it may pick its own pastime.
    func forced() -> String? {
        if let d = look.demo { return d }
        switch (look.mood, look.level) {
        case ("hibernate", _): return "hibernate"
        case ("gym", _): return "lift" // the gym reminder
        case (_, "nearly"): return "nearly_out"
        case ("sleep", _): return "sleep"
        case ("working", "tired"), ("vibe", "tired"): return "coffee"
        case ("vibe", _): return "vibe"
        default: return nil
        }
    }

    /// Pastimes last a while and are separated by a stroll or a pause, so nothing flickers from one
    /// act to the next.
    func choosePastime() {
        let r = Double.random(in: 0...1)
        if look.mood == "working" {
            // Coding, with a coffee now and then.
            pastime = pastime != "coffee" && r < 0.25 ? "coffee" : "working"
            pick = pastime == "coffee" ? 9 : Double.random(in: 25...45)
            return
        }
        let tired = look.level == "tired"
        if pastime == "walk" || pastime == "tired_walk" || pastime == "idle" && r < 0.5 {
            pastime = tired ? "tired" : ["football", "music", "chill", "lift", "idle"].randomElement()!
            pick = Double.random(in: 20...35)
        } else {
            pastime = tired ? "tired_walk" : "walk"
            pick = 20 // ends early once it gets there
            targetX = CGFloat.random(in: minX...maxX).rounded()
            if abs(targetX - x) < 10 { targetX = x < (minX + maxX) / 2 ? maxX : minX }
        }
    }

    /// Advances the world by `dt` seconds. Returns true when the picture changed.
    func step(_ dt: Double) -> Bool {
        t += dt
        let before = (anim, frameIndex, x, dir)
        animTime += dt
        if !current.loops {
            if !onceDone { return (anim, frameIndex, x, dir) != before }
            icon = nil
            // A one-shot demo plays again after a short pause.
            if anim == look.demo {
                if animTime * fps(current) < Double(current.frames.count) + 2 { return false }
                animTime = 0
                if anim == "eating" { icon = ["$", "$", "📄", "💻", "🔍"].randomElement() }
                return true
            }
        }
        if let next = queue.first, look.mood != "hibernate" {
            queue.removeFirst()
            anim = next.anim
            animTime = 0
            icon = next.icon
            return true
        }
        if let f = forced() {
            if f != anim, f == "eating" { icon = "$" }
            play(f)
        } else {
            pick -= dt
            if pick <= 0 { choosePastime() }
            play(pastime)
        }
        // Never stand outside the walkable part (the window may have shrunk under it).
        if !inPlace, x < minX || x > maxX {
            x = min(max(x, minX), maxX)
            targetX = min(max(targetX, minX), maxX)
        }
        if (anim == "walk" || anim == "tired_walk") && !inPlace {
            let speed: CGFloat = anim == "walk" ? 6 : 3 // art pixels per second
            let d = targetX - x
            if abs(d) < 1 {
                pick = 0
                // A walking demo just turns around at the end of the strip.
                if look.demo != nil { targetX = x < (minX + maxX) / 2 ? maxX : minX }
            } else {
                dir = d > 0 ? 1 : -1
                x += dir * min(abs(d), speed * CGFloat(dt))
            }
        }
        return (anim, frameIndex, x.rounded(), dir) != (before.0, before.1, before.2.rounded(), before.3)
    }

    // MARK: drawing

    override func draw(_ dirtyRect: NSRect) {
        NSColor.clear.set()
        dirtyRect.fill()
        let u = unit
        let n = Sprites.size
        let frame = Array(current.frames[frameIndex].utf8)
        let colors: [UInt8: NSColor] = [
            UInt8(ascii: "B"): Self.body,
            UInt8(ascii: "E"): look.blackEyes ? Self.eyeBlack : Self.eyeWhite,
            UInt8(ascii: "L"): look.lightTheme ? Self.propOnLight : Self.propOnDark,
            UInt8(ascii: "K"): Self.darkProp,
            // Headphones, the laptop logo and the weight plates (sheet letters C and R) are grey.
            UInt8(ascii: "C"): Self.grey,
            UInt8(ascii: "R"): Self.grey,
        ]
        let left = x.rounded()
        // Only walking animations face a direction; the rest are drawn as designed.
        let mirror = dir < 0 && (anim == "walk" || anim == "tired_walk")
        func fill(_ col: Int, _ row: Int, _ c: NSColor) {
            c.set()
            NSRect(x: ((left + CGFloat(col)) * u).rounded(), y: (CGFloat(row) * u).rounded(),
                   width: u.rounded(.up), height: u.rounded(.up)).fill()
        }
        for row in 0..<min(n, Int(Self.stripH)) {
            for col in 0..<n {
                let ch = frame[row * n + (mirror ? n - 1 - col : col)]
                if let c = colors[ch] { fill(col, row, c) }
            }
        }
        // Flat system symbols over the pixel art, in one bright colour (emoji are glossy and the
        // note emoji is black): a 5-unit square whose top-left corner is at (col, row).
        func symbol(_ name: String, _ col: CGFloat, _ row: CGFloat, _ color: NSColor = Self.symbolColor, units: CGFloat = 5) {
            guard let img = Self.tinted(name, color) else { return }
            let size = units * u
            img.draw(in: NSRect(x: (left + col) * u, y: row * u, width: size, height: size),
                     from: .zero, operation: .sourceOver, fraction: 1, respectFlipped: true, hints: nil)
        }
        // Emoji (for food): a 5-unit square whose top-left corner is at (col, row).
        func emoji(_ e: String, _ col: CGFloat, _ row: CGFloat) {
            let size = 5 * u
            let text = NSAttributedString(string: e, attributes: [.font: NSFont.systemFont(ofSize: size * 0.8)])
            let box = text.size()
            text.draw(at: NSPoint(x: (left + col) * u + (size - box.width) / 2, y: row * u + (size - box.height) / 2))
        }
        // What is being eaten falls into the open mouth (rows 14-15) on the first three frames.
        if anim == "eating", let e = icon, frameIndex < 3 {
            let row: CGFloat = [-1, 3, 8][frameIndex]
            if e == "$" { symbol("dollarsign", 8.5, row, Self.green) } else { emoji(e, 8.5, row) }
        }
        // Almost out of quota: an empty red battery over its head.
        if anim == "nearly_out" {
            symbol("battery.25", 7.5, 3, Self.red)
        }
        // Tired: a drop of sweat sliding down beside the head.
        if anim == "tired" || anim == "tired_walk" {
            symbol("drop.fill", 2.5, 8 + CGFloat(frameIndex % 4), Self.symbolColor, units: 3)
        }
        // Music notes drift up beside the head on the beat.
        if anim == "music" {
            let f = frameIndex
            symbol(f < 2 ? "music.note" : "music.quarternote.3", f < 2 ? 17 : 0, f % 2 == 0 ? 3 : 2)
        } else if anim == "vibe", frameIndex % 2 == 1 {
            symbol("music.note", 17, frameIndex == 1 ? 3 : 2)
        }
    }
    // MARK: input

    var downAt: NSPoint?
    var dragged = false


    override func mouseDown(with event: NSEvent) {
        downAt = NSEvent.mouseLocation
        dragged = false
    }

    override func mouseDragged(with event: NSEvent) {
        guard let start = downAt else { return }
        let now = NSEvent.mouseLocation
        if !dragged && hypot(now.x - start.x, now.y - start.y) < 4 { return }
        dragged = true
        onDrag?(now.x - start.x, now.y - start.y)
        downAt = now
    }

    var pendingClick: DispatchWorkItem?

    override func mouseUp(with event: NSEvent) {
        defer { downAt = nil }
        if dragged { onDragEnd?(); return }
        pendingClick?.cancel()
        if event.clickCount >= 2 {
            onClick?(true) // double click: compact even with room left (the extension asks first)
            return
        }
        // A single click waits briefly in case it turns into a double click.
        let work = DispatchWorkItem { [weak self] in self?.onClick?(false) }
        pendingClick = work
        DispatchQueue.main.asyncAfter(deadline: .now() + NSEvent.doubleClickInterval, execute: work)
    }
}

// MARK: - window that follows VS Code

struct HostWindow {
    let number: Int
    let frame: NSRect
}

final class Overlay: NSObject {
    let panel: NSPanel
    let view = OctopusView()
    /// Offset of the panel's bottom-right corner from the VS Code window's bottom-right corner.
    /// The default perches the mascot on the top edge of Claude Code's message box.
    var margin = NSPoint(x: 70, y: 118)
    var ownWindow: Int?
    var current: HostWindow?
    var lastFrame: NSRect?
    var movingSince: Date?
    var start = Date()
    let defaults = UserDefaults.standard

    override init() {
        panel = NSPanel(contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        super.init()
        if defaults.object(forKey: "octopusStripX") != nil {
            margin = NSPoint(x: defaults.double(forKey: "octopusStripX"), y: defaults.double(forKey: "octopusStripY"))
        } else if defaults.object(forKey: "octopusMarginX") != nil {
            margin = NSPoint(x: defaults.double(forKey: "octopusMarginX"), y: defaults.double(forKey: "octopusMarginY"))
        }
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.level = .normal
        panel.hidesOnDeactivate = false
        panel.becomesKeyOnlyIfNeeded = true
        panel.collectionBehavior = [.managed, .ignoresCycle]
        panel.contentView = view
        resize()
        view.onClick = { force in send(["type": "compact", "force": force]) }
        // Another app (or VS Code) came to the front: re-check the stacking order right away.
        NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main
        ) { [weak self] _ in
            self?.lastScan = .distantPast
            self?.tick()
        }
        view.onDrag = { [weak self] dx, dy in
            guard let self else { return }
            self.margin.x -= dx
            self.margin.y += dy
            self.place()
        }
        view.onDragEnd = { [weak self] in
            guard let self else { return }
            self.defaults.set(Double(self.margin.x), forKey: "octopusStripX")
            self.defaults.set(Double(self.margin.y), forKey: "octopusStripY")
        }
    }

    func resize() {
        let s = OctopusView.size(unit: view.unit)
        panel.setContentSize(s)
        view.frame = NSRect(origin: .zero, size: s)
    }

    // MARK: messages

    func handle(line: String) {
        guard let data = line.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = obj["type"] as? String else { return }
        switch type {
        case "init":
            if let u = obj["unit"] as? Double { view.unit = CGFloat(max(1.5, min(5, u))); resize() }
        case "look":
            var look = view.look
            if let mood = obj["mood"] as? String, ["idle", "working", "vibe", "sleep", "hibernate", "gym"].contains(mood) { look.mood = mood }
            if let level = obj["level"] as? String, ["ok", "tired", "nearly"].contains(level) { look.level = level }
            if let eyes = obj["eyes"] as? String { look.blackEyes = eyes == "black" }
            if let theme = obj["theme"] as? String { look.lightTheme = theme == "light" }
            let demo = obj["demo"] as? String
            look.demo = demo.flatMap { Sprites.anims[$0] != nil ? $0 : nil }
            if look != view.look { view.look = look }
            if let tip = obj["tooltip"] as? String { view.toolTip = String(tip.prefix(200)) }
        case "feed":
            if let kinds = obj["kinds"] as? [String] { view.feed(kinds.filter { $0.count < 12 }) }
        case "focus":
            // The extension's VS Code window just got focus, so the front-most one is ours.
            if (obj["focused"] as? Bool) == true {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
                    if let w = self.vscodeWindows().first { self.ownWindow = w.number }
                }
            }
        case "quit":
            NSApp.terminate(nil)
        default:
            break
        }
    }

    // MARK: placement

    func vscodeWindows() -> [HostWindow] {
        let pids = Set(NSWorkspace.shared.runningApplications
            .filter { vscodeBundleIds.contains($0.bundleIdentifier ?? "") }
            .map { $0.processIdentifier })
        guard !pids.isEmpty, let main = NSScreen.screens.first,
              let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)
                as? [[String: Any]] else { return [] }
        return list.compactMap { w in
            guard (w[kCGWindowLayer as String] as? Int) == 0,
                  let pid = w[kCGWindowOwnerPID as String] as? pid_t, pids.contains(pid),
                  let number = w[kCGWindowNumber as String] as? Int,
                  let b = w[kCGWindowBounds as String] as? [String: CGFloat],
                  let x = b["X"], let y = b["Y"], let wd = b["Width"], let ht = b["Height"],
                  wd > 300, ht > 200 else { return nil }
            return HostWindow(number: number, frame: NSRect(x: x, y: main.frame.maxY - y - ht, width: wd, height: ht))
        }
    }

    func host() -> HostWindow? {
        let windows = vscodeWindows()
        if let own = ownWindow { return windows.first { $0.number == own } }
        return windows.first
    }

    func place() {
        guard let f = current?.frame else { return }
        let s = panel.frame.size
        let u = view.unit
        // The mascot itself (columns 3...18 of its frame) must stay inside the window; the rest of
        // the strip may stick out, so it can be dragged right up to either edge.
        let spriteLeft = (view.x + 3) * u, spriteRight = (view.x + 19) * u
        margin.x = max(spriteRight - s.width, min(f.width - s.width + spriteLeft, margin.x))
        margin.y = max(0, min(f.height - s.height - 30, margin.y))
        let origin = NSPoint(x: f.maxX - s.width - margin.x, y: f.minY + margin.y)
        panel.setFrameOrigin(origin)
        view.visibleMin = (f.minX - origin.x) / u - 3
        view.visibleMax = (f.maxX - origin.x) / u - 19
    }

    var lastScan = Date.distantPast
    /// Our VS Code window is the front-most VS Code window.
    var ownIsFront = false

    /// While our VS Code window is the active one the mascot floats, so clicking into the editor
    /// cannot cover it; otherwise it sits at normal level right above that window, and other apps
    /// and windows cover it as they cover VS Code.
    func setLevel() {
        let active = vscodeBundleIds.contains(NSWorkspace.shared.frontmostApplication?.bundleIdentifier ?? "")
        let level: NSWindow.Level = active && ownIsFront ? .floating : .normal
        if panel.level != level { panel.level = level }
    }
    var hoverSince: Date?

    func restingAlpha() -> CGFloat { view.hovering ? 0.6 : 1 }

    /// The sprite area in screen coordinates.
    func spriteFrame() -> NSRect {
        let r = view.spriteRect
        return NSRect(x: panel.frame.minX + r.minX, y: panel.frame.maxY - r.maxY, width: r.width, height: r.height)
    }

    func fade(to alpha: CGFloat) {
        guard abs(panel.alphaValue - alpha) > 0.01 else { return }
        NSAnimationContext.runAnimationGroup { $0.duration = 0.2; panel.animator().alphaValue = alpha }
    }

    /// Fades a little only when the pointer rests on the octopus, so passing over it on the way to
    /// the chat box never makes it blink.
    func updateHover(_ now: Date) {
        guard movingSince == nil, panel.isVisible else { return }
        let inside = spriteFrame().contains(NSEvent.mouseLocation)
        if inside {
            if hoverSince == nil { hoverSince = now }
        } else {
            hoverSince = nil
        }
        let hovering = inside && now.timeIntervalSince(hoverSince ?? now) >= 0.4
        if hovering != view.hovering {
            view.hovering = hovering
            fade(to: restingAlpha())
        }
    }
    /// The VS Code window frame the octopus was last positioned against.
    var placedFor: NSRect?

    /// Bounds of just our window: cheap enough to ask ten times a second.
    func frameOf(_ number: Int) -> NSRect? {
        var id = UnsafeRawPointer(bitPattern: UInt(number))
        guard let main = NSScreen.screens.first,
              let ids = CFArrayCreate(nil, &id, 1, nil),
              let list = CGWindowListCreateDescriptionFromArray(ids) as? [[String: Any]],
              let w = list.first, (w[kCGWindowIsOnscreen as String] as? Bool) ?? true,
              let b = w[kCGWindowBounds as String] as? [String: CGFloat],
              let x = b["X"], let y = b["Y"], let wd = b["Width"], let ht = b["Height"] else { return nil }
        return NSRect(x: x, y: main.frame.maxY - y - ht, width: wd, height: ht)
    }

    /// Ten times a second: follow our VS Code window. A full scan of all windows (which one is
    /// ours, is it visible, stacking order) only runs once a second. While the window is being
    /// moved or resized the octopus hides, and it comes back once the window has settled.
    @objc func tick() {
        let now = Date()
        var frame: NSRect?
        if current == nil || now.timeIntervalSince(lastScan) >= 1 {
            lastScan = now
            guard let h = host() else {
                current = nil
                if panel.isVisible { panel.orderOut(nil) }
                return
            }
            current = h
            frame = h.frame
            ownIsFront = vscodeWindows().first?.number == h.number
            // Stay right above our VS Code window: visible with it, covered along with it.
            setLevel()
            panel.order(.above, relativeTo: h.number)
        } else if let c = current {
            frame = frameOf(c.number)
            if frame == nil { current = nil; return }
            current = HostWindow(number: c.number, frame: frame!)
        }
        guard let f = frame else { return }
        if let last = lastFrame, last != f {
            movingSince = now
            if panel.alphaValue > 0 { panel.alphaValue = 0 }
        }
        lastFrame = f
        if let since = movingSince {
            if now.timeIntervalSince(since) < 0.25 { return }
            movingSince = nil
            place()
            placedFor = f
            fade(to: restingAlpha())
        } else if placedFor != f {
            // First appearance, or the window changed while we were not watching closely.
            place()
            placedFor = f
            panel.alphaValue = restingAlpha()
        }
        updateHover(now)
        setLevel()
        if !panel.isVisible, let c = current { panel.order(.above, relativeTo: c.number) }
        // Only the octopus itself takes clicks (the space above it is for falling icons), and
        // holding Option lets every click fall through to whatever it covers.
        let through = NSEvent.modifierFlags.contains(.option) || !spriteFrame().contains(NSEvent.mouseLocation)
        if panel.ignoresMouseEvents != through { panel.ignoresMouseEvents = through }
    }

    var lastStep = Date()

    /// Twelve steps a second (every frame rate in the sheet divides it): the mascot thinks and moves,
    /// and is redrawn only when its frame or position changed.
    @objc func animate() {
        let now = Date()
        let dt = min(0.5, now.timeIntervalSince(lastStep))
        lastStep = now
        guard panel.isVisible, panel.alphaValue > 0 else { return }
        if view.step(dt) { view.needsDisplay = true }
    }
}

// MARK: - main

// Development aid: `--demo-gif <file>` renders every animation playing at once in a labelled 4 × 4
// grid, as a looping GIF for the README.
if let i = CommandLine.arguments.firstIndex(of: "--demo-gif"), i + 1 < CommandLine.arguments.count {
    let out = URL(fileURLWithPath: CommandLine.arguments[i + 1])
    let names: [(String, String)] = [
        ("idle", "idle"), ("walk", "walk"), ("eating", "eating"), ("football", "football"),
        ("music", "music"), ("chill", "chill"), ("lift", "gym time"), ("working", "coding"),
        ("coffee", "coding + coffee"), ("vibe", "vibe coding"), ("tired", "tired (80%)"), ("tired_walk", "tired walk"),
        ("nearly_out", "nearly out (95%)"), ("hibernate", "limit hit"), ("sleep", "sleep"), ("stretch", "limit reset"),
    ]
    let unit: CGFloat = 5, cols = 4, fps = 12.0, seconds = 6.0
    let cellW = OctopusView.cell * unit, cellH = OctopusView.stripH * unit, labelH: CGFloat = 26, pad: CGFloat = 14
    let rows = (names.count + cols - 1) / cols
    let size = NSSize(width: CGFloat(cols) * (cellW + pad) + pad, height: CGFloat(rows) * (cellH + labelH + pad) + pad)
    let views: [OctopusView] = names.map { name, _ in
        let v = OctopusView()
        v.unit = unit
        v.frame = NSRect(x: 0, y: 0, width: cellW, height: cellH)
        v.x = 0
        v.look.demo = name
        v.anim = name
        v.icon = "$"
        v.inPlace = true
        return v
    }
    let frames = Int(fps * seconds)
    guard let dest = CGImageDestinationCreateWithURL(out as CFURL, "com.compuserve.gif" as CFString, frames, nil) else { exit(1) }
    CGImageDestinationSetProperties(dest, [kCGImagePropertyGIFDictionary: [kCGImagePropertyGIFLoopCount: 0]] as CFDictionary)
    let delay = [kCGImagePropertyGIFDictionary: [kCGImagePropertyGIFDelayTime: 1 / fps, kCGImagePropertyGIFUnclampedDelayTime: 1 / fps]] as CFDictionary
    let attrs: [NSAttributedString.Key: Any] = [.font: NSFont.systemFont(ofSize: 13, weight: .medium), .foregroundColor: rgb(200, 204, 210)]
    for _ in 0..<frames {
        guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(size.width), pixelsHigh: Int(size.height),
                                         bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                                         colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0),
              let ctx = NSGraphicsContext(bitmapImageRep: rep) else { exit(1) }
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = ctx
        rgb(30, 31, 34).set()
        NSRect(origin: .zero, size: size).fill()
        for (k, v) in views.enumerated() {
            _ = v.step(1 / fps)
            let col = k % cols, row = k / cols
            let x = pad + CGFloat(col) * (cellW + pad)
            let y = size.height - pad - CGFloat(row + 1) * (cellH + labelH + pad) + pad + labelH
            if let cell = v.bitmapImageRepForCachingDisplay(in: v.bounds) {
                v.cacheDisplay(in: v.bounds, to: cell)
                cell.draw(in: NSRect(x: x, y: y, width: cellW, height: cellH), from: .zero, operation: .sourceOver,
                          fraction: 1, respectFlipped: true, hints: nil)
            }
            let text = NSAttributedString(string: names[k].1, attributes: attrs)
            text.draw(at: NSPoint(x: x + (cellW - text.size().width) / 2, y: y - labelH + 4))
        }
        NSGraphicsContext.restoreGraphicsState()
        if let img = rep.cgImage { CGImageDestinationAddImage(dest, img, delay) }
    }
    exit(CGImageDestinationFinalize(dest) ? 0 : 1)
}

// Development aid: `--snapshot <dir>` renders every animation through the real view and saves one
// sprite sheet (a row per animation, a frame per column), with no window and no screen access.
if let i = CommandLine.arguments.firstIndex(of: "--snapshot"), i + 1 < CommandLine.arguments.count {
    let dir = CommandLine.arguments[i + 1]
    let names = ["idle", "walk", "eating", "football", "music", "chill", "lift", "working", "coffee", "vibe",
                 "tired", "tired_walk", "nearly_out", "hibernate", "sleep", "stretch"]
    let unit: CGFloat = 8, cellW = OctopusView.cell * unit, cellH = OctopusView.stripH * unit
    let label: CGFloat = 220, pad: CGFloat = 8
    let size = NSSize(width: label + 6 * (cellW + pad) + pad, height: CGFloat(names.count) * (cellH + pad) + pad)
    let sheet = NSImage(size: size)
    sheet.lockFocus()
    rgb(30, 31, 34).set()
    NSRect(origin: .zero, size: size).fill()
    for (r, name) in names.enumerated() {
        let view = OctopusView()
        view.unit = unit
        view.frame = NSRect(x: 0, y: 0, width: cellW, height: cellH)
        view.x = 0
        view.dir = name.hasSuffix("walk") ? -1 : 1
        view.anim = name
        view.icon = "$"
        let y = size.height - CGFloat(r + 1) * (cellH + pad)
        let attrs: [NSAttributedString.Key: Any] = [.font: NSFont.systemFont(ofSize: 26, weight: .semibold), .foregroundColor: rgb(200, 204, 210)]
        NSAttributedString(string: name, attributes: attrs).draw(at: NSPoint(x: 12, y: y + cellH / 2 - 14))
        for f in 0..<view.current.frames.count {
            view.animTime = (Double(f) + 0.5) / view.current.fps
            guard let rep = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { continue }
            view.cacheDisplay(in: view.bounds, to: rep)
            let rect = NSRect(x: label + pad + CGFloat(f) * (cellW + pad), y: y, width: cellW, height: cellH)
            rgb(43, 45, 49).set()
            rect.fill()
            rep.draw(in: rect, from: .zero, operation: .sourceOver, fraction: 1, respectFlipped: true, hints: nil)
        }
    }
    sheet.unlockFocus()
    if let tiff = sheet.tiffRepresentation, let bmp = NSBitmapImageRep(data: tiff) {
        try? bmp.representation(using: .png, properties: [:])?.write(to: URL(fileURLWithPath: "\(dir)/_sheet.png"))
    }
    exit(0)
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory) // no Dock icon, no menu bar
let overlay = Overlay()

for (interval, selector) in [(0.125, #selector(Overlay.tick)), (1.0 / 12, #selector(Overlay.animate))] {
    let timer = Timer(timeInterval: interval, target: overlay, selector: selector, userInfo: nil, repeats: true)
    timer.tolerance = interval * 0.2
    RunLoop.main.add(timer, forMode: .common)
}

DispatchQueue.global(qos: .utility).async {
    while let line = readLine(strippingNewline: true) {
        DispatchQueue.main.async { overlay.handle(line: line) }
    }
    DispatchQueue.main.async { NSApp.terminate(nil) }
}
send(["type": "ready"])
app.run()
