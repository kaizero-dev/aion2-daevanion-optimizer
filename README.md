# AION2 데바니온 최적화

React + TypeScript + Vite 기반 프론트엔드입니다.

## 개발

Node.js 22 이상에서 `npm install` 후 `npm run dev`로 실행합니다.
`npm run build`는 타입 검사 후 `dist/`에 정적 사이트를 생성합니다.

## Cloudflare Pages

- 프로덕션 브랜치: `main`
- 빌드 명령: `npm run build`
- 출력 디렉터리: `dist`
- Node.js 버전: 22 (`.node-version`)

JSON과 이미지는 Vite 빌드에 포함됩니다. 별도 데이터 서버가 필요하지 않습니다.
현재 직업·포인트 입력, 필수 노드 선택, 우선순위 정렬과 보드 열람을 지원하며 계산 버튼은 동작하지 않습니다.

