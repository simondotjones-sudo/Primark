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
surname, email, required Workday ID, a searchable store and a password. Country is derived
from the selected active store. The form keeps entered details when moving back or after
an error, uses **Get Started**, signs in immediately and opens the assigned published Safety Induction course. If no induction is flagged and ready for their country (or the default), it opens My Courses. New registrations do not receive a legacy login code.
The compact layout fits the first viewport on desktop and small phones, with natural
scrolling retained for zoom, an open keyboard and longer validation messages.

Registration accepts `safety` without case sensitivity (surrounding spaces are ignored).
The code is an enrolment code, not a password or an admin permission. Passwords are
8–128 characters and stored using individually salted scrypt hashes. Login uses email, Workday ID or the retained legacy access code with the same password. Workday IDs preserve leading zeroes, ignore case
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

## Legacy login and email completion

Migration `20261010050000_legacy-login` allows historic learners with no email, adds
`learners.legacy_access_code` and marks restricted email-completion sessions. Import
original codes into this nullable field alongside the original account; no codes
are generated or fabricated. Existing `code_hash` values cannot be reversed for
display. A verified first-password setup retains the supplied old pass code.
Manage Users shows the legacy code read-only, including for historic users; updates
from the Edit User API cannot change it.

Password login supports email, Workday ID and legacy access code. An ambiguous
imported identifier is rejected. Accounts without an email receive a 15-minute
restricted session and must supply a unique email before using learning or admin
features. Email uniqueness ignores case and surrounding whitespace and includes
archived accounts. The database enforces uniqueness for simultaneous requests.
Saving the email preserves learner identity and learning history and replaces
all prior sessions. This collects an address; it does not verify mailbox ownership.

### Organisation learning controls (October 2026)

`20261010060000_learning-controls` adds settings for this deployment's client
organisation. This application still has one organisation per deployment; these
controls do not introduce shared-database multi-tenancy.

- Platform admins can switch credit charging on/off under Organisation settings.
  Off permits new assignments and renewals with no balance or charge; history,
  prior charges and eligible refunds remain intact. Automatic top-ups pause while
  off. Re-enabling does not bill assignments made while off. The Period report
  remains a billing report; unbilled learning appears in training reporting.
- Platform/organisation admins can enable the three-year inactivity rule; it is
  off initially. The hourly job processes at most 500 inactive learner accounts,
  retaining training evidence and audit entries while revoking sessions. All
  admin roles are excluded. Unknown historical logins start their observation
  window at migration; manual restore starts a fresh window. No accounts are
  archived by the migration itself.
- Platform admins can set an optional 1–3,650 day assignment deadline and add
  a 1–50 question, single-answer multiple-choice quiz with a 1–100% pass mark.
  Both are snapshotted on new assignments, including renewals. Existing
  assignments retain their existing requirements and issued evidence.
- Quiz submission requires completed lessons, an active learner and the current
  assignment. Correct answers are never in learner responses. Attempts and scores
  are retained, repeated submissions are idempotent, and retries use no credits.
  The certificate function requires the assignment's quiz pass. Reports do not
  count lesson-only completion as course completion where a quiz is required.
- Compliance defaults to excluding unfinished assignments before their deadline.
  Organisation admins may select strict counting instead. No-deadline work counts
  immediately; expired certificates do not get grace from a renewal/refresher.
  A still-valid previous certificate continues to provide compliance until expiry.
  Active replacement refreshers replace the source requirement once in the score;
  original evidence remains available in activity, certificates and exports.
  Archived users and admin-only users are excluded from current compliance.
- Compliance is valid completions divided by assessed requirements, with separate
  within-deadline counts and matching country/store rollups. Green is at least 90%,
  amber is 50% to below 90%, red is below 50%, and no assessed requirements is grey.
  Display percentages are truncated to one decimal so rounding never crosses a
  RAG threshold. Existing assignment status indicators continue to show status.

Validation: `npm test`, `npm run typecheck`, and `npm run build`. New integration
coverage lives in `tests/learning-controls-checks.mjs` (run by course-check), with
isolated PostgreSQL assertions for permissions, credits, immutable requirements,
quiz/certificate gates, reporting, linked refreshers and inactivity archiving.

