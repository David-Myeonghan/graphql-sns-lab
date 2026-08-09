import { gql } from '@apollo/client';
import { useQuery } from '@apollo/client/react';

const FEED = gql`query Feed { feed { id body author { id name } } }`;
// 📚 LEARN(P5): author에 id를 반드시 포함 — 정규화 캐시는 __typename+id로
// 객체를 식별한다. id를 빼면 정규화가 안 되고 P2의 stale이 재발한다.

// 📚 LEARN(P5) 편차: 브리프는 useQuery(FEED)를 무인자로 썼지만, Apollo Client 4의
// useQuery는 TData 기본값이 unknown이라(TypedDocumentNode/codegen 없이 plain gql만
// 쓰면) data.feed 접근에서 컴파일 에러가 난다. TypedDocumentNode/codegen은 이 학습
// 범위 밖(YAGNI)이라 최소한의 인라인 제네릭으로 근본 해결(as 단언 아님).
type FeedData = { feed: { id: number; body: string; author: { id: number; name: string } }[] };

export function Feed({ onOpen }: { onOpen: (id: number) => void }) {
  const { data, loading, error } = useQuery<FeedData>(FEED);
  if (loading) return <p>loading…</p>;
  if (error) return <p>error: {error.message}</p>;
  return (
    <ul>
      {(data?.feed ?? []).map((p: { id: number; body: string; author: { name: string } }) => (
        <li key={p.id} onClick={() => onOpen(p.id)} style={{ cursor: 'pointer', padding: 4 }}>
          <b>{p.author.name}</b> — {p.body}
        </li>
      ))}
    </ul>
  );
}
