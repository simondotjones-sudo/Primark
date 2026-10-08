-- Scope learner searches and reporting joins before reading training evidence.
CREATE INDEX learners_reporting_store ON learners(store_id);
