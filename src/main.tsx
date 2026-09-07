import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/inter";
import "@fontsource-variable/newsreader";
import App from "./App";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("The application root is missing.");

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
