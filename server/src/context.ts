import { PrismaClient } from './generated/prisma/client'; // Prisma 7: 생성물에서 import
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';

// 📚 LEARN(P1): GraphQL 서버의 "요청당 컨텍스트" — 인증·DB 핸들이 리졸버로 흐르는 통로.
// 실제 인증 대신 x-user-id 헤더로 흉내 (기본 유저 1).
//
// 📚 LEARN(P1) 편차: Prisma 7은 Rust 엔진을 뺐다 — schema.prisma의 url만으로는 접속 불가,
// PrismaClient에 driver adapter를 직접 넘겨야 한다 (원 브리프는 `new PrismaClient()` 무인자).
const adapter = new PrismaBetterSqlite3({ url: 'file:./prisma/dev.db' });
export const prisma = new PrismaClient({ adapter });

export interface Context {
  userId: number;
  prisma: PrismaClient;
}

export function createContext(request: Request): Context {
  return { userId: Number(request.headers.get('x-user-id') ?? 1), prisma };
}
