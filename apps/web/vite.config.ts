import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

function clearDevServiceWorkersPlugin() {
  return {
    name: 'skypier-clear-dev-service-workers',
    transformIndexHtml: {
      order: 'pre' as const,
      handler(html: string) {
        return {
          html,
          tags: [
            {
              tag: 'script',
              injectTo: 'head-prepend',
              children: `
                (() => {
                  const isLocal =
                    location.hostname === 'localhost' ||
                    location.hostname === '127.0.0.1' ||
                    location.hostname === '::1' ||
                    location.hostname === '[::1]';

                  if (!isLocal || !('serviceWorker' in navigator) || !window.sessionStorage) {
                    return;
                  }

                  const key = 'skypier-dev-sw-head-reset-v1';
                  if (sessionStorage.getItem(key) === 'done') {
                    return;
                  }

                  navigator.serviceWorker.getRegistrations().then((registrations) => {
                    if (registrations.length === 0) {
                      sessionStorage.setItem(key, 'done');
                      return;
                    }

                    Promise.all(registrations.map((registration) => registration.unregister()))
                      .finally(() => {
                        sessionStorage.setItem(key, 'done');
                        location.reload();
                      });
                  });
                })();
              `,
            },
          ],
        };
      },
    },
  };
}

function firefoxHeadModuleMimeFixPlugin() {
  return {
    name: 'skypier-firefox-head-module-mime-fix',
    configureServer(server: import('vite').ViteDevServer) {
      server.middlewares.use((req, res, next) => {
        if (req.method !== 'HEAD') {
          next();
          return;
        }

        const url = req.url ?? '';
        if (
          url.startsWith('/@vite/client')
          || url.startsWith('/@react-refresh')
          || url.startsWith('/@id/')
        ) {
          res.statusCode = 200;
          res.setHeader('Content-Type', 'text/javascript');
          res.end();
          return;
        }

        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [firefoxHeadModuleMimeFixPlugin(), clearDevServiceWorkersPlugin(), react()],
  server: {
    host: 'localhost',
    port: 5173,
    strictPort: true,
    origin: 'http://localhost:5173',
    hmr: {
      protocol: 'ws',
      host: 'localhost',
      clientPort: 5173,
    },
  },
  preview: {
    host: 'localhost',
    port: 4173,
    strictPort: true,
  },
});
