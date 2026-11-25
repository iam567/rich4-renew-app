import UIKit
import AVFoundation
import Photos
import MetricKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        NativeLog.start()
        // The game's sound (Web Audio in the web view) plays even when the phone is on silent, like a game you
        // started on purpose; it still mixes with music from other apps. The in-game 靜音 / volume settings apply.
        Self.playSound()
        // After an interruption (a call, an alarm, another app's audio) iOS leaves our session inactive: take it back
        // as soon as the interruption ends, not only when the app becomes active again.
        NotificationCenter.default.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { note in
            guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                  AVAudioSession.InterruptionType(rawValue: raw) == .ended else { return }
            Self.playSound()
        }
        return true
    }

    static func playSound() {
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default, options: [.mixWithOthers])
        try? AVAudioSession.sharedInstance().setActive(true)
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // A call or another app may have taken the audio session; take it back when the game is in front again.
        Self.playSound()
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        Self.playSound()
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}

/// The app's one window as a scene (UIScene life cycle): iOS 27 with the 27.2 SDK no longer starts an app without it
/// (it stopped at launch, 2026-11-08). Main.storyboard makes the window; links and the sound go on as before.
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        // code that still looks for the app delegate's window finds this one
        (UIApplication.shared.delegate as? AppDelegate)?.window = window
        for context in connectionOptions.urlContexts { _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, open: context.url, options: [:]) }
        if let activity = connectionOptions.userActivities.first { _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, continue: activity, restorationHandler: { _ in }) }
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        for context in URLContexts { _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, open: context.url, options: [:]) }
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, continue: userActivity, restorationHandler: { _ in })
    }

    // (with scenes these come here, not to the app delegate) the sound back when the game is in front again
    func sceneDidBecomeActive(_ scene: UIScene) { AppDelegate.playSound() }
    func sceneWillEnterForeground(_ scene: UIScene) { AppDelegate.playSound() }
}

/// The native half of the error log (game/src/ui/log.ts, the user 2026-11-25): its own file an hour beside the page's,
/// Library/rich4-log/n-YYYYMMDD-HH.log, kept 24 hours; read over the cable (game/scripts/read-log.mjs). Launches, the app
/// to the back and to the front, the system's memory warnings, an uncaught exception, and — at the launch after it — the
/// system's own report of the last crash (MetricKit). A web view lost to the system shows as the page starting twice
/// with one launch.
final class NativeLog: NSObject, MXMetricManagerSubscriber {
    private static let shared = NativeLog()
    private static let dir = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask)[0].appendingPathComponent("rich4-log")
    private static let lock = NSLock()

    private static func text(_ t: Date, _ f: String) -> String {
        let d = DateFormatter()
        d.locale = Locale(identifier: "en_US_POSIX")
        d.calendar = Calendar(identifier: .gregorian)
        d.dateFormat = f
        return d.string(from: t)
    }

    static func write(_ kind: String, _ what: String) {
        lock.lock(); defer { lock.unlock() }
        let now = Date()
        let line = text(now, "MM-dd HH:mm:ss.SSS") + " " + kind + " " + what.prefix(60000).replacingOccurrences(of: "\n", with: "\n    ") + "\n"
        let file = dir.appendingPathComponent("n-" + text(now, "yyyyMMdd-HH") + ".log")
        guard let data = line.data(using: .utf8) else { return }
        if let h = try? FileHandle(forWritingTo: file) {
            defer { try? h.close() }
            if (try? h.seekToEnd()) != nil { try? h.write(contentsOf: data) }
        } else { try? data.write(to: file) }
    }

    private static var free: String { "\(os_proc_available_memory() / 1048576) MB left for the app" }

    static func start() {
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        // (the page's and these, older than 24 hours)
        for f in (try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: [.contentModificationDateKey])) ?? [] where f.pathExtension == "log" {
            if let t = try? f.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate, t.timeIntervalSinceNow < -86400 { try? FileManager.default.removeItem(at: f) }
        }
        let info = Bundle.main.infoDictionary
        write("LAUNCH", "pid \(ProcessInfo.processInfo.processIdentifier) build \(info?["CFBundleShortVersionString"] ?? "?") iOS \(UIDevice.current.systemVersion) \(free)")
        NSSetUncaughtExceptionHandler { e in
            NativeLog.write("CRASH", "\(e.name.rawValue): \(e.reason ?? "")\n" + e.callStackSymbols.joined(separator: "\n"))
        }
        let c = NotificationCenter.default
        for (name, kind) in [(UIApplication.willResignActiveNotification, "INACTIVE"), (UIApplication.didEnterBackgroundNotification, "BACK"),
                             (UIApplication.didBecomeActiveNotification, "FRONT"), (UIApplication.willTerminateNotification, "QUIT"),
                             (UIApplication.didReceiveMemoryWarningNotification, "MEMORY-WARNING")] {
            c.addObserver(forName: name, object: nil, queue: nil) { _ in write(kind, free) }
        }
        c.addObserver(forName: ProcessInfo.thermalStateDidChangeNotification, object: nil, queue: nil) { _ in
            write("HEAT", "state \(ProcessInfo.processInfo.thermalState.rawValue) (0 cool … 3 critical)")
        }
        MXMetricManager.shared.add(shared)
    }

    /// The last run's crash or hang, as the system saw it (given at the launch after it).
    func didReceive(_ payloads: [MXDiagnosticPayload]) {
        for p in payloads {
            for d in p.crashDiagnostics ?? [] {
                NativeLog.write("CRASH", "\(p.timeStampBegin)–\(p.timeStampEnd) signal \(d.signal ?? 0) exception \(d.exceptionType ?? 0)/\(d.exceptionCode ?? 0) \(d.terminationReason ?? "")\n"
                    + (String(data: d.callStackTree.jsonRepresentation(), encoding: .utf8) ?? ""))
            }
            for d in p.hangDiagnostics ?? [] { NativeLog.write("HANG", "\(p.timeStampBegin) \(d.hangDuration)") }
        }
    }
}

