import UIKit
import AVFoundation
import Photos
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
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

/// The game's web view controller (Main.storyboard): Capacitor's, with the app's own plugins registered.
class GameViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(PhotoSaverPlugin())
    }

    override func router() -> Router { UpdateRouter() }
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
