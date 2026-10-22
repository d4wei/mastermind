import { createRoot } from 'react-dom/client'
import { createBrowserHost } from './app/browserHost'
import { installHost } from './app/host'
import { App } from './app/App'
import './app/app.css'

// default until config loads; ThemeEffects takes over
document.documentElement.dataset.theme = 'grid'

installHost(createBrowserHost())

createRoot(document.getElementById('root')!).render(<App />)
