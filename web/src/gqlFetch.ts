// 📚 LEARN(P2): 수제 document 캐시 — "성능을 위해" 쿼리 문자열 단위로 응답을 저장한다.
// 이 캐시가 mutation을 전혀 모른다는 것이 이 Phase의 핵심 함정이다.
// 이름을 바꿔도 feed 캐시 안의 옛 이름은 그대로다 → stale.
// P5에서 이 파일은 통째로 삭제되고 Apollo InMemoryCache(정규화)가 대체한다.
const cache = new Map<string, unknown>();

export async function gqlFetch<T>(query: string, variables?: object): Promise<T> {
  const key = query + JSON.stringify(variables ?? {});
  if (cache.has(key)) return cache.get(key) as T;
  const res = await fetch('/graphql', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json();
  if (body.errors) throw new Error(body.errors[0].message);
  cache.set(key, body.data);
  return body.data as T;
}

// 📚 LEARN(P2): 결국 이런 수동 무효화 API가 필요해진다 — "mutation 후 어떤 쿼리를
// 지워야 하지?"를 사람이 추적하는 것. 화면이 10개면 10배로 부서지기 쉽다.
export function invalidateAll() {
  cache.clear();
}
