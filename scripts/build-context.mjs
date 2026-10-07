import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const context=process.env.CONTEXT||'dev';
const branch=process.env.REVIEW_ID||process.env.BRANCH||'local';
writeFileSync('lib/deploy-context.json',JSON.stringify({context,branch:createHash('sha256').update(branch).digest('hex').slice(0,24)})+'\n');
