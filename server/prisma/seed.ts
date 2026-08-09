import { PrismaClient } from '../src/generated/prisma/client'; // Prisma 7: 생성물에서 import
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';

// 📚 LEARN(P1) 편차: Prisma 7은 Rust 엔진을 뺐다 — url만으로 접속 불가, driver adapter 필수.
// (원 브리프는 `new PrismaClient()` 무인자였으나 실제로는 PrismaClientInitializationError)
const adapter = new PrismaBetterSqlite3({ url: 'file:./prisma/dev.db' });
const prisma = new PrismaClient({ adapter });

async function main() {
  await prisma.like.deleteMany();
  await prisma.comment.deleteMany();
  await prisma.post.deleteMany();
  await prisma.user.deleteMany();

  const users = await Promise.all(
    ['Ava', 'Ben', 'Cho'].map((name, i) =>
      prisma.user.create({ data: { name, avatarUrl: `https://i.pravatar.cc/80?u=${i}` } }),
    ),
  );
  for (let i = 0; i < 30; i++) {
    const post = await prisma.post.create({
      data: {
        body: `post #${i} — ${['GraphQL 공부중', '점심 뭐먹지', '오늘의 커밋'][i % 3]}`,
        authorId: users[i % 3].id,
        createdAt: new Date(Date.now() - i * 3_600_000), // pagination 테스트용 시간차
      },
    });
    for (let c = 0; c < 3 + (i % 3); c++) {
      await prisma.comment.create({
        data: { body: `comment ${c} on ${i}`, postId: post.id, authorId: users[c % 3].id },
      });
    }
    if (i % 2 === 0) await prisma.like.create({ data: { postId: post.id, userId: users[1].id } });
  }
  console.log('seeded:', await prisma.post.count(), 'posts,', await prisma.comment.count(), 'comments');
}
main().finally(() => prisma.$disconnect());
