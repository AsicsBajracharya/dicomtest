import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// import './index.css'
// import App from './App1.tsx'
import TestApp from './TestApp.tsx'
// import FileUploader from './FileUploader.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* <FileUploader /> */}
    <TestApp />
    {/* <App /> */}
  </StrictMode>,
)
