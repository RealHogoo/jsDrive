CREATE INDEX IF NOT EXISTS idx_wh_file_15
    ON wh_file (deleted_yn, content_kind, updated_at DESC, file_id DESC);

CREATE INDEX IF NOT EXISTS idx_wh_file_16
    ON wh_file (owner_user_id, deleted_yn, content_kind, updated_at DESC, file_id DESC);
