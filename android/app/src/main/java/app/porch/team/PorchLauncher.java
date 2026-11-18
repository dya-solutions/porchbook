package app.porch.team;

import android.Manifest;
import android.app.NotificationManager;
import android.app.PictureInPictureParams;
import android.util.Rational;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.ConnectivityManager;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.media.AudioManager;
import android.os.Vibrator;
import android.os.VibrationEffect;
import android.os.Build;
import android.os.Bundle;
import android.os.Message;
import android.os.PowerManager;
import android.provider.Settings;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.util.Base64;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.Toast;

import androidx.activity.OnBackPressedCallback;
import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;

import java.io.File;
import java.io.FileOutputStream;
import java.lang.ref.WeakReference;
import java.util.ArrayList;
import org.json.JSONObject;
import java.util.List;

/** Opens the published site inside the app. No separate browser is required. */
public class PorchLauncher extends AppCompatActivity {
    static final String EXTRA_URL = "url";
    private static final int MEDIA_REQUEST = 41;
    private static final int NOTICE_REQUEST = 42;
    private static final int DEVICE_REQUEST = 43;
    private static final int FILE_REQUEST = 44;
    // The page's "Choose file" waits here for the phone's file picker.
    private android.webkit.ValueCallback<Uri[]> fileCallback;
    private static volatile boolean inFront;
    private WebView web;
    private FrameLayout root;
    // The Bible's "other versions" window: a second web view over the lower part of the screen.
    private WebView pane;
    private String paneStart = "";
    // The verse to land on (app 1.2.6): its number, the book code (JHN) and chapter.
    private int paneVerse = 0;
    private String paneCode = "";
    private int paneChapter = 0;
    // The window stays ready after it's closed (hidden), so the next OTHERS opens at once.
    private boolean paneShown;
    private String paneUrl = "";
    // ☀ The window's look (app 1.3.6): a CSS filter laid over the site's page.
    private String paneLook = "";
    private LoaderView splash;
    private boolean revealed;
    private volatile boolean rhemaOn;
    private boolean skipPermissionResume;
    private boolean askedFiles;
    private PermissionRequest pendingPermission;
    private String[] pendingDevicePerms = new String[0];

    static boolean isInFront() {
        return inFront;
    }

    private static WeakReference<PorchLauncher> current = new WeakReference<>(null);
    private volatile boolean radioOn;

