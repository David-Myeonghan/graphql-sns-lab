import { useState } from 'react';
import { Feed } from './screens/Feed';
import { PostDetail } from './screens/PostDetail';
import { Profile } from './screens/Profile';

export type Screen = { name: 'feed' } | { name: 'post'; id: number } | { name: 'profile' };

export function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'feed' });
  return (
    <div style={{ maxWidth: 480, margin: '0 auto', fontFamily: 'sans-serif' }}>
      <nav style={{ display: 'flex', gap: 8, padding: 8 }}>
        <button onClick={() => setScreen({ name: 'feed' })}>피드</button>
        <button onClick={() => setScreen({ name: 'profile' })}>프로필</button>
      </nav>
      {screen.name === 'feed' && <Feed onOpen={(id) => setScreen({ name: 'post', id })} />}
      {screen.name === 'post' && <PostDetail id={screen.id} />}
      {screen.name === 'profile' && <Profile />}
    </div>
  );
}
