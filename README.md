# graphql-sns-lab

GraphQL 학습용 미니 SNS. **커밋 히스토리가 교재다** — `git checkout phase-N`으로 각 단계를 볼 것.
학습 계획 원문: 옵시디언 todo-Study/GraphQL. 학습 지도는 이 파일 하단에 (Task 9에서 완성).

문제를 일부러 겪고 → 도구로 해결하는 순서:
raw fetch 캐시 지옥(P2) → N+1(P3) → 쿼리 폭탄(P4) → Apollo 정규화 캐시(P5) → Connection 페이지네이션(P6) → optimistic update(P7)

## Phase 1 체감 기록

`cd server && pnpm dev` 후 `http://localhost:4000/graphql`에서 GraphiQL 확인 — 스키마 문서 탭에
`schema.ts`의 code-first 정의(`feed` / `post` / `me`, `Post`/`User`/`Comment` 타입)가 그대로 떠서
"코드가 곧 문서"라는 감각을 확인했다.

"클라이언트가 응답 모양을 결정한다"는 핵심 감각은 같은 서버에 필드 조합을 바꿔가며 curl로 실측:
- `{ feed { id body } }` → 응답에 `author` 없음
- `{ feed { id body author { name avatarUrl } comments { body author { name } } } } }` → 요청한 만큼만 중첩되어 돌아옴 (author의 posts/likes는 안 물어서 안 옴)

같은 쿼리를 GraphiQL 자동완성으로 필드를 넣었다 뺐다 하며 눈으로 보는 것도 동일한 원리 — 이번엔
헤드리스 에이전트 환경이라 브라우저 조작 대신 curl로 같은 사실을 확인했다.
