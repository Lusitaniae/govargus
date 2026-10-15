import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// BASE_PATH lets the site live under a subpath (e.g. GitHub Pages without a
// custom domain: BASE_PATH=/govargus).
//
// build.format 'file' writes /compare.html rather than /compare/index.html, so
// Cloudflare serves the slash-less URLs the site links to without redirecting.
export default defineConfig({
  site: 'https://govargus.com',
  output: 'static',
  base: process.env.BASE_PATH || '/',
  trailingSlash: 'never',
  build: { format: 'file' },
  integrations: [sitemap({ filter: (page) => !/\/404(\.html)?$/.test(page) })],
});
