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

## Phase 3 실측

측정 쿼리 (`server/src/context.ts`의 `prisma.$on('query', ...)`로 SQL 카운트를 콘솔에 `[SQL n]`으로 찍음):
```bash
curl -s localhost:4000/graphql -H 'content-type: application/json' \
  -d '{"query":"query{ post(id: 1){ comments { body author { name } } } }"}'
```
post id 1은 시드 데이터상 댓글 3개(작성자 Ava/Ben/Cho, 전부 다른 유저).

### 실측값

| 단계 | SQL 개수 | 로그 |
|---|---|---|
| Before (N+1 재현) | **5** | `[SQL 1]` Post, `[SQL 2]` Comment, `[SQL 3~5]` User × 3 (댓글당 1회) |
| After (DataLoader 적용) | **3** | `[SQL 1]` Post, `[SQL 2]` Comment, `[SQL 3]` User(`WHERE id IN (...)` 1회로 배칭) |

두 번 모두 서버를 껐다 켜서(카운터 리셋) 같은 curl 1회로 잰 값 — 재실행해도 동일하게 재현된다.

### 두 겹이었던 "숨은 배칭" (계획에 없던 실측 편차)

브리프의 Step 1은 "`Comment.author`를 `t.relation('author')` 그대로 두면 Pothos-Prisma가 이미 JOIN/IN으로
합칠 수 있으니, N+1이 안 보이면 naive resolver(`findUniqueOrThrow`)로 바꿔 재현하라"고 했다. 실측해보니
실제로는 **두 겹**이었다:

1. **`t.relation('author')` 그대로**: 3 SQL (N+1 없음) — Pothos-Prisma 플러그인이 부모 `post` 리졸버의
   `query` 인자를 타고 내려가 `comments.author`까지 하나의 `include` 트리로 묶어 배칭.
