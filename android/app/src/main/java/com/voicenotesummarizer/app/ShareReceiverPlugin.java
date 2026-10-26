package com.voicenotesummarizer.app;

import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.OpenableColumns;
import android.util.Log;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;

/**
 * Receives voice notes shared from WhatsApp (or any app) and hands them to the web app.
 * Shared files are copied into the app's cache; the web app reads them with
 * Capacitor.convertFileSrc(path) and deletes nothing — Android clears the cache itself.
 */
@CapacitorPlugin(name = "ShareReceiver")
public class ShareReceiverPlugin extends Plugin {

    private static final String TAG = "ShareReceiver";
    private static final long MAX_BYTES = 200L * 1024 * 1024;
    private static JSArray pending = new JSArray();
    private static ShareReceiverPlugin instance;

    @Override
    public void load() {
        instance = this;
    }

    @PluginMethod
    public void getShared(PluginCall call) {
        JSObject result = new JSObject();
        synchronized (ShareReceiverPlugin.class) {
            result.put("files", pending);
            pending = new JSArray();
        }
        call.resolve(result);
    }

    static void receive(Context ctx, Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        List<Uri> uris = new ArrayList<>();
        try {
            if (Intent.ACTION_SEND.equals(action)) {
                Uri u = getStream(intent);
                if (u != null) uris.add(u);
            } else if (Intent.ACTION_SEND_MULTIPLE.equals(action)) {
                ArrayList<Uri> list = getStreams(intent);
                if (list != null) uris.addAll(list);
            } else if (Intent.ACTION_VIEW.equals(action) && intent.getData() != null) {
                uris.add(intent.getData());
            }
        } catch (Exception e) {
            Log.w(TAG, "Could not read shared intent", e);
        }
        if (uris.isEmpty()) return;

        // Mark the intent as handled so a rotation/recreate doesn't import it twice
        intent.setAction(Intent.ACTION_MAIN);

        new Thread(() -> {
            int added = 0;
            for (Uri uri : uris) {
                JSObject f = copyToCache(ctx, uri, intent.getType());
                if (f != null) {
                    synchronized (ShareReceiverPlugin.class) { pending.put(f); }
                    added++;
                }
            }
            if (added > 0 && instance != null) {
                instance.notifyListeners("shared", new JSObject(), true);
            }
        }).start();
    }

    @SuppressWarnings("deprecation")
    private static Uri getStream(Intent intent) {
        if (Build.VERSION.SDK_INT >= 33) return intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri.class);
        return intent.getParcelableExtra(Intent.EXTRA_STREAM);
    }

    @SuppressWarnings("deprecation")
    private static ArrayList<Uri> getStreams(Intent intent) {
        if (Build.VERSION.SDK_INT >= 33) return intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri.class);
        return intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
    }

    private static JSObject copyToCache(Context ctx, Uri uri, String fallbackType) {
        ContentResolver cr = ctx.getContentResolver();
        String name = "voice-note";
        try (Cursor c = cr.query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                String n = c.getString(0);
                if (n != null && !n.isEmpty()) name = n;
            }
        } catch (Exception ignored) {}
        String type = null;
        try { type = cr.getType(uri); } catch (Exception ignored) {}
        if (type == null) type = fallbackType != null ? fallbackType : "audio/ogg";

        File dir = new File(ctx.getCacheDir(), "shared");
        if (!dir.exists() && !dir.mkdirs()) return null;
        String safe = name.replaceAll("[^A-Za-z0-9._-]", "_");
        File out = new File(dir, System.currentTimeMillis() + "-" + safe);
        long total = 0;
        boolean ok = false;
        try (InputStream in = cr.openInputStream(uri); OutputStream os = new FileOutputStream(out)) {
            if (in != null) {
                byte[] buf = new byte[64 * 1024];
                int r;
                ok = true;
                while ((r = in.read(buf)) != -1) {
                    total += r;
                    if (total > MAX_BYTES) { ok = false; break; }
                    os.write(buf, 0, r);
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "Copy failed for " + uri, e);
            ok = false;
        }
        if (!ok) {
            //noinspection ResultOfMethodCallIgnored
            out.delete();
            return null;
        }
        JSObject f = new JSObject();
        f.put("path", out.getAbsolutePath());
        f.put("name", name);
        f.put("mimeType", type);
        f.put("size", total);
        return f;
    }
}
