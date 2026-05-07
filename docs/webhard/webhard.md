# 웹하드 서비스

## 화면 개요

웹하드 서비스는 구글 드라이브와 유사한 파일/폴더 관리 기능을 제공한다.
초기 범위는 개인별 폴더/파일 메타데이터 관리와 공유 링크 생성이다.

## 주요 기능

- 폴더 목록 조회
- 폴더 생성/수정
- 파일 목록 조회
- 파일 메타데이터 등록
- 파일 또는 폴더 공유 링크 생성
- 어드민 서비스 JWT/권한 연동

## 화면 흐름

1. 사용자가 웹하드 화면에 진입한다.
2. 프런트는 어드민 로그인에서 받은 JWT를 `Authorization: Bearer` 헤더로 전송한다.
3. 웹하드 서비스는 어드민 `/auth/me.json`으로 사용자를 확인한다.
4. 목록 API는 본인 소유 데이터만 조회한다.
5. 저장/공유 API는 `WEBHARD_SERVICE` 권한을 추가로 확인한다.

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
