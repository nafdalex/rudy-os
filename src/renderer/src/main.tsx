import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
// The favicon wants the square mark; the boot splash wants the full lockup.
import brandMark from '@brand/rudy-os-mark.svg?url';
import brandLogo from '@brand/rudy-os-logo.svg?url';
import './design/global.css';
import './design/aurora.css';
import './design/hq.css';

const favicon = document.createElement('link');
favicon.rel = 'icon';
favicon.type = 'image/svg+xml';
favicon.href = brandMark;
document.head.appendChild(favicon);

const splashMark = document.querySelector('#cth-splash .mk');
if (splashMark) {
  const img = document.createElement('img');
  img.src = brandLogo;
  img.alt = 'Rudy OS';
  img.style.cssText = 'height:44px;width:auto;display:block';
  splashMark.replaceWith(img);
}

const root = document.getElementById('root');
if (!root) throw new Error('No root element');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);