/// The game's web view controller (Main.storyboard): Capacitor's, with the app's own plugins registered.
class GameViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(PhotoSaverPlugin())
        bridge?.registerPluginInstance(LanInfoPlugin()) // 局域網房間: this phone's address on the Wi-Fi
    }

    override func router() -> Router { UpdateRouter() }

    /// Quick taps low on the screen (野豬林's arrows, the user 2026-11-24: 「點太快的話…直接就回到主界面了」) must not take the
    /// game home: the bottom edge's swipe (and the top's) first only shows its bar, a second swipe goes — as games do.
    override var preferredScreenEdgesDeferringSystemGestures: UIRectEdge { [.bottom, .top] }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        setNeedsUpdateOfScreenEdgesDeferringSystemGestures()
    }
}

/// 在線更新 (docs/rules/29, game/src/ui/update.ts): a newer version downloaded into Library/rich4-update/v<version>/
/// holds only the files that changed; every request looks there first, then in the app's own files. Which version is
/// chosen when the page (index.html) loads: the one named in `current`, if it is newer than the app's own build
/// (update-base.json) — a newer installer wins over an older download. `boot` counts the starts that never reached
/// the title (the page deletes it once it is up): after three, that version is dropped (`bad`) and the app's own runs.
struct UpdateRouter: Router {
    var basePath: String = ""
    private static var overlay: String?
    private static let root = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask)[0].appendingPathComponent("rich4-update")

    func route(for path: String) -> String {
        let doc = URL(fileURLWithPath: path).pathExtension.isEmpty || path == "/index.html"
        let rel = doc ? "/index.html" : path
        if doc { Self.overlay = Self.choose(basePath) }
        if let o = Self.overlay, !rel.contains(".."), FileManager.default.fileExists(atPath: o + rel) { return o + rel }
        return basePath + rel
    }

    private static func read(_ name: String) -> String? {
        (try? String(contentsOf: root.appendingPathComponent(name), encoding: .utf8))?.trimmingCharacters(in: .whitespacesAndNewlines)
    }
    private static func write(_ name: String, _ text: String) { try? text.write(to: root.appendingPathComponent(name), atomically: true, encoding: .utf8) }
    private static func remove(_ name: String) { try? FileManager.default.removeItem(at: root.appendingPathComponent(name)) }

    /// "0.9.10" > "0.9.9".
    static func newer(_ a: String, than b: String) -> Bool {
        let x = a.split(separator: ".").map { Int($0) ?? 0 }, y = b.split(separator: ".").map { Int($0) ?? 0 }
        for i in 0..<max(x.count, y.count) {
            let p = i < x.count ? x[i] : 0, q = i < y.count ? y[i] : 0
            if p != q { return p > q }
        }
        return false
    }

    private static func choose(_ basePath: String) -> String? {
        guard let ver = read("current"), ver.range(of: "^[0-9]+(\\.[0-9]+){1,3}$", options: .regularExpression) != nil else { return nil }
        let dir = root.appendingPathComponent("v" + ver).path
        guard FileManager.default.fileExists(atPath: dir + "/index.html") else { return nil }
        var own = ""
        if let data = FileManager.default.contents(atPath: basePath + "/update-base.json"),
           let j = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let v = j["version"] as? String { own = v }
        guard newer(ver, than: own) else { remove("current"); return nil }
        let tries = read("boot").flatMap { b -> Int? in
            let p = b.split(separator: " ")
            return p.count == 2 && String(p[0]) == ver ? Int(p[1]) : nil
        } ?? 0
        if tries >= 3 { remove("current"); remove("boot"); write("bad", ver); return nil }
        write("boot", "\(ver) \(tries + 1)")
        return dir
    }
}

