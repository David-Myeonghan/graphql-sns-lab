import { useEffect, useState } from 'react';
import { gqlFetch } from '../gqlFetch';

type PostData = {
  post: { body: string; author: { name: string }; comments: { id: number; body: string; author: { name: string } }[] };
};

export function PostDetail({ id }: { id: number }) {
  const [data, setData] = useState<PostData | null>(null);
  useEffect(() => {
    gqlFetch<PostData>(
      `query($id: Int!) { post(id: $id) { body author { name } comments { id body author { name } } } }`,
      { id },
    ).then(setData);
  }, [id]);
  if (!data?.post) return <p>loading…</p>;
  return (
    <article>
      <p><b>{data.post.author.name}</b> — {data.post.body}</p>
      <ul>
        {data.post.comments.map((c) => (
          <li key={c.id}><b>{c.author.name}</b>: {c.body}</li>
        ))}
      </ul>
    </article>
  );
}
