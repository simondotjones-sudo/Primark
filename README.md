# Primark Safety Passport

Primark Safety Passport migrated from the current prototype (version 15, source
`3aec70bb525fc8a0497b31a1e00ed74031c9b8ff`) to Next.js on Netlify.

## Import into Netlify

1. Add a new project → Import an existing project → GitHub → `simondotjones-sudo/Primark`.
2. Use the `main` branch. The repository's `netlify.toml` supplies the settings:
   - Framework: Next.js
   - Build command: `pnpm build`
   - Publish directory: `.next`
   - Node.js: 22
   - Base directory: leave empty
3. Add these environment variables, available to Functions (or all scopes):
   - `PRIMARK_ADMIN_EMAIL`: the email you want to use for platform admin.
   - `PRIMARK_ADMIN_PASSWORD`: a unique password of at least 16 characters. Mark it secret.
   Set different credentials for deploy previews if you enable them.
4. Deploy. `@netlify/database` provisions Netlify Database and applies the SQL in
   `netlify/database/migrations/` in order. Netlify Blobs
   stores uploaded course files and photos automatically.
5. Open the home page, choose Login with the configured platform-admin credentials, create a course, upload a SCORM 1.2 ZIP, select its audience
   and publish. Learners register from the home page with the `safety` code, choose a password and select their country/store.

No manually created Neon project or database connection string is needed.
If database provisioning needs attention, open Data & Storage → Database in Netlify.
Netlify detects and installs its Next.js adapter automatically.

## Included

- Existing Primark design, Gellix fonts, country/store directory and translations.
- Learner registration, password sign-in, saved progress, assessment, PDF printing and QR verification.
- Platform-admin course creation, SCORM 1.2 validation, previews and deployment to users,
  countries and sites, including future matching joiners.
- SCORM resume state, completion, scores, time tracking and the latest nested-frame fix.
- Admin reports, CSV export/import and photo shot-list uploads.
- PostgreSQL migrations, transactional database adapter, admin sign-in and session revocation.
- Chunked uploads (2 MiB requests), plus authenticated Edge Function file streaming and byte ranges.

## Data and access

This is a source migration. The initial Netlify database is empty. The existing prototype,
its database and uploaded SCORM packages/photos remain unchanged. Source assets such as the
chapter-one video are included (the build reassembles its checksum-verified parts), but prototype learner records, credentials, assignments,
progress and dynamically uploaded files are not committed. Transfer those privately after
the Netlify project is available, if required; never put database exports into this public repo.

Initial admin access uses the server-configured email/password. Registration alone and
headers from the old host never grant admin access. Configured-admin sessions last eight
hours, are stored as hashed tokens in Postgres,
and are revoked by logout or changing the configured credentials. Login attempts are rate
limited. Never put real admin credentials in committed files or `NEXT_PUBLIC_*` variables.

Platform admins assign Platform admin, Store Manager and reporting roles using **Manage Users → Edit access** at `/admin/reporting-access`. Select an existing
learner account, choose Site, Country or Primark reporting admin, then save. Reporting
admins use their learner email and password and can view/export only the assigned
scope. Only platform admins can create or publish courses, import historical completions, load sample
records, use the shot list or assign/revoke platform access. Store Managers can assign published courses in their country to existing store users. Choose Learner only to remove reporting access.

To add another platform admin, register the account normally, then use **Edit access →
Platform admin → Save access**. The account keeps its normal email/Workday ID, password,
learning records and assignments. The server checks its explicit `platform_admins` grant
and unexpired session on every admin request. Selecting another role removes platform
access immediately; invalid changes leave the current role intact. A granted admin must
ask another admin to remove their own platform access. The hosting-configured admin is
unchanged and remains the recovery account. Merely sharing its email never grants access.
Sign-out and password recovery revoke the registered account's sessions normally.
Migration `20261008073000_platform-admins` adds the grant table without promoting anyone;
it must be applied before the new code serves requests.

