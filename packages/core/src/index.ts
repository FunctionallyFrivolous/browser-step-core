import {
  LibcascadeKernel,
  type CadKernel,
  type TriangleMesh,
} from "@browser-step/kernel";

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
