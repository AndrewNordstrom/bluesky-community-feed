import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './contexts/AuthContext';
import { Login } from './pages/Login';
import { Vote } from './pages/Vote';
import { Dashboard } from './pages/Dashboard';
import { PostExplain } from './pages/PostExplain';
import { History } from './pages/History';
import { AdminPage } from './pages/Admin';
import { LegalDocument } from './pages/LegalDocument';
import { ResearchConsent } from './pages/ResearchConsent';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30000, // 30 seconds
      retry: 1,
    },
  },
});

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/tos" element={<LegalDocument document="tos" />} />
            <Route path="/privacy" element={<LegalDocument document="privacy" />} />
            <Route path="/research-consent" element={<ResearchConsent />} />
            <Route path="/vote" element={<Vote />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/post/:uri" element={<PostExplain />} />
            <Route path="/history" element={<History />} />
            <Route path="/admin" element={<AdminPage />} />
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
