import { gql } from '@apollo/client';
import { useQuery, useMutation } from '@apollo/client/react';
import { useEffect, useRef } from 'react';

// 📚 LEARN(P6): feed가 리스트가 아니라 Connection(edges/pageInfo)을 반환하도록 바뀜.
// $after는 "이 커서 다음부터" — fetchMore가 매 스크롤마다 이전 페이지의 endCursor를 넘긴다.
const FEED = gql`query Feed($after: String) {
  feed(first: 10, after: $after) {
    edges { node { id body author { id name } likeCount likedByMe } }
    pageInfo { hasNextPage endCursor }
  }
}`;
// 📚 LEARN(P5): author에 id를 반드시 포함 — 정규화 캐시는 __typename+id로
// 객체를 식별한다. id를 빼면 정규화가 안 되고 P2의 stale이 재발한다.

const TOGGLE = gql`mutation Toggle($postId: Int!) {
  toggleLike(postId: $postId) { id likeCount likedByMe }
}`;

// 📚 LEARN(P5) 편차 (P6에도 유효): 브리프는 useQuery(FEED)를 무인자로 썼지만, Apollo Client 4의
// useQuery는 TData 기본값이 unknown이라(TypedDocumentNode/codegen 없이 plain gql만
// 쓰면) data.feed 접근에서 컴파일 에러가 난다. TypedDocumentNode/codegen은 이 학습
// 범위 밖(YAGNI)이라 최소한의 인라인 제네릭으로 근본 해결(as 단언 아님).
type FeedData = {
  feed: {
    edges: {
      node: {
        id: number;
        body: string;
        author: { id: number; name: string };
        likeCount: number;
        likedByMe: boolean;
      };
    }[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
};
type FeedVariables = { after?: string | null };

// 📚 LEARN(P7): optimisticResponse는 Unmasked<TData>와 정확히 같은 shape을 요구한다 —
// 브리프의 `__typename: 'Post'`를 object literal로 그대로 넘기려면 타입에도 __typename을
// 선언해야 한다(안 그러면 "리터럴이 알려지지 않은 프로퍼티를 가진다" 컴파일 에러).
type ToggleData = {
  toggleLike: { __typename: 'Post'; id: number; likeCount: number; likedByMe: boolean };
};
type ToggleVariables = { postId: number };

export function Feed({ onOpen }: { onOpen: (id: number) => void }) {
  const { data, loading, error, fetchMore } = useQuery<FeedData, FeedVariables>(FEED);
  const [toggle] = useMutation<ToggleData, ToggleVariables>(TOGGLE);
  const sentinel = useRef<HTMLDivElement>(null);
  const pageInfo = data?.feed.pageInfo;

  // 📚 LEARN(P6): IntersectionObserver로 sentinel div가 화면에 들어오면 다음 페이지 요청.
  // relayStylePagination()이 apollo.ts에 등록돼 있어, fetchMore로 받은 다음 페이지 edges를
  // 기존 edges 뒤에 이어붙이는 merge는 우리가 손으로 짤 필요가 없다.
  useEffect(() => {
    if (!sentinel.current || !pageInfo?.hasNextPage) return;
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) fetchMore({ variables: { after: pageInfo.endCursor } });
    });
    io.observe(sentinel.current);
    return () => io.disconnect();
  }, [pageInfo?.endCursor, pageInfo?.hasNextPage, fetchMore]);

  if (loading && !data) return <p>loading…</p>;
  if (error) return <p>error: {error.message}</p>;
  return (
    <>
      <ul>
        {(data?.feed.edges ?? []).map(({ node }) => (
          <li key={node.id} onClick={() => onOpen(node.id)} style={{ cursor: 'pointer', padding: 4 }}>
            <b>{node.author.name}</b> — {node.body}{' '}
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggle({
                  variables: { postId: node.id },
                  // 📚 LEARN(P7): 서버 응답 전에 "예상 응답"을 캐시에 먼저 반영 → 클릭 즉시 하트.
                  // 서버가 에러를 던지면 Apollo가 이 낙관적 레이어를 자동으로 걷어낸다(롤백).
                  optimisticResponse: {
                    toggleLike: {
                      __typename: 'Post', id: node.id,
                      likeCount: node.likeCount + (node.likedByMe ? -1 : 1),
                      likedByMe: !node.likedByMe,
                    },
                  },
                });
              }}
            >
              {node.likedByMe ? '❤️' : '🤍'} {node.likeCount}
            </button>
          </li>
        ))}
      </ul>
      <div ref={sentinel} style={{ height: 1 }} />
    </>
  );
}
