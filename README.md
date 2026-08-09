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

## Phase 5 체감 기록 ★클라이맥스

이 커밋의 diff 자체가 교재다: `gqlFetch.ts`(P2의 수제 Map 캐시)가 통째로 사라지고
`apollo.ts`(`InMemoryCache`)가 그 자리를 대체한다. **P2 vs P5 비교**가 이 Phase의 핵심:

| | P2 (`gqlFetch.ts`) | P5 (`apolloClient`) |
|---|---|---|
| 캐시 단위 | 쿼리 문자열 + variables (Map key) | 정규화된 엔티티 (`User:1`, `Post:3` …) |
| mutation 후 갱신 | 사람이 `invalidateAll()`을 직접 호출해야 함 | mutation 응답에 `id`가 있으면 해당 엔티티가 자동 갱신 |
| 화면이 늘어날 때 | "이 mutation이 어떤 쿼리를 무효화하는지" 매핑표를 손으로 관리 | 엔티티를 참조하는 모든 활성 쿼리가 자동으로 다시 그려짐 |
| 실패 모드 | 빠뜨리면 컴파일 에러 없이 조용히 stale | `author { id name }`처럼 `id`를 빠뜨리면 정규화 자체가 안 돼 P2와 동일한 stale 재발 |

### 임포트 분리 실측 (편차 없음)

브리프의 임포트 분리 — `ApolloClient`/`InMemoryCache`/`HttpLink`/`gql`는 `@apollo/client`,
`ApolloProvider`/`useQuery`/`useMutation`은 `@apollo/client/react` — 를 설치된
`@apollo/client@4.2.10`의 d.ts로 직접 확인했다: `core/index.d.ts`가 앞의 4개를, `react/index.d.ts`가
뒤의 3개를 정확히 그 분리로 export한다. **편차 없음.**

### 편차: `useQuery`/`useMutation` 기본 `TData = unknown`

브리프 코드를 그대로(`useQuery(FEED)` 무인자) 넣으면 `tsc`가 `data`를 `unknown`(옵셔널 체이닝을
쓴 자리는 `{}`)으로 잡아 프로퍼티 접근이 전부 컴파일 에러가 난다. Apollo Client 4의
`useQuery<TData = unknown, ...>` 시그니처가 원인 — plain `gql`은 `DocumentNode`일 뿐이라
`TypedDocumentNode` 없이는 `data`의 모양을 추론할 수 없다. codegen은 이번 학습 범위 밖(YAGNI)이라
화면마다 최소한의 인라인 타입 별칭(`FeedData`/`MeData`/`UpdateData`/`PostData`)을 만들어
`useQuery<T>(...)`/`useMutation<T, V>(...)` 제네릭으로 넘기는 것으로 근본 해결했다(CLAUDE.md 원칙대로
`as` 단언이 아니라 제네릭으로). `loading` 가드 이후에도 `data`는 `T | undefined`로 남아(별개
프로퍼티라 control-flow narrowing이 안 됨) 브리프가 예고한 그대로 `data!`(Feed) 또는 기존에 이미
있던 `data?.`(Profile/PostDetail)로 처리했다.

### 헤드리스 실측 (1)(2) — 서버 상태 변화

브라우저를 조작하지 않고, Vite 프록시(`http://localhost:5173/graphql`) 너머로 curl 직결:

```
$ curl -s :5173/graphql -d '{"query":"query Feed { feed { id body author { id name } } }"}'
{"data":{"feed":[{"id":1,...,"author":{"id":1,"name":"Ava"}}, ...]}}   # (1) Ava 확인

$ curl -s :5173/graphql -d '{"query":"query Me { me { id name } }"}'
{"data":{"me":{"id":1,"name":"Ava"}}}                                   # mutation 전

$ curl -s :5173/graphql -d '{"query":"mutation Update($name:String!){ updateMyName(name:$name){ id name } }","variables":{"name":"Ava2"}}'
{"data":{"updateMyName":{"id":1,"name":"Ava2"}}}                        # (2) mutation 성공

$ curl -s :5173/graphql -d '{"query":"query Me { me { id name } }"}'
{"data":{"me":{"id":1,"name":"Ava2"}}}                                  # 서버 상태 실제로 바뀜
```

**주의**: 이 curl 왕복은 Apollo Client를 전혀 거치지 않은 raw HTTP다 — "서버가 mutation을 실제로
반영했다"만 증명하고, 이 Phase의 진짜 주장("React가 refetch 없이 자동 재렌더된다")은 전혀 증명하지
않는다. 그건 브라우저의 React 트리 + Apollo 캐시가 있어야만 관찰 가능한 사실이라 아래 (3)은 수동
절차로만 남긴다.

