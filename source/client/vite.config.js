import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const backend = process.env.BACKEND_URL || 'http://localhost:8080';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // lắng nghe 0.0.0.0 để điện thoại trong cùng mạng LAN truy cập được
    port: 5173,
    proxy: {
      '/api': { target: backend, changeOrigin: true, xfwd: true },
      '/ws': { target: backend.replace(/^http/, 'ws'), ws: true },
    },
  },
  build: {
    // Build thẳng vào static/ của Spring Boot -> chạy toàn bộ hệ thống bằng 1 file jar
    outDir: '../server/src/main/resources/static',
    emptyOutDir: true,
  },
});
