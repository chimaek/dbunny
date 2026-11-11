# DBunny 게시 절차

공식 문서 확인일: **2026-11-11**. Node.js 24와 vsce 4.1.0을 사용한다. Marketplace 신뢰 정책 등록과 태그 push는 실제 게시를 시작하는 별도 작업이다. [3.2.0 실제 게시 기록](releases/3.2.0.md)에서 시각·태그·검증 결과를 확인할 수 있다.

## 1. 게시 대상과 인증 방식

- 확장 ID: `chimaek.dbunny`.
- publisher와 확장 이름을 유지한다.
- Node.js 24 LTS, 잠금 파일의 vsce 4.1.0을 사용한다. vsce 4는 Node.js 22 이상을 요구한다.
- 게시 job은 GitHub Actions OIDC로 인증하며 장기 PAT를 사용하지 않는다.

공식 근거: [VS Code 게시 가이드](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#publish-with-github-actions-and-trusted-publishing), [vsce Trusted Publishing](https://github.com/microsoft/vscode-vsce#trusted-publishing), [Microsoft 전환 가이드](https://developer.microsoft.com/blog/trusted-publishing-visual-studio-marketplace/).

## 2. 계정에서 한 번 준비할 사항

1. [Marketplace publisher 관리 화면](https://marketplace.visualstudio.com/manage)에서 `chimaek` publisher를 선택한다.
2. **Trusted Publishing → Create**에서 아래 값을 정확히 입력한다.
   - Policy name: `DBunny release`처럼 구분 가능한 이름.
   - Repository owner: `chimaek`.
   - Repository: `dbunny`.
   - Workflow: `publish.yml` — 경로 전체가 아닌 workflow 파일 이름.
   - Environment: `marketplace` — 게시 job의 environment와 동일해야 한다.
3. GitHub 저장소에 `marketplace` environment를 만들고 게시할 태그 범위와 필요한 승인 규칙을 설정한다.
4. 이 계정에서 trusted publishing 설정을 사용할 수 있는지와 정책의 저장소·워크플로 조건이 정확한지 확인한다.

설정이 없거나 조건이 일치하지 않으면 게시 job은 실패한다. PAT로 자동 전환하지 않는다. 게시 job에만 `id-token: write`를 부여하며 기존 `VSCE_PAT`는 사용하지 않는다. 첫 OIDC 게시 성공을 확인한 뒤 사용하지 않는 PAT secret을 정리한다. 신규 정책이 비공개 저장소용이라면 생성 후 48시간 이내 최초 실행이 필요한 공식 조건도 확인한다.

Azure Pipelines를 사용하는 경우에는 같은 문서의 Microsoft Entra ID/WIF 경로를 따른다. 현재 GitHub workflow는 OIDC 전용이다.

## 3. 변경 검증

```powershell
npm ci
npm test
docker compose -p dbunny-verify up -d --wait --wait-timeout 180
npm run test:integration
npm run package-extension -- --out dbunny.vsix
npm run test:package -- dbunny.vsix
npm audit --omit=dev
```

실제 DB 통합 테스트는 [개발 가이드](../CONTRIBUTING.md)의 전용 포트를 사용한다. CI의 타입·단위·Extension Host·패키지·전체 DB 통합 테스트가 통과해야 게시 job이 시작된다. 기본 `npm test`에는 외부 DB 검사가 포함되지 않는다.

## 4. 릴리스 준비

1. [package.json](../package.json)의 버전과 [CHANGELOG.md](../CHANGELOG.md)를 맞춘다.
2. 사용자에게 보이는 기능은 README의 영어·한국어 설명에 반영한다.
3. 변경을 검토하고 커밋한다.
4. 게시할 때만 버전과 같은 태그를 만든다. 예를 들어 매니페스트가 3.2.0이라면 `v3.2.0`이다.
5. 게시 권한을 가진 사람이 준비된 커밋과 태그를 원격에 올린다.

일반 `main` push와 PR은 변경 범위에 맞는 검증만 실행한다. **`v*` 태그 push가 게시를 시작한다.** 게시 workflow는 `full: true`로 재사용 CI를 호출하므로 문서 변경이나 일반 CI의 빠른 모드와 관계없이 전체 검사를 요구한다. 먼저 태그명과 package.json 버전을 확인하고, 전체 CI 통과 후 내려받은 VSIX 안의 publisher/name/version도 다시 비교한다. 불일치하면 게시하지 않는다.

게시 job은 CI가 생성·검증한 `dbunny.vsix`를 artifact에서 받아 그대로 사용한다. Linux에서 한 번 생성한 동일 파일을 3개 OS의 최소/stable 6개 조합에서 검증하며, 게시 단계에서 다시 번들링하지 않는다. 태그 검증과 게시 실행에는 자동 취소를 적용하지 않는다.

```text
태그 일치 검사 → CI 통과 → 검증된 VSIX 다운로드 → VSIX ID/버전 검사
→ npm run publish-extension
→ vsce publish --oidc --packagePath dbunny.vsix
```

게시 후 [Marketplace](https://marketplace.visualstudio.com/items?itemName=chimaek.dbunny)의 버전·변경 이력과 새 프로필의 설치 동작을 확인한다.

`vsce`의 성공 로그와 Marketplace의 공개 검증 완료는 시점이 다를 수 있다. 관리 화면이 `Verifying`이면 공개 완료로 기록하지 않는다. 공식 Gallery 응답의 버전별 `lastUpdated`와 공개 페이지의 `Last updated`를 확인하고, 게시 로그 시각과 함께 UTC/KST로 남긴다. 페이지의 최초 `Released on`을 해당 버전의 게시일로 쓰지 않는다.

공식 Gallery에서 게시 버전의 VSIX를 내려받아 검증 artifact와 SHA-256을 비교하고, 다운로드한 파일로 패키지 Host 검사를 수행한다. 공개 README의 이미지·링크·한/영 설명도 확인한다. `docs/releases/<version>.md`와 JSON에 실제 소스 태그·SHA·workflow·해시·제약을 기록하고, 같은 VSIX와 기록을 GitHub Release에 첨부한다. 사후 기록을 위해 이미 게시된 태그를 옮기거나 같은 버전을 재포장하지 않는다.

기존 3.1.0에서 업데이트한 사용자의 DB·SSH 비밀값 이전도 확인한다. 수정 배포는 더 높은 patch 버전으로 진행한다. 버전 태그·커밋·CI artifact를 릴리스 이력에 남긴다.

시험 배포가 필요하면 별도 숫자 버전과 `--pre-release` 채널을 사용한다. Marketplace는 `3.2.0-beta.1` 같은 버전 접미사를 지원하지 않는다. 현재 workflow는 정식 릴리스용이며 pre-release는 별도 분기를 구현한 뒤 사용한다.

## 5. 수동 VSIX 배포

필요하면 같은 검증을 통과한 VSIX를 publisher 관리 화면에서 기존 DBunny 항목에 업로드한다. 로컬 설치 확인 명령은 다음과 같다.

```powershell
code --install-extension .\dbunny.vsix
```

이 명령은 사용자의 확장 설치 상태를 변경하므로, 개발 중에는 `npm run test:package`의 격리 검증을 우선 사용한다.

## 6. 배포 파일 정책

- DB 드라이버·SSH·sql.js는 외부 런타임 의존성이므로 `node_modules` 전체를 제외하지 않는다.
- 번들에 포함되는 SheetJS·PapaParse·SQL formatter의 중복 원본은 제외한다.
- 번역 JSON과 SQLite WASM을 유지한다.
- 테스트 DB, Docker 초기화 자료, 스크립트, 개발용 source map과 중복 이미지는 제외한다.

`npm run publish-extension`은 GitHub의 버전 태그와 `dbunny.vsix`가 있어야 실행되며 OIDC 인증을 요구한다. 로컬에서 인증을 우회해 게시하는 용도로 사용하지 않는다. 로컬 VSIX 파일 전달과 Marketplace 수동 업로드는 서로 다른 작업이다.
