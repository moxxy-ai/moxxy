import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import '@moxxy/ui-tokens/tokens.css';
import '@moxxy/ui-tokens/motifs.css';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root not found — check index.html');

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
