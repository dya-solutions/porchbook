package app.porch.team;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

/**
 * Keeps Porchbook Radio playing when Porchbook is minimised or the screen is off:
 * a media-playback service with a "Now playing" notification and a Stop button.
 * The sound itself still plays in the page; this keeps the phone from putting it to sleep.
 */
public class RadioService extends Service {
    static final String CHANNEL = "porch-radio";
    private static final int ID = 44;
    private static final String ACTION_STOP = "app.porch.team.RADIO_STOP";
    private static final String EXTRA_TITLE = "title";

    private static volatile boolean running;
    private PowerManager.WakeLock wake;
    private WifiManager.WifiLock wifi;

    static boolean isRunning() {
        return running;
    }

    /** Start (or refresh) the radio notification. Call while Porchbook is on screen. */
    static void play(Context context, String title) {
        if (running) {
            NotificationManager manager = context.getSystemService(NotificationManager.class);
            if (manager != null) manager.notify(ID, build(context, title));
            return;
        }
        Intent intent = new Intent(context, RadioService.class);
        intent.putExtra(EXTRA_TITLE, title);
        try {
            ContextCompat.startForegroundService(context, intent);
        } catch (Exception ignored) {
            // Android refused (e.g. started from the background): the radio still plays while Porchbook is open.
        }
    }

    static void stop(Context context) {
        if (!running) return;
        context.stopService(new Intent(context, RadioService.class));
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            PorchLauncher.radioCommand("stop");
            stopSelf();
            return START_NOT_STICKY;
        }
        String title = intent == null ? "" : intent.getStringExtra(EXTRA_TITLE);
        Notification notice = build(this, title == null ? "" : title);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(ID, notice, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else {
            startForeground(ID, notice);
        }
        running = true;
        hold();
        return START_NOT_STICKY;
    }

    private void hold() {
        try {
            if (wake == null) {
                PowerManager power = getSystemService(PowerManager.class);
                if (power != null) {
                    wake = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "porch:radio");
                    wake.setReferenceCounted(false);
                }
            }
            if (wake != null && !wake.isHeld()) wake.acquire(6 * 60 * 60 * 1000L); // at most 6 hours
            if (wifi == null) {
                WifiManager manager = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
                if (manager != null) {
                    int mode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                            ? WifiManager.WIFI_MODE_FULL_LOW_LATENCY
                            : WifiManager.WIFI_MODE_FULL_HIGH_PERF;
                    wifi = manager.createWifiLock(mode, "porch:radio");
                    wifi.setReferenceCounted(false);
                }
            }
            if (wifi != null && !wifi.isHeld()) wifi.acquire();
        } catch (Exception ignored) {
            // Playing without the locks is still better than not playing.
        }
    }

    @Override
    public void onDestroy() {
        running = false;
        try {
            if (wake != null && wake.isHeld()) wake.release();
            if (wifi != null && wifi.isHeld()) wifi.release();
        } catch (Exception ignored) {
            // Already let go.
        }
        super.onDestroy();
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // Porchbook was swiped away: the page (and the sound) is gone, so the notice goes too.
        stopSelf();
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private static Notification build(Context context, String title) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager manager = context.getSystemService(NotificationManager.class);
            if (manager != null && manager.getNotificationChannel(CHANNEL) == null) {
                NotificationChannel channel = new NotificationChannel(CHANNEL, "Porchbook Radio", NotificationManager.IMPORTANCE_LOW);
                channel.setDescription("Shows what's playing on Porchbook Radio, with Stop");
                channel.setShowBadge(false);
                manager.createNotificationChannel(channel);
            }
        }
        Intent open = new Intent(context, PorchLauncher.class);
        open.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        PendingIntent show = PendingIntent.getActivity(context, 21, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Intent stop = new Intent(context, RadioService.class).setAction(ACTION_STOP);
        PendingIntent halt = PendingIntent.getService(context, 22, stop, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        String now = title == null || title.trim().isEmpty() ? "On air" : "Now playing: " + title.trim();
        return new NotificationCompat.Builder(context, CHANNEL)
                .setSmallIcon(R.drawable.ic_mark)
                .setContentTitle("Porchbook Radio")
                .setContentText(now)
                .setContentIntent(show)
                .addAction(0, "Stop", halt)
                .setOngoing(true)
                .setSilent(true)
                .setOnlyAlertOnce(true)
                .setShowWhen(false)
                .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .build();
    }
}
