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
  it('시드된 포스트를 author와 함께 반환한다', async () => {
    const body = await gql(`{ feed { id body author { name } } }`);
    expect(body.errors).toBeUndefined();
    expect(body.data.feed.length).toBeGreaterThan(0);
    expect(body.data.feed[0].author.name).toBeTruthy();
  });
});
