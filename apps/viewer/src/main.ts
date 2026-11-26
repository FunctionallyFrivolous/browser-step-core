import {
  CommandManager,
  ModelSession,
  SelectionModel,
  StyleStateModel,
  ViewStateModel,
} from "@browser-step/core";
import {
  alignViewToNormal,
  createStepRenderer,
  type CameraProjection,
  type OrbitMode,
  type SelectionScope,
} from "@browser-step/renderer";
import { defaultSample, sampleModels } from "@browser-step/samples";

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

const snapViewButton = document.createElement("button");
snapViewButton.type = "button";
snapViewButton.textContent = "Snap View";
snapViewButton.setAttribute("aria-pressed", "false");
snapViewButton.disabled = true;

const saveViewButton = document.createElement("button");
saveViewButton.type = "button";
saveViewButton.textContent = "Save View";
saveViewButton.disabled = true;

const revertViewButton = document.createElement("button");
revertViewButton.type = "button";
revertViewButton.textContent = "Revert to Saved View";
revertViewButton.disabled = true;

const hideBodiesButton = document.createElement("button");
hideBodiesButton.type = "button";
hideBodiesButton.textContent = "Hide Bodies";
hideBodiesButton.disabled = true;

const projectionSelect = document.createElement("select");
projectionSelect.setAttribute("aria-label", "Camera projection");
for (const projection of ["orthographic", "perspective"] as const) {
  const option = document.createElement("option");
  option.value = projection;
  option.textContent = `${projection[0].toUpperCase()}${projection.slice(1)}`;
  projectionSelect.append(option);
}
projectionSelect.value = "orthographic";

const orbitModeControl = document.createElement("label");
const freeOrbitToggle = document.createElement("input");
freeOrbitToggle.type = "checkbox";
freeOrbitToggle.setAttribute("aria-label", "Free orbit controls");
orbitModeControl.append(freeOrbitToggle, "Free Orbit");

const lightingControl = document.createElement("label");
const lightingToggle = document.createElement("input");
lightingToggle.type = "checkbox";
lightingControl.append(lightingToggle, "Model Shading");

const faceColorControl = document.createElement("label");
const faceColorInput = document.createElement("input");
faceColorInput.type = "color";
faceColorInput.setAttribute("aria-label", "Face color");
faceColorControl.append("Face color", faceColorInput);

const edgeColorControl = document.createElement("label");
const edgeColorInput = document.createElement("input");
edgeColorInput.type = "color";
edgeColorInput.value = "#000000";
edgeColorInput.setAttribute("aria-label", "Edge color");
edgeColorControl.append("Edge color", edgeColorInput);

const opacityControl = document.createElement("label");
const opacitySlider = document.createElement("input");
opacitySlider.type = "range";
opacitySlider.min = "0";
opacitySlider.max = "1";
opacitySlider.step = "0.01";
opacitySlider.value = "1";
opacitySlider.setAttribute("aria-label", "Model opacity");
const opacityValue = document.createElement("output");
opacityValue.value = "100%";
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

const edgeDashControl = document.createElement("label");
edgeDashControl.className = "edge-dash-control";
const edgeDashSlider = document.createElement("input");
edgeDashSlider.type = "range";
edgeDashSlider.min = "0";
edgeDashSlider.max = "20";
edgeDashSlider.step = "0.1";
edgeDashSlider.value = "0";
edgeDashSlider.setAttribute("aria-label", "Edge dash length");
const edgeDashValue = document.createElement("output");
edgeDashValue.value = "Solid";
edgeDashValue.textContent = edgeDashValue.value;
edgeDashControl.append("Edge dash length", edgeDashSlider, edgeDashValue);

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

