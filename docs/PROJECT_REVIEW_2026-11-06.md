# DBunny 프로젝트 점검 및 다음 작업

> 이 문서는 2026-11-06 개선 전 점검 스냅샷이다. 후속 수정과 Docker 검증은 [구현 개선 및 검증 결과](./IMPLEMENTATION_VALIDATION_2026-11-06.md), 현재 공개 배포는 [3.2.0 게시 기록](releases/3.2.0.md), 이후 계획은 [제품 로드맵](../ROADMAP.md)을 따른다. 아래의 당시 미해결 항목을 현재 실패 상태로 읽지 않는다.

점검일: **2026-11-06 (한국 시간)**
대상: `C:\Users\pipir\OneDrive\Desktop\projects\dbunny`
판단: **기능은 충분히 갖춰져 있지만, 현재 작업 폴더를 그대로 정식 배포하기에는 해결해야 할 문제가 있다. 다음 작업은 기능 추가보다 실행 안전성·기능 설명의 정확성·배포 검증을 마무리하는 것이다.**

## 1. 현재 상태

- 확장 ID: `chimaek.dbunny`. 로컬 버전은 **3.2.0**, GitHub 기본 브랜치와 Marketplace 최신 게시 버전은 **3.1.0**이다. 공개 Marketplace 조회 API와 GitHub 연결 도구로 이번에 다시 확인했다.
- 로컬 `main`은 로컬에 저장된 `origin/main`보다 2커밋 앞서 있다. 이 숫자는 fetch하지 않은 로컬 참조 기준이다.
- 점검 시작 시 추적 파일 42개 수정, 미추적 파일 15개가 있었다. 보안 유틸리티·테스트·CI·문서 변경이 아직 커밋되지 않았다.
- TypeScript 파일 99개, 명령 48개, Webview 패널 15개, DB 프로바이더 6개다. MySQL·PostgreSQL·SQLite·H2·MongoDB·Redis를 지원한다.
- Node.js Extension Host용 확장이다. `main`은 `dist/extension.js`이고 `browser` 진입점은 없다. vscode.dev 브라우저 단독 실행을 지원하는 형태는 아니다.

