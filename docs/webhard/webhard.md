# 웹하드 서비스

## 화면 개요

웹하드 서비스는 구글 드라이브와 유사한 파일/폴더 관리 기능을 제공한다.
초기 범위는 개인별 폴더/파일 메타데이터 관리와 공유 링크 생성이다.

## 주요 기능

- 폴더 목록 조회
- 폴더 생성/수정
- 파일 목록 조회
- 파일 메타데이터 등록
- 사진/동영상 파일 업로드
- 파일 또는 폴더 공유 링크 생성
- 원본 생성일 기준 일별/주별/월별 미리보기
- 어드민 서비스 JWT/권한 연동

## 화면 흐름

1. 사용자가 웹하드 화면에 진입한다.
2. 프런트는 어드민 로그인에서 받은 JWT를 `Authorization: Bearer` 헤더로 전송한다.
3. 웹하드 서비스는 어드민 `/auth/me.json`으로 사용자를 확인한다.
4. 목록 API는 본인 소유 데이터만 조회한다.
5. 저장/공유 API는 `WEBHARD_SERVICE` 권한을 추가로 확인한다.
6. 업로드 화면은 파일의 브라우저 `lastModified` 값을 원본 생성일 기본값으로 제안한다.
7. 사용자는 원본 촬영일/생성일이 다르면 직접 수정한다.

## 화면 진입 권한

- `/`, `/index.html`, `/upload.html`, `/preview.html`은 어드민 로그인 토큰이 있어야 접근할 수 있다.
- 비로그인 사용자는 `admin-service`의 `/service-login-page.do`로 이동한다.
- 일반 사용자는 `WEBHARD_SERVICE` 권한이 하나 이상 있어야 화면에 진입할 수 있다.
- `ROLE_ADMIN`, `ROLE_SUPER_ADMIN`은 권한 목록 없이도 진입할 수 있다.

## API 명세

### `POST /folder/list.json`

요청:

```json
{
  "parent_folder_id": null
}
```

응답:

```json
{
  "ok": true,
  "code": "OK",
  "message": "success",
  "data": {
    "items": []
  },
  "trace_id": null
}
```

### `POST /folder/save.json`

권한: `WEBHARD_SERVICE.WRITE`

요청:

```json
{
  "folder_id": null,
  "parent_folder_id": null,
  "folder_name": "문서"
}
```

### `POST /file/list.json`

요청:

```json
{
  "folder_id": null
}
```

### `POST /file/register.json`

권한: `WEBHARD_SERVICE.WRITE`

요청:

```json
{
  "folder_id": 1,
  "file_name": "sample.pdf",
  "file_size": 1024,
  "content_type": "application/pdf",
  "storage_path": "/volume1/webhard/sample.pdf"
}
```

### `POST /file/upload.json`

권한: `WEBHARD_SERVICE.WRITE`

요청: `multipart/form-data`

| 필드 | 설명 |
| --- | --- |
| `file` | 사진 또는 동영상 파일 |
| `folder_id` | 선택 폴더 ID |
| `original_created_at` | 원본 생성일 ISO datetime |

### `POST /preview/list.json`

요청:

```json
{
  "period_type": "day",
  "base_date": "2026-05-08",
  "content_kind": "ALL"
}
```

`period_type`은 `day`, `week`, `month`를 지원한다.
조회 범위는 등록일이 아니라 `wh_file.original_created_at` 기준이다.

### `POST /share/create.json`

권한: `WEBHARD_SERVICE.SHARE`

요청:

```json
{
  "file_id": 1,
  "expires_at": "2026-06-01 00:00:00"
}
```

## DB 설계

- `wh_folder`: 폴더 메타데이터
- `wh_file`: 파일 메타데이터
- `wh_share`: 공유 링크

상세 SQL은 `docs/sql/postgres/schema.sql`을 기준으로 한다.

## 예외/에러 케이스

- JWT 없음: `UNAUTHORIZED`
- 어드민 `/auth/me.json` 검증 실패: `UNAUTHORIZED`
- 권한 없음: `FORBIDDEN`
- 필수값 누락: `BAD_REQUEST`
- DB 장애: `SERVER_ERROR`
