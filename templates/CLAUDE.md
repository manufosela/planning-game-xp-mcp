# Geniova Technologies - Development Guidelines

Este entorno tiene integrado el **Planning Game MCP**, un sistema de gestion de proyectos agiles basado en eXtreme Programming (XP) desarrollado por Geniova Technologies.

## Planning Game MCP - Multi-instancia

Hay multiples instancias del Planning Game MCP conectadas a distintos proyectos Firebase. Cada instancia se identifica por su `firebaseProjectId`.

**Como elegir la instancia correcta:**
- Si ves varias instancias (ej: `planning-game-pro`, `planning-game-personal`), usa `get_mcp_status` en cada una para ver su `firebaseProjectId`
- Usa la instancia cuyo Firebase corresponda al proyecto en el que estas trabajando
- Si el proyecto pertenece al catalogo de Geniova Technologies (ver tabla de proyectos abajo), usa la instancia de Geniova (`planning-gamexp`)
- Si no estas seguro, pregunta al usuario que instancia usar
- Una vez identificada la instancia correcta, usa SOLO esa instancia durante toda la sesion

## Planning Game MCP - Herramientas disponibles

Usa las herramientas del MCP `planning-game` para gestionar el trabajo:

| Herramienta | Uso |
|-------------|-----|
| `list_projects` / `get_project` | Consultar proyectos |
| `list_cards` / `get_card` / `create_card` / `update_card` | Gestionar tareas, bugs, epicas, proposals, QA |
| `relate_cards` | Crear relaciones entre cards (related, blocks/blockedBy) |
| `get_transition_rules` | Ver reglas de transicion de estados antes de actualizar |
| `list_sprints` / `get_sprint` / `create_sprint` | Gestionar sprints |
| `list_developers` / `list_stakeholders` | Consultar equipo |
| `list_adrs` / `get_adr` / `create_adr` | Architecture Decision Records |
| `list_global_config` / `get_global_config` | Configuraciones globales (guias, prompts, agentes) |
| `get_mcp_status` / `update_mcp` | Estado y actualizacion del MCP |
| `setup_mcp_user` | Configurar identidad del usuario |

## Contexto por proyecto (OBLIGATORIO)

Cuando trabajes en un proyecto Geniova, ANTES de empezar a codificar, consulta el contexto especifico del proyecto:

### 1. Guidelines del proyecto
Ejecutar `get_project(projectId)` y leer el campo `agentsGuidelines`. Contiene reglas especificas del proyecto: ficheros criticos, workflow particular, restricciones, etc. Seguir estas directrices durante toda la sesion.

### 2. ADRs (Architecture Decision Records)
Ejecutar `list_adrs(projectId)` para ver las decisiones arquitectonicas vigentes. Si hay ADRs con status "accepted", leer los relevantes con `get_adr` antes de tomar decisiones de diseno. Respetar SIEMPRE las decisiones arquitectonicas existentes.

### 3. Configuraciones globales
Consultar con `list_global_config` las guias compartidas entre todos los proyectos:
- `type=instructions`: Estandares de codigo, testing, seguridad, UI/UX
- `type=prompts`: Prompts para estimacion, criterios de aceptacion, analisis de bugs, code review
- `type=agents`: Configuracion de agentes (BecarIA Developer, BecarIA Code Reviewer)

Usar `get_global_config(type, configId)` para leer el contenido completo de las configuraciones relevantes para la tarea en curso.

### Cuando consultar cada recurso
| Recurso | Cuando |
|---------|--------|
| `agentsGuidelines` | SIEMPRE al empezar a trabajar en un proyecto |
| ADRs | Antes de decisiones de arquitectura, modelo de datos o tecnologia |
| Instructions | Cuando necesites verificar estandares de codigo, testing o seguridad |
| Prompts | Al estimar tareas, generar criterios de aceptacion o analizar bugs |
| Agents | Al configurar comportamiento de BecarIA para el proyecto |

## Reglas obligatorias del Planning Game

### Sprints
- El campo `sprint` DEBE ser un ID existente (ej: "PRJ-SPR-0001")
- NUNCA usar texto libre como "Sprint 1" o "Febrero 2026"
- Usar `list_sprints` para ver sprints disponibles

