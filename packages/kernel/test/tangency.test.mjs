import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { LibcascadeKernel } from "../src/index.ts";

// Sew three quarter-cylinder patches. The middle patch reverses U so its
// circular boundary curves have the opposite parameter direction.
async function curvedFixture(kernel) {
  await kernel.initialize();
  const oc = kernel.oc;
  const axis = new oc.gp_Ax3();
  const cylinder = new oc.gp_Cylinder(axis, 2);
  const reversed = new oc.gp_Cylinder(axis, 2);
  reversed.UReverse();
  const sewing = new oc.BRepBuilderAPI_Sewing();
  const builders = [];
  const faces = [];
  try {
    for (const [surface, start, end] of [
      [cylinder, 0, Math.PI / 2],
      [reversed, -Math.PI, -Math.PI / 2],
      [cylinder, Math.PI, 3 * Math.PI / 2],
    ]) {
      const builder = new oc.BRepBuilderAPI_MakeFace(surface, start, end, 0, 3);
      builders.push(builder);
      const face = builder.Face();
      faces.push(face);
      sewing.Add(face);
    }
    sewing.Perform();
    const shape = sewing.SewedShape();
    const writer = new oc.STEPControl_Writer();
    const progress = new oc.Message_ProgressRange();
    try {
      assert.equal(writer.Transfer(shape, oc.STEPControl_StepModelType.STEPControl_AsIs, true, progress),
        oc.IFSelect_ReturnStatus.IFSelect_RetDone);
      assert.equal(writer.Write("/tangent-fixture.step"), oc.IFSelect_ReturnStatus.IFSelect_RetDone);
      const bytes = oc.FS.readFile("/tangent-fixture.step");
      oc.FS.unlink("/tangent-fixture.step");
      return bytes;
    } finally { progress.delete(); writer.delete(); shape.delete(); }
  } finally {
    for (const face of faces) face.delete();
    for (const builder of builders) builder.delete();
    sewing.delete(); reversed.delete(); cylinder.delete(); axis.delete();
  }
}

function hasOppositeCurveDirections(kernel, indices) {
  const { oc, shape } = kernel;
  const map = new oc.NCollection_IndexedMap_TopoDS_Shape_TopTools_ShapeMapHasher();
  const endpoints = [];
  try {
    oc.TopExp.MapShapes(shape, oc.TopAbs_ShapeEnum.TopAbs_EDGE, map);
    for (const index of indices) {
      const key = map.FindKey(index + 1);
      try {
        const edge = oc.TopoDS.Edge(key);
        try {
          const curve = new oc.BRepAdaptor_Curve(edge);
          try {
            for (const first of [true, false]) {
              const vertex = first ? oc.TopExp.FirstVertex(edge, false) : oc.TopExp.LastVertex(edge, false);
              const point = new oc.gp_Pnt();
              const vector = new oc.gp_Vec();
              try {
                curve.D1(first ? curve.FirstParameter() : curve.LastParameter(), point, vector);
                endpoints.push({ index, vertex, direction: [vector.X(), vector.Y(), vector.Z()] });
              } finally { point.delete(); vector.delete(); }
            }
          } finally { curve.delete(); }
        } finally { edge.delete(); }
      } finally { key.delete(); }
    }
    return endpoints.some((a) => endpoints.some((b) =>
      a.index !== b.index && a.vertex.IsSame(b.vertex) &&
      a.direction.reduce((sum, value, i) => sum + value * b.direction[i], 0) < -1e-8));
  } finally {
    for (const endpoint of endpoints) endpoint.vertex.delete();
    map.delete();
  }
}

function reparameterizeSharedEdge(kernel) {
  const { oc, shape } = kernel;
  const faces = [];
  const explorer = new oc.TopExp_Explorer(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE);
  const map = new oc.NCollection_IndexedMap_TopoDS_Shape_TopTools_ShapeMapHasher();
  try {
    while (explorer.More()) {
      const current = explorer.Current();
      try { faces.push(oc.TopoDS.Face(current)); } finally { current.delete(); }
      explorer.Next();
    }
    oc.TopExp.MapShapes(faces[0], oc.TopAbs_ShapeEnum.TopAbs_EDGE, map);
    const edges = new oc.TopExp_Explorer(faces[1], oc.TopAbs_ShapeEnum.TopAbs_EDGE);
    try {
      while (edges.More()) {
        const key = edges.Current();
        try {
          if (map.FindIndex(key)) {
            const edge = oc.TopoDS.Edge(key);
            const curve = new oc.BRepAdaptor_Curve2d(edge, faces[1]);
            const first = curve.FirstParameter(), last = curve.LastParameter();
            const p1 = curve.Value(first), p2 = curve.Value(last);
            const poles = new oc.NCollection_Array1_gp_Pnt2d(1, 2);
            const knots = new oc.NCollection_Array1_double(1, 2);
            const mults = new oc.NCollection_Array1_int(1, 2);
            const builder = new oc.BRep_Builder();
            try {
              poles.SetValue(1, p1); poles.SetValue(2, p2);
              knots.SetValue(1, 0); knots.SetValue(2, 6);
              mults.SetValue(1, 2); mults.SetValue(2, 2);
              const pcurve = new oc.Geom2d_BSplineCurve(poles, knots, mults, 1, false);
              try {
                builder.UpdateEdge(edge, pcurve, faces[1], 1e-7);
                builder.Range(edge, faces[1], 0, 6);
                builder.SameRange(edge, false);
                builder.SameParameter(edge, false);
              } finally { pcurve.delete(); }
              assert.equal(oc.BRep_Tool.SameParameter(edge), false);
              return { edge: oc.TopoDS.Edge(edge), face: oc.TopoDS.Face(faces[1]) };
            } finally {
              builder.delete(); mults.delete(); knots.delete(); poles.delete();
              p2.delete(); p1.delete(); curve.delete(); edge.delete();
            }
          }
        } finally { key.delete(); }
        edges.Next();
      }
    } finally { edges.delete(); }
    throw new Error("Missing shared edge");
  } finally { for (const face of faces) face.delete(); explorer.delete(); map.delete(); }
}

