# CI 실행 범위와 재실행

일반 변경의 피드백 시간을 줄이면서 배포 전 호환 검사는 유지한다. CI 설정은 `.github/workflows/ci.yml`, 게시 설정은 `.github/workflows/publish.yml`에 있다.

## 실행 범위

- 문서 전용 변경: 변경 판정과 공통 결과 체크만 실행한다. `docs/`, README, CHANGELOG, ROADMAP, CONTRIBUTING, LICENSE가 대상이다.
- 일반 코드·리소스·단위 테스트 변경: Linux에서 단위 검사, 타입·린트·프로덕션 빌드, 운영 의존성 감사, stable VS Code 패키지 실행을 확인한다.
- DB에 영향을 주는 변경: 일반 검사와 전체 DB 통합 묶음을 병렬로 실행한다. `src`의 실행 코드, UI의 SQL, 통합 테스트, Docker 설정·초기화 자료를 포함한다. 번역과 단위/Host 테스트만 바뀐 경우는 제외한다.
- 환경에 민감한 변경: 모든 검사를 수행한다. CI·검증 스크립트, package/lockfile, 빌드·린트·타입 설정, 패키지 제외 설정, 연결 관리자, SSH를 사용하는 MySQL/PostgreSQL, SQLite 파일 처리, 자격증명·암호화·읽기 전용 실행 경계 변경이 대상이다.
- 알 수 없는 경로나 비교 기준을 읽을 수 없는 경우: 검사를 생략하지 않고 전체 범위로 실행한다.
- 릴리스 태그와 게시 workflow의 재사용 호출: 항상 전체 검사를 수행한다.

push의 전체 이전/현재 커밋 범위를 비교하며 PR은 base 커밋과 비교한다. rename의 이전 경로도 포함하므로 코드를 문서 경로로 옮기는 변경이 문서 전용으로 판정되지 않는다.

## 전체 호환 검사

1. Linux에서 단위 검사를 실행하고 VSIX를 한 번 만든다. vsce의 prepublish가 타입·린트·번들을 수행하므로 별도의 개발 번들 빌드는 반복하지 않는다.
2. 같은 VSIX를 VS Code 1.85.0과 stable에서 순서대로 실행한다. 패키지 Host 검사가 실제 번들 활성화와 기본 명령·실행 경계를 확인하므로 같은 소스 Host 검사를 중복 실행하지 않는다. 로컬의 `npm test` 동작은 유지한다.
3. Windows·macOS는 OS마다 한 번만 의존성을 설치한다. Linux에서 생성한 VSIX와 컴파일한 테스트 파일을 받아 단위 검사와 두 버전의 패키지 Host 검사를 수행한다.
4. DB 통합 검사는 별도 Linux 작업에서 기존 전체 묶음을 실행한다. 공유 테이블·키 때문에 묶음의 순서는 유지한다.
5. `CI result`는 선택된 모든 작업이 성공했는지 확인한다. 필요한 작업이 실패·취소·예상 밖 생략 상태이면 성공 처리하지 않는다.

브랜치 보호에서 필수 체크를 지정할 때는 개별 조건부 작업 대신 `CI result`를 사용한다. workflow 전체를 paths-ignore로 생략하지 않으므로 문서 변경에서도 공통 결과 체크가 완료된다.

## 수동 실행

GitHub Actions에서 `Verify DBunny` → Run workflow를 사용한다.

- `full=false`: Linux의 stable 패키지 검사와 실제 DB 통합 검사.
- `full=true`: 3개 OS의 최소/stable 조합 및 DB 통합 검사.

태그를 대상으로 실행하면 입력값과 관계없이 전체 범위를 검증한다. 수동 검증은 Marketplace 게시를 시작하지 않는다.

판정·버전 선택·공통 결과 체크 자체를 로컬에서 검증하는 명령:

```powershell
npm run test:ci-policy
```

## 중복 실행과 보관

- 같은 브랜치나 PR에 새 커밋이 올라오면 이전 검증 실행을 취소한다. 태그 검증과 게시 작업은 자동 취소하지 않는다.
- 일반 CI에는 VS Code 버전별 설치 작업을 두지 않는다. OS별 설치 한 번으로 두 버전을 검증한다.
- VSIX는 7일, 컴파일한 테스트 파일은 1일 보관한다.
- DB 로그는 실패할 때만 artifact로 올리고 3일 보관한다. 성공한 작업의 콘솔 로그는 GitHub 실행 기록에서 확인한다.
- npm 다운로드 캐시는 유지한다. `node_modules`의 네이티브 파일을 다른 OS에 공유하지 않는다.

## 측정 기준

개선 전 기준은 성공 실행 `42176847759`다. 작업 시작~마지막 완료 345초, 작업 시간 합계 1,021초였고 Windows npm ci가 161초·259초를 차지했다. 일반 변경은 Linux·조건부 DB 작업만 사용한다. 전체 변경도 설치 횟수를 7회에서 4회로, VSIX 생성을 6회에서 1회로 줄였다. 실제 속도는 설치·캐시·러너 상태에 따라 달라지므로 실행 기록을 기준으로 비교한다.

공식 근거: [동시 실행 제어](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency), [조건과 재사용 workflow](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax), [artifact 보관](https://github.com/actions/upload-artifact).