### Prioridad de tareas
- NO establecer `priority` directamente en tareas
- Se calcula automaticamente: `(businessPoints / devPoints) * 100`
- SIEMPRE proporcionar `devPoints` y `businessPoints` durante el Planning Game
- Escala: 1 (maxima prioridad) a 25 (sistema 1-5) o 36 (fibonacci)

### IDs de entidades
- Developers: prefijo `dev_` (ej: "dev_001")
- Validators/Stakeholders: prefijo `stk_` (ej: "stk_001")
- Usar `list_developers` y `list_stakeholders` para consultar disponibles

### Epicas
- Toda tarea DEBE pertenecer a una epica existente
- Usar `list_cards type=epic` del proyecto para ver epicas disponibles
- Si ninguna epica existente encaja con la tarea, proponer crear una nueva con `create_card type=epic`

### Asignacion de tareas realizadas por IA
Cuando una IA (Claude Code, BecarIA, o cualquier agente) ejecuta una tarea o bug:
- `developer`: SIEMPRE establecer a **BecarIA** (`dev_016`), independientemente de lo que tuviera antes
- `codeveloper`: Establecer al usuario que solicita el trabajo (obtener su ID de `setup_mcp_user` o `mcp.user.json`)
- Si la tarea ya tenia otro developer asignado, **cambiarlo** a BecarIA y mover el anterior a codeveloper si aplica
- Esta regla es obligatoria para medir correctamente los trabajos realizados con IA

### Campos requeridos para crear tareas (status "To Do")
- `title`: Titulo descriptivo
- `descriptionStructured`: Formato `[{role, goal, benefit}]` (Como/Quiero/Para)
- `acceptanceCriteria` o `acceptanceCriteriaStructured` (Given/When/Then)
- `epic`: ID de epica existente

### Transiciones de estado de tareas

#### To Do → In Progress
Campos requeridos: `developer`, `validator`, `epic`, `sprint`, `devPoints`, `businessPoints`, `acceptanceCriteria`
- Registrar SIEMPRE `startDate` con la fecha/hora actual (formato ISO: "YYYY-MM-DDTHH:mm:ssZ")
- Recordar: si la IA ejecuta la tarea, `developer` = BecarIA (dev_016), `codeveloper` = usuario solicitante

#### In Progress → To Do
- Guardar registro de la parada: fecha/hora de vuelta a To Do
- Esto permite tracking del tiempo real invertido

#### In Progress → To Validate
Campos requeridos: `startDate`, `commits`
- Registrar `endDate` con la fecha/hora de finalizacion
- Incluir SIEMPRE los commits realizados: `[{hash, message, date, author}]`

#### In Progress → Blocked
- Indicar `blockedByBusiness` o `blockedByDevelopment`
- Incluir motivo (`bbbWhy`/`bbbWho` o `bbdWhy`/`bbdWho`)

#### To Validate → (Done / Done&Validated)
- El MCP NO puede realizar esta transicion
- Solo los validators pueden aprobar tareas

#### Reopened → In Progress / To Validate
- Mismos requisitos que la transicion original

**IMPORTANTE**: Llamar SIEMPRE a `get_transition_rules` antes de cambiar estados para verificar requisitos actualizados.

### Bugs
Estados: Created → Assigned → Fixed → Verified → Closed

Prioridades validas:
- APPLICATION BLOCKER
- DEPARTMENT BLOCKER
- INDIVIDUAL BLOCKER
- USER EXPERIENCE ISSUE
- WORKFLOW IMPROVEMENT
- WORKAROUND AVAILABLE ISSUE

Al cerrar un bug (status="Closed"):
- `commits`: Array de commits `[{hash, message, date, author}]`
- `rootCause`: Causa raiz del bug
- `resolution`: Como se resolvio

### Implementation Plan
Rellenar ANTES de implementar cuando:
- `devPoints >= 3`
- La tarea afecta a mas de 2 ficheros
- Requiere cambios en modelo de datos o APIs
- Hay multiples enfoques posibles

Incluir: `approach`, `steps` (1 paso = 1 commit), `dataModelChanges`, `apiChanges`, `risks`, `outOfScope`

## Catalogo de Proyectos Geniova

