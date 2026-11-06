# DBunny 개발 및 검증

## 1. 개발 환경

- Node.js 24 LTS와 npm을 사용한다. 게시 도구 vsce 4는 Node.js 22 이상이 필요하다.
- 확장은 VS Code 1.85 이상을 대상으로 한다. 개발용 Node 버전과 Extension Host 내장 Node 버전은 다르다.
- 테스트 도구는 `@vscode/test-cli` 0.0.15와 `@vscode/test-electron` 3.1.0을 사용하며 Node.js 22 이상을 요구한다. 구버전 test-electron의 macOS `Electron` 경로 가정은 최신 VS Code 앱 구조와 맞지 않는다.
- 저장소에서 `npm ci`로 잠금 파일의 의존성을 설치한다.

```powershell
npm ci
npm run compile
```

## 2. 기본 테스트

```powershell
npm test
```

타입 검사·린트·컴파일 후 DB 없이 실행하는 단위 테스트와 격리된 VS Code Extension Host 테스트를 수행한다. 테스트용 편집기는 프로젝트의 임시 테스트 프로필을 사용한다. 개인 VS Code 설정과 설치된 확장을 변경하지 않는다.

단계를 나누어 실행할 수도 있다.

```powershell
npm run compile-tests
npm run test:unit
npm run compile
npm run test:extension
```

최소 지원 버전을 검증하려면 PowerShell에서 다음처럼 실행한다.

```powershell
$env:VSCODE_TEST_VERSION = '1.85.0'
npm run test:extension
Remove-Item Env:VSCODE_TEST_VERSION
```

설정 파일은 [.vscode-test.mjs](./.vscode-test.mjs)다. 실제 DB에 접근하는 통합 테스트는 기본 테스트 탐색에서 제외한다.

## 3. 실제 DB 통합 테스트

[docker-compose.yml](./docker-compose.yml)은 개발 테스트용 계정과 DB를 사용한다. 운영 DB로 실행하지 않는다.

```powershell
docker compose -p dbunny-verify up -d --wait --wait-timeout 180
npm run compile-tests
npm run test:integration
```

MySQL·PostgreSQL·MongoDB·Redis·H2가 준비된 뒤 `run-all`과 모든 `*.test.ts` 통합 검사를 별도 프로세스에서 순서대로 실행한다. SQLite는 별도 서버가 필요 없다. 가져오기·내보내기·스키마·루틴·읽기 전용·실제 SSH DB 전환까지 검사하며, 실패한 검사도 기록하고 나머지 묶음을 계속 실행한 뒤 최종 종료 코드로 실패를 알린다. 로그는 `test-results/integration/*.log`에 남고 CI에서도 artifact로 보존한다.

기본 포트는 MySQL 23306, PostgreSQL 25432, MongoDB 27027, Redis 26379, H2 25435다. 모두 `127.0.0.1`에만 노출되며 다른 프로젝트의 기본 DB 포트를 사용하지 않는다. Compose 프로젝트 이름으로 컨테이너·네트워크·볼륨도 격리한다. 실행 전에 해당 포트가 비어 있는지 확인한다.

포트를 바꿀 때는 Compose와 테스트에 같은 환경 변수를 전달한다. 예를 들어 PowerShell의 `$env:DBUNNY_TEST_MYSQL_PORT = '23307'`이다. 나머지는 `DBUNNY_TEST_POSTGRES_PORT`, `DBUNNY_TEST_MONGODB_PORT`, `DBUNNY_TEST_REDIS_PORT`, `DBUNNY_TEST_H2_PORT`를 사용한다.

이 DB에는 테스트가 생성·변경·삭제할 수 있는 데이터만 둔다. 기존 테스트는 공통 DB의 테이블과 Redis 키를 사용하므로 묶음을 병렬 실행하지 않는다. 검사 후 전용 컨테이너를 중지하려면 `docker compose -p dbunny-verify stop`을 사용한다. 이 명령은 데이터 볼륨을 삭제하지 않는다.

Docker 엔진이 꺼져 있거나 포트가 사용 중이면 통합 검증을 완료했다고 간주하지 않는다. CI에서도 별도 통합 테스트 job을 수행한다.

## 4. 배포 파일 자체 검증

```powershell
npm run compile-tests
npm run package-extension -- --out dbunny.vsix
npm run test:package -- dbunny.vsix
npm audit --omit=dev
```

패키지 검증은 VSIX를 전용 임시 폴더에 풀고 다음을 확인한다.

- 개발 파일·테스트 DB·source map의 제외.
- 번역 JSON, 아이콘, 번들, 외부 DB 드라이버 포함.
- 패키지 안의 sql.js와 WASM으로 `SELECT 1` 실행.
- 패키지 안의 번들을 격리된 Extension Host에서 활성화하고 명령 등록 검증.

CI는 Windows·macOS·Linux에서 최소 버전과 stable을 검증한다. 게시 job은 Linux stable에서 검증한 동일 VSIX를 내려받아 게시한다.

배포 계정 설정과 릴리스 절차는 [게시 가이드](./docs/PUBLISHING.md)를 따른다.
