import { db, storeById } from "@/lib/server";
import { Check, ShieldCheck } from "lucide-react";
import { contentLanguage, languageDirection, languageOptions, type Language } from "@/lib/i18n";
import { tr, formatDate, countryName } from "@/lib/ui-copy";

export const dynamic = "force-dynamic";
export default async function Verify({params,searchParams}:{params:Promise<{token:string}>;searchParams:Promise<{lang?:string}>}) {
  const {token}=await params;
  const requested=(await searchParams).lang;
  const lang:Language=languageOptions.some(option=>option.code===requested)?requested as Language:"en";
  const t=(value:string)=>tr(lang,value);
  const record = token.length <= 100 ? await db().prepare("SELECT name,store_id,country,completed_at,best_score FROM learners WHERE certificate_token=? AND completed_at IS NOT NULL").bind(token).first<{name:string;store_id:string;country:string;completed_at:string;best_score:number}>() : null;
  return <main className="verify-page" lang={contentLanguage(lang)} dir={languageDirection(lang)}><div className="verify-card"><div className="verify-brand">PRIMARK <span>{t("Safety Passport")}</span></div>{record?<><div className="verify-tick"><Check size={45}/></div><span className="eyebrow">{t("LIVE CERTIFICATE RECORD")}</span><h1>{t("Safety Passport verified")}</h1><p>{t("This person completed the Primark induction in this prototype.")}</p><dl><div><dt>{t("Name")}</dt><dd dir="auto">{record.name}</dd></div><div><dt>{t("Store")}</dt><dd>{storeById.get(record.store_id)?.name || record.store_id}, {countryName(record.country,lang)}</dd></div><div><dt>{t("Passed")}</dt><dd>{formatDate(record.completed_at,lang)}</dd></div><div><dt>{t("Assessment")}</dt><dd><bdi dir="ltr">{record.best_score}/20</bdi></dd></div></dl></>:<><ShieldCheck size={48}/><h1>{t("Pass not found")}</h1><p>{t("We could not verify a completed pass with this code.")}</p></>}<small>{t("Private prototype · Sample learning and demo records")}</small></div></main>;
}
