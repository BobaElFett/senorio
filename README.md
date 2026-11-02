# Señorío

Juego de gestión de una aldea medieval con batallas tácticas en tiempo real, para navegador.
Three.js + TypeScript, compilado con esbuild a un único `dist/index.html`.

## Jugar
Abre `dist/index.html` con doble clic (Chrome, Edge o Firefox). No hace falta servidor.

- **Menú** al abrir: *Partida nueva*, *Continuar* (con resumen de la partida guardada), *Batalla de prueba*, *Ajustes* y *Cómo jugar*. Durante la partida: tecla **M** o botón *Menú* (pausa el juego).
- **Guardado:** automático al empezar cada día y al cerrar la pestaña; también *Guardar partida* en el menú. Se guarda en el navegador (una partida).
- **Ajustes:** volumen general, música y efectos; mover la cámara con el ratón en el borde; mostrar la ayuda.
- **Sonido:** todo sintetizado en tiempo real (sin archivos): choques de armas, flechas, cargas, cuerno de alarma, campanas, martillos, viento, pájaros y grillos, música de laúd y tambores en las incursiones. Suena tras el primer clic.
- **Compartir:** el juego es un único archivo (`dist/index.html`); también hay una versión jugable con enlace en claude.ai.

## Mejoras 0.11.1 (pulido, sin funciones nuevas)
- Una batalla perdida ya no vacía la aldea: la familia que pierde a sus hombres sigue trabajando y recupera uno cada estación (antes desaparecía y en difícil se podía perder la partida en la primera incursión).
- Las bajas se reparten entre las familias de la leva (antes la primera fila era toda de una familia).
- El estandarte del Castro de Montfort está en la plaza, delante de la torre (las tropas se metían en los muros).
- Mapa: la ficha de una tierra sale al instante al hacer clic.
- Interfaz: la ayuda se pliega a «Controles» mientras hay objetivos; las tarjetas enemigas van bajo el aviso; los avisos repetidos (hambre, frío) se espacian; «Cómo jugar» cubre economía, establo y herrería; pistas de objetivos corregidas.
- Cámara: nunca mira al cielo vacío al acercarse.
- Rendimiento: cada edificio se dibuja como una sola malla (una aldea de 75 edificios pasa de ~1.600 llamadas de dibujo a ~225).
- La partida empieza a las 8 de la mañana, con luz de día.
- IA: los arqueros enemigos que ven venir jinetes corren a refugiarse detrás de su infantería (antes se quedaban quietos).
- Tras una victoria, el aviso recuerda licenciar los regimientos; si siguen ociosos tres días, otro aviso dice cuántos hombres no trabajan.

## Novedades 0.11 · fase 8 (acabado)
- **Modelos mejores:** soldados con brazos (el del arma golpea al atacar), escudo de cometa en el color del bando, túnica con cinturón, lanzas con punta de hierro y aljaba a la espalda de los arqueros. Las casas tienen cuatro variantes (tejado, muros, chimenea, leña, tonel o banco).
- **Rendimiento:** alturas del terreno precalculadas, colores y formaciones sin recalcular cada fotograma. Una batalla de unos 1.600 soldados simula en ~5 ms por paso. Ajuste nuevo: **gráficos sencillos** (sin sombras) para ordenadores modestos.
- **Opinión de los jugadores:** en el menú, «Dar tu opinión» (diversión, si volverían a jugar, qué gustó, qué confundió, fallos) con un resumen automático de la partida. En la versión de claude.ai se guarda para el autor; si no se puede, ofrece copiar el texto. Tras la primera incursión el juego invita una vez a contestar.

