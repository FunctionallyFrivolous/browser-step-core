import { defineConfig } from "vite";

export default defineConfig(({ command, isPreview }) => ({
  base: process.env.VITE_BASE || (command === "build" || isPreview ? "/browser-step-core/" : "/"),
}));
