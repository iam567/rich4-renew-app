package pro.areu.rich4;

import android.content.Context;
import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.io.ByteArrayOutputStream;
import java.io.FileOutputStream;
import java.util.HashMap;
import java.util.Map;
import org.json.JSONObject;

/**
 * 在線更新 (docs/rules/29, game/src/ui/update.ts): a newer version downloaded into files/rich4-update/v<version>/ holds
 * only the files that changed; every request of the page looks there first, then in the app's own files (Capacitor's
 * server). Which version is chosen when the page (index.html) loads: the one named in `current`, if it is newer than
 * the app's own build (update-base.json) — a newer installer wins over an older download. `boot` counts the starts
 * that never reached the title (the page deletes it once it is up): after three, that version is dropped (`bad`).
 * The same rules as the iOS app's UpdateRouter (AppDelegate.swift) and the desktop app's (desktop/main.cjs).
 */
public class UpdateClient extends BridgeWebViewClient {
    private final Bridge bridge;
    private final File root;
    private File overlay;

    public UpdateClient(Bridge bridge, Context c) {
        super(bridge);
        this.bridge = bridge;
        this.root = new File(c.getFilesDir(), "rich4-update");
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        Uri u = request.getUrl();
        String path = u.getPath();
        if (path != null && bridge.getHost().equals(u.getHost()) && !path.startsWith("/_capacitor_")) {
            boolean doc = path.equals("/") || path.equals("/index.html") || !path.substring(path.lastIndexOf('/') + 1).contains(".");
            String rel = doc ? "/index.html" : path;
            if (doc) overlay = choose(view.getContext());
            if (overlay != null && !rel.contains("..")) {
                File f = new File(overlay, rel.substring(1));
                if (f.isFile()) {
                    try {
                        InputStream in = new FileInputStream(f);
                        Map<String, String> h = new HashMap<>();
                        h.put("Cache-Control", "no-cache");
                        return new WebResourceResponse(mime(rel), null, 200, "OK", h, in);
                    } catch (Exception e) { /* the app's own file then */ }
                }
            }
        }
        return super.shouldInterceptRequest(view, request);
    }

    private static String mime(String p) {
        String e = p.substring(p.lastIndexOf('.') + 1).toLowerCase();
        switch (e) {
            case "html": return "text/html";
            case "js": case "mjs": return "application/javascript";
            case "css": return "text/css";
            case "json": return "application/json";
            case "webp": return "image/webp";
            case "png": return "image/png";
            case "jpg": case "jpeg": return "image/jpeg";
            case "svg": return "image/svg+xml";
            case "m4a": return "audio/mp4";
            case "mp3": return "audio/mpeg";
            case "ogg": return "audio/ogg";
            case "wav": return "audio/wav";
            case "woff2": return "font/woff2";
            case "woff": return "font/woff";
            case "ttf": return "font/ttf";
            case "wasm": return "application/wasm";
            default: return "application/octet-stream";
        }
    }

    // Android 6 on (minSdk 23): no java.nio.file, no InputStream.readAllBytes.
    private static String text(InputStream in) throws java.io.IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
        return new String(out.toByteArray(), StandardCharsets.UTF_8);
    }
    private String read(String name) {
        try (InputStream in = new FileInputStream(new File(root, name))) { return text(in).trim(); } catch (Exception e) { return null; }
    }
    private void write(String name, String text) {
        try (FileOutputStream out = new FileOutputStream(new File(root, name))) { out.write(text.getBytes(StandardCharsets.UTF_8)); } catch (Exception e) { /* not kept */ }
    }
    private void remove(String name) { new File(root, name).delete(); }

    /** "0.9.10" > "0.9.9". */
    static boolean newer(String a, String b) {
        String[] x = a.split("\\."), y = b.split("\\.");
        for (int i = 0; i < Math.max(x.length, y.length); i++) {
            int p = i < x.length ? num(x[i]) : 0, q = i < y.length ? num(y[i]) : 0;
            if (p != q) return p > q;
        }
        return false;
    }
    private static int num(String s) { try { return Integer.parseInt(s); } catch (Exception e) { return 0; } }

    private File choose(Context c) {
        String ver = read("current");
        if (ver == null || !ver.matches("^[0-9]+(\\.[0-9]+){1,3}$")) return null;
        File dir = new File(root, "v" + ver);
        if (!new File(dir, "index.html").isFile()) return null;
        String own = "";
        try (InputStream in = c.getAssets().open("public/update-base.json")) {
            own = new JSONObject(text(in)).optString("version", "");
        } catch (Exception e) { /* none: any download is newer */ }
        if (!newer(ver, own)) { remove("current"); return null; }
        int tries = 0;
        String boot = read("boot");
        if (boot != null) {
            String[] p = boot.split(" ");
            if (p.length == 2 && p[0].equals(ver)) tries = num(p[1]);
        }
        if (tries >= 3) { remove("current"); remove("boot"); write("bad", ver); return null; }
        write("boot", ver + " " + (tries + 1));
        return dir;
    }
}
