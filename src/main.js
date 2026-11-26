import './styles/main.css';
import { installPreloadGuard } from './modules/resilience.js';
import { initUi } from './modules/ui.js';

// GRAFIK-46: install before any UI work so a failed preload (stale HTML
// pointing at removed hashed chunks) is handled on the very first error.
installPreloadGuard();
initUi();
