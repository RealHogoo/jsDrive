ALTER TABLE wh_file
    DROP CONSTRAINT IF EXISTS ck_wh_file_kind;

ALTER TABLE wh_file
    ADD CONSTRAINT ck_wh_file_kind
    CHECK (content_kind IN ('IMAGE', 'VIDEO', 'DOCUMENT', 'OTHER'));