## Release 1.10.10.26.46 — practical assessor sign-off

- Platform admins can require practical sign-off in Course Library or Assessor settings for this deployment's client organisation. Requirements are snapshotted for new assignments; existing assignments and certificates are unchanged.
- Assessor is an additive permission for existing accounts. External assessor-only accounts cannot learn or administer users. Authorisations specify course, all organisation sites or one site, qualification reference and optional expiry. Add multiple grants for multiple sites/courses; disable old grants to withdraw access.
- Assessor page lists theory-complete learners and retained assessment attempts, with learner/course/site filters. Record Pass or Not yet competent, assessment date, declaration and notes/evidence references. Unsuccessful attempts require a reason, and reassessment uses no course credit. Evidence is recorded as notes/references in this release, not uploaded attachments.
- Database checks reject self-assessment, expired/out-of-scope authorisations, incomplete theory, invalid dates and duplicate passes. A pass issues a certificate with the assessor identity snapshot and assessment date. Validity starts on the practical assessment date (UTC). Recording timestamp remains separate.
- Theory-complete learners stay outstanding in compliance reporting, subject to the existing deadline/grace policy. Platform admins can revoke a sign-off with a reason; the certificate/QR is marked revoked and the assignment awaits reassessment. History is retained.
- Before enabling a course, agree its practical assessment criteria and authorise the qualified assessors. This workflow records competence decisions; it does not validate qualifications against an external register.
- Assessment interface copy is included in all supported languages; evidence uploads are follow-up work. Pending/history views show up to 1,000 records.
- Migration `20261010080000_assessor-signoff` runs through the existing Netlify database deployment workflow. `tests/assessor-check.mjs` exercises the actual APIs and PostgreSQL procedures with isolated data, including reporting and learner certificate gating.

## Release 1.10.10.26.49 — Learning Pathways

- Platform admins enable **Learning Pathways** in Organisation settings. Organisation and platform admins then use **Learning Pathways** in the profile menu to create/edit/archive named programmes and assign them to selected learners. The current deployment holds one client organisation, as with all existing organisation settings.
- Course ordering uses stages: any order, strict sequence, first course then any order, or custom stages. The server enforces these requirements on launches, SCORM saves/content and quizzes, including links opened outside My Pathways. Conflicting prerequisite cycles across shared pathways are rejected atomically.
- Assign up to 100 selected active learners at once. Published course availability is checked for every learner's country. Reuse current assignments and valid completions without duplicate credits. New/expired course assignments use existing credit and renewal rules; configured refresher requirements are not bypassed. An unavailable course, insufficient credits or invalid learner rolls back the entire batch.
- Each enrolment snapshots the name, course list/order, certificate option and version. Editing or archiving a template never changes existing enrolments. Reassigning the same pathway is idempotent; repeat pathway enrolments/annual pathway renewal are not part of this release.
- Deadlines use days from assignment or a fixed assignment date (end of day Europe/London). Earlier existing course deadlines remain earlier. Course assignments required by an unfinished pathway cannot be removed; there is no pathway cancellation/refund action in this release.
- **My Courses → My Pathways** displays staged courses, progress, due dates and assessment status. Pathway completion requires every course's recorded completion, including quizzes and practical sign-off. Optional additional pathway certificates can be viewed and printed/saved as PDF by the learner or authorised reporting admins. Certificate records snapshot the learner name and completed course titles; access is authenticated and reporting-scoped.
- Reporting adds **Pathway completion** only while enabled, with country/store scope, pathway/status/learner filters, overdue flags, course drill-down, aggregate completion percentages and CSV export. Archived learners and admin-only accounts are excluded. Existing learner pathways stay available and ordered when the feature is disabled; new creation/assignment stops.
- Course expiry is shown separately without erasing historical pathway completion. Explicit assessor revocation withdraws the affected pathway award. Unfinished course requirements follow replacement course attempts. Certificates for individual courses are unchanged.
- Additive migration: `20261010100000_learning-pathways`; leaves the feature off until a platform admin enables it. Tests: `node tests/pathways-check.mjs` (real migration and API integration tests against isolated PGlite), existing regression suite, translation checks, TypeScript and production build.

