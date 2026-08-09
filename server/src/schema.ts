import { builder } from './builder';

// 📚 LEARN(P1): code-first — TS 코드가 곧 스키마. GraphiQL 문서 탭에서 이 정의가
// 그대로 "살아있는 API 문서"로 렌더되는 것을 볼 것.
const userRef = builder.prismaObject('User', {
  fields: (t) => ({
    id: t.exposeInt('id'),
    name: t.exposeString('name'),
    avatarUrl: t.exposeString('avatarUrl'),
    // 📚 LEARN(P4): 그래프를 넓히면 공격 표면도 넓어진다 — 이 한 줄이 생기기 전까진
    // `feed { comments { author { X } } }` 이상으로 내려갈 곳이 없었다. author.posts가
    // 열리는 순간 posts→comments→author→posts→...로 임의 깊이 순환이 가능해진다
    // (아래 P4 폭탄 쿼리가 이 필드 하나에 의존).
    posts: t.relation('posts'),
  }),
});

builder.prismaObject('Comment', {
  fields: (t) => ({
    id: t.exposeInt('id'),
    body: t.exposeString('body'),
    // 📚 LEARN(P3) 편차 1: 원래 여기 있던 t.relation('author')는 N+1이 아니었다 — Pothos-Prisma
    // 플러그인이 부모 prismaField의 query 인자를 타고 내려가 관계를 자동으로 IN 배칭한다(실측:
    // post+comments+users 단 3개 SQL). N+1을 실제로 보려면 GraphQL 필드 리졸버가 그 최적화
    // 경로를 벗어나 "제 발로" DB를 때리는 naive resolver여야 한다.
    //
    // 📚 LEARN(P3) 편차 2: 브리프 그대로 findUniqueOrThrow로 naive resolver를 짜도(재현
    // 과정에서 실측) 여전히 3개 SQL이었다 — Prisma Client 자체가 같은 tick의 findUnique/
    // findUniqueOrThrow 호출들을 `WHERE id IN (...)` 1방으로 자동 배칭하는 내장 dataloader를
    // 갖고 있기 때문(공식 문서: "Solving the n+1 problem" 섹션, findUnique 계열 한정). 그
    // 최적화 대상이 아닌 findFirst로 바꾸고 나서야 진짜 N+1(실측 5 SQL = post 1 + comments 1
    // + user 3)이 드러났다 — Pothos 레이어, Prisma Client 레이어가 각각 배칭을 하고 있었던 것.
    //
    // 아래 ctx.loaders.user.load()가 그 배칭을 GraphQL 리졸버 레벨에서 우리가 직접
    // 재구현한 최종 처방(DataLoader) — context.ts의 createLoaders 참조.
    author: t.field({
      type: userRef,
      resolve: (c, _args, ctx) => ctx.loaders.user.load(c.authorId),
    }),
  }),
});

builder.prismaObject('Post', {
  fields: (t) => ({
    id: t.exposeInt('id'),
    body: t.exposeString('body'),
    createdAt: t.string({ resolve: (p) => p.createdAt.toISOString() }),
    author: t.relation('author'),
    comments: t.relation('comments'),
  }),
});

builder.queryType({
  fields: (t) => ({
    // 📚 LEARN(P6): Relay Connection 스펙 — edges/cursor/pageInfo를 서버가 따르는 이유는
    // offset이 못 푸는 문제(스크롤 중 새 글 삽입 시 중복/누락) 때문. 커서 = "이 항목 다음부터".
    feed: t.prismaConnection({
      type: 'Post',
      cursor: 'id',
      defaultSize: 10,
      resolve: (query, _root, _args, ctx) =>
        ctx.prisma.post.findMany({ ...query, orderBy: { createdAt: 'desc' } }),
    }),
    post: t.prismaField({
      type: 'Post',
      nullable: true,
      args: { id: t.arg.int({ required: true }) },
      resolve: (query, _root, args, ctx) =>
        ctx.prisma.post.findUnique({ ...query, where: { id: args.id } }),
    }),
    me: t.prismaField({
      type: 'User',
      nullable: true,
      resolve: (query, _root, _args, ctx) =>
        ctx.prisma.user.findUnique({ ...query, where: { id: ctx.userId } }),
    }),
  }),
});

builder.mutationType({
  fields: (t) => ({
    updateMyName: t.prismaField({
      type: 'User',
      args: { name: t.arg.string({ required: true }) },
      resolve: (query, _root, args, ctx) =>
        ctx.prisma.user.update({ ...query, where: { id: ctx.userId }, data: { name: args.name } }),
    }),
  }),
});

export const schema = builder.toSchema();
