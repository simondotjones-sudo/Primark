import { allowLoginAttempt } from '@/lib/admin-auth';
import type { PreparedStatement } from "@/lib/database";
import { NextRequest, NextResponse } from "next/server";
import stores from "@/lib/stores.json";
import { modules, questions } from "@/lib/course";
import { completeIfReady, currentLearner, db, hash, now, progressFor, randomCode, randomToken, storeById, withSession, type Learner } from "@/lib/server";

import { isPlatformAdmin } from "@/lib/course-admin";
import { sameOrigin } from "@/lib/shot-server";

export const dynamic = "force-dynamic";
const fail = (message: string, status = 400) => NextResponse.json({ error: message }, { status });
const emailAddress = (value: unknown) => typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) ? value.trim().toLowerCase() : "";

async function learnerState(request: NextRequest) {
  const learner = await currentLearner(request);
  if (!learner) return NextResponse.json({ learner: null, viewed: [], platformAdmin: await isPlatformAdmin() });
  const viewed = await progressFor(learner.id);
  const legacy = await db().prepare("SELECT completed FROM legacy_completions WHERE email=?").bind(learner.email).first<{completed:number}>();
  return NextResponse.json({ learner, viewed, platformAdmin: await isPlatformAdmin(), legacyCompleted: legacy?.completed === 1 });
}

async function dashboard(request: NextRequest) {
  const url = request.nextUrl;
  const role = url.searchParams.get("role") || "global";
  const country = url.searchParams.get("country") || "";
  const site = url.searchParams.get("site") || "";
  const year = url.searchParams.get("year") || String(new Date().getUTCFullYear());
  const month = url.searchParams.get("month") || "all";
  if (!["global", "country", "site"].includes(role)) return fail("Unknown demo view.");
  if (role === "country" && !country) return fail("Choose a country.");
  if (role === "site" && !storeById.has(site)) return fail("Choose a store.");
  if (year !== "all" && (!/^\d{4}$/.test(year) || Number(year) < 2000 || Number(year) > new Date().getUTCFullYear() + 1)) return fail("Choose a valid year.");
  if (month !== "all" && (year === "all" || !/^(0?[1-9]|1[0-2])$/.test(month))) return fail("Choose a valid month.");
  const all = await db().prepare("SELECT id,name,email,store_id,country,entered_at,started_at,completed_at,best_score FROM learners ORDER BY entered_at DESC").all<Learner>();
  const legacy = await db().prepare("SELECT email,completed,completed_at,store_id FROM legacy_completions").all<{email:string;completed:number;completed_at:string|null;store_id:string|null}>();
  const rows = all.results.filter((r) => role === "global" || (role === "country" ? r.country === country : r.store_id === site));
  const inScope = new Set(rows.map((r) => r.email));
  const past = legacy.results.filter((r) => {
    if (!r.completed) return false;
    if (role === "global") return true;
    if (inScope.has(r.email)) return true;
    const store = r.store_id ? storeById.get(r.store_id) : null;
    return role === "site" ? r.store_id === site : store?.country === country;
  });
  return { rows, past, year, month };
}

const inPeriod = (date:string|null,year:string,month:string) =>
  !!date && (year === "all" || (date.slice(0,4) === year && (month === "all" || Number(date.slice(5,7)) === Number(month))));
const inMonth = (date:string|null,key:string) => !!date && date.slice(0,7) === key;

