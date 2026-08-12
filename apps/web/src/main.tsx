import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { App } from './App';
import { ThemeProvider } from '@/components/theme-provider';
import { SidebarThemeProvider } from '@/lib/sidebar-theme';
import { Toaster } from '@/components/ui/toaster';
import { queryClient, persistOptions } from '@/lib/query-client';
import '@/lib/i18n/i18n';
import './index.css';

// P3: rehydrate the cached catalog from IndexedDB before the first render, so
// a terminal that reloads while the LAN server is down still shows the menu
// and keeps selling into the offline queue.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
      <ThemeProvider>
        <SidebarThemeProvider>
          <BrowserRouter>
            <App />
            <Toaster />
          </BrowserRouter>
        </SidebarThemeProvider>
      </ThemeProvider>
    </PersistQueryClientProvider>
  </StrictMode>,
);