### 편차: `pnpm seed` 재실행이 "시드 상태"를 복원하지 않음 (SQLite AUTOINCREMENT)

mutation 헤드리스 실측 후 DB를 복원하려고 `pnpm seed`를 재실행했더니 `me` 쿼리가 `null`로
돌아왔다 — `Ava` 계정 자체가 사라진 것처럼 보였다. 원인을 실측으로 확인: `seed.ts`는 매번
`deleteMany` 후 재생성하지만, `schema.prisma`의 `id Int @id @default(autoincrement())`가 SQLite에서
`INTEGER PRIMARY KEY AUTOINCREMENT`로 매핑돼 `sqlite_sequence` 테이블에 지금까지의 최대 id를
누적 기록한다. `DELETE`는 이 카운터를 리셋하지 않으므로 재시드할 때마다 id가 계속 밀린다(실측:
이번 재시드로 `User` 1-3 → 4-6, `Post` 1-30 → 31-60, `Comment` 1-120 → 121-240으로 이동,
`sqlite3 prisma/dev.db "SELECT * FROM sqlite_sequence;"`로 확인).

`ctx.userId` 기본값(`context.ts`, 헤더 없으면 `1`)과 `dataloader.test.ts`의 `post(id: 1)`이 둘 다
"id 1이 존재한다"를 암묵 전제로 깔고 있어서, 이 드리프트가 쌓이면 (a) `me`가 `null`이 되어 P5가
요구하는 재현 자체가 불가능해지고 (b) `dataloader.test.ts`는 존재하지 않는 `post(id:1)`에 대해
`post: null`을 받고도 top-level 에러 없이 `queryCount<=3`을 통과해버리는 **잠식적 vacuous pass**가
된다(실측: id 1이 없는 상태에서도 `pnpm test`는 여전히 "2 passed" — 눈에 안 띄는 회귀). P2 README가
재시드 대신 "mutation으로 이름을 도로 `Ava`로 저장"하는 방식을 택했던 이유가 바로 이것이었다고
추정된다(당시엔 이유가 문서화되지 않았으나, 이번에 근본 원인을 확인했다).

복원은 `sqlite_sequence` 카운터를 먼저 리셋한 뒤 재시드하는 것으로 처리했다:

```bash
sqlite3 prisma/dev.db "DELETE FROM sqlite_sequence WHERE name IN ('User','Post','Comment','Like');"
pnpm --filter server seed
```

재확인: `User` 1=Ava/2=Ben/3=Cho, `Post` 1-30, `Comment` 1-120로 완전히 원래 시드 상태 복원,
`me` 쿼리 `{"id":1,"name":"Ava"}`, `pnpm test` 2 passed(원래 2 test files 그대로).

### 수동 재현 절차 (3) — 미실행, 헤드리스 환경 한계

아래는 브라우저에서 David가 직접 확인할 절차다. **에이전트는 브라우저를 조작하지 않았고 이
단계를 실행/관찰하지 않았다** — React 재렌더는 실제 브라우저의 React 트리 없이는 증명할 수 없는
사실이라 절차만 기록해둔다.

1. Apollo Client Devtools 브라우저 확장 설치
2. `pnpm dev:server` + `pnpm dev:web` 후 `http://localhost:5173` 접속
3. 피드 탭 — Ava의 글이 보임
4. 프로필 탭 — 이름을 `Ava2`로 바꾸고 저장 → "저장됨: Ava2" 확인
5. Apollo Devtools "Cache" 탭에서 `User:1` 엔트리를 열어 `name`이 `"Ava2"`로 바뀐 것을 확인
   (스크린샷 — P2 때의 Map 캐시에는 애초에 이런 엔티티 단위 뷰가 없었다는 점과 대비)
6. 피드 탭으로 복귀 — **refetch 코드가 한 줄도 없는데 `Ava2`가 보이는지** 확인 (P2에서는 4단계에서
   여전히 `Ava`였던 것과 정반대 결과여야 한다)
7. 브라우저 Network 탭에서 6번 시점에 `/graphql` feed 요청이 **새로 나가지 않았는지** 확인 —
   나가지 않았다면 네트워크가 아니라 캐시(`User:1` 갱신)만으로 피드가 다시 그려졌다는 뜻
