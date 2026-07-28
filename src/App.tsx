import { RotateCcw } from "lucide-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import PWAUpdatePrompt from "@/components/PWAUpdatePrompt";
import Index from "./pages/Index.tsx";
import NotFound from "./pages/NotFound.tsx";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      {/* See .landscape-lock in index.css — iOS won't honor a real orientation lock
          for a home-screen PWA, this blocks the app instead of letting it render sideways. */}
      <div className="landscape-lock fixed inset-0 z-[100] flex-col items-center justify-center gap-3 bg-background px-8 text-center">
        <RotateCcw size={32} className="text-primary" />
        <p className="text-sm font-medium text-foreground">Tourne ton téléphone en mode portrait</p>
        <p className="text-xs text-muted-foreground">Cette app est conçue pour un usage vertical.</p>
      </div>
      <PWAUpdatePrompt />
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Index />} />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
