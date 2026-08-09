import { createServer } from 'node:http';
import { createYoga } from 'graphql-yoga';
import { schema } from './schema';
import { createContext } from './context';

export const yoga = createYoga({
  schema,
  context: ({ request }) => createContext(request),
});

// 테스트에서 import될 때는 리슨하지 않음
if (process.argv[1]?.endsWith('main.ts')) {
  createServer(yoga).listen(4000, () => console.log('http://localhost:4000/graphql'));
}