8. 확인 후 복원: `cd server && sqlite3 prisma/dev.db "DELETE FROM sqlite_sequence WHERE name IN ('User','Post','Comment','Like');" && pnpm seed` (위 편차 기록대로 시퀀스 리셋을 먼저 해야
   진짜 시드 상태로 돌아간다 — `pnpm seed`만 다시 돌리면 id가 또 밀린다)

### 질문 1 (React Query와의 차이)

> ✍️ 여기에 내 답을 쓴다:

## Phase 6 체감 기록

이 커밋의 diff 핵심: `schema.ts`의 `feed`가 `t.prismaField(['Post'])`(리스트) → `t.prismaConnection(...)`
(edges/pageInfo)으로, `apollo.ts`의 캐시 정책에 `relayStylePagination()`이 추가되고, `Feed.tsx`가
`fetchMore` + `IntersectionObserver`로 무한스크롤을 구현.

### 왜 offset이 아니라 cursor인가

offset(`skip: 20, take: 10`)은 스크롤 도중 새 글이 위에 삽입되면 다음 페이지 요청의 skip 기준이 밀려
항목이 중복되거나 누락된다. cursor는 "이 항목(id) 다음부터"를 의미해 삽입/삭제에 영향받지 않는다.
Pothos `cursor: 'id'`는 이 id를 base64로 인코딩한 opaque 커서로 노출한다(아래 실측 참조).

### RED → GREEN (`feed.test.ts`)

TDD로 테스트를 먼저 커넥션 형태로 갱신하고(서버는 아직 리스트 반환) 실행 — RED:
```
Unknown argument "first" on field "Query.feed".
Cannot query field "edges" on type "Post".
Cannot query field "pageInfo" on type "Post".

 Test Files  1 failed | 1 passed (2)
      Tests  1 failed | 1 passed (2)
```
`builder.ts`에 RelayPlugin 추가 + `schema.ts`의 `feed`를 `t.prismaConnection`으로 교체 후 재실행 — GREEN:
```
 Test Files  2 passed (2)
      Tests  2 passed (2)
```

### 편차 확인: RelayPlugin 옵션 shape (편차 없음)

브리프의 `relay: {}`를 그대로 신뢰하지 않고 설치된 `@pothos/plugin-relay@4.7.1`의 d.ts
(`dts/global-types.d.ts`, `dts/types.d.ts`)를 확인했다. `RelayPluginOptions<Types>`에는
`nodeTypeOptions`/`pageInfoTypeOptions`/`nodeQueryOptions` 등 얼핏 필수처럼 보이는 필드가 여럿
있지만, 전체가 `@pothos/core`의 `EmptyToOptional<T>` 유틸리티 타입으로 감싸여 있다 — 이 필드들의
타입이 전부 `Omit<...선택적 프로퍼티...>` 형태라 구조적으로 `{}`와 호환되고, `EmptyToOptional`이
그런 키를 전부 옵셔널로 접는다. 그 결과 `relay: {}`가 타입상 유효하다 — `tsc --noEmit` 통과로 확인.
**편차 없음.**

`t.prismaConnection`도 `@pothos/plugin-prisma`의 `global-types.d.ts`에서
`'relay' extends PluginName ? ... : never`라는 조건부 타입으로 선언돼 있다 — `plugins:
[PrismaPlugin, RelayPlugin]`에 RelayPlugin이 없으면 이 필드 자체가 타입에서 사라진다.

### armor maxDepth 재검증 (편차 없음 — 여전히 n:6 아래)

P4에서 넣은 `EnvelopArmorPlugin({ maxDepth: { n: 6 } })`이 이번에 깊어진 쿼리
(`feed → edges → node → author → name`)를 막는지 재검증했다. armor의 depth 카운팅 규칙
(OperationDefinition=depth 0, `selectionSet` 진입마다 +1, P4 README에 기록)으로 손계산하면:

```
{ feed(first:10, after:$after) {                     ← 진입1(연산) → 진입2(feed)
  edges { node { id body author { name } } }         ← 진입3(edges) → 진입4(node) → 진입5(author)
  pageInfo { hasNextPage endCursor }
} }
```
최대 depth 5, `n: 6` 아래라 영향 없음 — 아래 curl 실측도 200 + 정상 `data`로 확인. **n 상향 조정 불필요.**

### 헤드리스 페이지네이션 실측 (실제 커서 값)

