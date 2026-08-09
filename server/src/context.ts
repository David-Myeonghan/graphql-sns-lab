import { PrismaClient } from './generated/prisma/client'; // Prisma 7: 생성물에서 import
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import DataLoader from 'dataloader';

// 📚 LEARN(P1): GraphQL 서버의 "요청당 컨텍스트" — 인증·DB 핸들이 리졸버로 흐르는 통로.
// 실제 인증 대신 x-user-id 헤더로 흉내 (기본 유저 1).
//
// 📚 LEARN(P1) 편차: Prisma 7은 Rust 엔진을 뺐다 — schema.prisma의 url만으로는 접속 불가,
// PrismaClient에 driver adapter를 직접 넘겨야 한다 (원 브리프는 `new PrismaClient()` 무인자).
const adapter = new PrismaBetterSqlite3({ url: 'file:./prisma/dev.db' });
export const prisma = new PrismaClient({ adapter, log: [{ emit: 'event', level: 'query' }] });

// 📚 LEARN(P3): 쿼리 카운터 — N+1을 눈으로 보기 위한 계측
export let queryCount = 0;
export const resetQueryCount = () => {
  queryCount = 0;
};
prisma.$on('query', (e) => {
  queryCount++;
  console.log(`[SQL ${queryCount}]`, e.query.slice(0, 80));
});

// 📚 LEARN(P3): DataLoader — 같은 tick 안의 .load(id)들을 모아 IN 쿼리 1방으로.
// "클라이언트가 쿼리 모양을 정하면 서버는 접근 패턴을 예측할 수 없다"의 서버측 처방.
// (Comment.author는 findFirst라 Prisma의 findUnique 전용 자동배칭 대상이 아니었다 —
// 그 배칭을 GraphQL 리졸버 레벨에서 우리가 직접 재구현하는 것이 DataLoader다.)
export function createLoaders(currentUserId: number) {
  return {
    user: new DataLoader<number, { id: number; name: string; avatarUrl: string }>(async (ids) => {
      const users = await prisma.user.findMany({ where: { id: { in: [...ids] } } });
      const map = new Map(users.map((u) => [u.id, u]));
      return ids.map((id) => map.get(id)!);
    }),
    // 📚 LEARN(P7): P3와 같은 패턴 — 피드 10개의 likedByMe도 IN 1방으로.
    myLikes: new DataLoader<number, boolean>(async (postIds) => {
      const likes = await prisma.like.findMany({
        where: { postId: { in: [...postIds] }, userId: currentUserId },
      });
      const liked = new Set(likes.map((l) => l.postId));
      return postIds.map((id) => liked.has(id));
    }),
  };
}

export interface Context {
  userId: number;
  prisma: PrismaClient;
  loaders: ReturnType<typeof createLoaders>;
}

export function createContext(request: Request): Context {
  const userId = Number(request.headers.get('x-user-id') ?? 1);
  // 📚 LEARN(P3): loader는 요청마다 새로 만든다 — 요청 간 캐시 공유는 stale/권한 누수
  return { userId, prisma, loaders: createLoaders(userId) };
}
