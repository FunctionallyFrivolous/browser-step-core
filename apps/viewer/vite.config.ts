import { defineConfig } from "vite";

export default defineConfig(({ command }) => ({
  base: command === "build" ? "/browser-step-core/" : "/",
}));
