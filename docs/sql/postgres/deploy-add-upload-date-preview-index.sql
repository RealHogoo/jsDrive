CREATE INDEX IF NOT EXISTS idx_wh_file_03
    ON wh_file (owner_user_id, created_at, content_kind, deleted_yn);
