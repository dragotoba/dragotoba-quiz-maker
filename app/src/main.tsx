import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { consumeDragotobaTokenHandoff } from "./lib/dragotoba-handoff";
import "./index.css";

void consumeDragotobaTokenHandoff().finally(() => {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
