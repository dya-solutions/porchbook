package app.porch.team;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import androidx.core.app.NotificationCompat;

final class CallAlert {
    static final String CALLS = "porch-calls";
    static final String QUIET = "porch-watch";
    static final String RADIO = "porch-radio-requests";
    private static final int RADIO_ID = 44;
    private static final int CALL_ID = 43;

    private CallAlert() {}

    static void ensureChannels(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return;
        NotificationChannel calls = new NotificationChannel(CALLS, "Porchbook calls", NotificationManager.IMPORTANCE_HIGH);
        calls.setDescription("Incoming voice calls");
        calls.enableVibration(true);
        calls.setVibrationPattern(new long[] {0, 200, 120, 200, 120, 200});
        manager.createNotificationChannel(calls);
        NotificationChannel radio = new NotificationChannel(RADIO, "Porchbook Radio requests", NotificationManager.IMPORTANCE_HIGH);
        radio.setDescription("When your song request is about to play, or someone dedicates a song to you");
        manager.createNotificationChannel(radio);
        NotificationChannel quiet = new NotificationChannel(QUIET, "Porchbook", NotificationManager.IMPORTANCE_MIN);
        quiet.setDescription("Keeps call alerts able to reach this phone");
        manager.createNotificationChannel(quiet);
    }

    static Notification watchNotification(Context context) {
        ensureChannels(context);
        return new NotificationCompat.Builder(context, QUIET)
                .setSmallIcon(R.drawable.ic_phone)
                .setContentTitle("Porchbook")
                .setContentText(context.getString(R.string.call_watch))
                .setOngoing(true)
                .setSilent(true)
                .setPriority(NotificationCompat.PRIORITY_MIN)
                .build();
    }

    static void show(Context context, String name, String image, String userId, String at, boolean video) {
        ensureChannels(context);
        Intent open = new Intent(context, IncomingCallActivity.class);
        open.putExtra(IncomingCallActivity.EXTRA_NAME, name);
        open.putExtra(IncomingCallActivity.EXTRA_IMAGE, image);
        open.putExtra(IncomingCallActivity.EXTRA_USER, userId);
        open.putExtra(IncomingCallActivity.EXTRA_AT, at);
        open.putExtra(IncomingCallActivity.EXTRA_VIDEO, video);
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent full = PendingIntent.getActivity(
                context,
                7,
                open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        Notification notification = new NotificationCompat.Builder(context, CALLS)
                .setSmallIcon(R.drawable.ic_phone)
                .setContentTitle(name)
                .setContentText(context.getString(R.string.incoming_call))
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setOngoing(true)
                .setAutoCancel(false)
                .setVibrate(new long[] {0, 200, 120, 200, 120, 200})
                .setFullScreenIntent(full, true)
                .setContentIntent(full)
                .build();
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager != null) manager.notify(CALL_ID, notification);
    }

    /** "Your request is about to play": tap (or ▶ Tune in) opens Porchbook straight onto the radio, playing. */
    static void showRadio(Context context, String text, String url) {
        ensureChannels(context);
        Intent open = new Intent(context, PorchLauncher.class);
        open.putExtra(PorchLauncher.EXTRA_URL, url);
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent tune = PendingIntent.getActivity(
                context,
                9,
                open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        Notification notification = new NotificationCompat.Builder(context, RADIO)
                .setSmallIcon(R.drawable.ic_mark)
                .setContentTitle("Porchbook Radio")
                .setContentText(text)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_RECOMMENDATION)
                .setAutoCancel(true)
                .setContentIntent(tune)
                .addAction(0, "▶ Tune in", tune)
                .build();
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager != null) manager.notify(RADIO_ID, notification);
    }

    static void cancel(Context context) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager != null) manager.cancel(CALL_ID);
    }
}
