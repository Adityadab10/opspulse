import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ClerkProvider } from "@clerk/react";
import { Toaster } from "react-hot-toast";
import "./App.css";
import App from "./App.jsx";

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

createRoot(document.getElementById("root")).render(
  <StrictMode>
    {publishableKey ? (
      <ClerkProvider publishableKey={publishableKey} signInUrl="/login" signUpUrl="/register"
        appearance={{ variables: {
          colorPrimary: "#22d3ee", colorBackground: "#0f172a",
          colorForeground: "#e2e8f0", colorInputBackground: "#020617",
          colorInputForeground: "#e2e8f0", colorMutedForeground: "#94a3b8",
        } }}
        signInFallbackRedirectUrl="/dashboard" signUpFallbackRedirectUrl="/dashboard" afterSignOutUrl="/login">
        <App />
        <Toaster position="top-right" />
      </ClerkProvider>
    ) : <p role="alert">Sign-in is unavailable. Set VITE_CLERK_PUBLISHABLE_KEY.</p>}
  </StrictMode>,
);