### Plataforma dental (core business)
| Proyecto | Abrev | Tech Stack | Descripcion |
|----------|-------|------------|-------------|
| Extranet V2 | EX2 | Next, Tailwind, TypeScript | Portal del doctor para crear y seguir tratamientos dentales |
| Intranet | NTR | Next, Tailwind, Firebase, TypeScript | Produccion y seguimiento interno de tratamientos |
| Intranet-Extended | IEX | Next, Firebase, JavaScript | Intranet para externos (digital/impresion externa) |
| Visor-Editor | VSR | Next, Three.js, JavaScript | Visualizacion y edicion 3D de tratamientos dentales |
| Cinema4D | C4D | Python | Diseno 3D automatizado para tratamientos |
| Geniova Platform | PLT | Astro, Lit, Firebase, JS | Plataforma completa (Extranet+Intranet+DB+S3+Bot) |

### Herramientas internas
| Proyecto | Abrev | Tech Stack | Descripcion |
|----------|-------|------------|-------------|
| PlanningGame | PLN | Astro, Lit, Firebase, JS | App web de gestion de proyectos XP |
| Planning Game MCP | PMC | Node.js, MCP SDK, Firebase, Vitest | MCP Server para integracion con LLMs |
| Portal de Incidencias | PRT | Astro, Lit, Firebase, JS | Gestion de incidencias internas y de doctores |
| Auth&Sign | A&S | Astro, Lit, Firebase, JS | Login unico (user/pass y Microsoft) |
| Inventario | NVN | Astro, Lit, Firebase, JS | Inventario Geniova |
| Geniova Space | GSP | Astro, Lit, Firebase, JS | Reserva de mesas calientes y salas |
| Geniova Link | GNL | Astro, Lit, JS | Portal de links de portales y plataformas |
| Firestore-Myadmin | FMA | Lit, Web Components, Firebase | Gestor multi-proyecto de Firestore (estilo PHPMyAdmin) |
| Web Geniova | WGN | WordPress, Lit, Vite, PHP | Web corporativa |

### Gestion y soporte
| Proyecto | Abrev | Tech Stack | Descripcion |
|----------|-------|------------|-------------|
| IT | _IT | Varios | Desarrollos de IT e infraestructura |
| IA | _IA | Python, varios | Proyectos de inteligencia artificial |
| Desarrollos en SAP | DSR | SAP | Desarrollos y personalizaciones en SAP |
| Marketing | MRK | Varios | Proyectos y campanas de marketing |

## Estandares de Desarrollo

### Estilo de codigo
- Principios: **SOLID**, **DRY**, **KISS**, **YAGNI**
- `const` por defecto, `let` solo cuando sea necesario
- Arrow functions para callbacks, template literals para strings con variables
- Evitar `any` en TypeScript, definir tipos especificos
- Variables y funciones nombradas en ingles, descriptivamente
- Sin fallbacks silenciosos: el sistema funciona o falla, nunca silenciosamente
- Cadenas `||` para datos criticos esta PROHIBIDO

