import assert from 'node:assert/strict';
import {readFileSync,readdirSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {build} from 'esbuild';
import ts from 'typescript';

const temp=mkdtempSync(join(tmpdir(),'primark-translations-'));
try {
  await build({stdin:{contents:`export * from './lib/ui-copy';export * from './lib/i18n';export * from './lib/locales/application';export * from './lib/course-catalogue';export * from './lib/profile';`,resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',outfile:join(temp,'copy.mjs')});
  const {tr,translationFor,languageOptions,languageDirection,isLanguage,applicationRows,courseCategories,profileViews,moduleCopy,questionCopy,formatDate,countryName}=await import(join(temp,'copy.mjs'));
  const keys=new Set(),raw=[];
  const files=dir=>readdirSync(dir,{withFileTypes:true}).flatMap(f=>f.isDirectory()?files(join(dir,f.name)):[join(dir,f.name)]);
  const interfaces=[...files('app'),...files('components')].filter(f=>f.endsWith('.tsx')&&!f.includes('translation-audit-fixture')&&(!f.includes('components/ui/')||f.endsWith('/dialog.tsx')));
  const add=n=>{if(!n)return;if(ts.isStringLiteral(n)||ts.isNoSubstitutionTemplateLiteral(n)){if(n.text)keys.add(n.text);}else if(ts.isConditionalExpression(n)){add(n.whenTrue);add(n.whenFalse);}else if(ts.isParenthesizedExpression(n))add(n.expression);else if(ts.isBinaryExpression(n)&&[ts.SyntaxKind.BarBarToken,ts.SyntaxKind.QuestionQuestionToken].includes(n.operatorToken.kind)){add(n.right);}};
  const rawAllowed=new Set(['PRIMARK','SCORM 1.2 ·','Close','email,completed,completed_at,site_id','blur','you@example.com','PR-XXXXXXXXXX','Primark']);
  for(const file of interfaces){
    const sf=ts.createSourceFile(file,readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
    const visit=n=>{
      if(ts.isCallExpression(n)&&['t','setNotice','setMessage','setUploadLabel','setFullscreenMessage','setError'].includes(n.expression.getText(sf)))add(n.arguments[0]);
      if(ts.isPropertyAssignment(n)&&n.name.getText(sf)==='key')add(n.initializer);
      if(ts.isJsxText(n)){const value=n.text.replace(/\s+/g,' ').trim();if(/[A-Za-z]{2}/.test(value)&&!rawAllowed.has(value))raw.push(file+': '+value);}
      if(ts.isJsxAttribute(n)&&['aria-label','title','placeholder','alt'].includes(n.name.getText(sf))&&n.initializer&&ts.isStringLiteral(n.initializer)&&/[A-Za-z]{2}/.test(n.initializer.text)&&!rawAllowed.has(n.initializer.text))raw.push(file+': '+n.initializer.text);
      ts.forEachChild(n,visit);
    };visit(sf);
  }
  // Dynamic labels whose source is structured data, rather than literal t() calls.
  for(const value of [...courseCategories,...profileViews({managerStoreId:'test',reportingAccess:{scope:'organisation'},platformAdmin:true}).map(v=>v.label),
    'Learner','Store Manager','Site reporting admin','Country reporting admin','Primark reporting admin','Platform admin',
    'Valid','Expiring soon','Expired','Not started','In progress','Completed','not attempted','incomplete','browsed','passed','failed','draft','published',
    'Required','Optional photo','Reuse existing shots','Screenshot later','Preview','Saved','Saving…','Not saved','Autosave on',
    'Preview — progress is not recorded','Your progress is saved','Your progress saves as you learn',
    'Employee','Email','Country','Store','Course','Category','Status','Completed','Expires','Score','Completion in selected period','Close'])keys.add(value);
  // Password and registration validation must not fall back to English after an API failure.
  for(const file of ['app/api/admin/organisation/route.ts','app/api/password-recovery/route.ts','lib/password-recovery.ts','app/api/shot-list/route.ts','app/api/shot-list/photos/route.ts','app/api/prototype/route.ts','lib/course-admin.ts','app/api/store/route.ts','app/api/admin/reporting-access/route.ts']){
    const sf=ts.createSourceFile(file,readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);
    const visit=n=>{if(ts.isCallExpression(n)&&['fail','shotFail','tr'].includes(n.expression.getText(sf)))add(n.arguments[n.expression.getText(sf)==='tr'?1:0]);if(ts.isNewExpression(n)&&['CourseError','RecoveryError'].includes(n.expression.getText(sf)))add(n.arguments?.[0]);if(ts.isPropertyAssignment(n)&&n.name.getText(sf)==='error')add(n.initializer);ts.forEachChild(n,visit);};visit(sf);
  }
  assert.deepEqual(raw,[],'Untranslated interface literals');
  const tokens=value=>[...value.matchAll(/\{(\w+)\}/g)].map(m=>m[1]).sort();
  const missing=[];
  for(const {code} of languageOptions){
    assert(isLanguage(code));assert.equal(languageDirection(code),code==='ar'?'rtl':'ltr');
    for(const key of keys)if(translationFor(code,key)===undefined)missing.push(code+': '+key);
    if(code==='en')continue;
    assert.equal(moduleCopy[code].length,6);assert.equal(questionCopy[code].length,20);
    for(const [key,row] of Object.entries(applicationRows)){
      const translated=translationFor(code,key);assert(translated?.trim(),code+': '+key);
      assert.deepEqual(tokens(translated),tokens(key),code+': placeholder mismatch for '+key);
    }
    assert.equal(tr(code,{key:'Open {title}',values:{title:'Customer course <data>'}}),tr(code,'Open {title}',{title:'Customer course <data>'}));
    assert(tr(code,'Open {title}',{title:'Customer course <data>'}).includes('Customer course <data>'));
  }
  assert.deepEqual(missing,[],'Missing translation keys');
  for(const value of [null,undefined,'xx','EN','<script>',{},1])assert.equal(isLanguage(value),false);
  assert.equal(countryName('Italy','it'),'Italia');assert.equal(countryName('Arese','ar'),'Arese');
  assert.equal(tr('en','Unknown authored title'),'Unknown authored title');assert.equal(tr('it','Unknown authored title'),'Unknown authored title');
  assert.equal(tr('it','← Back to accounts'),'← '+tr('it','Back to accounts'));
  assert(formatDate('2026-01-01T00:00:00Z','ar').includes('يناير'));
  console.log(`PASS ${keys.size} interface/message keys across ${languageOptions.length} languages, placeholders, locale validation, RTL and original lesson coverage`);
} finally {rmSync(temp,{recursive:true,force:true});}
