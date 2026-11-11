# DBunny 개발·검증·배포

제품 사용법은 [README](README.md), 다음 개선은 [ROADMAP](ROADMAP.md), 변경 이력은 [CHANGELOG](CHANGELOG.md)에 있다. 작업 상태·목표·검증 기준은 [docs/roadmap.json](docs/roadmap.json) 한 곳에서 관리한다. 새 Markdown 대신 기존 문서의 해당 절과 실행 가능한 예제를 갱신한다.

## 작업 흐름

1. 작업 폴더·브랜치·원격·직전 CI를 확인하고 기존 변경을 보존한다.
2. 다음 명령으로 현재 하위 작업 하나만 읽는다. 전체 로드맵 JSON을 출력하지 않는다.

```powershell
node -e "const r=require('./docs/roadmap.json'); const p=r.parents.find(p=>p.units.some(u=>u.id===r.currentTask)); console.log(JSON.stringify({lastWork:r.lastWork,...p.units.find(u=>u.id===r.currentTask)},null,2))"
```

3. 재현 입력과 기대 결과를 정하고 한 함수·한 상태 전이·한 오류 경계만 변경한다. 기본은 개발·로컬 확인 20~30분, 주 코드 파일 1개와 필요한 테스트다.
4. 관련 검사를 통과한 뒤 변경·다음 currentTask·직전 lastWork(VERIFYING)를 함께 커밋·push한다. 실제 CI 성공이 완료 근거다. 다음 실행에서 확인한 결과는 다음 실제 변경과 함께 기록한다.
5. 부모의 마지막 하위 작업에서 통합 완료 기준을 확인한다. 환경이 없거나 일이 크면 더 작은 후속 범위를 기록하고 멈춘다. 빈 커밋과 상태만 바꾸는 커밋은 만들지 않는다.

로그는 test-results에 보관하고 성공 요약 또는 실패한 부분만 확인한다. 커밋에는 하위 ID와 실제 변경을 설명한다. 일반 push와 Marketplace 게시를 구분한다.

## 환경과 검증

Node.js 24와 잠금 파일을 사용하며 VS Code 최소 버전은 1.85.0이다. test-electron 3.1.0/test-cli 0.0.15/vsce 4.1.0 개발 도구의 Node 요구와 Extension Host 내장 Node는 구분한다.

작업 데이터의 검증 표기는 C=타입·린트·단위, H=Host/실제 UI, D=전용 DB, P=VSIX, W=문서·자료다. 부모 기준 전체를 매일 반복하지 않고 오늘 바뀐 경계에 필요한 검사를 수행한다.

```powershell
npm ci
npm test
```

npm test는 타입·린트·컴파일·단위·격리 Extension Host 검사다. DB 통합 검사는 별도다. 작은 반복 개발은 compile-tests 후 관련 검사를 실행하고, 최종 검증은 변경 경계에 맞춰 수행한다. 이미 성공한 같은 내용의 검사를 이유 없이 반복하지 않는다. UI를 실제로 보지 않은 Host 검사로 시각·클릭 검증을 주장하지 않는다.

### 실제 DB

```powershell
npm run compile-tests
docker compose -p dbunny-verify up -d --wait --wait-timeout 180
npm run test:integration
```

전용 계정·포트만 사용한다. MySQL 23306, PostgreSQL 25432, MongoDB 27027, Redis 26379, H2 25435는 127.0.0.1에만 노출하며 SQLite는 로컬 파일이다. 포트 충돌 시 DBUNNY_TEST_MYSQL_PORT/POSTGRES_PORT/MONGODB_PORT/REDIS_PORT/H2_PORT를 Compose와 테스트에 동일하게 전달한다. 다른 프로젝트나 사용자 DB를 변경하지 않는다.

현재 통합 묶음은 데이터를 공유하므로 병렬 실행하지 않는다. DB 실행 경로를 바꾸면 실제 통합 검사를 수행한다. 중지는 docker compose -p dbunny-verify stop이며 볼륨을 지우지 않는다. DB 미준비·실패·미실행을 성공으로 쓰지 않는다.

### VSIX

```powershell
npm run compile-tests
npm run package-extension -- --out dbunny.vsix
$env:VSCODE_TEST_VERSIONS = '["1.85.0","stable"]'
npm run test:package -- dbunny.vsix
Remove-Item Env:VSCODE_TEST_VERSIONS
```

드라이버·번역·아이콘·SQLite WASM SELECT 1·격리 Host 활성화와 명령을 검사한다. 패키지·의존성·게시 설정을 바꾸면 수행한다. 테스트 DB·로그·소스맵·개인 설정·개발 문서를 패키지에 포함하지 않는다. 일반 개발 중에는 개인 편집기에 설치하는 대신 격리 검사를 사용한다.

### CI

실제 분류는 [ci-plan](scripts/ci-plan.cjs), 필수 결과는 [ci-result](scripts/ci-result.cjs), 실행은 [workflow](.github/workflows/ci.yml)가 기준이다.

