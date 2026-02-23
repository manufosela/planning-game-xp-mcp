# Geniova Technologies - Knowledge Base

## Stack tecnologico predominante

### Frontend interno (mayoria de proyectos)
- **Astro** como framework de paginas (SSG/SSR)
- **Lit Web Components** para componentes reutilizables
- **Firebase** (Firestore, RTDB, Auth, Functions, Storage, FCM) como backend

### Frontend plataforma dental
- **Next.js** + **Tailwind** (Extranet V2, Intranet, Intranet-Extended)
- **Three.js** para visualizacion 3D (Visor-Editor)

### Backend
- **Firebase Firestore** y/o **Realtime Database** segun el proyecto
- **Cloud Functions** para logica de servidor
- **Firebase Auth** para autenticacion
- **Minio S3** para almacenamiento de ficheros (Geniova Platform)

### Otros stacks
- **Python** para Cinema4D (diseno 3D automatizado)
- **WordPress** + **Lit** + **Vite** para Web Geniova
- **Node.js** + **MCP SDK** para Planning Game MCP
- **SAP** para integraciones empresariales

### Testing y validacion
- **Vitest** para unit tests e integration tests
- **Playwright** para tests E2E (end-to-end)
- **SonarQube** para analisis estatico de calidad de codigo (Docker local en http://localhost:9000)
- **Chrome DevTools MCP** para testing visual, debugging y validacion de UI en navegador

## Contexto dinamico por proyecto

Cada proyecto en Planning Game puede tener:
- **agentsGuidelines**: Reglas especificas del proyecto (ficheros criticos, restricciones, workflow)
- **ADRs**: Decisiones arquitectonicas (accepted, proposed, deprecated, superseded)
- **Configs globales**: Instrucciones, prompts y agents compartidos entre proyectos

Consultar SIEMPRE `get_project` + `list_adrs` al empezar a trabajar en un proyecto.
Consultar `list_global_config` para instrucciones de codigo, testing, seguridad, estimacion y code review.

## Patrones arquitectonicos

- Web Components con **Lit** para componentes reutilizables entre proyectos
- Firebase Firestore y/o RTDB como backend segun necesidades del proyecto
- Optimizacion de modelo de datos: usar `/views` sincronizadas con datos reales para eficientar la carga de pagina y reducir trafico de datos y costes de almacenamiento
- Astro como framework de paginas con hidratacion parcial
- MCP (Model Context Protocol) para integracion con agentes IA
- Servicios compartidos: ModalService, SlideNotification, PermissionService
- Archivos criticos en PlanningGame: firebase-service.js, permission-service.js, main.js

## Convenciones del equipo

### IDs de cards
- Formato: `{ABREV}-{TIPO}-{NUM}` (ej: PLN-TSK-0001)
- Tipos: TSK (task), BUG (bug), EPC (epic), SPR (sprint), PRP (proposal), QA_ (qa)

### Scoring
- Sistema 1-5 (lineal): mayoria de proyectos
- Sistema Fibonacci (1,2,3,5,8,13): IT, Geniova Platform, Planning Game MCP, Firestore-Myadmin
- Formula prioridad: `(businessPoints / devPoints) * 100`

### WIP (Work In Progress)
- Cada developer solo puede tener UNA tarea "In Progress" simultaneamente
- Los developers solo pueden auto-asignarse tareas (excepto SuperAdmin)

### Roles en PlanningGame
- **SuperAdmin**: Acceso total, puede asignar tareas a otros
- **Admin**: Gestion de proyecto
- **User**: Solo puede auto-asignarse tareas
- **Consultant**: Solo lectura

### PRs y code review
- PRs revisadas automaticamente por IA
- Si el diff > 300 lineas, la review se omite o es superficial
- Preferir varias PRs pequenas a una grande

## Equipo

### Agente IA
- **BecarIA** (dev_016 / becaria@ia.local): Agente IA developer/reviewer
- Actua como developer en la mayoria de proyectos
- Cuando la IA ejecuta una tarea: `developer` = BecarIA (dev_016), `codeveloper` = usuario que lo solicita
- Esto se aplica SIEMPRE, aunque la tarea tuviera otro developer asignado previamente
- Objetivo: medir correctamente el trabajo realizado por IA vs humanos

### Configuracion de usuario
- Fichero `mcp.user.json` en el directorio del MCP server
- Contiene: developerId, stakeholderId, name, email
- Tool `setup_mcp_user` para configurar interactivamente

### Prefijos
- Developers: `dev_XXX`
- Stakeholders: `stk_XXX`

## Workflow de validacion pre-commit

El orden correcto antes de hacer commit es:
1. Ejecutar tests unitarios/integracion con **Vitest**
2. Ejecutar tests E2E con **Playwright** si aplica
3. Ejecutar analisis de **SonarQube** (`npx @sonar/scan`) y corregir issues
4. Verificar visualmente con **Chrome DevTools MCP** si hay cambios de UI
5. Solo entonces hacer commit

SonarQube y Chrome DevTools MCP deben usarse SIEMPRE que esten disponibles, no son opcionales.

## Anti-patrones conocidos

- **NO** usar fallbacks silenciosos (`||` para datos criticos esta PROHIBIDO)
- **NO** usar `alert()`, `confirm()`, `prompt()` nativos del navegador
- **NO** crear PRs grandes (> 300 lineas)
- **NO** commitear sin tests ni sin pasar SonarQube
- **NO** incluir referencias a Claude/IA en commits
- **NO** modificar firebase-service.js o permission-service.js sin revision manual
- **NO** exponer Admin SDK en cliente
- **NO** commitear credenciales (serviceAccountKey.json, .env, API keys)
- **NO** usar texto libre en campos de sprint (usar IDs: "PRJ-SPR-0001")
- **NO** establecer `priority` directamente en tareas (se calcula automaticamente)
- **NO** trabajar directamente en main; crear siempre rama por tarea/bug y mergear via PR
- **NO** desplegar sin que el usuario lo pida explicitamente; preguntar siempre antes de deploy

## Decisiones arquitectonicas recurrentes

- **Lit Web Components** sobre frameworks pesados para herramientas internas
- **Firestore y/o RTDB** segun lo que tenga mas sentido para cada proyecto; optimizar modelo de datos con `/views` sincronizadas para reducir trafico y costes
- **Astro** sobre Next para proyectos internos nuevos (excepto plataforma dental que ya usa Next)
- **Evitar Tailwind** en proyectos nuevos; mantener solo donde ya esta implementado (Extranet V2, Intranet)
- **Evitar TypeScript** en proyectos nuevos; usar `.d.ts` + **JSDoc** para tipado; mantener TS solo donde ya esta implementado
- **Vitest** sobre Jest para unit/integration testing
- **Playwright** para tests E2E
- **Conventional Commits** obligatorio en todos los proyectos
