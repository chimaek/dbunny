# DBunny 로드맵

향후 릴리즈 계획입니다. 사용자 피드백에 따라 일정 및 범위가 변경될 수 있습니다.

> 현재 버전: **v2.3.0** (2026-03-14)

---

---

## v2.4.0 — 연결별 컬러 코딩

- 연결에 색상 지정 (빨강=운영, 초록=개발, 파랑=스테이징)
- 탭 바 및 상태 바에 컬러 인디케이터
- 운영 환경 연결 시 경고 배너

---

## v2.5.0 — 연결 복제 및 공유

- 기존 연결 원클릭 복제
- 연결 설정 JSON 내보내기 (비밀번호 제외)
- 공유받은 연결 설정 가져오기
- 팀용 연결 템플릿

---

## v2.6.0 — 데이터 가져오기 (Import)

- CSV, JSON, Excel(.xlsx) → 테이블로 직접 가져오기
- 컬럼 매핑 미리보기 화면
- 충돌 처리 옵션 (건너뛰기 / 덮어쓰기 / Upsert)
- 대용량 파일 진행률 표시

---

## v2.7.0 — Excel 내보내기

- .xlsx 형식 지원
- 멀티시트 내보내기 (테이블당 1시트)
- 헤더 행에 컬럼 타입 표시
- 스타일 및 서식 보존

---

## v2.8.0 — 행 삽입 폼

- 필드명과 타입이 표시되는 폼 기반 행 삽입
- 컬럼 제약 조건 자동 감지 (NOT NULL, DEFAULT, FK)
- FK 참조 값 드롭다운 선택
- CSV 붙여넣기 일괄 삽입

---

## v2.9.0 — 데이터 통계 패널

- 컬럼별 최솟값 / 최댓값 / 평균 / 중앙값
- NULL 비율 및 고유값(distinct) 개수
- 데이터 분포 요약
- 상위 N개 빈출값

---

## v3.0.0 — 간단한 차트

- 숫자 컬럼용 막대 차트
- 값 분포용 파이 차트
- 시계열 데이터용 라인 차트
- 쿼리 결과 하단에 인라인 렌더링

---

## v3.1.0 — 쿼리 결과 비교 (Diff)

- 두 쿼리 결과를 나란히 비교
- 추가 / 삭제 / 변경된 행 하이라이트
- 통합 뷰에 diff 마커 표시

---

## v3.2.0 — 저장 프로시저 / 함수 / 뷰 브라우저

- 저장 프로시저, 함수, 뷰, 트리거 트리뷰 탐색
- 구문 강조된 소스코드 표시
- 파라미터 입력을 통한 저장 프로시저 실행
- 생성 / 편집 / 삭제 작업

---

## v3.3.0 — 테이블 백업 및 복원

- 선택한 테이블을 SQL 덤프로 내보내기
- 스키마만 / 데이터만 / 전체 옵션
- 압축 파일 출력 (.sql.gz)
- 덤프 파일로부터 복원

---

## v3.4.0 — 민감 데이터 마스킹

- 이메일, 전화번호, 주민번호, 카드번호 패턴 자동 감지
- 컬럼별 패턴 기반 마스킹 규칙
- 세션별 마스킹 토글
- 커스텀 정규식 마스킹 프로필

---

## v3.5.0 — Redis 키 브라우저

- 네임스페이스 그룹별 키 트리 시각화
- TTL 표시 및 수정
- 패턴 매칭 키 검색
- 타입별(string, list, hash, set, zset) 값 뷰어

---

## v3.6.0 — MongoDB 집계(Aggregation) 빌더

- 시각적 파이프라인 스테이지 빌더
- 드래그앤드롭 스테이지 순서 변경
- 스테이지별 중간 결과 미리보기
- 파이프라인을 코드로 내보내기

---

## GitHub Actions 자동 배포

main 브랜치에 push하면 VS Code Marketplace에 자동 배포됩니다.

