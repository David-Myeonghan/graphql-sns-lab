import { ApolloClient, InMemoryCache, HttpLink } from '@apollo/client';

// 📚 LEARN(P5): InMemoryCache는 정규화 캐시 — 응답을 해체해 "User:1" 같은
// 객체 단위로 저장한다. P2의 Map 캐시(쿼리 단위)와의 차이가 이 학습 전체의 핵심.
// Apollo Client Devtools 확장을 설치하고 Cache 탭에서 User:1 엔트리를 직접 볼 것.
export const apolloClient = new ApolloClient({
  link: new HttpLink({ uri: '/graphql' }),
  cache: new InMemoryCache(),
});
