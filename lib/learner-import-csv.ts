export const importColumns=['workday_id','name','email','store_code','start_date','status','effective_date','reason','initial_password'] as const;
export type ImportRecord=Record<typeof importColumns[number],string>;
export type ImportRow={row:number;record:ImportRecord};
export type ImportPreviewRow={row:number;workdayId:string;name:string;action:string;changes:{field:string;before:string;after:string}[];errors:string[]};
export type ImportPreview={rows:ImportPreviewRow[];revision:string;valid:boolean;changed:number};
// RFC 4180 quoting, BOM, CRLF and embedded newlines. Keep identifiers as text.
export function parseLearnerCsv(source:string):ImportRow[]{
 if(source.length>500000)throw new Error('This request is too large.');
 const rows:string[][]=[];let row:string[]=[],value='',quoted=false,closed=false;
 const cell=()=>{row.push(value);value='';closed=false;};
 const line=()=>{cell();if(row.some(v=>v.trim()))rows.push(row);row=[];};
 source=source.replace(/^\uFEFF/,'');
 for(let i=0;i<source.length;i++){
  const c=source[i];
  if(quoted){if(c==='"'){if(source[i+1]==='"'){value+='"';i++;}else{quoted=false;closed=true;}}else value+=c;continue;}
  if(c===','){cell();continue;}
  if(c==='\r'||c==='\n'){if(c==='\r'&&source[i+1]==='\n')i++;line();continue;}
  if(closed)throw new Error('Invalid CSV quoting.');
  if(c==='"'){if(value)throw new Error('Invalid CSV quoting.');quoted=true;}else value+=c;
 }
 if(quoted)throw new Error('Invalid CSV quoting.');
 if(value||row.length||closed)line();
 const headers=rows.shift()?.map(v=>v.trim().toLowerCase())||[];
 if(!headers.includes('workday_id')||new Set(headers).size!==headers.length||headers.some(v=>!importColumns.includes(v as typeof importColumns[number])))throw new Error('Use the learner import template column headings.');
 if(!rows.length||rows.length>200)throw new Error('Upload between 1 and 200 learners per file.');
 return rows.map((values,index)=>{if(values.length!==headers.length)throw new Error('Every CSV row must have the same number of columns.');const record=Object.fromEntries(importColumns.map(k=>[k,''])) as ImportRecord;headers.forEach((k,i)=>record[k as keyof ImportRecord]=k==='initial_password'?values[i]:values[i].trim());return {row:index+2,record};});
}
export function csvDownload(rows:unknown[][]){return '\uFEFF'+rows.map(row=>row.map(value=>{const text=String(value??'');return '"'+(/^[=+\-@\t\r]/.test(text)?"'":'')+text.replaceAll('"','""')+'"';}).join(',')).join('\r\n');}
