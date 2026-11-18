package app.porch.team;

import android.app.Activity;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

/**
 * Opens the phone's own settings that let Porchbook keep running in the background:
 * battery (Unrestricted), auto-start (Tecno, Infinix, itel, Xiaomi, Oppo, Vivo, Huawei…), notifications.
 * No app can switch these on by itself; the person does, on the screen this opens.
 */
final class KeepRunning {
    private KeepRunning() {}

    // Each maker hides "auto-start" somewhere different. The first one this phone has wins.
    private static final String[][] AUTO_START = {
            // Transsion: Tecno, Infinix, itel (Phone Master)
            {"com.transsion.phonemaster", "com.cyin.himgr.autostart.AutoStartActivity"},
            {"com.transsion.phonemanager", "com.itel.autobootmanager.activity.AutoBootMgrActivity"},
            {"com.transsion.phonemaster", "com.cyin.himgr.applicationmanager.view.activities.AppManagerActivity"},
            // Xiaomi, Redmi, Poco
            {"com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity"},
            // Oppo, Realme, OnePlus
            {"com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity"},
            {"com.coloros.safecenter", "com.coloros.safecenter.startupapp.StartupAppListActivity"},
            {"com.oppo.safe", "com.oppo.safe.permission.startup.StartupAppListActivity"},
            // Vivo
            {"com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.AddWhiteListActivity"},
            {"com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity"},
            // Huawei, Honor
            {"com.huawei.systemmanager", "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity"},
            {"com.huawei.systemmanager", "com.huawei.systemmanager.optimize.process.ProtectActivity"},
            // Samsung (battery: never sleeping apps)
            {"com.samsung.android.lool", "com.samsung.android.sm.ui.battery.BatteryActivity"},
    };

    static Intent autoStartIntent(Context context) {
        PackageManager pm = context.getPackageManager();
        for (String[] target : AUTO_START) {
            Intent intent = new Intent().setComponent(new ComponentName(target[0], target[1]));
            try {
                if (pm.resolveActivity(intent, PackageManager.MATCH_DEFAULT_ONLY) != null) return intent;
            } catch (Exception ignored) {
                // Try the next one.
            }
        }
        return null;
    }

    static void openAutoStart(Activity activity) {
        Intent intent = autoStartIntent(activity);
        if (intent != null && tryOpen(activity, intent)) return;
        openAppDetails(activity);
    }

    static void openBattery(Activity activity) {
        PowerManager power = activity.getSystemService(PowerManager.class);
        boolean already = power != null && power.isIgnoringBatteryOptimizations(activity.getPackageName());
        if (!already) {
            Intent ask = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + activity.getPackageName()));
            if (tryOpen(activity, ask)) return;
        }
        if (tryOpen(activity, new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))) return;
        openAppDetails(activity);
    }

    static void openNotifications(Activity activity) {
        Intent intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
        intent.putExtra(Settings.EXTRA_APP_PACKAGE, activity.getPackageName());
        if (tryOpen(activity, intent)) return;
        openAppDetails(activity);
    }

    private static void openAppDetails(Activity activity) {
        tryOpen(activity, new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + activity.getPackageName())));
    }

    private static boolean tryOpen(Activity activity, Intent intent) {
        try {
            activity.startActivity(intent);
            return true;
        } catch (Exception ignored) {
            return false;
        }
    }

    static boolean isNew() {
        return Build.VERSION.SDK_INT >= 26;
    }
}
