CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_wh_file_12
    ON wh_file USING GIN (lower(display_name) gin_trgm_ops);