- 문서만 변경: 정책 검사와 결과 확인. 일반 코드: Linux stable. DB 관련 변경: 실제 통합 추가.
- 의존성·CI·빌드·연결/보안 등 환경 민감 변경과 릴리스: 3개 OS × 최소/stable 전체 호환 검사.
- Linux에서 만든 동일 VSIX·테스트 harness를 재사용한다. npm 설치는 OS당 한 번이며 native node_modules를 OS 간 공유하지 않는다.
- 수동 Verify DBunny의 full=false는 Linux+DB, full=true는 전체 범위다. 태그 검사는 항상 전체다.
- 일반 브랜치 중복 실행은 취소하며 태그는 취소하지 않는다. VSIX 7일, harness 1일, 실패 DB 로그 3일 보관이다.

## 게시

공식 문서 확인일: 2026-11-11. [공식 게시 가이드](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#publish-with-github-actions-and-trusted-publishing)와 [vsce Trusted Publishing](https://github.com/microsoft/vscode-vsce#trusted-publishing)을 따른다. publisher는 chimaek, 확장 ID는 chimaek.dbunny다.

1. 사용자가 승인한 버전·범위에서 package.json, CHANGELOG, 한·영 README를 맞춘다. 일반 개발 요청으로 릴리스를 시작하지 않는다.
2. 필수 코드·DB·VSIX 검사와 전체 CI를 통과한다. 읽기 전용·자격증명 이전·업그레이드·알려진 제약을 확인한다.
3. Marketplace 신뢰 정책은 chimaek/dbunny, publish.yml, environment marketplace와 일치해야 한다. GitHub environment는 v* 태그로 제한한다. 게시 job만 id-token: write를 갖고 장기 PAT를 사용하지 않는다.
4. 승인한 커밋에 매니페스트와 같은 v<version> 태그를 올린다. [publish workflow](.github/workflows/publish.yml)가 태그·VSIX publisher/name/version을 확인하고 검증한 같은 artifact를 OIDC로 게시한다. 게시 단계에서 재빌드하지 않는다.
5. 게시 명령 성공 후 Marketplace의 Verifying가 끝났는지 공개 버전·README·CHANGELOG·이미지를 확인한다. 공식 Gallery에서 VSIX를 받아 SHA-256과 핵심 파일을 비교하고 다운로드한 파일로 Host 검사를 한다.
6. 게시 로그의 UTC/KST, 버전별 lastUpdated, 소스 태그/SHA·workflow·패키지 해시·제약은 docs/releases/<version>.json과 GitHub Release에 기록한다. 최초 Released on은 해당 버전 게시 시각이 아니다.
7. 수정 배포는 더 높은 patch 버전이다. 게시한 태그를 옮기거나 같은 버전을 재포장하지 않는다. pre-release는 별도 숫자 버전/채널 흐름을 준비한 뒤 사용한다.

3.2.0의 [게시 기록](docs/releases/3.2.0.json)과 [GitHub Release](https://github.com/chimaek/dbunny/releases/tag/v3.2.0)는 보존한다. Marketplace lastUpdated 기록은 2026-11-09 15:20:51 KST이고 검증 CI와 공개 VSIX의 SHA-256이 일치했다. GitHub Release 작성일 11월 11일과 구분한다.

## 검증 근거

이미 해결한 사례다. 새 이력서 성과는 재현·원인·선택·실제 검증·커밋/CI·한계를 연결한다. 미해결 문제는 roadmap.json의 observations와 해당 작업에 남긴다.

- PostgreSQL # 연산자를 주석으로 잘못 처리하는 경계를 방언별 판정·공통 가드·서버 읽기 전용으로 보완했다. [판정](src/utils/readOnlyGuard.ts), [실제 실행 정책 검사](src/test/integration/executionPolicy.test.ts). 문자열 검사로 DB 권한을 대체하지 않는다.
- 시간대별 기대값 문제는 제품 날짜 처리를 바꾸지 않고 fixture와 UTC/Seoul/New York 자식 프로세스 검사로 해결했다. [수정](https://github.com/chimaek/dbunny/commit/e697db7).
- 최신 macOS 앱 경로는 테스트 도구 갱신으로, Windows native DLL 잠금은 드라이버 검사를 자식 프로세스로 분리해 해결했다. [macOS](https://github.com/chimaek/dbunny/commit/6132f75), [Windows](https://github.com/chimaek/dbunny/commit/bd5db11).
- CI 반복 설치·패키징은 변경 분류와 동일 artifact 재사용으로 줄였다. [구현](https://github.com/chimaek/dbunny/commit/4120926), [전체 검사 287초/작업 합 504초](https://github.com/chimaek/dbunny/actions/runs/42567938225), [빠른 검사 147초/합 203초](https://github.com/chimaek/dbunny/actions/runs/42568464247). 비교 기준은 345초/합 1,021초였지만 실행 범위·캐시·runner가 다른 1회 표본이므로 동일 조건의 성능 향상률이나 요금 절감액으로 쓰지 않는다.
- 3.2.0은 전체 호환 검증 후 OIDC로 게시하고 공개 다운로드 해시까지 확인했다. [게시 CI](https://github.com/chimaek/dbunny/actions/runs/42570752385). 단위 195개·standalone 16개·DB 통합 22개 묶음은 당시 검증 범위다.

원래의 점검·실측 자료는 [정리 전 문서 기록](https://github.com/chimaek/dbunny/tree/d304588b9c8dc9873fd1d748711f0bc158110938/docs)에 남아 있다. 모든 Webview의 전수 사용성 검증이나 실제 사용자 성장 검증으로 확대하지 않는다.
