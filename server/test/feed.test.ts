import { describe, it, expect } from 'vitest';
import { yoga } from '../src/main';

async function gql(query: string, variables?: object) {
  const res = await yoga.fetch('http://yoga/graphql', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  return res.json();
}

describe('feed', () => {
  it('시드된 포스트를 Relay Connection 형태(edges/pageInfo)로 반환한다', async () => {
    const body = await gql(
      `{ feed(first: 5) { edges { node { id body author { name } } } pageInfo { hasNextPage endCursor } } }`,
    );
    expect(body.errors).toBeUndefined();
    expect(body.data.feed.edges.length).toBe(5);
    expect(body.data.feed.edges[0].node.author.name).toBeTruthy();
    expect(body.data.feed.pageInfo.hasNextPage).toBe(true);
  });
});
