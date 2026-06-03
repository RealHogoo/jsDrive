-- Register webhard-service in admin-service.
-- Run this against the admin-service PostgreSQL database.
-- Safe to run multiple times.

WITH missing AS (
    SELECT 'webhard-service' AS service_cd,
           'Webhard Service' AS service_nm,
           'http://localhost:8083' AS base_url,
           '/health/status.json' AS status_path,
           '/health/live.json' AS live_path,
           '/health/ready.json' AS ready_path,
           3000 AS timeout_ms,
           3 AS sort_ord,
           'Webhard file and folder management service' AS remark
    WHERE NOT EXISTS (
        SELECT 1 FROM adm_service_mst WHERE service_cd = 'webhard-service'
    )
),
available AS (
    SELECT candidate_id
    FROM generate_series(1, 9999) AS s(candidate_id)
    WHERE NOT EXISTS (
        SELECT 1 FROM adm_service_mst existing WHERE existing.service_seq = s.candidate_id
    )
    ORDER BY candidate_id
    LIMIT 1
)
INSERT INTO adm_service_mst (
    service_seq, service_cd, service_nm, base_url, status_path, live_path, ready_path,
    timeout_ms, use_yn, sort_ord, remark, created_by, updated_by
)
SELECT available.candidate_id, missing.service_cd, missing.service_nm, missing.base_url,
       missing.status_path, missing.live_path, missing.ready_path, missing.timeout_ms,
       'Y', missing.sort_ord, missing.remark, 'SYSTEM', 'SYSTEM'
FROM missing
JOIN available ON 1 = 1;

UPDATE adm_service_mst
   SET service_nm = 'Webhard Service',
       base_url = 'http://localhost:8083',
       status_path = '/health/status.json',
       live_path = '/health/live.json',
       ready_path = '/health/ready.json',
       timeout_ms = 3000,
       use_yn = 'Y',
       sort_ord = 3,
       remark = 'Webhard file and folder management service',
       updated_at = CURRENT_TIMESTAMP,
       updated_by = 'SYSTEM'
 WHERE service_cd = 'webhard-service';

WITH seed(perm_cd, perm_nm, perm_desc, sort_ord) AS (
    VALUES
        ('WRITE', 'Write Access', 'Allows create and update actions in webhard service', 1),
        ('DELETE', 'Delete Access', 'Allows delete actions in webhard service', 2),
        ('SHARE', 'Share Access', 'Allows share link actions in webhard service', 3)
),
missing AS (
    SELECT sm.service_seq, seed.perm_cd, seed.perm_nm, seed.perm_desc, seed.sort_ord,
           ROW_NUMBER() OVER (ORDER BY seed.sort_ord, seed.perm_cd) AS rn
    FROM adm_service_mst sm
    JOIN seed ON 1 = 1
    WHERE sm.service_cd = 'webhard-service'
      AND NOT EXISTS (
          SELECT 1
          FROM adm_service_perm_def existing
          WHERE existing.service_seq = sm.service_seq
            AND existing.perm_cd = seed.perm_cd
      )
),
available AS (
    SELECT candidate_id,
           ROW_NUMBER() OVER (ORDER BY candidate_id) AS rn
    FROM generate_series(1, 9999) AS s(candidate_id)
    WHERE NOT EXISTS (
        SELECT 1 FROM adm_service_perm_def existing WHERE existing.service_perm_seq = s.candidate_id
    )
)
INSERT INTO adm_service_perm_def (
    service_perm_seq, service_seq, perm_cd, perm_nm, perm_desc, sort_ord, use_yn, created_by, updated_by
)
SELECT available.candidate_id, missing.service_seq, missing.perm_cd, missing.perm_nm,
       missing.perm_desc, missing.sort_ord, 'Y', 'SYSTEM', 'SYSTEM'
FROM missing
JOIN available ON available.rn = missing.rn;

WITH seed(perm_cd, perm_nm, perm_desc, sort_ord) AS (
    VALUES
        ('WRITE', 'Write Access', 'Allows create and update actions in webhard service', 1),
        ('DELETE', 'Delete Access', 'Allows delete actions in webhard service', 2),
        ('SHARE', 'Share Access', 'Allows share link actions in webhard service', 3)
)
UPDATE adm_service_perm_def spd
   SET perm_nm = seed.perm_nm,
       perm_desc = seed.perm_desc,
       sort_ord = seed.sort_ord,
       use_yn = 'Y',
       updated_at = CURRENT_TIMESTAMP,
       updated_by = 'SYSTEM'
  FROM seed
  JOIN adm_service_mst sm ON sm.service_cd = 'webhard-service'
 WHERE spd.service_seq = sm.service_seq
   AND spd.perm_cd = seed.perm_cd;

INSERT INTO adm_auth_service_perm (
    auth_group_seq, service_perm_seq, use_yn, created_by, updated_by
)
SELECT ag.auth_group_seq, spd.service_perm_seq, 'Y', 'SYSTEM', 'SYSTEM'
FROM adm_auth_group ag
JOIN adm_service_perm_def spd ON 1 = 1
JOIN adm_service_mst sm ON sm.service_seq = spd.service_seq
WHERE ag.auth_group_cd = 'ADMIN'
  AND sm.service_cd = 'webhard-service'
ON CONFLICT (auth_group_seq, service_perm_seq) DO UPDATE
   SET use_yn = 'Y',
       updated_at = CURRENT_TIMESTAMP,
       updated_by = 'SYSTEM';

SELECT setval('adm_service_mst_seq', GREATEST(COALESCE((SELECT MAX(service_seq) FROM adm_service_mst), 0), 1), true);
SELECT setval('adm_service_perm_def_seq', GREATEST(COALESCE((SELECT MAX(service_perm_seq) FROM adm_service_perm_def), 0), 1), true);
