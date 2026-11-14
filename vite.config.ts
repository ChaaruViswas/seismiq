import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// `base: './'` keeps every asset URL relative, so the same build works on
// GitHub Pages (/<repo>/), Vercel, Netlify or a plain file server.
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  worker: { format: 'es' },
  build: { target: 'es2022', sourcemap: false },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
