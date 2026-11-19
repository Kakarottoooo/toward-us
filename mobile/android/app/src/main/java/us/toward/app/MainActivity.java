package us.toward.app;

import android.app.Activity;
import android.os.Build;
import android.os.Bundle;
import androidx.annotation.RequiresApi;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.PluginHandle;

public class MainActivity extends BridgeActivity {
    private Runnable stopObserving;

    @Override
    protected void onCreate(Bundle state) {
        registerPlugin(OureverFeedback.class);
        super.onCreate(state);
    }

    @Override
    public void onStart() {
        super.onStart();
        if (Build.VERSION.SDK_INT >= 34) stopObserving = observeScreenshots();
    }

    @RequiresApi(34)
    private Runnable observeScreenshots() {
        Activity.ScreenCaptureCallback listener = () -> {
            PluginHandle feedback = bridge.getPlugin("OureverFeedback");
            if (feedback != null) ((OureverFeedback) feedback.getInstance()).screenshotTaken();
        };
        registerScreenCaptureCallback(getMainExecutor(), listener);
        return () -> unregisterScreenCaptureCallback(listener);
    }

    @Override
    public void onStop() {
        if (stopObserving != null) { stopObserving.run(); stopObserving = null; }
        super.onStop();
    }
}
