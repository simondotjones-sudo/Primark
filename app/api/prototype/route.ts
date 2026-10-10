import {invitationForToken} from '@/lib/email-notifications';
import { inTransaction } from '@/lib/database';
import {syncAssignments,creditError} from '@/lib/credits';
import { learnerOnlySql } from "@/lib/account-type";
import { allowLoginAttempt, ADMIN_COOKIE, credentials, getAdminUser, passwordMatches, safeReturnTo } from '@/lib/admin-auth';
import { createAdminSession } from '@/lib/admin-session';
import { getReportingAccess, reportingAccessFor, reportingFilter } from '@/lib/reporting-access';
import type { ReportingAccess } from "@/lib/reporting-types";
import type { ProfileAccount } from "@/lib/profile";
import type { PreparedStatement } from "@/lib/database";
import { NextRequest, NextResponse } from "next/server";
import {storeDirectory} from '@/lib/store-directory';
import { modules, questions } from "@/lib/course";
import { completeIfReady, currentLearner, pendingEmailLearner, db, hash, now, progressFor, randomToken, withSession, type Learner } from "@/lib/server";

import { isPlatformAdmin, CourseError } from "@/lib/course-admin";
import { sameOrigin } from "@/lib/shot-server";
import { hashPassword, normalizeWorkdayId, validPassword, verifyPassword } from '@/lib/learner-auth';
import { bodyJson } from '@/lib/course-admin';
import { managerStoreFor } from '@/lib/store-manager';
import { readyCourses } from '@/lib/course-access';
import { inductionFor } from '@/lib/course-catalogue';

export const dynamic = "force-dynamic";
const fail = (message: string, status = 400) => NextResponse.json({ error: message }, { status });
const emailAddress = (value: unknown) => typeof value === "string" && value.trim().length<=254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) ? value.trim().toLowerCase() : "";

const privateHeaders = { "Cache-Control": "private, no-store" };
async function learnerState(request: NextRequest) {
  if (await pendingEmailLearner(request)) return NextResponse.json({learner:null,account:null,viewed:[],platformAdmin:false,reportingAccess:null,requiresEmail:true},{headers:privateHeaders});
  const stores=await storeDirectory();const storeById=new Map(stores.map(s=>[s.id,s]));
  const learner = await currentLearner(request);
  const admin = await getAdminUser();
  const platformAdmin = !!admin;
  const reportingAccess: ReportingAccess | null = platformAdmin ? { scope: 'organisation', country: null, siteId: null }
    : learner ? await reportingAccessFor(learner.id) : null;
  const adminPerson = admin ? await db().prepare('SELECT name FROM learners WHERE email=?').bind(admin.email).first<{name:string}>() : null;
  const managerStore = learner ? await managerStoreFor(learner.id) : null;
  const assessor=!!learner&&!!await db().prepare('SELECT learner_id FROM assessor_accounts WHERE learner_id=?').bind(learner.id).first();
  const account: ProfileAccount | null = learner ? {
    name: learner.name, email: learner.email, adminOnly: learner.admin_only, assessor,
    role: platformAdmin ? 'Platform admin' : managerStore ? 'Store Manager' : !reportingAccess ? (assessor&&learner.admin_only?'Assessor':'Learner') : reportingAccess.scope === 'site' ? 'Site reporting admin' : reportingAccess.scope === 'country' ? 'Country reporting admin' : 'Primark reporting admin',
    managerStoreId: platformAdmin ? null : managerStore?.id || null,
    site: platformAdmin || reportingAccess?.scope === 'organisation' ? 'All Primark' : reportingAccess?.scope === 'country' ? reportingAccess.country || '' : storeById.get(reportingAccess?.siteId || learner.store_id)?.name || learner.store_id, platformAdmin, reportingAccess,
  } : admin ? { name: adminPerson?.name || admin.email, email: admin.email, role: 'Platform admin', site: 'All Primark', platformAdmin: true, adminOnly: true, reportingAccess } : null;
  const identity = { platformAdmin, reportingAccess, account };
  if (!learner || learner.admin_only) return NextResponse.json({ learner: null, viewed: [], ...identity }, { headers: privateHeaders });
  const viewed = await progressFor(learner.id);
  const legacy = await db().prepare("SELECT completed FROM legacy_completions WHERE email=?").bind(learner.email).first<{completed:number}>();
  return NextResponse.json({ learner, viewed, ...identity, legacyCompleted: legacy?.completed === 1 }, { headers: privateHeaders });
}

