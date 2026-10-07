# Certificates and renewal

Course details now offers **Renewal frequency**: no expiry, 3/6 months, 1/2/3 years or a custom 1–120 months. This uses the existing `validity_months` field.

A certificate is issued only after every launch item in the SCORM package reports `passed` or `completed` with a completion timestamp. Previews cannot issue certificates. The latest required lesson completion becomes the course completion date. Expiry adds calendar months in UTC, clamping to the last day of the month for month-end/leap-year dates. The expiry instant is the same UTC time of day as completion.

Issued records retain the learner name, site/country, course title, package/revision, completion date and renewal policy at issue time. Editing the catalogue cannot rewrite them. Repeat saves are idempotent. Old package certificates remain available in My certificates after pausing, removing an assignment or replacing a package. Reporting uses the stored expiry for the current package; reviewing an already completed course does not erase its certificate.

Learners can open **My certificates** from My Courses, view a course certificate and print/save a PDF. The authenticated certificate page only permits its owner. Public QR verification uses an unguessable token, exposes name/course/dates/status, omits contact details and is marked noindex. Certificates show Valid, Expiring soon (30 days) or Expired; the Site Matrix continues its existing Completed/Expired statuses using the same dates.

## Migration and release

`20261007210000_certificates` adds the certificate store and issuance function. It backfills complete SCORM packages, including older package versions, from their actual completion timestamps using the course metadata/policy available at migration time. It cannot reconstruct historical metadata edits that were never recorded. Existing Safety Passport certificate tokens and completion dates are preserved with no expiry. Imported legacy-completion rows without full course evidence do not gain invented certificates.

The migration is tested using in-memory PostgreSQL, including month-end and leap-year fixtures. No live database migration has been run as part of development. Apply the migration before serving this code, using the normal Netlify database release flow, once production release is approved.

## Next phase

Renewal frequency currently determines certificate expiry. It does not reset progress or automatically enrol learners again. Next steps are a fresh renewal attempt with retained certificate history; learner/manager reminders; and audited certificate revocation/reissue. Do not reset existing progress or replace course packages merely to renew one learner. Certificate headings currently use English; course titles retain their original language.