## Novedades 0.10 · fase 7 (el mundo)
- **Mapa de 720 m** (antes 400) con **diez tierras** de bordes irregulares, lindes pintadas en el suelo y un estandarte en cada una. El río las separa del este; se cruza por dos vados.
- **Mapa del señorío** (tecla **N** o botón «Mapa»): tierras por dueño, edificios, tropas y cámara. Clic en una tierra: rasgos, reclamar, ir allí (doble clic también lleva la cámara).
- **Solo se construye en tierras propias.** Las libres que lindan con las tuyas se **reclaman** con monedas (25, y 15 más por cada una); cada una paga **0,4 monedas al día** de tributo. Rasgos: Vega del Río (granjas +40%), Prados del Sur (+25%), Bosque Negro (leñadores +35%)…
- **El señor de Montfort**: castro al este con torre del homenaje, casas y una guarnición (lanceros, arqueros, mesnada) que defiende su puesto y se rehace cada 12 días. Reclama una tierra libre cada 16 días desde el día 20.
  - Tras las tres bandas de bandidos, las incursiones son **huestes de Montfort** (lanceros, ballesteros, peones y caballeros), mayores cada vez y más cuantas más tierras tenga.
  - Le quitas una tierra **ocupando su estandarte** 15 s sin enemigos a 45 m; su **castro**, 30 s. Si cae el castro, se rinde: sus tierras son tuyas y **ganas la partida** (luego, modo libre).
- **Objetivos de campaña** tras los primeros pasos: reclamar una tierra, resistir a los bandidos, quitarle una tierra a Montfort y rendir su castro.
- Las partidas guardadas de antes se cargan (en el mapa nuevo; los árboles talados no se conservan).

## Novedades 0.9 · fase 6 (economía)
- **Aserradero** (8 madera, 5 monedas, 2 aserradores): cada uno sierra 3 de madera al día en 2 **tablones**, sin bajar de 15 de madera (leña y obras).
  - Piden tablones: el **establo** (6 madera, 8 tablones, 25 monedas), las armas y armaduras de **nivel 2** en la herrería y el **taller** de las casas.
- **Comercio en el mercado** (con tendero): vender o comprar lotes de 10 de madera, grano, tablones y pan. Se compra caro y se vende barato; cada venta abarata el género y cada compra lo encarece, y los precios se recuperan en unos días. El grano vale más en invierno y menos en otoño.
- **Mejoras de casa** (con 60% de aprobación o más): **huerto** (3 madera, 4 monedas: +0,35 de grano al día salvo en invierno) o **taller** (4 tablones, 6 monedas: +0,3 monedas al día). Las trabaja la familia sin dejar su oficio, se paran si está en la leva y cada casa mejorada suma 1 de aprobación (hasta 6).

## Novedades 0.8 · fase 5 (defensa)
- **Empalizada y puertas**: en la barra de construcción, clic en el inicio y clic en el final (la empalizada sigue encadenando tramos de 4 m, 1 madera cada uno; la puerta mide 5 m y cuesta 3). Las construyen las familias sin trabajo.
- Los aldeanos y tus tropas cruzan las puertas; los bandidos no. Si no tienen otro camino, eligen un tramo y lo derriban a hachazos (unos 30 s una banda de 20); la brecha se abre en la navegación y siguen hacia la aldea.
- Clic en un tramo: resistencia y demoler. Los tramos se guardan con la partida.
- **Torre de vigía** (8 madera, 5 monedas, 1 vigía): las incursiones se avisan 3 días antes en vez de 2, y dispara flechas a los bandidos a 70 m.
- **Caballería**: el **establo** (14 madera, 25 monedas) forma jinetes, 2 por familia (7 monedas y 1 madera por familia; los caballos se guardan al licenciar). Cada caballo en servicio come 0,25 de grano al día.
  - La carga a galope arrolla a arqueros y milicia y rompe a los lanceros por la espalda; de frente contra lanzas firmes, los jinetes pierden.
  - El barón bandido (tercera incursión) y el modo libre traen jinetes; buscan a tus arqueros y evitan tus lanzas.
  - La batalla de prueba incluye jinetes en los dos bandos.
