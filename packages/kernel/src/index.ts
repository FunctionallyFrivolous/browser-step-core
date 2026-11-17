export interface CadKernel {
  initialize(): Promise<void>;
}

export class LibcascadeKernel implements CadKernel {
  async initialize(): Promise<void> {}
}
