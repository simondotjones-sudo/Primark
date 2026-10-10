-- New country reports start disabled; existing weekly delivery settings are preserved.
UPDATE organisation_settings SET features=features || '{"scheduled_reports":{"policy":"optional","enabled":true},"weekly_store_reports":{"policy":"optional","enabled":true},"monthly_country_reports":{"policy":"optional","enabled":false}}'::jsonb,revision=revision+1;
UPDATE email_settings SET enabled=enabled || '["country_digest"]'::jsonb,revision=revision+1;
CREATE TABLE scheduled_report_settings (
 kind text PRIMARY KEY CHECK(kind IN ('manager_digest','country_digest')),
 weekday integer NOT NULL DEFAULT 1 CHECK(weekday BETWEEN 1 AND 7),
 monthday integer NOT NULL DEFAULT 1 CHECK(monthday BETWEEN 1 AND 28),
 hour integer NOT NULL DEFAULT 8 CHECK(hour BETWEEN 0 AND 23),
 timezone text NOT NULL DEFAULT 'Europe/London',
 revision integer NOT NULL DEFAULT 1,
 updated_at timestamptz NOT NULL DEFAULT now(),updated_by text NOT NULL DEFAULT 'migration'
);
INSERT INTO scheduled_report_settings(kind) VALUES('manager_digest'),('country_digest');
CREATE OR REPLACE FUNCTION feature_enabled(key text) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE s organisation_settings%ROWTYPE; f jsonb; enabled boolean; parent text;
BEGIN
 SELECT * INTO s FROM organisation_settings WHERE id=1;
 f:=s.features->key;
 IF f IS NULL OR f->>'policy'='disabled' THEN RETURN false; END IF;
 enabled:=CASE key WHEN 'pathways' THEN s.pathways_enabled WHEN 'auto_archive' THEN s.auto_archive_enabled
 WHEN 'credits' THEN s.credits_enabled WHEN 'exclude_within_deadline' THEN s.exclude_within_deadline ELSE (f->>'enabled')::boolean END;
 parent:=CASE WHEN key IN ('pathway_rules','pathway_certificates') THEN 'pathways'
 WHEN key IN ('assignment_emails','registration_reminders','expiry_reminders','scheduled_reports') THEN 'email_notifications'
 WHEN key IN ('weekly_store_reports','monthly_country_reports') THEN 'scheduled_reports' END;
 RETURN (f->>'policy'='required' OR COALESCE(enabled,false)) AND (parent IS NULL OR feature_enabled(parent));
END $$;

CREATE FUNCTION scheduled_report_candidates(at_time timestamptz DEFAULT now())
RETURNS TABLE(event_key text,kind text,recipient_id text,invitation_id text,email text,payload jsonb,occurred_at timestamptz,ends_at timestamptz)
LANGUAGE sql STABLE AS $$
WITH schedule AS (
 SELECT s.*, (CASE WHEN kind='manager_digest' THEN date_trunc('week',at_time AT TIME ZONE timezone)+make_interval(days=>weekday-1,hours=>hour)
 ELSE date_trunc('month',at_time AT TIME ZONE timezone)+make_interval(days=>monthday-1,hours=>hour) END) AT TIME ZONE timezone AS due
 FROM scheduled_report_settings s
), recipients AS (
 SELECT 'manager_digest'::text AS kind,m.learner_id,m.store_id AS scope,COALESCE(s.name,m.store_id) AS label
 FROM store_managers m LEFT JOIN organisation_stores s ON s.id=m.store_id
 WHERE COALESCE(s.active,true) AND s.deleted_at IS NULL
 UNION
 SELECT 'country_digest',r.learner_id,s.country,s.country FROM reporting_access r
 JOIN (SELECT DISTINCT country FROM organisation_stores WHERE active AND deleted_at IS NULL) s
 ON r.scope='organisation' OR r.scope='country' AND r.country=s.country
)
SELECT CASE WHEN s.kind='manager_digest' THEN 'manager:'||r.learner_id||':'||to_char(at_time AT TIME ZONE s.timezone,'IYYY-IW')
 ELSE 'country:'||r.learner_id||':'||r.scope||':'||to_char(at_time AT TIME ZONE s.timezone,'YYYY-MM') END,
 s.kind,l.id,NULL::text,l.email,jsonb_build_object('name',l.name,'store',r.label,'reportScope',r.scope,'path','/?view=report'),s.due,s.due+interval '24 hours'
FROM schedule s JOIN recipients r ON r.kind=s.kind JOIN learners l ON l.id=r.learner_id CROSS JOIN email_settings e
WHERE l.archived_at IS NULL AND NULLIF(btrim(l.email),'') IS NOT NULL
 AND feature_enabled(CASE s.kind WHEN 'manager_digest' THEN 'weekly_store_reports' ELSE 'monthly_country_reports' END)
 AND e.enabled ? s.kind AND s.due>=GREATEST(e.active_since,COALESCE((e.enabled_since->>s.kind)::timestamptz,e.active_since))
 AND s.due<=at_time AND s.due+interval '24 hours'>at_time;
$$;
CREATE OR REPLACE FUNCTION learning_email_candidates(at_time timestamptz DEFAULT now())
RETURNS TABLE(event_key text,kind text,recipient_id text,invitation_id text,email text,payload jsonb,occurred_at timestamptz,ends_at timestamptz)
LANGUAGE sql STABLE AS $$
 SELECT c.* FROM learning_email_candidates_unfiltered(at_time) c WHERE c.kind<>'manager_digest' AND feature_enabled('email_notifications')
 AND (c.kind NOT IN ('course_assigned','pathway_assigned') OR feature_enabled('assignment_emails'))
 AND (c.kind NOT IN ('invitation_reminder','account_reminder') OR feature_enabled('registration_reminders'))
 AND (c.kind NOT IN ('expiry_reminder','expired') OR feature_enabled('expiry_reminders'))
 UNION ALL SELECT * FROM scheduled_report_candidates(at_time);
$$;
