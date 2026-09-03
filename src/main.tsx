import { createRoot } from 'react-dom/client'
import { App } from './App'
import { AuthProvider } from './auth/AuthProvider'
import { installDebugHook } from './debug'
import './styles.css'

// vim-web ships the viewer's stylesheet; it must be imported exactly once.
import 'vim-web/style.css'

const container = document.getElementById('root')
if (!container) throw new Error('#root is missing from index.html')

installDebugHook()

// No <StrictMode>: it mounts every component twice, and the vim-web viewer
// leaks a WebGL context per mount. See viewer.md.
createRoot(container).render(
  <AuthProvider>
    <App />
  </AuthProvider>,
)
