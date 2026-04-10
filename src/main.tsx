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

    // Safari users have repeatedly hit stale SW cache issues; keep runtime stable by avoiding SW there.
    if (isSafari) {
      navigator.serviceWorker.getRegistrations().then((registrations) => {
        registrations.forEach((registration) => {
          void registration.unregister();
        });
      }).catch(() => {
        // Ignore cleanup failures to avoid runtime disruption.
      });
      return;
    }

    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Ignore SW registration failures to avoid runtime disruption.
    });
  });
}
