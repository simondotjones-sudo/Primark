import { build } from 'esbuild';
// Bundle npm dependencies locally so Edge deployment never relies on a CDN import.
await build({entryPoints:['lib/stored-files-edge.ts'],outfile:'netlify/edge-functions/stored-files.mjs',bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true,legalComments:'eof'});
