# 웹하드 서비스

## 개요

웹하드 서비스는 사용자별 파일과 폴더를 관리하고, 미리보기, 검색, 공유 링크, 휴지통, 주간 ZIP 다운로드, 미디어 서비스 연동 기능을 제공한다.

## 주요 화면

- `/index.html`: 파일 탐색
- `/upload.html`: 파일 업로드
- `/dashboard.html`: 현황 대시보드
- `/preview.html`: 일/주/월 미리보기
- `/preview-detail.html`: 미리보기 상세
- `/search.html`: 통합 검색
- `/download-jobs.html`: ZIP 다운로드 작업
- `/indexing.html`: NAS 파일 인덱싱
- `/shares.html`: 공유 링크 관리
- `/trash.html`: 휴지통
- `/audit.html`: 감사 로그

## 인증과 권한

화면과 API는 `admin-service`에서 발급한 JWT를 사용한다. 일반 사용자는 `WEBHARD_SERVICE` 서비스 권한이 하나 이상 필요하고, 쓰기/공유/삭제 기능은 세부 권한을 추가로 확인한다.

| 권한 | 기능 |
| --- | --- |
| `WRITE` | 폴더 생성/수정, 파일 업로드, 파일 이동, 메타데이터 수정, 인덱싱 |
| `SHARE` | 공유 링크 생성과 해지 |
| `DELETE` | 휴지통 이동, 복원, 영구 삭제, 오래된 휴지통 정리 |

`ROLE_ADMIN`, `ROLE_SUPER_ADMIN`은 웹하드 권한 검사를 통과한다.

## 주요 API

- `POST /folder/list.json`
- `POST /folder/tree.json`
- `POST /folder/save.json`
- `POST /folder/move.json`
- `POST /file/list.json`
- `POST /file/search.json`
- `POST /file/detail.json`
- `POST /file/upload.json`
- `POST /file/upload-batch.json`
- `POST /file/metadata.json`
- `POST /file/move.json`
- `POST /file/delete.json`
- `POST /file/delete-week.json`
- `POST /file/change-owner-week.json`
- `POST /trash/list.json`
- `POST /trash/restore.json`
- `POST /trash/purge.json`
- `POST /trash/purge-old.json`
- `POST /preview/list.json`
- `POST /preview/feed.json`
- `POST /share/create.json`
- `POST /share/list.json`
- `POST /share/revoke.json`
- `POST /audit/list.json`
- `POST /index/start.json`
- `POST /index/status.json`
- `POST /transcode/file/start.json`
- `POST /transcode/pending/start.json`
- `POST /transcode/status.json`

## 공개 다운로드 URL

- `GET /file/content/:fileId`
- `GET /file/thumbnail/:fileId`
- `GET /file/download/:fileId`
- `GET /share/download/:token`
- `POST /share/download/:token`
- `GET /download/file/:jobId`

이 URL들도 사용자 인증 또는 공유 링크 검증을 거친다. 공유 링크 다운로드는 메모리 rate limit을 적용하고, 비밀번호가 있는 링크는 POST 요청에서 비밀번호를 검증한다.

## 파일 저장 구조

업로드 파일은 기본적으로 다음 구조로 저장한다.

```text
<WEBHARD_STORAGE_ROOT>/<login_id>/yyyy/mm/dd/<uuid>.<ext>
```

DB에는 실제 파일 경로가 `wh_file.storage_path`로 저장된다. 저장소에서 파일을 직접 삭제하면 미리보기와 다운로드가 실패할 수 있으므로, 삭제는 서비스 기능을 통해 수행한다.

## 미디어 서비스 연동

`/internal/media/*` API는 media-service가 웹하드 파일을 조회하거나 스트리밍할 때 사용한다. 내부 API는 다음 조건을 모두 만족해야 한다.

- `x-internal-api-token`이 서버에 설정된 내부 토큰과 일치
- 호출 IP가 `MEDIA_INTERNAL_ALLOWED_IPS` 또는 `WEBHARD_INTERNAL_ALLOWED_IPS`에 포함
- 사용자 스코프가 필요한 요청은 `x-user-access-token`으로 admin-service 사용자 검증

내부 토큰은 상수시간 비교로 검증하며, 운영 기본 토큰 사용은 차단한다.

주요 내부 API:

- `POST /internal/media/list.json`: 이미지/영상 파일 목록
- `POST /internal/media/file-detail.json`: 단일 파일 상세
- `POST /internal/media/active-ids.json`: 활성 파일 ID 목록
- `POST /internal/media/register-youtube.json`: 유튜브 다운로드 결과 등록
- `POST /internal/media/mark-public.json`: 공개 여부 반영
- `POST /internal/media/bulk-public.json`: 공개 여부 일괄 반영
- `POST /internal/media/file-stream.json`: 원본/variant 파일 스트림, `Range` 요청 시 `206 Partial Content`
- `POST /internal/media/hls-stream.json`: HLS playlist와 segment 스트림
- `POST /internal/media/ready.json`: 내부 연동 준비 상태
- `POST /internal/media/transcode-status.json`: 트랜스코딩 상태 요약

## 영상 변환과 HLS

웹하드 서비스가 원본 파일 저장소를 소유하므로 720p/1080p 변환과 HLS segment 생성도 웹하드에서 처리한다.

- `wh_transcode_job`: 파일별 변환 작업과 실패/완료 메시지
- `wh_transcode_variant`: 720p/1080p MP4 결과물
- `wh_hls_rendition`: HLS master/variant playlist와 segment 디렉터리

HLS는 `master.m3u8`, 품질별 `index.m3u8`, `.ts` segment로 구성된다. 미디어 서비스는 이 파일들을 직접 읽지 않고 내부 API를 통해 받아 사용자 권한과 쿠키 흐름을 유지한다.

## DB 주요 테이블

- `wh_folder`: 폴더 메타데이터
- `wh_file`: 파일 메타데이터
- `wh_share`: 공유 링크
- `wh_index_job`: NAS 인덱싱 작업
- `wh_download_job`: ZIP 다운로드 작업
- `wh_transcode_job`: 영상 변환 작업
- `wh_transcode_variant`: 영상 variant 파일
- `wh_hls_rendition`: HLS playlist/segment 위치
- `wh_audit_log`: 감사 로그

기준 스키마는 `docs/sql/postgres/schema.sql`을 따른다.
