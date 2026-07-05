# NAS 인덱싱

## 목적

NAS 또는 기존 저장소에 이미 존재하는 파일을 웹하드 DB 메타데이터로 등록한다. 업로드를 거치지 않은 파일도 화면, 검색, 미리보기, 미디어 연동 대상으로 만들기 위한 기능이다.

## 화면

- `GET /indexing.html`

화면은 인덱싱 시작 버튼과 최근 작업 상태를 제공한다. 작업 상태는 주기적으로 갱신된다.

## API

- `POST /index/start.json`: 로그인 사용자의 저장 루트 인덱싱 시작
- `POST /index/status.json`: 최근 인덱싱 작업 상태 조회

## 스캔 범위

```text
<WEBHARD_STORAGE_ROOT>/<login_id>
```

사용자별 디렉터리 아래 파일만 등록한다. 다른 사용자의 경로를 임의로 등록하지 않는다.

## 동작 규칙

- 이미지, 동영상, 문서, 기타 파일을 content kind로 분류한다.
- 이미 `wh_file.storage_path`에 등록된 파일은 중복 등록하지 않는다.
- 생성일은 가능한 경우 파일 시스템 birthtime을 우선 사용하고, 없으면 mtime을 사용한다.
- 동일 사용자 인덱싱 작업이 `RUNNING`이면 업로드와 수동 등록은 충돌 방지를 위해 제한될 수 있다.

## DB

- 작업 상태: `wh_index_job`
- 파일 메타데이터: `wh_file`

관련 배포 SQL:

- `docs/sql/postgres/deploy-add-index-job.sql`
