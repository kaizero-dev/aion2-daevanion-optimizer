import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { preloadInactiveIcons, preloadStartIcons } from './data';
import './style.css';

preloadStartIcons();
preloadInactiveIcons();
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
