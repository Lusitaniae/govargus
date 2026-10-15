import { defineConfig } from 'astro/config';

// BASE_PATH lets the site live under a subpath (e.g. GitHub Pages without a
// custom domain: BASE_PATH=/govargus).
export default defineConfig({
  output: 'static',
  base: process.env.BASE_PATH || '/',
  trailingSlash: 'ignore',
});
