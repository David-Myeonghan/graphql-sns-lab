import { gql } from '@apollo/client';
import { useQuery, useMutation } from '@apollo/client/react';
import { useEffect, useState } from 'react';

const ME = gql`query Me { me { id name } }`;
const UPDATE = gql`mutation Update($name: String!) { updateMyName(name: $name) { id name } }`;

// 📚 LEARN(P5) 편차: Feed.tsx와 같은 이유(useQuery 기본 TData=unknown) — 인라인
// 제네릭으로 타입을 준다. codegen 없이 스키마와 손으로 대응(YAGNI 범위 밖).
type MeData = { me: { id: number; name: string } | null };
type UpdateData = { updateMyName: { id: number; name: string } };

export function Profile() {
  const { data } = useQuery<MeData>(ME);
  const [update, { data: saved }] = useMutation<UpdateData, { name: string }>(UPDATE);
  const [name, setName] = useState('');
  useEffect(() => { if (data?.me) setName(data.me.name); }, [data]);
  // 📚 LEARN(P5): invalidateAll도 refetch도 없다. mutation 응답에 id+name이 있으니
  // 캐시의 User:{id}가 갱신되고, 그 객체를 참조하는 피드가 저절로 다시 그려진다.
  return (
    <div>
      <input value={name} onChange={(e) => setName(e.target.value)} />
      <button onClick={() => update({ variables: { name } })}>저장</button>
      {saved && <p>저장됨: {saved.updateMyName.name}</p>}
    </div>
  );
}
