package us.toward.app;

import android.os.Build;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "OureverFeedback")
public class OureverFeedback extends Plugin {
    @PluginMethod
    public void info(PluginCall call) {
        try {
            android.content.pm.PackageInfo pkg = getContext().getPackageManager()
                .getPackageInfo(getContext().getPackageName(), 0);
            JSObject values = new JSObject();
            values.put("app_version", pkg.versionName);
            values.put("build", String.valueOf(Build.VERSION.SDK_INT >= 28 ? pkg.getLongVersionCode() : pkg.versionCode));
            values.put("device_model", Build.MODEL);
            values.put("os_version", Build.VERSION.RELEASE);
            call.resolve(values);
        } catch (android.content.pm.PackageManager.NameNotFoundException error) {
            call.reject("Package unavailable");
        }
    }

    void screenshotTaken() {
        notifyListeners("screenshot", new JSObject());
    }
}