### Release 50 — course versions, employee lifecycle and audit trail

- Published course changes create immutable numbered versions. Each assignment pins its package, title, quiz, assessor requirement, validity and version. Existing learners continue their assigned package; certificates and compliance reporting use that evidence. Catalogue categories/country availability and editorial counts for an unchanged package remain editable.
- Course details includes a version reason and an explicit retraining option. Publishing with retraining replaces active learner assignments, retains earlier certificates and progress evidence, and charges the normal course credit where credits are enabled. A failed charge rolls back the publication and all retraining assignments. A retry with the old course revision is rejected. Completed pathways remain historical achievements; unfinished pathway requirements follow the replacement assignment.
- Published version history lists date, publisher, reason and current assignment count. The migration captures a baseline; it cannot reconstruct course edits or administrative events that were never recorded before rollout. Older assignments with a different package have no inferred version number.
- Manage Users supports joiner start dates, Transfer, Mark as leaver and Rejoin. These actions apply immediately, with a recorded effective date and reason; future scheduling and Workday integration are not included. Country admins can act only inside their country; an organisation/platform admin handles cross-country moves.
- Transfers preserve existing assignments/certificates and historical billing location, update current store/reporting scope, and apply destination audience/induction rules. Existing training is not automatically withdrawn. New assignments use normal credits. A missing credit balance rolls the whole change back.
- Leavers are archived and sessions, launch tokens and recovery tokens are invalidated. Rejoin restores the existing identity and learning history at the selected store as a learner; administrative and assessor permissions must be granted again. Store-level assessor grants are disabled on moves/leaving. Generic Archive/Restore remains available for administrative corrections.
- Organisation and platform admins have a searchable, paginated Audit trail with record-type and date filters and before/after details. Account lifecycle/access, course publishing, assignment changes, completion, certificates, practical assessment, pathway and organisation settings changes are captured transactionally. Existing user audit history is imported. No passwords, access codes, session tokens, certificate tokens, quiz answers or SCORM suspend data are stored in this audit.
- Audit events, published versions and assigned version snapshots cannot be rewritten through normal SQL updates. Database-owner disaster recovery remains outside the application audit UI.
- Validation: `npm test` includes migration-backed version/lifecycle/audit integration checks. `npm run build` validates the production bundle. Migrations are applied by Netlify deployment; do not apply the migration directly to the hosted database.

### Release 51 — automatic pathway assignment rules

- Organisation and platform admins can enable an automatic rule on each pathway: all active learners, selected countries, or selected stores, optionally filtered by employee start-date range. Blank dates include unknown start dates; date filters exclude unknown dates. Future starters are eligible on their start date.
- Saving applies rules to matching existing learners. Registration, moves/rejoins and normal assignment synchronisation evaluate rules again; a scheduled function also checks every 15 minutes, including offline learners and retries after credit top-ups. Admin-only and archived/leaver accounts are excluded.
- Existing enrolments are never duplicated or removed by rule changes. Pathway course order, deadlines, assessment/certificate requirements and assignment snapshots remain intact. Valid existing course attempts are reused; expired attempts renew through the existing credit pipeline.
- Each learner/pathway is atomic: unavailable courses, insufficient credits or cyclic prerequisites roll back the entire pathway and its charges. Administrators see failures and can retry immediately. Other successful assignments remain saved. Disabling/archiving a rule stops new assignments and retains existing evidence.
- Rule changes and generated enrolments appear in the audit trail. No rules are enabled by this migration. New interface labels are translated across the existing 14 languages.
- Additive migration: `20261010120000_pathway-rules`. Migration/API integration coverage includes targeting, joiners/movers, duplicate prevention, credit rollback and retries.

### Bulk learner import and updates — release 1.10.10.26.52

Organisation and platform admins: **Manage Users → Bulk learner import**. Download the CSV template, choose create-only, update-only or create-and-update, upload, review every proposed change and then Apply import. Up to 200 learner rows / 500 KB per file. Export a password-free results CSV to fix errors or retain the review.

