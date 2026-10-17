import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/plus-jakarta-sans/latin-400.css";
import "@fontsource/plus-jakarta-sans/latin-500.css";
import "@fontsource/plus-jakarta-sans/latin-600.css";
import "@fontsource/plus-jakarta-sans/latin-700.css";
import App from "./App";
import { VaultGate } from "./components/VaultGate";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <VaultGate>
      <App />
    </VaultGate>
  </React.StrictMode>,
);
