# Houston HackCamp - Track A: Zero-Trust Multi-Tenant Agent Engine

## Visión General

El **Track A** nos desafía a construir infraestructura para desplegar **10,000 agentes de forma segura**, asegurando que un inquilino no pueda acceder a los datos de otro en un VPS compartido. 

Basándonos en la arquitectura nativa de **Houston** (donde el motor supervisa procesos CLI como Claude o Codex) y **tomando como punto de partida su PR experimental de *Cloud-mode* (Supabase Edge Function `provision-tenant` conectada a K8s)**, hemos estructurado la solución en **4 segmentos fundamentales** que garantizan seguridad de grado empresarial, escalamiento masivo a bajo costo y visibilidad total. Además, hemos identificado las vulnerabilidades arquitectónicas a largo plazo y sus mitigaciones.

---

## Segmento 1: Aislamiento y Seguridad (Zero-Trust)
Este segmento asegura que incluso si un LLM es vulnerado mediante *Prompt Injection*, el atacante queda atrapado en una "caja de arena" inofensiva.

* **Aislamiento de Infraestructura (K8s):**
  * **Namespace Exclusivo:** Cada tenant corre en un namespace aislado.
  * **SecurityContext Extremo:** Los pods corren sin privilegios (`runAsNonRoot: true`), se les retiran todas las capacidades del kernel (`drop: ALL`), y su sistema de archivos es de solo lectura (`readOnlyRootFilesystem: true`).
* **Protección de Red (Default Deny):** 
  * Se bloquea por defecto todo el tráfico. Solo se permite el tráfico *Egress* (salida) hacia puertos 443 para las APIs de LLMs, y hacia la IP/Puerto específico del Servidor MCP de ese Tenant. Bloqueo total hacia la red interna del clúster (`10.0.0.0/8`).
* **Inyección Segura de Credenciales (Vault):**
  * Los tokens (ej. el `HOUSTON_ENGINE_TOKEN` y configuraciones estáticas) **nunca** tocan el disco. Se inyectan directamente en memoria RAM (`tmpfs`) usando **HashiCorp Vault + CSI Secret Store**.

---

## Segmento 2: Escalamiento (Stateful Serverless y Bifurcación de Estado)
**¿Por qué no usar Kubernetes `Jobs`?** Los `Jobs` nativos están diseñados para procesos *batch* (ejecutar un script finito y morir al terminar). Sin embargo, `houston-engine-server` necesita mantener **conexiones WebSocket de larga duración** para que el usuario pueda chatear en tiempo real. Un Job no puede gestionar el ciclo de vida interactivo ni el *graceful shutdown* requerido por un servidor de WebSockets de forma eficiente.

Para resolver esto, implementamos un modelo de **Stateful Serverless**, el mismo estándar arquitectónico que utilizan empresas como **Vercel** (para Serverless Functions), **Replit** (para workspaces instantáneos) o **Fly.io** (para microVMs escaladas a cero):

* **Warm Pools (Piscinas Tibias) y Pods Dinámicos:** 
  * El clúster mantiene una reserva de pods "genéricos" pre-calentados ejecutando el motor en Rust (que en reposo casi no consume RAM).
  * Cuando un usuario se conecta, el Router le asigna un pod de esta reserva (*Just-in-Time*), eliminando el retardo natural de K8s de crear contenedores desde cero.
  * Al desconectarse (cierre del WebSocket) y expirar su tiempo de inactividad, el pod hace un backup final y es destruido, liberando recursos.
* **Bifurcación del Estado (Para un Cold Start < 1s):**
  * **Micro-Estado (Efímero y Encriptado):** Tokens de login dinámicos (ej. `~/.codex/auth.json`). Pesa Kilobytes. Se encripta con KMS y se guarda en S3. Al asignarse el pod, se hidrata en milisegundos en la RAM.
    * *Retención (S3 Lifecycle):* Una regla automática de S3 borra estos archivos tras 30 días de inactividad para ahorrar costos y reducir riesgos. Si el usuario vuelve el día 31, su pod arranca sin tokens y Houston le pedirá re-autenticarse (su historial de chats sigue intacto).
  * **Macro-Estado (Pesado e Histórico):** Historial de chats y archivos. Pesa Gigabytes. **No se descarga al pod**. Se usa **LibSQL/Turso** conectada de forma remota por red y los archivos se leen por streaming directo desde S3.
* **Resultado:** El usuario mantiene su WebSocket abierto y fluido, el pod arranca instantáneamente gracias a la piscina tibia y la hidratación ligera, y los costos de almacenamiento a largo plazo se reducen drásticamente.

---

## Segmento 3: Observabilidad (Detección de Malicia)
Como Houston delega el trabajo haciendo `spawn` de procesos CLI, necesitamos monitorear a nivel de sistema operativo para detectar ataques.

* **Detección de Syscalls con eBPF (Falco):**
  * Implementamos reglas a nivel kernel: El proceso `houston-engine` solo está autorizado para hacer *spawn* de `claude`, `codex` y `gemini-cli`.
  * Si un atacante inyecta un comando y el motor intenta ejecutar `/bin/bash` o `curl`, Falco intercepta la llamada al sistema, **bloquea la ejecución** y envía una alerta crítica.
* **Telemetría de Red Visual (Cilium / Hubble):**
  * Reemplazamos la red estándar de K8s por Cilium. Esto nos permite ver en **Grafana/Hubble** un mapa de dependencias en vivo, marcando en verde el tráfico a la API de Anthropic y en rojo cualquier paquete descartado por intentar movimientos laterales.

---

