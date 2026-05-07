CREATE EXTENSION IF NOT EXISTS pgcrypto;

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
    storage_path  VARCHAR(1000) NOT NULL,
    deleted_yn    CHAR(1) NOT NULL DEFAULT 'N',
    created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by    VARCHAR(100) NOT NULL,
    updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by    VARCHAR(100) NOT NULL,
    CONSTRAINT fk_wh_file_folder FOREIGN KEY (folder_id) REFERENCES wh_folder (folder_id),
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

CREATE INDEX IF NOT EXISTS idx_wh_folder_01
    ON wh_folder (owner_user_id, parent_folder_id, deleted_yn, folder_name);

CREATE INDEX IF NOT EXISTS idx_wh_file_01
    ON wh_file (owner_user_id, folder_id, deleted_yn, file_name);

CREATE INDEX IF NOT EXISTS idx_wh_share_01
    ON wh_share (share_token, revoked_yn, expires_at);
