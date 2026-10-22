import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import GoogleAccount from '../src/components/GoogleAccount';

export function mountLogin() {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  root.render(<StrictMode><GoogleAccount /></StrictMode>);
  return () => root.unmount();
}
