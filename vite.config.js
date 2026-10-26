import { defineConfig } from 'vite';
import { readFile } from 'node:fs/promises';

export default defineConfig({
  plugins: [{
    name: 'local-wasm-module-loaders',
    configureServer(server) {
      // Native libraries dynamically import these untransformed runtime modules.
      // Vite otherwise rejects public/*.js?import in development.
      server.middlewares.use(async (req, res, next) => {
        const pathname = new URL(req.url, 'http://localhost').pathname;
        if (!/^\/models\/(face_landmarker\/wasm\/vision_wasm_module_internal\.js|ort\/ort-wasm-simd-threaded(?:\.[a-z]+)?\.mjs)$/.test(pathname)) return next();
        try {
          const bytes = await readFile(new URL(`./public${pathname}`, import.meta.url));
          res.setHeader('Content-Type', 'text/javascript'); res.end(bytes);
        } catch { next(); }
      });
    },
  }],
  worker: { format: 'es' },
  server: {
    fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.certs/**'] },
  },
});
