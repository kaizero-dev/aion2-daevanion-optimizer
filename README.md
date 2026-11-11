# AION2 데바니온 최적화

React + TypeScript + Vite 기반 프론트엔드입니다.

## 개발

Node.js 22 이상에서 `npm install` 후 `npm run dev`로 실행합니다.
`npm run build`는 타입 검사 후 `dist/`에 정적 사이트를 생성합니다.
`npm test`는 Node 22.16 이상에서 그래프·완전탐색 대조·실제 데이터·요청 취소·설정 저장·실패 피드백을 검증합니다.

## Cloudflare Pages

- 프로덕션 브랜치: `main`
- 빌드 명령: `npm run build`
- 출력 디렉터리: `dist`
- Node.js 버전: 22 (`.node-version`)

JSON과 이미지는 Vite 빌드에 포함됩니다. 별도 데이터 서버가 필요하지 않습니다.
직업·포인트 입력, 필수 노드 선택, 우선순위 정렬과 보드 열람을 지원합니다. 최적화는 Web Worker 안에서 외부 솔버 의존성 없이 정확한 동적 계획법으로 실행하며, 계산 중 중단할 수 있습니다. 사용자 설정은 새로고침 후에도 유지합니다.

저장된 설정이 없으면 837포인트와 유일·전승·희귀 전부 필수로 시작합니다. 유효한 저장 설정이 있으면 그대로 복원합니다. 원본 `data`·`assets`는 유지하며 앱 내부 등급만 한글로 변환합니다.

현재 전략은 상위 순위의 최대 개수를 유지하면서 6개 순위를 모두 사전식으로 최대화하고 마지막에 비용을 최소화합니다. 기존 전략은 `strategy-before-lexicographic` 태그(커밋 `7cf647d`)로 보존합니다. 롤백은 전략 전환과 후속 성능 개선 커밋의 영향을 확인해 역순으로 revert한 뒤 `main`에 푸시하는 방식이며 상세 지침은 `STRATEGY_SPEC.md`에 있습니다.

`npm run build` 후 `node tests/workerBuildProbe.mjs`로 빌드 Worker의 실제 스레드 실행·종료를 확인할 수 있습니다. `node --experimental-strip-types tests/realDataProbe.ts`는 9개 직업의 실제 데이터 조합을 검증합니다. 실제 브라우저의 모달·포커스·결과 표시는 사용자가 확인합니다. 진행 상황과 성능·검증 범위는 `PROJECT_SPEC.md` 상단, 계산 규칙은 `STRATEGY_SPEC.md`를 확인하세요.

