import type {
  OpenCascadeInstance, TopoDS_Edge, TopoDS_Face, TopoDS_Shape,
} from "libcascade/single/init";

type Vec = [number, number, number];
type Incident = { index: number; edge: TopoDS_Edge };
const angularTolerance = 1e-5;

function parallel(a: Vec, b: Vec): boolean {
  const al = Math.hypot(...a);
  const bl = Math.hypot(...b);
  if (!Number.isFinite(al) || !Number.isFinite(bl) || al < 1e-14 || bl < 1e-14) return false;
  const [x, y, z] = a.map((v) => v / al);
  const [u, v, w] = b.map((n) => n / bl);
  return Math.hypot(y * w - z * v, z * u - x * w, x * v - y * u) <= angularTolerance;
}

export function component(start: number, graph: number[][]): number[] {
  if (!Number.isInteger(start) || start < 0 || start >= graph.length) {
    throw new RangeError("Topology index out of range.");
  }
  const found = new Set([start]);
  const pending = [start];
  for (let i = 0; i < pending.length; i++) {
    for (const neighbor of graph[pending[i]]) {
      if (!found.has(neighbor)) {
        found.add(neighbor);
        pending.push(neighbor);
      }
    }
  }
  return [...found].sort((a, b) => a - b);
}

function connect(graph: number[][], a: number, b: number): void {
  if (a !== b) {
    graph[a].push(b);
    graph[b].push(a);
  }
}

function facePairTangent(
  oc: OpenCascadeInstance, a: Incident, b: Incident, faces: TopoDS_Face[],
): boolean {
  if (oc.BRep_Tool.Degenerated(a.edge)) return false;
  let c1: InstanceType<OpenCascadeInstance["BRepAdaptor_Curve2d"]> | undefined;
  let c2: InstanceType<OpenCascadeInstance["BRepAdaptor_Curve2d"]> | undefined;
  let s1: InstanceType<OpenCascadeInstance["BRepAdaptor_Surface"]> | undefined;
  let s2: InstanceType<OpenCascadeInstance["BRepAdaptor_Surface"]> | undefined;
  try {
    if (!oc.BRep_Tool.SameParameter(a.edge)) return false;
    c1 = new oc.BRepAdaptor_Curve2d(a.edge, faces[a.index]);
    c2 = new oc.BRepAdaptor_Curve2d(b.edge, faces[b.index]);
    s1 = new oc.BRepAdaptor_Surface(faces[a.index]);
    s2 = new oc.BRepAdaptor_Surface(faces[b.index]);
    const first = c1.FirstParameter(), last = c1.LastParameter();
    const first2 = c2.FirstParameter(), last2 = c2.LastParameter();
    const scale = Math.max(1, Math.abs(first), Math.abs(last));
    if (![first, last, first2, last2].every(Number.isFinite) || last <= first ||
        Math.abs(first - first2) > 1e-9 * scale || Math.abs(last - last2) > 1e-9 * scale) return false;
    const tolerance = Math.max(oc.BRep_Tool.Tolerance(a.edge),
      oc.BRep_Tool.Tolerance(faces[a.index]), oc.BRep_Tool.Tolerance(faces[b.index]), 1e-7);
    for (let i = 0; i <= 20; i++) {
      const fraction = 0.01 + 0.98 * i / 20;
      const parameter = first + (last - first) * fraction;
      const uv1 = c1.Value(parameter);
      try {
        const uv2 = c2.Value(parameter);
        try {
          const p1 = surfaceSample(oc, s1, uv1.X(), uv1.Y());
          const p2 = surfaceSample(oc, s2, uv2.X(), uv2.Y());
          if (Math.hypot(...p1.point.map((v, n) => v - p2.point[n])) > 2 * tolerance ||
              !parallel(p1.normal, p2.normal)) return false;
        } finally { uv2.delete(); }
      } finally { uv1.delete(); }
    }
    return true;
  } catch {
    // Missing pcurves or singular/undefined derivatives cannot establish tangency.
    return false;
  } finally {
    s2?.delete(); s1?.delete(); c2?.delete(); c1?.delete();
  }
}

