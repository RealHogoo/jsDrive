# webhard-service

`webhard-service`는 웹하드 파일, 폴더, 공유 링크를 관리하는 NestJS + PostgreSQL 서비스입니다.
인증과 서비스 권한은 `admin-service`의 JWT와 `/auth/me.json` 응답을 기준으로 처리합니다.

## 역할

- 개인별 폴더 목록과 저장
- 개인별 파일 목록, 등록, 업로드, 이동
- 파일명, 표시명, 메모, 태그 관리
- 파일 또는 폴더 공유 링크 생성
- 공유 링크 비밀번호, 만료일, 다운로드 횟수 제한
- 저장소 현황 대시보드와 중복 파일 감지
- 기존 파일 SHA-256 해시 백필
- PostgreSQL 기반 메타데이터 관리
- admin-service 권한 연동
- 헬스체크와 릴리스 버전 확인

## 주요 API

- 폴더
  - `POST /folder/list.json`
  - `POST /folder/save.json`
  - `POST /folder/move.json`
- 파일
  - `POST /file/list.json`
  - `POST /file/register.json`
  - `POST /file/upload.json`
  - `POST /file/upload-batch.json`
  - `POST /file/metadata.json`
  - `POST /file/move.json`
  - `POST /file/duplicates.json`
  - `POST /file/hash-backfill.json`
- 대시보드
  - `POST /dashboard/summary.json`
- 공유
  - `POST /share/create.json`
  - `GET /s/:token`
  - `GET /share/download/:token`
- 미리보기
  - `POST /preview/list.json`
  - `POST /preview/feed.json`
  - `POST /preview/week-items.json`
- 다운로드
  - `POST /download/week/start.json`
  - `POST /download/status.json`
  - `POST /download/list.json`
  - `POST /download/cleanup.json`
- 운영
  - `POST /version.json`
  - `POST /health/live.json`
  - `POST /health/ready.json`
  - `POST /health/status.json`

## 권한

`admin-service`의 `service_permissions`에서 `WEBHARD_SERVICE` 권한을 확인합니다.

- 화면 진입: `WEBHARD_SERVICE` 권한 중 하나 이상 필요
- `WRITE`: 폴더 저장, 파일 등록, 업로드, 이동, 메타데이터 수정, 해시 백필
- `SHARE`: 공유 링크 생성
- `DELETE`: 삭제와 휴지통 정리

관리자 역할(`ROLE_ADMIN`, `ROLE_SUPER_ADMIN`)은 서비스 권한 체크를 통과합니다.
관리자는 대시보드에서 전체 사용자 저장소 현황을 볼 수 있습니다.
비로그인 사용자가 `/`, `/upload.html`, `/preview.html` 등에 접근하면 admin-service 로그인 페이지로 이동합니다.
공유 링크 화면 `/s/:token`과 공유 다운로드는 공개 엔드포인트입니다.

## 로컬 실행

기본 포트는 `8083`입니다.

```powershell
$env:APP_ENV="dev"
$env:SERVICE_ID="webhard-service"
$env:PORT="8083"
$env:ADMIN_SERVICE_BASE_URL="http://localhost:8081"
$env:WEBHARD_DB_HOST="localhost"
$env:WEBHARD_DB_PORT="5432"
$env:WEBHARD_DB_DATABASE="webhard"
$env:WEBHARD_DB_USERNAME="postgres"
$env:WEBHARD_DB_PASSWORD="postgres"
$env:WEBHARD_STORAGE_ROOT="D:\webhard-storage"
$env:WEBHARD_DOWNLOAD_JOB_RETENTION_DAYS="7"
$env:WEBHARD_DOWNLOAD_CLEANUP_INTERVAL_HOURS="24"
npm install
npm run start:dev
```

로컬 개발 장비에는 Node.js와 npm이 필요합니다.

## Node 자동 설치 실행

운영 서버에 Node.js가 없으면 `scripts/run-service.sh` 또는 `scripts/run-service.ps1`이 `.runtime` 아래에 Node.js를 자동으로 내려받고 실행합니다.

Linux/NAS:

```sh
export APP_ENV=prod
export SERVICE_ID=webhard-service
export PORT=8083
export ADMIN_SERVICE_BASE_URL=http://localhost:8081
export WEBHARD_DB_HOST=localhost
export WEBHARD_DB_PORT=5432
export WEBHARD_DB_DATABASE=webhard
export WEBHARD_DB_USERNAME=postgres
export WEBHARD_DB_PASSWORD=postgres
export WEBHARD_STORAGE_ROOT=/volume1/webhard
sh scripts/run-service.sh
```

인자로 넘겨도 됩니다.

```sh
sh scripts/run-service.sh --storage-root=/volume1/webhard --port=8083
```

Windows 로컬:

```powershell
$env:APP_ENV="dev"
$env:SERVICE_ID="webhard-service"
$env:PORT="8083"
$env:ADMIN_SERVICE_BASE_URL="http://localhost:8081"
$env:WEBHARD_DB_HOST="localhost"
$env:WEBHARD_DB_PORT="5432"
$env:WEBHARD_DB_DATABASE="webhard"
$env:WEBHARD_DB_USERNAME="postgres"
$env:WEBHARD_DB_PASSWORD="postgres"
.\scripts\run-service.ps1 -StorageRoot "D:\webhard-storage" -Port "8083"
```