### 사전 준비

1. **Azure DevOps PAT 생성** — [dev.azure.com](https://dev.azure.com) → User Settings → Personal Access Tokens
   - Organization: `All accessible organizations`
   - Scopes: `Marketplace > Manage`

2. **GitHub Secrets 등록** — 저장소 Settings → Secrets and variables → Actions
   - `VSCE_PAT` : Azure DevOps PAT

### 배포 규칙

> **필수**: 로드맵 버전에 맞춰 작업할 때 `package.json`의 `version`을 반드시 해당 버전으로 변경한 후 배포해야 합니다. `package.json` 버전이 Marketplace에 표시되는 실제 버전입니다.

```bash
# 1. package.json 버전 변경
#    "version": "2.0.0"

# 2. CHANGELOG.md 작성

# 3. 커밋 및 push → 자동 배포
git add -A
git commit -m "v2.0.0 - SQL 자동완성 고도화"
git push origin main
```

### 워크플로우 파일

[`.github/workflows/publish.yml`](.github/workflows/publish.yml) — main push → 빌드 → 컴파일 → Marketplace 배포

---

## 완료된 버전

### v2.3.0 (2026-03-14)

- [x] 읽기 전용 모드 — 연결별 토글로 쓰기 쿼리 차단
- [x] INSERT/UPDATE/DELETE/DROP/ALTER/CREATE/TRUNCATE 등 16개 SQL 쓰기 키워드 감지
- [x] Redis 쓰기 명령어 차단 (SET, DEL, HSET, LPUSH 등 50+개)
- [x] MongoDB Shell 쓰기 메서드 차단 (insertOne, updateMany, drop 등)
- [x] 연결 폼에 읽기 전용 토글 체크박스
- [x] 트리뷰 잠금 아이콘 (🔒) + 연결별 토글 명령
- [x] 쿼리 에디터 읽기 전용 배너 표시
- [x] 테이블 편집기 쓰기 작업 차단
- [x] 긴급 해제 확인 다이얼로그 (모달)
- [x] 문자열 리터럴/주석 내 키워드 오탐지 방지
- [x] 읽기 전용 가드 유틸리티 신규 (`src/utils/readOnlyGuard.ts`)
- [x] 유닛 테스트 104개 + 통합 테스트 76개

### v2.0.0 (2026-03-10)

- [x] 별칭(Alias) 인식 (`SELECT u.| FROM users u` → `users` 컬럼 자동 제안)
- [x] JOIN ON 절 FK 기반 자동 제안 (정방향/역방향 FK 탐색)
- [x] 서브쿼리 컨텍스트 인식 (괄호 깊이 추적)
- [x] 다중 테이블 참조 시 컬럼 자동 구분 (`u.name`, `p.title` 접두사 포함)
- [x] SQL 파서 유틸리티 신규 (`src/utils/sqlParser.ts`)
- [x] 유닛 테스트 55개 + 통합 테스트 28개

### v2.2.0 (2026-03-14)

- [x] 결과 고정(Pin) — 쿼리 실행 결과를 핀으로 고정하여 보관
- [x] 나란히 보기(Side-by-side) — 두 결과를 좌우로 비교
- [x] 핀 탭 바 — 고정된 결과를 탭으로 전환 (타임스탬프 + 쿼리 미리보기)
- [x] 핀 라벨 — 사용자 지정 라벨로 구분 (예: "Before Fix", "After Fix")
- [x] 최대 20개 핀 제한 (오래된 핀 자동 삭제)
- [x] 결과 고정 유틸리티 신규 (`src/utils/resultPin.ts`)
- [x] 유닛 테스트 77개 + 통합 테스트 62개

### v2.1.0 (2026-03-12)

- [x] `{{변수명}}` 플레이스홀더 문법 (한국어 변수명 지원)
- [x] 실행 전 변수 입력 다이얼로그 (WebView 모달)
- [x] 연결별 변수 세트 저장 및 재사용
- [x] 환경별(dev/staging/prod) 변수 프로필
- [x] 문자열 리터럴/주석 내부 플레이스홀더 무시
- [x] 쿼리 파라미터 유틸리티 신규 (`src/utils/queryParameter.ts`)
- [x] 유닛 테스트 61개 + 통합 테스트 30개

### v1.9.0 (2026-03-01)

- [x] SQL 인젝션 방지 (파라미터화된 쿼리, 식별자 검증)
- [x] SSH 터널 완전 재작성 (로컬 TCP 서버 기반)
- [x] XSS 방지 (모든 WebView HTML 이스케이핑)
- [x] Redis 파괴적 명령 차단 (FLUSHDB/FLUSHALL)
- [x] MongoDB Shell 문법 (`db.collection.method()`)
- [x] Docker 테스트 환경 (6개 DB, 121개 통합 테스트)

### v1.8.x (2026-01-13 ~ 01-15)

- [x] H2 데이터베이스 지원 (PostgreSQL 와이어 프로토콜, 인메모리/파일 모드)
- [x] MySQL SHOW/DESCRIBE 명령 오류 수정
- [x] 키보드 단축키 Alt 기반으로 변경

### v1.7.0 (2026-01-11)

- [x] SQLite 파일 피커
- [x] PostgreSQL non-public 스키마 완전 지원
- [x] SQLite 드라이버 sql.js(WebAssembly)로 교체

### v1.6.0 (2026-01-11)

- [x] 인라인 셀 편집 (더블클릭 수정, Tab/Enter 이동)
- [x] 셀 확장 뷰 (JSON 구문 강조 모달)
- [x] 테이블 즐겨찾기 (별표 아이콘)
- [x] 멀티행 선택 (Ctrl+Click, 삭제/복사)
- [x] 결과 필터링 (전체/컬럼별 검색, Ctrl+F)
- [x] 컬럼 관리 (숨기기/표시, 드래그앤드롭 순서 변경)
- [x] 정렬 확장 (오름/내림차순, NULL 처리)

### v1.5.0 (2026-01-08)

- [x] ERD 4가지 레이아웃 (Grid, Relationship, Hierarchical, Circular)
- [x] ERD 직교선 라우팅 (겹침 방지)
- [x] ERD 애니메이션 및 호버 효과

### v1.4.0 (2026-01-08)

- [x] PostgreSQL/MySQL 동적 데이터베이스 ERD 지원 수정

### v1.3.0 (2026-01-08)

- [x] 멀티탭 쿼리 에디터 (탭별 연결, 이름 변경, 단축키)

### v1.2.0 (2026-01-07)

- [x] DB 마이그레이션 (버전 관리, 롤백, SQL 내보내기)
- [x] 실시간 모니터링 (활성 쿼리, 서버 상태, 프로세스 종료)

### v1.1.0 (2025-01-06)

- [x] 쿼리 북마크 (카테고리별 저장/불러오기)
- [x] SQL 포매터 (Shift+Alt+F)
- [x] 테이블 스키마 복사 (CREATE TABLE)
- [x] 쿼리 실행 계획 (EXPLAIN)
- [x] 연결 그룹화 (폴더)
- [x] ERD 다이어그램 (SVG/PNG 내보내기)
- [x] 스키마 비교 (Diff 뷰, 리포트 내보내기)
- [x] 목 데이터 생성기 (다양한 생성기, SQL 내보내기)

### v1.0.0 (2025-01-05)

- [x] 다중 DB 지원 (MySQL, PostgreSQL, SQLite, MongoDB, Redis)
- [x] 연결 관리 (AES-256-GCM 암호화 저장)
- [x] 쿼리 실행 및 결과 표시
- [x] 트리뷰 스키마 탐색기
- [x] 쿼리 히스토리
- [x] SSH 터널링
- [x] 다국어 지원 (한국어/영어)