공개 상태: [Marketplace DBunny](https://marketplace.visualstudio.com/items?itemName=chimaek.dbunny), [GitHub package.json](https://github.com/chimaek/dbunny/blob/main/package.json).

### 구조와 실행 흐름

```text
package.json의 명령·뷰 등록
  → src/extension.ts의 activate()
  → 번역 로드 → ConnectionManager.ready로 저장 연결·비밀값 이전
  → 트리뷰·명령·자동완성 등록
  → commands / webview에서 연결과 실행 요청
  → ConnectionManager가 CredentialStore로 비밀값 복원
  → guardConnection이 읽기 전용 검사·실행 직렬화·결과 제한
  → 각 DB Provider가 드라이버로 실행
  → QueryResult를 Webview에 표시 / 이력 저장 / 내보내기
```

좋은 기반도 있다. DB 구현은 공통 인터페이스로 분리되어 있고, 기존 변경에 SecretStorage 이전, 공통 실행 가드, nonce 기반 CSP, 테스트 러너, VSIX 검증, 태그 기반 게시 흐름이 추가되어 있다. 이 변경들을 검증하고 완성하는 것이 우선이다.

## 2. 이번에 실행한 검증

- `npm run compile-tests`: 통과.
- `npm run compile`: 타입 검사·ESLint·개발 번들 통과.
- `npm run test:unit`: **실패**. Mocha 188개 통과. standalone 16개 중 15개 통과, `security.standalone`은 내부 검사 136개 통과·1개 실패.
- `npm run test:extension`: **VS Code stable 1.145.1에서 3개 통과**.
- `VSCODE_TEST_VERSION=1.85.0`으로 같은 Extension Host 검사: **3개 통과**. 최소 버전에서 활성화·기본 명령·SQLite 실행 경계까지만 검증한 결과다.
- `npm run package-extension -- --out <점검용 VSIX>`: 통과. **1,173파일, 약 10.06MB**, 런타임 번들은 약 1.32MB다.
- `npm run test:package -- <점검용 VSIX>`: 통과. 압축 내부 개발 파일 검사, 필요한 리소스, 외부 DB 드라이버 로딩, SQLite WASM 실행, 패키지 활성화와 3개 Host 검사를 확인했다.
- `npm audit --omit=dev --json`: **0건**.
- `npm audit --json`: **15개 패키지 경고**. high 3·moderate 11·low 1. 같은 advisory의 전파도 집계하므로 독립된 취약점 15개라는 뜻은 아니다. 현재 결과는 개발·배포 도구 의존성에서 발생했다.
- 실제 DB 전체 통합 테스트: **미실행**. Docker 엔진은 실행 중이지만 다른 프로젝트의 `kdt-mysql`·`kdt-redis`가 3306·6379 포트를 사용 중이다. 현재 Compose를 그대로 올리면 충돌한다. 기존 컨테이너나 데이터는 변경하지 않았다.
- Windows 샌드박스에서는 네트워크·Electron ACL·임시 SQLite 파일 권한 오류가 발생해, 해당 검사는 권한이 허용된 실행으로 다시 확인했다. 위 결과는 재실행 결과다.

패키지와 기본 Host 검사가 통과했다는 사실은 모든 Webview 버튼과 6개 DB 기능이 검증됐다는 뜻이 아니다. 단위 검사 실패와 아래 실행 정책 문제는 여전히 남아 있다.

## 3. 배포 전에 먼저 해결할 문제

### P1-1. PostgreSQL 읽기 전용 가드 우회

위치: `src/utils/readOnlyGuard.ts:70`, `src/utils/guardedConnection.ts`, `src/webview/MonitoringPanel.ts:254`.

`stripStringsAndComments()`는 DB 종류와 관계없이 `#` 이후를 주석으로 지운다. PostgreSQL에서는 `#`가 정수 XOR 연산자이므로 뒤에 붙은 쓰기 구문까지 검사에서 사라질 수 있다.

```sql
VALUES (1 # 2); DELETE FROM items
```

이번 로컬 검사에서 `checkWriteOperation(..., 'postgres')`는 `{ isWrite: false, keyword: null }`을 반환했고, `readOnly: true`인 가드가 이 문자열을 가짜 드라이버까지 전달했다. `VALUES`는 SELECT 미리보기 감싸기 대상도 아니다. 실제 PostgreSQL에서 삭제를 실행한 실험은 하지 않았다. **가드 분류와 실행 경계 통과는 재현했고, 실제 DB 영향은 소스와 PostgreSQL 문법에 근거한 판단이다.** [PostgreSQL 연산자 문서](https://www.postgresql.org/docs/current/functions-math.html).

또한 `SELECT pg_terminate_backend(123)`와 `SELECT setval('my_seq', 100)`도 읽기로 분류된다. 모니터의 PostgreSQL Kill 버튼은 실제로 첫 번째 형태를 사용하며 별도의 readOnly 확인이 없다. SELECT로 시작한다고 부작용이 없는 쿼리는 아니다. [PostgreSQL 관리 함수](https://www.postgresql.org/docs/current/functions-admin.html).

해야 할 일:

1. SQL 토큰 처리를 DB 방언별로 분리하고 다중 구문을 명확히 제한한다.
2. 모니터 Kill·루틴·관리 작업을 일반 조회와 분리하고 공통 실행 정책으로 검사한다.
3. DB의 읽기 전용 계정·권한과 가능한 서버 읽기 전용 세션을 함께 사용한다. 키워드 필터만으로 운영 DB 보호를 보장하지 않는다.
4. 위 입력의 가드 회귀 검사와 격리 PostgreSQL 통합 검사를 추가한다. 테스트 데이터가 유지되는 것까지 확인한다.

완료 기준: 읽기 전용 연결의 다중 구문·쓰기 함수·관리 작업이 차단되고, 정상 SELECT·CTE·SHOW는 유지된다.

### P1-2. 마이그레이션 적용·롤백이 DB에서 실행되지 않음

위치: `src/webview/MigrationPanel.ts:109`, `:141`, `:152`.

`setDatabaseName()`은 DB 이름을 보관하지 않는다. `_applyMigration()`은 상태를 `applied`로 바꾸고 `_rollbackMigration()`은 `rolled_back`으로 바꾼다. 두 함수 모두 DB 연결이나 `executeQuery()`를 호출하지 않는다. 현재 기능은 스크립트와 상태를 관리하는 화면이며, 실제 스키마를 적용·복원하는 기능이 아니다. README의 “UP/DOWN 스크립트, 롤백” 설명은 사용자가 실제 DB 작업으로 받아들일 수 있다.

해야 할 일:

- 이번 릴리스에서는 실제 실행 기능을 완성하거나, 버튼·알림·README를 “스크립트 관리 / 수동 적용 상태 기록”으로 정확하게 바꾼다.
- 실행 기능을 구현한다면 대상 연결·DB, 사전 확인, DB별 DDL 트랜잭션 한계, 실패 상태, 적용 이력을 설계한다.
- 성공 메시지는 실제 실행 완료 후에만 표시한다. DB별로 롤백 가능한 범위를 명시한다.

완료 기준: 적용 성공 후 실제 테이블 변화가 확인되거나, 사용자가 상태 기록 기능임을 명확히 이해한다.

### P1-3. PostgreSQL에서 다른 DB를 조회할 때 SSH 터널을 우회함

위치: `src/providers/postgresProvider.ts:118`, `:482`.

최초 연결은 SSH 터널의 로컬 주소를 사용하지만, 다른 데이터베이스용 임시 `Client` 두 곳은 원래 `config.host`와 `config.port`를 직접 사용한다. SSH를 통해서만 접근 가능한 서버에서 DB 선택을 바꾸거나 메타데이터를 탐색하면 직접 연결을 시도해 실패할 수 있다. 이번에는 소스로 확인했으며 실제 SSH 서버로 재현하지 않았다.

해야 할 일: 터널을 거친 최종 접속 주소와 연결 옵션을 한 곳에서 만들고 모든 임시 연결에 재사용한다. SSH 뒤에 DB 두 개를 둔 환경에서 전환·조회·루틴 탐색까지 검증한다.

### P1-4. 단위 테스트 1건이 계속 실패함

위치: `src/test/unit/security.standalone.ts:409`, `src/providers/mongoProvider.ts:124`, `src/utils/readOnlyGuard.ts`.

실패 입력은 다음과 같다.

```javascript
db.users.aggregate([{$group:{_id:null,count:{$sum:1}}}])
```

가드는 aggregate 인자를 JSON으로 해석하는데 이 입력에는 키 따옴표가 없다. 현재 Provider의 shell 파서도 같은 입력을 `JSON.parse` 오류로 거부한다. 따옴표를 넣은 JSON 형태는 파싱된다. 따라서 무조건 aggregate를 허용하는 방식으로 테스트만 통과시키면 안 된다.

권장 방향: 지원 문법을 먼저 정한다. 현재 파서를 유지한다면 JSON 호환 인자를 공식 문법으로 설명하고 안전 쿼리 테스트를 그 문법에 맞춘다. `$out`·`$merge`와 유니코드 이스케이프 우회 차단은 유지한다. 일반 Mongo shell 문법을 지원하려면 제한된 파서를 사용하며 `eval`·`Function`은 쓰지 않는다.

완료 기준: Provider와 가드가 같은 문법을 공유하고 `npm run test:unit`이 모두 통과한다.

## 4. 그다음 개선할 점

### P2-1. 테스트 파일과 CI에서 실행하는 범위가 다름

`src/test/integration`에 `.test.ts` 20개가 있지만 `scripts/run-integration-tests.cjs:19`는 `run-all`과 `executionPolicy.test`만 실행한다. 나머지 19개 별도 테스트 파일은 이 CI 경로에서 실행되지 않는다. `npm run test:integration`도 `run-all`만 실행한다.

기능별 파일이 DB 데이터를 공유·수정할 수 있으므로 무작정 glob으로 실행하기보다, 각 파일의 DB·초기화·정리 조건을 정해 순서 또는 격리 실행 목록을 만든다. 테스트마다 포트·DB 이름을 환경 변수로 주입하고 기존 개발 DB와 분리한다. Extension Host의 3개 검사는 기본 동작 검사이므로 연결 폼, 편집, 가져오기, 내보내기, 위험 작업 버튼의 실제 메시지 흐름 검사가 추가로 필요하다.

### P2-2. SSH 호스트 키 확인과 암호화 키 지원

`mysqlProvider.ts:358`, `postgresProvider.ts:548`의 SSH 옵션에 `hostVerifier`와 `passphrase`가 없다. 저장 구조는 passphrase를 보관할 수 있지만 실제 SSH 연결에는 전달하지 않는다. ssh2는 hostVerifier를 설정하지 않으면 호스트 키를 자동 수락한다. [ssh2 공식 옵션](https://github.com/mscdex/ssh2#client-methods).

최초 연결 시 지문 확인·저장, 변경 시 차단 또는 명시적 재확인, 암호화 개인키 passphrase 전달을 구현한다. 클라우드 DB용 TLS/CA 옵션도 별도 설계할 가치가 있다.

### P2-3. 개발·배포 의존성 15개 감사 경고

주요 경로는 vsce의 Azure 인증 의존성, Mocha의 `serialize-javascript`, glob/minimatch 계열이다. 운영 의존성 감사 0건과 별개로 CI·게시 도구도 관리해야 한다. 현재 lockfile의 의존성 경로를 확인하고 도구별 호환 업데이트를 적용한다. `npm audit fix --force` 결과를 일괄 적용하지 않는다. 높은 등급의 경고부터 실제 사용 경로와 수정 버전을 확인한다.

참고 advisory: [MSAL Node](https://github.com/advisories/GHSA-xcx6-jx8p-x3h5), [serialize-javascript](https://github.com/advisories/GHSA-5c6j-r48x-rmvq).

### P2-4. Webview 유지보수와 메시지 검증

nonce CSP와 안전한 JSON 직렬화 도입 방향은 좋다. 다만 HTML·CSS·스크립트가 거대한 TypeScript 문자열에 섞여 있고, `webviewSecurity.ts`는 문자열 이벤트 표현식을 해석하는 별도 문법까지 유지한다. TypeScript 컴파일만으로 Webview 내부 JavaScript와 실제 버튼 동작을 충분히 검증할 수 없다.

`QueryTabPanel.ts` 2,647줄, `QueryResultPanel.ts` 2,355줄, `commands/index.ts` 1,837줄이다. UI 스크립트·스타일을 별도 파일로 추출하고 `data-action`과 정해진 핸들러 매핑을 사용한다. Host의 `onDidReceiveMessage`에서 명령·인자 타입·연결 ID·행 번호·프로세스 ID를 검증한다. DB 결과·컬럼명·파일 이름에 따옴표와 HTML이 들어가는 UI 회귀 검사를 우선 만든다. [VS Code Webview 보안·상태 보존](https://code.visualstudio.com/api/extension-guides/webview).

### P2-5. 대용량 조회·취소·전체 내보내기

SELECT 미리보기 제한은 있지만 SQLite는 동기 WASM 실행이고 Redis에는 서버 쿼리 timeout이 없다. Redis의 `KEYS`·큰 컬렉션 결과도 먼저 메모리에 올라갈 수 있다. 현재 내보내기는 반환된 제한 행을 사용하므로 전체 백업과 다르다. 이 한계는 로컬 README에 이미 설명되어 있다.

쿼리 취소, SQLite Worker 실행, Redis SCAN 기반 페이지 처리, 미리보기와 구분된 전체 내보내기를 순서대로 검토한다. 전체 내보내기는 읽기 전용 스트리밍·진행률·취소·완료 행 수를 함께 제공한다. 로드맵의 백업/복원 구현 전에 이 데이터 경로를 정리하는 편이 좋다.

### P2-6. VS Code 환경별 지원 정책

현재 manifest에는 `extensionKind`, `capabilities.untrustedWorkspaces`가 없다. 누락 자체를 취약점으로 단정할 수는 없다. DB 주소·SQLite 경로·SSH 키가 로컬과 Remote SSH/WSL에서 어디를 기준으로 해석되는지 결정하고 문서화해야 한다. 워크스페이스 설정과 SQL 파일을 다루는 기능에 맞춰 Restricted Mode 지원 범위를 정한다. 명령 이름·설정 설명의 영어/한국어는 `package.nls.json`도 검토한다. [Workspace Trust](https://code.visualstudio.com/api/extension-guides/workspace-trust), [Remote Extension](https://code.visualstudio.com/api/advanced-topics/remote-extensions).

### P2-7. 패키지 최적화는 실측을 기준으로

현재 VSIX는 10.06MB이고 1,173파일 중 JavaScript가 963개여서 vsce가 번들링 경고를 낸다. 압축을 풀면 `node_modules`는 약 27.69MB다. esbuild가 일부 드라이버를 external로 유지하므로 무조건 `node_modules` 전체를 제외하면 깨진다.

필수 WASM·번역 JSON·SSH 런타임을 유지하면서 추가 번들링 가능성을 검토한다. Windows에서 만든 범용 VSIX가 Linux/macOS에서도 로드되는지 CI 패키지 검사로 확인한다. 실제 네이티브 바이너리가 필요한 경우 플랫폼별 VSIX를 고려한다. 우선순위는 안전성·기능 정확성 이후다. [공식 번들링 가이드](https://code.visualstudio.com/api/working-with-extensions/bundling-extension).

## 5. 최신 공식 문서 기준 배포 절차

### 먼저 알아야 할 로컬·원격 차이

- **현재 GitHub** `.github/workflows/publish.yml`: `main` push → Node 20 → `npm install` → compile → PAT 게시. 테스트 job이 없다.
- **현재 로컬 미커밋 설정**: `v*` 태그 push → 재사용 CI → 3개 OS × VS Code 최소/stable 검사 + DB 통합 검사 → 검증 VSIX 다운로드 → OIDC 게시.
- 로컬 새 설정은 방향이 좋지만 아직 GitHub에서 작동하는 설정으로 간주하면 안 된다. Marketplace 신뢰 정책과 GitHub environment 설정 여부도 이번에는 확인하지 않았다.

### 1단계: 게시 경로를 먼저 정리

첫 변경은 배포 워크플로 전환을 포함해 일반 `main` push로 자동 게시되지 않게 한다. `publisher: chimaek`, `name: dbunny`를 유지한다. 새 ID로 게시하면 기존 사용자의 업데이트 경로가 끊긴다.

현재 Node 24는 vsce의 Node 22 이상 요구를 충족한다. 공식 npm 레지스트리에서 이번에 확인한 vsce 안정 버전은 **4.1.0**, Node 요구는 **22 이상**이다. 로컬은 4.0.0으로 고정되어 있고 후속 버전에서 OIDC 계약 수정도 있었으므로, 게시 전에 4.1.0과 lockfile의 호환 업데이트를 검토하고 재검증한다. 실제 OIDC 토큰 교환은 이번 로컬 점검으로 검증하지 않았다. [vsce 공식 저장소](https://github.com/microsoft/vscode-vsce), [릴리스](https://github.com/microsoft/vscode-vsce/releases). 확인 명령: `npm view @vscode/vsce version engines --json`.

### 2단계: Marketplace의 Trusted Publishing 정책

[Marketplace 관리](https://marketplace.visualstudio.com/manage)에서 `chimaek` publisher → Trusted Publishing → Create에 아래 값을 정확히 넣는다.

- Repository owner: `chimaek`
- Repository: `dbunny`
- Workflow: `publish.yml`
- Environment: `marketplace` — 로컬 workflow의 이름과 일치해야 한다.

GitHub에도 같은 environment를 준비하고 태그/승인 보호 규칙을 정한다. 게시 job에는 `id-token: write`와 `contents: read`를 둔다. 계정·정책 변경과 실제 게시는 이 점검에서 수행하지 않았다. [공식 게시 절차](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#publish-with-github-actions-and-trusted-publishing).

### 3단계: 릴리스 후보 검증

깨끗한 검증 환경에서 아래를 실행한다. `npm ci`는 현재 node_modules를 재구성하므로 이번 스캔에서는 실행하지 않았다.

```powershell
npm ci
npm test
npm audit --omit=dev
npm run package-extension -- --out dbunny.vsix
npm run test:package -- dbunny.vsix
```

여기에 격리한 6개 DB 통합 검사와 핵심 Webview 수동 검사를 더한다. CI의 최소 버전·stable·3개 OS 결과를 모두 확인한다. 필요하면 공식 `--pre-release` 채널에서 먼저 검증한다. VS Code Marketplace 버전에는 `3.2.0-beta.1` 같은 SemVer 접미사를 쓰지 않는다. [테스트 문서](https://code.visualstudio.com/api/working-with-extensions/testing-extension), [pre-release 문서](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#pre-release-extensions).

### 4단계: 승인된 버전의 태그로 게시

현재 3.2.0은 공개 API에서 미게시 상태였다. 실제 게시 시 다시 확인하고 package.json·lockfile·CHANGELOG를 맞춘다. P1 문제를 해결하고 모든 필수 검사를 통과한 커밋에만 `v3.2.0` 같은 일치 태그를 만든다. `scripts/check-release.cjs`가 태그 일치를 확인한다.

```text
태그 push
 → .github/workflows/publish.yml
 → ci.yml 검증
 → 검증된 dbunny-vsix artifact 다운로드
 → vsce publish --oidc --packagePath dbunny.vsix
```

테스트한 VSIX와 게시하는 VSIX를 동일하게 유지한다. OIDC 게시가 한 번 성공한 뒤 사용하지 않는 기존 PAT secret을 정리한다. [Microsoft Trusted Publishing 전환 가이드](https://developer.microsoft.com/blog/trusted-publishing-visual-studio-marketplace/).

### 5단계: 게시 후 확인과 복구 계획

Marketplace 버전·README·CHANGELOG와 새 프로필의 설치를 확인한다. 기존 3.1.0 사용자의 DB/SSH 자격증명 이전도 별도 검증한다. 문제가 생기면 원인 수정 후 더 높은 patch 버전으로 배포하는 흐름을 준비한다. 일반 main push는 검증만 수행하도록 유지한다.

## 6. 추천 작업 순서와 완료 조건

### 첫 번째 묶음: 실행 안전성과 실제 동작

- PostgreSQL readOnly 우회·관리 함수·모니터 Kill 정책 수정.
- 마이그레이션을 실제 실행하거나 상태 기록 기능으로 명확하게 표시.
- PostgreSQL SSH 다중 DB 접속 경로 수정.
- MongoDB 지원 문법 통일 후 단위 검사 모두 통과.

완료 조건: 위 문제별 재현 입력이 회귀 검사에 들어가고, 격리 DB에서 영향까지 확인된다.

### 두 번째 묶음: 재현 가능한 검증

- 통합 테스트 20개 파일의 실행·초기화·정리 범위 정리.
- DB 포트와 DB 이름 환경 변수화, 다른 프로젝트 DB와 격리.
- 3개 OS × 최소/stable CI와 실제 VSIX 검사 통과.
- Webview 주요 흐름 및 3.1.0→새 버전 비밀값 이전 검사.
- 개발·배포 의존성 경고의 수정 또는 구체적인 영향 판단 기록.

완료 조건: 새 체크아웃에서도 같은 명령과 결과가 재현된다.

### 세 번째 묶음: 안정화 릴리스

- 원격의 main 자동 게시 흐름을 태그+OIDC로 전환.
- Trusted Publishing 정책·environment 일치 확인.
- README의 실제 기능·제약과 CHANGELOG 정리.
- 검증한 VSIX를 그대로 게시하고 신규 설치·기존 사용자 업데이트 검사.

완료 조건: 태그·커밋·검증 artifact·Marketplace 버전이 서로 연결된다.

### 이후 제품 개선

쿼리 취소와 대용량 처리 → 전체 내보내기 → 민감값 마스킹 및 이력 저장 제어 → Redis/MongoDB 편의 기능 순서를 권한다. 현재 로드맵의 백업·복원은 미리보기 제한과 실제 DB 작업 정책을 정리한 뒤 구현한다. 일정은 위 기능의 검증 결과를 보고 산정한다.

## 7. 점검 범위와 남은 확인

이번 작업은 소스·설정·의존성·공개 게시 상태의 점검과 로컬 검증이다. 소스 전체의 모든 동작, 실제 SSH 서버, 6개 DB 통합, Webview 시각·클릭 검사, Linux/macOS 실행, GitHub의 실제 workflow 실행, Marketplace 계정 정책은 완료하지 않았다. 안전성 문제를 찾았다는 사실과 전체 보안 감사가 완료되었다는 주장을 구분한다.

기존 구현·설정 변경을 유지하고 이 보고서만 프로젝트 문서에 추가했다. 커밋·push·게시·설치된 사용자 확장 변경은 수행하지 않았다. 테스트용 VS Code 다운로드와 빌드 산출물은 개발 검증 경로에 생성되었다.
