package pro.areu.rich4;

import android.os.Bundle;
import android.os.SystemClock;
import android.view.InputDevice;
import android.view.KeyEvent;
import android.view.ViewGroup;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

public class MainActivity extends BridgeActivity {
    /** When the web view's renderer was last lost (elapsed ms), so a renderer that dies again at once is not restarted forever. */
    private static long rendererGoneAt = -1;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PhotoSaverPlugin.class); // 儲存到相簿 of the results screen
        super.onCreate(savedInstanceState);
        fullScreen();
        // Issue #7 (「安卓版經常出現讀取存檔失敗，然後閃退」, HarmonyOS 4.2): when the system kills the web view's renderer
        // (out of memory, often while a big map loads), Android closes the whole app unless the app handles it. The
        // game starts again at the title instead (the page notes a load that was cut off and says so there).
        if (bridge != null) bridge.addWebViewListener(new WebViewListener() {
            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                ViewGroup parent = (ViewGroup) view.getParent();
                if (parent != null) parent.removeView(view);
                view.destroy();
                long now = SystemClock.elapsedRealtime();
                boolean again = rendererGoneAt >= 0 && now - rendererGoneAt < 15000;
                rendererGoneAt = now;
                if (again) finish(); // lost twice within seconds: close normally rather than loop
                else recreate();
                return true;
            }
        });
    }

    /**
     * 手把操作 (issue #15: Retroid / AYN / Anbernic handhelds). The controller's buttons reach the web view, which hands
     * them to the page's Gamepad API (ui/pad.ts). Android turns a B press nobody took into BACK, and some handhelds send
     * BACK for B themselves: that would close the game. A BACK from a controller is the page's 返回 instead (the page
     * ignores it when it already saw the same B press); BACK from the touch screen's gesture / navigation bar is
     * untouched.
     */
    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        if (event.getKeyCode() == KeyEvent.KEYCODE_BACK && fromController(event)) {
            if (event.getAction() == KeyEvent.ACTION_UP && !event.isCanceled() && bridge != null && bridge.getWebView() != null) {
                bridge.getWebView().evaluateJavascript("window.__rich4PadBack && window.__rich4PadBack()", null);
            }
            return true;
        }
        return super.dispatchKeyEvent(event);
    }

    /** A key from a gamepad / joystick / D-pad device, or BACK made from an unhandled controller button. */
    private static boolean fromController(KeyEvent e) {
        if ((e.getFlags() & KeyEvent.FLAG_FALLBACK) != 0) return true;
        int pad = InputDevice.SOURCE_GAMEPAD, stick = InputDevice.SOURCE_JOYSTICK, dpad = InputDevice.SOURCE_DPAD;
        int s = e.getSource();
        if ((s & pad) == pad || (s & stick) == stick || (s & dpad) == dpad) return true;
        InputDevice d = e.getDevice();
        return d != null && !d.isVirtual() && (d.getSources() & pad) == pad;
    }

    @Override
    public void onResume() {
        super.onResume();
        // The controller's keys go to the focused view: keep that the web view (not the activity's root).
        if (bridge != null && bridge.getWebView() != null) bridge.getWebView().requestFocus();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) fullScreen();
    }

    // A game: hide the status and navigation bars (a swipe from the edge shows them for a moment), like the iOS app.
    private void fullScreen() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        WindowInsetsControllerCompat c = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        c.hide(WindowInsetsCompat.Type.systemBars());
        c.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
    }
}
