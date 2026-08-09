import { builder } from './builder';

// 📚 LEARN(P1): code-first — TS 코드가 곧 스키마. GraphiQL 문서 탭에서 이 정의가
// 그대로 "살아있는 API 문서"로 렌더되는 것을 볼 것.
builder.prismaObject('User', {
  fields: (t) => ({
    id: t.exposeInt('id'),
    name: t.exposeString('name'),
    avatarUrl: t.exposeString('avatarUrl'),
  }),
});

builder.prismaObject('Comment', {
  fields: (t) => ({
    id: t.exposeInt('id'),
    body: t.exposeString('body'),
    author: t.relation('author'), // 📚 LEARN(P3): 이 relation이 N+1의 진원지가 된다
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
    feed: t.prismaField({
      type: ['Post'],
      resolve: (query, _root, _args, ctx) =>
        ctx.prisma.post.findMany({ ...query, orderBy: { createdAt: 'desc' }, take: 20 }),
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