const selectionScopeControl = document.createElement("fieldset");
const selectionScopeLegend = document.createElement("legend");
selectionScopeLegend.textContent = "Selection Scope";
selectionScopeControl.append(selectionScopeLegend);
for (const scope of ["object", "face", "edge"] as const) {
  const label = document.createElement("label");
  const input = document.createElement("input");
  input.type = "radio";
  input.name = "selection-scope";
  input.value = scope;
  input.checked = scope === "object";
  input.setAttribute("aria-label", scope === "object" ? "Body" : scope === "face" ? "Face" : "Edge");
  label.append(input, scope === "object" ? "Body" : scope === "face" ? "Face" : "Edge");
  selectionScopeControl.append(label);
}

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
  selectionScopeControl,
  hideBodiesButton,
  faceColorControl,
  edgeColorControl,
  opacityControl,
  edgeThicknessControl,
  edgeDashControl,
  projectionSelect,
  orbitModeControl,
  lightingControl,
  fitButton,
  snapViewButton,
  saveViewButton,
  revertViewButton,
  smoothEdgesControl,
);

app.append(viewer, controls);

const session = new ModelSession();
const commandManager = new CommandManager();
const selection = new SelectionModel();
const style = new StyleStateModel();
const view = new ViewStateModel();
let hasInitialSavedView = false;
let selectionScope: SelectionScope = "object";
const selectedEdgeIndices = new Set<number>();
const edgeThicknessOverrides = new Map<number, number>();
let globalEdgeThickness = Number(edgeThicknessSlider.value);
let globalEdgeDashSize = 0;
let bodyFaces = new Map<number, number[]>();
let hiddenBodies = new Set<number>();
let updatingViewFromRenderer = false;
let snappingView = false;
let planarNormals = new Map<number, [number, number, number]>();
const renderer = createStepRenderer(viewport, (faceIndex, bodyIndex, edgeIndex) => {
  if (snappingView) {
    const normal = faceIndex === undefined ? undefined : planarNormals.get(faceIndex);
    if (normal) {
      view.setState(alignViewToNormal(view.state, normal));
      setSnapViewMode(false);
    }
    return;
  }

  if (selectionScope === "edge") {
    if (edgeIndex === undefined) {
      clearSelection();
      return;
    } else if (selectedEdgeIndices.has(edgeIndex)) {
      selectedEdgeIndices.delete(edgeIndex);
    } else {
      selectedEdgeIndices.add(edgeIndex);
    }
    renderer.setSelectedEdges([...selectedEdgeIndices]);
    updateSelectionStatus();
    updateEdgeThicknessControl();
    updateEdgeDashControl();
    return;
  }

  if (faceIndex === undefined) {
    clearSelection();
  } else if (selectionScope === "object") {
    selection.toggleAll(bodyFaces.get(bodyIndex ?? faceIndex) ?? [faceIndex]);
  } else {
    selection.toggle(faceIndex);
  }
}, (state) => {
  updatingViewFromRenderer = true;
  try {
    view.setState(state);
  } finally {
    updatingViewFromRenderer = false;
  }
});

function setSnapViewMode(enabled: boolean): void {
  snappingView = enabled;
  renderer.setFacePickingOnly(enabled);
  snapViewButton.setAttribute("aria-pressed", String(enabled));
  snapViewButton.textContent = enabled ? "Cancel Snap View (select a planar face)" : "Snap View";
}

view.subscribe((state) => {
  projectionSelect.value = state.projection;
  if (!updatingViewFromRenderer) renderer.setViewState(state);
});
renderer.setViewState(view.state);
style.subscribe((state) => {
  renderer.setStyleState(state);
});
const initialStyle = style.state;
faceColorInput.value = `#${initialStyle.faceColor.toString(16).padStart(6, "0")}`;
opacitySlider.value = String(initialStyle.opacity);
opacityValue.value = `${Math.round(initialStyle.opacity * 100)}%`;
opacityValue.textContent = opacityValue.value;
renderer.setStyleState(initialStyle);
selection.subscribe((selectedFaceIndices) => {
  renderer.setSelectedFaces(selectedFaceIndices);
  updateSelectionStatus();
  updateEdgeThicknessControl();
  updateEdgeDashControl();
  updateBodyVisibilityControl();
});

function updateSelectionStatus(): void {
  const faceCount = selection.selectedFaces.length;
  const edgeCount = selectedEdgeIndices.size;
  if ((selectionScope === "edge" && faceCount > 0) ||
      (selectionScope !== "edge" && edgeCount > 0)) {
    selectionStatus.textContent = `${faceCount} face${faceCount === 1 ? "" : "s"}, ${edgeCount} edge${edgeCount === 1 ? "" : "s"} selected`;
    return;
  }
  if (selectionScope === "edge") {
    const count = edgeCount;
    selectionStatus.textContent = `${count} edge${count === 1 ? "" : "s"} selected`;
  } else {
    const count = faceCount;
    selectionStatus.textContent = `${count} face${count === 1 ? "" : "s"} selected`;
  }
}

