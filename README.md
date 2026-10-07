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
5. Open `/admin/sign-in`, create a course, upload a SCORM 1.2 ZIP, select its audience
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

Admin access uses the server-configured email/password, not learner registration or headers
from the old host. Admin sessions last eight hours, are stored as hashed tokens in Postgres,
and are revoked by logout or changing the configured credentials. Login attempts are rate
limited. Never put real admin credentials in committed files or `NEXT_PUBLIC_*` variables.

Platform admins assign Store Manager and reporting roles under User access at `/admin/reporting-access`. Select an existing
learner account, choose Site, Country or Primark reporting admin, then save. Reporting
admins use their learner email and password and can view/export only the assigned
scope. Only platform admins can create or publish courses, import historical completions, load sample
records, use the shot list or assign/revoke access. Store Managers can assign published courses in their country to existing store users. Choose Learner only to remove reporting access.

Signing into a learner account revokes the current platform session; platform sign-in
revokes the current learner session. Browsers with both old cookies default to learner
permissions until the user signs into the platform account again. Reporting grants and
revocations are checked on each request; refresh or revisit the tab to update the menu.

The top-right profile icon contains name, role, site, sign out and permitted views.
Reporting admins can switch between the reporting levels and sites within their assigned
scope. Platform admins can also reach course management, reporting access and the shot list
from this menu. The header displays the Primark logo; Safety Passport stays in learning.

Production uploads survive deployments. Preview branches write to separate blob stores;
they may read immutable production files referenced by their copied database. Build-time
context is embedded by `scripts/build-context.mjs`; it contains no secrets.

SCORM packages execute JavaScript. Only upload trusted authoring-tool exports. The existing
same-origin frame support is retained because many SCORM 1.2 players require it.

Password recovery by email and approved final learning content remain separate launch tasks.
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

Registration accepts `safety` without case sensitivity (surrounding spaces are ignored).
The code is an enrolment code, not a password or an admin permission. Passwords are
8–128 characters and stored using individually salted scrypt hashes. Login uses email
and password. Existing pass-code users choose **Login → Already have a pass code?**
to verify their old code and set a password once, retaining their learner ID and progress.

Migrations `004_registration-catalogue` and `005_seed-primark-courses` add the schema
and the 34 draft placeholders from the reviewed spreadsheet. They preserve all existing
courses, learners and progress. Re-running the seed skips existing source course IDs.
The original titles, English titles, languages, categories, source IDs and historical
assignment counts are retained. Historical counts do not create learner assignments.

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
