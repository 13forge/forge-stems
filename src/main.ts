import "./style.css";
import { mountRemixShell } from "./ui/app.js";

const appRoot = document.getElementById("app");
if (appRoot) {
  mountRemixShell(appRoot);
}