- `workday_id`: required stable matching key, case-insensitive, leading zeroes preserved. Format this and store codes as **Text** in Excel before saving as CSV. An email belonging to a different Workday ID is rejected, never used to merge accounts. Change incorrect Workday IDs individually in Edit details.
- New learners: `name`, unique `email`, active `store_code`, and an individual `initial_password` (8–128 characters) are required. Optional `start_date` defaults to today. No invitation emails are sent; administrators distribute initial credentials securely. Existing learners must leave `initial_password` blank; passwords are never updated by import or included in previews/results/audit.
- Existing learners: omitted/blank fields retain their saved values. Supports name, email, store and employment start-date updates. It cannot clear fields, modify legacy access codes or grant admin/assessor permissions. Admin-only accounts are rejected.
- `status`: blank or `active` for new/existing active learners; `leaver` disables access; explicit `rejoin` restores an archived learner. A changed store code transfers the learner. Transfers/leavers/rejoiners require `effective_date` and `reason` (3–500 characters). Dates are `YYYY-MM-DD`, no later than today; changes apply immediately. Rejoining sets the employment start date to its effective date. A leaver cannot be transferred in the same row.
- Every row must pass validation. Any database failure rolls back the whole batch, including audit and assignment changes. Concurrent learner/store changes invalidate the preview. Reapplying an old preview is rejected.
- Existing training and certificates remain intact. New and changed active learners run the existing induction, audience and pathway assignment rules. Credits apply under existing configuration. Pathway failures are surfaced in the completion message and remain available for the existing retry process.
- The existing immutable audit captures actor, time, before/after values, batch reference, row and lifecycle reason. No schema migration is required.

Validation: `node tests/learner-import-check.mjs` uses an isolated PostgreSQL-compatible database and all current migrations; no live learner data is changed.


### Email notifications and invitations — release 1.10.10.26.53

Organisation and platform admins: **Profile → Email notifications**. The migration
starts in **Off** mode. **Preview** displays branded HTML/plain-text examples using
fictional data; it never contacts Postmark, creates invitation tokens, or writes the
live outbox. The controls are translated into the existing 14 interface languages.
New learning notification templates are initially in English; password recovery
retains its existing language-specific text and now includes branded HTML.

Prepared email types:

- Course-certificate reminders **30, 14 and 3 days before expiry**, followed by one
  **expired** notice. The issued certificate expiry is authoritative. Starting a
  renewal does not silence a still-relevant warning; completing a replacement or
  valid linked refresher does. Revoked certificates, cancelled assignments,
  archived learners and admin-only accounts do not receive these learner notices.
- Invitations for people without an account, followed by one reminder **48 hours
  after Postmark accepts the invitation**, only while they remain unregistered.
  Preparing an invitation does not create an account or send mail. Queue it
  explicitly after live email is enabled. The invitation fixes the email/store;
  the recipient supplies their Workday ID and password. Normal induction and
  pathway rules then apply. Links contain random tokens in the URL fragment;
  only hashes are stored, each link lasts seven days, and acceptance is atomic
  with registration. Cancellation invalidates outstanding links. If an invitation
  expires, cancel it and prepare a new one. Existing accounts cannot be invited
  as new users.
- Account-ready emails for newly admin-created/imported learners, and a separate
  first-sign-in reminder after 48 hours if they still have not signed in. These
  emails never include passwords; they link to Login/Forgot password.
- Course/pathway assignment emails, deadline reminders at **7 and 1 days**, a
  single overdue notice, certificate-ready emails and practical-assessment next
  steps after theory completion. Pathway assignment notices suppress duplicate
  course-assignment notices. Certificates remain gated by the existing quiz and
  practical assessment rules.
- A **Monday 08:00 Europe/London** summary for each active Store Manager, showing
  only their current store's overdue course assignments, certificates expiring
  within 30 days and courses awaiting practical assessment. The schedule follows
  London daylight-saving time. It is a scoped summary, not a configurable report
  scheduling product.

Admins can enable/disable types, edit expiry/deadline reminder offsets, and change
48 hours to another invitation/first-login delay (1–168 hours). Settings and
invitation actions are recorded in the immutable audit history. The delivery log
is paginated and records the actual recipient, attempts, provider message ID and
status, without storing message bodies or secret links. “Accepted by email
provider” does not claim delivery to the inbox; bounce/delivery webhooks are not
included in this release.

