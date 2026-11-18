import { CommandManager, ModelSession, SelectionModel } from "@browser-step/core";
import { createStepRenderer, type CameraProjection } from "@browser-step/renderer";

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("Viewer root element was not found.");
}

const heading = document.createElement("h1");
heading.textContent = "STEP Model Viewer";

const fileInput = document.createElement("input");
fileInput.type = "file";
fileInput.accept = ".step,.stp";
fileInput.setAttribute("aria-label", "Load a STEP file");

const fitButton = document.createElement("button");
fitButton.type = "button";
fitButton.textContent = "Fit model to view";
fitButton.disabled = true;

const projectionSelect = document.createElement("select");
projectionSelect.setAttribute("aria-label", "Camera projection");
for (const projection of ["orthographic", "perspective"] as const) {
  const option = document.createElement("option");
  option.value = projection;
  option.textContent = `${projection[0].toUpperCase()}${projection.slice(1)}`;
  projectionSelect.append(option);
}
projectionSelect.value = "orthographic";

const lightingControl = document.createElement("label");
const lightingToggle = document.createElement("input");
lightingToggle.type = "checkbox";
lightingControl.append(lightingToggle, "Use original scene lighting");

const opacityControl = document.createElement("label");
const opacitySlider = document.createElement("input");
opacitySlider.type = "range";
opacitySlider.min = "0";
opacitySlider.max = "1";
opacitySlider.step = "0.01";
opacitySlider.value = "0.5";
opacitySlider.setAttribute("aria-label", "Model opacity");
const opacityValue = document.createElement("output");
opacityValue.value = "50%";
opacityValue.textContent = opacityValue.value;
opacityControl.append("Model opacity", opacitySlider, opacityValue);

const edgeThicknessControl = document.createElement("label");
edgeThicknessControl.className = "edge-thickness-control";
const edgeThicknessSlider = document.createElement("input");
edgeThicknessSlider.type = "range";
edgeThicknessSlider.min = "0";
edgeThicknessSlider.max = "5";
edgeThicknessSlider.step = "0.1";
edgeThicknessSlider.value = "1";
edgeThicknessSlider.setAttribute("aria-label", "Edge line thickness");
const edgeThicknessValue = document.createElement("output");
edgeThicknessValue.value = "1 px";
edgeThicknessValue.textContent = edgeThicknessValue.value;
edgeThicknessControl.append(
  "Edge line thickness",
  edgeThicknessSlider,
  edgeThicknessValue,
);

const smoothEdgesControl = document.createElement("label");
const smoothEdgesToggle = document.createElement("input");
smoothEdgesToggle.type = "checkbox";
smoothEdgesToggle.checked = true;
smoothEdgesControl.append(smoothEdgesToggle, "Show smooth edges");

const status = document.createElement("p");
status.className = "status";
status.setAttribute("aria-live", "polite");
status.textContent = "Choose a STEP file to display.";

const selectionStatus = document.createElement("p");
selectionStatus.className = "status";
selectionStatus.setAttribute("aria-live", "polite");
selectionStatus.textContent = "0 faces selected";

const viewport = document.createElement("div");
viewport.className = "viewport";

app.append(
  heading,
  fileInput,
  fitButton,
  projectionSelect,
  lightingControl,
  opacityControl,
  edgeThicknessControl,
  smoothEdgesControl,
  status,
  selectionStatus,
  viewport,
);

const session = new ModelSession();
const commandManager = new CommandManager();
const selection = new SelectionModel();
const renderer = createStepRenderer(viewport, (faceIndex) => {
  if (faceIndex === undefined) selection.clear();
  else selection.toggle(faceIndex);
});
selection.subscribe((selectedFaceIndices) => {
  renderer.setSelectedFaces(selectedFaceIndices);
  const count = selectedFaceIndices.length;
  selectionStatus.textContent = `${count} face${count === 1 ? "" : "s"} selected`;
});

fitButton.addEventListener("click", renderer.fitToView);
projectionSelect.addEventListener("change", () => {
  const projection: CameraProjection =
    projectionSelect.value === "perspective" ? "perspective" : "orthographic";
  renderer.setProjection(projection);
});
lightingToggle.addEventListener("change", () => {
  renderer.setShadingMode(lightingToggle.checked ? "original" : "flat");
});
opacitySlider.addEventListener("input", () => {
  renderer.setOpacity(Number(opacitySlider.value));
  opacityValue.value = `${Math.round(Number(opacitySlider.value) * 100)}%`;
  opacityValue.textContent = opacityValue.value;
});
edgeThicknessSlider.addEventListener("input", () => {
  const thickness = Number(edgeThicknessSlider.value);
  renderer.setEdgeThickness(thickness);
  edgeThicknessValue.value = `${thickness} px`;
  edgeThicknessValue.textContent = edgeThicknessValue.value;
});
smoothEdgesToggle.addEventListener("change", () => {
  renderer.setShowSmoothEdges(smoothEdgesToggle.checked);
});

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file) return;

  await loadModel(file.name, () => file.arrayBuffer());
  fileInput.value = "";
});

async function loadModel(name: string, readData: () => Promise<ArrayBuffer>): Promise<void> {
  fileInput.disabled = true;
  status.textContent = `Loading ${name}…`;

  try {
    await session.load(await readData());
    const meshes = session.tessellation;
    selection.clear();
    renderer.renderMeshes(meshes);
    fitButton.disabled = false;
    status.textContent =
      `${name} — ${session.bodyCount} bodies, ${session.faceCount} faces`;
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "The STEP file could not be loaded.";
  } finally {
    fileInput.disabled = false;
  }
}

void loadModel("GDT_Hole_Str.step", async () => {
  const response = await fetch(new URL("./GDT_Hole_Str.step", import.meta.url));
  if (!response.ok) {
    throw new Error("The default STEP file could not be loaded.");
  }
  return response.arrayBuffer();
});
