import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { DataProvider } from "./store";
import "./styles.css";
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <main className="container">
        <h1>Verdict</h1>
        <p>The interface could not render. Reload to read the chain again.</p>
        <button onClick={() => location.reload()}>Reload site</button>
      </main>
    ) : (
      this.props.children
    );
  }
}
createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <DataProvider>
      <App />
    </DataProvider>
  </ErrorBoundary>,
);
