# DBunny 문제 해결 사례와 증거

기준일: 2026-11-11. 해결하고 검증한 일과 앞으로 구현할 계획을 구분한다. 소스·CI·게시 기록으로 확인한 범위만 이력서에 사용한다.

## 이미 확인한 사례

### PostgreSQL 방언 차이가 읽기 전용 판정을 바꾼 문제

- 문제: `VALUES (1 # 2); DELETE FROM items`의 `#`는 PostgreSQL 연산자인데 MySQL식 주석으로 제거하면 뒤의 쓰기 문장을 놓칠 수 있었다.
- 원인: 방언을 구분하지 않는 전처리가 실행 정책의 근거가 되었다.
- 선택: 방언별 마스킹, 부작용 함수 검사, 공통 실행 경계와 PostgreSQL 서버의 읽기 전용 설정을 함께 적용했다. 문자열 검사로 DB 권한을 대체하지 않는다.
- 증거: [읽기 전용 판정](../../src/utils/readOnlyGuard.ts), [공통 실행 경계](../../src/utils/guardedConnection.ts), [실행 정책 통합 검사](../../src/test/integration/executionPolicy.test.ts), [릴리스 검증](../releases/3.2.0.md).
- 설명할 역량: 실패를 재현하고 파서의 한계와 서버 권한을 분리한 판단. 모든 저장 함수의 부작용을 정적 분석했다고 주장하지 않는다.

### 시간대에 따라 CI 단위 검사가 실패한 문제