Signing into a registered account revokes the current configured-admin session; signing
into the configured admin revokes the current registered-account session. If both cookies
are present, only the registered account's own grants apply. Registered accounts retain
their normal session lifecycle. Grants and revocations are checked on each request;
refresh or revisit the tab to update the menu.

The top-right profile icon contains name, role, site, sign out and permitted views.
Reporting admins can switch between the reporting levels and sites within their assigned
scope. Platform admins can also reach course management, reporting access and the shot list
from this menu. The header displays the Primark logo; Safety Passport stays in learning.

Production uploads survive deployments. Preview branches write to separate blob stores;
they may read immutable production files referenced by their copied database. Build-time
context is embedded by `scripts/build-context.mjs`; it contains no secrets.

SCORM packages execute JavaScript. Only upload trusted authoring-tool exports. The existing
same-origin frame support is retained because many SCORM 1.2 players require it.

Password recovery uses Postmark. Before release, set `POSTMARK_SERVER_TOKEN` (secret),
`POSTMARK_FROM_EMAIL` (a verified sender), `POSTMARK_MESSAGE_STREAM` (default `outbound`)
and `PRIMARK_APP_URL` (the HTTPS origin for this deploy context), in Functions scope.
Redeploy after changing them. Do not use production sender credentials on untrusted previews.
The Login tab links to `/forgot-password/`; reset emails open `/reset-password/`.
Links expire after 30 minutes, are stored only as hashes, work once, and changing a password
invalidates other outstanding links and existing sessions. Learning records and permissions
are preserved. Unknown and existing emails receive the same confirmation. Delivery errors
are logged without email addresses or links. An unconfigured sender shows an availability error.
Platform admin resets require 16 characters and store a scrypt hash separately from learner
passwords. If one email has both identities, its email contains separately labelled links.
Changing the hosting admin credentials revokes admin sessions and reset links and overrides
the recovered admin password, providing a hosting-level recovery path.

The profile footer displays `Primark Version major.DD.MM.YY.build`, matching TapTick.
Update `lib/app-version.ts` (including the build number) for each release.

Approved final learning content remains a separate launch task.
Only chapter one currently has a video; the other chapters retain their existing sample
content. Reporting permissions are enforced for site, country and organisation scopes.
The photo collection workspace, upload endpoints and direct photo links are platform-admin
only. Existing photos retain their original attribution; new uploads and status updates
record the platform admin email.