async function dashboard(request: NextRequest) {
  const access = await getReportingAccess(request);
  if (!access) return fail("Reporting access is required.", 403);
  const url = request.nextUrl;
  const { siteIds } = reportingFilter(access, url.searchParams, await storeDirectory());
  const year = url.searchParams.get("year") || String(new Date().getUTCFullYear());
  const month = url.searchParams.get("month") || "all";
  if (year !== "all" && (!/^\d{4}$/.test(year) || Number(year) < 2000 || Number(year) > new Date().getUTCFullYear() + 1)) return fail("Choose a valid year.");
  if (month !== "all" && (year === "all" || !/^(0?[1-9]|1[0-2])$/.test(month))) return fail("Choose a valid month.");
  // Apply scope before loading any names, history, counts or trend dates.
  const placeholders = siteIds?.map(() => '?').join(',');
  const peopleWhere = `${learnerOnlySql()} AND ${siteIds ? `l.store_id IN (${placeholders})` : '1=1'}`;
  const historyWhere = siteIds ? `COALESCE(l.store_id,c.store_id) IN (${placeholders})` : '1=1';
  const [people, history] = await Promise.all([
    db().prepare(`SELECT l.id,l.name,l.email,l.store_id,l.country,l.entered_at,l.started_at,l.completed_at,l.best_score
      FROM learners l WHERE ${peopleWhere} ORDER BY l.entered_at DESC`).bind(...(siteIds || [])).all<Learner>(),
    db().prepare(`SELECT c.email,c.completed,c.completed_at,COALESCE(l.store_id,c.store_id) AS store_id
      FROM legacy_completions c LEFT JOIN learners l ON l.email=c.email
      WHERE c.completed=1 AND (l.id IS NULL OR (${learnerOnlySql()})) AND ${historyWhere}`).bind(...(siteIds || [])).all<{email:string;completed:number;completed_at:string|null;store_id:string|null}>(),
  ]);
  return { rows: people.results, past: history.results, year, month };
}

const inPeriod = (date:string|null,year:string,month:string) =>
  !!date && (year === "all" || (date.slice(0,4) === year && (month === "all" || Number(date.slice(5,7)) === Number(month))));
const inMonth = (date:string|null,key:string) => !!date && date.slice(0,7) === key;

