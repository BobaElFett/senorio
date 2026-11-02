import * as THREE from "three";
import { Terrain, MAP_SIZE } from "../world/terrain";

/**
 * Cámara RTS estilo Manor Lords / Total War.
 *  - Desplazar: WASD o flechas, o llevar el ratón al borde de la pantalla
 *  - Zoom: rueda del ratón
 *  - Girar: Q / E, o arrastrar con el botón central
 * La cámara orbita alrededor de un punto en el suelo (`target`), que sigue la altura del terreno.
 */
export class RtsCamera {
  readonly camera: THREE.PerspectiveCamera;
  readonly target = new THREE.Vector3(0, 0, 40);
  edgePan = true;

  private yaw = 0;                 // rotación alrededor del eje vertical
  private distance = 90;           // distancia al objetivo (zoom)
  private targetDistance = 90;
  private readonly minDistance = 22;
  private readonly maxDistance = 220;
  private keys = new Set<string>();
  private mouse = { x: 0.5, y: 0.5, inside: false, moved: false };
  private rotating = false;
  private lastX = 0;
  private groundY = 0;

  constructor(private dom: HTMLElement, private terrain: Terrain) {
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.5, 1500);
    this.groundY = terrain.heightAt(this.target.x, this.target.z);
    this.bindInput();
    this.update(0);
  }

  /** Coloca la cámara: punto en el suelo, giro (rad) y distancia. */
  setView(x: number, z: number, yaw: number, distance: number) {
    this.target.set(x, 0, z);
    this.yaw = yaw;
    this.distance = this.targetDistance = THREE.MathUtils.clamp(distance, this.minDistance, this.maxDistance);
    this.groundY = Math.max(0, this.terrain.heightAt(x, z));
    this.update(0);
  }

  getView() { return { x: this.target.x, z: this.target.z, yaw: this.yaw, d: this.targetDistance }; }

  /** Dirección horizontal hacia la que mira la cámara. */
  forwardXZ(): { x: number; z: number } {
    return { x: -Math.sin(this.yaw), z: -Math.cos(this.yaw) };
  }

  resize(w: number, h: number) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private bindInput() {
    window.addEventListener("keydown", (e) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      if (e.ctrlKey || e.metaKey) return;
      this.keys.add(e.code);
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => { this.keys.clear(); this.mouse.inside = false; });

    this.dom.addEventListener("wheel", (e) => {
      e.preventDefault();
      const factor = Math.exp(e.deltaY * 0.0012);
      this.targetDistance = THREE.MathUtils.clamp(this.targetDistance * factor, this.minDistance, this.maxDistance);
    }, { passive: false });

    this.dom.addEventListener("pointermove", (e) => {
      const r = this.dom.getBoundingClientRect();
      this.mouse.x = (e.clientX - r.left) / r.width;
      this.mouse.y = (e.clientY - r.top) / r.height;
      this.mouse.inside = true;
      // El borde solo cuenta tras un movimiento real del ratón (evita desplazarse al cargar)
      if (e.movementX !== 0 || e.movementY !== 0) this.mouse.moved = true;
      if (this.rotating) {
        this.yaw -= (e.clientX - this.lastX) * 0.006;
        this.lastX = e.clientX;
      }
    });
    this.dom.addEventListener("pointerleave", () => { this.mouse.inside = false; });
    this.dom.addEventListener("pointerdown", (e) => {
      if (e.button === 1) {
        e.preventDefault();
        this.rotating = true;
        this.lastX = e.clientX;
        this.dom.setPointerCapture(e.pointerId);
      }
    });
    this.dom.addEventListener("pointerup", (e) => {
      if (e.button === 1) this.rotating = false;
    });
    this.dom.addEventListener("auxclick", (e) => e.preventDefault());
  }

  update(dt: number) {
    // Zoom suavizado
    this.distance += (this.targetDistance - this.distance) * Math.min(1, dt * 10);

    // Entrada de desplazamiento en coordenadas de pantalla
    let mx = 0, mz = 0;
    if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) mz -= 1;
    if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) mz += 1;
    if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) mx -= 1;
    if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) mx += 1;
    if (this.edgePan && this.mouse.inside && this.mouse.moved && !this.rotating) {
      const m = 0.012;
      if (this.mouse.x < m) mx -= 1;
      if (this.mouse.x > 1 - m) mx += 1;
      if (this.mouse.y < m) mz -= 1;
      if (this.mouse.y > 1 - m) mz += 1;
    }
    if (this.keys.has("KeyQ")) this.yaw += dt * 1.6;
    if (this.keys.has("KeyE")) this.yaw -= dt * 1.6;

    // Velocidad proporcional al zoom: lejos se mueve más rápido
    const speed = 0.9 * this.distance + 20;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    this.target.x += (mx * cos + mz * sin) * speed * dt;
    this.target.z += (-mx * sin + mz * cos) * speed * dt;
    const lim = MAP_SIZE / 2 - 15;
    this.target.x = THREE.MathUtils.clamp(this.target.x, -lim, lim);
    this.target.z = THREE.MathUtils.clamp(this.target.z, -lim, lim);

    // El objetivo sigue el suelo con suavidad (no por debajo del agua)
    const ground = Math.max(0, this.terrain.heightAt(this.target.x, this.target.z));
    this.groundY += (ground - this.groundY) * Math.min(1, dt * 6 || 1);
    this.target.y = this.groundY;

    // Inclinación según el zoom: cerca se ve más de lado, lejos más cenital
    const t = THREE.MathUtils.clamp((this.distance - this.minDistance) / (this.maxDistance - this.minDistance), 0, 1);
    const pitch = THREE.MathUtils.lerp(0.55, 1.1, Math.sqrt(t));
    const horiz = Math.cos(pitch) * this.distance;
    const pos = this.camera.position;
    pos.set(
      this.target.x + Math.sin(this.yaw) * horiz,
      this.target.y + Math.sin(pitch) * this.distance,
      this.target.z + Math.cos(this.yaw) * horiz,
    );
    // La cámara nunca atraviesa una colina
    const under = this.terrain.heightAt(pos.x, pos.z) + 3;
    if (pos.y < under) pos.y = under;
    this.camera.lookAt(this.target);
  }
}