export async function GET(request: NextRequest) {
  try {
    const view = request.nextUrl.searchParams.get("view");
    if (view === "me") return learnerState(request);
    if (view === "dashboard" || view === "export") {
      if (!await isPlatformAdmin()) return fail("Platform admin sign-in is required.",403);
      const result = await dashboard(request);
      if (result instanceof NextResponse) return result;
      const { rows, past, year, month } = result;
      const visible = rows.map((r) => ({
        ...r,
        period_entered: inPeriod(r.entered_at,year,month),
        period_started: inPeriod(r.started_at,year,month),
        period_completed: inPeriod(r.completed_at,year,month),
      })).filter((r) => r.period_entered || r.period_started || r.period_completed);
      const pastPeriod = year === "all" ? past : past.filter((r) => inPeriod(r.completed_at,year,month));
      const legacyByEmail = new Map(pastPeriod.map((r) => [r.email, r]));
      if (view === "export") {
        const cell = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
        const lines = [["Name","Email","Country","Store","Entered","Started","Completed in new app","Best score","Completed in old LMS"].join(","),
          ...visible.map((r) => [r.name,r.email,r.country,storeById.get(r.store_id)?.name || "",r.entered_at,r.started_at,r.completed_at,r.best_score,legacyByEmail.has(r.email) ? "Yes" : "No"].map(cell).join(","))];
        for (const r of pastPeriod) if (!visible.some((x) => x.email === r.email)) lines.push(["",r.email,storeById.get(r.store_id || "")?.country || "",storeById.get(r.store_id || "")?.name || "","","","","","Yes"].map(cell).join(","));
        return new NextResponse(lines.join("\r\n"), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="primark-induction-report.csv"' } });
      }
      const today = new Date();
      const monthKeys = Array.from({length:12},(_,i) => {
        const date = year === "all" ? new Date(Date.UTC(today.getUTCFullYear(),today.getUTCMonth()-11+i,1)) : new Date(Date.UTC(Number(year),i,1));
        return date.toISOString().slice(0,7);
      });
      const trend = monthKeys.map((key) => ({
        month:key,
        entered:rows.filter((r) => inMonth(r.entered_at,key)).length,
        started:rows.filter((r) => inMonth(r.started_at,key)).length,
        completed:rows.filter((r) => inMonth(r.completed_at,key)).length,
      }));
      const dated = [...rows.flatMap((r) => [r.entered_at,r.started_at,r.completed_at]),...past.map((r) => r.completed_at)].filter((d):d is string => !!d);
      const years = [...new Set([today.getUTCFullYear(),...dated.map((d) => Number(d.slice(0,4)))])].sort((a,b)=>b-a);
      return NextResponse.json({
        counts: { entered: visible.filter((r) => r.period_entered).length, started: visible.filter((r) => r.period_started).length, completed: visible.filter((r) => r.period_completed).length, legacy: pastPeriod.length },
        rows: visible.map((r) => ({ ...r, store_name: storeById.get(r.store_id)?.name || r.store_id, legacy_completed: legacyByEmail.has(r.email) })),
        trend, years,
      });
    }
    return fail("Unknown view.");
  } catch (error) {
    console.error("Primark prototype GET failed", error);
    return fail("The prototype is temporarily unavailable.", 503);
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!sameOrigin(request)) return fail("Please use the Safety Passport page.",403);
    const body = await request.json() as Record<string, unknown>;
    const action = body.action;
    if ((action === "seed" || action === "import") && !await isPlatformAdmin()) return fail("Platform admin sign-in is required.",403);
    const database = db();
    if (action === "register") {
      const email = emailAddress(body.email);
      const name = typeof body.name === "string" ? body.name.trim().replace(/\s+/g, " ") : "";
      const storeId = typeof body.storeId === "string" ? body.storeId : "";
      const store = storeById.get(storeId);
      if (!email || name.length < 2 || name.length > 100 || !store) return fail("Enter your name, a valid email and a store.");
      const existing = await database.prepare("SELECT id FROM learners WHERE email=?").bind(email).first();
      if (existing) return fail("This email already has a pass. Choose ‘I have a code’ to continue.", 409);
      const id = crypto.randomUUID();
      const code = randomCode();
      await database.prepare("INSERT INTO learners(id,name,email,code_hash,store_id,country,entered_at) VALUES(?,?,?,?,?,?,?)")
        .bind(id,name,email,await hash(code),storeId,store.country,now()).run();
      return withSession(request,id,{ code });
    }
    if (action === "login") {
      const email = emailAddress(body.email);
      const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
      if (!email || !code) return fail("Enter your email and pass code.");
      if (!await allowLoginAttempt("learner:"+email)) return fail("Too many attempts. Try again in 15 minutes.",429);
      const learner = await database.prepare("SELECT id,code_hash FROM learners WHERE email=?").bind(email).first<{id:string;code_hash:string}>();
      if (!learner || learner.code_hash !== await hash(code)) return fail("Those details did not match.", 401);
      return withSession(request,learner.id,{ ok: true });
    }
    if (action === "logout") {
      const cookie = request.cookies.get("primark_session")?.value;
      if (cookie) await database.prepare("DELETE FROM sessions WHERE token_hash=?").bind(await hash(cookie)).run();
      const response = NextResponse.json({ ok: true });
      response.cookies.delete("primark_session");
      return response;
    }
    if (action === "view") {
      const learner = await currentLearner(request);
      const key = typeof body.key === "string" ? body.key : "";
      if (!learner) return fail("Enter your pass code to continue.", 401);
      if (!modules.some((m) => m.key === key)) return fail("Unknown module.");
      const date = now();
      await database.batch([
        database.prepare("INSERT INTO module_views(learner_id,module_key,viewed_at) VALUES(?,?,?) ON CONFLICT DO NOTHING").bind(learner.id,key,date),
        database.prepare("UPDATE learners SET started_at=COALESCE(started_at,?) WHERE id=?").bind(date,learner.id),
      ]);
      const viewed = await progressFor(learner.id);
      await completeIfReady(learner,viewed);
      return NextResponse.json({ viewed });
    }
    if (action === "submit") {
      const learner = await currentLearner(request);
      if (!learner) return fail("Enter your pass code to continue.", 401);
      const answers = body.answers;
      if (!Array.isArray(answers) || answers.length !== questions.length ||
          answers.some((v) => !Number.isInteger(v) || v < 0 || v > 2)) return fail("Answer all 20 questions before submitting.");
      const score = questions.reduce((sum,q,i) => sum + (answers[i] === q.correct ? 1 : 0), 0);
      const date = now();
      await database.batch([
        database.prepare("INSERT INTO attempts(id,learner_id,score,taken_at) VALUES(?,?,?,?)").bind(crypto.randomUUID(),learner.id,score,date),
        database.prepare("UPDATE learners SET started_at=COALESCE(started_at,?),best_score=GREATEST(COALESCE(best_score,0),?) WHERE id=?").bind(date,score,learner.id),
      ]);
      if (score >= 18) await completeIfReady({ ...learner, best_score: score },await progressFor(learner.id));
      return NextResponse.json({ score, passed: score >= 18 });
    }
    if (action === "seed") {
      const picks = ["Ireland","United Kingdom","United States","Spain","France","Germany"].flatMap((country) => stores.filter((s) => s.country === country).slice(0,2));
      const names = ["Alex Morgan","Jordan Kelly","Taylor Reed","Morgan Patel","Casey Byrne","Jamie Ellis","Avery Cole","Riley Quinn","Samira Khan","Noah Garcia","Luca Martin","Emilia Weber"];
      const statements: PreparedStatement[] = [];
      picks.forEach((store,i) => {
        const date = new Date(Date.now() - (i+1)*86400000).toISOString();
        const completed = i % 4 === 0;
        const started = completed || i % 3 !== 0;
        statements.push(database.prepare("INSERT INTO learners(id,name,email,code_hash,store_id,country,entered_at,started_at,completed_at,best_score,certificate_token) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING")
          .bind("demo-"+i,names[i],"demo"+i+"@example.invalid","demo-no-login",store.id,store.country,date,started ? date : null,completed ? date : null,completed ? 19 : null,completed ? "demo-cert-"+i : null));
        if (started) for (const m of modules.slice(0,completed ? 6 : (i%5)+1))
          statements.push(database.prepare("INSERT INTO module_views(learner_id,module_key,viewed_at) VALUES(?,?,?) ON CONFLICT DO NOTHING").bind("demo-"+i,m.key,date));
      });
      // Spread fictional activity across a year so the trend view is useful in a fresh prototype.
      for (let i=0;i<24;i++) {
        const store = picks[i % picks.length];
        const entered = new Date(Date.UTC(new Date().getUTCFullYear(),new Date().getUTCMonth()-Math.floor(i/2),10+(i%2)*8));
        const started = i%5===0 && i%3!==0 ? null : new Date(entered.getTime()+86400000).toISOString();
        const completed = i%3===0 ? new Date(entered.getTime()+4*86400000).toISOString() : null;
        const id = "demo-trend-"+i;
        statements.push(database.prepare("INSERT INTO learners(id,name,email,code_hash,store_id,country,entered_at,started_at,completed_at,best_score,certificate_token) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING")
          .bind(id,names[i%names.length],"trend"+i+"@example.invalid","demo-no-login",store.id,store.country,entered.toISOString(),started,completed,completed ? 19 : null,completed ? "demo-trend-cert-"+i : null));
        if (started) for (const m of modules.slice(0,completed ? 6 : (i%5)+1))
          statements.push(database.prepare("INSERT INTO module_views(learner_id,module_key,viewed_at) VALUES(?,?,?) ON CONFLICT DO NOTHING").bind(id,m.key,started));
      }
      await database.batch(statements);
      return NextResponse.json({ added: picks.length + 24 });
    }
    if (action === "import") {
      const records = Array.isArray(body.records) ? body.records : [];
      if (!records.length || records.length > 1000) return fail("Choose a CSV with 1–1000 rows.");
      const statements: PreparedStatement[] = [];
      for (const item of records) {
        if (!item || typeof item !== "object") return fail("Invalid CSV row.");
        const row = item as Record<string,unknown>;
        const email = emailAddress(row.email);
        const value = String(row.completed ?? "").trim().toLowerCase();
        if (!email || !["1","0","true","false","yes","no","completed","incomplete"].includes(value)) return fail("CSV needs email and a binary completed value on every row.");
        const completed = ["1","true","yes","completed"].includes(value) ? 1 : 0;
        const date = typeof row.completed_at === "string" && /^\d{4}-\d{2}-\d{2}/.test(row.completed_at) ? row.completed_at : null;
        const site = typeof row.site_id === "string" && storeById.has(row.site_id) ? row.site_id : null;
        statements.push(database.prepare("INSERT INTO legacy_completions(email,completed,completed_at,store_id,imported_at) VALUES(?,?,?,?,?) ON CONFLICT(email) DO UPDATE SET completed=excluded.completed,completed_at=excluded.completed_at,store_id=excluded.store_id,imported_at=excluded.imported_at")
          .bind(email,completed,date,site,now()));
      }
      await database.batch(statements);
      return NextResponse.json({ imported: statements.length });
    }
    return fail("Unknown action.");
  } catch (error) {
    console.error("Primark prototype POST failed", error);
    return fail("We could not save that change. Please try again.", 503);
  }
}
