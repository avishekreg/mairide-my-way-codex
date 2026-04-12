import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const ua = navigator.userAgent.toLowerCase();
    const isSafari = ua.includes('safari') && !ua.includes('chrome') && !ua.includes('crios') && !ua.includes('android');
    const isAndroidWebView = ua.includes('android') && (ua.includes(' wv') || ua.includes('; wv'));
    const isAppLocalWebView =
      typeof window !== 'undefined'
      && ['https:', 'http:'].includes(String(window.location.protocol || '').toLowerCase())
      && ['localhost', '127.0.0.1'].includes(String(window.location.hostname || '').toLowerCase())
      && !String(window.location.port || '').trim();

    // Safari + Android WebView + Capacitor localhost runtime can hit stale SW cache issues;
    // keep runtime stable by avoiding SW in these environments.
    if (isSafari || isAndroidWebView || isAppLocalWebView) {
      navigator.serviceWorker.getRegistrations().then((registrations) => {
        registrations.forEach((registration) => {
          void registration.unregister();
        });
      }).catch(() => {
        // Ignore cleanup failures to avoid runtime disruption.
      });
      return;
    }

    navigator.serviceWorker.register('/sw.js')
      .then((registration) => {
        if (registration.waiting) {
          registration.waiting.postMessage({ type: 'SKIP_WAITING' });
        }

        registration.addEventListener('updatefound', () => {
          const installingWorker = registration.installing;
          if (!installingWorker) return;

          installingWorker.addEventListener('statechange', () => {
            if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
              installingWorker.postMessage({ type: 'SKIP_WAITING' });
            }
          });
        });

        navigator.serviceWorker.addEventListener('controllerchange', () => {
          window.location.reload();
        });

        window.setInterval(() => {
          void registration.update();
        }, 60 * 1000);
      })
      .catch(() => {
        // Ignore SW registration failures to avoid runtime disruption.
      });
  });
}
