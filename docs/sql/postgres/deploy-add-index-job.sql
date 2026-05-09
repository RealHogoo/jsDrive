CREATE TABLE IF NOT EXISTS wh_index_job (
    job_id         BIGSERIAL PRIMARY KEY,
    owner_user_id  VARCHAR(100) NOT NULL,
    root_path      VARCHAR(1000) NOT NULL,
    status_cd      VARCHAR(20) NOT NULL,
    total_count    INTEGER NOT NULL DEFAULT 0,
    indexed_count  INTEGER NOT NULL DEFAULT 0,
    skipped_count  INTEGER NOT NULL DEFAULT 0,
    error_count    INTEGER NOT NULL DEFAULT 0,
    message        VARCHAR(1000),
    started_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at    TIMESTAMP,
    created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by     VARCHAR(100) NOT NULL,
    updated_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by     VARCHAR(100) NOT NULL,
    CONSTRAINT ck_wh_index_job_status CHECK (status_cd IN ('RUNNING', 'DONE', 'FAILED'))
);

CREATE INDEX IF NOT EXISTS idx_wh_index_job_01
    ON wh_index_job (owner_user_id, status_cd, job_id DESC);