## Develop and verify

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm test
pnpm typecheck
pnpm build
```

`pnpm dev` runs Netlify Dev with its local database/blob emulation. Copy `.env.example`
to `.env` for local admin access. Never commit `.env`.

Tests use an isolated in-memory PostgreSQL engine (PGlite) and simulated blob storage.
The checks cover course publication/assignment, SCORM saving/resume, transaction rollback,
admin authentication, learner registration/completion, multipart photos and streamed reads.
They also cover public-host validation behind Netlify, account switching, navigation,
reporting boundaries (including CSV, historical records and trends), profile scope controls,
shot-list access for every role, photo attribution and role revocation.
The Next.js production build and serverless packaging passed. Local Edge configuration
inspection could not reach Netlify’s type endpoint from this environment; the Edge source
was compiled locally and its file-delivery handler passed the integration checks.
A smoke test on the first Netlify deploy is still required:
register a test learner, publish a small test SCORM course, save/reopen it, check reporting,
and upload/download a photo. No Netlify deployment was created by the source migration.

## Registration, course library and Store Managers

Registration has two steps: enter the `safety` induction code, then provide first name,
surname, email, optional Workday ID, a searchable store and a password. Country is derived
from the selected active store. The form keeps entered details when moving back or after
an error, signs in immediately and opens My Courses without issuing a login code.
The compact layout fits the first viewport on desktop and small phones, with natural
scrolling retained for zoom, an open keyboard and longer validation messages.

Registration accepts `safety` without case sensitivity (surrounding spaces are ignored).
The code is an enrolment code, not a password or an admin permission. Passwords are
8–128 characters and stored using individually salted scrypt hashes. Login uses email
or Workday ID with the same password. Workday IDs preserve leading zeroes, ignore case
and surrounding spaces, and are unique across learner accounts. They accept letters,
numbers, periods, underscores and hyphens (1–50 characters); they do not verify employment
or grant permissions. Recovery continues to use the account email. Migration
`20261008010000_registration-identity` adds nullable names/Workday ID without changing
existing accounts or progress; it must run before the new authentication code.
Existing pass-code users choose **Login → Already have a pass code?**
to verify their old code and set a password once, retaining their learner ID and progress.

Migrations `004_registration-catalogue` and `005_seed-primark-courses` add the schema
and the 34 draft placeholders from the reviewed spreadsheet. They preserve all existing
courses, learners and progress. Re-running the seed skips existing source course IDs.
The original titles, English titles, languages, categories, source IDs and historical
assignment counts are retained. Historical counts do not create learner assignments.

Migration `20261010030000_course-expiry-import` applies the supplied
`course_entitlements-primark.xlsx` renewal periods: 34 one-year and 18 two-year
source rows. The retained mapping is `data/imports/primark-course-expiry-2026-10-10.json`.
All 34 originally imported courses match by their stable source IDs, including
renamed titles. The remaining 18 titles are matched only by an exact trimmed,
case-insensitive title if present. Missing titles are reported in migration notices
and are not created. Ambiguous matches abort the import. Only the renewal period,
edit revision and update timestamp change. Existing certificates keep their issued
expiry; future certificates expire 12 or 24 calendar months after completion.
The Italian induction remains one year and Irish manual handling remains two years,
as specified in the spreadsheet. `node tests/course-expiry-import-check.mjs` checks
the import, unchanged evidence and new certificate expiry.

Admin **Course library → Course details** separates country library availability from
direct audience assignments. The imported English induction (source ID 154) is the
English fallback. Local initial inductions are linked to Germany, Spain, France, Italy,
the Netherlands, Portugal and the USA. Refresher and harassment courses are not initial
induction routes. Other explicit country markers are prefilled. English titles without
a country marker stay **Country availability not set** for admin review. These country
links are editable; language selection alone never changes a learner's country.

All placeholders remain drafts until a trusted SCORM ZIP is uploaded and published.
New `safety` registrations receive the ready, published induction for their country,
otherwise the ready, published English fallback. Assignment is retained once selected
so publishing another version does not move an existing learner or lose progress.
If neither is ready, the account shows an induction-pending message and receives the
first matching published course when My Courses is opened. New safety-code accounts
see assigned courses rather than the older prototype sample chapters.

Under **User access**, platform admins can choose **Store Manager** and a store.
This grants store reporting plus **My store**: its user list, published courses available
in that country, and assignment of one/many courses to selected users or all users
currently registered in that store. This does not auto-assign future users. Assignments
are idempotent, enforced on the server and retained when manager access is revoked.
Reporting-only roles do not gain course assignment rights. Course publishing, country
availability and permission management remain platform-admin actions.

### Release and rollback

Apply both new migrations in order through the normal Netlify deployment before the
new server code serves requests. No SCORM assets are seeded, and no existing course is
republished or retargeted. Upload/publish the fallback and country inductions as the
course files become available; draft placeholders are visible only to platform admins.

The verification suite covers registration, old-code migration, country fallback,
preserved induction assignments, manager boundaries and SCORM resume. Rollbacks must
retain the added tables/columns and password hashes. An old application build cannot
sign in newly created password-only users; use a forward fix or disable registrations
while restoring the current authentication routes. Do not reverse/drop these migrations.

### Shared login and stable reporting

The home-page Login tab accepts learner, manager, reporting-admin and platform-admin
credentials. The original platform admin continues to use the server-configured password
and a separate secure session. Additional platform admins use their registered account's
password and an explicit server-side grant; a learner with the same email as the original
admin never inherits admin rights.
Old `/admin/sign-in` links redirect to the Login tab, preserving a safe return path.
Opening the profile or returning to the browser rechecks permissions without clearing
the dashboard when access is unchanged. Actual scope/filter changes still reload reports.


### Course cover images

Assigned course tiles and the Manage courses list use the same shared subject mapping
in `lib/course-covers.ts`. All 34 imported records are mapped, including their language
and country variants. Category takes precedence; English/original title matching supports
older uncategorised uploads, with the induction image as a fallback. This is a presentation
change: there is no migration, publishing, assignment or learning-record update.

| Category | Cover | Origin |
| --- | --- | --- |
| Induction | Colleagues walking through the store | Existing |
| Manual Handling | Stockroom trolley teamwork | Existing |
| Dignity at Work | Inclusive colleague conversation | Existing |
| Workplace Violence Prevention | Colleagues discussing observations | Existing |
| Fire Safety | Fire warden briefing | New |
| Emergency Response | Calm evacuation drill | New |
| Equipment Safety (Baler Safety) | Briefing beside a closed baler | New |
| Night Work | Evening handover in store | New |

The other four existing covers remain available for data protection, accessibility,
safeguarding and code of conduct courses. `components/course-cover.tsx` uses Next Image
with responsive sizes, lazy loading, reserved space and a blur placeholder. The four
new WebP assets together are approximately 458 KiB; generated source prompts and the
reference asset are recorded in `docs/course-cover-prompts.json`. Images are decorative
because the course title immediately identifies each tile/row. Course details previews
the cover as its category is edited. Existing prototype sample covers are unchanged.

## Admin-only accounts (v1.08.10.26.14)

An account with a platform, reporting or store-manager grant is admin-only. This is
derived from its current grants, so existing admins change without a data migration.
Admins land on Reporting, including when following old My Courses links or clicking
the logo. Personal course launch/save, original lessons/assessment and personal
certificates are blocked on the server. Platform course previews remain unrecorded.
Previous learning evidence is retained; active reports, exports, matrices, direct
audiences and bulk assignments exclude admin accounts. Removing all grants makes an
account a learner again; it does not erase or transfer historical completions.

Every admin has **Manage Users → Add user**. Choose Learner or Admin only, enter the
name/email and an initial password (8–128 characters for learners, 16–128 for new
admins). Learners can also have a Workday ID. No email is sent by account creation;
the creator provides the credentials through their normal onboarding process. The
existing forgot-password flow remains available. Account creation and the admin
grant are one transaction, and the grant records the creating admin.

Store admins can create learners or store admins in their store; country admins can
create learners, store admins or country admins in their country; organisation admins
can additionally create organisation admins. Only platform admins create platform
admins. Country and organisation admins can edit existing grants within their permitted scope. Store-admin creation includes store management
and store reporting. Country/organisation reporting roles retain their existing
reporting scope; they do not gain course publishing or course assignment rights.
The user directory is searched on the server and paginated in groups of 25.

Verification includes role/scope escalation attempts, CSRF, duplicate identifiers,
normal login, personal-learning denial at every admin level, bulk assignment
exclusion, promotion during an active course, retained historical certificates,
and immediate permission revocation. Existing reporting fixtures now use separate
admin and learner accounts, matching the new account model.

### Reporting overview and User activity

Reporting opens on **Overview**. Its API response contains aggregate counts, monthly
completion totals, store/country breakdowns and course options, without employee or
individual training rows. Counts and dates retain their previous meanings; searching
for a person does not change dashboard totals. Aggregation now runs in PostgreSQL.

**User activity** sits beside Overview and the store-only Site matrix. It opens with
an empty search prompt. Search is case-insensitive by name, email or Workday ID;
only matching users' course records are fetched, 25 per page. Category, course and
location filters apply. Search input is debounced, obsolete requests are cancelled,
and changing scope or filters resets pagination. No training-data request is made
for an empty search. All views enforce the same admin permissions and learner-only
exclusions on the server. Search treats punctuation literally.

The Site matrix loads its detailed rows only when selected and the API requires a
store scope. CSV exports explicitly fetch the selected scope/filter (all matching
activity results, not just the current page). Historical LMS details are fetched
only for an export or the store matrix; Overview receives historical totals only.
Issued certificate expiry, pinned induction, paused-course evidence and current
SCO completion rules share one reporting query. Migration
`20261008110000_reporting-scope-index` adds a store lookup index without changing data.

Checks cover search scope, no initial results, 25-row pagination across 1,000 matches,
aggregate/detail parity, filters, literal search, expiry snapshots, pinned courses,
missing dates, stale SCOs and revoked access. This is functional validation, not a
production-scale load test.

### Scoped user management and archiving

Manage Users has **All users / Learners / Admins** views, with server-side search
and 25-user pages. Country admins can filter stores in their country; organisation
and platform admins can filter countries and stores. Account status switches
between Active and Archived. Assign courses remains available to store managers
and platform admins as a separate action beside Add user.

**Edit access** is available on each permitted active account for country,
organisation and platform admins. Country admins can assign learner, site reporting,
store manager or country access within their country. Organisation admins can also
assign organisation access. Only platform admins can grant platform access. A
lower admin cannot manage a wider or foreign grant just because the account's
home store happens to be within their scope. Self-changes are blocked. Changing
access ends the user's sessions and requires a fresh sign-in; progress and issued
certificates are retained. A learner or store role requires a valid store.

All admin levels can **Archive** and **Restore** permitted accounts in their scope,
including peers at the same level, excluding themselves and the configured
bootstrap identity. Archiving preserves grants, assignments and learning evidence,
but immediately blocks login, password recovery, existing sessions, learner SCORM
launches and new course assignments. Archived users are hidden from active user
lists and course assignment pickers. Their training records remain in historical
reporting and are marked Archived in the activity and matrix views. Restoring
retains the previous role and credentials without reviving old sessions.

The API rechecks authority inside a transaction, locks actor/target identities,
rejects stale editors and writes a before/after audit record for each access,
archive or restore action. Migration `20261008120000_user-archive` adds nullable
archive metadata and the audit table; no existing user is archived by deployment.

### User details and admin password reset

All admin levels can use **Edit details** for active users within their scope,
excluding their own account and the configured bootstrap identity. Name and email
changes retain the same user ID, roles, assignments, progress and certificates.
Email changes revoke sessions, SCORM launches and old reset links; name-only changes
keep sessions active. Email addresses are normalized and duplicates are rejected.
Stale editors and scope changes are rechecked inside the locked transaction.

**Send password reset email** appears inside Edit details. Save any edits first;
the reset always uses the stored email, never a client-supplied recipient. It uses
the existing single-use, 30-minute recovery links and requires
`POSTMARK_SERVER_TOKEN`, `POSTMARK_FROM_EMAIL` and an HTTPS `PRIMARK_APP_URL`.
Missing configuration or failed delivery displays an error, never a sent confirmation.
Sending is rate-limited per recipient and administrator and does not change the
password or sign the user out until they complete the reset. Both details changes
and successful reset requests are audited without passwords or reset tokens.
Migration `20261008130000_user-details-audit` extends the existing audit action
constraint; it does not change existing accounts.

Edit details also allows admins to correct or clear the optional **Employee ID**
(the existing Workday ID used for login). Leading zeroes are preserved; IDs are
trimmed, uppercased, validated and protected by the database uniqueness constraint.
ID changes invalidate sessions and reset links, are included in revision checks and
are audited. Training records remain associated with the same account.

### Scoped store setup

Organisation is available to platform, organisation and country admins. Country
admins see and manage only their assigned country; site admins cannot access store
setup. Platform and organisation admins choose existing countries or explicitly
add a new country with its first store. Existing stores can be filtered by country
and searched by name, country or optional unique store code. Archive and restore
retain codes and account associations and preserve training history.

An optional store admin email creates a Store Manager account with site reporting
and user/course management in the same transaction as the store. An existing email
is rejected with a Manage Users instruction; no existing account is silently moved
or promoted. The optional initial password needs 16–128 characters. Without one,
a random unknown password is hashed and the UI explains that email recovery must
be configured before password setup; no email is sent during store creation.
Administrator addresses are returned only by the authorised organisation endpoint.
The associated email follows later account email corrections.

Migration `20261008140000_store-setup` adds nullable store codes and an admin account
reference, preserving all existing stores. Store codes are unique without regard
to case. Mutations recheck authority inside a transaction and record the actor.

### Assignment visibility and duplicate feedback

Manage Users → Assign courses shows Already assigned on course rows for a selected
learner, or a count for several learners. User rows show how many selected courses
they already have. The preview distinguishes new and existing assignment pairs;
Assign courses is disabled when no new assignments are needed. Successful saves
refresh assignment badges while keeping the chosen users.

The API counts actual inserted rows, skips duplicate manual assignments and
existing audience/induction access, and distinguishes any targets that became
unavailable. Original assignment dates, progress and certificates are preserved.
No assignment emails are sent.

### User creation and login dates

Manage Users shows each account’s existing creation date (`entered_at`) and latest successful sign-in date, in the selected interface language. The nullable `last_login_at` field is updated atomically when creating a learner/account session, including registration and legacy password setup. Failed logins, page views, password recovery and logout do not update it; logout and account archival preserve it. Learner, store, country, organisation and granted platform-admin accounts use this tracking. The hosting-configured bootstrap admin has no user-list record. Existing accounts show “No login recorded” until their next successful sign-in, because historical sign-in dates were not stored. Login timestamps do not change the user edit revision.

### Store credits and fiscal period reporting

Migration `20261008160000_period-credits` starts credit accounting at deployment.
Existing assignments, audience access and pinned inductions are retained without
retrospective charges. New assignments consume one credit immediately; duplicate
requests preserve the original assignment date and do not charge again. Default
pricing is EUR 3.25, snapshotted on each assignment.

Manage Users → Assign courses shows the store balance and current/removed
assignments. Store Managers and platform admins can remove a current assignment
within 336 hours, with a required reason. Only unstarted, billed assignments return
a credit and reverse their original charge. Any SCORM launch counts as a start,
even at zero seconds. Removal retains audit details and training evidence. Renewing
a certificate from 30 days before expiry creates a separate assignment; cancelling that renewal
restores the previous progress and certificate, including its original expiry.
Old launch tokens cannot write into a restored or replacement assignment.

New stores receive 100 credits, or 300 for United States stores. The hourly Netlify
scheduled function restores active stores to that allowance at each accounting
period start, retaining any surplus and recording each top-up once. Assignment
creation also catches up missed scheduled top-ups. A platform admin can replenish
a store early through Reporting → Period report → Credit settings with a store
selected. If no credits remain, a new assignment is rejected atomically; no partial
bulk charge or partially registered learner is committed.

Reporting → Period report defaults to the last completed period (the current
period before the first close). The seeded 2026/2027 calendar runs from 13 September
2026 to 18 September 2027: thirteen periods, with week 53 included in Period 13.
Dates and top-ups use Europe/London. The report includes every store in the chosen
reporting scope, including zero-activity stores, with country and overall totals.
Assignments and completions are grouped by assignment period; completion status is
measured at period end. Refunds are recorded in the removal period at the original
price, so a later period can have a negative net charge.

Only platform admins receive price/value fields, including in API responses and
Excel exports. The platform export has an optional yellow EUR unit-price override
in B4 and formulas for values/totals; leaving B4 blank retains recorded prices.
Changing the workbook does not change accounting data. Credit settings supports
prospective price changes and adding a future 13-period calendar, optionally with
week 53. Add the next fiscal calendar before the current one ends so automatic
top-ups continue. The scheduled function runs on the published deployment; deploy
previews do not run it.

`node tests/credits-check.mjs` checks migration preservation, immediate charging,
refund boundaries, renewal restoration, stale launches, top-ups, fiscal dates,
zero-activity stores, reconciliation, role restrictions and Excel price isolation
in an isolated PostgreSQL-compatible database.

### Quarter, year-to-date and store inactivity reporting

Version 1.08.10.26.25 adds Q1 (P1–3), Q2 (P4–6), Q3 (P7–9) and Q4
(P10–13) to the period selector. Dates come from the configured accounting
calendar, including week 53. Financial Year to Date ends today in Europe/London;
for a previous financial year it ends on that year's final day. Future years do
not offer a year-to-date range. Current ranges stop at the report generation time.

Country and overall totals use explicit numeric alignment. Desktop tables wrap
headings and store names into fixed-width columns; mobile retains horizontal
scrolling. Stores with zero assignments show days since the last recorded
assignment beneath their name. Hover, keyboard activation or tap reveals its exact
date and time. A store without recorded history shows “No recorded assignments”.
Removed assignments and preserved pre-billing assignments remain part of this
activity history. Historical inactivity uses the range's final date, never newer
assignments; current inactivity uses today's London date (calendar days, including
DST changes).

Search and the zero-assignment filter update the figures and totals shown. “Longest
inactive first” sorts across countries, omits intervening country subtotals and
places unknown history after measured inactivity. Excel respects these filters and
ordering, includes last-assignment dates/day counts, and preserves platform-only
pricing and editable value formulas. No database migration is needed.

### Course expiry warnings, resets and refreshers (v1.10.10.26.40)

A learner's course tile shows the days remaining during the final 30 days of a
certificate's validity, then an expired warning. **Restart course** confirms the
one-credit charge, creates a new assignment and clears current SCORM progress.
The old completion date, certificate, score, saved answers and learning time stay
in the assignment history. Previous certificates remain available on the tile and
in My Certificates. Requests check the current learner and certificate under the
same lock as assignments and SCORM; retries cannot renew the same attempt twice.

Platform admins configure **Manage courses → Course details → Refresher courses**
with one linked course per country. Countries without a rule use learner-initiated
renewal. The migration seeds original course ID **154 → 209** for **United Kingdom**
and **Ireland**, and makes the refresher available in those country libraries if
its library availability was previously unconfigured. It does not publish content.

A published, validated refresher is assigned automatically at 30 days before expiry
(or on catch-up after expiry), consuming one credit. Existing unfinished or valid
refresher assignments are reused without another charge; an expiring refresher gets
a new attempt with its own preserved history. The original induction remains in the
record, and its tile links to the refresher. Completing the refresher clears the
original course from the learner's to-do view without changing its old certificate.

The `course-refreshers` scheduled function runs every 15 minutes in UTC on the
published deployment. Opening My Courses also checks that learner. Processing is
bounded to 100 certificates / 20 seconds per invocation, with a separate transaction
per certificate and a durable link preventing duplicate assignments. Missing credits
or unpublished content remain pending and retry after 15 minutes. A manager's removal
is respected; an automatically assigned refresher is never resurrected by a retry.
No assignment emails are sent. Pending tiles direct the learner to their Store Manager.

`node tests/renewals-check.mjs` covers expiry boundaries, access checks, history,
charging, country rules, retries, removals and the learner/configuration APIs.
