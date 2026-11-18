package app.porch.team;

import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Outline;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.ViewOutlineProvider;
import android.view.WindowManager;
import android.widget.ImageView;
import android.widget.TextView;

import androidx.appcompat.app.AppCompatActivity;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.text.DateFormat;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

/** The call card. It can sit over the lock screen when a call arrives. */
public class IncomingCallActivity extends AppCompatActivity {
    static final String EXTRA_NAME = "name";
    static final String EXTRA_IMAGE = "image";
    static final String EXTRA_USER = "userId";
    static final String EXTRA_AT = "at";
    static final String EXTRA_VIDEO = "video";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        } else {
            getWindow().addFlags(
                    WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                            | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
            );
        }
        setContentView(R.layout.activity_incoming);
        CallAlert.cancel(this);

        String name = text(EXTRA_NAME, "Someone");
        String image = text(EXTRA_IMAGE, "");
        String userId = text(EXTRA_USER, "");
        String at = text(EXTRA_AT, "");

        TextView nameView = findViewById(R.id.caller_name);
        TextView timeView = findViewById(R.id.caller_time);
        TextView initial = findViewById(R.id.caller_initial);
        ImageView photo = findViewById(R.id.caller_photo);
        nameView.setText(name);
        timeView.setText(clock(at));
        String letter = name.trim().isEmpty() ? "P" : name.trim().substring(0, 1).toUpperCase();
        initial.setText(letter);
        round(photo);
        if (!image.isEmpty()) loadPhoto(photo, initial, image);

        findViewById(R.id.decline).setOnClickListener(view -> decline());
        findViewById(R.id.answer).setOnClickListener(view -> answer(userId, getIntent().getBooleanExtra(EXTRA_VIDEO, false)));
        untint(findViewById(R.id.decline));
        untint(findViewById(R.id.answer));
    }

    private static void untint(android.view.View view) {
        if (view instanceof androidx.appcompat.widget.AppCompatButton button) {
            button.setSupportBackgroundTintList(null);
        }
    }

    private String text(String key, String fallback) {
        String value = getIntent().getStringExtra(key);
        return value == null || value.isEmpty() ? fallback : value;
    }

    private static void round(ImageView photo) {
        photo.setOutlineProvider(new ViewOutlineProvider() {
            @Override
            public void getOutline(View view, Outline outline) {
                outline.setOval(0, 0, view.getWidth(), view.getHeight());
            }
        });
        photo.setClipToOutline(true);
    }

    private void loadPhoto(ImageView photo, TextView initial, String image) {
        new Thread(() -> {
            Bitmap bitmap = null;
            HttpURLConnection conn = null;
            try {
                conn = (HttpURLConnection) new URL(image).openConnection();
                conn.setConnectTimeout(6000);
                conn.setReadTimeout(6000);
                try (InputStream stream = conn.getInputStream()) {
                    bitmap = BitmapFactory.decodeStream(stream);
                }
            } catch (Exception ignored) {
                bitmap = null;
            } finally {
                if (conn != null) conn.disconnect();
            }
            Bitmap ready = bitmap;
            if (ready == null) return;
            runOnUiThread(() -> {
                photo.setImageBitmap(ready);
                photo.setVisibility(View.VISIBLE);
                initial.setVisibility(View.GONE);
            });
        }, "porch-photo").start();
    }

    private void decline() {
        String origin = PorchStore.getUrl(this);
        String cookie = origin.isEmpty() ? null : android.webkit.CookieManager.getInstance().getCookie(origin);
        new Thread(() -> {
            if (!origin.isEmpty() && cookie != null) {
                CallWatchService.dismiss(origin, cookie);
            }
            runOnUiThread(this::finish);
        }, "porch-decline").start();
    }

    private void answer(String userId, boolean video) {
        String origin = PorchStore.getUrl(this);
        String cookie = origin.isEmpty() ? null : android.webkit.CookieManager.getInstance().getCookie(origin);
        String target = origin + "call?userId=" + Uri.encode(userId) + "&join=1&pick=1" + (video ? "&video=1" : "");
        new Thread(() -> {
            if (!origin.isEmpty() && cookie != null) CallWatchService.answer(origin, cookie);
        }, "porch-answer").start();
        Intent open = new Intent(this, PorchLauncher.class);
        open.putExtra(PorchLauncher.EXTRA_URL, target);
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        startActivity(open);
        finish();
    }

    private static String clock(String at) {
        Date date = new Date();
        if (!at.isEmpty()) {
            try {
                SimpleDateFormat iso = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
                iso.setTimeZone(TimeZone.getTimeZone("UTC"));
                date = iso.parse(at);
                if (date == null) date = new Date();
            } catch (Exception ignored) {
                date = new Date();
            }
        }
        return DateFormat.getTimeInstance(DateFormat.SHORT).format(date).toLowerCase();
    }
}
