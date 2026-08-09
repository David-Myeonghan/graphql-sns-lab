import { gql } from '@apollo/client';
import { useQuery } from '@apollo/client/react';

const POST = gql`
  query Post($id: Int!) {
    post(id: $id) { id body author { id name } comments { id body author { id name } } }
  }
`;
// 📚 LEARN(P5): Feed.tsx와 동일한 이유로 author에 id 포함 — 정규화 캐시가
// User:{id}로 식별해야 Profile의 mutation이 여기도 자동으로 갱신한다.

// 📚 LEARN(P5) 편차: Feed.tsx/Profile.tsx와 같은 이유(useQuery 기본 TData=unknown).
type PostData = {
  post: {
    id: number;
    body: string;
    author: { id: number; name: string };
    comments: { id: number; body: string; author: { id: number; name: string } }[];
  } | null;
};

export function PostDetail({ id }: { id: number }) {
  const { data, loading } = useQuery<PostData, { id: number }>(POST, { variables: { id } });
  if (loading) return <p>loading…</p>;
  if (!data?.post) return <p>not found</p>;
  return (
    <article>
      <p><b>{data.post.author.name}</b> — {data.post.body}</p>
      <ul>
        {data.post.comments.map((c: { id: number; body: string; author: { name: string } }) => (
          <li key={c.id}><b>{c.author.name}</b>: {c.body}</li>
        ))}
      </ul>
    </article>
  );
}
