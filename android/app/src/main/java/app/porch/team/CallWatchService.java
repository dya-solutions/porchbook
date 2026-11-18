package app.porch.team;

import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.webkit.CookieManager;

import androidx.core.content.ContextCompat;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/** Asks the published Porch whether anyone is calling, even if the page is not on screen. */
public class CallWatchService extends Service {
    private volatile boolean running;
    private Thread worker;
    private String presented = "";
    private String radioShown = "";

    static void start(Context context) {
        Intent intent = new Intent(context, CallWatchService.class);
        ContextCompat.startForegroundService(context, intent);
    }

    @Override
    public void onCreate() {
        super.onCreate();
        CookieManager.getInstance();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        NotificationReady();
        if (worker == null) {
            running = true;
            worker = new Thread(this::loop, "porch-ring");
            worker.start();
        }
        return START_STICKY;
    }

    private void NotificationReady() {
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(
                    42,
                    CallAlert.watchNotification(this),
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
            );
        } else {
            startForeground(42, CallAlert.watchNotification(this));
        }
    }

    private void loop() {
        while (running) {
            try {
                String origin = PorchStore.getUrl(this);
                if (origin.isEmpty()) {
                    stopSelf();
                    return;
                }
                String cookie = CookieManager.getInstance().getCookie(origin);
                if (cookie == null || cookie.isEmpty()) {
                    pause(4000);
                    continue;
                }
                String body = request(origin + "api/ring", cookie);
                if (body == null) {
                    pause(8000);
                    continue;
                }
                JSONObject json = new JSONObject(body);
                // Porchbook Radio: your request (or a dedication to you) is about to play.
                JSONObject radio = json.optJSONObject("radio");
                if (radio != null) {
                    String radioId = radio.optString("id");
                    if (!radioId.isEmpty() && !radioId.equals(radioShown)) {
                        radioShown = radioId;
                        CallAlert.showRadio(this, radio.optString("text", "Your request is on Porchbook Radio"), origin + "next?tune=1");
                    }
                }
                if (json.isNull("call")) {
                    if (!presented.isEmpty()) {
                        presented = "";
                        CallAlert.cancel(this);
                    }
                    pause(3000);
                    continue;
                }
                JSONObject call = json.getJSONObject("call");
                String id = call.optString("userId");
                if (!id.isEmpty() && !id.equals(presented)) {
                    presented = id;
                    String image = call.isNull("imageUrl") ? "" : call.optString("imageUrl");
                    CallAlert.show(this, call.optString("name", "Someone"), image, id, call.optString("at"), call.optBoolean("video"));
                }
                pause(3000);
            } catch (Exception ignored) {
                pause(5000);
            }
        }
    }

    static void dismiss(String origin, String cookie) {
        try {
            request(origin + "api/ring?dismiss=1", cookie);
        } catch (Exception ignored) {
            // The card closes either way.
        }
    }

    static void answer(String origin, String cookie) {
        try {
            request(origin + "api/ring?answer=1", cookie);
        } catch (Exception ignored) {
            // The page still opens the call.
        }
    }

    private static String request(String address, String cookie) throws Exception {
        HttpURLConnection conn = (HttpURLConnection) new URL(address).openConnection();
        conn.setConnectTimeout(8000);
        conn.setReadTimeout(8000);
        conn.setRequestProperty("Cookie", cookie);
        conn.setRequestProperty("Accept", "application/json");
        int code = conn.getResponseCode();
        if (code == 401) {
            conn.disconnect();
            return null;
        }
        InputStream stream = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
        String body = read(stream);
        conn.disconnect();
        if (code != 200) throw new IllegalStateException("status " + code);
        return body;
    }

    private static String read(InputStream stream) throws Exception {
        if (stream == null) return "";
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buffer = new byte[2048];
        int count;
        while ((count = stream.read(buffer)) != -1) out.write(buffer, 0, count);
        stream.close();
        return out.toString(StandardCharsets.UTF_8.name());
    }

    private static void pause(long millis) {
        try {
            Thread.sleep(millis);
        } catch (InterruptedException ignored) {
            Thread.currentThread().interrupt();
        }
    }

    @Override
    public void onDestroy() {
        running = false;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