function surfaceSample(
  oc: OpenCascadeInstance, surface: InstanceType<OpenCascadeInstance["BRepAdaptor_Surface"]>,
  u: number, v: number,
): { point: Vec; normal: Vec } {
  const p = new oc.gp_Pnt();
  const du = new oc.gp_Vec();
  const dv = new oc.gp_Vec();
  try {
    surface.D1(u, v, p, du, dv);
    return { point: [p.X(), p.Y(), p.Z()], normal: [
      du.Y() * dv.Z() - du.Z() * dv.Y(),
      du.Z() * dv.X() - du.X() * dv.Z(),
      du.X() * dv.Y() - du.Y() * dv.X(),
    ] };
  } finally { dv.delete(); du.delete(); p.delete(); }
}

export function tangentFaces(oc: OpenCascadeInstance, shape: TopoDS_Shape): number[][] {
  const map = new oc.NCollection_IndexedMap_TopoDS_Shape_TopTools_ShapeMapHasher();
  try {
    oc.TopExp.MapShapes(shape, oc.TopAbs_ShapeEnum.TopAbs_EDGE, map);
    let needsNormalization = false;
    for (let i = 1; i <= map.Extent(); i++) {
      const key = map.FindKey(i);
      try {
        const edge = oc.TopoDS.Edge(key);
        try { if (!oc.BRep_Tool.SameParameter(edge)) needsNormalization = true; }
        finally { edge.delete(); }
      } finally { key.delete(); }
    }
    if (!needsNormalization) return buildFaceGraph(oc, shape);

    // Copy the entire topology so pcurve surface references remain paired with
    // their copied faces; normalization must never alter the authoritative BRep.
    try {
      const copier = new oc.BRepBuilderAPI_Copy(shape, true, false);
      try {
        const copy = copier.Shape();
        try {
          oc.BRepLib.SameParameter(copy, 1e-7, false);
          verifyFaceOrder(oc, shape, copy, copier);
          return buildFaceGraph(oc, copy);
        } finally { copy.delete(); }
      } finally { copier.delete(); }
    } catch {
      // Unsupported or failed repairs are excluded by buildFaceGraph.
      return buildFaceGraph(oc, shape);
    }
  } finally { map.delete(); }
}

function verifyFaceOrder(
  oc: OpenCascadeInstance, original: TopoDS_Shape, copy: TopoDS_Shape,
  copier: InstanceType<OpenCascadeInstance["BRepBuilderAPI_Copy"]>,
): void {
  const a = new oc.TopExp_Explorer(original, oc.TopAbs_ShapeEnum.TopAbs_FACE);
  const b = new oc.TopExp_Explorer(copy, oc.TopAbs_ShapeEnum.TopAbs_FACE);
  try {
    while (a.More() && b.More()) {
      const source = a.Current(), target = b.Current();
      try {
        const mapped = copier.ModifiedShape(source);
        try {
          if (!mapped.IsSame(target)) throw new Error("Copied face traversal order changed.");
        } finally { mapped.delete(); }
      } finally { target.delete(); source.delete(); }
      a.Next(); b.Next();
    }
    if (a.More() || b.More()) throw new Error("Copied face traversal count changed.");
  } finally { b.delete(); a.delete(); }
}

