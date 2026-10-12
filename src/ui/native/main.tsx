import { createRoot } from 'react-dom/client'
import type { ThemeInfo } from '../../shared/types'
import { installHost } from '../app/host'
import { createNativeHost } from './host'
import { nativeBridge } from './bridge'
import { NativeReviewer } from './NativeReviewer'
import 'slot-text/style.css'
import '../app/app.css'
import './native.css'

const themes = await fetch('/themes.json').then((response) => response.json()) as ThemeInfo[]
installHost(createNativeHost(nativeBridge, themes))
document.documentElement.dataset.theme = 'grid'
createRoot(document.getElementById('root')!).render(<NativeReviewer />)
