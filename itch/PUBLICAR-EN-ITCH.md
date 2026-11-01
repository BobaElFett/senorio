# Publicar Señorío en itch.io

Todo lo necesario está en esta carpeta:

| Archivo | Para qué |
| --- | --- |
| `senorio-web.zip` | El juego (un único `index.html`). Es lo que se sube. |
| `portada-630x500.png` | Imagen de portada (*Cover image*). |
| `captura-1-menu.png` … `captura-4-batalla.png` | Capturas (*Screenshots*). |

## Pasos (unos 5 minutos)

1. Entra en itch.io con tu cuenta → **Dashboard** → **Create new project**.
2. **Title:** Señorío · **Project URL:** por ejemplo `senorio`.
3. **Kind of project:** **HTML** (el juego se juega en el navegador).
4. **Uploads → Upload files:** sube `senorio-web.zip` y marca **This file will be played in the browser**.
5. **Embed options:**
   - Viewport dimensions: **1280 × 720**
   - Marca **Fullscreen button** (recomendado: el juego se maneja mejor a pantalla completa).
   - Deja sin marcar *Mobile friendly* (necesita ratón y teclado).
6. **Details:** copia la descripción de abajo, género **Strategy**, etiquetas sugeridas: `city-builder`, `medieval`, `real-time-strategy`, `low-poly`, `tactical`, `singleplayer`, `spanish`.
7. **Cover image:** `portada-630x500.png`. **Screenshots:** las cuatro capturas.
8. **Visibility:** empieza en **Draft** para probarlo tú (botón *View page*). Cuando te guste, cámbialo a **Public** o **Restricted** (con contraseña, para enseñarlo a amigos).

Las partidas se guardan en el navegador de cada jugador (localStorage), también desde itch.io.

---

## Descripción para la página (español)

**Señorío** es un prototipo de estrategia medieval para navegador: haz crecer una aldea y defiéndela en batallas tácticas en tiempo real con los hombres de sus propias familias.

**La aldea.** Construye casas, granjas, leñadores, almacenes, mercado y cuartel. Cada familia vive en una casa y trabaja en un edificio; las que no tienen trabajo construyen las obras. Las granjas siguen las estaciones, el invierno pide leña y comida guardada, y la aprobación decide si llegan familias nuevas o se marchan.

**La guerra.** Tres incursiones de bandidos llegan desde el oeste. Recluta lanceros y arqueros en el cuartel: cada familia aporta cuatro hombres que dejan su trabajo mientras sirven. Arrastra para trazar el frente, flanquea, carga, protege a tus arqueros. La moral manda: un regimiento rodeado huye. Y cada caído es un hombre de una familia concreta; si una familia pierde a todos sus hombres, su casa queda vacía.

**Controles:** ratón y teclado. WASD cámara · rueda zoom · Q/E girar · clic izquierdo seleccionar y construir · clic derecho mover o atacar · arrastrar con clic derecho para trazar el frente · Espacio pausa · T velocidad · M menú.

Una partida dura unos 45 minutos a velocidad normal (T acelera hasta 5×). Incluye una batalla de prueba 3 contra 3. Sonido y música generados en tiempo real.

*Prototipo en desarrollo: se agradecen comentarios.*

## Description (English)

**Señorío** is a browser medieval strategy prototype: grow a village and defend it in real-time tactical battles with the men of its own families. Build houses, farms, woodcutters and markets through the seasons; when bandits come, levy spearmen and archers from your families, draw battle lines, flank and charge. Every fallen soldier is a man from a family in your village. About 45 minutes per campaign. Interface in Spanish.
