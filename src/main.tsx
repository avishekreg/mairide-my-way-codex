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
    // Keep runtime stable in critical flows (permissions/OTP/payments):
    // remove service workers to prevent forced refresh takeover.
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      registrations.forEach((registration) => {
        void registration.unregister();
      });
    }).catch(() => {
      // Ignore cleanup failures to avoid runtime disruption.
    });
  });
}
