import { describe, it, expect } from 'vitest';
import { yoga } from '../src/main';
import { queryCount, resetQueryCount } from '../src/context';

describe('DataLoader batching', () => {
  it('post 1개의 comments{author}가 SQL 3회 이하로 끝난다 (post + comments + batched users)', async () => {
    resetQueryCount();
    const res = await yoga.fetch('http://yoga/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: '{ post(id: 1) { comments { body author { name } } } }' }),
    });
    const body = await res.json();
    expect(body.errors).toBeUndefined();
    expect(queryCount).toBeLessThanOrEqual(3);
  });
});
