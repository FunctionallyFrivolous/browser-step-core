import {
  CommandManager,
  ModelSession,
  SelectionModel,
  StyleStateModel,
  ViewStateModel,
} from "@browser-step/core";
import {
  createStepRenderer,
  type CameraProjection,
  type DepthRenderSettings,
} from "@browser-step/renderer";
import { sampleModels } from "@browser-step/samples";

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("Viewer root element was not found.");
}

function createDepthToggle(label: string, ariaLabel: string, checked: boolean) {
  const control = document.createElement("label");
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = checked;
  input.setAttribute("aria-label", ariaLabel);
  control.append(input, label);
  return { control, input };
}

function createRenderOrderControl(ariaLabel: string, value: number) {
  const control = document.createElement("label");
  const input = document.createElement("input");
  input.type = "number";
  input.step = "1";
  input.value = String(value);
  input.setAttribute("aria-label", ariaLabel);
  control.append(ariaLabel, input);
  return { control, input };
}

const heading = document.createElement("h1");
heading.textContent = "STEP Model Viewer";

const fileInput = document.createElement("input");
fileInput.type = "file";
fileInput.accept = ".step,.stp";
fileInput.setAttribute("aria-label", "Load a STEP file");

const sampleSelect = document.createElement("select");
sampleSelect.setAttribute("aria-label", "Sample model");
const samplePlaceholder = document.createElement("option");
samplePlaceholder.value = "";
samplePlaceholder.textContent = "Select a sample model…";
sampleSelect.append(samplePlaceholder);
for (const sample of sampleModels) {
  const option = document.createElement("option");
  option.value = sample.name;
  option.textContent = sample.name;
  sampleSelect.append(option);
}

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
lightingControl.append(lightingToggle, "Model Shading");

const faceColorControl = document.createElement("label");
const faceColorInput = document.createElement("input");
faceColorInput.type = "color";
faceColorInput.setAttribute("aria-label", "Face color");
faceColorControl.append("Face color", faceColorInput);

const visibilityControl = document.createElement("label");
const visibilityToggle = document.createElement("input");
visibilityToggle.type = "checkbox";
visibilityToggle.checked = true;
visibilityControl.append(visibilityToggle, "Show model");

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

let depthRenderSettings: DepthRenderSettings = {
  faceDepthWrite: undefined,
  faceDepthTest: true,
  faceRenderOrder: 0,
  edgeDepthWrite: false,
  edgeDepthTest: true,
  edgeRenderOrder: 1,
};
const faceDepthWrite = createDepthToggle("Face depth write", "Face depth write", false);
const faceDepthTest = createDepthToggle("Face depth test", "Face depth test", true);
const faceRenderOrder = createRenderOrderControl("Face render order", 0);
const edgeDepthWrite = createDepthToggle("Edge depth write", "Edge depth write", false);
const edgeDepthTest = createDepthToggle("Edge depth test", "Edge depth test", true);
const edgeRenderOrder = createRenderOrderControl("Edge render order", 1);

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

const viewer = document.createElement("section");
viewer.className = "viewer";
viewer.append(heading, status, selectionStatus, viewport);

const controls = document.createElement("section");
controls.className = "controls";
controls.append(
  fileInput,
  sampleSelect,
  fitButton,
  projectionSelect,
  lightingControl,
  faceColorControl,
  visibilityControl,
  opacityControl,
  edgeThicknessControl,
  smoothEdgesControl,
  faceDepthWrite.control,
  faceDepthTest.control,
  faceRenderOrder.control,
  edgeDepthWrite.control,
  edgeDepthTest.control,
  edgeRenderOrder.control,
);

app.append(viewer, controls);