기본 Node 버전은 `v22.13.1`입니다. 운영에서 다른 버전을 쓰려면 `NODE_VERSION` 환경변수로 바꿀 수 있습니다.
처음 실행할 때 Node 다운로드, `npm install`, `npm run build`가 수행됩니다.

## 저장소 루트와 계정별 폴더

파일 저장 루트는 `WEBHARD_STORAGE_ROOT`로 지정합니다.
지정하지 않으면 서비스 디렉터리의 `storage` 폴더를 사용합니다.

업로드 파일은 로그인 계정별로 분리됩니다.

```text
<WEBHARD_STORAGE_ROOT>/
  <login_id>/
    yyyy/
      mm/
        dd/
          <uuid>.<ext>
```

예시:

```text
/volume1/webhard/ADMIN/2026/05/10/4c4c2e9d-...jpg
```

## 공유 링크

파일 상세 화면에서 공유 링크를 만들 수 있습니다.
공유 링크는 `/s/:token` 화면으로 접근하며, 비밀번호가 있으면 화면에서 입력한 뒤 다운로드합니다.

공유 링크 제한:

- `expires_at`: 만료일 이후 접근 차단
- `password_hash`: 비밀번호가 설정된 경우 검증 후 다운로드 허용
- `max_download_count`: 다운로드 횟수 제한
- `download_count`: 실제 다운로드 성공 시 증가

## 중복 파일과 해시 백필

신규 업로드 파일은 SHA-256 해시를 저장합니다.
기존 파일은 `content_sha256`가 비어 있을 수 있으므로 중복 감지에 포함하려면 백필을 실행해야 합니다.

```http
POST /file/hash-backfill.json
{
  "limit": 100
}
```

관리자는 전체 사용자 파일을 대상으로 백필할 수 있습니다.

```http
POST /file/hash-backfill.json
{
  "limit": 100,
  "all_users": true
}
```

## NAS 마운트 파일

NAS 디렉터리를 서버에 마운트하고 `WEBHARD_STORAGE_ROOT`로 지정하면 새로 업로드되는 파일은 해당 경로에 저장됩니다.
다만 이미 NAS에 있던 과거 파일은 파일시스템에만 있고 `wh_file` 메타데이터가 없기 때문에 현재 화면에는 자동으로 나오지 않습니다.

과거 파일을 보려면 다음 중 하나가 필요합니다.

- 파일 경로, 크기, MIME 타입, 원본 생성일을 `wh_file`에 등록하는 스캔 또는 인덱싱 기능
- `POST /file/register.json`으로 기존 파일을 하나씩 메타데이터에 등록

사진과 동영상의 실제 촬영일은 파일 수정일과 다를 수 있습니다. 신규 이미지 업로드는 가능한 경우 EXIF 촬영일을 원본 생성일로 자동 반영합니다.

## DB

PostgreSQL 스키마는 `docs/sql/postgres/schema.sql`에 있습니다.

운영 반영 순서:

1. 기존 스키마가 없다면 `docs/sql/postgres/schema.sql`
2. 미리보기 메타데이터가 없다면 `docs/sql/postgres/deploy-add-preview-metadata.sql`
3. 썸네일/휴지통/다운로드 작업 컬럼이 없다면 `docs/sql/postgres/deploy-add-thumbnail-delete-download-job.sql`
4. 파일 관리 기능 추가 SQL `docs/sql/postgres/deploy-add-file-management-features.sql`
5. admin-service 서비스 등록 SQL `docs/sql/postgres/admin-service-registration.sql`

운영 반영 때 `admin-service` DB에 서비스 등록 SQL을 먼저 적용해야 권한 화면과 `/auth/me.json`에서 웹하드 권한을 사용할 수 있습니다.

## 문서

- 웹하드 설계: [docs/webhard/webhard.md](docs/webhard/webhard.md)
- PostgreSQL 스키마: [docs/sql/postgres/schema.sql](docs/sql/postgres/schema.sql)
- 파일 관리 기능 SQL: [docs/sql/postgres/deploy-add-file-management-features.sql](docs/sql/postgres/deploy-add-file-management-features.sql)
- admin-service 등록 SQL: [docs/sql/postgres/admin-service-registration.sql](docs/sql/postgres/admin-service-registration.sql)

## 화면

- 업로드: `http://localhost:8083/upload.html`
- 현황: `http://localhost:8083/dashboard.html`
- 미리보기: `http://localhost:8083/preview.html`
- 검색: `http://localhost:8083/search.html`
- 다운로드 작업: `http://localhost:8083/download-jobs.html`
- 휴지통: `http://localhost:8083/trash.html`

루트 `http://localhost:8083/`는 웹하드 메인 화면입니다.
업로드 화면은 브라우저가 제공하는 파일 `lastModified` 값을 원본 생성일 기본값으로 사용합니다.
사진이나 동영상의 실제 촬영일과 생성일이 다르면 업로드 전에 원본 생성일 입력값을 수정합니다.
미리보기 화면은 등록일이 아니라 `original_created_at` 기준으로 일별, 주별, 월별 조회합니다.

## 검증

```powershell
npm run lint
npm test -- --runInBand
npm run build
npm run check:encoding
```

## 운영 문서

운영 배포, SQL 적용 순서, 환경변수, 백업/복구, 정기 점검, 장애 대응 절차는 다음 문서를 기준으로 관리합니다.

- [웹하드 운영 문서](docs/webhard/operations.md)
