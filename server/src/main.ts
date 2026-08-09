import { createServer } from 'node:http';
import { createYoga } from 'graphql-yoga';
import { EnvelopArmorPlugin } from '@escape.tech/graphql-armor';
import { schema } from './schema';
import { createContext } from './context';

export const yoga = createYoga({
  schema,
  context: ({ request }) => createContext(request),
  // 📚 LEARN(P4): REST엔 없던 공격 표면 — 클라이언트가 쿼리 모양을 정하는 대가.
  // maxDepth 하나로 위 폭탄 쿼리가 죽는다. 편차(실측): HTTP는 여전히 200 —
  // GraphQL 스펙상 검증 에러도 응답 바디의 `errors`로 전달되지, 전송 계층(HTTP status)
  // 문제가 아니다. 대신 `data` 키 자체가 없다(값이 null도 아님) — README P4 실측 참조.
  plugins: [EnvelopArmorPlugin({ maxDepth: { n: 6 } })],
});

// 테스트에서 import될 때는 리슨하지 않음
if (process.argv[1]?.endsWith('main.ts')) {
  createServer(yoga).listen(4000, () => console.log('http://localhost:4000/graphql'));
}