- **Herrería** (10 madera, 20 monedas, 1 herrero): encargos de **armas** (+1 ataque y flechas más dañinas por nivel) y **armaduras** (+1 defensa y +1,5 de vida por nivel), dos niveles cada uno, de 4 a 6 días. Un encargo a la vez; se guarda con la partida.
- **Bandidos más listos**: desde la segunda incursión llegan **por dos lados** (merodeadores por el norte; el barón manda la mesnada y los jinetes por el suroeste). El aviso dice por dónde vienen. En el modo libre los lados cambian en cada incursión.
  - **Flanqueo**: si uno de tus regimientos está trabado, los demás bandidos lo rodean y entran por el costado o la espalda.
- La barra de construcción pone un recurso por línea para caber en una fila; los avisos se colocan encima de la barra.

## Novedades 0.6 (noche del 1 al 2 de noviembre)
- **Dificultad** al empezar: fácil (bandidos −25% y 6 días más tarde), normal o difícil (+30% y 4 días antes).
- **Modo libre**: tras la tercera incursión, botón para seguir jugando con incursiones cada 20 días y cada vez mayores.
- **Primeros pasos**: ocho objetivos guiados con consejo (casa, trabajadores, segunda granja, mercado, cuartel, leva, primera incursión, invierno). Se pueden ocultar y se guardan con la partida.
- **Cadena del pan**: el **molino** (8 madera, 5 monedas) muele 4 de grano al día en harina sin tocar los últimos 10; la **panadería** (6 madera, 10 monedas) convierte 3 de harina en 5 de pan. Se come primero el pan; si más de la mitad de lo que se come es pan, **+8 de aprobación**.
- **Equipo guardado en el cuartel**: al licenciar un regimiento su equipo vuelve al cuartel y la siguiente leva no lo paga otra vez (si el regimiento huye, el equipo se pierde).
- **Animación al andar** para soldados y aldeanos; aldeanos con cabeza y túnica del color de su oficio.
- Barra superior en dos filas y avisos a la derecha.

## Modos
Arriba a la izquierda (o **Tab**): **Aldea** y **Batalla de prueba**.

## Controles comunes
**Cámara:** WASD / flechas o ratón al borde (B lo activa o desactiva) · rueda: zoom · Q / E o botón central: girar
**Tiempo:** Espacio: pausa · T: velocidad 1×/2×/3×/5× · H: ocultar ayuda

## Aldea (prototipo 0.3)
- Barra de abajo: elegir edificio · clic izquierdo: colocar · R: girar · clic derecho o Esc: dejar de construir
- Las casas se colocan en serie; Mayús+clic coloca varias de cualquier otro tipo
- Clic en un edificio: panel con trabajadores (+/−) y demoler
- Las familias **sin trabajo** son las que construyen las obras (hasta 3 por obra)

### Reglas de la aldea
| Edificio | Coste | Qué hace |
| --- | --- | --- |
| Casa | 4 madera | Aloja una familia; en invierno quema 0,3 madera/día |
| Leñador | 3 madera | 2,2 madera/día por trabajador si hay 30+ árboles a 45 m; tala el bosque poco a poco |
| Granja | 5 madera | Comida por trabajador y día: primavera 1, verano 2,2, otoño 3, invierno 0 |
| Almacén | 6 madera | +150 de capacidad de cada recurso (base 100) |
| Mercado | 8 madera, 10 monedas | Con un tendero: 0,25 monedas/día por familia con casa y +10 de aprobación |
| Cuartel | 10 madera, 30 monedas | Leva de regimientos en la fase 3 |

- Cada familia come 0,8 comida/día. Un día dura 40 s a 1×; cada estación, 10 días.
- **Aprobación** (pasa el ratón por encima para ver el desglose): 50 de base, +15 con comida o −35 con hambre, +10 si todos tienen casa o −15 si no, −20 si en invierno no hay leña, +10 con mercado.
- Con 50% o más y casas libres llega una familia cada día y medio; por debajo de 30% se van.

