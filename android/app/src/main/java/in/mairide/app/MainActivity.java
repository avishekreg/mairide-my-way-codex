package in.mairide.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import io.capawesome.capacitorjs.plugins.googlesignin.GoogleSignInPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        try {
            registerPlugin(GoogleSignInPlugin.class);
        } catch (Throwable ignored) {
            // Plugin may already be auto-registered; never block cold start.
        }
        super.onCreate(savedInstanceState);
    }
}
