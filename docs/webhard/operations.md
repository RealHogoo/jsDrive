# 웹하드 운영 가이드

## 개요

`webhard-service`는 NestJS 기반 파일/폴더 관리 서비스다. 인증과 권한은 `admin-service`의 JWT와 서비스 권한을 사용하고, 파일 메타데이터는 PostgreSQL에 저장한다. 실제 파일은 `WEBHARD_STORAGE_ROOT` 아래에 저장한다.

## 필수 환경변수

| 변수 | 설명 |
| --- | --- |
| `APP_ENV` | `dev`, `prod`, `production` |
| `PORT` | 웹하드 서비스 포트, 기본 `8083` |
| `PUBLIC_BASE_URL` | 외부 사용자가 접근하는 웹하드 URL |
| `ADMIN_SERVICE_BASE_URL` | 서버 내부에서 접근하는 admin-service URL |
| `ADMIN_SERVICE_PUBLIC_BASE_URL` | 로그인 리다이렉트용 admin-service 공개 URL |
| `ADMIN_INTERNAL_API_TOKEN` 또는 `MEDIA_INTERNAL_API_TOKEN` | 내부 API 공유 토큰 |
| `MEDIA_INTERNAL_ALLOWED_IPS` 또는 `WEBHARD_INTERNAL_ALLOWED_IPS` | 내부 API 허용 IP/CIDR |
| `WEBHARD_DB_HOST` | PostgreSQL 호스트 |
| `WEBHARD_DB_PORT` | PostgreSQL 포트 |
| `WEBHARD_DB_DATABASE` | DB 이름 |
| `WEBHARD_DB_USERNAME` | DB 사용자 |
| `WEBHARD_DB_PASSWORD` | DB 비밀번호 |
| `WEBHARD_STORAGE_ROOT` | 파일 저장 루트 |

## 용량/보존 설정

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `WEBHARD_UPLOAD_MAX_FILE_MB` | `100` | 단일 업로드 파일 제한 |
| `WEBHARD_UPLOAD_MAX_TOTAL_MB` | `500` | 한 요청의 전체 업로드 제한 |
| `WEBHARD_WEEK_DOWNLOAD_MAX_FILES` | `500` | 주간 ZIP 대상 파일 수 제한 |
| `WEBHARD_WEEK_DOWNLOAD_MAX_MB` | `2048` | 주간 ZIP 총 용량 제한 |
| `WEBHARD_DOWNLOAD_JOB_RETENTION_DAYS` | `7` | 완료된 ZIP 보존 기간 |
| `WEBHARD_DOWNLOAD_CLEANUP_INTERVAL_HOURS` | `24` | ZIP cleanup 주기 |
| `WEBHARD_TRASH_RETENTION_DAYS` | `30` | 휴지통 보존 기간 |
| `TRUST_FORWARDED_HEADERS` | `false` | 신뢰 프록시 헤더 사용 여부 |

## 영상 변환/HLS 설정

트랜스코딩은 웹하드 저장소의 영상 파일을 대상으로 수행한다. 미디어 서비스는 결과물만 내부 API로 받아 프록시한다.

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `WEBHARD_TRANSCODE_ENABLED` | `true` | 자동 트랜스코딩 사용 여부 |
| `WEBHARD_TRANSCODE_START_HOUR` | `3` | 시작 시각, 서버 로컬 시간 기준 |
| `WEBHARD_TRANSCODE_END_HOUR` | `6` | 종료 시각, 서버 로컬 시간 기준 |
| `WEBHARD_TRANSCODE_DAILY_LIMIT` | `20` | 하루 자동 등록 최대 건수 |
| `WEBHARD_TRANSCODE_BATCH_SIZE` | `1` | 한 번에 처리할 작업 수 |
| `WEBHARD_TRANSCODE_TIMEOUT_SECONDS` | `7200` | ffmpeg 작업 제한 시간 |
| `WEBHARD_TRANSCODE_PRESET` | `veryfast` | ffmpeg x264 preset |
| `WEBHARD_TRANSCODE_AUDIO_BITRATE` | `160k` | AAC 오디오 비트레이트 |
| `WEBHARD_HLS_SEGMENT_SECONDS` | `4` | HLS segment 길이 |