test("normalizes differently parameterized pcurves without modifying the loaded model", async () => {
  const kernel = new LibcascadeKernel();
  await kernel.loadStep(await curvedFixture(kernel));
  const oc = kernel.oc;
  const { edge, face } = reparameterizeSharedEdge(kernel);
  try {
    const snapshot = () => {
      const curve = new oc.BRepAdaptor_Curve2d(edge, face);
      try {
        const point = curve.Value(1.5);
        try { return [curve.FirstParameter(), curve.LastParameter(), point.X(), point.Y()]; }
        finally { point.delete(); }
      } finally { curve.delete(); }
    };
    const before = snapshot();
    assert.deepEqual(before.slice(0, 2), [0, 6]);
    assert.deepEqual(kernel.getTangentFaces(0), [0, 1, 2]);
    assert.equal(oc.BRep_Tool.SameParameter(edge), false);
    assert.deepEqual(snapshot(), before);
  } finally { face.delete(); edge.delete(); }
});

test("curved BRep face and edge chains are transitive and use tessellation indices", async () => {
  const kernel = new LibcascadeKernel();
  const data = await curvedFixture(kernel);
  await kernel.loadStep(data);
  assert.equal(kernel.getFaceCount(), 3);
  const meshes = kernel.getTessellation();
  assert.equal(meshes.length, 3);
  for (const face of meshes) assert.deepEqual(kernel.getTangentFaces(face.faceIndex), [0, 1, 2]);

  const edges = new Map(meshes.flatMap((m) => m.edges.map((e) => [e.edgeIndex, e])));
  const bottomArcs = [...edges.values()].filter(({ positions }) =>
    [...positions].filter((_, i) => i % 3 === 2).every((z) => Math.abs(z) < 1e-5) &&
    positions.length > 6);
  assert.equal(bottomArcs.length, 3);
  const expected = bottomArcs.map((e) => e.edgeIndex).sort((a, b) => a - b);
  assert.ok(hasOppositeCurveDirections(kernel, expected), "fixture must contain opposite curve directions");
  for (const edge of bottomArcs) assert.deepEqual(kernel.getTangentEdges(edge.edgeIndex), expected);

  const faceBefore = kernel.getTangentFaces(0);
  const edgeBefore = kernel.getTangentEdges(expected[0]);
  await assert.rejects(kernel.loadStep(new Uint8Array([0, 1, 2])));
  assert.deepEqual(kernel.getTangentFaces(0), faceBefore);
  assert.deepEqual(kernel.getTangentEdges(expected[0]), edgeBefore);

  const cube = await readFile(new URL("./fixtures/sample.step", import.meta.url));
  await kernel.loadStep(cube);
  for (let i = 0; i < 6; i++) assert.deepEqual(kernel.getTangentFaces(i), [i]);
  for (const i of new Set(kernel.getTessellation().flatMap((m) => m.edges.map((e) => e.edgeIndex)))) {
    assert.deepEqual(kernel.getTangentEdges(i), [i]);
  }
});

test("queries reject missing models and invalid topology indices", async () => {
  const kernel = new LibcascadeKernel();
  assert.throws(() => kernel.getTangentFaces(0), /No STEP geometry/);
  assert.throws(() => kernel.getTangentEdges(0), /No STEP geometry/);
  await kernel.loadStep(await readFile(new URL("./fixtures/sample.step", import.meta.url)));
  for (const index of [-1, 6, 0.5, NaN]) assert.throws(() => kernel.getTangentFaces(index), RangeError);
  for (const index of [-1, 12, 0.5, NaN]) assert.throws(() => kernel.getTangentEdges(index), RangeError);
});