서버(`pnpm --filter server dev`, 4000) + 웹(`pnpm --filter web dev`, 5173, Vite 프록시
`/graphql`→4000) 기동 후 curl로 직결 — DB는 시드 상태 그대로(Post 30개, id 1~30, `createdAt`이
id가 클수록 과거라 `ORDER BY createdAt DESC`가 id 오름차순과 일치):

**1페이지** (`first: 10`, `after` 없음):
```
edges: id 1~10 (author Ava/Ben/Cho 순환)
pageInfo: { hasNextPage: true, endCursor: "R1BDOk46MTA=" }
```
`R1BDOk46MTA=`를 base64 디코드하면 `GPC:N:10` — Pothos가 cursor 필드(`id`) 값을 이런 형태로
인코딩해 opaque하게 감춘다(클라이언트는 값을 파싱하지 않고 그대로 다음 요청의 `after`에 넣기만 하면 됨).

**2페이지** (`after: "R1BDOk46MTA="`, 1페이지의 endCursor 그대로):
```
edges: id 11~20 (1페이지와 겹침 없음)
pageInfo: { hasNextPage: true, endCursor: "R1BDOk46MjA=" }
```

**3페이지** (`after: "R1BDOk46MjA="`):
```
edges: id 21~30 (마지막 페이지, 1·2페이지와 겹침 없음)
pageInfo: { hasNextPage: false, endCursor: "R1BDOk46MzA=" }
```

30개 시드 데이터를 정확히 3페이지(10+10+10)로 소진하고 `hasNextPage: false`로 끝나는 것을 실측으로
확인 — 브리프의 "30개까지 이어붙음"과 일치. 세 페이지 사이 id 겹침이 전혀 없어 cursor 기반 페이지네이션이
의도대로 동작함을 확인했다(curl은 raw HTTP라 Apollo 캐시를 거치지 않는다 — "서버가 cursor 규약을
정확히 따른다"만 증명하고, "클라 merge가 자동으로 이어붙는다"는 클라이언트 사실이라 아래 수동
절차로 별도 확인).

### 편차 확인: `relayStylePagination` import 경로 (편차 없음)

설치된 `@apollo/client@4.2.10`의 `utilities/index.d.ts`에 `export { concatPagination,
offsetLimitPagination, relayStylePagination } from './policies/pagination.js'`로 명시돼 있어
브리프의 `@apollo/client/utilities` 경로가 정확했다. **편차 없음.**

### `Feed.tsx`: 기존 에러 가드와 병합

브리프 원문 코드는 `loading`/`error` 가드가 없었지만, 이 파일은 이미 리뷰 피드백으로 `error` 분기
(옵셔널 체이닝 대신 명시적 가드)가 들어가 있던 상태였다. 두 요구를 합쳐 `const { data, loading,
error, fetchMore } = useQuery(...)`로 구조분해하고, `if (loading && !data) → if (error) → 정상 렌더`
순서를 유지했다. `loading && !data` 가드는 브리프 그대로 — Apollo 기본값(`notifyOnNetworkStatusChange:
false`)에서는 `fetchMore` 중에 `loading`이 다시 true가 되지 않지만, 이 가드가 혹시 모를 재조회
시나리오에서 이미 그려진 목록이 "loading…"으로 깜빡이는 걸 막는 방어선이 된다.

### 수동 재현 절차 — 브라우저 무한스크롤 (미실행, 헤드리스 환경 한계)

에이전트는 브라우저를 조작하지 않았다 — IntersectionObserver 트리거와 실제 스크롤 UX는 브라우저
없이는 관찰 불가능하다. David가 직접 확인할 절차:

1. `pnpm dev:server` + `pnpm dev:web` 후 `http://localhost:5173` 접속, 피드 탭
2. 개발자도구 Network 탭 필터를 `graphql`로 걸어둔다
3. 목록을 아래로 스크롤 — sentinel(`<div ref={sentinel}>`)이 뷰포트에 들어올 때마다 Network 탭에
   `after` 변수가 실린 POST 요청이 순차로 나가는지 확인 (1회차는 `after` 없음, 2회차부터 직전
   응답의 `endCursor`가 그대로 실림 — 위 헤드리스 실측 값과 동일한 패턴)
