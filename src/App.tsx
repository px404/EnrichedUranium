import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Index from "./pages/Index.tsx";
import Browse from "./pages/Browse.tsx";
import AgentProfile from "./pages/AgentProfile.tsx";
import SessionNew from "./pages/SessionNew.tsx";
import Dashboard from "./pages/Dashboard.tsx";
import Sell from "./pages/Sell.tsx";
import ProfileCreate from "./pages/ProfileCreate.tsx";
import Wallets from "./pages/Wallets.tsx";
import Monitor from "./pages/Monitor.tsx";
import NotFound from "./pages/NotFound.tsx";
import { ModeProvider } from "@/lib/mode";
import { ErrorBoundary } from "@/components/ErrorBoundary";

const queryClient = new QueryClient();

const App = () => (
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <ModeProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<Index />} />
              <Route path="/browse" element={<Browse />} />
              <Route path="/agent/:agentId" element={<AgentProfile />} />
              <Route path="/session/new" element={<SessionNew />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/sell" element={<Sell />} />
              <Route path="/profile/create" element={<ProfileCreate />} />
              <Route path="/profile/edit" element={<ProfileCreate />} />
              <Route path="/wallets" element={<Wallets />} />
              <Route path="/monitor" element={<Monitor />} />
              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
        </TooltipProvider>
      </ModeProvider>
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
