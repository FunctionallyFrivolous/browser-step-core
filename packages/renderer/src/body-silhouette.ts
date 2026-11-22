import * as THREE from "three";

export class BodySilhouettePass {
  private readonly target = new THREE.WebGLRenderTarget(1, 1, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthBuffer: false,
  });
  private readonly maskMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
  });
  private readonly maskScene = new THREE.Scene();
  private readonly overlayScene = new THREE.Scene();
  private readonly overlayCamera = new THREE.Camera();
  private readonly overlayGeometry = new THREE.PlaneGeometry(2, 2);
  private readonly overlayMaterial = new THREE.ShaderMaterial({
    uniforms: {
      mask: { value: this.target.texture },
      texel: { value: new THREE.Vector2(1, 1) },
      radius: { value: 1 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D mask;
      uniform vec2 texel;
      uniform float radius;
      varying vec2 vUv;
      void main() {
        if (texture2D(mask, vUv).r > 0.5) discard;
        float covered = 0.0;
        for (int x = -6; x <= 6; x++) {
          for (int y = -6; y <= 6; y++) {
            vec2 offset = vec2(float(x), float(y));
            if (length(offset) <= radius) {
              covered = max(covered, texture2D(mask, vUv + offset * texel).r);
            }
          }
        }
        if (covered < 0.5) discard;
        gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0);
      }
    `,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  private group?: THREE.Group;
  private readonly bodies = new Map<number, Array<{ source: THREE.Mesh; mask: THREE.Mesh }>>();

  constructor() {
    this.overlayScene.add(new THREE.Mesh(this.overlayGeometry, this.overlayMaterial));
  }

  setSize(width: number, height: number): void {
    this.target.setSize(width, height);
    this.overlayMaterial.uniforms.texel.value.set(1 / width, 1 / height);
  }

  setGroup(group: THREE.Group): void {
    this.group = group;
    this.bodies.clear();
    group.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || object.userData.isEdgeLine) return;
      const bodyIndex = object.userData.bodyIndex as number;
      const body = this.bodies.get(bodyIndex) ?? [];
      const mask = new THREE.Mesh(object.geometry, this.maskMaterial);
      mask.matrixAutoUpdate = false;
      body.push({ source: object, mask });
      this.bodies.set(bodyIndex, body);
    });
  }

  render(renderer: THREE.WebGLRenderer, camera: THREE.Camera, pixelRatio: number): void {
    const group = this.group;
    const selectedBodies = group?.userData.selectedBodies as Set<number> | undefined;
    if (!group?.visible || !selectedBodies?.size) return;

    group.updateWorldMatrix(true, true);
    const previousTarget = renderer.getRenderTarget();
    const previousColor = renderer.getClearColor(new THREE.Color());
    const previousAlpha = renderer.getClearAlpha();
    this.overlayMaterial.uniforms.radius.value =
      Math.min(Math.max(1, (group.userData.edgeThickness ?? 1) * 1.5), 3) * pixelRatio;
    try {
      for (const bodyIndex of selectedBodies) {
        const body = this.bodies.get(bodyIndex);
        if (!body) continue;
        for (const { source, mask } of body) {
          if (!source.visible) continue;
          mask.matrix.copy(source.matrixWorld);
          this.maskScene.add(mask);
        }
        if (this.maskScene.children.length === 0) continue;
        renderer.setRenderTarget(this.target);
        renderer.setClearColor(0x000000, 0);
        renderer.clear(true, false, false);
        renderer.render(this.maskScene, camera);
        renderer.setRenderTarget(previousTarget);
        renderer.render(this.overlayScene, this.overlayCamera);
        this.maskScene.clear();
      }
    } finally {
      this.maskScene.clear();
      renderer.setRenderTarget(previousTarget);
      renderer.setClearColor(previousColor, previousAlpha);
    }
  }

  dispose(): void {
    this.bodies.clear();
    this.target.dispose();
    this.maskMaterial.dispose();
    this.overlayGeometry.dispose();
    this.overlayMaterial.dispose();
  }
}
