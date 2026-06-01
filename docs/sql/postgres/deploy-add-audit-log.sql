CREATE TABLE IF NOT EXISTS wh_audit_log (
    log_id        BIGSERIAL PRIMARY KEY,
    actor_user_id VARCHAR(100) NOT NULL,
    action_cd     VARCHAR(50) NOT NULL,
    target_type   VARCHAR(30),
    target_id     BIGINT,
    detail_json   JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by    VARCHAR(100) NOT NULL,
    updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by    VARCHAR(100) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_wh_audit_log_01
    ON wh_audit_log (actor_user_id, log_id DESC);
