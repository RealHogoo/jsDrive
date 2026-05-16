ALTER TABLE wh_file
    ADD COLUMN IF NOT EXISTS thumbnail_path VARCHAR(1000);

ALTER TABLE wh_file
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS wh_download_job (
    job_id         BIGSERIAL PRIMARY KEY,
    owner_user_id  VARCHAR(100) NOT NULL,
    status_cd      VARCHAR(20) NOT NULL,
    week_start     DATE NOT NULL,
    sort_basis     VARCHAR(30) NOT NULL,
    content_kind   VARCHAR(20),
    total_count    INTEGER NOT NULL DEFAULT 0,
    processed_count INTEGER NOT NULL DEFAULT 0,
    total_bytes    BIGINT NOT NULL DEFAULT 0,
    zip_path       VARCHAR(1000),
    download_name  VARCHAR(255),
    message        VARCHAR(1000),
    started_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at    TIMESTAMP,
    created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by     VARCHAR(100) NOT NULL,
    updated_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by     VARCHAR(100) NOT NULL,
    CONSTRAINT ck_wh_download_job_status CHECK (status_cd IN ('RUNNING', 'DONE', 'FAILED'))
);

CREATE INDEX IF NOT EXISTS idx_wh_download_job_01
    ON wh_download_job (owner_user_id, job_id DESC);

CREATE INDEX IF NOT EXISTS idx_wh_file_04
    ON wh_file (owner_user_id, storage_path);

CREATE INDEX IF NOT EXISTS idx_wh_file_05
    ON wh_file (owner_user_id, deleted_yn, deleted_at DESC, file_id DESC);

CREATE INDEX IF NOT EXISTS idx_wh_file_06
    ON wh_file (owner_user_id, file_id)
    WHERE deleted_yn = 'N' AND content_kind IN ('IMAGE', 'VIDEO') AND thumbnail_path IS NULL;

CREATE INDEX IF NOT EXISTS idx_wh_file_07
    ON wh_file USING GIN (lower(file_name) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_wh_file_08
    ON wh_file (owner_user_id, deleted_yn, content_kind, original_created_at DESC, file_id DESC);

CREATE INDEX IF NOT EXISTS idx_wh_file_09
    ON wh_file (owner_user_id, deleted_yn, content_kind, created_at DESC, file_id DESC);
