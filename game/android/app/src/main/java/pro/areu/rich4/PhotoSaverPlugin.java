package pro.areu.rich4;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.File;
import java.io.OutputStream;

/**
 * 「儲存到相簿」 of the results screen (game/src/ui/share.ts): writes a PNG (base64 `data`, file name `name`) into
 * Pictures/大富翁4 through MediaStore. Android 10+ needs no permission; 9 and older ask for WRITE_EXTERNAL_STORAGE.
 */
@CapacitorPlugin(
    name = "PhotoSaver",
    permissions = { @Permission(alias = "storage", strings = { Manifest.permission.WRITE_EXTERNAL_STORAGE }) }
)
public class PhotoSaverPlugin extends Plugin {
    private static final String ALBUM = "大富翁4";

    @PluginMethod
    public void save(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q && getPermissionState("storage") != PermissionState.GRANTED) {
            requestPermissionForAlias("storage", call, "storageDone");
            return;
        }
        write(call);
    }

    @PermissionCallback
    private void storageDone(PluginCall call) {
        if (getPermissionState("storage") == PermissionState.GRANTED) write(call);
        else call.reject("沒有相簿權限", "DENIED");
    }

    private void write(PluginCall call) {
        String data = call.getString("data");
        if (data == null) { call.reject("無法讀取圖片", "BAD_IMAGE"); return; }
        byte[] bytes;
        try { bytes = Base64.decode(data, Base64.DEFAULT); } catch (IllegalArgumentException e) { call.reject("無法讀取圖片", "BAD_IMAGE"); return; }
        String name = call.getString("name", "rich4-" + System.currentTimeMillis()) + ".png";
        ContentValues v = new ContentValues();
        v.put(MediaStore.Images.Media.DISPLAY_NAME, name);
        v.put(MediaStore.Images.Media.MIME_TYPE, "image/png");
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            v.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/" + ALBUM);
            v.put(MediaStore.Images.Media.IS_PENDING, 1);
        } else {
            File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES), ALBUM);
            if (!dir.exists() && !dir.mkdirs()) { call.reject("儲存失敗", "FAILED"); return; }
            v.put(MediaStore.Images.Media.DATA, new File(dir, name).getAbsolutePath());
        }
        ContentResolver r = getContext().getContentResolver();
        Uri uri = r.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, v);
        if (uri == null) { call.reject("儲存失敗", "FAILED"); return; }
        try (OutputStream out = r.openOutputStream(uri)) {
            if (out == null) throw new java.io.IOException("no stream");
            out.write(bytes);
        } catch (Exception e) {
            r.delete(uri, null, null);
            call.reject("儲存失敗", "FAILED");
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            v.clear();
            v.put(MediaStore.Images.Media.IS_PENDING, 0);
            r.update(uri, v, null, null);
        }
        call.resolve();
    }
}
