ALTER TABLE wh_file
    ADD COLUMN IF NOT EXISTS media_public_yn CHAR(1) NOT NULL DEFAULT 'N';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'ck_wh_file_media_public'
    ) THEN
        ALTER TABLE wh_file
            ADD CONSTRAINT ck_wh_file_media_public CHECK (media_public_yn IN ('Y', 'N'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_wh_file_media_public
    ON wh_file (media_public_yn, deleted_yn, content_kind, updated_at DESC, file_id DESC);
