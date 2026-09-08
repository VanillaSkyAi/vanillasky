import { Home } from "./pages/Home";

export function App() {
  if (window.location.pathname !== "/") {
    window.location.replace("/" + window.location.search);
    return null;
  }
  return <><a className="skip-link" href="#content">Skip to content</a><Home /></>;
}
