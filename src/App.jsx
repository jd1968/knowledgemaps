import { useEffect } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import Toolbar from './components/Toolbar'
import MindMapCanvas from './components/MindMapCanvas'
import FeedView from './components/FeedView'
import ContentsView from './components/ContentsView'
import TextView from './components/MapTextModal'
import NodePopup from './components/NodePopup'
import MapListModal from './components/MapListModal'
import LoginPage from './components/LoginPage'
import HomePage from './components/HomePage'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { useMindMapStore } from './store/useMindMapStore'
import './App.css'

function AppInner() {
  const { undo, redo, isEditMode, isFullscreen, viewMode, showHome } = useMindMapStore()
  const { user, loading } = useAuth()

  // Global keyboard shortcuts
  useEffect(() => {
    const onKey = (e) => {
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return
      if (!isEditMode) return

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
  }, [isEditMode, undo, redo])

  if (loading) return <div className="auth-loading" />
  if (!user) return <LoginPage />

  if (showHome) {
    return <HomePage />
  }

  return (
    <div className={`app${isFullscreen ? ' app--fullscreen' : ''}`}>
      {!isFullscreen && <Toolbar />}
      <div className="app-body">
        {viewMode === 'feed' ? (
          <FeedView />
        ) : viewMode === 'contents' ? (
          <ContentsView />
        ) : viewMode === 'text' ? (
          <TextView />
        ) : (
          <div className="canvas-wrapper">
            <MindMapCanvas />
          </div>
        )}
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
