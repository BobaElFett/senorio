import * as THREE from "three";
import { ValueNoise } from "./noise";

export const MAP_SIZE = 400;      // metros de lado
export const WATER_LEVEL = 0;
const SEGMENTS = 160;
const VILLAGE_RADIUS = 45;        // zona llana central para construir
const VILLAGE_HEIGHT = 3;

/**
 * Terreno procedural: colinas suaves, un río que cruza el mapa de norte a sur
 * y una explanada central donde irá la aldea. `heightAt` es la fuente de verdad
 * de la altura del suelo para cámara, árboles y, más adelante, unidades.
 */
export class Terrain {
  readonly mesh: THREE.Mesh;
  readonly water: THREE.Mesh;
  readonly tint = { value: new THREE.Color(1, 1, 1) };
  readonly snow = { value: 0 };
  private noise: ValueNoise;
  private detail: ValueNoise;

  constructor(seed = 7) {
    this.noise = new ValueNoise(seed);
    this.detail = new ValueNoise(seed + 101);
    this.mesh = this.buildMesh();
    this.water = this.buildWater();
  }

  /** Coordenada x del centro del río para una z dada. */
  riverX(z: number): number {
    return 95 + Math.sin(z * 0.012) * 30 + this.noise.noise(z * 0.01, 3.7) * 18;
  }

  /** Distancia horizontal al cauce del río. */
  riverDistance(x: number, z: number): number {
    return Math.abs(x - this.riverX(z));
  }

  isVillageArea(x: number, z: number, margin = 0): boolean {
    return Math.hypot(x, z) < VILLAGE_RADIUS + margin;
  }

  heightAt(x: number, z: number): number {
    // Colinas grandes + detalle pequeño
    let h = 4 + this.noise.fbm(x * 0.006, z * 0.006, 4) * 22 + this.detail.fbm(x * 0.03, z * 0.03, 2) * 1.6;
    // Las colinas crecen hacia los bordes del mapa
    const edge = Math.hypot(x, z) / (MAP_SIZE * 0.5);
    h += Math.max(0, edge - 0.7) * 30;

    // Explanada de la aldea con transición suave
    const d = Math.hypot(x, z);
    const t = smoothstep(VILLAGE_RADIUS, VILLAGE_RADIUS + 40, d);
    h = VILLAGE_HEIGHT + (h - VILLAGE_HEIGHT) * t;

    // Cauce del río: valle ancho y lecho por debajo del agua
    const rd = this.riverDistance(x, z);
    const valley = smoothstep(6, 34, rd);
    // Dos vados (bancos de arena poco profundos) para cruzar el río
    const ford = Math.max(1 - smoothstep(6, 14, Math.abs(z + 60)), 1 - smoothstep(6, 14, Math.abs(z - 110)));
    const bed = -2.2 + ford * 2.5;
    h = bed + (h - bed) * valley;
    return h;
  }

  private buildMesh(): THREE.Mesh {
    const geo = new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE, SEGMENTS, SEGMENTS);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      pos.setY(i, this.heightAt(pos.getX(i), pos.getZ(i)));
    }
    // Sin índices: cada triángulo tiene sus propios vértices y su propio color (look low-poly)
    const flat = geo.toNonIndexed();
    flat.computeVertexNormals();
    const p = flat.attributes.position as THREE.BufferAttribute;
    const n = flat.attributes.normal as THREE.BufferAttribute;
    const colors = new Float32Array(p.count * 3);
    const c = new THREE.Color();
    const grass = new THREE.Color("#6f9a4a"), grassDark = new THREE.Color("#55803c");
    const field = new THREE.Color("#8fae58"), sand = new THREE.Color("#cbbb86");
    const rock = new THREE.Color("#8a8778"), mud = new THREE.Color("#6b5b44");
    for (let i = 0; i < p.count; i += 3) {
      // Color por triángulo según altura media y pendiente
      const y = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3;
      const x = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3;
      const z = (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3;
      const slope = 1 - n.getY(i);
      const v = this.detail.noise(x * 0.08, z * 0.08);
      if (y < WATER_LEVEL - 0.3) c.copy(mud);
      else if (y < WATER_LEVEL + 0.9) c.copy(sand);
      else if (slope > 0.32) c.copy(rock);
      else if (this.isVillageArea(x, z, 10)) c.copy(field).lerp(grass, 0.5 + v * 0.5);
      else c.copy(v > 0 ? grass : grassDark).lerp(grassDark, Math.min(1, y / 40));
      for (let k = 0; k < 3; k++) {
        colors[(i + k) * 3] = c.r;
        colors[(i + k) * 3 + 1] = c.g;
        colors[(i + k) * 3 + 2] = c.b;
      }
    }
    flat.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 });
    // Tinte estacional y nieve, controlados desde fuera con uniforms
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTint = this.tint;
      sh.uniforms.uSnow = this.snow;
      sh.fragmentShader = "uniform vec3 uTint;\nuniform float uSnow;\n" + sh.fragmentShader.replace(
        "#include <color_fragment>",
        "#include <color_fragment>\n  diffuseColor.rgb *= uTint;\n  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9, 0.93, 0.97), uSnow);",
      );
    };
    const mesh = new THREE.Mesh(flat, mat);
    mesh.receiveShadow = true;
    mesh.name = "terrain";
    return mesh;
  }

  private buildWater(): THREE.Mesh {
    const geo = new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({
      color: "#3f7fa6", transparent: true, opacity: 0.82, roughness: 0.25, metalness: 0.1,
    });
    const water = new THREE.Mesh(geo, mat);
    water.position.y = WATER_LEVEL;
    water.name = "water";
    return water;
  }
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
