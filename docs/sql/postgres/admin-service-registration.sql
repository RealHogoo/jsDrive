INSERT INTO adm_service_mst (
    service_seq, service_cd, service_nm, base_url, status_path, live_path, ready_path,
    timeout_ms, use_yn, sort_ord, remark, created_by, updated_by
)
SELECT COALESCE((SELECT MAX(service_seq) + 1 FROM adm_service_mst), 1),
       'webhard-service', 'Webhard Service', 'http://localhost:8083',
       '/health/status.json', '/health/live.json', '/health/ready.json',
       3000, 'Y', 3, 'Webhard file and folder management service', 'SYSTEM', 'SYSTEM'
WHERE NOT EXISTS (
    SELECT 1 FROM adm_service_mst WHERE service_cd = 'webhard-service'
);

INSERT INTO adm_service_perm_def (
    service_perm_seq, service_seq, perm_cd, perm_nm, perm_desc, sort_ord, use_yn, created_by, updated_by
)
SELECT nextval('adm_service_perm_def_seq'), sm.service_seq, seed.perm_cd, seed.perm_nm, seed.perm_desc, seed.sort_ord, 'Y', 'SYSTEM', 'SYSTEM'
FROM adm_service_mst sm
JOIN (
    VALUES
        ('webhard-service', 'WRITE', 'Write Access', 'Allows create and update actions in webhard service', 1),
        ('webhard-service', 'DELETE', 'Delete Access', 'Allows delete actions in webhard service', 2),
        ('webhard-service', 'SHARE', 'Share Access', 'Allows share link actions in webhard service', 3)
) AS seed(service_cd, perm_cd, perm_nm, perm_desc, sort_ord)
  ON seed.service_cd = sm.service_cd
WHERE NOT EXISTS (
    SELECT 1
    FROM adm_service_perm_def existing
    WHERE existing.service_seq = sm.service_seq
      AND existing.perm_cd = seed.perm_cd
);
