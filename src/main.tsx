import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/main.scss';
import App from './App';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Не удалось найти корневой элемент #root в документе.');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>
);
