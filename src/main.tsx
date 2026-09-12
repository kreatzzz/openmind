import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import App from "./App";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("The application root is missing.");

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
