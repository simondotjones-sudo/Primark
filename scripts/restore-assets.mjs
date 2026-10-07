import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
// Keep the original video byte-for-byte while allowing repository API uploads.
const asset=JSON.parse(readFileSync('assets/video/manifest.json','utf8'));
const bytes=Buffer.concat(asset.parts.map(path=>readFileSync(path)));
if(createHash('sha256').update(bytes).digest('hex')!==asset.sha256)throw new Error('Bundled video checksum does not match.');
mkdirSync(dirname(asset.output),{recursive:true});writeFileSync(asset.output,bytes);
