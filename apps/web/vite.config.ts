import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// The screens are served by the Hub; in development the API calls go to a Hub running on this PC.
export default defineConfig({ plugins: [react()], server: { proxy: { '/api': 'http://127.0.0.1:4870' } }, test: { environment: 'node' } });
