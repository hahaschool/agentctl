import React from 'react';
import ReactDOM from 'react-dom/client';

import { App } from './App.tsx';
import { ToastProvider } from './components/Toast.tsx';
import './index.css';

// biome-ignore lint/style/noNonNullAssertion: root element always exists in index.html
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </React.StrictMode>,
);
