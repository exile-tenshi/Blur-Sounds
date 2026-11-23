import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { installMock } from './mock.js';
import App from './App.jsx';

if (!window.bsp) installMock();
createRoot(document.getElementById('root')).render(<App />);
