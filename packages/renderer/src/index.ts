import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

export interface TriangleMesh {
  positions: Float32Array;
  indices: Uint32Array;
  faceIndex: number;
}

export function fitCameraToBounds(
  camera: THREE.PerspectiveCamera,
  bounds: THREE.Box3,
  target: THREE.Vector3,
): void {
  if (bounds.isEmpty()) return;

  const center = bounds.getCenter(new THREE.Vector3());
  const radius = Math.max(bounds.getBoundingSphere(new THREE.Sphere()).radius, 0.01);
  const verticalFov = THREE.MathUtils.degToRad(camera.fov);
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect);
  const halfFov = Math.min(verticalFov, horizontalFov) / 2;
  const distance = (radius * 1.15) / Math.sin(halfFov);

  target.copy(center);
  camera.position
    .copy(center)
    .add(new THREE.Vector3(1.8, 1.8, 2.4).normalize().multiplyScalar(distance));
  camera.near = Math.max(radius / 1000, 0.001);
  camera.far = radius * 100;
  camera.lookAt(center);
  camera.updateProjectionMatrix();
}

export function createFaceGeometry(mesh: TriangleMesh): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

export function createGeometryGroup(meshes: TriangleMesh[]): THREE.Group {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({
    color: 0x9caec2,
    metalness: 0.1,
    roughness: 0.65,
  });

  for (const mesh of meshes) {
    const object = new THREE.Mesh(createFaceGeometry(mesh), material);
    object.userData.faceIndex = mesh.faceIndex;
    group.add(object);
  }

  return group;
}

function disposeGeometryGroup(group: THREE.Group): void {
  const materials = new Set<THREE.Material>();

  group.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.geometry.dispose();
      const meshMaterials = Array.isArray(object.material)
        ? object.material
        : [object.material];
      meshMaterials.forEach((material) => materials.add(material));
    }
  });

  materials.forEach((material) => material.dispose());
}

export function createStepRenderer(container: HTMLElement): {
  renderMeshes(meshes: TriangleMesh[]): void;
  fitToView(): void;
  dispose(): void;
} {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf1f3f5);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100000);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.append(renderer.domElement);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x596575, 2));
  const light = new THREE.DirectionalLight(0xffffff, 2);
  light.position.set(1, 2, 3);
  scene.add(light);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  let geometryGroup: THREE.Group | undefined;
  let animationFrame = 0;

  const resize = () => {
    const width = Math.max(container.clientWidth, 1);
    const height = Math.max(container.clientHeight, 1);
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };

  const draw = () => {
    controls.update();
    renderer.render(scene, camera);
    animationFrame = window.requestAnimationFrame(draw);
  };

  const fitToView = () => {
    if (!geometryGroup) return;

    const bounds = new THREE.Box3().setFromObject(geometryGroup);
    fitCameraToBounds(camera, bounds, controls.target);
    controls.update();
  };

  const renderMeshes = (meshes: TriangleMesh[]) => {
    if (geometryGroup) {
      scene.remove(geometryGroup);
      disposeGeometryGroup(geometryGroup);
    }

    geometryGroup = createGeometryGroup(meshes);
    scene.add(geometryGroup);
    fitToView();
  };

  resize();
  window.addEventListener("resize", resize);
  draw();

  return {
    renderMeshes,
    fitToView,
    dispose() {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", resize);
      controls.dispose();
      if (geometryGroup) disposeGeometryGroup(geometryGroup);
      renderer.dispose();
      container.removeChild(renderer.domElement);
    },
  };
}
