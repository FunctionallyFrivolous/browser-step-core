import {
  LibcascadeKernel,
  type CadKernel,
  type TriangleMesh,
} from "@browser-step/kernel";

export interface Command {
  execute(): void | Promise<void>;
  undo(): void | Promise<void>;
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