function clearSelection(): void {
  selectedEdgeIndices.clear();
  renderer.setSelectedEdges([]);
  selection.clear();
  updateSelectionStatus();
  updateEdgeThicknessControl();
  updateEdgeDashControl();
}

function getEdgeDashTargets(): { faces: readonly number[]; edges: number[] } {
  return selectionScope === "edge"
    ? { faces: [], edges: [...selectedEdgeIndices] }
    : { faces: selection.selectedFaces, edges: [] };
}

function updateEdgeDashControl(): void {
  const { faces, edges } = getEdgeDashTargets();
  const size = renderer.getEdgeDashSize(faces, edges) ?? globalEdgeDashSize;
  edgeDashSlider.value = String(size);
  edgeDashValue.value = size === 0 ? "Solid" : `${size} units`;
  edgeDashValue.textContent = edgeDashValue.value;
}

function updateEdgeThicknessControl(): void {
  const targets = getSelectedEdgeIndices();
  const selectedThickness = (targets ?? [])
    .map((edgeIndex) => edgeThicknessOverrides.get(edgeIndex) ?? globalEdgeThickness)[0];
  const thickness = selectedThickness ?? globalEdgeThickness;
  edgeThicknessSlider.value = String(thickness);
  edgeThicknessValue.value = `${thickness} px`;
  edgeThicknessValue.textContent = edgeThicknessValue.value;
}

function getSelectedEdgeIndices(): number[] | undefined {
  if (selectionScope === "edge") {
    return selectedEdgeIndices.size > 0 ? [...selectedEdgeIndices] : undefined;
  }

  const selectedFaces = selection.selectedFaces;
  if (selectedFaces.length === 0) return undefined;
  const edgeIndices = renderer.getEdgeIndicesForFaces(selectedFaces);
  return edgeIndices.length > 0 ? edgeIndices : undefined;
}

function getSelectedBodyIndices(): number[] {
  const selectedFaces = new Set(selection.selectedFaces);
  return [...bodyFaces]
    .filter(([, faceIndices]) =>
      faceIndices.length > 0 &&
      faceIndices.every((faceIndex) => selectedFaces.has(faceIndex)),
    )
    .map(([bodyIndex]) => bodyIndex);
}

function updateBodyVisibilityControl(): void {
  const selectedBodies = getSelectedBodyIndices();
  const showAllBodies = selectedBodies.length === 0 && hiddenBodies.size > 0;
  hideBodiesButton.textContent = showAllBodies ? "Show All Bodies" : "Hide Bodies";
  hideBodiesButton.disabled = selectedBodies.length === 0 && !showAllBodies;
}

hideBodiesButton.addEventListener("click", () => {
  const selectedBodies = getSelectedBodyIndices();
  if (selectedBodies.length > 0) {
    for (const bodyIndex of selectedBodies) hiddenBodies.add(bodyIndex);
    renderer.setHiddenBodies([...hiddenBodies]);
    selection.clear();
  } else if (hiddenBodies.size > 0) {
    hiddenBodies.clear();
    renderer.setHiddenBodies([]);
  }
  updateBodyVisibilityControl();
});

selectionScopeControl.addEventListener("change", (event) => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || !input.checked) return;
  const previousScope = selectionScope;
  selectionScope = input.value === "object"
    ? "object"
    : input.value === "edge" ? "edge" : "face";
  if (previousScope === "face" && selectionScope === "edge") {
    for (const edgeIndex of renderer.getEdgeIndicesForFaces(selection.selectedFaces)) {
      selectedEdgeIndices.add(edgeIndex);
    }
    renderer.setSelectedEdges([...selectedEdgeIndices]);
  }
  renderer.setSelectionScope(selectionScope);
  updateSelectionStatus();
  updateEdgeThicknessControl();
  updateEdgeDashControl();
});