2. **브리프 그대로 `findUniqueOrThrow`로 naive resolver 교체**: 여전히 3 SQL (N+1 재현 실패!) —
   Prisma Client 자체가 같은 tick 안의 `findUnique`/`findUniqueOrThrow` 호출들을 자동으로
   `WHERE id IN (...)` 1방에 배칭하는 내장 dataloader를 갖고 있다(공식 문서
   [Query optimization — Solving the n+1 problem](https://www.prisma.io/docs/orm/prisma-client/queries/query-optimization-performance)에
   명시, `findUnique` 계열 한정). WebSearch로 이 문서를 확인하고, 직접 `findUniqueOrThrow` vs
   `findFirst`로 바꿔가며 SQL 개수를 실측해 대조했다.
3. **`findFirst`로 교체(이 최적화 대상 아님)**: 비로소 5 SQL — 진짜 N+1 재현.

즉 브리프의 naive resolver 예시(`findUniqueOrThrow`)만으로는 이 Prisma 버전(7.9.1)에서 N+1이 재현되지
않는다 — Pothos 레이어와 Prisma Client 레이어가 각각 배칭을 하고 있어서다. `server/src/schema.ts`의
`Comment.author` 필드 주석(LEARN 편차 1/2)에 이 경위를 남겨뒀다.

### RED → GREEN

`server/test/dataloader.test.ts` ("SQL 3회 이하로 끝난다") 최초 실행 (구현 전, `findFirst` naive resolver
상태):
```
FAIL  test/dataloader.test.ts > DataLoader batching > post 1개의 comments{author}가 SQL 3회 이하로 끝난다 (post + comments + batched users)
AssertionError: expected 5 to be less than or equal to 3
 ❯ test/dataloader.test.ts:15:24
```
`context.ts`에 `createLoaders()`(DataLoader) 추가 + `schema.ts`의 `Comment.author`를
`ctx.loaders.user.load(c.authorId)`로 교체 후 재실행:
```
Test Files  2 passed (2)
     Tests  2 passed (2)
```
(`feed.test.ts` + `dataloader.test.ts` 둘 다 통과, 3회 연속 재실행으로 안정성 확인 — 두 테스트 파일이
같은 모듈 레벨 `queryCount`를 import하지만 Vitest가 파일마다 독립된 모듈 그래프로 격리 실행해서
간섭이 없었다. 별도 vitest 설정 변경은 불필요했다.)

DataLoader가 하는 일: 같은 tick 안에서 호출된 `.load(authorId)` 3번(Ava/Ben/Cho)을 모아
`prisma.user.findMany({ where: { id: { in: [...] } } })` 1번으로 합친다 — Prisma Client의
`findUnique` 자동배칭이 놓친 지점(우리는 `findFirst`로 우회해서 그 배칭 밖에 있었다)을 GraphQL
리졸버 레벨에서 우리가 직접 재구현한 것.

## Phase 4 실측

측정 쿼리 (서버 켠 상태로 curl):
```bash
curl -s localhost:4000/graphql -H 'content-type: application/json' \
  -d '{"query":"{ feed { comments { author { posts { comments { author { posts { id } } } } } } } }"}'
```
이 쿼리가 가능하려면 먼저 `schema.ts`의 `userRef`에 `posts: t.relation('posts')`를 추가해야 했다 —
`author.posts`가 없으면 posts→comments→author→posts로 순환할 곳이 아예 없다. 그래프를 한 줄
넓히자마자 공격 표면도 함께 넓어진 셈(`schema.ts`의 LEARN 주석 참조).

### Before armor (실측)

| 항목 | 값 |
|---|---|
| HTTP | 200 |
| 응답 크기 | 377,586 bytes (약 369KB) |
| SQL 카운트 | **11** (`context.ts`의 `[SQL n]` 로그) |

SQL 로그:
```
[SQL 1]  SELECT ... Post ...
[SQL 2]  SELECT ... Comment ...
[SQL 3]  SELECT ... User ...
[SQL 4]  SELECT ... User ...
[SQL 5]  SELECT ... Post ...
[SQL 6]  SELECT ... Comment ...
[SQL 7]  SELECT ... User ...
[SQL 8]  SELECT ... Post ...
[SQL 9]  SELECT ... Comment ...
[SQL 10] SELECT ... User ...
[SQL 11] SELECT ... Post ...
```

**계획에 없던 실측 발견**: 이 쿼리는 depth 8까지 내려가는데도 SQL은 겨우 11개다 — naive N+1처럼
폭증하지 않는다. P3에서 확인한 Pothos-Prisma의 query-arg 배칭이 depth가 깊어져도 레벨마다 계속
동작해서(posts→comments→author→posts→comments→author 패턴이 반복되며 레벨당 쿼리 1~2개로
수렴), SQL 카운트만 보면 "괜찮아 보이는" 착시가 생긴다. 실제 폭탄은 SQL이 아니라 **응답 크기**에서
터진다 — feed의 포스트 20개 × 각 댓글 여러 개 × 각 작성자의 posts 여러 개가 fan-out하며 377KB까지
불어난다. SQL 카운터 하나만 계측 지표로 삼으면 이 케이스를 놓친다는 걸 실측으로 직접 확인했다.

### armor 옵션 shape 검증

브리프의 `EnvelopArmorPlugin({ maxDepth: { n: 6 } })`을 그대로 신뢰하지 않고 설치된 패키지의 d.ts를
따라갔다: `@escape.tech/graphql-armor`의 `index.d.ts` → `envelop/armor.d.ts`(`EnvelopArmorPlugin(config?:
GraphQLArmorConfig)`) → `@escape.tech/graphql-armor-types`의 `GraphQLArmorConfig`(`maxDepth?:
ProtectionConfiguration & MaxDepthOptions`) → `@escape.tech/graphql-armor-max-depth`의 `MaxDepthOptions`
(`{ n?: number; ... }`, 기본값도 `n: 6`). 브리프의 shape이 실제 타입과 정확히 일치 — **옵션 shape
자체는 편차 없음**.

`maxDepth` 카운팅 알고리즘도 소스(`graphql-armor-max-depth`의 `countDepth`)로 직접 확인: 최상위
`OperationDefinition`은 depth 0에서 시작하고, 이후 매 `selectionSet` 진입마다 +1. 이 규칙으로 기존
테스트 쿼리의 depth를 손계산하면 `feed.test.ts`(`{ feed { id body author { name } } }`)는 3,
`dataloader.test.ts`(`{ post(id:1) { comments { body author { name } } } }`)는 4 — 둘 다 `n: 6` 아래라
영향 없을 것으로 예상됐고, `pnpm test` 재실행으로 실측 확인(2 test files, 2 tests 전부 green, n 상향
조정 불필요).

### After armor (실측)

| 항목 | 값 |
|---|---|
| HTTP | 200 (편차 — 아래) |
| 응답 바디 | `{"errors":[{"message":"Syntax Error: Query depth limit of 6 exceeded, found 8."}]}` |
| 응답 크기 | 82 bytes, `data` 키 자체가 없음(`null`도 아님) |

**편차(브리프 주석 vs 실측)**: 브리프 원문 주석은 "maxDepth 하나로 위 폭탄 쿼리가 400으로 죽는다"고
적었지만, 실측 HTTP status는 **200**이다. GraphQL 스펙상 쿼리 검증(validation) 에러는 전송 계층
(HTTP status)의 문제가 아니라 응답 바디의 `errors` 배열로 전달되는 것이 정상 동작이고, graphql-yoga가
이 스펙을 그대로 따른다. `main.ts`의 주석을 이 실측대로 고쳐뒀다 — "400으로 죽는다"가 아니라 "죽되
HTTP는 200, `data` 없이 `errors`만 온다"로.
