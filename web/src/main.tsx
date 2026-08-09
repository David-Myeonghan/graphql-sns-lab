import { createRoot } from 'react-dom/client';
import { ApolloProvider } from '@apollo/client/react';
import { apolloClient } from './apollo';
import { App } from './App';
createRoot(document.getElementById('root')!).render(
  <ApolloProvider client={apolloClient}><App /></ApolloProvider>,
);