## Defensa y incursiones (prototipo 0.4)
- **Cuartel** (10 madera, 30 monedas): en su panel, *Reclutar lanceros* (hasta 8 familias; 2 madera y 1 moneda por familia) o *Reclutar arqueros* (hasta 6 familias; 3 madera y 2 monedas por familia). Hacen falta al menos 3 familias en casa.
- Cada familia aporta **4 hombres**. Mientras sirven no trabajan (pero comen). Al **licenciar** el regimiento (botón en su tarjeta) los supervivientes vuelven a casa y a su antiguo trabajo.
- Cada baja es un hombre de una familia concreta. Una familia que pierde a todos sus hombres **abandona la aldea** y deja la casa vacía. Las bajas dan «Luto» (−8 de aprobación).
- Las tropas se manejan en la misma vista de la aldea: clic o recuadro para elegir, 1–9, clic derecho para mover o atacar, arrastrar para trazar el frente.
- **Incursiones** desde el oeste, con 2 días de aviso: día 20 (22 ladrones), día 38 (26 saqueadores y 14 arqueros) y día 58 (30 lanceros, 26 de mesnada y 18 ballesteros).
- Si nadie les sale al paso, **saquean** la aldea durante un día: se llevan el 30% de lo almacenado, nadie trabaja y la aprobación cae 20 durante 8 días.
- Si los derrotas: botín de monedas y +15 de aprobación durante 6 días.
- La partida termina tras la tercera incursión (o si la aldea se queda sin familias).

## Batalla de prueba (3 contra 3, aparte de la partida)
- Clic izquierdo: seleccionar · arrastrar: recuadro · Mayús: añadir · 1–3 o tarjetas: elegir · Ctrl+A: todos
- Clic derecho en el suelo: mover · sobre un enemigo: atacar · arrastrar con clic derecho: trazar el frente · X: alto
- Intro: empezar · R: reiniciar

## Reglas de combate (resumen)
- Moral: baja con las bajas, las cargas, los flancos y la retaguardia, las flechas y la huida de aliados. A 0, el regimiento huye.
- Los lanceros quietos y de frente aguantan las cargas; cargar contra ellos cuesta moral.
- Las flechas pueden alcanzar a cualquiera: disparar a una melé hiere a los tuyos.
- La infantería sin órdenes responde a enemigos a menos de ~20 m.

## Desarrollar (opcional, requiere Node.js 20+)
```
npm install
npm run dev      # recompila dist/index.html al guardar
npm run build    # build final minificado
npm run check    # comprobación de tipos
```

## Estructura
```
src/
  main.ts              escena, luz, bucle principal
  camera/rtsCamera.ts  cámara RTS
  world/terrain.ts     terreno procedural, río, explanada de la aldea
  world/forest.ts      bosques instanciados
  world/noise.ts       ruido con semilla
  world/navgrid.ts     cuadrícula de navegación y A*
  data/units.ts        estadísticas de los tipos de regimiento
  combat/battle.ts     simulación: formaciones, combate, flechas, moral, IA
  combat/view.ts       dibujo de soldados, estandartes, flechas y marcas
  combat/controls.ts   selección y órdenes del jugador
  ui/hud.ts            tarjetas de regimiento y avisos
  world/forest.ts      bosques (talables) · world/atmosphere.ts: día, noche y estaciones
  data/buildings.ts    edificios y números de la economía
  settlement/village.ts       simulación de la aldea
  settlement/villagers.ts     rutina diaria de los aldeanos
  settlement/models.ts        modelos low-poly de los edificios
  settlement/villageView.ts   dibujo de edificios, campos, aldeanos y fantasma
  settlement/villageControls.ts  construir y seleccionar
  ui/villageHud.ts     recursos, construcción, panel y avisos
  campaign/campaign.ts leva, incursiones y fin de partida
  core/save.ts         guardar y cargar · core/settings.ts: ajustes
  audio/audio.ts       sonido y música generados
  world/particles.ts   humo y fuego
  ui/menu.ts           menú principal y de pausa
```
