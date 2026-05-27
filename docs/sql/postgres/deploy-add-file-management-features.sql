ALTER TABLE wh_file
    ADD COLUMN IF NOT EXISTS display_name VARCHAR(255),
    ADD COLUMN IF NOT EXISTS memo TEXT,
    ADD COLUMN IF NOT EXISTS tags VARCHAR(1000),
    ADD COLUMN IF NOT EXISTS content_sha256 VARCHAR(64);

ALTER TABLE wh_share
    ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255),
    ADD COLUMN IF NOT EXISTS max_download_count INTEGER,
    ADD COLUMN IF NOT EXISTS download_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_wh_file_10
    ON wh_file (owner_user_id, content_sha256)
    WHERE content_sha256 IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_wh_file_11
    ON wh_file USING GIN (lower(tags) gin_trgm_ops);
