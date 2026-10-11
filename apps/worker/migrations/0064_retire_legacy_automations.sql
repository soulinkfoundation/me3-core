-- Retire Assistant Jobs after preserving booking reminder state and owner review history.
-- Upgraded tables retain legacy CHECK choices ('job' / 'assistant_job'); rows are normalized below.
-- No live writer uses those choices, so avoid rebuilding tables solely to match fresh-install CHECK lists.
ALTER TABLE sites ADD COLUMN booking_reminders_enabled INTEGER NOT NULL DEFAULT 1 CHECK (booking_reminders_enabled IN (0, 1));

CREATE TABLE IF NOT EXISTS assistant_jobs (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL DEFAULT 'owner', recipe_id TEXT,
  status TEXT NOT NULL DEFAULT 'draft', updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

UPDATE sites
SET booking_reminders_enabled = CASE WHEN (
  SELECT status FROM assistant_jobs
  WHERE user_id = sites.user_id AND recipe_id = 'booking-reminder' AND status != 'archived'
  ORDER BY updated_at DESC LIMIT 1
) = 'paused' THEN 0 ELSE 1 END;

UPDATE assistant_threads SET origin_surface = 'system' WHERE origin_surface = 'job';

UPDATE mission_plugin_activity
SET plugin_id = 'me3.mission-control',
    activity_type = REPLACE(activity_type, 'assistant_job.', 'mission.')
WHERE plugin_id = 'me3.assistant-jobs' OR activity_type LIKE 'assistant_job.%';

UPDATE mission_agent_runs
SET title = CASE WHEN title LIKE 'Assistant Job: %' THEN SUBSTR(title, 16) ELSE title END,
    result_json = CASE WHEN json_valid(result_json) THEN json_remove(result_json, '$.assistantJobRunId') ELSE result_json END,
    status = CASE WHEN runner_id = 'assistant-jobs' AND status IN ('queued', 'running') THEN 'cancelled' ELSE status END,
    finished_at = CASE WHEN runner_id = 'assistant-jobs' AND status IN ('queued', 'running') THEN CURRENT_TIMESTAMP ELSE finished_at END
WHERE source = 'core';

UPDATE mission_tasks
SET metadata_json = json_remove(metadata_json, '$.weeklyReview.assistantJobRunId')
WHERE json_valid(metadata_json) AND json_extract(metadata_json, '$.kind') = 'weekly_review';

UPDATE mission_approvals
SET status = 'cancelled', resolved_by = 'core', resolved_at = CURRENT_TIMESTAMP
WHERE status = 'pending' AND (requested_by = 'assistant_job' OR id IN (
  SELECT approval_id FROM local_executor_runs WHERE source_kind = 'assistant_job'
));

UPDATE mission_agent_runs
SET status = 'cancelled', finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
WHERE id IN (
  SELECT mission_agent_run_id FROM local_executor_runs
  WHERE source_kind = 'assistant_job' AND status IN ('queued', 'waiting_for_approval', 'running')
);

UPDATE local_executor_runs
SET source_kind = 'event',
    status = CASE WHEN status IN ('queued', 'waiting_for_approval', 'running') THEN 'cancelled' ELSE status END,
    finished_at = COALESCE(finished_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP
WHERE source_kind = 'assistant_job';

DROP TABLE IF EXISTS assistant_job_action_results;

DROP TABLE IF EXISTS assistant_job_artifacts;

DROP TABLE IF EXISTS assistant_job_run_events;

DROP TABLE IF EXISTS assistant_job_runs;

DROP TABLE IF EXISTS assistant_job_versions;

DROP TABLE IF EXISTS assistant_job_ingress_events;

DROP TABLE IF EXISTS assistant_jobs;
