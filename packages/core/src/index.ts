import {
  LibcascadeKernel,
  type CadKernel,
  type TriangleMesh,
} from "@browser-step/kernel";

export interface Command {
  execute(): void | Promise<void>;
  undo(): void | Promise<void>;
}

export type CameraProjection = "orthographic" | "perspective";

export interface ViewState {
  projection: CameraProjection;
  position: [number, number, number];
  target: [number, number, number];
  verticalSpan: number;
  near: number;
  far: number;
}

function copyViewState(state: ViewState): ViewState {
  return { ...state, position: [...state.position], target: [...state.target] };
}

function validateViewState(state: ViewState): void {
  if (
    (state.projection !== "orthographic" && state.projection !== "perspective") ||
    state.position.length !== 3 ||
    state.target.length !== 3 ||
    ![...state.position, ...state.target, state.verticalSpan, state.near, state.far].every(Number.isFinite) ||
    state.verticalSpan <= 0 ||
    state.near <= 0 ||
    state.far <= state.near
  ) {
    throw new Error("Invalid camera view state.");
  }
}

export class ViewStateModel {
  private current: ViewState;
  private readonly saved = new Map<string, ViewState>();
  private readonly listeners = new Set<(state: ViewState) => void>();

  constructor(initial: ViewState = {
    projection: "orthographic",
    position: [1.8, 1.8, 2.4],
    target: [0, 0, 0],
    verticalSpan: 2,
    near: 0.01,
    far: 100000,
  }) {
    validateViewState(initial);
    this.current = copyViewState(initial);
  }

  get state(): ViewState {
    return copyViewState(this.current);
  }

  get bookmarks(): string[] {
    return [...this.saved.keys()];
  }

  setState(state: ViewState): void {
    validateViewState(state);
    const previous = this.current;
    if (
      state.projection === previous.projection &&
      state.verticalSpan === previous.verticalSpan &&
      state.near === previous.near &&
      state.far === previous.far &&
      state.position.every((value, index) => value === previous.position[index]) &&
      state.target.every((value, index) => value === previous.target[index])
    ) return;

    this.current = copyViewState(state);
    for (const listener of this.listeners) listener(this.state);
  }

  saveBookmark(name: string): void {
    this.saved.set(name, this.state);
  }

  restoreBookmark(name: string): boolean {
    const state = this.saved.get(name);
    if (!state) return false;
    this.setState(state);
    return true;
  }

  deleteBookmark(name: string): boolean {
    return this.saved.delete(name);
  }

  subscribe(listener: (state: ViewState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export class SelectionModel {
  private readonly faces = new Set<number>();
  private readonly listeners = new Set<(faces: number[]) => void>();

  get selectedFaces(): number[] {
    return [...this.faces];
  }

  select(faceIndex: number): void {
    if (this.faces.has(faceIndex)) return;
    this.faces.add(faceIndex);
    this.notify();
  }

  deselect(faceIndex: number): void {
    if (!this.faces.delete(faceIndex)) return;
    this.notify();
  }

  toggle(faceIndex: number): void {
    if (this.faces.has(faceIndex)) {
      this.deselect(faceIndex);
    } else {
      this.select(faceIndex);
    }
  }

  clear(): void {
    if (this.faces.size === 0) return;
    this.faces.clear();
    this.notify();
  }

  subscribe(listener: (faces: number[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    const faces = this.selectedFaces;
    for (const listener of this.listeners) listener([...faces]);
  }
}

export class CommandManager {
  private readonly undoStack: Command[] = [];
  private readonly redoStack: Command[] = [];
  private operationInProgress = false;

  async execute(command: Command): Promise<void> {
    await this.runExclusive(async () => {
      await command.execute();
      this.undoStack.push(command);
      this.redoStack.length = 0;
    });
  }

  async undo(): Promise<boolean> {
    return this.runExclusive(async () => {
      const command = this.undoStack.at(-1);
      if (!command) return false;

      await command.undo();
      this.undoStack.pop();
      this.redoStack.push(command);
      return true;
    });
  }

  async redo(): Promise<boolean> {
    return this.runExclusive(async () => {
      const command = this.redoStack.at(-1);
      if (!command) return false;

      await command.execute();
      this.redoStack.pop();
      this.undoStack.push(command);
      return true;
    });
  }

  private async runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    if (this.operationInProgress) {
      throw new Error("A command operation is already in progress.");
    }

    this.operationInProgress = true;
    try {
      return await operation();
    } finally {
      this.operationInProgress = false;
    }
  }
}

export class ModelSession {
  private modelRevision = 0;
  private readonly kernel: CadKernel;

  constructor(kernel: CadKernel = new LibcascadeKernel()) {
    this.kernel = kernel;
  }

  async load(data: ArrayBuffer | Uint8Array): Promise<void> {
    await this.kernel.loadStep(data);
    this.modelRevision += 1;
  }

  get bodyCount(): number {
    return this.kernel.getBodyCount();
  }

  get faceCount(): number {
    return this.kernel.getFaceCount();
  }

  get tessellation(): TriangleMesh[] {
    return this.kernel.getTessellation();
  }

  get revisionId(): number {
    return this.modelRevision;
  }
}