export async function GET(request: NextRequest) {
  try {
  const stores=await storeDirectory();const storeById=new Map(stores.map(s=>[s.id,s]));
    const view = request.nextUrl.searchParams.get("view");
    if (view === "me") return await learnerState(request);
    if (view === "dashboard" || view === "export") {
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
        return new NextResponse(lines.join("\r\n"), { headers: { ...privateHeaders, "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="primark-induction-report.csv"' } });
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
      }, { headers: privateHeaders });
    }
    return fail("Unknown view.");
  } catch (error) {
    const mapped=creditError(error);
    if (mapped instanceof CourseError) return fail(mapped.message, mapped.status);
    console.error("Primark prototype GET failed", error);
    return fail("The prototype is temporarily unavailable.", 503);
  }
}

export async function POST(request: NextRequest) {
  try {
  const stores=await storeDirectory();const storeById=new Map(stores.map(s=>[s.id,s]));
    if (!sameOrigin(request)) return fail("Please use the Safety Passport page.",403);
    const body = await bodyJson(request, 100000) as Record<string, unknown>;
    const action = body.action;
    if ((action === "seed" || action === "import") && !await isPlatformAdmin()) return fail("Platform admin sign-in is required.",403);
    const database = db();
    if (action === "register") {
      const invitation=body.invitationToken?await invitationForToken(body.invitationToken):null;
      if(invitation&&(invitation.registered||body.email!==invitation.email||body.storeId!==invitation.store_id))return fail('This invitation is no longer available.');
      const email = emailAddress(body.email);
      const cleanName = (value:unknown) => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
      const firstName = cleanName(body.firstName), surname = cleanName(body.surname);
      const splitName = body.firstName !== undefined || body.surname !== undefined;
      if (splitName && (!firstName || !surname || firstName.length > 50 || surname.length > 50)) return fail('Enter your first name and surname.');
      // Keep older open registration pages working during deployment.
      const name = splitName ? `${firstName} ${surname}` : cleanName(body.name);
      const workdayId = normalizeWorkdayId(body.workdayId);
      if (!workdayId) return fail('Enter a valid Workday ID.');
      const storeId = typeof body.storeId === "string" ? body.storeId : "";
      const store = storeById.get(storeId);
      if (!email || name.length < 2 || name.length > 101 || !store || !store.active) return fail("Enter your name, a valid email and a store.");
      if (!await allowLoginAttempt('register:'+email, 10)) return fail('Too many attempts. Try again in 15 minutes.',429);
      if (!invitation && (typeof body.registrationCode !== 'string' || body.registrationCode.trim().toLowerCase() !== 'safety')) return fail('Enter the registration code provided by Primark.');
      if (!validPassword(body.password)) return fail('Create a password with 8–128 characters.');
      if (body.country !== undefined && body.country !== store.country) return fail('Choose a store in your selected country.');
      const existing = await database.prepare("SELECT id FROM learners WHERE lower(btrim(email))=?").bind(email).first();
      if (existing) return fail('This email is already registered. Choose Login to continue.', 409);
      if (await database.prepare('SELECT id FROM learners WHERE workday_id=? OR upper(btrim(legacy_access_code))=?').bind(workdayId,workdayId).first()) return fail('This Workday ID is already linked to an account. Choose Login to continue.',409);
      const id = crypto.randomUUID();
      const induction=inductionFor(await readyCourses(),store.country);
      const changes=[database.prepare("INSERT INTO learners(id,name,email,code_hash,store_id,country,entered_at,password_hash,induction_enrolled,first_name,surname,workday_id) VALUES(?,?,?,?,?,?,?,?,true,?,?,?) ON CONFLICT DO NOTHING")
        .bind(id,name,email,await hash(randomToken()),storeId,store.country,now(),await hashPassword(body.password),firstName||null,surname||null,workdayId)];
      if(induction)changes.push(database.prepare('INSERT INTO learner_inductions(learner_id,course_id,assigned_at) SELECT id,?,? FROM learners WHERE id=?').bind(induction.id,now(),id));
      changes.push(syncAssignments(id));
      if(invitation)changes.push(database.prepare('SELECT accept_learning_invitation(?,?)').bind(await hash(String(body.invitationToken)),id));
      const inserted=await database.batch(changes);
      if (!inserted[0].meta.changes) {
        const emailTaken=await database.prepare('SELECT id FROM learners WHERE lower(btrim(email))=?').bind(email).first();
        return emailTaken ? fail('This email is already registered. Choose Login to continue.',409) : fail('This Workday ID is already linked to an account. Choose Login to continue.',409);
      }
      return withSession(request,id,{ ok: true, returnTo: induction ? `/learn/${encodeURIComponent(induction.id)}/` : '/?courses=1' });
    }
    if (action === "login") {
      const identifier = body.identifier ?? body.email;
      const email = emailAddress(identifier);
      const loginCode = !email && typeof identifier === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(identifier.trim()) ? identifier.trim().toUpperCase() : null;
      const password = typeof body.password === 'string' ? body.password : '';
      if ((!email && !loginCode) || !password || password.length > 1024) return fail('Enter your email, Workday ID or access code and password.');
      if (!await allowLoginAttempt(email ? 'learner:'+email : 'identifier:'+loginCode)) return fail("Too many attempts. Try again in 15 minutes.",429);
      if (email && email === credentials()?.email) {
        if (!await allowLoginAttempt('platform-admin')) return fail('Too many attempts. Try again in 15 minutes.',429);
        if (await passwordMatches(email,password)) return await createAdminSession(request,body.returnTo);
      }
      if (password.length > 128) return fail('Those details did not match.',401);
      const matches = await database.prepare(`SELECT id,email,password_hash,
        EXISTS(SELECT 1 FROM platform_admins p WHERE p.learner_id=learners.id) AS platform_admin
        FROM learners WHERE ${email ? 'lower(btrim(email))=?' : '(workday_id=? OR upper(btrim(legacy_access_code))=? OR code_hash=?)'} AND archived_at IS NULL LIMIT 2`)
        .bind(...(email ? [email] : [loginCode,loginCode,await hash(loginCode!)]))
        .all<{id:string;email:string|null;password_hash:string|null;platform_admin:boolean}>();
      // Ambiguous imported aliases must not silently select a different account.
      const learner = matches.results.length === 1 ? matches.results[0] : null;
      // Both aliases share an account limit, so alternating identifiers cannot bypass it.
      if (learner && !await allowLoginAttempt('learner-account:'+learner.id)) return fail('Too many attempts. Try again in 15 minutes.',429);
      const correct = await verifyPassword(password, learner?.password_hash || null);
      if (!learner || !correct) return fail('Those details did not match.',401);
      if (!learner.email?.trim()) return withSession(request,learner.id,{ok:true,requiresEmail:true},true);
      const assessorOnly=await db().prepare('SELECT learner_id FROM assessor_accounts WHERE learner_id=? AND assessor_only').bind(learner.id).first();
      if(assessorOnly)return withSession(request,learner.id,{ok:true,returnTo:'/assessor'});
      return withSession(request,learner.id,{ ok: true, ...(learner.platform_admin ? {returnTo:body.returnTo ? safeReturnTo(body.returnTo) : "/?view=report"} : {}) });
    }
    if (action === 'set-password') {
      const email = emailAddress(body.email);
      const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
      if (!email || !code || !validPassword(body.password)) return fail('Enter your email, existing pass code and a new password with 8–128 characters.');
      if (!await allowLoginAttempt('learner:'+email)) return fail('Too many attempts. Try again in 15 minutes.',429);
      const learner = await database.prepare('SELECT id FROM learners WHERE lower(btrim(email))=? AND code_hash=? AND password_hash IS NULL AND archived_at IS NULL').bind(email,await hash(code)).first<{id:string}>();
      if (!learner) return fail('Those details did not match, or a password is already set. Use Login if you already have a password.',401);
      const saved = await database.prepare('UPDATE learners SET password_hash=?,code_hash=?,legacy_access_code=COALESCE(legacy_access_code,?) WHERE id=? AND password_hash IS NULL AND archived_at IS NULL')
        .bind(await hashPassword(body.password),await hash(randomToken()),code,learner.id).run();
      if (!saved.meta.changes) return fail('A password is already set. Use Login.',409);
      await database.prepare('DELETE FROM sessions WHERE learner_id=?').bind(learner.id).run();
      return withSession(request,learner.id,{ok:true});
    }
    if (action === 'complete-email') {
      const pending = await pendingEmailLearner(request);
      if (!pending) return fail('Your sign-in expired. Please log in again.',401);
      const email = emailAddress(body.email);
      if (!email) return fail('Enter a valid email address.');
      if (!await allowLoginAttempt('email-link:'+pending.id,20)) return fail('Too many attempts. Try again in 15 minutes.',429);
      if (email === credentials()?.email) return fail('This email is already registered. Use a different email address.',409);
      try {
        await inTransaction(async client => {
          const tokenHash=await hash(request.cookies.get('primark_session')!.value);
          const account=await client.query(`SELECT l.id FROM learners l WHERE l.id=$1 AND l.archived_at IS NULL
            AND NULLIF(btrim(l.email),'') IS NULL AND EXISTS(SELECT 1 FROM sessions s WHERE s.learner_id=l.id
              AND s.token_hash=$2 AND s.email_pending=true AND s.expires_at>$3) FOR UPDATE`,[pending.id,tokenHash,now()]);
          if (!account.rows.length) throw new CourseError('Your sign-in expired. Please log in again.',401);
          const existing=await client.query('SELECT id FROM learners WHERE lower(btrim(email))=$1',[email]);
          if(existing.rows.length)throw new CourseError('This email is already registered. Use a different email address.',409);
          await client.query('UPDATE learners SET email=$1 WHERE id=$2',[email,pending.id]);
          await client.query('DELETE FROM sessions WHERE learner_id=$1',[pending.id]);
        });
      } catch(error) {
        if ((error as {code?:string}).code==='23505') return fail('This email is already registered. Use a different email address.',409);
        throw error;
      }
      return withSession(request,pending.id,{ok:true});
    }
    if (action === "logout") {
      const cookie = request.cookies.get("primark_session")?.value;
      if (cookie) await database.prepare("DELETE FROM sessions WHERE token_hash=?").bind(await hash(cookie)).run();
      const response = NextResponse.json({ ok: true });
      const adminToken = request.cookies.get(ADMIN_COOKIE)?.value;
      if (adminToken) await database.prepare("DELETE FROM admin_sessions WHERE token_hash=?").bind(await hash(adminToken)).run();
      response.cookies.delete("primark_session");
      response.cookies.delete(ADMIN_COOKIE);
      return response;
    }
    if (action === "view") {
      const learner = await currentLearner(request);
      const key = typeof body.key === "string" ? body.key : "";
      if (!learner) return fail("Enter your pass code to continue.", 401);
      if (learner.admin_only) return fail("Use your personal learner account for training.",403);
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
      if (learner.admin_only) return fail("Use your personal learner account for training.",403);
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
    const mapped=creditError(error);
    if (mapped instanceof CourseError) return fail(mapped.message,mapped.status);
    console.error("Primark prototype POST failed", error);
    return fail("We could not save that change. Please try again.", 503);
  }
}
