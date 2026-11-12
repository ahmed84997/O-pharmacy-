import { createRoot } from 'react-dom/client';
import './styles.css';
import App from './App';
import { theme } from './chrome';
theme.apply(); // light by default; dark only when chosen on this device
createRoot(document.getElementById('root')!).render(<App />);
