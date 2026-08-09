import { useEffect, useState } from 'react';
import { gqlFetch } from '../gqlFetch';

type FeedData = { feed: { id: number; body: string; author: { name: string } }[] };

export function Feed({ onOpen }: { onOpen: (id: number) => void }) {
  const [data, setData] = useState<FeedData | null>(null);
  useEffect(() => {
    gqlFetch<FeedData>(`{ feed { id body author { name } } }`).then(setData);
  }, []);
  if (!data) return <p>loading…</p>;
  return (
    <ul>
      {data.feed.map((p) => (
        <li key={p.id} onClick={() => onOpen(p.id)} style={{ cursor: 'pointer', padding: 4 }}>
          <b>{p.author.name}</b> — {p.body}
        </li>
      ))}
    </ul>
  );
}
