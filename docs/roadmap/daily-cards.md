# 일일 개발 카드

기준일: 2026-11-11. 120개 카드는 계획이며 아직 구현 완료가 아니다. 기본 100개와 기존 기능 고도화 후보 20개다. D001부터 시작하되 [작업 절차](execution.md)의 의존성·환경·완료 기준을 따른다. 모든 카드의 목표 규모는 개발·로컬 검증 **60~90분**이며 CI 대기는 별도다. 초과가 예상되면 독립적인 하위 카드로 나눈다.

검증 표기 C/H/D/P/W는 [공통 검증 프로필](execution.md#공통-검증-프로필)이다. 경로의 `(신규)`는 앞으로 만들 파일이다. 완료 시 구현 SHA·CI·실제 결과·제약을 해당 카드에 연결한다. 배포 후보 카드도 릴리스 태그 생성 권한은 포함하지 않는다.

현재 우선 대기열: **D001 → D108 → D008 → D105 → D115**, 이후 남은 번호순. 뒤쪽 후보에서 재현한 정확성 문제를 앞당긴 순서이며 카드 번호를 날짜로 해석하지 않는다.

## 1. 연결 안정성과 첫 사용 · D001–D020

<a id="d001"></a>

### D001 연결 A → B → A 쿼리 탭 복구

- 상태: READY · 선행: 없음
- 사용자 변화와 범위: 이전 연결 탭으로 돌아와 바로 조회한다. 단일 활성 연결 모델을 유지하고 실행 직전 해당 연결을 확보한다. 연결 실패 때 다른 DB에서 SQL을 실행하지 않는다.
- 수정 위치: `src/managers/connectionManager.ts`, `src/webview/QueryTabPanel.ts`
- 검증: C/H/D · SQLite 파일 A/B에 각각 marker='A'/'B'를 넣고 두 탭에서 왕복 SELECT. 마지막 A 결과가 A이며 B가 아니다. 연결 실패·삭제된 연결도 확인한다.
- 완료/증거: 왕복 재현의 변경 전/후 결과와 연결 실패 시 실행 0회. 여러 동시 연결 풀은 제외.

<a id="d002"></a>

### D002 이미 연결된 대상을 선택할 때 재접속 방지

- 상태: PLANNED · 선행: D001
- 사용자 변화와 범위: 현재 활성 연결을 같은 탭에서 다시 선택할 때 불필요한 disconnect/connect를 생략한다. 자격증명 편집 뒤 재접속은 유지한다.
- 수정 위치: `src/managers/connectionManager.ts`, `src/webview/QueryTabPanel.ts`
- 검증: C/H/D · PostgreSQL에서 같은 연결 재선택 전후 pg_backend_pid() 비교. 연결 설정을 바꿨을 때는 새 세션인지 확인한다.
- 완료/증거: 세션 유지/교체 두 경우의 PID와 호출 횟수. 연결 캐시 전면 재설계는 제외.

<a id="d003"></a>

### D003 같은 탭의 중복 쿼리 실행 차단

- 상태: PLANNED · 선행: D001
- 사용자 변화와 범위: 버튼 비활성화와 별도로 Host에서 실행 중 요청을 막는다. 파라미터 제출과 Ctrl+Enter도 같은 경계를 사용한다.
- 수정 위치: `src/webview/QueryTabPanel.ts`
- 검증: C/H/D · SELECT pg_sleep(2)를 실행하고 버튼/단축키/동일 메시지를 반복. 서버 실행은 1회이며 실패 뒤 다음 SELECT 1은 가능해야 한다.
- 완료/증거: 중복 요청 회귀 검사와 실패 후 isExecuting 복구. 다른 탭 동시성은 다음 카드.

<a id="d004"></a>

### D004 실행 중 다른 연결로 전환하는 동작 정리

- 상태: PLANNED · 선행: D002, D003
- 사용자 변화와 범위: 현재 쿼리를 끊는 연결 전환은 완료 후 재시도 안내로 막는다. 취소 API가 생기기 전 암묵적으로 끊지 않는다.
- 수정 위치: `src/managers/connectionManager.ts`, `src/webview/QueryTabPanel.ts`
- 검증: C/H/D · A에서 pg_sleep(2) 중 B 선택. B 실행/연결이 시작되지 않고 이유가 표시되며 A 완료 뒤 전환 가능. 오류 경로에서도 잠금이 해제된다.
- 완료/증거: 실행 수명과 전환 상태 검사. 사용자 전체 DB 세션 강제 종료는 제외.

<a id="d005"></a>

### D005 실행 중 내부 쿼리 탭 닫기 보호

- 상태: PLANNED · 선행: D003
- 사용자 변화와 범위: 확장 안의 탭 X/Ctrl+W가 실행 중 탭의 상태를 잃지 않게 한다. 실행 중 닫기 요청은 완료 후 재시도 안내를 표시한다.
- 수정 위치: `src/webview/QueryTabPanel.ts`
- 검증: C/H/D · 긴 쿼리 중 내부 탭 닫기 요청, 완료/오류 후 닫기를 각각 수행한다. 닫힌 탭으로 결과를 보내는 예외가 없어야 한다.
- 완료/증거: 내부 탭과 VS Code Webview 전체 닫기의 차이를 문서화. native 탭 닫기 차단을 보장하지 않는다.

<a id="d006"></a>

### D006 수정한 SQL의 내부 탭 닫기 확인

- 상태: PLANNED · 선행: D005
- 사용자 변화와 범위: 쿼리 초안이 바뀐 내부 탭을 닫을 때 버리기/계속 편집을 선택한다. 이름 변경이나 결과 갱신을 dirty로 취급하지 않는다.
- 수정 위치: `src/webview/QueryTabPanel.ts`
- 검증: C/H · SQL 입력 → 닫기 → 취소하면 SQL/커서 유지. 버리면 해당 탭만 닫힘. 새 빈 탭은 확인 없이 닫힌다.
- 완료/증거: 키보드/마우스 동작과 dirty 전이 검사. 자동 디스크 저장은 제외.

<a id="d007"></a>

### D007 연결 배지와 상태바의 상태 일치

- 상태: PLANNED · 선행: D001, D004
- 사용자 변화와 범위: 연결 실패·명시적 끊기·다른 탭 전환 때 연결명만으로 성공처럼 보이지 않게 한다. 연결됨/연결 중/끊김을 문자와 아이콘으로 구분한다.
- 수정 위치: `src/webview/QueryTabPanel.ts`, `src/extension.ts`
- 검증: C/H · 실패하는 localhost 테스트 포트, 정상 SQLite, 명시적 disconnect를 차례로 수행. 탭 배지와 상태바가 실제 활성 연결과 일치해야 한다.
- 완료/증거: 세 상태의 화면과 복구 결과. 연결 색상만으로 상태를 전달하지 않는다.

<a id="d008"></a>

### D008 연결 오류의 비밀값 제거와 원인 분류

- 상태: PLANNED · 선행: 없음
- 사용자 변화와 범위: 연결 오류를 인증 실패/주소·포트/timeout/SSH로 나누고 안전한 다음 행동을 안내한다. URI·비밀번호·키 내용은 사용자 메시지에서 제거한다.
- 수정 위치: `src/utils/connectionError.ts (신규)`, `src/managers/connectionManager.ts`
- 검증: C/H · 예약 도메인과 로컬 닫힌 포트, 합성 자격증명 문자열을 포함한 오류 입력. 사용자 메시지·로그에 원문 비밀값이 없고 원인 코드가 유지되는지 확인한다.
- 완료/증거: 원인별 fixture와 삭제된 필드 목록. 임의 서버 오류 전문 자동 전송은 제외.

<a id="d009"></a>

### D009 안전한 진단 OutputChannel 제공

- 상태: PLANNED · 선행: D008
- 사용자 변화와 범위: 연결 실패에 '진단 보기' 행동을 제공하고 원인 코드·단계·시간을 한 채널에서 본다. 기본 로그는 SQL/호스트/행/자격증명을 담지 않는다.
- 수정 위치: `src/utils/diagnostics.ts (신규)`, `src/extension.ts`, `src/managers/connectionManager.ts`
- 검증: C/H · 인증 오류 후 채널 열기. 합성 비밀값 검색 결과 0건, 반복 활성화 시 채널 중복 0개, 확장 종료 시 dispose 확인.
- 완료/증거: 가려진 로그 예와 실제 탐색 동작. 텔레메트리와 자동 업로드는 제외.

<a id="d010"></a>

### D010 연결 안정성 배포 후보의 회귀 시나리오

- 상태: PLANNED · 선행: D001, D002, D003, D004, D005, D006, D007, D008, D009
- 사용자 변화와 범위: A/B 왕복·중복 실행·실패 후 복구의 사용자 시나리오를 묶고 확인한 변경만 배포 노트 후보에 쓴다.
- 수정 위치: `src/test/host/queryLifecycle.test.ts (신규)`, `docs/engineering/case-studies.md`, `CHANGELOG.md`
- 검증: C/H/D/P · 3개 대표 시나리오를 다시 수행하고 전체 호환 CI를 확인한다. 느린 검사를 의미 없이 중복 실행하지 않는다.
- 완료/증거: 구현 SHA/CI/실제 화면, 다음 10개 우선순위. 버전·태그·Marketplace 게시 자동 실행은 제외.

<a id="d011"></a>

### D011 서버 없이 여는 샘플 SQLite 명령

- 상태: PLANNED · 선행: D001
- 사용자 변화와 범위: 샘플 SQLite 생성/열기 명령을 만든다. 확장 전용 저장소의 고정 샘플 경로만 사용하고 기존 사용자 DB를 덮어쓰지 않는다.
- 수정 위치: `src/commands/index.ts`, `src/utils/demoDatabase.ts (신규)`, `package.json`
- 검증: C/H/P · 새 프로필에서 명령 실행 후 SELECT 1. 두 번 실행해도 사용자 파일이 바뀌지 않고 샘플 연결 중복이 생기지 않는다.
- 완료/증거: 파일 경계/재실행 회귀와 첫 실행 화면. 샘플 데이터 확장은 D012.

<a id="d012"></a>

### D012 한글 주문 예제 데이터와 JOIN 쿼리

- 상태: PLANNED · 선행: D011
- 사용자 변화와 범위: customers/products/orders 3개 테이블과 소량의 합성 한글 데이터, FK, 첫 JOIN 예제를 넣는다. 데이터는 재현 가능하고 실제 고객 정보가 없다.
- 수정 위치: `src/utils/demoDatabase.ts`, `resources/samples/orders.sql (신규)`
- 검증: C/H/D/P · 초기 데이터 수와 FK 검증. 주문 합계 JOIN의 정확한 예상 행을 고정하며 예제를 두 번 준비해도 데이터가 중복되지 않는다.
- 완료/증거: 예제 SQL·기대 결과·리셋 범위. reset은 샘플 파일만 명시적으로 확인 후 수행.

<a id="d013"></a>

### D013 실제 성공과 연결된 기본 Walkthrough

- 상태: PLANNED · 선행: D012
- 사용자 변화와 범위: 샘플 열기/쿼리 실행/결과 확인의 3단계 안내를 만든다. 성공 context event로만 완료 처리하며 실패한 명령 호출은 완료가 아니다.
- 수정 위치: `package.json`, `src/commands/index.ts`, `src/locales/ko.json`
- 검증: C/H/P · 신규 프로필에서 실패 경로와 성공 경로를 수행. 실행 오류는 미완료, JOIN 결과 확인 후 해당 단계만 완료된다.
- 완료/증거: 3단계 실제 화면과 최소 1.85 API 호환 확인. 긴 안내 문서/새 Webview는 제외.

<a id="d014"></a>

### D014 DB 종류별 연결 폼 인라인 검증

- 상태: PLANNED · 선행: 없음
- 사용자 변화와 범위: SQLite 파일 경로와 서버 DB의 host/port 등 필요한 필드만 검증한다. 비어 있는 기존 저장 비밀번호는 유지 의미를 보존한다.
- 수정 위치: `src/webview/ConnectionFormPanel.ts`, `src/utils/connectionValidation.ts (신규)`
- 검증: C/H · SQLite host 공란은 허용, 서버 port 0/65536/문자열은 저장 전 거절. 오류 필드로 포커스 이동하고 입력값이 남는다.
- 완료/증거: DB별 유효/무효 입력과 수정 후 저장 결과. 모든 폼 재작성은 제외.

<a id="d015"></a>

### D015 저장과 저장 후 연결 행동 구분

- 상태: PLANNED · 선행: D014, D001
- 사용자 변화와 범위: '저장'은 메타데이터 보관, '저장 후 연결'은 실제 연결까지 수행하도록 명확히 한다. 기본 버튼·상태 문구와 Host 경로를 맞춘다.
- 수정 위치: `src/webview/ConnectionFormPanel.ts`, `src/managers/connectionManager.ts`
- 검증: C/H/D · 닫힌 테스트 포트로 저장은 성공, 연결은 실패 표시. 정상 DB에서 두 버튼의 실제 connect 호출 횟수를 확인한다.
- 완료/증거: 버튼별 저장·연결 결과와 재편집 유지. 실패한 연결을 성공으로 표시하지 않는다.

<a id="d016"></a>

### D016 연결 테스트의 진행·실패·재시도 UX

- 상태: PLANNED · 선행: D008, D014
- 사용자 변화와 범위: 테스트 중 중복 요청을 막고 완료/실패를 폼 안에 표시한다. 실패해도 필드를 초기화하지 않으며 저장된 비밀번호 공란 유지 동작을 지킨다.
- 수정 위치: `src/webview/ConnectionFormPanel.ts`, `src/managers/connectionManager.ts`
- 검증: C/H/D · 기존 인증정보 연결을 공란으로 테스트, 잘못된 포트로 실패 후 수정해 재시도. 버튼이 항상 정상 상태로 돌아온다.
- 완료/증거: 공란 비밀번호 Host 회귀와 두 차례 UI 실행. 테스트 결과에 비밀값은 제외.

<a id="d017"></a>

### D017 빈 화면에서 다음 행동 안내

- 상태: PLANNED · 선행: D012
- 사용자 변화와 범위: 연결 없음/히스토리 없음/아직 실행 안 한 탭에 각각 샘플 열기·쿼리 실행 등 해당 맥락의 행동을 제공한다. 정상 빈 결과와 미실행은 구분한다.
- 수정 위치: `package.json`, `src/views/queryHistoryView.ts`, `src/webview/QueryTabPanel.ts`
- 검증: C/H · 새 프로필, SELECT 결과 0행, 히스토리 삭제 세 상태 확인. 안내 명령이 정확히 한 번 실행된다.
- 완료/증거: 세 상태 화면과 명령 연결. 기능 소개 배너를 모든 화면에 반복하지 않는다.

<a id="d018"></a>

### D018 반복 환영 알림을 줄이고 다시 찾기 제공

- 상태: PLANNED · 선행: D013
- 사용자 변화와 범위: 최초 사용에는 안내 진입점을 제공하고 매 활성화 환영 알림은 제거한다. 사용자는 명령 팔레트에서 안내를 다시 열 수 있다.
- 수정 위치: `src/extension.ts`, `package.json`
- 검증: C/H/P · 동일 프로필 3회 재시작 시 환영 알림 반복 0회. 안내 재열기 명령은 동작하고 언어 변경 뒤에도 찾을 수 있다.
- 완료/증거: 첫/두 번째 활성화 결과. 설치 때 원치 않는 복수 Webview 자동 열기는 제외.

<a id="d019"></a>

### D019 명령과 설정의 한·영 현지화

- 상태: PLANNED · 선행: D013, D018
- 사용자 변화와 범위: 명령 제목·뷰 이름·핵심 설정 설명을 VS Code manifest 현지화로 이동한다. 내부 command ID는 유지한다.
- 수정 위치: `package.json`, `package.nls.json (신규)`, `package.nls.ko.json (신규)`
- 검증: C/H/P · en/ko 프로필에서 같은 command ID 검색·실행, 번역 키 누락과 fallback 검사. 단축키 문구도 실제 binding과 맞춘다.
- 완료/증거: 한·영 명령/설정 화면과 키 동등성. 문구만 번역하고 ID를 바꾸지 않는다.

<a id="d020"></a>

### D020 설치 후 첫 JOIN까지의 체험 가이드

- 상태: PLANNED · 선행: D011, D012, D013, D014, D015, D016, D017, D018, D019
- 사용자 변화와 범위: 새 사용자가 서버 설치 없이 예제 JOIN을 실행하는 짧은 한·영 안내와 실제 화면을 만든다. 첫 성공 목표 2분을 실제 측정한다.
- 수정 위치: `README.md`, `docs/guides/first-query.md (신규)`, `resources/first-query.png (신규)`
- 검증: W/H · 새 테스트 프로필에서 문서 순서만 따라 수행. 클릭 수·걸린 시간·막힌 지점을 기록하고 실패하면 안내를 수정한다.
- 완료/증거: 실제 캡처와 실행 기록. 내부 검증을 사용자 인터뷰로 쓰지 않으며 미출시 기능은 구분한다.

## 2. UI 경계와 실행 취소 · D021–D040

<a id="d021"></a>

### D021 연결 폼의 label과 키보드 순서

- 상태: PLANNED · 선행: D014
- 사용자 변화와 범위: 입력 label 연결, 오류 설명 연결, Tab 순서와 키보드 버튼 실행을 정리한다. 색상 선택도 이름과 현재 선택 상태를 읽을 수 있게 한다.
- 수정 위치: `src/webview/ConnectionFormPanel.ts`
- 검증: C/H · 마우스 없이 DB 종류 선택 → 필수 입력 → 테스트 → 저장. 오류 뒤 포커스가 사라지지 않고 한·영 label이 연결된다.
- 완료/증거: 실제 키보드 순서와 접근성 트리 확인. 전체 화면 리디자인은 제외.

<a id="d022"></a>

### D022 쿼리 탭 다시 그리기 후 포커스 보존

- 상태: PLANNED · 선행: D006, D007
- 사용자 변화와 범위: 결과·연결 배지 갱신 때문에 SQL 입력 위치와 선택 범위가 초기화되지 않게 한다. HTML 전체 갱신을 필요한 한 경로부터 줄인다.
- 수정 위치: `src/webview/QueryTabPanel.ts`
- 검증: C/H · SQL 중간에 커서를 두고 배지/결과 갱신, A/B 탭 왕복. 선택 영역과 스크롤이 유지되고 한글 조합 입력이 끊기지 않는다.
- 완료/증거: 커서·한글 입력의 실제 전후 동작. 모든 Webview 렌더러 교체는 제외.

<a id="d023"></a>

### D023 결과 그리드 키보드 이동과 편집 진입

- 상태: PLANNED · 선행: 없음
- 사용자 변화와 범위: 읽기 셀 이동, 셀 내용 복사, 편집 가능한 셀의 진입/취소를 키보드로 제공한다. 현재 결과 그리드 하나에만 적용한다.
- 수정 위치: `src/webview/QueryResultPanel.ts`
- 검증: C/H · 방향키/Tab/Enter/Escape와 한글 셀을 확인. 읽기 전용 셀에서 편집 요청이 생기지 않고 이동 후 현재 셀을 식별한다.
- 완료/증거: 키 조합별 기대 동작과 실제 포커스. TableEditor 전체 동시 변경은 제외.

<a id="d024"></a>

### D024 결과 패널의 밝음·어두움·고대비 대응

- 상태: PLANNED · 선행: D023
- 사용자 변화와 범위: 한 결과 패널의 하드코딩 색을 VS Code theme token으로 바꾸고 선택·오류·NULL 표시에 문자/모양을 더한다.
- 수정 위치: `src/webview/QueryResultPanel.ts`
- 검증: C/H · light/dark/high contrast에서 선택 셀, 오류, NULL, 읽기 전용 표시를 확인. 확대 200%에서 핵심 버튼이 가려지지 않는다.
- 완료/증거: 세 테마 실제 화면과 대비 문제 수정. 나머지 14개 패널은 별도 후속 범위.

<a id="d025"></a>

### D025 연결 저장 메시지의 런타임 검증

- 상태: PLANNED · 선행: D014
- 사용자 변화와 범위: Webview의 save/test 명령을 Host에서 구조·DB 타입·port·문자열 길이로 검증한다. TypeScript cast만으로 신뢰하지 않는다.
- 수정 위치: `src/utils/webviewMessages.ts (신규)`, `src/webview/ConnectionFormPanel.ts`
- 검증: C/H · null/배열/알 수 없는 DB/문자열 port/과도한 필드를 직접 전달. 잘못된 메시지는 저장·접속 0회이며 정상 폼은 동작한다.
- 완료/증거: 잘못된 메시지 회귀와 사용자에게 보이는 안전한 오류. 입력값 자체는 로그에 남기지 않는다.

<a id="d026"></a>

### D026 쿼리 실행 메시지의 탭·SQL 검증

- 상태: PLANNED · 선행: D025, D003
- 사용자 변화와 범위: 존재하는 tabId, SQL 타입·길이, 파라미터 모양을 확인한 뒤만 실행한다. 읽기 전용 경계는 최종 치환 SQL에도 유지한다.
- 수정 위치: `src/utils/webviewMessages.ts`, `src/webview/QueryTabPanel.ts`
- 검증: C/H/D · 미존재 tabId/객체 SQL/과도한 SQL/허용되지 않은 변수 값 입력은 실행 0회. 정상 SELECT와 쓰기 차단 회귀 확인.
- 완료/증거: Host 경계 검사와 실제 DB 실행 횟수. 허용 길이는 기존 사용을 고려해 문서화한다.

<a id="d027"></a>

### D027 행 편집 메시지의 컬럼과 키 경계 검증

- 상태: PLANNED · 선행: D025
- 사용자 변화와 범위: 컬럼·PK·행 값 메시지를 현재 테이블의 메타데이터와 대조한다. 요청이 보낸 임의 테이블/컬럼을 그대로 쓰지 않는다.
- 수정 위치: `src/utils/webviewMessages.ts`, `src/webview/TableEditorPanel.ts`
- 검증: C/H/D · 없는 컬럼, PK 누락, 변조한 tableName, 객체 값 메시지는 UPDATE 0회. 정상 단일 행 변경은 1행만 반영한다.
- 완료/증거: 실제 전후 행 수와 거절 fixture. 바인딩 전환은 D077/D078로 분리.

<a id="d028"></a>

### D028 읽기 전용에서 불가능한 행동의 이유 표시

- 상태: PLANNED · 선행: D023, D026, D027
- 사용자 변화와 범위: 저장/삭제/삽입의 비활성 이유와 읽기 전용 상태를 한·영으로 설명한다. UI 차단과 별도로 공통 실행 경계 검사를 유지한다.
- 수정 위치: `src/webview/QueryTabPanel.ts`, `src/webview/TableEditorPanel.ts`
- 검증: C/H/D · 읽기 전용 연결에서 버튼·키보드·직접 메시지 모두 쓰기 0회. 조회와 결과 복사는 가능해야 한다.
- 완료/증거: 비활성 이유 화면과 우회 요청 통합 검사. 읽기 전용 자동 해제는 제외.

<a id="d029"></a>

### D029 결과의 로딩·빈 결과·제한·오류 상태 구분

- 상태: PLANNED · 선행: D023
- 사용자 변화와 범위: 한 결과 패널에서 미실행/실행 중/0행/제한됨/실패를 다른 문구와 행동으로 표시한다. 이전 결과가 새 실행 성공처럼 보이지 않게 한다.
- 수정 위치: `src/webview/QueryResultPanel.ts`
- 검증: C/H/D · SELECT 0행, 제한 초과, 구문 오류, 정상 재실행을 순서대로 수행. stale 결과에는 이전 실행임이 표시된다.
- 완료/증거: 5개 상태 화면과 재시도 결과. 새 차트·새 탭 기능은 제외.

<a id="d030"></a>

### D030 행 삭제 확인에 대상과 영향 표시

- 상태: PLANNED · 선행: D027, D028
- 사용자 변화와 범위: 삭제 전 테이블·선택 건수·PK 요약을 확인한다. 취소는 DB 호출 없이 끝나고 실행 결과의 실제 영향 건수를 보여준다.
- 수정 위치: `src/webview/TableEditorPanel.ts`
- 검증: C/H/D · 2행 선택 취소 시 0행 변경, 승인 시 정확히 2행 삭제. PK 없는 테이블은 무제한 DELETE로 대체하지 않는다.
- 완료/증거: 확인/취소/실패의 실제 DB 전후 값과 다음 10개 우선순위. 여러 파괴 명령 통합 UI는 제외.

<a id="d031"></a>

### D031 PostgreSQL 자기 쿼리 취소 컴포넌트

- 상태: PLANNED · 선행: D004
- 사용자 변화와 범위: 실행 핸들과 자신의 backend PID를 연결한 취소 계약을 추가한다. 해당 연결의 현재 실행만 취소하며 다른 세션 ID를 UI 입력으로 받지 않는다.
- 수정 위치: `src/types/database.ts`, `src/providers/postgresProvider.ts`
- 검증: C/D · 자신의 SELECT pg_sleep(10)을 취소하고 별도 연결의 pg_sleep은 유지. 다음 SELECT 1은 정상. 경쟁 요청/이미 끝난 요청의 취소도 확인한다.
- 완료/증거: 소유권·수명 검사와 실제 서버 응답. UI는 D032 전까지 노출하지 않는다.

<a id="d032"></a>

### D032 PostgreSQL 실행 취소 버튼과 상태 복구

- 상태: PLANNED · 선행: D031, D003, D026
- 사용자 변화와 범위: PostgreSQL에서 실행 중 취소 버튼을 제공하고 취소 중/취소됨/실패를 구분한다. 완료 뒤 늦은 취소가 다음 쿼리에 적용되지 않게 한다.
- 수정 위치: `src/webview/QueryTabPanel.ts`, `src/managers/connectionManager.ts`
- 검증: C/H/D · pg_sleep 취소 후 즉시 SELECT 1, 완료와 취소 동시 요청, 두 번 취소. 버튼/실행 잠금/오류 상태가 회복된다.
- 완료/증거: 실제 취소 화면과 요청 ID 회귀. 다른 DB에 작동하지 않는 버튼은 노출하지 않는다.

<a id="d033"></a>

### D033 MySQL 자기 쿼리 취소 컴포넌트

- 상태: PLANNED · 선행: D031
- 사용자 변화와 범위: 현재 실행 세션에 한정된 query 취소를 구현한다. 별도 제어 연결의 권한·SSH 경로·해제를 처리하고 전체 세션 종료와 구분한다.
- 수정 위치: `src/providers/mysqlProvider.ts`, `src/types/database.ts`
- 검증: C/D · 자신의 SELECT SLEEP(10)만 취소, 별도 세션 유지, 다음 SELECT 1 정상. 권한 부족·연결 종료·늦은 취소를 확인한다.
- 완료/증거: thread 소유권과 제어 연결 누수 검사. 서버 전체 PROCESSLIST 종료는 제외.

<a id="d034"></a>

### D034 MySQL 취소 UX 연결

- 상태: PLANNED · 선행: D032, D033
- 사용자 변화와 범위: 검증한 MySQL 취소를 기존 취소 상태에 연결한다. DB별 실패 문구와 재실행 행동을 제공한다.
- 수정 위치: `src/webview/QueryTabPanel.ts`, `src/managers/connectionManager.ts`
- 검증: C/H/D · SLEEP 취소·취소 실패·쿼리 먼저 완료를 실제 수행. 한 탭의 취소가 다른 탭의 실행 ID를 사용하지 않는다.
- 완료/증거: MySQL UI/서버 결과, PostgreSQL 회귀. 아직 미지원 DB의 취소 성공을 가장하지 않는다.

<a id="d035"></a>

### D035 실행 전 대기 요청의 취소

- 상태: PLANNED · 선행: D032, D034
- 사용자 변화와 범위: 연결/실행 순서를 기다리는 요청은 서버에 보내기 전에 취소할 수 있게 한다. 대기 취소와 서버 실행 취소를 구분한다.
- 수정 위치: `src/managers/connectionManager.ts`, `src/webview/QueryTabPanel.ts`
- 검증: C/H/D · 앞 요청이 지연되는 동안 뒤 요청을 취소. 뒤 SQL의 서버 실행은 0회, 다음 정상 요청은 진행된다.
- 완료/증거: 순서·취소·오류 후 큐 해제 검사. 범용 작업 스케줄러 도입은 제외.

<a id="d036"></a>

### D036 timeout·취소·연결 끊김의 구분

- 상태: PLANNED · 선행: D032, D034, D008
- 사용자 변화와 범위: 긴 쿼리 실패를 timeout/사용자 취소/연결 끊김으로 분류한다. 재연결 후 자동 쓰기 재시도는 하지 않으며 사용자가 다음 행동을 선택한다.
- 수정 위치: `src/utils/connectionError.ts`, `src/webview/QueryTabPanel.ts`
- 검증: C/H/D · 1초 timeout의 3초 sleep, 사용자 취소, 테스트 DB 연결 종료를 각각 재현. 문구/코드가 다르고 읽기 재실행은 정상이다.
- 완료/증거: 원인별 실제 응답과 중복 쓰기 0회. 테스트 외 세션 종료는 제외.

<a id="d037"></a>

### D037 SQLite 읽기 worker의 실행 계약

- 상태: PLANNED · 선행: D031
- 사용자 변화와 범위: 복사된 샘플 DB 스냅샷에서 제한된 읽기 쿼리를 실행하는 worker 컴포넌트만 만든다. 요청 ID·결과 한도·오류·종료 계약을 고정한다.
- 수정 위치: `src/providers/sqliteReadWorker.ts (신규)`, `src/providers/sqliteWorkerClient.ts (신규)`
- 검증: C/D/P · 같은 샘플의 SELECT를 기존 sql.js와 비교, worker 종료/잘못된 SQL/대량 결과 한도 검사. VSIX에서 WASM 경로를 확인한다.
- 완료/증거: 실험 컴포넌트의 계약과 결과 일치. 기존 쓰기·트랜잭션을 worker로 옮기지 않는다.

<a id="d038"></a>

### D038 SQLite worker 읽기 경로의 제한적 연결

- 상태: PLANNED · 선행: D037
- 사용자 변화와 범위: 읽기 전용 단일 SELECT 경로에만 worker를 연결하고 현재 파일/메모리 상태의 스냅샷을 사용한다. 혼합 문장과 미커밋 트랜잭션은 명시적으로 제외한다.
- 수정 위치: `src/providers/sqliteProvider.ts`, `src/providers/sqliteWorkerClient.ts`
- 검증: C/H/D/P · 쓰기 후 최신 스냅샷 조회, 한글/NULL/숫자 결과 비교, 혼합 SQL fallback/거절 확인. 지원 범위를 문서화한다.
- 완료/증거: 기존 동기 경로와 결과 동등성·파일 보존. 모든 SQLite 병렬화 주장은 제외.

<a id="d039"></a>

### D039 SQLite worker 취소와 자원 정리

- 상태: PLANNED · 선행: D038, D032
- 사용자 변화와 범위: 지원하는 SQLite 읽기 작업은 worker 종료로 취소한다. UI에 적용 범위를 표시하고 종료 후 새 worker로 재실행한다.
- 수정 위치: `src/providers/sqliteWorkerClient.ts`, `src/webview/QueryTabPanel.ts`
- 검증: C/H/D/P · 큰 recursive SELECT 취소 후 SELECT 1. 반복 실행/취소 10회 뒤 worker 수가 늘지 않고 원본 DB가 변하지 않는다.
- 완료/증거: 실제 취소·다음 실행·자원 수 기록. 미지원 SQL은 취소 가능하다고 표시하지 않는다.

<a id="d040"></a>

### D040 취소와 Extension Host 응답성 측정

- 상태: PLANNED · 선행: D032, D034, D035, D036, D039
- 사용자 변화와 범위: PG/MySQL 취소의 세션 격리와 SQLite 읽기 worker의 Host 응답을 같은 재현으로 기록한다. 실패 시 새 기능보다 원인 수정을 우선한다.
- 수정 위치: `docs/engineering/case-studies.md`, `src/test/integration/connectionLifecycle.test.ts`
- 검증: C/H/D/P/W · 서버 sleep, 별도 연결의 SELECT 1, SQLite 큰 읽기 중 명령 응답을 실제 측정. 반복 횟수·버전·환경·실패도 기록한다.
- 완료/증거: 원자료와 구현 SHA/CI를 연결한 사례. 실측 없는 개선 비율과 자동 Marketplace 게시는 제외.

## 3. 큰 결과와 데이터 이동 · D041–D060

<a id="d041"></a>

### D041 페이지 조회와 결과 제한의 계약 분리

- 상태: PLANNED · 선행: D029
- 사용자 변화와 범위: 테이블 페이지 요청/응답에 pageSize·cursor·hasMore·제한 이유를 정의한다. 기존 임의 SQL 결과와 구분하고 정확히 모르는 전체 행 수는 optional로 둔다.
- 수정 위치: `src/types/database.ts`, `src/utils/queryLimits.ts`
- 검증: C · 0행/1페이지/다음 페이지/무효 cursor/과도한 pageSize 경계 검사. 기존 QueryResult 소비자의 타입 호환을 확인한다.
- 완료/증거: 한도와 total 의미를 설명한 계약. SQL 문자열에 임의 OFFSET을 붙이는 기능은 제외.

<a id="d042"></a>

### D042 MySQL 단일 PK 테이블 페이지 조회

- 상태: PLANNED · 선행: D041
- 사용자 변화와 범위: 단일 PK가 있는 테이블의 고정 크기 keyset 조회를 구현한다. 테이블·컬럼 식별자는 메타데이터와 대조하고 cursor 값을 바인딩한다.
- 수정 위치: `src/providers/mysqlProvider.ts`, `src/types/database.ts`
- 검증: C/D · PK 1~105행을 20행씩 조회해 누락/중복 없이 종료. PK 없는 테이블/변조 cursor는 지원 범위를 안내하고 초과 조회하지 않는다.
- 완료/증거: 실제 반환 ID 목록과 마지막 hasMore. 복합 PK·임의 SQL 페이지는 후속 범위.

<a id="d043"></a>

### D043 PostgreSQL 단일 PK 테이블 페이지 조회

- 상태: PLANNED · 선행: D041
- 사용자 변화와 범위: PostgreSQL의 schema-qualified 테이블과 단일 PK keyset 조회를 구현한다. 정렬 키의 타입과 NULL 불가 조건을 확인한다.
- 수정 위치: `src/providers/postgresProvider.ts`, `src/types/database.ts`
- 검증: C/D · non-public schema의 105행을 20행씩 읽고 모든 ID 일치. 따옴표 식별자·잘못된 cursor·읽기 전용을 확인한다.
- 완료/증거: 다른 스키마 충돌 없는 실제 ID/범위 검사. 복합 PK는 제외.

<a id="d044"></a>

### D044 SQLite 단일 PK 테이블 페이지 조회

- 상태: PLANNED · 선행: D041
- 사용자 변화와 범위: SQLite 단일 PK의 bounded 페이지를 구현한다. 메모리에 전체 결과를 먼저 읽은 뒤 자르는 방식은 사용하지 않는다.
- 수정 위치: `src/providers/sqliteProvider.ts`, `src/types/database.ts`
- 검증: C/D/P · 105행/20행 페이지와 마지막 빈 조회, 한글 키·무효 cursor를 확인. 원본 파일은 읽기로 바뀌지 않는다.
- 완료/증거: 반환 ID와 읽은 행 상한. implicit rowid·복합 PK 지원은 별도 판단.

<a id="d045"></a>

### D045 테이블 페이지 이동 UI

- 상태: PLANNED · 선행: D042, D043, D044
- 사용자 변화와 범위: 지원하는 단일 PK 테이블에 다음/이전 페이지와 페이지 크기, 로딩·마지막 페이지를 표시한다. 페이지를 바꿀 때 선택 상태를 정리한다.
- 수정 위치: `src/webview/TableEditorPanel.ts`
- 검증: C/H/D · 105행을 왕복하고 버튼 연타/오류/테이블 변경을 확인. 다른 페이지의 선택 행이 삭제·편집 대상으로 남지 않는다.
- 완료/증거: 실제 3개 DB 페이지 동작. 알 수 없는 총 행 수를 '전체 N행'으로 표시하지 않는다.

<a id="d046"></a>

### D046 결과 그리드 렌더링 행 수 제한

- 상태: PLANNED · 선행: D023, D041
- 사용자 변화와 범위: 한 결과 패널의 행 렌더링을 제한된 창으로 분리한다. 첫 화면 전체 DOM 생성부터 없애고 행의 안정된 인덱스/포커스 계약을 만든다.
- 수정 위치: `src/webview/QueryResultPanel.ts`, `src/webview/resultWindow.ts (신규)`
- 검증: C/H · 합성 10,000행으로 DOM 행 수 상한, 스크롤 후 셀 값/복사/키보드 이동을 확인. 동일 행이 잘못 편집되지 않는다.
- 완료/증거: DOM 수와 첫 표시 시간의 실제 측정. 전체 패널 프레임워크 교체는 제외하며 범위가 크면 renderer 컴포넌트부터 분리.

<a id="d047"></a>

### D047 숫자 정밀도와 NULL 표시·복사 보존

- 상태: PLANNED · 선행: D023
- 사용자 변화와 범위: 큰 정수·decimal 문자열·NULL·빈 문자열·날짜를 구분해 표시하고 원래 값으로 복사한다. 단순 Number 변환으로 자릿수를 잃지 않는다.
- 수정 위치: `src/utils/valueDisplay.ts (신규)`, `src/webview/QueryResultPanel.ts`
- 검증: C/H/D · 9007199254740993, decimal '123.4500', NULL, 빈 문자열, UTC 날짜의 표시/복사 값을 비교한다. DB driver가 이미 변환한 값의 한계를 명시한다.
- 완료/증거: 값별 round-trip와 driver 설정 범위. 모든 JS 숫자의 정밀도 복구를 보장하지 않는다.

<a id="d048"></a>

### D048 큰 JSON·텍스트 셀의 제한된 보기

- 상태: PLANNED · 선행: D047
- 사용자 변화와 범위: 큰 셀은 요약을 보여주고 사용자가 펼칠 때 제한된 텍스트 뷰어를 연다. 파싱/표시 상한과 전체 복사의 정책을 구분한다.
- 수정 위치: `src/webview/QueryResultPanel.ts`, `src/utils/valueDisplay.ts`
- 검증: C/H · 1MB 합성 JSON/잘못된 JSON/HTML 태그 문자열을 열기·닫기·복사. 스크립트 실행 0회, UI가 멈추지 않고 제한 이유를 표시한다.
- 완료/증거: 실제 큰 셀의 응답과 안전한 표시. 무제한 JSON tree 생성은 제외.

<a id="d049"></a>

### D049 결과 필터·정렬·컬럼 상태의 범위 고정

- 상태: PLANNED · 선행: D046
- 사용자 변화와 범위: 결과 화면의 필터/정렬/숨김 컬럼 상태를 연결·테이블·결과 ID로 구분한다. 새 결과 스키마가 바뀌면 존재하지 않는 컬럼 상태를 버린다.
- 수정 위치: `src/webview/QueryResultPanel.ts`
- 검증: C/H · 같은 컬럼명인 A/B 테이블 전환과 스키마 변경 후 상태를 확인. 원치 않는 다른 연결 필터 공유가 없어야 한다.
- 완료/증거: 서로 다른 결과의 상태 격리 회귀. 원본 데이터/SQL의 영구 저장은 제외.

<a id="d050"></a>

### D050 10만 행 샘플의 페이지·렌더링 측정

- 상태: PLANNED · 선행: D045, D046, D047, D048, D049
- 사용자 변화와 범위: 전용 DB에 재현 가능한 10만 행 fixture를 만들고 페이지/첫 표시/메모리를 측정한다. 확인한 병목 하나의 후속 카드를 정한다.
- 수정 위치: `docs/engineering/case-studies.md`, `src/test/integration/providerAdvanced.test.ts`
- 검증: C/H/D/W · 같은 환경에서 첫/반복 조회를 각각 여러 번 측정. UI DOM 수와 확장 프로세스 메모리를 분리하고 원자료를 보관한다.
- 완료/증거: 환경·샘플·반복 수·전후 실제 수치와 한계. 측정만으로 대량 데이터 전체 지원을 선언하지 않는다.

<a id="d051"></a>

### D051 미리보기와 전체 CSV 내보내기의 계약

- 상태: PLANNED · 선행: D041
- 사용자 변화와 범위: 현재 결과 내보내기와 전체 테이블 CSV의 옵션·진행 수·cancel 계약을 분리한다. 구현 전 전체 버튼을 활성화하지 않는다.
- 수정 위치: `src/types/database.ts`, `src/utils/dataExport.ts`
- 검증: C · preview 제한과 full 대상 구분, 지원 안 하는 DB/PK·파일 오류·취소 상태 검사. 기존 결과 내보내기는 같은 결과를 낸다.
- 완료/증거: 전체/현재 결과의 명확한 사용자 문구. 전체 SQL 백업/복원은 제외.

<a id="d052"></a>

### D052 MySQL 테이블 CSV의 bounded 내보내기

- 상태: PLANNED · 선행: D051, D042
- 사용자 변화와 범위: 지원하는 단일 PK 테이블을 bounded 페이지로 읽어 파일에 순서대로 쓴다. backpressure·파일 오류·취소와 부분 파일 정책을 처리한다.
- 수정 위치: `src/providers/mysqlProvider.ts`, `src/utils/dataExport.ts`
- 검증: C/D · 10,005행을 작은 배치로 내보내고 CSV의 행/한글/NULL 일치, 중간 취소·디스크 오류에서 연결 해제 확인. 변경 중 DB의 snapshot 한계를 명시한다.
- 완료/증거: batch 최대 버퍼와 실제 파일 행 수. 전체 배열 후 writeFile은 제외.

<a id="d053"></a>

### D053 PostgreSQL 테이블 CSV의 bounded 내보내기

- 상태: PLANNED · 선행: D051, D043
- 사용자 변화와 범위: PostgreSQL 단일 PK 테이블의 같은 내보내기 계약을 구현한다. 세션·읽기 전용·schema 이름·취소를 유지한다.
- 수정 위치: `src/providers/postgresProvider.ts`, `src/utils/dataExport.ts`
- 검증: C/D · non-public schema 10,005행의 CSV 일치, 취소·잘못된 경로·SSH 연결 회귀. 동시 변경 때 제공하는 일관성 수준을 기록한다.
- 완료/증거: 실제 파일·세션 정리·오류 처리. 임의 SQL 커서나 전체 DB 백업은 제외.

<a id="d054"></a>

### D054 SQLite 테이블 CSV와 전체 내보내기 진입점

- 상태: PLANNED · 선행: D051, D044, D052, D053
- 사용자 변화와 범위: SQLite의 bounded 테이블 CSV를 연결하고 검증한 DB에만 전체 CSV 메뉴를 제공한다. 현재 결과 내보내기는 별도 이름으로 유지한다.
- 수정 위치: `src/providers/sqliteProvider.ts`, `src/utils/dataExport.ts`, `src/commands/index.ts`
- 검증: C/H/D/P · 3개 DB의 1,000행 초과 CSV가 설정된 preview 한도에 잘리지 않는지 확인. SQLite 파일 변경 0회, 취소 후 부분 파일 안내 확인.
- 완료/증거: 전체/preview 메뉴 화면과 실제 행 수. 복합 PK 등 미지원 범위는 명시.

<a id="d055"></a>

### D055 Excel 내보내기의 크기 한도와 대안

- 상태: PLANNED · 선행: D051
- 사용자 변화와 범위: SheetJS의 전체 workbook 메모리 사용을 고려해 행·셀/추정 크기 한도를 두고 초과 시 CSV를 안내한다. 큰 데이터에서 조용히 잘린 xlsx를 만들지 않는다.
- 수정 위치: `src/utils/dataExport.ts`, `src/commands/index.ts`
- 검증: C/H · 경계 바로 아래/위와 넓은 컬럼 fixture. 초과 때 XLSX 생성이 시작되지 않고 대안·현재 데이터 범위가 표시된다.
- 완료/증거: 실제 한도와 근거, 작은 xlsx의 기존 동작. streaming XLSX로 가장하지 않는다.

<a id="d056"></a>

### D056 한글 CSV의 BOM·구분자 선택

- 상태: PLANNED · 선행: D054
- 사용자 변화와 범위: UTF-8 BOM과 쉼표/탭 구분자를 명시적으로 선택하게 한다. 필드 안의 구분자·따옴표·개행 escaping을 유지한다.
- 수정 위치: `src/utils/dataExport.ts`, `src/commands/index.ts`
- 검증: C/H · 한글/쉼표/따옴표/CRLF/빈 값 fixture를 다시 파싱해 원문 비교. spreadsheet 수식 문자열의 처리 정책도 표시한다.
- 완료/증거: 바이트/round-trip 증거와 옵션 문구. 앱별 인코딩 성공은 실제 열어본 범위만 기록.

<a id="d057"></a>

### D057 가져오기 dry run과 행별 오류 미리보기

- 상태: PLANNED · 선행: 없음
- 사용자 변화와 범위: 쓰기 전 컬럼 매핑·NOT NULL·타입·기본값을 확인하고 처음 N개 오류와 전체 검사 건수를 표시한다. dry run은 실제 INSERT를 호출하지 않는다.
- 수정 위치: `src/utils/dataImport.ts`, `src/webview/DataImportPanel.ts`
- 검증: C/H/D · 한글 CSV 5행 중 필수 값 누락·숫자 오류·없는 컬럼을 넣고 잘못된 행 번호 표시. DB 행 수는 전후 같아야 한다.
- 완료/증거: 정확한 입력/오류/쓰기 0회. 전 DB 타입 추론 재설계는 제외.

<a id="d058"></a>

### D058 MySQL 가져오기 배치 트랜잭션

- 상태: PLANNED · 선행: D057
- 사용자 변화와 범위: MySQL에서 한 배치의 바인딩 값과 트랜잭션 경계를 구현한다. 한 행 실패 시 배치 rollback, 이미 commit한 배치는 별도 건수로 남긴다.
- 수정 위치: `src/providers/mysqlProvider.ts`, `src/utils/dataImport.ts`
- 검증: C/D · 105행/20행 배치와 42번째 행 제약 오류. commit/rollback/오류 행 수가 DB 실제 값과 일치하고 읽기 전용은 전부 차단된다.
- 완료/증거: SQL 실행 횟수·실제 반영 건수·권한 회귀. 모든 DB를 한 번에 바꾸지 않는다.

<a id="d059"></a>

### D059 PostgreSQL 가져오기 배치 트랜잭션

- 상태: PLANNED · 선행: D057, D058
- 사용자 변화와 범위: PostgreSQL의 바인딩 배치·오류 후 rollback·제약 충돌 결과를 구현한다. aborted transaction을 열린 채 남기지 않는다.
- 수정 위치: `src/providers/postgresProvider.ts`, `src/utils/dataImport.ts`
- 검증: C/D · 105행과 중간 제약 오류, non-public schema, 읽기 전용, 실패 뒤 SELECT 1. 보고한 반영 수가 DB와 같아야 한다.
- 완료/증거: MySQL/PostgreSQL 결과 계약 동등성. SQLite/NoSQL 새 배치 기능은 제외.

<a id="d060"></a>

### D060 가져오기 취소·부분 완료·재시도 안내

- 상태: PLANNED · 선행: D058, D059
- 사용자 변화와 범위: 취소하면 다음 배치 전 중단하고 commit된 행/취소된 행/실패 행을 구분한다. 재시도는 중복 정책과 시작 범위를 확인하고 수행한다.
- 수정 위치: `src/utils/dataImport.ts`, `src/webview/DataImportPanel.ts`
- 검증: C/H/D · 3번째 배치 전 취소, 오류 후 재시도, 같은 파일 중복 실행. 화면 건수·DB 건수가 일치하고 무조건 전체 성공으로 보이지 않는다.
- 완료/증거: 취소·부분 commit의 실제 예와 다음 10개 재검토. 원자적 전체 파일 rollback은 지원 여부를 명확히 한다.

## 4. NoSQL과 작업 보존 · D061–D080

<a id="d061"></a>

### D061 Redis 키 목록의 KEYS를 SCAN으로 교체

- 상태: PLANNED · 선행: 없음
- 사용자 변화와 범위: 키 탐색용 API를 SCAN cursor/count로 제한한다. 명시적 사용자가 입력한 KEYS 명령과 기본 탐색 경로를 구분한다.
- 수정 위치: `src/providers/redisProvider.ts`, `src/types/database.ts`
- 검증: C/D · 5,000개 테스트 키로 목록 첫 페이지를 읽고 cursor 반환/읽기 전용/빈 DB 확인. 탐색 경로에서 KEYS 호출 0회.
- 완료/증거: 실제 cursor와 반환 상한. 단일 SCAN이 전체 키를 모두 돌려준다고 가정하지 않는다.

<a id="d062"></a>

### D062 Redis 더 보기와 cursor 상태

- 상태: PLANNED · 선행: D061
- 사용자 변화와 범위: 키 목록에 더 보기/새로고침을 제공하고 연결·DB별 cursor를 유지한다. SCAN의 중복 가능성을 처리하고 cursor가 돌아온 동안의 빈 페이지를 허용한다.
- 수정 위치: `src/views/connectionTreeView.ts`, `src/providers/redisProvider.ts`
- 검증: C/H/D · 5,000키를 끝까지 탐색해 중복 표시 없음. DB 전환·새로고침 후 cursor reset, 삭제/추가 중의 비보장 범위를 안내한다.
- 완료/증거: 실제 키 수와 메모리 상한. 무제한 백그라운드 전체 수집은 제외.

<a id="d063"></a>

### D063 Redis namespace·pattern 필터

- 상태: PLANNED · 선행: D062
- 사용자 변화와 범위: 현재 cursor에 pattern을 적용하고 ':' prefix 그룹을 제한적으로 표시한다. 필터 변경 때 이전 cursor와 결과를 버린다.
- 수정 위치: `src/views/connectionTreeView.ts`, `src/providers/redisProvider.ts`
- 검증: C/H/D · shop:user:*/shop:order:* 키에서 필터 전환. 다른 DB와 결과가 섞이지 않고 검색 범위/로딩 상태가 표시된다.
- 완료/증거: pattern별 실제 키 결과. 전체 DB 키 수를 세기 위한 KEYS는 제외.

<a id="d064"></a>

### D064 Redis TTL의 읽기 전용 표시

- 상태: PLANNED · 선행: D062
- 사용자 변화와 범위: 키를 열 때 TTL 없음/만료됨/남은 시간의 차이를 보여준다. 조회 자체로 TTL을 바꾸지 않는다.
- 수정 위치: `src/providers/redisProvider.ts`, `src/commands/index.ts`
- 검증: C/H/D · TTL=-1, 만료 예정, 조회 직전 사라진 키. TYPE/TTL 경쟁 오류를 처리하고 EXPIRE/PERSIST 호출 0회 확인.
- 완료/증거: 실제 TTL 전후와 만료 경계 화면. TTL 수정 UI는 후속 수요로 분리.

<a id="d065"></a>

### D065 Redis string 값의 제한된 뷰어

- 상태: PLANNED · 선행: D064
- 사용자 변화와 범위: 큰 string은 길이와 제한된 미리보기를 표시한다. binary/UTF-8 표시 정책과 전체 복사를 명확히 한다.
- 수정 위치: `src/commands/index.ts`, `src/webview/QueryResultPanel.ts`
- 검증: C/H/D · 한글/개행/HTML 문자열/1MB 합성 값을 열고 크기 상한·안전한 표시·복사 확인. 키가 사라져도 정상 오류를 표시한다.
- 완료/증거: 실제 바이트 길이와 UI 응답. 모든 Redis 타입을 같은 날 지원하지 않는다.

<a id="d066"></a>

### D066 Redis hash HSCAN 페이지 보기

- 상태: PLANNED · 선행: D062, D065
- 사용자 변화와 범위: hash 한 타입에만 HSCAN cursor 뷰를 추가한다. 공통 읽기 전용 whitelist와 실제 지원 명령을 맞춘다.
- 수정 위치: `src/providers/redisProvider.ts`, `src/utils/readOnlyGuard.ts`, `src/commands/index.ts`
- 검증: C/H/D · 2,005필드 hash를 작은 페이지로 읽고 중복/종료/키 타입 변경 확인. 읽기 전용에서 조회만 허용되며 HSET은 차단된다.
- 완료/증거: 필드 페이지 실제 결과와 명령 정책 회귀. list/set/zset 확대는 다음 후보.

<a id="d067"></a>

### D067 MongoDB 컬렉션의 _id 기반 페이지

- 상태: PLANNED · 선행: D041
- 사용자 변화와 범위: 컬렉션 탐색용 _id cursor를 Host에 BSON 값으로 유지하고 bounded 조회한다. UI 문자열을 JS 표현식으로 실행하지 않는다.
- 수정 위치: `src/providers/mongoProvider.ts`, `src/types/database.ts`
- 검증: C/D · ObjectId 문서 105개를 20개씩 탐색, 새 연결·변조 cursor·섞인 _id 타입은 지원 정책대로 처리한다.
- 완료/증거: 누락/중복 ID 검사와 타입 제한. 임의 aggregate 결과의 일반 페이지는 제외.

<a id="d068"></a>

### D068 MongoDB Extended JSON 표시와 복사

- 상태: PLANNED · 선행: D067, D048
- 사용자 변화와 범위: ObjectId·Date·Decimal128 등의 의미를 Extended JSON으로 보여주고 복사한다. 일반 JSON 문자열로 타입을 잃지 않게 한다.
- 수정 위치: `src/providers/mongoProvider.ts`, `src/webview/QueryResultPanel.ts`
- 검증: C/H/D · ObjectId/UTC Date/Decimal128/큰 문서 fixture를 복사 후 안전한 EJSON parser로 읽어 타입·값 비교. JS eval은 사용하지 않는다.
- 완료/증거: 타입별 실제 round-trip와 큰 문서 제한. 모든 BSON 타입은 지원표로 구분.

<a id="d069"></a>

### D069 MongoDB 집계 입력의 엄격한 JSON 검증

- 상태: PLANNED · 선행: 없음
- 사용자 변화와 범위: 기존 집계 경로의 배열·stage 모양·크기 검증과 오류 위치 안내를 보강한다. 읽기 전용에서 $out/$merge는 계속 차단한다.
- 수정 위치: `src/providers/mongoProvider.ts`, `src/utils/readOnlyGuard.ts`
- 검증: C/D · 정상 match/group, 잘못된 JSON, 중첩 쓰기 stage, 함수/JS 표현식 입력. 거절된 요청은 DB 실행 0회.
- 완료/증거: 오류 입력과 실제 DB 쓰기 0회. 드래그앤드롭 builder는 제외.

<a id="d070"></a>

### D070 MongoDB 제한된 단계 미리보기

- 상태: PLANNED · 선행: D068, D069
- 사용자 변화와 범위: 유효한 JSON pipeline에 대해 선택한 stage까지의 제한된 결과를 본다. pipeline 복사는 로컬 동작이며 실행 전 대상 컬렉션을 표시한다.
- 수정 위치: `src/webview/MongoPipelinePanel.ts (신규)`, `src/commands/index.ts`
- 검증: C/H/D · 합성 주문 문서의 match → group 결과 비교, stage 오류/timeout/읽기 전용 쓰기 stage를 확인한다.
- 완료/증거: 실제 중간 결과와 제한 문구. 시각적 편집·자동 최적화는 제외하며 크면 순수 미리보기 컴포넌트부터 분리.

<a id="d071"></a>

### D071 히스토리 저장 끄기와 보관 개수 설정

- 상태: PLANNED · 선행: 없음
- 사용자 변화와 범위: SQL 히스토리 저장 여부와 최대 개수를 사용자가 정한다. 저장 끄기는 새 기록을 막고 기존 기록 삭제는 별도 확인으로 제공한다.
- 수정 위치: `src/views/queryHistoryView.ts`, `package.json`
- 검증: C/H · opt-out 후 쿼리 실행/재시작해 기록 증가 0건. 개수 축소·기존 내역 삭제/취소를 확인하고 기본값을 문서화한다.
- 완료/증거: 저장소 실제 값과 사용자 동작. 기존 기록을 설정 변경만으로 몰래 삭제하지 않는다.

<a id="d072"></a>

### D072 히스토리의 연결 필터와 검색

- 상태: PLANNED · 선행: D071
- 사용자 변화와 범위: 기존 기록에서 연결과 SQL 텍스트로 찾아 다시 연다. 검색은 로컬에서만 수행하고 삭제된 연결은 명확히 표시한다.
- 수정 위치: `src/views/queryHistoryView.ts`, `src/commands/index.ts`
- 검증: C/H · 연결 A/B의 한글 SQL, 삭제된 연결, 빈 검색 결과를 확인. 선택해도 SQL이 자동 실행되지 않는다.
- 완료/증거: 정확한 필터 결과와 다시 열기. 검색어/SQL의 외부 전송은 제외.

<a id="d073"></a>

### D073 비밀 쿼리 변수의 저장 경계

- 상태: PLANNED · 선행: 없음
- 사용자 변화와 범위: 비밀 변수 값은 SecretStorage에 저장하고 일반 변수 메타데이터와 분리한다. 저장·조회·삭제 계약과 기존 일반 변수 호환을 먼저 만든다.
- 수정 위치: `src/utils/secretQueryVariables.ts (신규)`, `src/webview/QueryTabPanel.ts`
- 검증: C/H · 합성 값을 저장/재시작/삭제. globalState·프로필 JSON·로그에 값 0건, SecretStorage에만 존재. 비밀 누락은 명시적 오류다.
- 완료/증거: 저장소 스냅샷과 삭제 회귀. 아직 UI를 연결하지 않은 컴포넌트임을 명시.

<a id="d074"></a>

### D074 비밀 변수 입력과 실행 기록 보호

- 상태: PLANNED · 선행: D073, D026, D071
- 사용자 변화와 범위: 변수를 비밀로 표시하고 가린 입력을 제공한다. 치환된 실제 비밀값은 히스토리·내보내기·진단에 남기지 않고 원본 template로 기록한다.
- 수정 위치: `src/webview/QueryTabPanel.ts`, `src/views/queryHistoryView.ts`
- 검증: C/H/D · 비밀 변수를 사용한 SELECT 성공 후 세 저장 경로에서 합성 값 0건. 재입력/삭제/미저장 모드와 읽기 전용 최종 SQL 검사 확인.
- 완료/증거: 실행은 성공하지만 기록에는 비밀이 없는 실제 증거. 서버 자체 SQL 로그의 비밀 노출까지 막는다고 주장하지 않는다.

<a id="d075"></a>

### D075 Webview 상태 복원과 드래프트 저장 선택

- 상태: PLANNED · 선행: D022, D074
- 사용자 변화와 범위: getState/setState로 탭 메타데이터를 복원하고 SQL 드래프트 저장은 명시적 opt-in으로 둔다. 비밀 변수·결과 행은 저장하지 않고 자동 재실행하지 않는다.
- 수정 위치: `src/webview/QueryTabPanel.ts`, `package.json`
- 검증: C/H · 숨김/다시 표시/재시작을 각각 확인. getState 범위와 재시작 복원에 필요한 serializer API를 구분하고 미구현 범위를 표시한다.
- 완료/증거: 저장 payload 점검과 실제 복원. retainContextWhenHidden 제거는 동등성 확인 후 한 경로만 수행.

<a id="d076"></a>

### D076 미저장 테이블 편집의 새로고침 보호

- 상태: PLANNED · 선행: D030
- 사용자 변화와 범위: 행 변경을 저장하기 전 새로고침/테이블 페이지 이동 시 저장/버리기/취소를 선택하게 한다. 지원하는 내부 이동부터 적용한다.
- 수정 위치: `src/webview/TableEditorPanel.ts`
- 검증: C/H/D · 셀 변경 후 새로고침 취소하면 값 보존, 버리면 DB 재조회, 저장 실패면 이동 안 함. 다른 페이지에 변경이 섞이지 않는다.
- 완료/증거: 실제 세 경로와 데이터 보존. Webview onDidDispose로 native 닫기를 취소할 수 있다고 쓰지 않는다.

<a id="d077"></a>

### D077 MySQL 단일 PK 행 수정의 값 바인딩

- 상태: PLANNED · 선행: D027
- 사용자 변화와 범위: 검증된 테이블/컬럼과 바인딩된 값으로 한 행을 수정하는 API를 만든다. 원시 SQL 문자열 조립 경로 하나를 대체한다.
- 수정 위치: `src/providers/mysqlProvider.ts`, `src/webview/TableEditorPanel.ts`, `src/types/database.ts`
- 검증: C/H/D · 따옴표/역슬래시/한글/NULL/큰 숫자/SQL 모양 문자열을 수정. 대상 1행만 변경되고 읽기 전용은 차단된다.
- 완료/증거: DB round-trip와 식별자 변조 거절. 복합 PK/모든 CRUD 일괄 전환은 제외.

<a id="d078"></a>

### D078 PostgreSQL 단일 PK 행 수정의 값 바인딩

- 상태: PLANNED · 선행: D027, D077
- 사용자 변화와 범위: PostgreSQL schema-qualified 행 수정과 자리표시자 바인딩을 같은 계약으로 연결한다. 키 값과 변경 값을 구분한다.
- 수정 위치: `src/providers/postgresProvider.ts`, `src/webview/TableEditorPanel.ts`, `src/types/database.ts`
- 검증: C/H/D · non-public schema·따옴표 식별자·한글·NULL·SQL 모양 문자열·읽기 전용. 실제 변경은 대상 1행이다.
- 완료/증거: 동일 fixture의 MySQL/PG 결과 비교. RETURNING 지원 차이는 계약에 명시.

<a id="d079"></a>

### D079 PostgreSQL 편집 충돌 감지

- 상태: PLANNED · 선행: D078
- 사용자 변화와 범위: 다른 세션이 행을 바꿨으면 원래 읽은 값과 비교하는 조건부 UPDATE로 덮어쓰기를 막는다. 충돌 시 재조회/편집값 복사를 제공한다.
- 수정 위치: `src/providers/postgresProvider.ts`, `src/webview/TableEditorPanel.ts`
- 검증: C/H/D · 두 연결이 같은 행을 읽고 B 저장 후 A 저장. A는 충돌, B 값 유지. NULL·동일 값·삭제된 행을 따로 확인한다.
- 완료/증거: 두 세션 실제 전후 행과 충돌 화면. 자동 merge나 시점 전체 잠금은 제외.

<a id="d080"></a>

### D080 MySQL 편집 충돌과 no-op 구분

- 상태: PLANNED · 선행: D077, D079
- 사용자 변화와 범위: MySQL에서도 조건부 UPDATE로 충돌을 감지한다. matched/changed rows 차이를 확인해 동일 값 저장을 충돌로 오인하지 않는다.
- 수정 위치: `src/providers/mysqlProvider.ts`, `src/webview/TableEditorPanel.ts`
- 검증: C/H/D · 두 세션 변경/동일 값 저장/NULL/삭제된 행을 각각 수행. 충돌은 덮어쓰지 않고 no-op은 성공으로 구분된다.
- 완료/증거: DB 응답 플래그와 사용자 결과, 다음 10개 우선순위. 모든 DB optimistic lock 일반화는 제외.

## 5. 연결 신뢰·발견·운영 · D081–D100

<a id="d081"></a>

### D081 SSH 서버 지문 신뢰 모델과 검증 함수

- 상태: PLANNED · 선행: 없음
- 사용자 변화와 범위: 저장한 fingerprint와 서버 키를 비교하는 순수 검증 계약을 만든다. 최초 확인·일치·불일치를 구분하고 키를 로그에 남기지 않는다.
- 수정 위치: `src/types/database.ts`, `src/utils/sshHostTrust.ts (신규)`
- 검증: C · 고정 테스트 공개키의 SHA-256 지문, 일치/변조/빈 키/알고리즘 차이를 검사. 신뢰값 없는 연결을 자동 승인하지 않는다.
- 완료/증거: 저장 형식·전환 계획·오류 정책. 실제 접속 UI는 다음 카드이며 현재 연결을 갑자기 깨뜨리지 않는다.

<a id="d082"></a>

### D082 MySQL SSH 지문 확인과 연결

- 상태: PLANNED · 선행: D081, D008
- 사용자 변화와 범위: 관리자 계층에서 최초 지문 확인을 요청하고 승인한 호스트 키를 provider에 전달한다. provider는 vscode를 직접 import하지 않는다.
- 수정 위치: `src/providers/mysqlProvider.ts`, `src/managers/connectionManager.ts`, `src/utils/sshHostTrust.ts`
- 검증: C/H/D · 전용 SSH fixture의 최초 승인/취소/같은 키/변경 키. 불일치는 DB 인증 전 차단, 기존 터널/서버 자원 누수 0회.
- 완료/증거: 실제 forwarding·거절 결과와 업그레이드 안내. 신뢰 설정 자동 확대는 제외.

<a id="d083"></a>

### D083 PostgreSQL SSH 지문 정책 재사용

- 상태: PLANNED · 선행: D082
- 사용자 변화와 범위: PostgreSQL SSH에도 같은 신뢰 정책을 적용한다. DB 전환의 제어 연결도 동일한 호스트 검증을 거친다.
- 수정 위치: `src/providers/postgresProvider.ts`, `src/utils/sshHostTrust.ts`
- 검증: C/H/D · 최초/일치/불일치와 SSH 상태에서 다른 DB 메타데이터 조회. 거절 시 로컬 listener와 연결이 정리된다.
- 완료/증거: MySQL/PG 동일 fixture 결과. 공유 SSH manager 대규모 추출은 별도 필요성을 확인.

<a id="d084"></a>

### D084 암호화 SSH 개인키 passphrase 연결

- 상태: PLANNED · 선행: D082, D083
- 사용자 변화와 범위: 기존 SecretStorage passphrase 필드를 폼 입력과 실제 ssh2 인증 옵션에 연결한다. 공란은 기존 저장값 유지 정책을 따른다.
- 수정 위치: `src/webview/ConnectionFormPanel.ts`, `src/providers/mysqlProvider.ts`, `src/providers/postgresProvider.ts`
- 검증: C/H/D · 테스트용 암호화 키의 올바른/잘못된/공란 재편집 인증. settings/export/log에 키·passphrase 0건이며 삭제 시 SecretStorage도 정리된다.
- 완료/증거: 실제 SSH 인증과 저장소 검사. 실제 사용자의 키를 fixture로 사용하지 않는다.

<a id="d085"></a>

### D085 PostgreSQL TLS의 CA·서버 이름 검증

- 상태: PLANNED · 선행: D083
- 사용자 변화와 범위: PostgreSQL 한 DB에 CA/서버 이름/검증 설정을 명시적으로 제공한다. SSH 터널의 localhost와 실제 TLS 서버 이름을 구분한다.
- 수정 위치: `src/providers/postgresProvider.ts`, `src/webview/ConnectionFormPanel.ts`, `src/types/database.ts`
- 검증: C/H/D/P · 전용 TLS fixture로 신뢰 CA 성공, 다른 CA·서버 이름 불일치 거절, SSH TLS 조합 확인. 필수 환경이 없으면 WAITING_OWNER.
- 완료/증거: 암호화와 서버 검증의 실제 성공/거절 증거. rejectUnauthorized=false를 기본값으로 쓰지 않는다.

<a id="d086"></a>

### D086 MySQL TLS의 같은 사용자 계약

- 상태: PLANNED · 선행: D085
- 사용자 변화와 범위: MySQL driver의 CA/서버 이름 검증을 확인하고 같은 연결 폼 옵션에 연결한다. provider별 지원 차이를 문서화한다.
- 수정 위치: `src/providers/mysqlProvider.ts`, `src/webview/ConnectionFormPanel.ts`
- 검증: C/H/D/P · 전용 MySQL TLS fixture의 정상/다른 CA/이름 불일치/SSH 조합. 오류 메시지에 인증정보가 없어야 한다.
- 완료/증거: PG/MySQL TLS 지원표와 실제 응답. fixture 준비가 90분을 넘으면 먼저 독립 환경 카드로 분리.

<a id="d087"></a>

### D087 Workspace Trust와 원격 파일 위치 명시

- 상태: PLANNED · 선행: D011, D075
- 사용자 변화와 범위: Restricted Mode에서 가능한 읽기와 파일·연결 행동을 검토해 capability를 명시한다. Remote SSH/WSL의 SQLite·CA·키 경로가 Extension Host 쪽임을 안내한다.
- 수정 위치: `package.json`, `src/extension.ts`, `README.md`
- 검증: C/H/P/W · 신뢰/비신뢰 테스트 workspace를 비교하고 가능한 원격 환경에서 샘플 경로를 확인. 없는 환경은 미검증으로 표시한다.
- 완료/증거: 실제 trust 경계와 원격 지원/미확인 범위. vscode.dev 지원으로 확대하지 않는다.

<a id="d088"></a>

### D088 의존성 보안·호환성의 작은 갱신

- 상태: PLANNED · 선행: 없음
- 사용자 변화와 범위: 현재 npm audit/공식 공지를 확인해 영향 있는 호환 patch 한 묶음만 갱신한다. 제품 최소 Host의 Node와 라이선스를 확인한다.
- 수정 위치: `package.json`, `package-lock.json`, `docs/engineering/case-studies.md`
- 검증: C/H/D/P · runtime/dev 결과를 구분하고 변경한 패키지의 실제 사용 경로 검사. 전체 OS CI로 native/WASM/번들 회귀를 확인한다.
- 완료/증거: 취약점의 실제 도달 가능성·버전·결정 근거. audit fix --force와 근거 없는 위험 선언은 제외.

<a id="d089"></a>

### D089 활성화·패키지 비용의 기준 측정

- 상태: PLANNED · 선행: 없음
- 사용자 변화와 범위: 현재 활성화 시간·번들 크기·VSIX 파일 수·모듈 로딩 비용을 재현 가능한 환경에서 측정한다. 개별 병목 후보를 한 개만 고른다.
- 수정 위치: `docs/engineering/case-studies.md`, `scripts/measure-extension.cjs (신규)`
- 검증: C/H/P/W · 새 프로필과 반복 활성화를 나눠 측정하고 Extension Host 비용과 VS Code 전체 시작 시간을 구분한다.
- 완료/증거: 원자료·명령·환경·병목 선택 이유. 아직 개선 수치나 특정 모듈 원인을 단정하지 않는다.

<a id="d090"></a>

### D090 측정한 모듈 한 곳만 지연 로딩

- 상태: PLANNED · 선행: D089
- 사용자 변화와 범위: D089에서 확인한 큰 모듈 한 곳을 필요 시 로딩한다. 병목이 확인되지 않으면 무작정 코드를 바꾸지 말고 더 작은 측정 과제로 재정의한다.
- 수정 위치: `src/commands/index.ts 또는 src/extension.ts`, `docs/engineering/case-studies.md`
- 검증: C/H/P · 첫 명령 호출과 두 번째 호출을 모두 검증하고 같은 환경의 활성화/명령 지연을 비교한다. 최소 1.85도 동작해야 한다.
- 완료/증거: 측정 근거·전후 결과·단점. 수치가 나빠지면 변경을 채택하지 않고 원인을 기록.

<a id="d091"></a>

### D091 README 첫 화면의 핵심 가치 정리

- 상태: PLANNED · 선행: D020
- 사용자 변화와 범위: 안전한 다중 DB 작업/서버 없는 첫 쿼리/한·영 안내를 출시된 범위에 맞춰 짧게 설명한다. 설치·첫 체험·제약 링크를 첫 화면에서 찾게 한다.
- 수정 위치: `README.md`
- 검증: W · 한·영 기능표와 실제 공개 버전을 대조, 이미지·링크·명령 확인. 미출시 기능은 로드맵으로 연결한다.
- 완료/증거: 공개 기능과 문구의 대응, 화면 캡처. 기능 수 과장·사용자 후기 창작은 제외.

<a id="d092"></a>

### D092 실제 화면으로 짧은 데모 교체

- 상태: PLANNED · 선행: D020, D091
- 사용자 변화와 범위: 샘플 생성 → JOIN → 결과 확인의 한 흐름을 실제 확장에서 촬영한다. 화면 크기·용량·텍스트 읽기성을 확인하고 출시 태그의 데모를 보존한다.
- 수정 위치: `resources/demo.gif`, `README.md`
- 검증: W/H · 새 테스트 프로필의 한·영 표시를 확인. README의 고정 태그 링크와 다음 릴리스 이미지가 가리키는 버전을 구분한다.
- 완료/증거: 원본 캡처·최적화 전후 용량·실제 기능 일치. 합성 제품 화면이나 비공개 DB는 제외.

<a id="d093"></a>

### D093 비밀정보 없는 이슈 양식

- 상태: PLANNED · 선행: 없음
- 사용자 변화와 범위: 버전·OS·DB 종류·재현 단계·기대/실제 결과를 받는 양식을 만든다. 실제 SQL·호스트·비밀번호·고객 데이터 대신 최소 합성 예제를 안내한다.
- 수정 위치: `.github/ISSUE_TEMPLATE/bug_report.yml (신규)`, `.github/ISSUE_TEMPLATE/feature_request.yml (신규)`
- 검증: W · GitHub 양식 문법과 required 항목 확인. 민감정보 입력을 필수로 요구하지 않고 안전한 예제만 포함한다.
- 완료/증거: 사용 가능한 두 양식과 민감정보 안내. 외부 이슈·사용자 메시지를 자동 생성하지 않는다.

<a id="d094"></a>

### D094 사용자 피드백의 우선순위 기준

- 상태: PLANNED · 선행: D093
- 사용자 변화와 범위: 버그/첫 사용 막힘/기존 UX/신규 수요를 영향·재현·대체 수단으로 판단하는 기준을 만든다. 실제 공개 이슈가 있으면 읽고 근거만 연결한다.
- 수정 위치: `docs/roadmap/feedback.md (신규)`
- 검증: W · 현재 이슈를 확인하고 데이터가 없으면 내부 검증 목록으로 남긴다. 실제 없는 인터뷰나 피드백을 만들지 않는다.
- 완료/증거: 우선순위를 바꾼 근거와 다음 10개 조정안. 외부 답글 전송은 별도 요청.

<a id="d095"></a>

### D095 SQL 입문자의 주문 데이터 실습

- 상태: PLANNED · 선행: D020, D091
- 사용자 변화와 범위: 샘플 주문 DB로 WHERE/JOIN/GROUP BY를 작은 3개 예제로 안내한다. 실행 SQL·예상 결과·대표 오류와 복구를 함께 제공한다.
- 수정 위치: `docs/guides/sql-practice.md (신규)`, `README.md`
- 검증: W/H/D · 문서 SQL을 현재 지원 SQLite에서 그대로 실행하고 한글 결과·0행·컬럼 오타를 확인한다.
- 완료/증거: 재현 가능한 교육 자료와 실제 결과. 다른 DB에서도 검증했다고 확대하지 않는다.

<a id="d096"></a>

### D096 백엔드 개발자의 PG/MySQL 확인 가이드

- 상태: PLANNED · 선행: D010
- 사용자 변화와 범위: 테스트 DB 연결 → 스키마 탐색 → 쿼리 → 결과 Pin/Diff의 한 흐름을 설명한다. DB별 EXPLAIN/루틴의 지원 차이를 명시한다.
- 수정 위치: `docs/guides/backend-workflow.md (신규)`, `README.md`
- 검증: W/H/D · 전용 PG/MySQL에서 가이드 순서를 실행. 파괴적 SQL 없이 동작하며 실제 명령·결과와 문구가 같아야 한다.
- 완료/증거: 두 DB의 실행 증거와 한계. 운영 데이터 화면·자격증명 공유는 제외.

<a id="d097"></a>

### D097 Redis/MongoDB의 QA 데이터 확인 예제

- 상태: PLANNED · 선행: D066, D070
- 사용자 변화와 범위: 합성 주문/캐시 데이터로 키 검색·TTL 읽기·문서 페이지·집계 미리보기의 한 흐름을 만든다. DB별 JSON/명령 문법을 나눈다.
- 수정 위치: `docs/guides/nosql-workflow.md (신규)`, `README.md`
- 검증: W/H/D · SCAN 종료, TTL 만료, ObjectId 복사와 집계 오류까지 실제 실행. 읽기 전용에서 쓰기 0회 확인.
- 완료/증거: 합성 데이터·명령·화면·제약. 이 예제가 실제 서비스 캐시 일관성을 보장한다고 쓰지 않는다.

<a id="d098"></a>

### D098 대상별 한·영 소개와 공개 초안

- 상태: PLANNED · 선행: D091, D092, D095, D096, D097
- 사용자 변화와 범위: 입문자용/백엔드 개발자용 한·영 소개 초안과 실제 데모 링크, 한 문장의 피드백 요청을 준비한다. 게시 채널마다 길이만 조정한다.
- 수정 위치: `docs/marketing/launch-kit.md (신규)`
- 검증: W · 모든 주장·이미지·설치 링크가 공개 버전과 일치. 미출시 취소/페이지 기능을 현재 기능처럼 쓰지 않는다.
- 완료/증거: 검토 가능한 초안과 지원 범위. 외부 채널 게시·DM·리뷰 요청 전송은 별도 지시.

<a id="d099"></a>

### D099 출시 후보의 사용자 흐름과 배포 자료

- 상태: PLANNED · 선행: D010, D020, D030, D040, D050, D060, D070, D080, D086, D087, D088, D090, D098
- 사용자 변화와 범위: 완료된 카드만 릴리스 후보로 묶고 첫 체험·안전한 실행·취소·페이지·내보내기의 사용자 흐름을 확인한다. 다음 버전 번호는 그때 실제 범위로 정한다.
- 수정 위치: `CHANGELOG.md`, `README.md`, `docs/releases/다음버전.md (신규)`
- 검증: C/H/D/P/W · 전체 CI, 동일 VSIX, 태그/매니페스트 일치 준비, 신규 프로필·기존 설정 업그레이드 fixture를 확인한다.
- 완료/증거: 후보 SHA·패키지 해시·검증·노트·남은 결함. 승인 전 태그/Marketplace 게시와 예정 시각의 완료 표시는 제외.

<a id="d100"></a>

### D100 포트폴리오 근거와 다음 10개 재선정

- 상태: PLANNED · 선행: D094, D099
- 사용자 변화와 범위: 실제 해결한 사례 3개를 문제→원인→대안→선택→검증→제약으로 정리한다. 공개 설치 수·피드백을 날짜별로 확인하고 다음 10개만 다시 우선순위화한다.
- 수정 위치: `docs/engineering/case-studies.md`, `ROADMAP.md`, `docs/roadmap/feedback.md`
- 검증: W · 모든 구현·CI·측정 링크와 출시 범위를 대조. 실측 없는 성능/성장 문장은 삭제하고 새 카드의 하루 범위를 점검한다.
- 완료/증거: 이력서에 사용할 수 있는 근거 문장과 후속 계획. 100개 완료 자체를 사용자 성과로 쓰지 않는다.

## 6. 기존 기능별 후속 후보 · D101–D120

D100 회고에서 실제 수요와 결함에 따라 앞 단계로 이동하거나 더 작게 나눌 수 있다. 기본 큐에서는 첫 100개 이후의 후보이며, 미리 완료나 출시를 약속하지 않는다.

<a id="d101"></a>

### D101 루틴 브라우저의 연결 대상 고정

- 상태: PLANNED · 선행: D100, D001
- 사용자 변화와 범위: 트리에서 선택한 루틴의 connectionId·DB·schema와 실행 대상을 맞춘다. 다른 활성 연결의 동명 루틴을 조회/실행하지 않게 한다.
- 수정 위치: `src/commands/index.ts`, `src/webview/RoutinePanel.ts`
- 검증: C/H/D · A/B DB에 같은 이름·다른 내용을 가진 루틴을 준비하고 A 선택 후 B 활성 상태에서 조회/실행. A만 대상이며 연결 실패는 실행 0회.
- 완료/증거: 동명 루틴 실제 소스/결과와 경계 검사. 여러 DB의 전체 루틴 API 재작성은 제외.

<a id="d102"></a>

### D102 PostgreSQL 루틴 입력 파라미터 정보

- 상태: PLANNED · 선행: D101
- 사용자 변화와 범위: PostgreSQL 한 DB에서 루틴 식별자·인자 타입·IN/OUT·기본값을 실제 catalog와 맞춰 표시한다. overload를 이름만으로 고르지 않는다.
- 수정 위치: `src/providers/postgresProvider.ts`, `src/webview/RoutinePanel.ts`
- 검증: C/H/D · 같은 이름의 정수/문자 overload, 기본 인자, OUT 인자를 가진 테스트 루틴 비교. 지원하지 않는 호출은 이유를 표시한다.
- 완료/증거: 실제 catalog와 화면 동등성. MySQL/H2 전체 확장은 별도 카드로 분리.

<a id="d103"></a>

### D103 루틴 인자 입력의 NULL·값 검증

- 상태: PLANNED · 선행: D102, D025
- 사용자 변화와 범위: PostgreSQL 루틴 인자의 빈 문자열/NULL/숫자/기본값 사용을 구분하고 Host에서 정의와 대조한다. 실행 전 대상과 값을 확인한다.
- 수정 위치: `src/webview/RoutinePanel.ts`, `src/utils/webviewMessages.ts`
- 검증: C/H/D · 빈 문자열과 NULL을 구분하는 테스트 루틴, 잘못된 숫자, 과도한 배열/추가 인자 입력. 거절한 호출은 DB 실행 0회.
- 완료/증거: 실제 함수 결과·오류 위치·비밀값 로그 없음. 모든 SQL 타입 변환기는 제외.

<a id="d104"></a>

### D104 행 삽입 폼의 FK 값 검색

- 상태: PLANNED · 선행: D100, D025
- 사용자 변화와 범위: PostgreSQL 한 DB에서 FK 후보의 고정 첫 200개 목록을 검색/추가 조회로 개선한다. label과 실제 참조 키를 분리하고 변조한 대상 컬럼을 거절한다.
- 수정 위치: `src/webview/RowInsertPanel.ts`, `src/commands/index.ts`, `src/providers/postgresProvider.ts`
- 검증: C/H/D · 부모 2,005행의 뒤쪽 한글 이름 검색·동일 label·없는 값·선택 취소. 실제 참조 키로 1행 삽입되고 읽기 전용은 차단된다.
- 완료/증거: 첫 목록 밖의 FK 선택과 실제 INSERT 결과. MySQL/SQLite 확대와 전체 폼 재작성은 분리.

<a id="d105"></a>

### D105 통계 수집 실패를 실제 0과 구분

- 상태: PLANNED · 선행: 없음
- 사용자 변화와 범위: 현재 서버 집계는 유지하고 실패를 기본 0/빈 값으로 삼키는 경로에 실패/미계산 상태를 추가한다. 일부 컬럼 실패가 나머지 결과의 성공을 가리지 않게 한다.
- 수정 위치: `src/utils/dataStatistics.ts`, `src/webview/StatisticsPanel.ts`
- 검증: C/H/D · 정상 0/실제 NULL/권한 부족/timeout fixture를 비교. 실패한 distinct·min/max·빈출값은 0으로 표시되지 않고 재시도 범위를 안내한다.
- 완료/증거: 실제 집계와 오류 상태 화면. 현재 통계가 단순 조회 표본이라는 잘못된 가정으로 재구현하지 않는다.

<a id="d106"></a>

### D106 통계에서 선택한 컬럼만 계산

- 상태: PLANNED · 선행: D105
- 사용자 변화와 범위: 기존 컬럼별 서버 집계를 사용자가 선택한 컬럼/항목에만 수행하게 한다. 비싼 distinct·빈출값의 실행 여부와 진행 상태를 명시한다.
- 수정 위치: `src/utils/dataStatistics.ts`, `src/webview/StatisticsPanel.ts`
- 검증: C/H/D · PostgreSQL에서 20컬럼 중 1개 선택 시 해당 집계만 호출. 실제 count/null/min/max와 오류/취소 후 재실행을 확인한다.
- 완료/증거: 기존 전체 계산 대비 실제 호출 수·소요 시간과 한계. 확인하지 않은 성능 향상률은 제외.

<a id="d107"></a>

### D107 차트의 데이터 범위와 범주 상한 표시

- 상태: PLANNED · 선행: D100, D047
- 사용자 변화와 범위: 현재 결과로 만든 차트임을 표시하고 너무 많은 범주/NULL/비수치 값을 안내한다. 대량 SVG 노드 생성 전에 범주 상한을 적용한다.
- 수정 위치: `src/webview/ChartPanel.ts`, `src/utils/chartBuilder.ts`
- 검증: C/H · 한글 200범주/NULL/정밀 decimal fixture에서 상한·합산 규칙·빈 차트를 확인. 원자료를 숨기지 않는다.
- 완료/증거: 실제 차트와 포함/제외 범위. 전체 DB 분석 대시보드로 표현하지 않는다.

<a id="d108"></a>

### D108 결과 Diff의 중복 키 감지

- 상태: PLANNED · 선행: 없음
- 사용자 변화와 범위: 선택한 비교 키가 중복이면 모호한 행 매칭을 성공 비교처럼 표시하지 않는다. 중복 건수와 키 변경 행동을 제공한다.
- 수정 위치: `src/utils/resultDiff.ts`, `src/webview/DiffPanel.ts`
- 검증: C/H · 같은 id가 2번인 좌/우 결과에서 모호함을 표시하고 데이터 손실이 없는지 확인. 유일 키 fixture의 기존 diff는 유지한다.
- 완료/증거: 정확한 중복/추가/삭제/변경 fixture. 임의 첫 행으로 덮어쓰는 처리는 제외.

<a id="d109"></a>

### D109 결과 Diff의 복합 키 선택

- 상태: PLANNED · 선행: D108
- 사용자 변화와 범위: 이미 유일하지 않은 단일 키 대신 두 컬럼 이상을 비교 키로 선택한다. 내부 키 직렬화가 구분자/NULL 때문에 충돌하지 않게 한다.
- 수정 위치: `src/commands/index.ts`, `src/utils/resultDiff.ts`
- 검증: C/H · tenantId+id, 값 안의 구분자, NULL/빈 문자열 fixture로 정확한 매칭. 선택 취소는 비교를 시작하지 않는다.
- 완료/증거: 복합 키 실제 변경 목록과 충돌 fixture. 전체 diff 알고리즘 교체는 제외.

<a id="d110"></a>

### D110 핀 결과의 메모리 예산

- 상태: PLANNED · 선행: D100, D048
- 사용자 변화와 범위: 최대 20개 개수 외에 총 셀/문자량 한도를 두고 오래된 핀 제거 정책을 안내한다. 큰 결과 고정 전에 비용과 축소 여부를 표시한다.
- 수정 위치: `src/utils/resultPin.ts`, `src/webview/QueryTabPanel.ts`
- 검증: C/H · 큰 문자열 결과 여러 개 고정/제거 후 예산·선택 상태 확인. 비교 중 핀 제거 시 명확한 안내가 있어야 한다.
- 완료/증거: 상한·실제 메모리 표본·기존 단위 회귀. 민감 결과 영구 저장은 제외.

<a id="d111"></a>

### D111 ERD의 테이블 선택과 큰 스키마 제한

- 상태: PLANNED · 선행: D100
- 사용자 변화와 범위: 전체 스키마 대신 선택한 테이블과 관련 FK만 그리는 진입점을 만든다. 대규모 노드 생성 전에 개수와 제한을 알려준다.
- 수정 위치: `src/commands/index.ts`, `src/webview/ERDPanel.ts`
- 검증: C/H/D · 테스트 50테이블 중 5개 선택. 선택한 노드와 포함된 관계만 표시되고 제외된 관계는 구분된다.
- 완료/증거: 실제 노드/엣지 수와 첫 표시 시간. 4개 레이아웃 전면 교체는 제외.

<a id="d112"></a>

### D112 ERD의 schema-qualified 관계 식별

- 상태: PLANNED · 선행: D111
- 사용자 변화와 범위: 같은 테이블명이 다른 schema에 있을 때 노드/FK 키를 schema와 함께 식별한다. 화면 label과 export도 일치시킨다.
- 수정 위치: `src/webview/ERDPanel.ts`, `src/providers/postgresProvider.ts`
- 검증: C/H/D · a.users/b.users와 교차 schema FK를 만들어 엣지 대상 확인. SVG export를 다시 열어 같은 관계인지 확인한다.
- 완료/증거: 실제 FK catalog/그림 비교. 자동 DB 설계 생성은 제외.

<a id="d113"></a>

### D113 스키마 비교의 지원 범위와 안전한 출력

- 상태: PLANNED · 선행: D100
- 사용자 변화와 범위: 현재 비교하는 컬럼·키·인덱스 범위를 실제 구현과 맞춰 표시한다. 미비교 항목을 동일하다고 쓰지 않고 내보낸 SQL은 검토용임을 명시한다.
- 수정 위치: `src/webview/SchemaComparePanel.ts`, `src/commands/index.ts`
- 검증: C/H/D · 컬럼 타입/NULL/default/복합키만 다른 두 테스트 테이블을 비교하고 지원 항목의 결과를 확인. export가 DB를 실행하지 않는다.
- 완료/증거: 지원표·실제 diff·출력 예. 자동 ALTER 적용은 제외.

<a id="d114"></a>

### D114 마이그레이션 스크립트의 미저장 편집 보호

- 상태: PLANNED · 선행: D100, D006
- 사용자 변화와 범위: UP/DOWN 편집 후 다른 스크립트로 이동/내부 삭제 시 저장/버리기/취소를 제공한다. 수동 적용 상태 기록과 실제 DB 실행을 계속 구분한다.
- 수정 위치: `src/webview/MigrationPanel.ts`
- 검증: C/H · SQL 입력 후 내부 전환 3경로, 재시작 뒤 저장 내용, 삭제 취소 확인. 적용 상태만 바꿀 때 SQL 실행은 0회다.
- 완료/증거: 상태·스크립트 보존 회귀. native Webview 닫기 취소나 자동 DDL 실행은 제외.

<a id="d115"></a>

### D115 모니터 숨김과 느린 refresh의 중복 방지

- 상태: PLANNED · 선행: D008
- 사용자 변화와 범위: 숨겨진 패널의 주기 조회를 멈추고 이전 refresh가 끝나기 전 다음 조회를 겹치지 않는다. 오류 알림을 매 주기 반복하지 않는다.
- 수정 위치: `src/webview/MonitoringPanel.ts`
- 검증: C/H/D · refresh보다 느린 테스트 응답, 패널 숨김/복귀/닫기를 수행. 동시에 진행 중 조회는 1개이며 닫은 뒤 주기 호출은 0회다.
- 완료/증거: 실제 호출 수·dispose·오류 복구. 서버 전체 모니터링 수집기는 제외.

<a id="d116"></a>

### D116 모니터 프로세스 종료 확인과 stale 대상 보호

- 상태: PLANNED · 선행: D115
- 사용자 변화와 범위: 명시적인 관리용 종료에서 DB·세션·현재 상태를 확인한다. 오래된 UI 행과 변조한 PID 요청을 검증하고 읽기 전용에서는 차단한다.
- 수정 위치: `src/webview/MonitoringPanel.ts`, `src/utils/webviewMessages.ts`
- 검증: C/H/D · 전용 테스트 세션만 대상으로 종료 취소/대상 이미 종료/읽기 전용/변조 PID를 확인. 일반 쿼리 취소와 구분한다.
- 완료/증거: 실제 대상·확인·실패 결과. 운영/다른 프로젝트 세션으로 테스트하지 않는다.

<a id="d117"></a>

### D117 목 데이터 생성의 재현 가능한 seed

- 상태: PLANNED · 선행: D100
- 사용자 변화와 범위: 무작위 생성에 선택 가능한 seed를 추가하고 같은 입력이면 같은 SQL을 만든다. 1개 생성기부터 순수 함수로 분리한다.
- 수정 위치: `src/webview/MockDataPanel.ts`, `src/utils/mockDataGenerator.ts (신규)`
- 검증: C/H/D · 같은 seed·다른 seed·한글/따옴표/NULL·최대 행 수. 전용 SQLite에서 생성 SQL을 실행해 값과 타입을 확인한다.
- 완료/증거: seed/SQL/실제 결과 재현. 모든 데이터 생성기·FK 순서 자동화는 제외.

<a id="d118"></a>

### D118 SQL 자동완성의 연결·DB 캐시 무효화

- 상태: PLANNED · 선행: D100, D001
- 사용자 변화와 범위: 캐시 키와 수명을 연결 ID·DB·schema에 맞추고 전환/메타데이터 갱신 때 해당 범위만 무효화한다. 취소된 요청의 오래된 결과를 버린다.
- 수정 위치: `src/providers/completionProvider.ts`
- 검증: C/H/D · 같은 테이블명의 A/B DB에서 다른 컬럼·FK를 준비하고 전환. 제안이 섞이지 않으며 빠른 타이핑의 취소도 확인한다.
- 완료/증거: 실제 제안 목록·조회 횟수·캐시 경계. 완전 SQL parser/LSP 재작성은 제외.

<a id="d119"></a>

### D119 저장 쿼리 검색과 없어진 연결 안내

- 상태: PLANNED · 선행: D100, D072
- 사용자 변화와 범위: 이름/카테고리로 저장 쿼리를 찾고 연결이 삭제되었으면 새 대상을 선택해 연다. 열기와 실행은 분리한다.
- 수정 위치: `src/views/savedQueriesView.ts`, `src/commands/index.ts`
- 검증: C/H · 한글 이름/중복 이름/삭제된 연결/검색 0건. 선택해도 DB 실행 0회, 사용자가 실행할 때 대상이 분명하다.
- 완료/증거: 저장·검색·열기 실제 결과. 팀 cloud sync와 SQL 자동 공유는 제외.

<a id="d120"></a>

### D120 H2의 지원 범위와 대표 시나리오 확인

- 상태: PLANNED · 선행: D100
- 사용자 변화와 범위: H2 PostgreSQL wire 경로의 스키마 탐색·기본 조회·읽기 전용·파일/메모리 옵션을 실제 지원 범위로 정리한다. PG와 다른 기능은 명시한다.
- 수정 위치: `src/providers/h2Provider.ts`, `src/test/integration/userScenario.test.ts`, `README.md`
- 검증: C/H/D/W · 전용 H2에서 테이블 생성 fixture·조회·metadata·읽기 전용 쓰기 차단을 확인. 파일/메모리 검증 여부를 나눠 기록한다.
- 완료/증거: 현재 H2 버전·실제 응답·지원표·다음 10개 재선정. PostgreSQL과 완전히 같다고 설명하지 않는다.
