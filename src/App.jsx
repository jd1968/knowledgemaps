import { useEffect } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import Toolbar from './components/Toolbar'
import MindMapCanvas from './components/MindMapCanvas'
import Sidebar from './components/Sidebar'
import MapListModal from './components/MapListModal'
import LoginPage from './components/LoginPage'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { useMindMapStore } from './store/useMindMapStore'
import './App.css'

function AppInner() {
  const { undo, redo } = useMindMapStore()
  const { user, loading } = useAuth()

  // Global keyboard shortcuts
  useEffect(() => {
    const onKey = (e) => {
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return

      if (e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        undo()
      } else if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) {
        e.preventDefault()
        redo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo])

  if (loading) return <div className="auth-loading" />
  if (!user) return <LoginPage />

  return (
    <div className="app">
      <Toolbar />
      <div className="app-body">
        <div className="canvas-wrapper">
          <MindMapCanvas />
        </div>
        <Sidebar />
      </div>
      <MapListModal />
    </div>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <ReactFlowProvider>
        <AppInner />
      </ReactFlowProvider>
    </AuthProvider>
  )
}
