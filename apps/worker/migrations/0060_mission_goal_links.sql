ALTER TABLE mission_tasks ADD COLUMN goal_id TEXT;

CREATE INDEX idx_mission_tasks_goal ON mission_tasks(user_id, goal_id);