The scheduled function checks every 15 minutes, with a bounded batch and runtime.
A unique event key and atomic claim prevent repeated jobs from sending the same
notification. Eligibility is rechecked immediately before sending. Only explicit
rate-limit rejection is retried automatically, with backoff; timeouts, ambiguous
provider errors and interrupted sends are marked **Delivery uncertain** for
reconciliation in Postmark, never automatically resent. Permanent rejection is
recorded as failed. Reminder windows are 24 hours; new assignment/certificate
notices have a 48-hour window. Stale events are skipped, not backfilled. An
invitation's 48-hour reminder is measured from actual provider acceptance, not
when its draft was prepared. Re-enabling a type starts from that time; switching
modes cancels the previous queue and starts a fresh activation boundary.

#### Connecting Postmark later

1. Verify the sender/domain in Postmark and set `POSTMARK_SERVER_TOKEN`,
   `POSTMARK_FROM_EMAIL`, `POSTMARK_MESSAGE_STREAM` (normally `outbound`), and
   `PRIMARK_APP_URL` in the production Functions environment.
2. Keep `PRIMARK_EMAIL_DELIVERY=disabled` until ready for controlled delivery
   verification. Setting it to **`enabled`** and redeploying authorises the
   production transport, including password recovery. Deploy previews and local
   builds cannot send through it; `POSTMARK_API_TEST` is rejected for live use.
3. Review previews and enabled types; set **Email notifications → Live** when
   notifications should begin. Only events from this activation onward qualify.
   Prepared invitations remain drafts until individually queued. No test queue
   is promoted into live delivery. Turning notification mode Off stops automated
   notifications; the environment switch disables all application email,
   including password recovery.
4. Use controlled test recipients to verify real delivery and links before
   starting a wider invitation rollout. No external mail is sent by local tests.

Migration: `20261010133000_email-notifications`. Apply through the usual Netlify
release migration workflow. No hosted database changes are made during development.
Verification includes the complete regression suite, 17 additional migration/API/
worker integration checks, TypeScript, translation coverage and the production
build. A real Postmark delivery check remains part of activation.


### Release 54 — practical assessment evidence

Authorised assessors can attach photos or signed assessment sheets while recording a practical assessment. Up to five files are supported per attempt, each up to 3 MiB: PDF, JPEG, PNG, WebP and HEIC. File types are checked from their signatures, filenames are sanitised, and downloads use attachment disposition. Attachments remain optional; the existing outcome, date, declaration and assessor qualification rules still apply.

- Uploads are saved as private drafts for the individual assessor and assignment. Reopening the same learner’s assessment restores those drafts. Incomplete uploads can be removed and retried.
- Files are linked to the specific attempt in the same database transaction as the assessment and certificate. An upload in progress or an omitted draft blocks submission. Reassessment creates a separate evidence record and consumes no additional course credit.
- Assessment history includes evidence downloads for currently authorised assessors in the appropriate course/site scope and platform administrators. Learners, unrelated assessors and public certificate/QR visitors do not receive evidence access. Unattached drafts remain private to their uploader.
- Saved file metadata and attempt links cannot be changed or deleted through the application. Revoking a sign-off preserves its evidence. Draft removal deletes the uploaded bytes while retaining the audit record.
- Each file has a SHA-256 fingerprint, verified on download. Uploads, attachment to an assessment, and draft removal are recorded in the existing audit trail with learner, store and actor details.
- Evidence uses private Netlify Blobs stores, with separate writable production and preview namespaces. A preview may read immutable production files referenced by its database snapshot, but cannot overwrite or remove them.
- The additive `20261010141000_assessment-evidence` migration creates the metadata table and atomic sign-off function. No manual production data changes or additional email configuration are needed.
- All new interface and API validation messages are translated across the existing 14 interface languages. `tests/assessment-evidence-check.mjs` covers scoped access, file handling, storage failures, private downloads, atomic attachment, certificate/credit behaviour, immutability, revocation and preview isolation.

### Release 55 — organisation feature settings

