-- Notes (journal_articles) join the owner content search index as source_type 'note',
-- so the agent can find a note by its words and read it with core_journal_notes_read.

CREATE TRIGGER IF NOT EXISTS owner_content_search_note_insert
AFTER INSERT ON journal_articles
BEGIN
  INSERT INTO owner_content_search (
    user_id, source_type, source_id, title, body, project_id,
    project_name, status, source_date, updated_at
  ) VALUES (
    NEW.user_id,
    'note',
    NEW.id,
    COALESCE(NULLIF(TRIM(NEW.title), ''), 'Untitled note'),
    NEW.body,
    NEW.project_id,
    COALESCE((SELECT name FROM mission_projects WHERE id = NEW.project_id AND user_id = NEW.user_id LIMIT 1), ''),
    NULL,
    substr(NEW.updated_at, 1, 10),
    NEW.updated_at
  );
END;

CREATE TRIGGER IF NOT EXISTS owner_content_search_note_update
AFTER UPDATE ON journal_articles
BEGIN
  DELETE FROM owner_content_search
  WHERE user_id = OLD.user_id AND source_type = 'note' AND source_id = OLD.id;

  INSERT INTO owner_content_search (
    user_id, source_type, source_id, title, body, project_id,
    project_name, status, source_date, updated_at
  ) VALUES (
    NEW.user_id,
    'note',
    NEW.id,
    COALESCE(NULLIF(TRIM(NEW.title), ''), 'Untitled note'),
    NEW.body,
    NEW.project_id,
    COALESCE((SELECT name FROM mission_projects WHERE id = NEW.project_id AND user_id = NEW.user_id LIMIT 1), ''),
    NULL,
    substr(NEW.updated_at, 1, 10),
    NEW.updated_at
  );
END;

CREATE TRIGGER IF NOT EXISTS owner_content_search_note_delete
AFTER DELETE ON journal_articles
BEGIN
  DELETE FROM owner_content_search
  WHERE user_id = OLD.user_id AND source_type = 'note' AND source_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS owner_content_search_project_rename_notes
AFTER UPDATE OF name ON mission_projects
BEGIN
  UPDATE owner_content_search
  SET project_name = NEW.name
  WHERE user_id = NEW.user_id
    AND source_type = 'note'
    AND project_id = NEW.id;
END;

DELETE FROM owner_content_search WHERE source_type = 'note';

INSERT INTO owner_content_search (
  user_id, source_type, source_id, title, body, project_id,
  project_name, status, source_date, updated_at
)
SELECT
  a.user_id,
  'note',
  a.id,
  COALESCE(NULLIF(TRIM(a.title), ''), 'Untitled note'),
  a.body,
  a.project_id,
  COALESCE(p.name, ''),
  NULL,
  substr(a.updated_at, 1, 10),
  a.updated_at
FROM journal_articles a
LEFT JOIN mission_projects p ON p.id = a.project_id AND p.user_id = a.user_id;
