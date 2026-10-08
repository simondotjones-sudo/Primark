import {ZipWriter,Uint8ArrayWriter,TextReader} from '@zip.js/zip.js';
import type {PeriodReport,PeriodRow} from '@/lib/period-report';
const xml=(v:unknown)=>String(v??'').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const col=(i:number):string=>i<26?String.fromCharCode(65+i):col(Math.floor(i/26)-1)+col(i%26);
type Cell=string|number|{formula:string;value:number}|null;
export async function periodWorkbook(report:PeriodReport){
 const priced=report.platformAdmin;
 const label=report.period.kind==='fytd'?'Financial Year to Date':report.period.kind==='quarter'?`Q${report.period.number} (Periods ${report.period.firstPeriod}–${report.period.lastPeriod})`:'P'+report.period.number;
 const rows:Cell[][]=[['Primark period report'],[report.period.yearLabel+' · '+label,report.period.startsOn,report.period.endsOn],
  ['Accounting timezone','Europe/London','As of',report.asOf],priced?['Override EUR/unit',null,'Leave blank to keep recorded prices.']:[],
  ['Refunds use the removal date. Completions relate to assignments in the selected range. Inactivity uses recorded history as of the report date.'],
  ['Country','Store code','Store','Assignments','Refunds','Net chargeable','Completions','Non completions','Removed','Opening credits','Top-ups','Closing credits',...(priced?['Recorded value EUR','Export value EUR']:[]),'Last assignment (Europe/London)','Days since last assignment']];
 const numeric=(r:PeriodRow)=>[r.assignments,r.refunds,r.net,r.completed,r.nonCompletions,r.removed,r.opening,r.topups,r.closing];
 const countryTotals:number[]=[],storeRows:number[]=[];
 const groups=report.sort!=='store'?[{rows:report.rows,total:null}]:report.countries.map(country=>({rows:report.rows.filter(r=>r.country===country.country),total:country}));
 for(const group of groups){
  const start=rows.length+1;
  for(const r of group.rows){
   const n=rows.length+1;storeRows.push(n);
   const last=r.lastAssignedAt?new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',dateStyle:'medium',timeStyle:'short'}).format(new Date(r.lastAssignedAt)):'No recorded assignments';
   rows.push([r.country,r.storeCode||'',r.storeName,...numeric(r),...(priced?[r.valueCents!/100,{formula:`IF($B$4="",M${n},ROUND(F${n}*$B$4,2))`,value:r.valueCents!/100}]:[]),last,r.daysSinceAssignment]);
  }
  const country=group.total;if(!country)continue;
  const end=rows.length,n=end+1;countryTotals.push(n);
  rows.push([country.country,'','Country total',...numeric(country).map((value,i)=>({formula:`SUM(${col(i+3)}${start}:${col(i+3)}${end})`,value})),...(priced?['M','N'].map(c=>({formula:`SUM(${c}${start}:${c}${end})`,value:country.valueCents!/100})):[]),null,null]);
 }
 const total=report.totals,summaryRows=countryTotals.length?countryTotals:storeRows;
 const sum=(column:string)=>countryTotals.length?'SUM('+summaryRows.map(n=>column+n).join(',')+')':storeRows.length?`SUM(${column}${storeRows[0]}:${column}${storeRows.at(-1)})`:'0';
 rows.push(['','','Overall total',...numeric(total).map((value,i)=>({formula:sum(col(i+3)),value})),...(priced?['M','N'].map(c=>({formula:sum(c),value:total.valueCents!/100})):[]),null,null]);
 const sheet=`<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane ySplit="6" topLeftCell="A7" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="2" width="18" customWidth="1"/><col min="3" max="3" width="35" customWidth="1"/><col min="4" max="${priced?14:12}" width="14" customWidth="1"/><col min="${priced?15:13}" max="${priced?16:14}" width="26" customWidth="1"/></cols><sheetData>${rows.map((row,index)=>`<row r="${index+1}" ht="${index===5?42:22}" customHeight="1">${row.map((v,c)=>{
  const priceColumn=priced&&c>=12&&c<=13;
  const ref=col(c)+(index+1),style=index===5?1:(countryTotals.includes(index+1)||index===rows.length-1)?(priceColumn?5:3):priced&&index===3&&c===1?4:priceColumn?2:0;
  if(v===null)return `<c r="${ref}" s="${style}"/>`;
  if(typeof v==='object')return `<c r="${ref}" s="${style}"><f>${xml(v.formula)}</f><v>${v.value}</v></c>`;
  if(typeof v==='number')return `<c r="${ref}" s="${style}"><v>${v}</v></c>`;
  return `<c r="${ref}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
 }).join('')}</row>`).join('')}</sheetData>${priced?'<dataValidations count="1"><dataValidation type="decimal" operator="between" allowBlank="1" showErrorMessage="1" sqref="B4"><formula1>0</formula1><formula2>10000</formula2></dataValidation></dataValidations>':''}</worksheet>`;
 const files:Record<string,string>={
 '[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
 '_rels/.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
 'xl/workbook.xml':'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Period report" sheetId="1" r:id="rId1"/></sheets><calcPr calcMode="auto" fullCalcOnLoad="1"/></workbook>',
 'xl/_rels/workbook.xml.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
 'xl/styles.xml':'<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts><fonts count="3"><font><sz val="11"/><name val="Arial"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Arial"/></font><font><b/><sz val="11"/><name val="Arial"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF007FAE"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF2CC"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="6"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFill="1" applyFont="1" applyAlignment="1"><alignment wrapText="1" vertical="center"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="164" fontId="0" fillId="3" borderId="0" xfId="0" applyFill="1" applyNumberFormat="1"/><xf numFmtId="164" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>',
 'xl/worksheets/sheet1.xml':sheet,
 };
 const writer=new ZipWriter(new Uint8ArrayWriter(),{useWebWorkers:false});
 for(const [path,value]of Object.entries(files))await writer.add(path,new TextReader(value));
 return writer.close();
}
