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

## Phase 2 체감 기록

`gqlFetch.ts`의 수제 Map 캐시는 쿼리 문자열+변수를 key로 응답을 저장한다. mutation을 실행해도
캐시는 그 사실을 모르니, 같은 key로 다시 물어보면(피드 재조회) 여전히 옛 응답을 돌려준다 —
"성능을 위해" 넣은 캐시가 정합성을 깨는 전형적인 함정.

### 재현 절차 (수동)

브라우저로 직접 확인할 때의 절차 (`pnpm dev:server` + `pnpm dev:web`, `http://localhost:5173`):

1. 피드 탭 — Ava의 글이 보임
2. 프로필 탭 — 이름을 `Ava2`로 바꾸고 저장 → "저장됨: Ava2" 확인 (mutation 성공)
3. 피드 탭으로 복귀 — **여전히 `Ava`** (stale). `gqlFetch`의 Map 캐시가 `{ feed ... }` 쿼리를 이미
   들고 있어서 network을 안 타고 옛 응답을 그대로 반환하기 때문
4. `Profile.tsx`의 `// invalidateAll();` 주석을 해제 → 같은 절차 반복 → 이번엔 피드에 `Ava2`가 보임
   (mutation 후 캐시 전체를 비웠으니 feed 쿼리가 다시 network을 탐)
5. 한 걸음 더: `Profile.tsx`에서 `updateMyName` mutation을 같은 이름으로 두 번 연속 호출해보면
   두 번째 호출도 캐시 히트로 처리된다 — mutation조차 캐시 key 안에 들어가 있기 때문(“mutation도
   캐시되는 버그”, 코드 주석 참조)

### 헤드리스 실측 (실제 실행 로그)

브라우저 조작 대신, 실제 커밋되는 `web/src/gqlFetch.ts`를 수정 없이 그대로 import해서 Vite
프록시(`http://localhost:5173/graphql`) 너머로 실행하고 `fetch` 호출 횟수를 계측했다
(`global fetch`만 감싸서 상대경로 `/graphql`을 절대경로로 바꿔줬을 뿐, gqlFetch.ts 자체는 무수정):

```
1) 최초 feed 조회            → networkCallCount 0→1  (author=Ava)
2) 같은 feed 재조회           → networkCallCount 그대로 (캐시 히트, author=Ava)
3) updateMyName(Ava→Ava2)     → networkCallCount +1    (서버 응답 name=Ava2)
4) mutation 후 feed 재조회    → networkCallCount 그대로 (캐시 히트, author=Ava ← STALE)
5) 같은 mutation 재호출       → networkCallCount 그대로 (캐시 히트 — "mutation도 캐시되는 버그" 재현)
6) invalidateAll() 후 feed    → networkCallCount +1    (author=Ava2 ← 이제야 fresh)
```

network 호출 횟수(계측값)와 응답 바디로 확인한 사실:
- 4번에서 서버는 이미 `Ava2`를 반환할 상태인데도(`curl`로 직접 확인함) 캐시 히트라 network을 안 타서
  응답 바디는 `Ava` 그대로 — stale이 재현됨
- 5번에서 동일 인자의 mutation 재호출이 network을 타지 않음 — mutation이 `key = query + JSON.stringify(variables)`
  로 캐시되는 두 번째 함정을 계측으로 확인
- 6번 `invalidateAll()` 이후에만 feed가 다시 network을 타고 `Ava2`를 관측

실측 후 서버 DB는 `updateMyName(name: "Ava")`로 시드 상태(Ava)로 복원해뒀다.

### 화면이 늘면 부서진다

지금은 화면이 3개(Feed/PostDetail/Profile)뿐이라 "mutation 후 invalidateAll() 한 줄"로 버틸 수
있다. 하지만 이 방식은 "이 mutation이 어떤 쿼리들을 stale하게 만드는지"를 사람이 전부 기억하고
있어야 한다는 뜻이다. 화면이 10개, mutation이 여러 종류가 되면:
- 어떤 쿼리를 지워야 하는지 매핑표를 손으로 관리해야 하고
- 빠뜨리면 컴파일 에러 없이 조용히 stale이 남고(지금 겪은 것과 동일한 증상)
- `invalidateAll()`처럼 전체를 날리는 방식은 안 지워도 될 캐시까지 날려 다시 로딩 스피너가 뜬다(성능 이점 상실)

이게 P5에서 Apollo `InMemoryCache`(정규화 캐시, 엔티티 단위 자동 무효화)로 갈아타는 이유다.
