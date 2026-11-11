import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { preloadStartIcons } from './data';
import './style.css';

preloadStartIcons();
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
