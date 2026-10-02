import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/outfit'
import '@fontsource-variable/dm-sans'
import '@fontsource/bungee/latin.css'
import './theme/tokens.css'
import './theme/base.css'
import './theme/components.css'
import './theme/xylophone.css'
import './theme/screens.css'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
