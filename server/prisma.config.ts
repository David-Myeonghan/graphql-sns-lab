import { defineConfig } from 'prisma/config';

// 📚 LEARN(P1): Prisma 7 — datasource url은 더 이상 schema.prisma에 쓸 수 없다.
// Migrate/CLI가 이 파일에서 연결 정보를 읽는다 (PrismaClient 런타임 연결은 driver adapter로 별도 지정).
export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: 'file:./prisma/dev.db',
  },
});
