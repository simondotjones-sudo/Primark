-- Ported from prototype v15. No learner records or uploads are included.
CREATE TABLE learners (
	id text PRIMARY KEY NOT NULL,
	name text NOT NULL,
	email text NOT NULL,
	code_hash text NOT NULL,
	store_id text NOT NULL,
	country text NOT NULL,
	entered_at text NOT NULL,
	started_at text,
	completed_at text,
	best_score integer,
	certificate_token text
);

CREATE TABLE attempts (
	id text PRIMARY KEY NOT NULL,
	learner_id text NOT NULL,
	score integer NOT NULL,
	taken_at text NOT NULL,
	FOREIGN KEY (learner_id) REFERENCES learners(id) ON UPDATE no action ON DELETE no action
);

CREATE TABLE legacy_completions (
	email text PRIMARY KEY NOT NULL,
	completed integer NOT NULL,
	completed_at text,
	store_id text,
	imported_at text NOT NULL
);

CREATE TABLE module_views (
	learner_id text NOT NULL,
	module_key text NOT NULL,
	viewed_at text NOT NULL,
	PRIMARY KEY(learner_id, module_key),
	FOREIGN KEY (learner_id) REFERENCES learners(id) ON UPDATE no action ON DELETE no action
);

CREATE TABLE sessions (
	token_hash text PRIMARY KEY NOT NULL,
	learner_id text NOT NULL,
	expires_at text NOT NULL,
	FOREIGN KEY (learner_id) REFERENCES learners(id) ON UPDATE no action ON DELETE no action
);

CREATE TABLE shot_photos (
	id text PRIMARY KEY NOT NULL,
	module_number integer NOT NULL,
	slide_number integer NOT NULL,
	filename text NOT NULL,
	mime_type text NOT NULL,
	size integer NOT NULL,
	object_key text NOT NULL,
	thumbnail_key text,
	uploaded_by text NOT NULL,
	uploaded_at text NOT NULL,
	FOREIGN KEY (uploaded_by) REFERENCES learners(id) ON UPDATE no action ON DELETE no action
);

CREATE TABLE shot_states (
	module_number integer NOT NULL,
	slide_number integer NOT NULL,
	status text DEFAULT 'todo' NOT NULL,
	note text DEFAULT '' NOT NULL,
	updated_by text NOT NULL,
	updated_at text NOT NULL,
	PRIMARY KEY(module_number, slide_number),
	FOREIGN KEY (updated_by) REFERENCES learners(id) ON UPDATE no action ON DELETE no action
);

CREATE TABLE courses (
	id text PRIMARY KEY NOT NULL,
	title text NOT NULL,
	description text DEFAULT '' NOT NULL,
	status text DEFAULT 'draft' NOT NULL,
	audience_json text NOT NULL,
	package_id text,
	revision integer DEFAULT 1 NOT NULL,
	created_at text NOT NULL,
	updated_at text NOT NULL
);

CREATE TABLE course_packages (
	id text PRIMARY KEY NOT NULL,
	course_id text NOT NULL,
	filename text NOT NULL,
	status text DEFAULT 'uploading' NOT NULL,
	scos_json text DEFAULT '[]' NOT NULL,
	file_count integer NOT NULL,
	total_bytes integer NOT NULL,
	created_at text NOT NULL,
	FOREIGN KEY (course_id) REFERENCES courses(id) ON UPDATE no action ON DELETE no action
);

CREATE TABLE course_files (
	package_id text NOT NULL,
	path text NOT NULL,
	size integer NOT NULL,
	uploaded integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(package_id, path),
	FOREIGN KEY (package_id) REFERENCES course_packages(id) ON UPDATE no action ON DELETE no action
);

CREATE TABLE scorm_launches (
	token text PRIMARY KEY NOT NULL,
	course_id text NOT NULL,
	package_id text NOT NULL,
	learner_id text,
	sco_id text NOT NULL,
	preview integer DEFAULT 0 NOT NULL,
	seed_json text NOT NULL,
	sequence integer DEFAULT 0 NOT NULL,
	base_time integer DEFAULT 0 NOT NULL,
	expires_at text NOT NULL,
	FOREIGN KEY (course_id) REFERENCES courses(id) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (package_id) REFERENCES course_packages(id) ON UPDATE no action ON DELETE no action
);

CREATE TABLE scorm_progress (
	learner_id text NOT NULL,
	package_id text NOT NULL,
	sco_id text NOT NULL,
	data_json text DEFAULT '{}' NOT NULL,
	status text DEFAULT 'incomplete' NOT NULL,
	score text,
	total_centiseconds integer DEFAULT 0 NOT NULL,
	active_launch text,
	updated_at text NOT NULL,
	completed_at text,
	PRIMARY KEY(learner_id, package_id, sco_id),
	FOREIGN KEY (learner_id) REFERENCES learners(id) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (package_id) REFERENCES course_packages(id) ON UPDATE no action ON DELETE no action
);

CREATE UNIQUE INDEX learners_email_unique ON learners (email);
CREATE UNIQUE INDEX learners_certificate_token_unique ON learners (certificate_token);
CREATE INDEX idx_shot_photos_module_slide ON shot_photos (module_number,slide_number);

CREATE TABLE admin_sessions (token_hash text PRIMARY KEY, email text NOT NULL, credential_hash text NOT NULL, expires_at text NOT NULL);
CREATE TABLE auth_limits (key text PRIMARY KEY, attempts integer NOT NULL, expires_at text NOT NULL);
CREATE INDEX idx_sessions_learner ON sessions(learner_id);
CREATE INDEX idx_sessions_expiry ON sessions(expires_at);
CREATE INDEX idx_course_packages_course ON course_packages(course_id);
CREATE INDEX idx_scorm_launch_expiry ON scorm_launches(expires_at);
CREATE INDEX idx_admin_sessions_expiry ON admin_sessions(expires_at);