### Commits y PRs
- **Conventional Commits**: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`
- Mensaje corto (<70 chars) en primera linea
- NUNCA incluir referencias a Claude o IA en commits
- Maximo ~300 lineas cambiadas por PR (ideal < 200)
- PRs atomicas: un solo proposito (1 feature, 1 fix, 1 refactor)
- Separar infraestructura/refactor de cambios funcionales
- Cada PR debe compilar y pasar tests por si sola

### Testing (obligatorio)
- **Test-first**: verificar/crear tests ANTES de modificar codigo
- Ejecutar tests despues de CADA cambio significativo
- Frameworks: **Vitest** (unit/integration), **Playwright** (E2E)
- Coverage minimo: servicios 80%, utilidades 90%, componentes 70%
- Si fallan tests, ARREGLAR antes de continuar
- NUNCA saltar tests

### Seguridad
- SIEMPRE validar entrada del usuario
- Sanitizar datos (XSS), parameterized queries (SQL injection)
- NUNCA commitear credenciales, API keys, secrets
- `serviceAccountKey.json` NUNCA en git
- Firebase: reglas de seguridad en Firestore/RTDB, validar permisos en Cloud Functions
- No exponer Admin SDK en cliente

### UI/UX
- NUNCA usar `alert()`, `confirm()`, `prompt()` nativos del navegador
- Usar siempre el sistema de modales de la aplicacion (ModalService, AppModal)
- Loading/spinner durante operaciones asincronas
- Notificaciones toast para feedback (SlideNotification)
- Mobile-first, responsive, accesible
- Labels en todos los inputs, contraste suficiente, navegacion por teclado

## Herramientas de validacion

### Chrome DevTools MCP
Si el MCP `chrome-devtools` esta disponible, usarlo para:
- Verificar visualmente los cambios en el navegador despues de implementar
- Tomar snapshots/screenshots para documentar cambios de UI
- Depurar errores de consola y problemas de red
- Probar interacciones de usuario (click, fill, navigation)
- Validar responsive y accesibilidad

### SonarQube MCP
Si el MCP `sonarqube` esta disponible, usarlo para:
- Analizar la calidad del codigo ANTES de hacer commit
- Verificar que no se introducen code smells, bugs o vulnerabilidades
- Comprobar el estado del quality gate del proyecto
- Consultar las reglas de SonarQube para resolver issues
- Usar `npx @sonar/scan` para ejecutar analisis locales

**SonarQube requiere que el servidor Docker este corriendo.** Antes de usar el MCP sonarqube o ejecutar `npx @sonar/scan`:
1. Verificar que SonarQube esta activo: `docker ps | grep sonarqube`
2. Si no esta corriendo, arrancarlo: `docker start sonarqube-db sonarqube`
3. Si no existe el contenedor: `docker compose -f ~/sonarqube/docker-compose.yml up -d`
4. Esperar ~30 segundos a que arranque antes de ejecutar analisis

### Cuando usar cada herramienta
- **Chrome DevTools**: Siempre que haya cambios visuales (UI, CSS, componentes web)
- **SonarQube**: Siempre que haya cambios de codigo antes de hacer commit

## Workflow de desarrollo

1. Leer la tarea completa y sus criterios de aceptacion
2. **Crear rama** desde main para la tarea o bug (ej: `feat/PLN-TSK-0042-descripcion` o `fix/PLN-BUG-0015-descripcion`)
3. Verificar que existen tests o crearlos primero (TDD)
4. Si `devPoints >= 3`, rellenar `implementationPlan` antes de codificar
5. Implementar cambios incrementalmente (commits pequenos y atomicos)
6. Ejecutar tests despues de cada cambio significativo (Vitest / Playwright)
7. **Validar calidad con SonarQube** (`npx @sonar/scan` o MCP sonarqube) - corregir issues antes de commitear
8. **Verificar visualmente con Chrome DevTools MCP** si hay cambios de UI
9. Push de la rama y **crear Pull Request** hacia main
10. Al pasar a "To Validate": incluir `endDate`, `commits` y verificar que todos los tests y quality gates pasen

## Ramas y despliegue

### Ramas
- Crear SIEMPRE una rama por cada tarea o bug antes de empezar a trabajar
- Naming: `feat/{CARD-ID}-descripcion-corta` para tareas, `fix/{CARD-ID}-descripcion-corta` para bugs
- Toda rama se mergea a main mediante Pull Request, nunca push directo a main

### Despliegue
- **NUNCA desplegar automaticamente** salvo que el usuario lo indique explicitamente
- Si no se ha indicado que se despliegue, **preguntar antes** de ejecutar cualquier accion de deploy
- Esto aplica a: `firebase deploy`, `npm run deploy`, `docker push`, `git push` a ramas de produccion, o cualquier otra accion que afecte a entornos compartidos

## Escalas de estimacion

### devPoints (esfuerzo tecnico)
| Puntos | Descripcion |
|--------|-------------|
| 1 | Trivial, < 1 hora, cambio de una linea |
| 2 | Simple, 1-4 horas, cambios localizados |
| 3 | Medio, 1 dia, multiples archivos |
| 4 | Complejo, 2-3 dias, multiples sistemas |
| 5 | Muy complejo, > 3 dias, arquitectura |

### businessPoints (valor de negocio)
| Puntos | Descripcion |
|--------|-------------|
| 1 | Nice to have, sin impacto en negocio |
| 2 | Mejora menor, UX mejorada |
| 3 | Importante, afecta productividad |
| 4 | Critico, bloquea flujos de trabajo |
| 5 | Urgente, perdida de dinero/clientes |
