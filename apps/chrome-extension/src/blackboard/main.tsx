import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BlackboardApp } from './BlackboardApp';
import './blackboard.css';

const root = document.getElementById('root');
if (!root) throw new Error('The blackboard root element is missing.');

createRoot(root).render(
  <StrictMode>
    <BlackboardApp />
  </StrictMode>,
);
