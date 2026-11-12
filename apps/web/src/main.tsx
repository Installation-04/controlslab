// SPDX-License-Identifier: AGPL-3.0-only
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { getLang } from './i18n';
import './styles.css';

document.documentElement.lang = getLang() === 'fr' ? 'fr-CA' : 'en';
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
