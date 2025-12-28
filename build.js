import * as esbuild from 'esbuild';
import { readFileSync } from 'fs';
import 'dotenv/config';

// Build the client bundle with all dependencies inline
await esbuild.build({
  entryPoints: ['client/app.js'],
  bundle: true,
  outfile: 'client/dist/bundle.js',
  format: 'iife',
  platform: 'browser',
  target: ['es2020'],
  minify: false,
  sourcemap: true,
  define: {
    'process.env.DISCORD_CLIENT_ID': JSON.stringify(process.env.DISCORD_CLIENT_ID || ''),
    __DISCORD_CLIENT_ID__: JSON.stringify(process.env.DISCORD_CLIENT_ID || ''),
  },
});

console.log('✅ Client bundle built successfully!');
