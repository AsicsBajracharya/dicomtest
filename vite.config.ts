import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteCommonjs } from '@originjs/vite-plugin-commonjs';

export default defineConfig({
  plugins: [react(), viteCommonjs()],
  optimizeDeps: {
    // Keep the DICOM loader out of optimize to avoid worker/codec hiccups
    exclude: ['@cornerstonejs/dicom-image-loader'],
    // Ensure dicom-parser is pre-bundled (it's CommonJS)
    include: ['dicom-parser'],
  },
  worker: {
    format: 'es',
  },
});
