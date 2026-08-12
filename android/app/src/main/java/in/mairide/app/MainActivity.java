package in.mairide.app;

import android.os.Bundle;
import android.webkit.WebSettings;
import com.getcapacitor.BridgeActivity;

/**
 * Ensure mixed-content map tiles / API assets can load inside the HTTPS WebView
 * when the shell points at https://rides.mairide.in.
 */
public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    try {
      if (getBridge() != null && getBridge().getWebView() != null) {
        WebSettings settings = getBridge().getWebView().getSettings();
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        settings.setDomStorageEnabled(true);
        settings.setJavaScriptEnabled(true);
      }
    } catch (Exception ignored) {
      // Bridge may not be ready on some Capacitor versions during onCreate.
    }
  }

  @Override
  public void onStart() {
    super.onStart();
    try {
      if (getBridge() != null && getBridge().getWebView() != null) {
        WebSettings settings = getBridge().getWebView().getSettings();
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
      }
    } catch (Exception ignored) {
      // Ignore — capacitor.config android.allowMixedContent remains the primary switch.
    }
  }
}
