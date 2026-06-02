# 웹하드 운영 문서

이 문서는 `webhard-service`를 운영할 때 필요한 배포, 설정, 점검, 장애 대응 절차를 정리한다.

## 서비스 개요

- 서비스명: `webhard-service`
- 기본 포트: `8083`
- 런타임: NestJS, Node.js
- DB: PostgreSQL
- 인증/권한: `admin-service`의 JWT와 `/auth/me.json`
- 파일 저장소: `WEBHARD_STORAGE_ROOT`

주요 화면:

- 업로드: `/upload.html`
- 대시보드: `/dashboard.html`
- 미리보기: `/preview.html`
- 검색: `/search.html`
- 다운로드 작업: `/download-jobs.html`
- 휴지통: `/trash.html`
- 공유 관리: `/shares.html`
- 감사 로그: `/audit.html`

## 환경변수

필수 운영 환경변수:

| 변수 | 설명 | 예시 |
| --- | --- | --- |
| `PORT` | 웹하드 서비스 포트 | `8083` |
| `PUBLIC_BASE_URL` | 외부에서 접근하는 웹하드 URL | `https://webhard.example.com` |
| `ADMIN_SERVICE_BASE_URL` | 서버 내부 admin-service URL | `http://localhost:8081` |
| `ADMIN_SERVICE_PUBLIC_BASE_URL` | 로그인 리다이렉트용 공개 admin-service URL | `https://admin.example.com` |
| `WEBHARD_DB_HOST` | PostgreSQL 호스트 | `localhost` |
| `WEBHARD_DB_PORT` | PostgreSQL 포트 | `5432` |
| `WEBHARD_DB_DATABASE` | DB 이름 | `webhard` |
| `WEBHARD_DB_USERNAME` | DB 사용자 | `postgres` |
| `WEBHARD_DB_PASSWORD` | DB 비밀번호 | 운영 비밀번호 |
| `WEBHARD_STORAGE_ROOT` | 파일 저장 루트 | `/volume1/webhard` |

용량/보존 정책 환경변수:

| 변수 | 설명 | 기본값 |
| --- | --- | --- |
| `WEBHARD_UPLOAD_MAX_FILE_MB` | 단일 업로드 파일 제한 | `100` |
| `WEBHARD_UPLOAD_MAX_TOTAL_MB` | 한 번에 업로드하는 전체 용량 제한 | `500` |
| `WEBHARD_WEEK_DOWNLOAD_MAX_FILES` | 주간 ZIP 다운로드 파일 수 제한 | `500` |
| `WEBHARD_WEEK_DOWNLOAD_MAX_MB` | 주간 ZIP 다운로드 용량 제한 | `2048` |
| `WEBHARD_DOWNLOAD_JOB_RETENTION_DAYS` | 완료된 ZIP 파일 보존 기간 | `7` |
| `WEBHARD_DOWNLOAD_CLEANUP_INTERVAL_HOURS` | ZIP 파일 자동 정리 주기 | `24` |
| `WEBHARD_TRASH_RETENTION_DAYS` | 휴지통 기본 보존 기간 | `30` |
| `TRUST_FORWARDED_HEADERS` | 프록시 헤더 신뢰 여부 | `false` |

프록시 뒤에서 HTTPS로 운영할 때는 `PUBLIC_BASE_URL`, `ADMIN_SERVICE_PUBLIC_BASE_URL`, `TRUST_FORWARDED_HEADERS=true`를 함께 맞춘다.

## 최초 배포

1. PostgreSQL DB를 생성한다.
2. `WEBHARD_STORAGE_ROOT` 디렉터리를 만들고 서비스 계정에 읽기/쓰기 권한을 준다.
3. `admin-service` DB에 웹하드 서비스 등록 SQL을 적용한다.
4. `webhard-service` DB에 스키마와 배포 SQL을 적용한다.
5. 빌드 후 서비스를 시작한다.
6. 헬스 체크와 버전 API를 확인한다.

PowerShell 예시:

```powershell
$env:APP_ENV="prod"
$env:SERVICE_ID="webhard-service"
$env:PORT="8083"
$env:PUBLIC_BASE_URL="https://webhard.example.com"
$env:ADMIN_SERVICE_BASE_URL="http://localhost:8081"
$env:ADMIN_SERVICE_PUBLIC_BASE_URL="https://admin.example.com"
$env:WEBHARD_DB_HOST="localhost"
$env:WEBHARD_DB_PORT="5432"
$env:WEBHARD_DB_DATABASE="webhard"
$env:WEBHARD_DB_USERNAME="postgres"
$env:WEBHARD_DB_PASSWORD="운영 비밀번호"
$env:WEBHARD_STORAGE_ROOT="D:\webhard-storage"

npm install
npm run build
npm run start
```