Settings is now a dedicated administration page with 20 searchable features in five categories. Platform administrators choose Disabled, Optional or Required. Organisation administrators can change only Optional features. Other account roles cannot read or change administrative settings. A required dependent feature requires a required parent. Save uses the existing revision check and records both settings history and the main audit trail.

This deployment represents Primark only, as in the existing data model; no cross-client selector or shared multi-tenant database is introduced. Existing settings and email delivery mode are preserved. New capabilities default to Optional and retain their previous behaviour; pathways and automatic archiving retain their existing on/off values.

- Learning: pathways, automatic assignment rules, self-renewals and automatic refreshers.
- Assessments: adding/changing quiz and assessor requirements, new evidence uploads and certificates for new pathway enrolments.
- Learner management: bulk imports, transfers/leavers/rejoiners and automatic archiving.
- Communications: learning emails, assignment emails, registration reminders and expiry emails. Live sending still requires the email provider and live mode; enabling a feature alone never starts sending email.
- Reporting/compliance: recorded learning time, site matrix and training exports, period credit reports, credit charging and deadline exclusions.

Feature switches are enforced in the API and, for database-driven automation, SQL functions. Disabled email categories are checked again when dispatching; queued messages in those categories are cancelled when settings are saved. Messages already handed to the provider cannot be recalled. Required/disabled controls are locked for organisation administrators, including older settings forms.

Disabling quiz/assessor configuration never removes requirements from existing course assignments or silently issues certificates. Existing courses continue to impose their published requirements; the switch prevents adding new requirements. Existing assessments, evidence, SCORM tracking, certificates, enrolments and audit records remain available. New pathway enrolments respect the certificate feature; previously promised certificates still issue. Evidence uploads can be stopped while outstanding assessments and access to saved evidence continue.

Apply additive migration `20261010150000_feature-settings` through the normal Netlify release process. Development verification uses isolated PostgreSQL and mocked storage only. `tests/feature-settings-check.mjs` exercises administrator boundaries, disabled/optional/required policies, stale revisions, CSRF, parent dependencies, legacy settings, automation gates, queued mail cancellation and retained assessment holds.

### Release 56 — scheduled training reports

Email notifications → Scheduled reports configures the weekly store overdue report and monthly country compliance report. Each has its own local hour and IANA timezone; weekly reports use a weekday, monthly reports a day from 1–28. DST is handled by PostgreSQL. The existing email worker checks every 15 minutes. Reports are current snapshots at generation time, not previous-month historical snapshots.

Settings → Reporting & compliance now includes Scheduled reports, Weekly store overdue reports and Monthly country compliance reports. All use the existing Disabled/Optional/Required platform policy and optional organisation toggle. Scheduled reports depend on learning email notifications. Requiring a report enables its email template without activating live email. Switching a report off cancels its queued messages; eligibility, recipient permissions and feature gates are checked again at dispatch. The existing email mode and provider requirements remain mandatory. Monthly reports default off; weekly settings are preserved.

Weekly reports go to active store-manager accounts for their assigned store. They contain dashboard-aligned compliance/expiry figures, the count awaiting practical assessment, up to 50 overdue learner/course rows (oldest first), and a Reporting link. Monthly reports go to organisation and country reporting administrators, one email per authorised active country, with summary totals only. No arbitrary external recipient addresses are accepted. Archived learners/admins and inactive/deleted stores are excluded. Reports reuse the dashboard query rules, including deadline exclusions, assessor/quiz requirements, renewals and refresher replacement.

Organisation/platform administrators can preview current reports for a selected store or country without queueing or sending. Delivery results appear in the existing Delivery log; schedule changes enter the email and main audit trails. Period-specific durable event keys prevent duplicate sends; uncertain provider responses retain the existing no-auto-retry policy. Activation skips past scheduled runs; an eligible run has a 24-hour delivery window.

Apply additive migration `20261010160000_scheduled-reports` before running release 56. Isolated integration checks in `tests/email-notifications-check.mjs` and `tests/feature-settings-check.mjs` cover permissions, feature gates, schedule validation/revisions, DST, recipient scope changes, dashboard parity, preview safety, deduplication and dispatch revalidation. No live email is sent by these checks.