/// 局域網房間 (game/src/ui/lan-find.ts): the rooms PCs host on this phone's Wi-Fi (game/desktop/lan-relay.cjs). Every
/// address of this phone's /24 is asked for /lan on the given ports, each giving up quickly — from here, since a web
/// view allows too few connections at once for that. The first time iOS asks for 本地網路 (NSLocalNetworkUsageDescription).
@objc(LanInfoPlugin)
public class LanInfoPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LanInfoPlugin"
    public let jsName = "LanInfo"
    public let pluginMethods: [CAPPluginMethod] = [CAPPluginMethod(name: "find", returnType: CAPPluginReturnPromise), CAPPluginMethod(name: "caps", returnType: CAPPluginReturnPromise)]

    /// What this installer can do that an older one could not (game/src/ui/private-server.ts): 私服 needs the web
    /// view let out to any address (Info.plist NSAllowsArbitraryLoadsInWebContent, from 1.3 on).
    @objc func caps(_ call: CAPPluginCall) {
        call.resolve(["server": true])
    }

    /// This phone's IPv4 addresses on the local network, Wi-Fi (en0) first.
    static func mine() -> [String] {
        var wifi: [String] = [], other: [String] = []
        var list: UnsafeMutablePointer<ifaddrs>?
        if getifaddrs(&list) == 0, let first = list {
            var p: UnsafeMutablePointer<ifaddrs>? = first
            while let i = p {
                let flags = Int32(i.pointee.ifa_flags)
                if let sa = i.pointee.ifa_addr, sa.pointee.sa_family == UInt8(AF_INET), flags & IFF_UP != 0, flags & IFF_LOOPBACK == 0 {
                    var host = [CChar](repeating: 0, count: Int(NI_MAXHOST))
                    if getnameinfo(sa, socklen_t(sa.pointee.sa_len), &host, socklen_t(host.count), nil, 0, NI_NUMERICHOST) == 0 {
                        let ip = String(cString: host), name = String(cString: i.pointee.ifa_name)
                        let parts = ip.split(separator: ".")
                        let local = ip.hasPrefix("10.") || ip.hasPrefix("192.168.") || (ip.hasPrefix("172.") && parts.count > 1 && (16...31).contains(Int(parts[1]) ?? 0))
                        if local { if name == "en0" || name == "en1" { wifi.append(ip) } else { other.append(ip) } }
                    }
                }
                p = i.pointee.ifa_next
            }
            freeifaddrs(first)
        }
        return wifi + other
    }

    @objc func find(_ call: CAPPluginCall) {
        let ports = (call.getArray("ports", Int.self) ?? []).isEmpty ? [8842] : call.getArray("ports", Int.self)!
        let mine = LanInfoPlugin.mine()
        var hosts = mine
        for ip in mine.prefix(3) {
            let net = ip.split(separator: ".").dropLast().joined(separator: ".")
            for i in 1...254 where !hosts.contains("\(net).\(i)") { hosts.append("\(net).\(i)") }
        }
        let cfg = URLSessionConfiguration.ephemeral
        cfg.timeoutIntervalForRequest = 0.9
        cfg.httpMaximumConnectionsPerHost = 1
        let session = URLSession(configuration: cfg)
        let group = DispatchGroup(), lock = NSLock()
        var found: [[String: String]] = []
        for port in ports { for ip in hosts {
            guard let url = URL(string: "http://\(ip):\(port)/lan") else { continue }
            group.enter()
            session.dataTask(with: url) { data, response, _ in
                defer { group.leave() }
                guard (response as? HTTPURLResponse)?.statusCode == 200, let data = data, data.count < 4096,
                      let body = String(data: data, encoding: .utf8), body.contains("\"rich4\":\"lan\"") else { return }
                lock.lock(); found.append(["addr": "\(ip):\(port)", "body": body]); lock.unlock()
            }.resume()
        } }
        group.notify(queue: .main) {
            session.finishTasksAndInvalidate()
            call.resolve(["found": found])
        }
    }
}

/// 「儲存到相簿」 of the results screen: adds a PNG (base64 `data`) to the photo library, asking for add-only access
/// (NSPhotoLibraryAddUsageDescription). The web side is game/src/ui/share.ts.
@objc(PhotoSaverPlugin)
public class PhotoSaverPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PhotoSaverPlugin"
    public let jsName = "PhotoSaver"
    public let pluginMethods: [CAPPluginMethod] = [CAPPluginMethod(name: "save", returnType: CAPPluginReturnPromise)]

    @objc func save(_ call: CAPPluginCall) {
        guard let b64 = call.getString("data"), let data = Data(base64Encoded: b64), UIImage(data: data) != nil else {
            call.reject("無法讀取圖片", "BAD_IMAGE")
            return
        }
        PHPhotoLibrary.requestAuthorization(for: .addOnly) { status in
            guard status == .authorized || status == .limited else {
                call.reject("沒有相簿權限", "DENIED")
                return
            }
            PHPhotoLibrary.shared().performChanges({
                PHAssetCreationRequest.forAsset().addResource(with: .photo, data: data, options: nil)
            }) { ok, error in
                if ok { call.resolve() } else { call.reject(error?.localizedDescription ?? "儲存失敗", "FAILED") }
            }
        }
    }
}
