CREATE INDEX IF NOT EXISTS idx_wh_file_13
    ON wh_file (owner_user_id, deleted_yn, created_at DESC, file_id DESC);

CREATE INDEX IF NOT EXISTS idx_wh_file_14
    ON wh_file (owner_user_id, deleted_yn, original_created_at DESC, file_id DESC);

CREATE INDEX IF NOT EXISTS idx_wh_share_02
    ON wh_share (owner_user_id, created_at DESC, share_id DESC);

CREATE INDEX IF NOT EXISTS idx_wh_audit_log_02
    ON wh_audit_log (actor_user_id, action_cd, target_type, created_at DESC, log_id DESC);

CREATE INDEX IF NOT EXISTS idx_wh_audit_log_03
    ON wh_audit_log (created_at DESC, log_id DESC);
