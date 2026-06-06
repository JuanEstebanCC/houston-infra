# 🚀 Houston Zero-Trust Multi-Tenant Engine

**Houston HackCamp 2026 - Presentación para el Track A**

Este repositorio contiene la arquitectura, el código de infraestructura y la demostración para desplegar **10,000 agentes de Houston de forma segura** en un entorno multi-tenant.

Resuelve el desafío principal de seguridad y escalabilidad: *¿Cómo evitamos que un agente comprometido (vía Prompt Injection) robe credenciales de otros inquilinos o consuma todos los recursos del VPS?*

## 🏗️ La Arquitectura (Defensa en Profundidad)

Evolucionamos el motor nativo de Houston hacia un modelo **Stateful Serverless** (inspirado en Vercel/Fly.io) con seguridad de confianza cero (Zero-Trust):

1. **Aislamiento a nivel Kernel (Infraestructura):** Cada agente corre en un Pod de Kubernetes efímero con sistema de archivos de solo lectura, sin privilegios (`runAsNonRoot: true`) y sin capacidades de kernel (`drop: ALL`).
2. **Aislamiento de Red (Default Deny):** Políticas de red estrictas permiten salida solo hacia APIs autorizadas (OpenAI/Anthropic) y hacia el Servidor MCP exclusivo del tenant.
3. **Persistencia sin Discos (Bifurcación de Estado):** Eliminamos los costosos PVCs. El historial pesado vive en Turso/LibSQL remoto, mientras que las credenciales de sesión se hidratan desde S3 (`InitContainers`) y Vault (CSI) en milisegundos.
4. **Observabilidad eBPF:** Usamos **Falco** para monitorear las llamadas al sistema (bloqueando si un agente intenta spawnear `/bin/bash`) y **Cilium** para telemetría de red.

> 📖 **Lee el plan completo en:** [PLAN_ARQUITECTURA.md](./PLAN_ARQUITECTURA.md)
> 🎥 **Guión del Pitch:** [PITCH.md](./PITCH.md)

## 📂 Estructura del Repositorio

Hemos integrado nuestro código directamente sobre la base de Houston para demostrar viabilidad real:

* `houston-infra/cloud/provision-tenant-zerotrust/index.ts`: **El Control Plane**. Una evolución de la Edge Function de Supabase para orquestar la creación de pods aislados en K8s.
* `houston-infra/cloud/k8s-manifests/`: Manifiestos YAML de K8s (NetworkPolicies, Deployments, InitContainers).
* `houston-infra/cloud/security/falco-rules.yaml`: Reglas de seguridad eBPF para detectar comportamientos maliciosos del motor.
* `houston-infra/always-on/docker-compose.yml`: Hemos **endurecido (hardened)** el entorno de Docker local inyectando restricciones similares a K8s para la demo.
* `demo-headless/client.js`: Script de Node.js para ejecutar la demostración de conexión y simular el ataque.

## 🚀 Cómo correr la Demo Local

Para la demostración del hackathon, probaremos la seguridad del contenedor endurecido ejecutando un flujo Headless.

### Prerrequisitos
* Docker y Docker Compose instalados.
* Node.js (v18+)

### Pasos

1. **Levantar el Engine Seguro:**
   Ingresa a la carpeta del motor y levántalo. El archivo `docker-compose.yml` ha sido modificado para emular el *SecurityContext* de Kubernetes (`read_only: true`, `cap_drop: ALL`).
   ```bash
   cd houston-infra/always-on
   cp .env.example .env
   # Asegúrate de configurar un token en el .env, ej: HOUSTON_ENGINE_TOKEN=demo-token
   docker compose up -d
   ```

2. **Ejecutar el Cliente de Prueba:**
   Abre una nueva terminal, exporta tu token y ejecuta el simulador.
   ```bash
   export HOUSTON_ENGINE_TOKEN="demo-token"
   node demo-headless/client.js
   ```

3. **Ver el resultado:**
   El script comprobará la salud del servidor, simulará una petición legítima y luego lanzará un **Payload de Prompt Injection** diseñado para romper el aislamiento. 
   La salida explicará cómo la infraestructura (Sistemas de solo lectura, Reglas eBPF de Falco y Cilium) neutraliza la amenaza en milisegundos.

---
*Hecho con 🩵 para el Houston HackCamp 2026*