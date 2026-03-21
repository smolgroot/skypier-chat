import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './styles.css';

function emitConnectivityRecoveryRequest(source: string) {
  window.dispatchEvent(new CustomEvent('skypier:recover-connectivity', { detail: { source } }));
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    const data = event.data ?? {};
    if (data.type === 'SKYPIER_RECOVER_CONNECTIVITY') {
      emitConnectivityRecoveryRequest(data.source ?? 'service-worker');
    }
  });

  void navigator.serviceWorker.register('/sw.js').then((registration) => {
    registration.active?.postMessage({ type: 'SKYPIER_REQUEST_RECOVERY' });
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
