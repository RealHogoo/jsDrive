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
- 공유
  - `POST /share/create.json`
- 운영
  - `POST /version.json`
  - `POST /health/live.json`
  - `POST /health/ready.json`
  - `POST /health/status.json`

## 권한

`admin-service`의 `service_permissions`에서 `WEBHARD_SERVICE` 권한을 확인합니다.

- `WRITE`: 폴더 저장, 파일 등록
- `SHARE`: 공유 링크 생성
- `DELETE`: 삭제 API 확장 예정

관리자 역할(`ROLE_ADMIN`, `ROLE_SUPER_ADMIN`)은 서비스 권한 체크를 통과합니다.

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
npm install
npm run start:dev
```

로컬 개발 장비에 Node.js/npm이 필요합니다.

## DB

PostgreSQL 스키마는 `docs/sql/postgres/schema.sql`에 있습니다.

어드민 서비스 등록 SQL은 `docs/sql/postgres/admin-service-registration.sql`에 있습니다.
운영 반영 시 `admin-service` DB에 먼저 적용해야 권한 화면과 `/auth/me.json`에서 웹하드 권한을 사용할 수 있습니다.

## 문서

- 웹하드 설계: [docs/webhard/webhard.md](docs/webhard/webhard.md)
- PostgreSQL 스키마: [docs/sql/postgres/schema.sql](docs/sql/postgres/schema.sql)
- 어드민 등록 SQL: [docs/sql/postgres/admin-service-registration.sql](docs/sql/postgres/admin-service-registration.sql)
