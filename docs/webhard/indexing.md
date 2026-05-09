# 웹하드 NAS 인덱싱

## 목적

NAS에 이미 존재하는 계정별 사진/동영상 파일을 웹하드 DB 메타데이터로 등록한다.

## 화면

- `GET /indexing.html`: 인덱싱 시작 버튼과 진행 상태를 표시한다.
- 인덱싱 상태는 1.5초 간격으로 자동 갱신한다.

## API

- `POST /index/start.json`: 로그인 계정의 저장 루트 인덱싱을 시작한다.
- `POST /index/status.json`: 마지막 인덱싱 작업 상태를 조회한다.

## 스캔 범위

```text
<WEBHARD_STORAGE_ROOT>/<login_id>
```

서비스 실행 시 `WEBHARD_STORAGE_ROOT`를 NAS 마운트 경로로 지정하면 기존 NAS 파일도 인덱싱 대상이 된다.

## 동작 규칙

- 대상 파일은 사진/동영상 확장자만 등록한다.
- 이미 `wh_file`에 등록된 `storage_path`는 중복 등록하지 않는다.
- `original_created_at`은 파일 시스템 생성일(`birthtime`)을 우선 사용하고, 없으면 수정일(`mtime`)을 사용한다.
- 인덱싱 작업이 `RUNNING` 상태이면 파일 업로드와 수동 파일 등록은 409 응답으로 차단한다.

## DB

- `wh_index_job`: 계정별 인덱싱 작업 상태와 진행 건수를 저장한다.
- 배포 SQL: `docs/sql/postgres/deploy-add-index-job.sql`

