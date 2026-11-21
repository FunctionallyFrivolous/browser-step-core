export interface CadKernel {
  initialize(): Promise<void>;
  loadStep(data: ArrayBuffer | Uint8Array): Promise<void>;
  getBodyCount(): number;
  getFaceCount(): number;
  getTessellation(): TriangleMesh[];
}

export interface TriangleMesh {
  positions: Float32Array;
  indices: Uint32Array;
  faceIndex: number;
  bodyIndex: number;
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

  getTessellation(): TriangleMesh[] {
    if (!this.oc || !this.shape) {
      throw new Error("No STEP geometry has been loaded.");
    }

    const oc = this.oc;
    const mesher = new oc.BRepMesh_IncrementalMesh(this.shape, 0.1, false, 0.5, true);
    const meshes: TriangleMesh[] = [];

    try {
      const bodyIndices: number[] = [];
      const solidExplorer = new oc.TopExp_Explorer(
        this.shape,
        oc.TopAbs_ShapeEnum.TopAbs_SOLID,
      );

      try {
        let bodyIndex = 0;
        while (solidExplorer.More()) {
          const current = solidExplorer.Current();

          try {
            const solid = oc.TopoDS.Solid(current);
            try {
              const faceExplorer = new oc.TopExp_Explorer(
                solid,
                oc.TopAbs_ShapeEnum.TopAbs_FACE,
              );

              try {
                while (faceExplorer.More()) {
                  bodyIndices.push(bodyIndex);
                  faceExplorer.Next();
                }
              } finally {
                faceExplorer.delete();
              }
            } finally {
              solid.delete();
            }
          } finally {
            current.delete();
          }

          bodyIndex += 1;
          solidExplorer.Next();
        }
      } finally {
        solidExplorer.delete();
      }

      const explorer = new oc.TopExp_Explorer(this.shape, oc.TopAbs_ShapeEnum.TopAbs_FACE);

      try {
        let faceIndex = 0;
        while (explorer.More()) {
          const current = explorer.Current();

          try {
            const face = oc.TopoDS.Face(current);
            const location = new oc.TopLoc_Location();

            try {
              const triangulation = oc.BRep_Tool.Triangulation(face, location, 0);

              try {
                if (triangulation && triangulation.NbNodes() > 0) {
                  const transform = location.Transformation();
                  const positions: number[] = [];
                  const indices: number[] = [];

                  try {
                    for (
                      let nodeIndex = 1;
                      nodeIndex <= triangulation.NbNodes();
                      nodeIndex += 1
                    ) {
                      const point = triangulation.Node(nodeIndex);
                      try {
                        point.Transform(transform);
                        positions.push(point.X(), point.Y(), point.Z());
                      } finally {
                        point.delete();
                      }
                    }

                    const reversed =
                      face.Orientation() === oc.TopAbs_Orientation.TopAbs_REVERSED;

                    for (
                      let triangleIndex = 1;
                      triangleIndex <= triangulation.NbTriangles();
                      triangleIndex += 1
                    ) {
                      const triangle = triangulation.Triangle(triangleIndex);
                      try {
                        const { theN1, theN2, theN3 } = triangle.Get();
                        indices.push(
                          theN1 - 1,
                          (reversed ? theN3 : theN2) - 1,
                          (reversed ? theN2 : theN3) - 1,
                        );
                      } finally {
                        triangle.delete();
                      }
                    }
                  } finally {
                    transform.delete();
                  }

                  if (indices.length > 0) {
                    meshes.push({
                      positions: new Float32Array(positions),
                      indices: new Uint32Array(indices),
                      faceIndex,
                      bodyIndex: bodyIndices[faceIndex] ?? this.bodyCount,
                    });
                  }
                }
              } finally {
                triangulation?.delete();
              }

              faceIndex += 1;
            } finally {
              location.delete();
              face.delete();
            }
          } finally {
            current.delete();
          }

          explorer.Next();
        }
      } finally {
        explorer.delete();
      }
    } finally {
      mesher.delete();
    }

    return meshes;
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
