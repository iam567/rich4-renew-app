package pro.areu.rich4;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.net.URL;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

/**
 * 局域網房間 (game/src/ui/lan-find.ts): the rooms PCs host on this phone's Wi-Fi (game/desktop/lan-relay.cjs). Every
 * address of this phone's /24 is asked for /lan on the given ports, 64 at a time, each giving up quickly — from here,
 * since a web view allows too few connections at once for that. Nothing leaves the local network.
 */
@CapacitorPlugin(name = "LanInfo")
public class LanInfoPlugin extends Plugin {
    /** This phone's IPv4 addresses on the local network, Wi-Fi first. */
    private static List<String> mine() {
        List<String> wifi = new ArrayList<>(), other = new ArrayList<>();
        try {
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!ni.isUp() || ni.isLoopback()) continue;
                for (InetAddress a : Collections.list(ni.getInetAddresses())) {
                    if (!(a instanceof Inet4Address) || !a.isSiteLocalAddress()) continue;
                    (ni.getName().startsWith("wlan") || ni.getName().startsWith("eth") ? wifi : other).add(a.getHostAddress());
                }
            }
        } catch (Exception e) { /* none */ }
        wifi.addAll(other);
        return wifi;
    }

    @PluginMethod
    public void find(PluginCall call) {
        JSArray given = call.getArray("ports");
        List<Integer> ports = new ArrayList<>();
        try { for (int i = 0; given != null && i < given.length(); i++) ports.add(given.getInt(i)); } catch (Exception e) { /* none */ }
        if (ports.isEmpty()) ports.add(8842);
        new Thread(() -> {
            List<String> mine = mine();
            LinkedHashSet<String> hosts = new LinkedHashSet<>(mine);
            int nets = 0;
            for (String ip : mine) {
                if (nets++ >= 3) break;
                String net = ip.substring(0, ip.lastIndexOf('.'));
                for (int i = 1; i < 255; i++) hosts.add(net + "." + i);
            }
            JSArray found = new JSArray();
            ExecutorService pool = Executors.newFixedThreadPool(64);
            for (int port : ports) for (String ip : hosts) {
                final String addr = ip + ":" + port;
                pool.submit(() -> {
                    HttpURLConnection c = null;
                    try {
                        c = (HttpURLConnection) new URL("http://" + addr + "/lan").openConnection();
                        c.setConnectTimeout(700);
                        c.setReadTimeout(900);
                        if (c.getResponseCode() != 200) return;
                        InputStream in = c.getInputStream();
                        ByteArrayOutputStream b = new ByteArrayOutputStream();
                        byte[] buf = new byte[1024];
                        for (int n; (n = in.read(buf)) > 0 && b.size() < 4096; ) b.write(buf, 0, n);
                        String body = b.toString("UTF-8");
                        if (!body.contains("\"rich4\":\"lan\"")) return;
                        JSObject o = new JSObject();
                        o.put("addr", addr);
                        o.put("body", body);
                        synchronized (found) { found.put(o); }
                    } catch (Exception e) { /* nobody there */ } finally { if (c != null) c.disconnect(); }
                });
            }
            pool.shutdown();
            try { pool.awaitTermination(30, TimeUnit.SECONDS); } catch (InterruptedException e) { /* as far as it got */ }
            JSObject r = new JSObject();
            synchronized (found) { r.put("found", found); }
            call.resolve(r);
        }).start();
    }
}
