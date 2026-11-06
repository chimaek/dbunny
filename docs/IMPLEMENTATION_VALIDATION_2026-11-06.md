# 구현 개선 및 검증 결과

검증일: 2026-11-06 (한국 시간). Windows / Node.js 24.20.0 기준이다.

## 반영한 개선

- PostgreSQL의 `#` 연산자·배열·인용 함수명을 고려해 읽기 전용 검사를 보완했다. 관리/상태 변경 함수를 차단하고, 제한 조회에 서버의 `default_transaction_read_only`도 적용했다.
- 모니터의 프로세스 종료 요청은 읽기 전용 연결에서 거부하고 양의 정수 ID만 받도록 했다.
- PostgreSQL 최초 연결과 다른 DB용 일반/파라미터화 임시 연결이 같은 SSH 터널 주소를 사용하도록 통합했다. 기존 SSH passphrase 옵션도 실제 연결에 전달한다.
- MongoDB aggregate 테스트를 Provider가 실제 지원하는 JSON 호환 문법에 맞췄다. `$out`·`$merge` 차단을 유지했다.
- 마이그레이션은 현재 제공하는 SQL 스크립트 관리 기능에 맞춰 안내·버튼·성공 알림·README를 수정했다. 실제 SQL 실행 없이 적용 성공으로 표시하지 않으며, 수동 작업 상태 기록 전 확인을 받는다. 자동 마이그레이션 실행 기능은 추가하지 않았다.
- Docker 포트·네트워크·볼륨을 기존 프로젝트와 분리했다. 고정 container_name을 제거하고 서버 readiness 검사를 추가했다.
- 통합 테스트 러너가 기존 누락 파일과 새 회귀 검사를 포함해 전체 묶음을 실행하고 로그를 남기도록 했다.
- vsce 4.1.0과 Azure 인증 의존성의 호환 보안 업데이트를 적용했다.
- 태그 확인 → 전체 CI → 검증 VSIX 다운로드 → 패키지 ID/버전 확인 → OIDC 게시 흐름을 구성했다.
- `AGENTS.md`와 `.cursor/rules/git-delivery.mdc`에 검증 후 사용자 정보로 한글 커밋·push하는 규칙을 추가했다. 확인된 Git/GitHub 사용자는 `chimaek <pipiru100@gmail.com>`이다.

## 실행 결과

- `npm test`: 통과. 타입 검사·린트·번들, Mocha **189개**, standalone **16개**, VS Code stable **1.145.1 Host 3개** 통과.
- `npm run test:integration`: **22/22 묶음 통과**. MySQL 8.4, PostgreSQL 16, MongoDB 7, Redis 7.4, H2 2.3.232, SQLite를 사용했다.
- 새 PostgreSQL 회귀 검사: XOR 뒤 쓰기 구문, 관리 함수, 인용된 함수명 차단. 사용자 정의 SELECT 함수의 쓰기를 서버가 거부하며 테이블 행 수가 유지됨을 확인했다.
- 새 SSH 검사: 로컬 SSH 서버의 실제 forwarding 채널을 거쳐 PostgreSQL 최초 연결, 다른 DB 조회, 파라미터화 메타데이터 조회를 모두 확인했다. 터널 밖에서 해석되지 않는 목적지 호스트 이름으로 직접 접속 우회도 검출한다.
- `npm run package-extension -- --out dbunny.vsix`: 통과. 1,173파일, 약 10.06MB.
- `VSCODE_TEST_VERSION=1.85.0 npm run test:package -- dbunny.vsix`: 통과. 패키지 안의 드라이버, WASM, 번역 리소스와 최소 지원 버전의 Host 3개 통과.
- 릴리스 사전 검사: 현재 버전/VSIX 정상 통과, 잘못된 태그 거부, 잘못된 publisher의 VSIX 거부.
- CI·게시 workflow와 Compose YAML 파싱 및 태그 전용/OIDC 권한 확인: 통과.
- `git diff --check`: 통과.
- `npm audit --omit=dev`: **0건**.
- 전체 `npm audit`: Azure 인증 의존성 업데이트로 high 경고가 3개에서 **1개**로 감소했다. 이후 최신 CI 테스트 도구를 포함한 전체 경고는 **15개**(high 1, moderate 13, low 1)다. 남은 high는 Mocha 계열의 `serialize-javascript` 개발 의존성이다. 전체 취약점 해소를 주장하지 않는다.

