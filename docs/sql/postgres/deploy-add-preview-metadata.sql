ALTER TABLE wh_file
    ADD COLUMN IF NOT EXISTS content_kind VARCHAR(20) NOT NULL DEFAULT 'OTHER';

ALTER TABLE wh_file
    ADD COLUMN IF NOT EXISTS public_path VARCHAR(1000);

ALTER TABLE wh_file
    ADD COLUMN IF NOT EXISTS original_created_at TIMESTAMP;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'ck_wh_file_kind'
    ) THEN
        ALTER TABLE wh_file
            ADD CONSTRAINT ck_wh_file_kind CHECK (content_kind IN ('IMAGE', 'VIDEO', 'OTHER'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_wh_file_02
    ON wh_file (owner_user_id, original_created_at, content_kind, deleted_yn);