const session = new ModelSession();
const commandManager = new CommandManager();
const selection = new SelectionModel();
const style = new StyleStateModel();
const view = new ViewStateModel();
let updatingViewFromRenderer = false;
const renderer = createStepRenderer(viewport, (faceIndex) => {
  if (faceIndex === undefined) selection.clear();
  else selection.toggle(faceIndex);
}, (state) => {
  updatingViewFromRenderer = true;
  try {
    view.setState(state);
  } finally {
    updatingViewFromRenderer = false;
  }
});
renderer.setDepthRenderSettings(depthRenderSettings);
view.subscribe((state) => {
  projectionSelect.value = state.projection;
  if (!updatingViewFromRenderer) renderer.setViewState(state);
});
renderer.setViewState(view.state);
style.subscribe((state) => {
  faceColorInput.value = `#${state.faceColor.toString(16).padStart(6, "0")}`;
  opacitySlider.value = String(state.opacity);
  opacityValue.value = `${Math.round(state.opacity * 100)}%`;
  opacityValue.textContent = opacityValue.value;
  visibilityToggle.checked = state.visible;
  renderer.setStyleState(state);
  if (depthRenderSettings.faceDepthWrite === undefined) {
    faceDepthWrite.input.checked = state.opacity >= 1;
  }
});
const initialStyle = style.state;
faceColorInput.value = `#${initialStyle.faceColor.toString(16).padStart(6, "0")}`;
opacitySlider.value = String(initialStyle.opacity);
opacityValue.value = `${Math.round(initialStyle.opacity * 100)}%`;
opacityValue.textContent = opacityValue.value;
renderer.setStyleState(initialStyle);
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
faceColorInput.addEventListener("input", () => {
  style.setState({
    ...style.state,
    faceColor: Number.parseInt(faceColorInput.value.slice(1), 16),
  });
});
visibilityToggle.addEventListener("change", () => {
  style.setState({ ...style.state, visible: visibilityToggle.checked });
});
opacitySlider.addEventListener("input", () => {
  style.setState({ ...style.state, opacity: Number(opacitySlider.value) });
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
faceDepthWrite.input.addEventListener("change", () => {
  depthRenderSettings = {
    ...depthRenderSettings,
    faceDepthWrite: faceDepthWrite.input.checked,
  };
  renderer.setDepthRenderSettings(depthRenderSettings);
});
faceDepthTest.input.addEventListener("change", () => {
  depthRenderSettings = {
    ...depthRenderSettings,
    faceDepthTest: faceDepthTest.input.checked,
  };
  renderer.setDepthRenderSettings(depthRenderSettings);
});
edgeDepthWrite.input.addEventListener("change", () => {
  depthRenderSettings = {
    ...depthRenderSettings,
    edgeDepthWrite: edgeDepthWrite.input.checked,
  };
  renderer.setDepthRenderSettings(depthRenderSettings);
});
edgeDepthTest.input.addEventListener("change", () => {
  depthRenderSettings = {
    ...depthRenderSettings,
    edgeDepthTest: edgeDepthTest.input.checked,
  };
  renderer.setDepthRenderSettings(depthRenderSettings);
});
function updateRenderOrder(input: HTMLInputElement, face: boolean): void {
  const nextOrder = input.valueAsNumber;
  const otherOrder = face
    ? depthRenderSettings.edgeRenderOrder
    : depthRenderSettings.faceRenderOrder;
  if (!input.validity.valid || !Number.isInteger(nextOrder) || nextOrder === otherOrder) {
    input.value = String(
      face
        ? depthRenderSettings.faceRenderOrder
        : depthRenderSettings.edgeRenderOrder,
    );
    return;
  }
  depthRenderSettings = face
    ? { ...depthRenderSettings, faceRenderOrder: nextOrder }
    : { ...depthRenderSettings, edgeRenderOrder: nextOrder };
  renderer.setDepthRenderSettings(depthRenderSettings);
}
faceRenderOrder.input.addEventListener("change", () => {
  updateRenderOrder(faceRenderOrder.input, true);
});
edgeRenderOrder.input.addEventListener("change", () => {
  updateRenderOrder(edgeRenderOrder.input, false);
});

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file) return;

  sampleSelect.value = "";
  await loadModel(file.name, () => file.arrayBuffer());
  fileInput.value = "";
});

sampleSelect.addEventListener("change", () => {
  const sample = sampleModels.find(({ name }) => name === sampleSelect.value);
  if (sample) void loadSampleModel(sample.name);
});

async function loadModel(name: string, readData: () => Promise<ArrayBuffer>): Promise<void> {
  fileInput.disabled = true;
  sampleSelect.disabled = true;
  status.textContent = `Loading ${name}…`;

  try {
    await session.load(await readData());
    const meshes = session.tessellation;
    selection.clear();
    renderer.renderMeshes(meshes, style.state);
    fitButton.disabled = false;
    status.textContent =
      `${name} — ${session.bodyCount} bodies, ${session.faceCount} faces`;
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "The STEP file could not be loaded.";
  } finally {
    fileInput.disabled = false;
    sampleSelect.disabled = false;
  }
}

async function loadSampleModel(name: string): Promise<void> {
  const sample = sampleModels.find((model) => model.name === name);
  if (!sample) return;

  await loadModel(sample.name, async () => {
    const response = await fetch(sample.url);
    if (!response.ok) {
      throw new Error(`The sample model ${sample.name} could not be loaded.`);
    }
    return response.arrayBuffer();
  });
}

const defaultSample = sampleModels[0];
if (defaultSample) {
  sampleSelect.value = defaultSample.name;
  void loadSampleModel(defaultSample.name);
}
