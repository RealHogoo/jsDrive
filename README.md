# webhard-service

`webhard-service`는 웹하드 파일/폴더/공유 링크 관리를 담당하는 NestJS + PostgreSQL 서비스입니다.
인증과 서비스 권한은 `admin-service`의 JWT와 `/auth/me.json` 응답을 기준으로 처리합니다.

## 역할

- 개인별 폴더 목록/저장
- 개인별 파일 목록/등록
- 파일 또는 폴더 공유 링크 생성
- PostgreSQL 기반 메타데이터 관리
- 어드민 서비스 권한 연동
- 헬스체크와 릴리즈 버전 확인

## 주요 API

- 폴더
  - `POST /folder/list.json`
  - `POST /folder/save.json`
- 파일
  - `POST /file/list.json`
  - `POST /file/register.json`
  - `POST /file/upload.json`
- 공유
  - `POST /share/create.json`
- 미리보기
  - `POST /preview/list.json`
- 운영
  - `POST /version.json`
  - `POST /health/live.json`
  - `POST /health/ready.json`
  - `POST /health/status.json`

## 권한

`admin-service`의 `service_permissions`에서 `WEBHARD_SERVICE` 권한을 확인합니다.

- 화면 진입: `WEBHARD_SERVICE` 권한 중 하나 이상 필요
- `WRITE`: 폴더 저장, 파일 등록
- `SHARE`: 공유 링크 생성
- `DELETE`: 삭제 API 확장 예정

관리자 역할(`ROLE_ADMIN`, `ROLE_SUPER_ADMIN`)은 서비스 권한 체크를 통과합니다.
비로그인 사용자가 `/`, `/upload.html`, `/preview.html`에 접근하면 어드민 서비스 로그인 페이지로 이동합니다.

## 실행

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
npm install
npm run start:dev
```

로컬 개발 장비에 Node.js/npm이 필요합니다.

## Node 자동 설치 실행

운영 서버에 Node.js가 없어도 `scripts/run-service.sh`가 `.runtime` 아래에 Node.js를 자동으로 내려받고 실행합니다.

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

인자로 넘길 수도 있습니다.

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
처음 실행 시에는 Node 다운로드, `npm install`, `npm run build`가 수행됩니다.

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

## NAS 마운트 파일

NAS 디렉터리를 서버에 마운트하고 `WEBHARD_STORAGE_ROOT`로 지정하면 새로 업로드되는 파일은 그 경로에 저장됩니다.
다만 이미 NAS에 있던 과거 파일은 파일시스템에만 존재하고 `wh_file` 메타데이터가 없기 때문에 현재 화면에는 자동으로 나오지 않습니다.

과거 파일을 보려면 다음 중 하나가 필요합니다.

- 파일 경로, 크기, MIME 타입, 원본 생성일을 `wh_file`에 등록하는 스캔/인덱싱 기능
- 또는 `POST /file/register.json`으로 기존 파일을 하나씩 메타데이터 등록

사진/동영상의 실제 촬영일은 파일 수정일과 다를 수 있습니다. 정확한 원본 생성일 기준 미리보기를 하려면 추후 EXIF/동영상 메타데이터를 읽는 스캐너를 추가하는 것이 맞습니다.

## DB

PostgreSQL 스키마는 `docs/sql/postgres/schema.sql`에 있습니다.
원본 생성일 기준 미리보기 메타데이터 추가 SQL은 `docs/sql/postgres/deploy-add-preview-metadata.sql`입니다.

어드민 서비스 등록 SQL은 `docs/sql/postgres/admin-service-registration.sql`에 있습니다.
운영 반영 시 `admin-service` DB에 먼저 적용해야 권한 화면과 `/auth/me.json`에서 웹하드 권한을 사용할 수 있습니다.

## 문서

- 웹하드 설계: [docs/webhard/webhard.md](docs/webhard/webhard.md)
- PostgreSQL 스키마: [docs/sql/postgres/schema.sql](docs/sql/postgres/schema.sql)
- 어드민 등록 SQL: [docs/sql/postgres/admin-service-registration.sql](docs/sql/postgres/admin-service-registration.sql)

## 화면

- 업로드: `http://localhost:8083/upload.html`
- 미리보기: `http://localhost:8083/preview.html`

루트 `http://localhost:8083/`는 웹하드 메인 화면입니다.
업로드 화면은 브라우저가 제공하는 파일 `lastModified` 값을 원본 생성일 기본값으로 사용합니다.
사진/동영상 파일의 실제 촬영일이나 생성일이 다르면 업로드 전에 원본 생성일 입력값을 수정합니다.
미리보기 화면은 등록일이 아니라 `original_created_at` 기준으로 일별, 주별, 월별 조회합니다.