## CI 시간대 회귀 수정

첫 GitHub CI에서는 DB 통합 검사가 통과했지만 6개 OS/VS Code 조합이 모두 결과 고정 시간 테스트에서 실패했다. 테스트가 한국 시간 값을 고정으로 기대하고 UTC 실행 환경을 고려하지 않은 것이 원인이었다. 제품의 로컬 시간 표시 동작은 유지하고 테스트 입력을 실행 환경의 로컬 시각으로 수정했다.

추가로 UTC·서울·뉴욕의 알려진 변환값과 날짜 경계·DST를 검증하는 별도 프로세스 회귀 검사 6개를 추가했다. 전체 단위 검사를 세 시간대에서 각각 실행해 **Mocha 195개와 standalone 16개** 통과를 확인했고, 타입·린트·번들과 최신 Host 3개도 통과했다.

### 후속 패키지·macOS 실행 수정

단위 검사 다음 단계에서 CI의 새 의존성 설치에 포함된 선택적 `cpu-features`의 빌드 소스가 VSIX에 섞인 문제가 드러났다. 개발 파일 검사를 완화하지 않고 `deps`·`src` 디렉터리를 패키지에서 제외했다. 런타임의 `lib`와 생성된 `build/Release` 바이너리는 유지한다.

macOS stable은 기존 test-electron 2.5.2가 `Contents/MacOS/Electron`을 고정으로 사용해 실행 파일을 찾지 못했다. 공식 도구 test-electron 3.1.0과 test-cli 0.0.15로 갱신했다. 새 test-electron은 앱의 Info.plist와 실제 실행 파일을 확인하며 구버전 경로도 지원한다. 공식 근거는 [확장 테스트 문서](https://code.visualstudio.com/api/working-with-extensions/testing-extension)와 [vscode-test 소스](https://github.com/microsoft/vscode-test)다.

## 재실행

```powershell
npm ci
npm test
docker compose -p dbunny-verify up -d --wait --wait-timeout 180
npm run compile-tests
npm run test:integration
npm run package-extension -- --out dbunny.vsix
$env:VSCODE_TEST_VERSION = '1.85.0'
npm run test:package -- dbunny.vsix
Remove-Item Env:VSCODE_TEST_VERSION
```

전용 포트는 MySQL 23306, PostgreSQL 25432, MongoDB 27027, Redis 26379, H2 25435이며 loopback에만 노출된다. 기존 `kdt-mysql`·`kdt-redis`는 변경하지 않았다. 종료 명령은 `docker compose -p dbunny-verify stop`이며 데이터 볼륨은 보존한다.

통합 로그: `test-results/integration/*.log`. 전체 실행 로그: `integration-latest.log`, `verification-latest.log`, `package-runtime-latest.log`. 이 파일들과 테스트 DB·VSIX는 Git 추적 및 패키지에서 제외한다.

## 배포와 남은 범위

[공식 게시 문서](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#publish-with-github-actions-and-trusted-publishing)와 [Microsoft 전환 가이드](https://developer.microsoft.com/blog/trusted-publishing-visual-studio-marketplace/)를 확인했다. 정책의 owner는 `chimaek`, repository는 `dbunny`, workflow는 `publish.yml`, environment는 `marketplace`다. 자세한 절차는 [PUBLISHING.md](./PUBLISHING.md)에 있다.

일반 main push는 검증만 실행한다. 버전 태그 생성·Marketplace 신뢰 정책 변경·실제 게시는 수행하지 않는다. GitHub의 실제 cross-platform CI 결과와 OIDC 토큰 교환은 로컬 테스트로 검증한 범위에 포함되지 않는다. 모든 Webview의 시각·클릭 흐름을 전수 검사한 것도 아니다.

SQL 분류와 서버 설정은 DB 자체의 읽기 전용 계정·권한을 대체하지 않는다. SSH 호스트 키 확인 UI, 대용량/취소, Webview 전체 분리는 후속 개선 범위다.
