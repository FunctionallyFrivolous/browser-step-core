import "@browser-step/core";
import "@browser-step/kernel";
import "@browser-step/renderer";

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("Viewer root element was not found.");
}

const heading = document.createElement("h1");
heading.textContent = "Browser STEP Core";

const message = document.createElement("p");
message.textContent = "Project foundation ready.";

app.append(heading, message);