fitButton.addEventListener("click", renderer.fitToView);
snapViewButton.addEventListener("click", () => setSnapViewMode(!snappingView));
saveViewButton.addEventListener("click", () => view.saveBookmark("saved-view"));
revertViewButton.addEventListener("click", () => view.restoreBookmark("saved-view"));
projectionSelect.addEventListener("change", () => {
  const projection: CameraProjection =
    projectionSelect.value === "perspective" ? "perspective" : "orthographic";
  renderer.setProjection(projection);
});
freeOrbitToggle.addEventListener("change", () => {
  const mode: OrbitMode = freeOrbitToggle.checked ? "free" : "constrained";
  renderer.setOrbitMode(mode);
});
lightingToggle.addEventListener("change", () => {
  renderer.setShadingMode(lightingToggle.checked ? "original" : "flat");
});
faceColorInput.addEventListener("input", () => {
  const color = Number.parseInt(faceColorInput.value.slice(1), 16);
  const selectedFaces = selection.selectedFaces;
  renderer.setFaceColor(color, selectedFaces);
  if (selectedFaces.length === 0) {
    style.setState({ ...style.state, faceColor: color });
  }
});
edgeColorInput.addEventListener("input", () => {
  const color = Number.parseInt(edgeColorInput.value.slice(1), 16);
  renderer.setEdgeColor(color, selection.selectedFaces, [...selectedEdgeIndices]);
});
opacitySlider.addEventListener("input", () => {
  const opacity = Number(opacitySlider.value);
  const selectedFaces = selection.selectedFaces;
  renderer.setFaceOpacity(opacity, selectedFaces);
  opacityValue.value = `${Math.round(opacity * 100)}%`;
  opacityValue.textContent = opacityValue.value;
  if (selectedFaces.length === 0) {
    style.setState({ ...style.state, opacity });
  }
});
edgeThicknessSlider.addEventListener("input", () => {
  const thickness = Number(edgeThicknessSlider.value);
  const targetEdgeIndices = getSelectedEdgeIndices();
  renderer.setEdgeThickness(thickness, targetEdgeIndices);
  if (targetEdgeIndices) {
    for (const edgeIndex of targetEdgeIndices) {
      edgeThicknessOverrides.set(edgeIndex, thickness);
    }
  } else {
    globalEdgeThickness = thickness;
    edgeThicknessOverrides.clear();
    renderer.setEdgeThickness(thickness);
  }
  edgeThicknessValue.value = `${thickness} px`;
  edgeThicknessValue.textContent = edgeThicknessValue.value;
});
edgeDashSlider.addEventListener("input", () => {
  const size = Number(edgeDashSlider.value);
  const { faces, edges } = getEdgeDashTargets();
  renderer.setEdgeDashSize(size, faces, edges);
  if (faces.length === 0 && edges.length === 0) globalEdgeDashSize = size;
  updateEdgeDashControl();
});
smoothEdgesToggle.addEventListener("change", () => {
  renderer.setShowSmoothEdges(smoothEdgesToggle.checked);
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
    setSnapViewMode(false);
    planarNormals = new Map(
      meshes.flatMap((mesh) => mesh.planarNormal ? [[mesh.faceIndex, mesh.planarNormal] as const] : []),
    );
    selection.clear();
    selectedEdgeIndices.clear();
    edgeThicknessOverrides.clear();
    renderer.setSelectedEdges([]);
    updateSelectionStatus();
    bodyFaces = new Map();
    for (const mesh of meshes) {
      const bodyIndex = mesh.bodyIndex ?? mesh.faceIndex;
      const faces = bodyFaces.get(bodyIndex) ?? [];
      faces.push(mesh.faceIndex);
      bodyFaces.set(bodyIndex, faces);
    }
    hiddenBodies = new Set();
    updateBodyVisibilityControl();
    renderer.renderMeshes(meshes, style.state);
    updateEdgeDashControl();
    fitButton.disabled = false;
    snapViewButton.disabled = false;
    if (!hasInitialSavedView) {
      view.saveBookmark("saved-view");
      hasInitialSavedView = true;
      saveViewButton.disabled = false;
      revertViewButton.disabled = false;
    }
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

if (defaultSample) {
  sampleSelect.value = defaultSample.name;
  void loadSampleModel(defaultSample.name);
}