    /** From the radio notification: tell the page (e.g. "stop"). */
    static void radioCommand(String command) {
        PorchLauncher activity = current.get();
        if (activity == null) return;
        String safe = command == null ? "" : command.replaceAll("[^a-z]", "");
        activity.runOnUiThread(() -> {
            if (activity.web != null) activity.web.evaluateJavascript("window.__porchRadio&&window.__porchRadio('" + safe + "')", null);
        });
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Declared see-through on Android 11+ (for the founder's peep hole): solid unless peeping.
        if (Build.VERSION.SDK_INT >= 30) setTranslucent(false);
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE);
        String start = PorchStore.getUrl(this);
        if (start.isEmpty()) {
            finish();
            return;
        }

        current = new WeakReference<>(this);
        web = new WebView(this);
        web.setBackgroundColor(Color.BLACK);
        web.setLayerType(View.LAYER_TYPE_HARDWARE, null);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setSupportZoom(false);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setSupportMultipleWindows(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setOffscreenPreRaster(true);
        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(web, true);
        web.addJavascriptInterface(new MicBridge(this), "PorchMic");
        web.addJavascriptInterface(new RhemaBridge(this), "PorchApp");
        web.addJavascriptInterface(new SpeechBridge(this), "PorchSpeech");
        web.addJavascriptInterface(new WindowBridge(this), "PorchWindow");

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                if (splash != null && !revealed) splash.setProgress(newProgress);
            }

            @Override
            public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> askForMedia(request));
            }

            // Lets <input type="file"> work inside the app (e.g. uploading
            // radio audio or a photo): opens the phone's file picker.
            @Override
            public boolean onShowFileChooser(WebView view, android.webkit.ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                Intent pick;
                try {
                    pick = params.createIntent();
                } catch (Exception e) {
                    pick = new Intent(Intent.ACTION_GET_CONTENT);
                    pick.addCategory(Intent.CATEGORY_OPENABLE);
                    pick.setType("*/*");
                }
                if (params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) {
                    pick.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                }
                try {
                    skipPermissionResume = true;
                    startActivityForResult(Intent.createChooser(pick, "Choose a file"), FILE_REQUEST);
                    return true;
                } catch (ActivityNotFoundException e) {
                    fileCallback = null;
                    Toast.makeText(PorchLauncher.this, "No app on this phone can pick files.", Toast.LENGTH_LONG).show();
                    return false;
                }
            }

            @Override
            public boolean onCreateWindow(WebView view, boolean dialog, boolean userGesture, Message resultMsg) {
                WebView popup = new WebView(PorchLauncher.this);
                popup.setWebViewClient(new WebViewClient() {
                    @Override
                    public boolean shouldOverrideUrlLoading(WebView child, WebResourceRequest request) {
                        openOutside(request.getUrl());
                        child.destroy();
                        return true;
                    }
                });
                WebView.WebViewTransport transport = (WebView.WebViewTransport) resultMsg.obj;
                transport.setWebView(popup);
                resultMsg.sendToTarget();
                return true;
            }
        });

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (request.isForMainFrame() && searchTakeover(request.getUrl())) {
                    backToPorch(view);
                    return true;
                }
                return openOutside(request.getUrl());
            }

            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                if (searchTakeover(Uri.parse(url == null ? "" : url))) {
                    backToPorch(view);
                    return;
                }
                view.evaluateJavascript("document.documentElement.classList.add('porch-app')", null);
            }

            @Override
            public void onPageCommitVisible(WebView view, String url) {
                reveal();
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                view.evaluateJavascript("document.documentElement.classList.add('porch-app');" + MIC_PATCH, null);
                reveal();
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (!request.isForMainFrame()) return;
                view.loadDataWithBaseURL(
                        null,
                        "<html><body style=\"margin:0;background:#000;color:#f8a018;font-family:sans-serif;padding:32px\">"
                                + "<h1>Porchbook</h1>"
                                + "<p style=\"color:#90c840\">This phone needs an internet connection to open Porchbook.</p>"
                                + "</body></html>",
                        "text/html",
                        "utf-8",
                        null
                );
            }
        });

        String open = openingUrl(start);
        allowOverLock(open);
        root = new FrameLayout(this);
        FrameLayout.LayoutParams fill = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
        );
        root.addView(web, fill);
        // Opening: Porchbook's counting ring (app 1.3.8), fed by how much of the page has loaded.
        splash = new LoaderView(this);
        root.addView(splash, fill);
        setContentView(root);
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (pane != null && paneShown) {
                    paneClose();
                    web.evaluateJavascript("window.__porchWindow&&window.__porchWindow('closed')", null);
                    return;
                }
                if (web.canGoBack()) {
                    web.goBack();
                    return;
                }
                setEnabled(false);
                getOnBackPressedDispatcher().onBackPressed();
            }
        });

        String requested = getIntent().getStringExtra(EXTRA_URL);
        if (savedInstanceState != null && (requested == null || requested.isEmpty())) {
            web.restoreState(savedInstanceState);
        } else {
            web.loadUrl(open);
        }
        askToNotify();
        skipPermissionResume = true;
        new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(this::reveal, 15000);
    }

    private void reveal() {
        if (revealed || splash == null) return;
        revealed = true;
        final LoaderView loader = splash;
        loader.finish(() -> loader.animate().alpha(0f).setDuration(160).withEndAction(() -> loader.setVisibility(View.GONE)));
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        String requested = intent.getStringExtra(EXTRA_URL);
        if (requested != null && !requested.isEmpty() && web != null) {
            allowOverLock(requested);
            web.loadUrl(requested);
        }
    }

    @Override
    public void onUserLeaveHint() {
        super.onUserLeaveHint();
        if (rhemaOn && !isInPictureInPictureMode()) {
            try {
                enterPictureInPictureMode(new PictureInPictureParams.Builder().setAspectRatio(new Rational(1, 1)).build());
            } catch (IllegalStateException ignored) {
                // The phone refused the small window. The clip stops with the app.
            }
        }
    }

    @Override
    public void onPictureInPictureModeChanged(boolean inPicture, @NonNull android.content.res.Configuration newConfig) {
        super.onPictureInPictureModeChanged(inPicture, newConfig);
        if (web == null) return;
        web.onResume();
        web.evaluateJavascript(
                "document.documentElement.classList." + (inPicture ? "add" : "remove") + "('porch-pip')",
                null
        );
    }

    @Override
    protected void onResume() {
        super.onResume();
        inFront = true;
        if (web != null) {
            web.onResume();
            web.evaluateJavascript("window.dispatchEvent(new Event('porch-bibles'))", null);
        }
        if (skipPermissionResume) {
            skipPermissionResume = false;
            return;
        }
        askCallPermissions();
    }

    @Override
    protected void onPause() {
        inFront = false;
        CookieManager.getInstance().flush();
        if (isInPictureInPictureMode() && web != null) web.onResume();
        // While the radio plays, keep the page awake behind other apps or a locked screen.
        if (radioOn && web != null) {
            web.onResume();
            web.resumeTimers();
        }
        super.onPause();
    }

    private int searchBounces = 0;

    private boolean searchTakeover(Uri uri) {
        if (uri == null) return false;
        String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase();
        return host.equals("yahoo.com") || host.endsWith(".yahoo.com") || host.contains("search.yahoo");
    }

    private void backToPorch(WebView view) {
        if (searchBounces >= 1) {
            view.loadDataWithBaseURL(
                    null,
                    "<html><body style=\"margin:0;background:#000;color:#f8a018;font-family:sans-serif;padding:32px\">"
                            + "<h1>Porchbook</h1>"
                            + "<p style=\"color:#90c840\">This phone was sent to another page. Porchbook did not open. Long-press the icon and choose Change Porchbook, then paste the published address again.</p>"
                            + "</body></html>",
                    "text/html",
                    "utf-8",
                    null
            );
            reveal();
            return;
        }
        searchBounces += 1;
        String home = PorchStore.getUrl(this);
        if (!home.isEmpty()) view.loadUrl(home);
    }

    private String openingUrl(String start) {
        String requested = getIntent().getStringExtra(EXTRA_URL);
        return requested == null || requested.isEmpty() ? start : requested;
    }

    private void allowOverLock(String url) {
        boolean calling = url != null && url.contains("call?userId=");
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(calling);
            setTurnScreenOn(calling);
        }
    }

    private void askToNotify() {
        askCallPermissions();
    }

    /** After install: notifications, then the lock-screen call, then leave battery saving off. */
    private void askCallPermissions() {
        if (Build.VERSION.SDK_INT >= 33
                && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this, new String[] {Manifest.permission.POST_NOTIFICATIONS}, NOTICE_REQUEST);
            return;
        }
        CallWatchService.start(this);
        if (needsFullScreen()) {
            remember("asked_fullscreen");
            openSettings(new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT));
            return;
        }
        PowerManager power = getSystemService(PowerManager.class);
        if (power != null
                && !power.isIgnoringBatteryOptimizations(getPackageName())
                && !getSharedPreferences("porch", MODE_PRIVATE).getBoolean("asked_battery", false)) {
            remember("asked_battery");
            Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
            openSettings(intent);
        }
    }

    private boolean needsFullScreen() {
        if (Build.VERSION.SDK_INT < 34) return false;
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null || manager.canUseFullScreenIntent()) return false;
        return !getSharedPreferences("porch", MODE_PRIVATE).getBoolean("asked_fullscreen", false);
    }

    private void remember(String key) {
        getSharedPreferences("porch", MODE_PRIVATE).edit().putBoolean(key, true).apply();
    }

    private void openSettings(Intent intent) {
        intent.setData(Uri.parse("package:" + getPackageName()));
        try {
            startActivity(intent);
        } catch (ActivityNotFoundException ignored) {
            // This phone has no screen for that switch. The call can still arrive as a notification.
        }
    }

    private boolean openOutside(Uri uri) {
        if (uri == null) return false;
        String scheme = uri.getScheme() == null ? "" : uri.getScheme();
        String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase();
        if (scheme.equals("sms") || scheme.equals("smsto")) {
            Intent intent = new Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:"));
            String body = uri.getQueryParameter("body");
            if (body != null) intent.putExtra("sms_body", body);
            return launch(intent);
        }
        boolean share = host.equals("wa.me")
                || host.contains("whatsapp.com")
                || host.equals("ig.me")
                || host.contains("instagram.com")
                || host.contains("facebook.com")
                || host.contains("messenger.com")
                || host.equals("m.me");
        if (share) {
            String text = first(uri.getQueryParameter("text"), uri.getQueryParameter("body"), uri.getQueryParameter("link"));
            String pkg = "com.facebook.orca";
            if (host.equals("wa.me") || host.contains("whatsapp")) pkg = "com.whatsapp";
            else if (host.contains("instagram") || host.equals("ig.me")) pkg = "com.instagram.android";
            if (text != null && !text.isEmpty()) {
                Intent send = new Intent(Intent.ACTION_SEND);
                send.setType("text/plain");
                send.putExtra(Intent.EXTRA_TEXT, text);
                send.setPackage(pkg);
                if (launch(send)) return true;
                if (pkg.equals("com.whatsapp")) {
                    send.setPackage("com.whatsapp.w4b");
                    if (launch(send)) return true;
                }
                if (pkg.equals("com.facebook.orca")) {
                    send.setPackage("com.facebook.katana");
                    if (launch(send)) return true;
                }
            }
            return launch(new Intent(Intent.ACTION_VIEW, uri));
        }
        if (!scheme.equals("http") && !scheme.equals("https") && !scheme.isEmpty()) {
            return launch(new Intent(Intent.ACTION_VIEW, uri));
        }
        return false;
    }

    private boolean launch(Intent intent) {
        try {
            startActivity(intent);
            return true;
        } catch (ActivityNotFoundException ignored) {
            return false;
        }
    }

    private static String first(String... values) {
        for (String value : values) {
            if (value != null && !value.isEmpty()) return value;
        }
        return null;
    }

    /** The website asks for this before it opens the microphone, so the phone shows its own prompt. */
    void askDevice(String kind) {
        boolean video = "video".equals(kind) || "both".equals(kind);
        boolean audio = !"video".equals(kind);
        List<String> needed = new ArrayList<>();
        if (audio && ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            needed.add(Manifest.permission.RECORD_AUDIO);
        }
        if (video && ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            needed.add(Manifest.permission.CAMERA);
        }
        if (needed.isEmpty()) {
            tellPage(true);
            return;
        }
        for (String permission : needed) {
            boolean asked = getSharedPreferences("porch", MODE_PRIVATE).getBoolean("asked_" + permission, false);
            if (asked && !ActivityCompat.shouldShowRequestPermissionRationale(this, permission)) {
                openAppSettings();
                tellPage(false);
                return;
            }
        }
        pendingDevicePerms = needed.toArray(new String[0]);
        ActivityCompat.requestPermissions(this, pendingDevicePerms, DEVICE_REQUEST);
    }

    private void openAppSettings() {
        try {
            Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            intent.setData(Uri.fromParts("package", getPackageName(), null));
            startActivity(intent);
        } catch (ActivityNotFoundException ignored) {
            // Nothing else can ask for the microphone.
        }
    }

    private void tellPage(boolean ok) {
        if (web == null) return;
        web.evaluateJavascript("window.__porchAllow&&window.__porchAllow(" + (ok ? "true" : "false") + ")", null);
    }

    private void askForMedia(PermissionRequest request) {
        List<String> needed = new ArrayList<>();
        for (String resource : request.getResources()) {
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)
                    && ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                needed.add(Manifest.permission.RECORD_AUDIO);
            }
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)
                    && ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                needed.add(Manifest.permission.CAMERA);
            }
        }
        if (needed.isEmpty()) {
            grantMedia(request);
            return;
        }
        pendingPermission = request;
        ActivityCompat.requestPermissions(this, needed.toArray(new String[0]), MEDIA_REQUEST);
    }

    private void grantMedia(PermissionRequest request) {
        List<String> grant = new ArrayList<>();
        for (String resource : request.getResources()) {
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)
                    || PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)) {
                grant.add(resource);
            }
        }
        if (grant.isEmpty()) request.deny();
        else request.grant(grant.toArray(new String[0]));
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != FILE_REQUEST) return;
        android.webkit.ValueCallback<Uri[]> callback = fileCallback;
        fileCallback = null;
        if (callback == null) return;
        Uri[] picked = null;
        if (resultCode == RESULT_OK && data != null) {
            if (data.getClipData() != null) {
                int count = data.getClipData().getItemCount();
                picked = new Uri[count];
                for (int i = 0; i < count; i++) picked[i] = data.getClipData().getItemAt(i).getUri();
            } else if (data.getData() != null) {
                picked = new Uri[] { data.getData() };
            }
        }
        callback.onReceiveValue(picked);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        if (requestCode == NOTICE_REQUEST) {
            return;
        }
        if (requestCode == DEVICE_REQUEST) {
            boolean granted = grantResults.length > 0;
            for (int result : grantResults) {
                if (result != PackageManager.PERMISSION_GRANTED) granted = false;
            }
            android.content.SharedPreferences.Editor editor = getSharedPreferences("porch", MODE_PRIVATE).edit();
            for (String permission : pendingDevicePerms) editor.putBoolean("asked_" + permission, true);
            editor.apply();
            pendingDevicePerms = new String[0];
            tellPage(granted);
            return;
        }
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != MEDIA_REQUEST || pendingPermission == null) return;
        PermissionRequest request = pendingPermission;
        pendingPermission = null;
        boolean allowed = false;
        for (int result : grantResults) {
            if (result == PackageManager.PERMISSION_GRANTED) allowed = true;
        }
        if (allowed) grantMedia(request);
        else request.deny();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (web != null) web.saveState(outState);
    }

    // ---- The notebook's live transcriber: Android's own speech recognition, kept listening
    // (it stops after each pause, so it starts again by itself until the page says stop).
    private SpeechRecognizer recognizer;
    private boolean hearing;
    private String hearLang = "en-GB";

    private void hearSend(String type, String text) {
        if (web == null) return;
        try {
            JSONObject message = new JSONObject();
            message.put("type", type);
            message.put("text", text == null ? "" : text);
            web.evaluateJavascript("window.__porchSpeech&&window.__porchSpeech(" + message.toString() + ")", null);
        } catch (Exception ignored) {
            // The page simply doesn't get this piece.
        }
    }

    private static String firstOf(Bundle bundle) {
        if (bundle == null) return "";
        ArrayList<String> said = bundle.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        return said == null || said.isEmpty() || said.get(0) == null ? "" : said.get(0);
    }

    void hearStart(String lang) {
        if (lang != null && lang.matches("[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?")) hearLang = lang;
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            hearSend("error", "unavailable");
            return;
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            hearSend("error", "not-allowed");
            return;
        }
        hearing = true;
        if (recognizer == null) {
            recognizer = SpeechRecognizer.createSpeechRecognizer(this);
            recognizer.setRecognitionListener(new RecognitionListener() {
                @Override public void onReadyForSpeech(Bundle params) { hearSend("ready", ""); }
                @Override public void onBeginningOfSpeech() {}
                @Override public void onRmsChanged(float rmsdB) {}
                @Override public void onBufferReceived(byte[] buffer) {}
                @Override public void onEndOfSpeech() {}
                @Override public void onEvent(int eventType, Bundle params) {}
                @Override public void onPartialResults(Bundle partialResults) {
                    String text = firstOf(partialResults);
                    if (!text.isEmpty()) hearSend("partial", text);
                }
                @Override public void onResults(Bundle results) {
                    String text = firstOf(results);
                    if (!text.isEmpty()) hearSend("final", text);
                    hearAgain(150);
                }
                @Override public void onError(int error) {
                    if (error == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS) {
                        hearing = false;
                        hearSend("error", "not-allowed");
                        return;
                    }
                    // No words in a pause, a timeout, or a busy engine: listen again.
                    hearSend("pause", "");
                    hearAgain(error == SpeechRecognizer.ERROR_RECOGNIZER_BUSY ? 600 : 250);
                }
            });
        }
        hearListen();
    }

    private void hearListen() {
        if (!hearing || recognizer == null) return;
        Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, hearLang);
        intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
        intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
        intent.putExtra("android.speech.extra.DICTATION_MODE", true);
        intent.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 4000L);
        intent.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 4000L);
        intent.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS, 60000L);
        try {
            recognizer.startListening(intent);
        } catch (Exception e) {
            hearAgain(800);
        }
    }

    private void hearAgain(long delay) {
        if (!hearing || web == null) return;
        web.postDelayed(this::hearListen, delay);
    }

    void hearStop() {
        hearing = false;
        if (recognizer != null) {
            try {
                recognizer.cancel();
                recognizer.destroy();
            } catch (Exception ignored) {
                // Already stopped.
            }
            recognizer = null;
        }
        hearSend("stopped", "");
    }

    private int paneHeight(double topCss) {
        float density = getResources().getDisplayMetrics().density;
        int top = (int) Math.round(topCss * density);
        int full = root != null && root.getHeight() > 0 ? root.getHeight() : getResources().getDisplayMetrics().heightPixels;
        return Math.max(1, full - top);
    }

    /** Is there data right now? (The OTHERS window then reads from the phone's memory when there isn't.) */
    private boolean hasData() {
        try {
            ConnectivityManager cm = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
            if (cm == null) return true;
            NetworkCapabilities caps = cm.getNetworkCapabilities(cm.getActiveNetwork());
            return caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
        } catch (Exception e) {
            return true;
        }
    }

    private static final String PANE_NO_DATA =
            "<html><head><meta name='viewport' content='width=device-width,initial-scale=1'></head>"
            + "<body style='margin:0;display:flex;align-items:center;justify-content:center;height:100vh;background:#fff;font-family:sans-serif;color:#555;text-align:center;padding:0 24px'>"
            + "<p style='font-size:15px;line-height:1.5'>No data: this verse hasn't been opened on this phone yet.<br><br>It will show here once you've opened it with data.</p></body></html>";

    void paneOpen(String url, double topCss) {
        if (root == null || url == null || !(url.startsWith("https://") || url.startsWith("http://"))) return;
        if (pane == null) {
            pane = new WebView(this);
            WebSettings settings = pane.getSettings();
            settings.setJavaScriptEnabled(true);
            settings.setDomStorageEnabled(true);
            settings.setLoadWithOverviewMode(true);
            settings.setUseWideViewPort(true);
            pane.setBackgroundColor(Color.WHITE);
            pane.setWebViewClient(new WebViewClient() {
                @Override
                public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                    String scheme = request.getUrl().getScheme();
                    if ("https".equals(scheme) || "http".equals(scheme)) return false; // stays in the window
                    openOutside(request.getUrl());
                    return true;
                }

                @Override
                public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                    // No data and not kept on the phone: say so plainly instead of the browser's error page.
                    if (request.isForMainFrame()) {
                        paneUrl = ""; // try this page again next time
                        if (!hasData()) view.loadDataWithBaseURL(null, PANE_NO_DATA, "text/html", "utf-8", null);
                    }
                }

                @Override
                public void onPageFinished(WebView view, String url) {
                    paneLand();
                }
            });
            FrameLayout.LayoutParams place = new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, paneHeight(topCss), Gravity.BOTTOM);
            root.addView(pane, 1, place);
        } else {
            paneMove(topCss);
        }
        pane.setVisibility(View.VISIBLE);
        pane.onResume();
        paneShown = true;
        // The same page still in the window: show it as it is (just scroll to the start again).
        if (url.equals(paneUrl) && pane.getUrl() != null) {
            paneLand();
            return;
        }
        paneUrl = url;
        // Pages opened before come from the phone's memory first (Bible text doesn't change),
        // so they show at once, with or without data.
        pane.getSettings().setCacheMode(WebSettings.LOAD_CACHE_ELSE_NETWORK);
        pane.loadUrl(url);
    }

    // 📍 Start here: open the page scrolled to the founder's chosen words (the page may still be
    // filling in, so it looks a few times).
    private static final String START_JS =
            "(function(want){var n=0;function go(){var all=document.body?document.body.querySelectorAll('*'):[];"
            + "for(var i=0;i<all.length;i++){var e=all[i];if(e.children.length>3)continue;var t=(e.innerText||'').replace(/\\s+/g,' ').trim();"
            + "if(t===want){e.scrollIntoView({block:'start'});window.scrollBy(0,-8);return;}}if(++n<14)setTimeout(go,500);}go();})(%s)";
    // The words at the top of what's showing now (short ones: a heading, a button, a label).
    private static final String MARK_JS =
            "(function(){var best=null;var all=document.body?document.body.querySelectorAll('h1,h2,h3,h4,h5,h6,button,a,p,span,div,li,strong,b,em,label,td'):[];"
            + "for(var i=0;i<all.length;i++){var e=all[i];var t=(e.innerText||'').replace(/\\s+/g,' ').trim();"
            + "if(!t||t.length>60||(e.innerText||'').indexOf('\\n')>=0)continue;var r=e.getBoundingClientRect();"
            + "if(r.height<=0||r.bottom<=0||r.top<-4||/^\\d+$/.test(t))continue;"
            + "if(!best||r.top<best.top-6||(Math.abs(r.top-best.top)<=6&&(r.left<best.left-2||(Math.abs(r.left-best.left)<=2&&t.length<best.text.length))))"
            + "best={top:r.top,left:r.left,text:t};}"
            + "return best?best.text:'';})()";

    private void paneScrollToStart() {
        if (pane == null || paneStart == null || paneStart.isEmpty()) return;
        pane.evaluateJavascript(String.format(START_JS, JSONObject.quote(paneStart)), null);
    }

    void paneGo(String url, double topCss, String start) {
        paneVerse = 0;
        paneStart = start == null ? "" : start;
        paneOpen(url, topCss);
    }

    void paneTypeGo(String url, double topCss, String start, int verse, String code, int chapter, String ref) {
        paneTypeRef = ref == null ? "" : ref;
        paneVerseGo(url, topCss, start, verse, code, chapter);
    }

    void paneVerseGo(String url, double topCss, String start, int verse, String code, int chapter) {
        if (paneTypeRef.isEmpty()) paneTypedFor = ""; // a site that carries the verse in its link
        paneStart = start == null ? "" : start;
        paneVerse = verse;
        paneCode = code == null ? "" : code;
        paneChapter = chapter;
        paneOpen(url, topCss);
    }

    // Land on the verse: find its number on the page (the site's verse marks, or a small number
    // just before the verse's words), scroll to it and light it up for a moment. A page without
    // findable verse numbers (or verse 1, which sites often show as the chapter number) opens at
    // the founder's 📍 start words instead.
    private static final String VERSE_JS =
            "(function(v,code,ch,start,ref){var n=0;var V=String(v);"
            + "function txt(e){return (e.textContent||'').replace(/[\\s\\u00a0]+/g,'').trim();}"
            + "function shown(e){var r=e.getBoundingClientRect();return r.height>0&&r.height<60;}"
            // A verse number has the verse's words beside it; a list of bare numbers (the site's chapter picker) doesn't.
            + "function words(e){var own=txt(e);var p=e.parentElement;while(p&&txt(p)===own)p=p.parentElement;if(!p)return false;"
            + "var r=document.createRange();r.setStartAfter(e);r.setEnd(p,p.childNodes.length);var after=r.toString().split(/\\d/)[0];"
            + "return (after.match(/\\p{L}/gu)||[]).length>=6;}"
            + "function marks(num){var out=[];var S=String(num);"
            + "var u=document.querySelector('[data-usfm=\"'+code+'.'+ch+'.'+num+'\"]');if(u)out.push(u);"
            + "var all=document.querySelectorAll('sup,.versenum,.verse-num,.verse-number,.verseNum,.vnum,.v,.vn,.reftext,[class*=verse] span,[class*=label],b,strong,span,a,small');"
            + "for(var i=0;i<all.length;i++){var e=all[i];if(e.children.length>1)continue;var t=txt(e).replace(/[:.\\])]$/,'');"
            + "if(t!==S||!shown(e))continue;if(e.closest('nav,select,button,header,footer,[role=navigation],[role=tablist]'))continue;if(!words(e))continue;out.push(e);}return out;}"
            + "function find(){var here=marks(v);if(!here.length)return null;if(v<2)return null;var before=marks(v-1);"
            + "for(var i=0;i<here.length;i++){for(var j=0;j<before.length;j++){if(before[j].compareDocumentPosition(here[i])&4)return here[i];}}return here[0];}"
            + "function flash(e){if(window.__porchStrike){try{window.__porchStrike(e);return;}catch(x){}}var b=e.closest('[data-usfm],span.text,.verse')||e.closest('p,li')||e.parentElement||e;var old=b.style.backgroundColor;b.style.transition='background-color 1.2s';b.style.backgroundColor='rgba(255,214,0,.35)';"
            + "setTimeout(function(){b.style.backgroundColor=old||'';},2600);}"
            + "function toStart(){if(!start)return;var all=document.body?document.body.querySelectorAll('*'):[];"
            + "for(var i=0;i<all.length;i++){var e=all[i];if(e.children.length>3)continue;var t=(e.innerText||'').replace(/\\s+/g,' ').trim();"
            + "if(t===start){e.scrollIntoView({block:'start'});window.scrollBy(0,-8);return e;}}return null;}"
            // A site searched by typing shows the verse with its reference (e.g. "1 Corinthians 3:1"): find that.
            + "function byRef(){if(!ref)return null;var want=ref.toLowerCase().replace(/\\s+/g,' ');var best=null,bl=1e9;var all=document.body?document.body.querySelectorAll('p,div,li,article,section,span,h1,h2,h3,b,strong'):[];"
            + "for(var i=0;i<all.length;i++){var e=all[i];var t=(e.innerText||'').toLowerCase().replace(/\\s+/g,' ');if(t.indexOf(want)<0||!shown2(e))continue;if(t.length<bl&&t.length<900){best=e;bl=t.length;}}"
            + "if(!best)return null;var blk=best;while(blk.parentElement&&(blk.innerText||'').length<want.length+20&&blk.parentElement!==document.body)blk=blk.parentElement;return blk;}"
            + "function shown2(e){var r=e.getBoundingClientRect();return r.width>0&&r.height>0;}"
            + "function go(){var e=ref?byRef():(v>1?find():null);if(e){e.scrollIntoView({block:'center'});if(!ref)window.scrollBy(0,-70);flash(e);return;}"
            + "if(++n<12&&(v>1||ref)){setTimeout(go,500);return;}var s0=toStart();if(s0)flash(s0);}"
            // Verse 1 (often shown as the chapter number): the chapter's start words, struck when found.
            + "if(v>1||ref){toStart();go();}else{var m=0;(function s(){var e=toStart();if(++m<6&&!e){setTimeout(s,700);return;}if(e)flash(e);})();}})(%d,%s,%d,%s,%s)";

    // App 1.3.2: for a site whose link can't carry the verse, type it into the site's own search box.
    private String paneTypeRef = "";
    private String paneTypedFor = "";
    private static final String TYPE_JS =
            "(function(ref){var n=0;"
            + "function seen(e){var r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden';}"
            + "function box(){var all=[].slice.call(document.querySelectorAll('input[type=search],input[type=text],input:not([type]),textarea')).filter(seen);"
            + "var good=all.filter(function(e){return /search|verse|john|3:16|reference|passage|look ?up/i.test((e.placeholder||'')+' '+(e.getAttribute('aria-label')||'')+' '+(e.name||''));});"
            + "return good[0]||all[0]||null;}"
            + "function go(){var e=box();if(!e){if(++n<12)setTimeout(go,400);return;}"
            + "e.focus();var set=Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set;"
            + "set.call(e,ref);e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));"
            + "['keydown','keypress','keyup'].forEach(function(t){e.dispatchEvent(new KeyboardEvent(t,{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true}));});"
            + "if(e.form){try{e.form.requestSubmit?e.form.requestSubmit():e.form.submit();}catch(x){}}"
            + "setTimeout(function(){e.blur();},300);}"
            + "go();})(%s)";

    // ☀ The look over the site's page; sharpness (app 1.3.7) is a small SVG sharpening filter put into the page.
    private static final String LOOK_JS = "(function(f){var e=document.documentElement;if(!e)return;"
            + "var m=/porch-sharp-(\\d+)/.exec(f),old=document.getElementById('porch-sharp-svg');if(old)old.remove();"
            + "if(m&&document.body){var k=(+m[1]/100)*0.9,c=1+4*k;var n='http://www.w3.org/2000/svg';var s=document.createElementNS(n,'svg');s.id='porch-sharp-svg';"
            + "s.setAttribute('width','0');s.setAttribute('height','0');s.style.position='absolute';var fl=document.createElementNS(n,'filter');fl.id='porch-sharp-'+m[1];"
            + "var cm=document.createElementNS(n,'feConvolveMatrix');cm.setAttribute('order','3');cm.setAttribute('preserveAlpha','true');"
            + "cm.setAttribute('kernelMatrix','0 '+(-k)+' 0 '+(-k)+' '+c+' '+(-k)+' 0 '+(-k)+' 0');fl.appendChild(cm);s.appendChild(fl);document.body.appendChild(s);}"
            + "e.style.filter=f;e.style.minHeight='100%%';})(%s)";

    private void paneApplyLook() {
        if (pane == null) return;
        pane.evaluateJavascript(String.format(java.util.Locale.ROOT, LOOK_JS, JSONObject.quote(paneLook)), null);
    }

    private void paneLand() {
        if (pane == null) return;
        paneApplyLook();
        // (The lightning strike was taken out at the founder's wish: the found verse gets the soft highlight.)
        if (!paneTypeRef.isEmpty()) {
            String ref = paneTypeRef;
            paneTypeRef = ""; // once per opening: the search's own page then lands normally
            paneTypedFor = ref;
            pane.evaluateJavascript(String.format(java.util.Locale.ROOT, TYPE_JS, JSONObject.quote(ref)), null);
            // Sites that answer without a new page: look for the verse a little later too.
            pane.postDelayed(() -> {
                if (pane != null && paneVerse > 0) pane.evaluateJavascript(String.format(java.util.Locale.ROOT, VERSE_JS, paneVerse, JSONObject.quote(paneCode), paneChapter, JSONObject.quote(""), JSONObject.quote(ref)), null);
            }, 2500);
            return;
        }
        if (paneVerse <= 0) {
            paneScrollToStart();
            return;
        }
        // After a typed search loads a new page, look for the typed reference there.
        String typed = paneTypedFor == null ? "" : paneTypedFor;
        pane.evaluateJavascript(String.format(java.util.Locale.ROOT, VERSE_JS, paneVerse, JSONObject.quote(paneCode), paneChapter, JSONObject.quote(paneStart == null ? "" : paneStart), JSONObject.quote(typed)), null);
    }

    void paneMark() {
        if (pane == null || web == null) return;
        pane.evaluateJavascript(MARK_JS, value -> {
            String text = value == null ? "\"\"" : value; // already a JSON string
            web.evaluateJavascript("window.__porchWindow&&window.__porchWindow('mark'," + text + ")", null);
        });
    }

    void paneMove(double topCss) {
        if (pane == null) return;
        FrameLayout.LayoutParams place = (FrameLayout.LayoutParams) pane.getLayoutParams();
        place.height = paneHeight(topCss);
        place.gravity = Gravity.BOTTOM;
        pane.setLayoutParams(place);
    }

    /** Closing OTHERS hides the window (kept ready for next time). */
    void paneClose() {
        if (pane == null || !paneShown) return;
        paneShown = false;
        pane.setVisibility(View.GONE);
        pane.onPause(); // stops any sound or video on that page
    }

    private void paneDestroy() {
        if (pane == null) return;
        try {
            root.removeView(pane);
            pane.destroy();
        } catch (Exception ignored) {
            // Already gone.
        }
        pane = null;
        paneShown = false;
        paneUrl = "";
    }

    private static final class WindowBridge {
        private final WeakReference<PorchLauncher> host;

        WindowBridge(PorchLauncher host) {
            this.host = new WeakReference<>(host);
        }

        @JavascriptInterface
        public void open(String url, double top) {
            PorchLauncher activity = host.get();
            if (activity != null) activity.runOnUiThread(() -> activity.paneOpen(url, top));
        }

        @JavascriptInterface
        public void go(String url, double top, String start) {
            PorchLauncher activity = host.get();
            if (activity != null) activity.runOnUiThread(() -> activity.paneGo(url, top, start));
        }

        @JavascriptInterface
        public void verse(String url, double top, String start, int verse, String code, int chapter) {
            PorchLauncher activity = host.get();
            if (activity != null) activity.runOnUiThread(() -> activity.paneVerseGo(url, top, start, verse, code, chapter));
        }

        /** App 1.3.2: open, then type the verse (e.g. "1 Corinthians 3:1") into the site's search box. */
        @JavascriptInterface
        public void verseTyped(String url, double top, String start, int verse, String code, int chapter, String ref) {
            PorchLauncher activity = host.get();
            if (activity != null) activity.runOnUiThread(() -> activity.paneTypeGo(url, top, start, verse, code, chapter, ref));
        }

        @JavascriptInterface
        public void mark() {
            PorchLauncher activity = host.get();
            if (activity != null) activity.runOnUiThread(activity::paneMark);
        }

        @JavascriptInterface
        public void move(double top) {
            PorchLauncher activity = host.get();
            if (activity != null) activity.runOnUiThread(() -> activity.paneMove(top));
        }

        @JavascriptInterface
        public void close() {
            PorchLauncher activity = host.get();
            if (activity != null) activity.runOnUiThread(activity::paneClose);
        }

        /** App 1.3.6: ☀ brighter, darker, warmer, tint — a CSS filter over the site's page. */
        @JavascriptInterface
        public void look(String filter) {
            PorchLauncher activity = host.get();
            if (activity == null) return;
            String f = filter == null ? "" : filter.replaceAll("[^a-z0-9%().#\\- ]", "");
            activity.runOnUiThread(() -> {
                activity.paneLook = f;
                activity.paneApplyLook();
            });
        }
    }

    private static final class SpeechBridge {
        private final WeakReference<PorchLauncher> host;

        SpeechBridge(PorchLauncher host) {
            this.host = new WeakReference<>(host);
        }

        @JavascriptInterface
        public boolean available() {
            PorchLauncher activity = host.get();
            return activity != null && SpeechRecognizer.isRecognitionAvailable(activity);
        }

        @JavascriptInterface
        public void start(String lang) {
            PorchLauncher activity = host.get();
            if (activity == null) return;
            activity.runOnUiThread(() -> activity.hearStart(lang));
        }

        @JavascriptInterface
        public void stop() {
            PorchLauncher activity = host.get();
            if (activity == null) return;
            activity.runOnUiThread(activity::hearStop);
        }
    }

    @Override
    protected void onDestroy() {
        paneDestroy();
        if (recognizer != null) {
            try {
                recognizer.destroy();
            } catch (Exception ignored) {
                // Going away anyway.
            }
            recognizer = null;
        }
        hearing = false;
        RadioService.stop(this);
        if (web != null) {
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }

    private void openPdf(String name, String base64) {
        try {
            String safe = name == null ? "my20.pdf" : name.replaceAll("[^A-Za-z0-9._-]", "");
            if (!safe.endsWith(".pdf")) safe = "my20.pdf";
            byte[] bytes = Base64.decode(base64 == null ? "" : base64, Base64.DEFAULT);
            File dir = new File(getCacheDir(), "pdf");
            if (!dir.exists() && !dir.mkdirs()) throw new IllegalStateException("folder");
            File file = new File(dir, safe);
            try (FileOutputStream out = new FileOutputStream(file)) {
                out.write(bytes);
            }
            android.net.Uri uri = FileProvider.getUriForFile(this, getPackageName() + ".fileprovider", file);
            Intent view = new Intent(Intent.ACTION_VIEW);
            view.setDataAndType(uri, "application/pdf");
            view.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            startActivity(Intent.createChooser(view, "Everyone's lists"));
        } catch (Exception ignored) {
            Toast.makeText(this, "Couldn't open the list.", Toast.LENGTH_LONG).show();
        }
    }

    private static final String MIC_PATCH =
            "(function(){if(window.__porchMicPatched||!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia)return;"
                    + "window.__porchMicPatched=true;"
                    + "var orig=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);"
                    + "navigator.mediaDevices.getUserMedia=function(c){"
                    + "var audio=!!(c&&c.audio),video=!!(c&&c.video);"
                    + "var kind=audio&&video?'both':video?'video':'audio';"
                    + "if(!window.PorchMic||!window.PorchMic.ask)return orig(c);"
                    + "return new Promise(function(resolve,reject){"
                    + "window.__porchAllow=function(ok){window.__porchAllow=null;"
                    + "if(!ok){reject(new DOMException('Permission denied','NotAllowedError'));return;}"
                    + "orig(c).then(resolve,reject);};"
                    + "try{window.PorchMic.ask(kind);}catch(e){orig(c).then(resolve,reject);}"
                    + "});};})();";

    // Call sound to the loudspeaker or the earpiece (a headset when one is plugged in or paired).
    // Android 12+ ignores the old speakerphone switch, so pick the device directly there.
    void routeCallSound(boolean loud) {
        AudioManager audio = (AudioManager) getSystemService(AUDIO_SERVICE);
        if (audio == null) return;
        audio.setMode(AudioManager.MODE_IN_COMMUNICATION);
        if (Build.VERSION.SDK_INT >= 31) {
            android.media.AudioDeviceInfo pick = null;
            for (android.media.AudioDeviceInfo device : audio.getAvailableCommunicationDevices()) {
                int type = device.getType();
                if (loud) {
                    if (type == android.media.AudioDeviceInfo.TYPE_BUILTIN_SPEAKER) pick = device;
                } else if (type == android.media.AudioDeviceInfo.TYPE_WIRED_HEADSET || type == android.media.AudioDeviceInfo.TYPE_WIRED_HEADPHONES
                        || type == android.media.AudioDeviceInfo.TYPE_BLUETOOTH_SCO || type == android.media.AudioDeviceInfo.TYPE_USB_HEADSET
                        || type == 26 /* BLE headset */) {
                    pick = device; // a headset wins over the earpiece
                    break;
                } else if (type == android.media.AudioDeviceInfo.TYPE_BUILTIN_EARPIECE && pick == null) {
                    pick = device;
                }
            }
            if (pick != null) audio.setCommunicationDevice(pick);
        } else {
            audio.setSpeakerphoneOn(loud);
        }
    }

    private static final class MicBridge {
        private final WeakReference<PorchLauncher> host;

        MicBridge(PorchLauncher host) {
            this.host = new WeakReference<>(host);
        }

        @JavascriptInterface
        public void ask(String kind) {
            PorchLauncher activity = host.get();
            if (activity == null) return;
            activity.runOnUiThread(() -> activity.askDevice(kind));
        }

        @JavascriptInterface
        public void speaker(boolean on) {
            PorchLauncher activity = host.get();
            if (activity == null) return;
            activity.runOnUiThread(() -> activity.routeCallSound(on));
        }

        /** The call ended: give the phone its normal sound back. */
        @JavascriptInterface
        public void soundDone() {
            PorchLauncher activity = host.get();
            if (activity == null) return;
            activity.runOnUiThread(() -> {
                AudioManager audio = (AudioManager) activity.getSystemService(AUDIO_SERVICE);
                if (audio == null) return;
                if (Build.VERSION.SDK_INT >= 31) audio.clearCommunicationDevice();
                else audio.setSpeakerphoneOn(false);
                audio.setMode(AudioManager.MODE_NORMAL);
            });
        }

        @JavascriptInterface
        public void vibrate(int ms) {
            PorchLauncher activity = host.get();
            if (activity == null) return;
            Vibrator vibrator = (Vibrator) activity.getSystemService(VIBRATOR_SERVICE);
            if (vibrator == null) return;
            int length = Math.max(8, Math.min(ms, 40));
            if (Build.VERSION.SDK_INT >= 26) vibrator.vibrate(VibrationEffect.createOneShot(length, VibrationEffect.DEFAULT_AMPLITUDE));
            else vibrator.vibrate(length);
        }
    }

    // ---- The founder's peep hole: the window goes see-through so the home screen shows through
    // a torn hole in the page; tapping it opens WhatsApp.
    /** Words shared to Porchbook from another app, waiting for the page to offer them as a note. */
    static volatile String pendingShare = null;

    boolean peeping = false;
    void setPeep(boolean on) {
        if (Build.VERSION.SDK_INT < 30 || web == null || on == peeping) return;
        peeping = on;
        if (on) {
            getWindow().setBackgroundDrawable(new android.graphics.drawable.ColorDrawable(Color.TRANSPARENT));
            web.setBackgroundColor(Color.TRANSPARENT);
            setTranslucent(true);
        } else {
            setTranslucent(false);
            web.setBackgroundColor(Color.BLACK);
            getWindow().setBackgroundDrawable(new android.graphics.drawable.ColorDrawable(Color.BLACK));
        }
    }
    boolean openApp(String... packages) {
        for (String name : packages) {
            Intent launch = getPackageManager().getLaunchIntentForPackage(name);
            if (launch == null) continue;
            launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            try {
                startActivity(launch);
                return true;
            } catch (Exception ignored) {
                // try the next one
            }
        }
        return false;
    }

    private static final class RhemaBridge {
        private final WeakReference<PorchLauncher> host;

        RhemaBridge(PorchLauncher host) {
            this.host = new WeakReference<>(host);
        }

        /** The founder's peep hole (Android 11+). */
        @JavascriptInterface
        public boolean canPeep() {
            return Build.VERSION.SDK_INT >= 30;
        }

        @JavascriptInterface
        public void peep(boolean on) {
            PorchLauncher activity = host.get();
            if (activity != null) activity.runOnUiThread(() -> activity.setPeep(on));
        }

        /** Words shared from a notes app (once): {"title","text"} or "". */
        @JavascriptInterface
        public String takeShared() {
            String got = pendingShare;
            pendingShare = null;
            return got == null ? "" : got;
        }

        /** Open WhatsApp (or WhatsApp Business). False when neither is on the phone. */
        @JavascriptInterface
        public boolean openWhatsApp() {
            PorchLauncher activity = host.get();
            return activity != null && activity.openApp("com.whatsapp", "com.whatsapp.w4b");
        }

        /** The apps on the phone you can open (for the peep hole's picker): [{pkg, label}], sorted by name. */
        @JavascriptInterface
        public String listApps() {
            PorchLauncher activity = host.get();
            if (activity == null) return "[]";
            android.content.pm.PackageManager pm = activity.getPackageManager();
            Intent main = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER);
            java.util.List<android.content.pm.ResolveInfo> found = pm.queryIntentActivities(main, 0);
            java.util.TreeMap<String, String> sorted = new java.util.TreeMap<>(String.CASE_INSENSITIVE_ORDER);
            for (android.content.pm.ResolveInfo info : found) {
                String pkg = info.activityInfo.packageName;
                if (pkg.equals(activity.getPackageName())) continue;
                String label = String.valueOf(info.loadLabel(pm));
                sorted.put(label + "\u0000" + pkg, pkg);
            }
            org.json.JSONArray out = new org.json.JSONArray();
            for (java.util.Map.Entry<String, String> e : sorted.entrySet()) {
                try {
                    org.json.JSONObject item = new org.json.JSONObject();
                    item.put("pkg", e.getValue());
                    item.put("label", e.getKey().substring(0, e.getKey().indexOf('\u0000')));
                    out.put(item);
                } catch (Exception ignored) {
                    // skip it
                }
            }
            return out.toString();
        }

        /** An app's own icon as a small picture (data link), or "" if it can't be read. */
        @JavascriptInterface
        public String appIcon(String pkg) {
            PorchLauncher activity = host.get();
            if (activity == null) return "";
            try {
                android.graphics.drawable.Drawable icon = activity.getPackageManager().getApplicationIcon(pkg);
                int size = 112;
                android.graphics.Bitmap bmp = android.graphics.Bitmap.createBitmap(size, size, android.graphics.Bitmap.Config.ARGB_8888);
                android.graphics.Canvas canvas = new android.graphics.Canvas(bmp);
                icon.setBounds(0, 0, size, size);
                icon.draw(canvas);
                java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream();
                bmp.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, bytes);
                return "data:image/png;base64," + android.util.Base64.encodeToString(bytes.toByteArray(), android.util.Base64.NO_WRAP);
            } catch (Exception e) {
                return "";
            }
        }

        /** Open an app by its package; Back returns to Porchbook. */
        @JavascriptInterface
        public boolean openPackage(String pkg) {
            PorchLauncher activity = host.get();
            return activity != null && pkg != null && activity.openApp(pkg);
        }

        /** A little click-vibration for dials, only when the phone is on ring or vibrate (never on silent). */
        @JavascriptInterface
        public void tick(boolean strong) {
            PorchLauncher activity = host.get();
            if (activity == null) return;
            AudioManager audio = (AudioManager) activity.getSystemService(AUDIO_SERVICE);
            if (audio != null && audio.getRingerMode() == AudioManager.RINGER_MODE_SILENT) return;
            Vibrator vibrator = (Vibrator) activity.getSystemService(VIBRATOR_SERVICE);
            if (vibrator == null || !vibrator.hasVibrator()) return;
            int length = strong ? 22 : 9;
            vibrator.vibrate(VibrationEffect.createOneShot(length, strong ? 200 : 120));
        }

        @JavascriptInterface
        public void rhema(boolean on) {
            PorchLauncher activity = host.get();
            if (activity == null) return;
            activity.rhemaOn = on;
        }

        @JavascriptInterface
        public void refresh() {
            PorchLauncher activity = host.get();
            if (activity == null) return;
            activity.runOnUiThread(() -> {
                WebView view = activity.web;
                if (view == null) return;
                view.clearCache(true);
                view.getSettings().setCacheMode(WebSettings.LOAD_NO_CACHE);
                String current = view.getUrl();
                if (current == null || current.isEmpty()) return;
                String fresh = current + (current.contains("?") ? "&" : "?") + "fresh=" + System.currentTimeMillis();
                view.loadUrl(fresh);
            });
        }

        @JavascriptInterface
        public String prepareBibles() {
            PorchLauncher activity = host.get();
            if (activity == null) return "no";
            if (BibleModules.canRead(activity)) {
                File dir = BibleModules.folder();
                if (!dir.exists()) dir.mkdirs();
                return "ok";
            }
            activity.runOnUiThread(() -> {
                if (activity.askedFiles) return;
                activity.askedFiles = true;
                if (android.os.Build.VERSION.SDK_INT >= 30) {
                    try {
                        Intent intent = new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION);
                        intent.setData(Uri.parse("package:" + activity.getPackageName()));
                        activity.startActivity(intent);
                    } catch (Exception ignored) {
                        activity.startActivity(new Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION));
                    }
                    return;
                }
                ActivityCompat.requestPermissions(activity, new String[] {Manifest.permission.READ_EXTERNAL_STORAGE}, 44);
            });
            return "ask";
        }

        @JavascriptInterface
        public String listBibles() {
            return BibleModules.list();
        }

        @JavascriptInterface
        public String bibleBooks(String name) {
            return BibleModules.books(name);
        }

        @JavascriptInterface
        public String bibleChapter(String name, int book, int chapter) {
            return BibleModules.chapter(name, book, chapter);
        }

        @JavascriptInterface
        public String bibleSearch(String name, String query) {
            return BibleModules.search(name, query);
        }

        @JavascriptInterface
        public void saveFile(String name, String base64) {
            PorchLauncher activity = host.get();
            if (activity == null) return;
            activity.runOnUiThread(() -> activity.openPdf(name, base64));
        }

        /** This app's version number, so Refresh can tell when a newer app is ready. */
        @JavascriptInterface
        public int appVersion() {
            PorchLauncher activity = host.get();
            return activity == null ? 0 : AppUpdate.versionCode(activity);
        }

        /** Download the newer app and open Android's install screen. */
        @JavascriptInterface
        public void updateApp(String address) {
            PorchLauncher activity = host.get();
            if (activity == null) return;
            activity.runOnUiThread(() -> AppUpdate.start(activity, activity.web, address));
        }

        /** The radio started, changed song or stopped: show or update the "Now playing" notice. */
        @JavascriptInterface
        public void radio(boolean playing, String title) {
            PorchLauncher activity = host.get();
            if (activity == null) return;
            activity.radioOn = playing;
            activity.runOnUiThread(() -> {
                if (activity.web != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    activity.web.setRendererPriorityPolicy(playing ? WebView.RENDERER_PRIORITY_IMPORTANT : WebView.RENDERER_PRIORITY_BOUND, !playing);
                }
                if (playing) RadioService.play(activity, title == null ? "" : title);
                else RadioService.stop(activity);
            });
        }

        /** What "Keep Porchbook running" needs: {"battery":true,"notify":true,"maker":"tecno","autostart":true}. */
        @JavascriptInterface
        public String keepState() {
            PorchLauncher activity = host.get();
            if (activity == null) return "{}";
            PowerManager power = activity.getSystemService(PowerManager.class);
            boolean battery = power != null && power.isIgnoringBatteryOptimizations(activity.getPackageName());
            boolean notify = androidx.core.app.NotificationManagerCompat.from(activity).areNotificationsEnabled();
            String maker = Build.MANUFACTURER == null ? "" : Build.MANUFACTURER.toLowerCase().replaceAll("[^a-z]", "");
            boolean autostart = KeepRunning.autoStartIntent(activity) != null;
            return "{\"battery\":" + battery + ",\"notify\":" + notify + ",\"maker\":\"" + maker + "\",\"autostart\":" + autostart + "}";
        }

        @JavascriptInterface
        public void openBattery() {
            PorchLauncher activity = host.get();
            if (activity == null) return;
            activity.runOnUiThread(() -> KeepRunning.openBattery(activity));
        }

        @JavascriptInterface
        public void openAutoStart() {
            PorchLauncher activity = host.get();
            if (activity == null) return;
            activity.runOnUiThread(() -> KeepRunning.openAutoStart(activity));
        }

        @JavascriptInterface
        public void openNotifications() {
            PorchLauncher activity = host.get();
            if (activity == null) return;
            activity.runOnUiThread(() -> KeepRunning.openNotifications(activity));
        }
    }
}