4. 목록이 30개(post #0~#29)까지 이어붙는지, 30개에 도달한 후 더 스크롤해도 추가 요청이 나가지
   않는지(`pageInfo.hasNextPage: false`가 되어 `useEffect`가 observer를 다시 안 다는 상태) 확인
5. Apollo Client Devtools "Cache" 탭에서 `ROOT_QUERY.feed` 엔트리를 열어 `edges` 배열이 fetchMore
   이후에도 하나로 이어붙어 있는지(손으로 짠 merge 코드 없이) 확인

## Phase 7 체감 기록

이 커밋의 diff 핵심: `Post`에 `likeCount`(`t.relationCount('likes')`)/`likedByMe`(P3와 같은
DataLoader 패턴 재사용, `context.ts`의 `myLikes`) 필드 추가, `toggleLike` mutation 신설,
`Feed.tsx`에 하트 버튼 + `optimisticResponse` 추가. `myLikes` 로더가 `currentUserId`를 알아야 해서
`createLoaders()` → `createLoaders(currentUserId: number)`로 시그니처가 바뀌고, `createContext`가
헤더에서 뽑은 `userId`를 그대로 넘겨준다.

### 헤드리스 실측 (1) — 성공 경로

서버(`pnpm --filter server dev`, 4000) 기동 후 curl 직결. 시드 상태: `Like` 15행, 전부
`userId=2`(Ben)가 홀수 id 포스트(i%2==0 → id=i+1)에 좋아요. 기본 `x-user-id`는 헤더가 없으면 1
(Ava) — post 1은 Ben이 이미 좋아요를 눌러둔 상태라 Ava 기준 `likedByMe: false`, `likeCount: 1`에서
시작:

```
$ curl -s :4000/graphql -d '{"query":"{ post(id: 1) { id likeCount likedByMe } }"}'
{"data":{"post":{"id":1,"likeCount":1,"likedByMe":false}}}

$ curl -s :4000/graphql -d '{"query":"mutation($postId:Int!){ toggleLike(postId:$postId){ id likeCount likedByMe } }","variables":{"postId":1}}'
{"data":{"toggleLike":{"id":1,"likeCount":2,"likedByMe":true}}}   # Ava가 좋아요 추가

$ sqlite3 dev.db "SELECT userId, postId FROM Like WHERE postId=1;"
2|1
1|1                                                                # Ben(기존) + Ava(신규) 두 행

$ curl -s :4000/graphql -d '{"query":"mutation($postId:Int!){ toggleLike(postId:$postId){ id likeCount likedByMe } }","variables":{"postId":1}}'
{"data":{"toggleLike":{"id":1,"likeCount":1,"likedByMe":false}}}  # 다시 토글 → 원상복구

$ sqlite3 dev.db "SELECT userId, postId FROM Like WHERE postId=1;"
2|1                                                                # Ben 행만 남음

$ sqlite3 dev.db "SELECT count(*) FROM Like;"
15                                                                 # 시드 상태와 정확히 일치
```

`likeCount`/`likedByMe`의 flip과 `Like` 테이블의 행 생성/삭제가 정확히 대응하고, 두 번째 토글로
Ava의 좋아요 행이 사라져 DB가 시드 상태(15행, 전부 Ben)로 완전히 복원됨을 실측으로 확인했다.

### 헤드리스 실측 (2) — 실패 경로 + 자동 롤백

서버를 껐다가 `FAIL_LIKES=1 pnpm dev`로 재기동(`toggleLike` 리졸버가 DB를 건드리기 전에 무조건
throw):

```
$ curl -s :4000/graphql -d '{"query":"{ post(id: 1) { id likeCount likedByMe } }"}'
{"data":{"post":{"id":1,"likeCount":1,"likedByMe":false}}}

$ curl -s :4000/graphql -d '{"query":"mutation($postId:Int!){ toggleLike(postId:$postId){ id likeCount likedByMe } }","variables":{"postId":1}}'
{"errors":[{"message":"Unexpected error.","path":["toggleLike"],"extensions":{"code":"INTERNAL_SERVER_ERROR"}}],"data":{"toggleLike":null}}

$ sqlite3 dev.db "SELECT userId, postId FROM Like WHERE postId=1;"
2|1                                                                # 변화 없음

$ sqlite3 dev.db "SELECT count(*) FROM Like;"
15                                                                 # 변화 없음
```

**계획에 없던 실측 편차**: 브리프의 `throw new Error('like intentionally failed')` 메시지가
응답에 그대로 안 나온다 — graphql-yoga가 기본으로 `maskedErrors: true`라 서버 내부 에러 메시지를
`"Unexpected error."`로 가리고 `extensions.code: INTERNAL_SERVER_ERROR`만 노출한다(P4에서 본
"검증 에러는 HTTP 200 + errors 배열"과 같은 결의 스펙 준수 — 다만 이번엔 데이터 노출 방지가
이유). 이 실험 목적(에러 발생 시 DB 미변경 + 클라 롤백)에는 메시지 내용이 필요 없어 영향 없음.

이 두 실측 모두 curl(raw HTTP)로 확인한 것은 "서버가 성공/실패 양쪽에서 DB를 정확히 그 경우에
맞게 (안) 바꾼다"는 사실이다. optimistic UI 자체(즉시 하트 → 실패 시 자동 롤백)는 Apollo Client의
캐시 레이어가 브라우저에서 하는 일이라 curl로는 관찰 불가 — 아래 수동 절차로 남긴다.

### mutation 후 갱신 전략 3가지 — 이 레포에서 각각 어디서 겪었나

| 전략 | 이 레포에서 겪은 곳 | 방식 |
|---|---|---|
| refetch류 (전체/일부 재조회) | P2 `Profile.tsx`의 `invalidateAll()` | mutation 후 캐시를 통째로 비워 다음 조회가 강제로 network을 타게 함 — "이 mutation이 어떤 쿼리를 stale하게 만드는지"를 사람이 알아야 하고, 안 지워도 될 캐시까지 날린다 |
| 캐시 수정 (수동 merge 정책) | P6 `apollo.ts`의 `relayStylePagination()` | `fetchMore`로 받은 다음 페이지를 기존 `edges` 뒤에 이어붙이는 규칙을 캐시 타입폴리시로 등록 — "새 데이터를 기존 캐시에 어떻게 합칠지"를 명시적으로 정의(직접 짜지는 않았지만 정책은 존재) |
| 정규화 자동 갱신 | P5 `Profile.tsx`의 `updateMyName`, P7 `Feed.tsx`의 `toggleLike` | mutation 응답에 `id`(+바뀐 필드)만 있으면 `InMemoryCache`가 `Post:{id}`/`User:{id}` 엔티티를 정규화 키로 자동 갱신 — 그 엔티티를 참조하는 모든 활성 쿼리가 refetch/merge 코드 한 줄 없이 다시 그려짐. P7의 `toggleLike { id likeCount likedByMe }`가 이 최소 응답 패턴 |

P7은 여기에 `optimisticResponse`를 얹은 것 — 정규화 자동 갱신이 "서버 응답 도착 후"에 일어나는
갱신이라면, `optimisticResponse`는 그 갱신을 **낙관적으로 먼저** 캐시에 써서 체감 지연을 0으로
만들고, 서버가 실제로 에러를 던지면 Apollo가 이 임시 레이어만 골라서 걷어내(진짜 서버 데이터는
건드린 적이 없으므로) 자동 롤백한다.

### 수동 재현 절차 — 낙관적 반응 + 자동 롤백 (미실행, 헤드리스 환경 한계)

에이전트는 브라우저를 조작하지 않았다 — "클릭 즉시 하트가 뒤집히는 체감"과 "에러 응답 도착 시
원상복구되는 체감"은 실제 브라우저의 React 재렌더 없이는 관찰 불가능하다. David가 직접 확인할
절차:

1. **정상 경로**: `pnpm dev:server`(4000) + `pnpm dev:web`(5173) 기동, `http://localhost:5173`
   접속 → 피드 탭에서 아무 포스트의 하트 버튼 클릭 → 네트워크 응답이 오기 전부터(개발자도구
   Network 탭에서 `/graphql` pending 상태 확인) 하트/카운트가 이미 뒤집혀 있는지 확인 → 응답
   도착 후에도 그대로 유지되는지 확인
2. **실패 경로 (자동 롤백)**: 서버를 끄고 `cd server && FAIL_LIKES=1 pnpm dev`로 재기동 → 같은
   하트 버튼 클릭 → **클릭 즉시 하트가 뒤집혔다가**, 서버 에러 응답이 도착하는 순간(Network 탭에
   해당 요청이 빨간색으로 실패 표시) **자동으로 원래 상태로 되돌아오는지** 확인 — `Feed.tsx`에
   `onError`나 `catch` 코드를 한 줄도 안 썼는데 롤백되는 것이 P7의 핵심 체감이다. 화면
   녹화(선택) 또는 눈으로 왕복 확인 후 `FAIL_LIKES` 없이 서버 재기동
3. 확인 후 DB는 헤드리스 실측 단계에서 이미 시드 상태(15행, 전부 Ben)로 복원해뒀다 — 수동 절차
   중 실수로 좋아요를 눌러 상태가 바뀌었다면 같은 버튼을 한 번 더 눌러 원상복구할 것