스크립트 실행 예시:

```powershell
.\scripts\run-service.ps1 -Port "8083" -StorageRoot "D:\webhard-storage"
```

Linux/NAS 예시:

```sh
export APP_ENV=prod
export SERVICE_ID=webhard-service
export PORT=8083
export PUBLIC_BASE_URL=https://webhard.example.com
export ADMIN_SERVICE_BASE_URL=http://localhost:8081
export ADMIN_SERVICE_PUBLIC_BASE_URL=https://admin.example.com
export WEBHARD_DB_HOST=localhost
export WEBHARD_DB_PORT=5432
export WEBHARD_DB_DATABASE=webhard
export WEBHARD_DB_USERNAME=postgres
export WEBHARD_DB_PASSWORD='운영 비밀번호'
export WEBHARD_STORAGE_ROOT=/volume1/webhard

sh scripts/run-service.sh
```

## SQL 적용 순서

신규 DB에는 `schema.sql`을 먼저 적용한다.

```sh
psql -h "$WEBHARD_DB_HOST" -p "$WEBHARD_DB_PORT" -U "$WEBHARD_DB_USERNAME" -d "$WEBHARD_DB_DATABASE" -f docs/sql/postgres/schema.sql
```

기존 DB에는 누락된 배포 SQL을 순서대로 적용한다. 각 SQL은 `IF NOT EXISTS` 또는 안전한 조건을 사용한다.

1. `docs/sql/postgres/deploy-add-preview-metadata.sql`
2. `docs/sql/postgres/deploy-add-upload-date-preview-index.sql`
3. `docs/sql/postgres/deploy-add-thumbnail-delete-download-job.sql`
4. `docs/sql/postgres/deploy-add-file-management-features.sql`
5. `docs/sql/postgres/deploy-add-index-job.sql`
6. `docs/sql/postgres/deploy-add-document-content-kind.sql`
7. `docs/sql/postgres/deploy-add-audit-log.sql`
8. `docs/sql/postgres/deploy-add-optimization-indexes.sql`
9. `docs/sql/postgres/deploy-add-performance-indexes.sql`

`admin-service` DB에는 다음 SQL을 별도로 적용한다.

```text
docs/sql/postgres/admin-service-registration.sql
```

## 권한

웹하드는 `admin-service`의 `service_permissions`에서 `WEBHARD_SERVICE` 권한을 사용한다.

| 권한 | 기능 |
| --- | --- |
| `WRITE` | 폴더 저장, 파일 업로드, 파일 이동, 메타데이터 수정, 인덱싱, 썸네일 재생성 |
| `SHARE` | 공유 링크 생성, 공유 링크 해지 |
| `DELETE` | 휴지통 이동, 복원, 영구 삭제, 오래된 휴지통 정리 |

`ROLE_ADMIN`, `ROLE_SUPER_ADMIN`은 웹하드 권한 체크를 통과하며, 대시보드와 감사 로그에서 전체 사용자 범위를 볼 수 있다.

## 저장소 구조

업로드 파일은 사용자와 날짜 기준으로 저장된다.

```text
<WEBHARD_STORAGE_ROOT>/
  <user_id>/
    yyyy/
      mm/
        dd/
          <uuid>.<ext>
```

운영 원칙:

- `WEBHARD_STORAGE_ROOT`는 앱 디렉터리 밖의 별도 볼륨을 권장한다.
- DB의 `wh_file.storage_path`와 실제 파일이 함께 보존되어야 한다.
- 수동으로 파일을 삭제하면 다운로드와 미리보기가 실패한다.

## 백업

백업 대상:

- PostgreSQL DB 전체
- `WEBHARD_STORAGE_ROOT` 전체
- 운영 환경변수 또는 배포 설정

DB 백업 예시:

```sh
pg_dump -h "$WEBHARD_DB_HOST" -p "$WEBHARD_DB_PORT" -U "$WEBHARD_DB_USERNAME" -Fc "$WEBHARD_DB_DATABASE" > webhard.dump
```

파일 백업 예시:

```sh
rsync -a --delete "$WEBHARD_STORAGE_ROOT/" /backup/webhard-storage/
```

백업은 DB와 파일 저장소의 시점을 최대한 맞춘다. 시점이 크게 어긋나면 DB에는 있는데 파일이 없거나, 파일은 있는데 DB 메타데이터가 없는 상태가 생길 수 있다.

## 복구

1. 서비스를 중지한다.
2. PostgreSQL DB를 복구한다.
3. `WEBHARD_STORAGE_ROOT`를 복구한다.
4. 환경변수를 확인한다.
5. 서비스를 시작한다.
6. `/health/status.json`, `/version.json`, 주요 화면을 확인한다.

DB 복구 예시:

```sh
pg_restore -h "$WEBHARD_DB_HOST" -p "$WEBHARD_DB_PORT" -U "$WEBHARD_DB_USERNAME" -d "$WEBHARD_DB_DATABASE" --clean --if-exists webhard.dump
```

## 정기 점검

매일:

- `POST /health/status.json` 응답이 `UP`인지 확인
- 디스크 여유 공간 확인
- `WEBHARD_STORAGE_ROOT` 접근 권한 확인
- 다운로드 작업 실패 건 확인

매주:

- 휴지통 용량과 오래된 파일 정리 여부 확인
- 공유 링크 중 만료/제한 초과 상태 확인
- 감사 로그 증가량 확인
- 백업 복구 리허설 또는 백업 무결성 확인

배포 전:

```powershell
npm run lint
npm test -- --runInBand
npm run build
npm run check:encoding
npm audit --audit-level=moderate
```

## 헬스 체크

```http
POST /health/live.json
POST /health/ready.json
POST /health/status.json
POST /version.json
```

정상 예시:

```json
{
  "ok": true,
  "data": {
    "status": "UP",
    "service": "webhard-service",
    "db": "UP"
  }
}
```

## 장애 대응

로그인 후 화면 접근 불가:

- `admin-service`가 실행 중인지 확인한다.
- `ADMIN_SERVICE_BASE_URL`과 `ADMIN_SERVICE_PUBLIC_BASE_URL`을 확인한다.
- 사용자에게 `WEBHARD_SERVICE` 권한이 있는지 확인한다.

업로드 실패:

- `WEBHARD_UPLOAD_MAX_FILE_MB`, `WEBHARD_UPLOAD_MAX_TOTAL_MB` 제한을 확인한다.
- `WEBHARD_STORAGE_ROOT` 권한과 디스크 여유 공간을 확인한다.
- 인덱싱 작업 중이면 업로드가 제한될 수 있다.

미리보기/다운로드 실패:

- `wh_file.storage_path`의 실제 파일 존재 여부를 확인한다.
- 저장소 마운트가 끊겼는지 확인한다.
- 브라우저에서 지원하지 않는 문서는 다운로드로 확인한다.

공유 링크 다운로드 실패:

- 공유 링크가 해지되었는지 확인한다.
- `expires_at`, `max_download_count`, `download_count` 상태를 확인한다.
- 비밀번호가 설정된 링크는 화면에서 비밀번호를 입력해야 한다.

주간 ZIP 다운로드 실패:

- `WEBHARD_WEEK_DOWNLOAD_MAX_FILES`, `WEBHARD_WEEK_DOWNLOAD_MAX_MB` 제한을 확인한다.
- 생성된 ZIP은 임시 디렉터리에 저장되며, 보존 기간 이후 자동 정리된다.
- `POST /download/cleanup.json`으로 사용자별 정리를 수동 실행할 수 있다.

DB 연결 실패:

- DB 호스트, 포트, 사용자, 비밀번호를 확인한다.
- PostgreSQL 서버와 방화벽 상태를 확인한다.
- `POST /health/status.json`의 `db` 값을 확인한다.

## 보안

- 운영 DB 비밀번호는 `.env.example` 기본값을 사용하지 않는다.
- 외부 공개 환경에서는 HTTPS 프록시를 사용한다.
- `TRUST_FORWARDED_HEADERS=true`는 신뢰 가능한 프록시 뒤에서만 설정한다.
- 서비스는 기본 보안 헤더를 응답한다.
- 공유 링크 토큰은 외부 노출될 수 있으므로 만료일과 다운로드 횟수 제한을 함께 사용하는 것을 권장한다.

## 배포 후 확인

배포 직후 다음을 확인한다.

```powershell
Invoke-RestMethod -Uri http://localhost:8083/health/status.json -Method Post
Invoke-RestMethod -Uri http://localhost:8083/version.json -Method Post
```

브라우저 확인:

- `/dashboard.html` 로그인 리다이렉트 정상
- `/upload.html` 업로드 화면 정상
- `/shares.html` 공유 관리 화면 정상
- `/audit.html` 감사 로그 화면 정상

## 롤백

1. 새 프로세스를 중지한다.
2. 이전 커밋 또는 이전 빌드 산출물로 서비스를 되돌린다.
3. DB SQL은 대부분 추가 컬럼/인덱스라 그대로 두어도 이전 버전과 호환된다.
4. 문제가 된 배포 SQL이 인덱스 추가라면 `DROP INDEX IF EXISTS <index_name>;`로 제거할 수 있다.
5. `/health/status.json`과 `/version.json`으로 상태를 확인한다.

DB 구조를 되돌리는 롤백은 데이터 손실 가능성이 있으므로 백업 확보 후 진행한다.
