import {photo_errors} from './application-photo-errors';
import {save} from './application-save';
import {errors} from './application-errors';
import {extra} from './application-extra';
import {recovery} from './application-recovery';
import {messages} from './application-messages';
import {photo_help} from './application-photo-help';
import {words} from './application-words';
import {photos} from './application-photos';
import {help} from './application-help';
export const applicationLanguages=['es','fr','de','it','nl','pt','pl','ro','cs','sk','sl','hu','ar'] as const;
export const applicationCopy=Object.fromEntries(applicationLanguages.map(lang=>[lang,{}])) as Record<typeof applicationLanguages[number],Record<string,string>>;
export const applicationRows:Record<string,string>={...words,...photos,...help,...messages,...photo_help,...recovery,...extra,...errors,...save,...photo_errors};
for(const [key,row] of Object.entries(applicationRows)){
 const values=row.split('|');
 if(values.length!==applicationLanguages.length)throw new Error(`Translation column count for ${key}: ${values.length}`);
 applicationLanguages.forEach((lang,index)=>applicationCopy[lang][key]=values[index]);
}
