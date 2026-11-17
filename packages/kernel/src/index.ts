export interface CadKernel {
  initialize(): Promise<void>;
  loadStep(data: ArrayBuffer | Uint8Array): Promise<void>;
  getBodyCount(): number;
  getFaceCount(): number;
}

export class LibcascadeKernel implements CadKernel {
  private initialization?: Promise<void>;
  private oc?: import("libcascade/single/init").OpenCascadeInstance;
  private shape?: import("libcascade/single/init").TopoDS_Shape;
  private bodyCount = 0;
  private faceCount = 0;

  async initialize(): Promise<void> {
    if (!this.initialization) {
      this.initialization = (async () => {
        const { createInstance } = await import("libcascade/single/init");
        const oc =
          typeof window === "undefined"
            ? await createInstance()
            : await import("libcascade/single/wasm?url").then(({ default: wasmUrl }) =>
                createInstance({ locateFile: () => wasmUrl }),
              );

        this.oc = oc;
      })().catch((error: unknown) => {
        this.initialization = undefined;
        throw error;
      });
    }

    await this.initialization;
  }

  async loadStep(data: ArrayBuffer | Uint8Array): Promise<void> {
    await this.initialize();

    const oc = this.oc!;
    const filePath = "/model.step";
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    const reader = new oc.STEPControl_Reader();

    try {
      oc.FS.writeFile(filePath, bytes);

      if (reader.ReadFile(filePath) !== oc.IFSelect_ReturnStatus.IFSelect_RetDone) {
        throw new Error("The STEP file could not be read.");
      }

      reader.TransferRoots();
      if (reader.NbShapes() === 0) {
        throw new Error("The STEP file does not contain any transferable shapes.");
      }

      const shape = reader.OneShape();
      if (shape.IsNull()) {
        throw new Error("The STEP file does not contain a valid shape.");
      }

      const bodyCount = this.countSubshapes(shape, oc.TopAbs_ShapeEnum.TopAbs_SOLID);
      const faceCount = this.countSubshapes(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE);

      this.shape?.Nullify();
      this.shape = shape;
      this.bodyCount = bodyCount;
      this.faceCount = faceCount;
    } finally {
      reader.delete();
      oc.FS.unlink(filePath);
    }
  }

  getBodyCount(): number {
    return this.bodyCount;
  }

  getFaceCount(): number {
    return this.faceCount;
  }

  private countSubshapes(
    shape: import("libcascade/single/init").TopoDS_Shape,
    type: import("libcascade/single/init").TopAbs_ShapeEnum,
  ): number {
    const explorer = new this.oc!.TopExp_Explorer(shape, type);
    let count = 0;

    try {
      while (explorer.More()) {
        count += 1;
        explorer.Next();
      }
    } finally {
      explorer.delete();
    }

    return count;
  }
}