## Segmento 4: Control Plane (El Multi-Tenant Router)
Inspirados en la Supabase Edge Function (`provision-tenant`) propuesta en el PR de modo Cloud de Houston, evolucionamos este concepto básico a un orquestador Zero-Trust real que sirve de puente entre las aplicaciones cliente y los motores efímeros.

* **API Gateway / Supabase Edge Function:**
  * Recibe las peticiones de los clientes (App Web en *Cloud-mode*).
  * Autentica al usuario verificando su JWT y determina su Tenant.
  * Si el motor del usuario no está activo, se comunica directamente con la API REST de Kubernetes para crear el entorno aislado (Segmento 1) y orquestar la hidratación (Segmento 2).
  * Retorna la URL del Pod y el Token, de manera que el `EngineWebSocket` de React se reconecte transparentemente al clúster aislando el tráfico.

---

## 5. Puntos Débiles y Lógica de Negocio (Q&A Anticipado de Jueces)

Cualquier arquitectura a esta escala presenta *trade-offs*. Aquí exponemos los retos del "Día 2" y cómo los aborda el diseño:

1. **El Problema del "Cold Start" (Retardo en el primer mensaje):**
   * *Problema:* Incluso con la hidratación rápida de S3, Kubernetes tarda entre 2 y 4 segundos en programar (schedule) un pod nuevo. Para un usuario de chat, esperar 4 segundos para que se envíe su primer mensaje es mala UX.
   * *Mitigación propuesta:* **Warm Pools (Piscinas Tibias).** El Control Plane mantiene una reserva de pods "vacíos" y "limpios" ya ejecutándose. Cuando un tenant se conecta, el proxy le asigna un pod de la piscina y le inyecta sus secretos vía API interna en milisegundos, eliminando la latencia de K8s.

2. **Gestión de Cuotas (Rate Limiting de APIs de LLMs):**
   * *Problema:* Si 1,000 agentes se despiertan a la vez y ejecutan `claude`, Anthropic bloqueará la IP del clúster por exceso de peticiones (Rate Limit `HTTP 429`).
   * *Mitigación propuesta:* El **Houston Router** (Segmento 4) debe implementar un Rate Limiter con Redis antes de enrutar la petición. Si la cuota global de la plataforma o la del tenant se excede, el Router encola las peticiones o devuelve un error amigable sin saturar la API del proveedor.

3. **Atribución de Costos (Billing):**
   * *Problema:* Al ser infraestructura efímera, ¿cómo le cobramos al usuario? 
   * *Mitigación propuesta:* El Router emite eventos al finalizar la conexión WebSocket calculando el `uptime` del Pod (tiempo de cómputo en segundos). Además, mediante telemetría en el motor o proxies L7 (como un API Gateway frente a las llamadas a OpenAI/Anthropic), se cuentan los `tokens` exactos consumidos por el tenant para facturación por uso real.

4. **El Límite de Inodos / IPs en un único VPS:**
   * *Problema:* K8s nativo consume muchas IPs de la subred para pods, e intentar meter 10,000 agentes en un VPS estándar (ej. 32GB RAM) podría agotar el pool de red o colapsar el plano de control (API Server).
   * *Mitigación propuesta:* Uso de **vClusters** o reemplazar los Pods completos por un runtime ultra-ligero como **WebAssembly (Wasm)** o **Firecracker microVMs** si la densidad escala por encima de lo que K8s puede orquestar en un solo nodo. Para el alcance del hackathon, el límite de 10,000 concurrentes asume escalado a cero (ej. 500 activos a la vez).

---

## Plan para la Demo del Hackathon (Loom)

1. **La Eficiencia:** Mostrar cómo al abrir la app de Houston, el Router asigna un Pod de la *Warm Pool*. El `InitContainer` descarga el micro-estado en milisegundos y el agente responde casi al instante.
2. **El Ataque:** Intentar ejecutar un script malicioso en el agente para leer `/etc/passwd` o conectar al Servidor MCP del `Tenant B`. Explicar cómo la arquitectura deniega el acceso.
3. **La Defensa Visual:** Mostrar Grafana. Los jueces verán el intento de *spawn* de bash neutralizado por Falco (Seguridad) y el tráfico de red dropeado por Cilium. Mostrar el dashboard de facturación simulando la atribución de costos del ataque.

---

## 6. Listado de Archivos Creados/Modificados

Para esta arquitectura, los siguientes archivos se han creado o modificado dentro del repositorio base de Houston:

### 🆕 Nuevos Archivos (Control Plane y Zero-Trust K8s)
* `cloud/provision-tenant-zerotrust/index.ts`: **El Gateway/Router.** Edge Function (Deno) que orquesta la creación dinámica de los entornos Zero-Trust por inquilino.
* `cloud/k8s-manifests/00-namespace-rbac.yaml`: Configuración de Namespace aislado y `ServiceAccount` restrictivo.
* `cloud/k8s-manifests/01-netpol.yaml`: Políticas de red (Default Deny y Egress restringido para LLMs y MCP).
* `cloud/k8s-manifests/02-engine-deployment.yaml`: Deployment del Motor con `InitContainers` para hidratación desde S3, Externalización a Turso/LibSQL, e inyección en memoria de llaves MCP vía Vault CSI.
* `cloud/security/falco-rules.yaml`: Reglas eBPF para detectar `spawn` de procesos no autorizados y escrituras en el FS fuera del volumen efímero.

### 📝 Archivos Modificados (Endurecimiento Local)
* `always-on/docker-compose.yml`: Se le inyectaron las *flags* de seguridad (`read_only: true`, `cap_drop: ALL`, `no-new-privileges: true`) para emular el SecurityContext estricto de Kubernetes durante las pruebas locales.