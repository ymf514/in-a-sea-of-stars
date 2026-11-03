import { defineConfig } from 'vite';

// Relative asset paths, so the built site works at any address — including a
// GitHub Pages project page like https://<user>.github.io/<repo>/.
export default defineConfig({
  base: './'
});
