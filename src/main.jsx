import React from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.jsx";
import { applyIOSInputZoomGuard } from "./lib/viewport.js";

// v7.57 (DECISIONS #117): auf iOS-artigen Geräten (isIOSLike) verhindert
// maximum-scale=1 im viewport-Meta-Tag den automatischen Fokus-Zoom bei
// Eingabefeldern unter 16px (das Chat-Eingabefeld ist seit v7.57 bewusst
// text-sm/14px, die Einstellungsfelder waren es bereits vorher) - EINMALIG
// vor dem ersten Render, damit der Tag bereits beim allerersten Layout gilt.
applyIOSInputZoomGuard();

createRoot(document.getElementById("root")).render(<App />);
