import * as THREE from "three";

export interface TriangleMesh {
  positions: Float32Array;
  indices: Uint32Array;
  faceIndex: number;
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

export function createStepRenderer(container: HTMLElement): {
  renderMeshes(meshes: TriangleMesh[]): void;
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
    renderer.render(scene, camera);
    animationFrame = window.requestAnimationFrame(draw);
  };

  const renderMeshes = (meshes: TriangleMesh[]) => {
    if (geometryGroup) {
      scene.remove(geometryGroup);
      geometryGroup.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
        }
      });
      (geometryGroup.children[0] as THREE.Mesh | undefined)?.material &&
        ((geometryGroup.children[0] as THREE.Mesh).material as THREE.Material).dispose();
    }

    geometryGroup = createGeometryGroup(meshes);
    scene.add(geometryGroup);

    const bounds = new THREE.Box3().setFromObject(geometryGroup);
    if (!bounds.isEmpty()) {
      const center = bounds.getCenter(new THREE.Vector3());
      const radius = Math.max(bounds.getBoundingSphere(new THREE.Sphere()).radius, 0.01);
      camera.position.set(
        center.x + radius * 1.8,
        center.y + radius * 1.8,
        center.z + radius * 2.4,
      );
      camera.near = Math.max(radius / 1000, 0.001);
      camera.far = radius * 100;
      camera.lookAt(center);
      camera.updateProjectionMatrix();
    }
  };

  resize();
  window.addEventListener("resize", resize);
  draw();

  return {
    renderMeshes,
    dispose() {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", resize);
      geometryGroup?.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          (object.material as THREE.Material).dispose();
        }
      });
      renderer.dispose();
      container.removeChild(renderer.domElement);
    },
  };
}