function buildFaceGraph(oc: OpenCascadeInstance, shape: TopoDS_Shape): number[][] {
  const edgeMap = new oc.NCollection_IndexedMap_TopoDS_Shape_TopTools_ShapeMapHasher();
  const faces: TopoDS_Face[] = [];
  const incidents: Incident[][] = [];
  try {
    oc.TopExp.MapShapes(shape, oc.TopAbs_ShapeEnum.TopAbs_EDGE, edgeMap);
    const explorer = new oc.TopExp_Explorer(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE);
    try {
      while (explorer.More()) {
        const current = explorer.Current();
        try { faces.push(oc.TopoDS.Face(current)); } finally { current.delete(); }
        const index = faces.length - 1;
        const edges = new oc.TopExp_Explorer(faces[index], oc.TopAbs_ShapeEnum.TopAbs_EDGE);
        try {
          while (edges.More()) {
            const edgeShape = edges.Current();
            try {
              const edgeIndex = edgeMap.FindIndex(edgeShape) - 1;
              if (edgeIndex >= 0) {
                (incidents[edgeIndex] ??= []).push({ index, edge: oc.TopoDS.Edge(edgeShape) });
              }
            } finally { edgeShape.delete(); }
            edges.Next();
          }
        } finally { edges.delete(); }
        explorer.Next();
      }
    } finally { explorer.delete(); }
    const graph = faces.map(() => [] as number[]);
    for (const group of incidents) {
      if (!group) continue;
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          if (group[i].index !== group[j].index && facePairTangent(oc, group[i], group[j], faces)) {
            connect(graph, group[i].index, group[j].index);
          }
        }
      }
    }
    return graph;
  } finally {
    for (const group of incidents) for (const incident of group ?? []) incident.edge.delete();
    for (const face of faces) face.delete();
    edgeMap.delete();
  }
}

type Endpoint = { index: number; tangent: Vec | undefined };

function edgeTangent(oc: OpenCascadeInstance, edge: TopoDS_Edge, first: boolean): Vec | undefined {
  if (oc.BRep_Tool.Degenerated(edge)) return undefined;
  let curve: InstanceType<OpenCascadeInstance["BRepAdaptor_Curve"]> | undefined;
  try {
    curve = new oc.BRepAdaptor_Curve(edge);
    const parameter = first ? curve.FirstParameter() : curve.LastParameter();
    if (!Number.isFinite(parameter)) return undefined;
    const p = new oc.gp_Pnt();
    const v = new oc.gp_Vec();
    try {
      curve.D1(parameter, p, v);
      return [v.X(), v.Y(), v.Z()];
    } finally { v.delete(); p.delete(); }
  } catch {
    return undefined;
  } finally { curve?.delete(); }
}

export function tangentEdges(oc: OpenCascadeInstance, shape: TopoDS_Shape): number[][] {
  const edgeMap = new oc.NCollection_IndexedMap_TopoDS_Shape_TopTools_ShapeMapHasher();
  const vertexMap = new oc.NCollection_IndexedMap_TopoDS_Shape_TopTools_ShapeMapHasher();
  try {
    oc.TopExp.MapShapes(shape, oc.TopAbs_ShapeEnum.TopAbs_EDGE, edgeMap);
    const groups: Endpoint[][] = [];
    const graph = Array.from({ length: edgeMap.Extent() }, () => [] as number[]);
    for (let i = 0; i < graph.length; i++) {
      const edgeShape = edgeMap.FindKey(i + 1);
      try {
        const edge = oc.TopoDS.Edge(edgeShape);
        try {
          for (const first of [true, false]) {
            // CumOri=false matches the underlying curve's parameter direction.
            const vertex = first ? oc.TopExp.FirstVertex(edge, false) : oc.TopExp.LastVertex(edge, false);
            try {
              if (!vertex.IsNull()) {
                const vertexIndex = vertexMap.Add(vertex) - 1;
                (groups[vertexIndex] ??= []).push({ index: i, tangent: edgeTangent(oc, edge, first) });
              }
            } finally { vertex.delete(); }
          }
        } finally { edge.delete(); }
      } finally { edgeShape.delete(); }
    }
    for (const group of groups) {
      if (!group) continue;
      for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) {
        const a = group[i], b = group[j];
        if (a.tangent && b.tangent && parallel(a.tangent, b.tangent)) connect(graph, a.index, b.index);
      }
    }
    return graph;
  } finally { vertexMap.delete(); edgeMap.delete(); }
}
