import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppProviders } from '@/app/providers';
import { Router } from '@/app/router';
import '@/app/styles/globals.css';
import 'react-photo-view/dist/react-photo-view.css';
import { KcPage } from './kc.gen';

const kcContext = window.kcContext;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {kcContext ? (
      <KcPage kcContext={kcContext} />
    ) : (
      <AppProviders>
        <Router />
      </AppProviders>
    )}
  </StrictMode>,
);