상태 확인:

```http
POST /transcode/status.json
POST /internal/media/transcode-status.json
```

수동 등록:

```http
POST /transcode/file/start.json
{
  "file_id": 123
}
```

자동 등록은 이미 720p/1080p variant와 HLS rendition이 모두 있는 파일을 건너뛴다. 실패한 작업은 상태와 메시지를 남기며, 같은 파일에 `PENDING` 또는 `RUNNING` 작업이 있으면 중복 등록하지 않는다.

## 보안 설정

- 운영 환경에서는 `APP_ENV=prod` 또는 `production`을 사용한다.
- 운영 환경에서 `dev-media-internal-token` 기본 토큰은 사용할 수 없다.
- `TRUST_FORWARDED_HEADERS=true`는 신뢰된 프록시 뒤에서만 사용한다.
- HTTPS 프록시 뒤에서는 `PUBLIC_BASE_URL`, `ADMIN_SERVICE_PUBLIC_BASE_URL`, forwarded headers 전달을 함께 확인한다.
- 내부 미디어 API는 내부 토큰과 허용 IP/CIDR을 모두 통과해야 한다.
- 인증이 필요한 HTML 페이지는 `no-store` 응답 헤더로 브라우저 캐시에 남지 않게 한다.

## 배포 순서

1. DB 백업과 파일 저장소 백업을 확보한다.
2. 필요한 PostgreSQL deploy SQL을 먼저 적용한다.
3. `npm install`이 필요한 환경이면 의존성을 갱신한다.
4. `npm run build`로 배포 산출물을 만든다.
5. 환경변수를 주입하고 `npm run start` 또는 운영 프로세스 매니저로 실행한다.
6. 헬스 체크와 주요 화면을 확인한다.

## 신규 DB 적용

```bash
psql -h "$WEBHARD_DB_HOST" -p "$WEBHARD_DB_PORT" -U "$WEBHARD_DB_USERNAME" -d "$WEBHARD_DB_DATABASE" -f docs/sql/postgres/schema.sql
```

기존 DB는 필요한 deploy SQL만 순서대로 적용한다. 각 deploy SQL은 반복 실행을 고려해서 작성한다.

## 헬스 체크

```http
POST /health/live.json
POST /health/ready.json
POST /health/status.json
POST /version.json
```

정상 응답 예시:

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

## 배포 전 검증

```powershell
npm run lint
npm test -- --runInBand
npm run build
npm run check:encoding
```

## 백업 대상

- PostgreSQL DB 전체
- `WEBHARD_STORAGE_ROOT` 전체
- 운영 환경변수 또는 secret 설정

DB와 파일 저장소는 같은 시점에 맞춰 백업해야 한다. 시점이 크게 어긋나면 DB에는 있는데 파일이 없거나, 파일은 있는데 DB 메타데이터가 없는 상태가 생길 수 있다.

## 장애 확인

- 로그인 실패: `admin-service` 상태, `ADMIN_SERVICE_BASE_URL`, 사용자 `WEBHARD_SERVICE` 권한 확인
- 업로드 실패: 업로드 용량 제한, 저장소 권한, 디스크 여유 공간 확인
- 미리보기/다운로드 실패: `wh_file.storage_path`의 실제 파일 존재 여부 확인
- 공유 링크 실패: 만료일, 다운로드 횟수, 비밀번호 설정 확인
- 주간 ZIP 실패: 파일 수/용량 제한과 download job 상태 확인
- 내부 미디어 연동 실패: 내부 토큰, 허용 IP/CIDR, media-service 호출 로그 확인
- HLS 재생 실패: `wh_hls_rendition` 존재 여부, playlist/segment 파일 존재 여부, `POST /internal/media/hls-stream.json` 응답 확인
- 변환 실패: `wh_transcode_job.message`, ffmpeg 경로, 저장소 쓰기 권한, 디스크 여유 공간 확인