- 문제: 로컬 KST 기대 시간이 UTC runner와 달라 OS/버전 호환 검사에서 실패했다.
- 선택: 로컬 시간 표현 fixture를 의미에 맞게 바꾸고 UTC·Asia/Seoul·America/New_York를 각각 자식 프로세스로 검사했다. 제품 날짜 처리를 CI에 맞춰 바꾸지 않았다.
- 증거: [수정 커밋](https://github.com/chimaek/dbunny/commit/e697db7), [결과 고정 검사](../../src/test/unit/resultPin.test.ts), [standalone fixture](../../src/test/unit/resultPin.standalone.ts), [릴리스 CI](https://github.com/chimaek/dbunny/actions/runs/42570752385).
- 설명할 역량: 테스트의 환경 의존성과 제품 요구를 구분한 대응. 이후 모든 날짜 기능이 검증되었다는 뜻은 아니다.

### 최신 macOS 테스트 편집기의 실행 파일 경로가 달라진 문제

- 문제: 구버전 테스트 도구가 최신 VS Code 앱의 실행 파일 구조를 처리하지 못했다.
- 선택: 최소 지원 VS Code는 유지하고 `test-electron` 3.1.0, `test-cli` 0.0.15로 갱신했다. 개발용 Node 요구와 확장 Host 요구를 구분했다.
- 증거: [수정 커밋](https://github.com/chimaek/dbunny/commit/6132f75), [개발 환경](../../CONTRIBUTING.md), 3개 OS가 통과한 [게시 workflow](https://github.com/chimaek/dbunny/actions/runs/42570752385).
- 설명할 역량: 외부 도구 변경에 대응하면서 제품 최소 버전을 불필요하게 올리지 않은 호환성 판단.

### Windows 네이티브 모듈 잠금으로 패키지 검증 정리가 실패한 문제

- 문제: 임시 폴더에서 드라이버를 로딩한 프로세스가 `.node` 파일을 잠가 검사 후 정리에 `EPERM`이 발생했다.
- 선택: 드라이버·WASM 로딩을 자식 프로세스로 분리하고 종료 뒤 만든 임시 폴더만 정리했다. 일부 성공 로그가 있어도 최종 종료 코드가 실패하면 통과로 보지 않았다.
- 증거: [수정 커밋](https://github.com/chimaek/dbunny/commit/bd5db11), [패키지 검사](../../scripts/verify-vsix.cjs), [자식 프로세스 검사](../../scripts/verify-vsix-runtime.cjs).
- 설명할 역량: OS별 파일 수명과 프로세스 경계를 실제 실패로 검증한 경험.

### CI 부담과 동일 패키지 보장을 함께 개선한 사례

- 문제: 조합마다 의존성 설치와 VSIX 생성을 반복하고 문서 변경에도 무거운 검사를 실행했다.
- 선택: 경로로 변경 범위를 분류하고 Linux에서 만든 VSIX·테스트 harness를 재사용했다. 환경 민감 변경·태그는 전체 검사를 수행하고 선택된 검사의 실패를 마지막 job에서 확인한다.
- 증거: [수정 커밋](https://github.com/chimaek/dbunny/commit/4120926), [정책 회귀 검사](../../scripts/ci-policy.test.cjs), [실측 실행 기록](../CI.md).
- 측정 범위: 전후 값은 각 실행의 표본이다. 캐시·runner·검사 범위가 달라 성능 향상률이나 정확한 요금 절감액으로 단정하지 않는다.
- 설명할 역량: 검사 범위를 보존하며 반복 작업을 줄이고 CI 실행과 정책 테스트를 함께 확인한 경험.

### 장기 게시 토큰 없이 검증한 패키지를 게시한 사례

- 선택: GitHub 태그·environment·Trusted Publishing 조건을 맞추고 OIDC로 CI가 검증한 같은 VSIX를 게시했다.
- 증거: [게시 시각과 해시](../releases/3.2.0.md), [publish workflow](../../.github/workflows/publish.yml). 명령 완료와 Marketplace 검증 후 업데이트 시각을 나눠 남겼다.
- 설명할 역량: 권한 경계, artifact 무결성, 패키지 실행과 서비스 공개 완료를 각각 확인한 배포 운영.

## 현재 미해결 재현

2026-11-11의 컴파일 결과에서 다음 합성 입력을 실행했다. 아직 수정하지 않았으며 완료한 이력서 성과에 포함하지 않는다.

- **Diff 중복 키:** 좌/우 각각 `[{id:1,name:'first'},{id:1,name:'second'}]`, 키 `['id']`를 `computeDiff`에 전달했다. 입력은 각각 2행이지만 `summary.unchanged`와 출력 행 수는 1이었다. Map의 같은 키 덮어쓰기를 확인했다. [D108](../roadmap/daily-cards.md#d108)에서 명시적인 중복 처리부터 구현한다.
- **통계 하위 쿼리 실패:** 총 행 수는 2를 반환하고 컬럼 집계가 합성 오류를 던지는 연결을 `collectTableStatistics`에 전달했다. 결과 컬럼은 실패 표시 없이 `nullCount:0`, `distinctCount:0`, `topValues:[]`였다. 실제 권한/timeout DB 오류와 UI는 카드에서 추가 검증한다. [D105](../roadmap/daily-cards.md#d105).
- **모니터 수명:** `_startAutoRefresh`의 interval이 완료를 기다리지 않고 `_refreshData`를 호출한다. 소스에 refresh 중첩 방지와 view 숨김 중지 경로가 없다. 실제 중첩 횟수·숨김 중 조회는 아직 UI/DB로 재현하지 않았다. [D115](../roadmap/daily-cards.md#d115).

## 앞으로 만들 근거

[일일 카드](../roadmap/daily-cards.md)의 완료 기록을 아래 형식으로 모은다. 아직 구현하지 않은 취소·페이지·충돌 감지·SSH 지문을 현재 실적으로 쓰지 않는다.

1. 사용자 문제와 정확한 재현 입력.
2. 관찰한 응답·로그·데이터 상태와 원인.
3. 검토한 대안과 선택 이유. 작은 수정에 대안 비교가 의미 없으면 억지로 만들지 않는다.
4. 변경한 경계와 호환성·보안·유지보수의 trade-off.
5. 같은 환경의 전후 결과, 실패 케이스, 통과한 검증과 미확인 범위.
6. 구현 커밋·CI·재현 명령·공개 가능한 화면.
7. 새로 할 수 있게 된 행동과 남은 한계.

성능 측정에는 OS·CPU/RAM·DB/VS Code/Node 버전·데이터 크기·네트워크·캐시·반복 횟수를 적는다. 첫 실행과 반복 실행을 나누고 원자료를 보관한다. 표본이 적으면 밝히며 목표 수치를 실측값으로 쓰지 않는다.

이력서에는 “여러 OS에서 같은 VSIX를 검증한 뒤 OIDC로 게시하고 공개 다운로드의 SHA-256 일치를 확인했다”처럼 근거가 있는 행동과 결과를 연결한다. 사용자 증가·장애 감소·개선 비율은 실제 관측 자료가 확보된 뒤 추가한다.
