package app.porch.team;

import android.content.Context;
import android.net.Uri;

public final class PorchStore {
    private static final String PREFS = "porch";
    private static final String KEY = "url";

    private PorchStore() {}

    public static String getUrl(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, "");
    }

    public static boolean hasUrl(Context context) {
        return !getUrl(context).isEmpty();
    }

    public static void setUrl(Context context, String url) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, url).apply();
    }

    /** Accepts a host or a full https URL and keeps only the origin. */
    public static String normalize(String raw) {
        String value = raw == null ? "" : raw.trim();
        if (value.isEmpty()) return null;
        if (!value.startsWith("https://") && !value.startsWith("http://")) {
            value = "https://" + value;
        }
        Uri uri = Uri.parse(value);
        if (!"https".equals(uri.getScheme())) return null;
        String host = uri.getHost();
        if (host == null || !host.contains(".") || host.endsWith(".")) return null;
        int port = uri.getPort();
        if (port == -1) return "https://" + host + "/";
        return "https://" + host + ":" + port + "/";
    }
}
