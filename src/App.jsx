import { useEffect } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import Toolbar from './components/Toolbar'
import MindMapCanvas from './components/MindMapCanvas'
import NodePopup from './components/NodePopup'
import MapListModal from './components/MapListModal'
import LoginPage from './components/LoginPage'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { useMindMapStore } from './store/useMindMapStore'
import './App.css'

function AppInner() {
  const { undo, redo, loadMap } = useMindMapStore()
  const { user, loading } = useAuth()

  // Restore the last viewed map once the user is authenticated
  useEffect(() => {
    if (!user) return
    const lastMapId = localStorage.getItem('km_lastMapId')
    if (lastMapId) loadMap(lastMapId)
  }, [user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

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
      </div>
      <NodePopup />
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
