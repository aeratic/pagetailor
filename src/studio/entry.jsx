import { createRoot } from "react-dom/client";
import { registry } from "pagetailor:registry";
import { App } from "./App.jsx";

createRoot(document.getElementById("root")).render(<App registry={registry} />);
