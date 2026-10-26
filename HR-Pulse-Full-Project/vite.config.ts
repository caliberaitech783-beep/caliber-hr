import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {realpathSync} from 'node:fs';
const sdkRequire=createRequire(realpathSync(new URL('./node_modules/@paddleocr/paddleocr-js/dist/index.mjs',import.meta.url)));
// CPU/WASM only: no WebGPU model service or oversized JSEP runtime.
const ortWasm=join(dirname(sdkRequire.resolve('onnxruntime-web')),'ort.wasm.min.mjs');
export default defineConfig({ plugins: [react()], resolve:{alias:[{find:/^onnxruntime-web$/,replacement:ortWasm}]}, test: { include: ['src/**/*.test.{ts,tsx}'], globals: true, environment: 'jsdom', setupFiles: './src/test/setup.ts' } });
