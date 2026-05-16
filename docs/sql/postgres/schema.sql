CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS wh_folder (
    folder_id        BIGSERIAL PRIMARY KEY,
    owner_user_id    VARCHAR(100) NOT NULL,
    parent_folder_id BIGINT,
    folder_name      VARCHAR(255) NOT NULL,
    deleted_yn       CHAR(1) NOT NULL DEFAULT 'N',
    created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by       VARCHAR(100) NOT NULL,
    updated_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by       VARCHAR(100) NOT NULL,
    CONSTRAINT fk_wh_folder_parent FOREIGN KEY (parent_folder_id) REFERENCES wh_folder (folder_id),
    CONSTRAINT ck_wh_folder_deleted CHECK (deleted_yn IN ('Y', 'N'))
);

CREATE TABLE IF NOT EXISTS wh_file (
    file_id       BIGSERIAL PRIMARY KEY,
    owner_user_id VARCHAR(100) NOT NULL,
    folder_id     BIGINT,
    file_name     VARCHAR(255) NOT NULL,
    file_size     BIGINT NOT NULL DEFAULT 0,
    content_type  VARCHAR(200) NOT NULL DEFAULT 'application/octet-stream',
    content_kind  VARCHAR(20) NOT NULL DEFAULT 'OTHER',
    storage_path  VARCHAR(1000) NOT NULL,
    public_path   VARCHAR(1000),
    thumbnail_path VARCHAR(1000),
    original_created_at TIMESTAMP,
    deleted_yn    CHAR(1) NOT NULL DEFAULT 'N',
    deleted_at    TIMESTAMP,
    created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by    VARCHAR(100) NOT NULL,
    updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by    VARCHAR(100) NOT NULL,
    CONSTRAINT fk_wh_file_folder FOREIGN KEY (folder_id) REFERENCES wh_folder (folder_id),
    CONSTRAINT ck_wh_file_kind CHECK (content_kind IN ('IMAGE', 'VIDEO', 'DOCUMENT', 'OTHER')),
    CONSTRAINT ck_wh_file_deleted CHECK (deleted_yn IN ('Y', 'N'))
);

CREATE TABLE IF NOT EXISTS wh_share (
    share_id      BIGSERIAL PRIMARY KEY,
    owner_user_id VARCHAR(100) NOT NULL,
    folder_id     BIGINT,
    file_id       BIGINT,
    share_token   VARCHAR(64) NOT NULL UNIQUE,
    expires_at    TIMESTAMP,
    revoked_yn    CHAR(1) NOT NULL DEFAULT 'N',
    created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by    VARCHAR(100) NOT NULL,
    updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by    VARCHAR(100) NOT NULL,
    CONSTRAINT fk_wh_share_folder FOREIGN KEY (folder_id) REFERENCES wh_folder (folder_id),
    CONSTRAINT fk_wh_share_file FOREIGN KEY (file_id) REFERENCES wh_file (file_id),
    CONSTRAINT ck_wh_share_target CHECK (folder_id IS NOT NULL OR file_id IS NOT NULL),
    CONSTRAINT ck_wh_share_revoked CHECK (revoked_yn IN ('Y', 'N'))
);

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

CREATE INDEX IF NOT EXISTS idx_wh_folder_01
    ON wh_folder (owner_user_id, parent_folder_id, deleted_yn, folder_name);

CREATE INDEX IF NOT EXISTS idx_wh_file_01
    ON wh_file (owner_user_id, folder_id, deleted_yn, file_name);

CREATE INDEX IF NOT EXISTS idx_wh_file_02
    ON wh_file (owner_user_id, original_created_at, content_kind, deleted_yn);

CREATE INDEX IF NOT EXISTS idx_wh_file_03
    ON wh_file (owner_user_id, created_at, content_kind, deleted_yn);

CREATE INDEX IF NOT EXISTS idx_wh_share_01
    ON wh_share (share_token, revoked_yn, expires_at);

CREATE INDEX IF NOT EXISTS idx_wh_index_job_01
    ON wh_index_job (owner_user_id, status_cd, job_id DESC);

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
