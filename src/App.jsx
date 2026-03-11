import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useParams, useLocation, useSearchParams, useNavigate } from 'react-router-dom'
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

function MapPage() {
  const { mapId } = useParams()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { loadMap, setViewMode, isFullscreen } = useMindMapStore()

  const viewMode = searchParams.get('view') || 'map'

  // Load map when mapId changes (including browser back/forward)
  useEffect(() => {
    const breadcrumbs = location.state?.breadcrumbs ?? []
    loadMap(mapId, breadcrumbs).then((result) => {
      if (!result?.success) navigate('/', { replace: true })
    })
  }, [mapId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Sync view mode from URL into store
  useEffect(() => {
    setViewMode(viewMode)
  }, [viewMode]) // eslint-disable-line react-hooks/exhaustive-deps

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

function AppInner() {
  const { undo, redo, isEditMode } = useMindMapStore()
  const { user, loading } = useAuth()

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

  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/map/:mapId" element={<MapPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ReactFlowProvider>
          <AppInner />
        </ReactFlowProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
