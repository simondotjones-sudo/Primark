import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { validPath, type Sco } from './course-types';
const arr = (v: any): any[] => v === undefined ? [] : Array.isArray(v) ? v : [v];
const txt = (v: any) => String(v?.['#text'] ?? v ?? '');
export function parseManifest(xml: string, files: Set<string>): Sco[] {
  if (xml.length > 1000000 || /<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) throw new Error('The SCORM manifest is invalid.');
  const doc = new XMLParser({ignoreAttributes:false,removeNSPrefix:true,parseTagValue:false,parseAttributeValue:false}).parse(xml).manifest;
  if (!doc || txt(doc.metadata?.schemaversion).trim() !== '1.2') throw new Error('Upload a SCORM 1.2 export. SCORM 2004 and other formats are not supported.');
  const resources = new Map(arr(doc.resources?.resource).map(r=>[r['@_identifier'],r]));
  const orgs = arr(doc.organizations?.organization);
  const org = orgs.find(o=>o['@_identifier']===doc.organizations?.['@_default']) ?? orgs[0];
  const scos: Sco[] = [];
  const walk = (items: any[], depth=0) => {
    if (depth>30) throw new Error('This manifest is nested too deeply.');
    for (const item of items) {
      const res = resources.get(item['@_identifierref']);
      if (res && res['@_scormtype']==='sco') {
        const raw = [doc['@_base'],doc.resources?.['@_base'],res['@_base'],res['@_href']].filter(Boolean).join('');
        if (/^[a-z][a-z0-9+.-]*:|^\/|\\/i.test(raw)) throw new Error('SCORM launch files must be inside the ZIP.');
        const url = new URL(raw,'https://package.invalid/');
        const path = decodeURIComponent(url.pathname.slice(1));
        if (!validPath(path) || !files.has(path) || !/\.html?$/i.test(path)) throw new Error('A SCORM launch HTML file is missing from the ZIP.');
        const id=String(item['@_identifier']||res['@_identifier']);
        if (scos.some(s=>s.id===id)) throw new Error('SCORM lesson identifiers must be unique.');
        scos.push({id,title:txt(item.title)||'Lesson '+(scos.length+1),href:path+url.search+url.hash,mastery:txt(item.masteryscore),launchData:txt(item.datafromlms)});
      }
      walk(arr(item.item),depth+1);
    }
  };
  walk(arr(org?.item));
  if (!scos.length || scos.length>100) throw new Error('The manifest must contain between 1 and 100 SCORM lessons.');
  return scos;
}
