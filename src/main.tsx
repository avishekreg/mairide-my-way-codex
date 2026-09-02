import {Component, StrictMode, type ErrorInfo, type ReactNode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

class RootErrorBoundary extends Component<{children: ReactNode}, {hasError: boolean}> {
  state = {hasError: false};

  static getDerivedStateFromError() {
    return {hasError: true};
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('MaiRide root render failure:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <main role="alert" className="flex min-h-screen items-center justify-center bg-slate-50 p-6 text-center text-slate-900">
          <div>
            <h1 className="text-2xl font-bold">MaiRide could not start</h1>
            <p className="mt-2 text-sm text-slate-600">Please close and reopen the app.</p>
          </div>
        </main>
      );
    }

    return this.props.children;
  }
}

const mountApp = () => {
  const rootElement = document.getElementById('root');
  if (!rootElement) return;

  createRoot(rootElement).render(
    <StrictMode>
      <RootErrorBoundary>
        <App />
      </RootErrorBoundary>
    </StrictMode>,
  );
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mountApp, {once: true});
} else {
  mountApp();
}

if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
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

    if ('caches' in window) {
      void caches.keys().then((keys) => Promise.all(
        keys.filter((key) => key.startsWith('mairide-shell')).map((key) => caches.delete(key)),
      )).catch(() => {
        // Ignore cleanup failures to avoid runtime disruption.
      });
    }
  });
}
