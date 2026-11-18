package app.porch.team;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.webkit.WebView;

import androidx.core.content.FileProvider;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Refresh's update: download the newer porch.apk inside the app and open Android's install screen.
 * Android always asks the person to tap Install; nothing is replaced silently.
 */
final class AppUpdate {
    private static volatile boolean busy;

    private AppUpdate() {}

    static int versionCode(Activity activity) {
        try {
            PackageInfo info = activity.getPackageManager().getPackageInfo(activity.getPackageName(), 0);
            return Build.VERSION.SDK_INT >= 28 ? (int) info.getLongVersionCode() : info.versionCode;
        } catch (PackageManager.NameNotFoundException ignored) {
            return 0;
        }
    }

    /** Tell the page how it's going: window.__porchUpdate(state, percent). */
    private static void tell(Activity activity, WebView web, String state, int percent) {
        if (web == null) return;
        String safe = state.replaceAll("[^a-z]", "");
        activity.runOnUiThread(() -> web.evaluateJavascript("window.__porchUpdate&&window.__porchUpdate('" + safe + "'," + percent + ")", null));
    }

    static void start(Activity activity, WebView web, String address) {
        if (busy) return;
        // First time only: Android needs "Install unknown apps" allowed for Porchbook.
        if (Build.VERSION.SDK_INT >= 26 && !activity.getPackageManager().canRequestPackageInstalls()) {
            tell(activity, web, "allow", 0);
            try {
                activity.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + activity.getPackageName())));
            } catch (Exception ignored) {
                tell(activity, web, "failed", 0);
            }
            return;
        }
        if (address == null || !address.startsWith("https://")) {
            tell(activity, web, "failed", 0);
            return;
        }
        busy = true;
        new Thread(() -> {
            File folder = new File(activity.getCacheDir(), "update");
            File apk = new File(folder, "porch.apk");
            HttpURLConnection connection = null;
            try {
                if (!folder.exists()) folder.mkdirs();
                connection = (HttpURLConnection) new URL(address).openConnection();
                connection.setConnectTimeout(20000);
                connection.setReadTimeout(30000);
                connection.setRequestProperty("Cache-Control", "no-cache");
                int total = connection.getContentLength();
                try (InputStream in = connection.getInputStream(); FileOutputStream out = new FileOutputStream(apk)) {
                    byte[] buffer = new byte[64 * 1024];
                    long got = 0;
                    int last = -1;
                    int read;
                    while ((read = in.read(buffer)) > 0) {
                        out.write(buffer, 0, read);
                        got += read;
                        int percent = total > 0 ? (int) (got * 100 / total) : 0;
                        if (percent != last && percent % 5 == 0) {
                            last = percent;
                            tell(activity, web, "downloading", percent);
                        }
                    }
                }
                tell(activity, web, "install", 100);
                Uri uri = FileProvider.getUriForFile(activity, activity.getPackageName() + ".fileprovider", apk);
                Intent install = new Intent(Intent.ACTION_VIEW);
                install.setDataAndType(uri, "application/vnd.android.package-archive");
                install.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                activity.runOnUiThread(() -> {
                    try {
                        activity.startActivity(install);
                    } catch (Exception ignored) {
                        tell(activity, web, "failed", 0);
                    }
                });
            } catch (Exception ignored) {
                tell(activity, web, "failed", 0);
            } finally {
                if (connection != null) connection.disconnect();
                busy = false;
            }
        }, "porch-update").start();
    }
}
