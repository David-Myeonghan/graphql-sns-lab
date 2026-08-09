import { useEffect, useState } from 'react';
import { gqlFetch } from '../gqlFetch';

export function Profile() {
  const [name, setName] = useState('');
  const [saved, setSaved] = useState<string | null>(null);
  useEffect(() => {
    gqlFetch<{ me: { name: string } }>(`{ me { name } }`).then((d) => setName(d.me.name));
  }, []);
  async function save() {
    // 📚 LEARN(P2): mutation은 성공했다. 그런데 피드로 돌아가 보라 — 옛 이름이다.
    // gqlFetch의 Map 캐시가 mutation을 모르기 때문. 고치려면 invalidateAll()을
    // 직접 불러야 한다(아래 주석 해제). "무엇을 무효화할지"의 책임이 전부 나에게 있다.
    // 📚 LEARN(P2): mutation까지 캐시되는 버그 — 수제 캐시의 두 번째 함정.
    // gqlFetch의 key는 query 문자열 + variables뿐이라 mutation도 캐시 대상이 된다.
    // 같은 이름으로 두 번 저장을 눌러도 두 번째부터는 네트워크를 타지 않고 캐시 히트다.
    const d = await gqlFetch<{ updateMyName: { name: string } }>(
      `mutation($name: String!) { updateMyName(name: $name) { name } }`,
      { name },
    );
    // invalidateAll(); // ← P2 후반: 이 줄을 켜야만 피드가 새 이름을 본다
    setSaved(d.updateMyName.name);
  }
  return (
    <div>
      <input value={name} onChange={(e) => setName(e.target.value)} />
      <button onClick={save}>저장</button>
      {saved && <p>저장됨: {saved}</p>}
    </div>
  );
}
