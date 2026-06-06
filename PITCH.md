# Houston HackCamp - Pitch Track A

**Tiempo Objetivo:** 3 minutos
**Formato:** Video Loom + Demo en Vivo (Finalistas)

---

## 0:00 - 0:30 | El Problema y El Gancho
"Hola a todos, somos el equipo [Nombre]. Elegimos el Track A porque correr un agente es fácil, pero correr 10,000 en un entorno compartido es una pesadilla de seguridad y costos. 

El problema es claro: Si un agente sufre un *prompt injection* y ejecuta código malicioso, puede robar las credenciales de los demás 9,999 agentes. 

Investigando el código fuente de Houston, encontramos su PR experimental de *'cloud-mode'*, que usaba una Edge Function de Supabase para aprovisionar pods en K8s. Nosotros tomamos esa visión cruda y la evolucionamos a nivel Enterprise: construimos el **Zero-Trust Multi-Tenant Engine**. Una arquitectura basada en Defensa en Profundidad y Stateful Serverless."

## 0:30 - 1:30 | La Arquitectura (Visual apoyado en el Diagrama)
"Nuestra solución se basa en tres pilares:

**Primero, Seguridad Extrema:** Los agentes no corren libres. El motor de Houston se ejecuta en un Pod de Kubernetes aislado: sin permisos de root, sin sistema de archivos escribible y con una política de red de 'Denegación por Defecto'. Literalmente, el agente está encerrado en una caja fuerte.

**Segundo, Costo Cero en Reposo:** No usamos *Jobs* ni discos costosos. Usamos el modelo *Stateful Serverless* que usan Vercel o Replit. Tenemos una piscina de Pods pre-calentados. Cuando te conectas, te asignamos uno y un *InitContainer* hidrata tu micro-estado desde S3 en milisegundos. Cuando te vas, el Pod muere. Escalamiento infinito por centavos.

**Tercero, Observabilidad a nivel de Kernel:** Como Houston hace *spawn* de subprocesos, inyectamos **Falco y Cilium**. Si un LLM engañado intenta abrir una terminal bash o escanear la red, lo vemos y lo matamos antes de que se ejecute."

## 1:30 - 2:30 | La Demo (En vivo o Grabada)
*[Mostrar la pantalla compartida dividida: Izquierda App de Houston o CLI, Derecha Grafana/Terminal K8s]*

"Miremos esto en acción.
Aquí tenemos el Control Plane. Asigno un agente al Tenant A. *(Se ve como el Pod arranca rápido)*. El agente responde perfectamente. Todo el historial vive en Turso, y sus llaves secretas fueron inyectadas en memoria vía HashiCorp Vault.

Ahora, seamos los malos. Voy a intentar un *Prompt Injection* para que el agente ejecute un comando de sistema prohibido o intente alcanzar al Servidor MCP del Tenant B."

*(Se ejecuta el prompt malicioso)*

"Miren a la derecha. En milisegundos, nuestro dashboard de Grafana se ilumina. **Falco** interceptó la llamada al sistema bloqueando el proceso no autorizado, y **Cilium** marcó en rojo el paquete de red descartado. El atacante falló, y el Tenant B nunca estuvo en riesgo."

## 2:30 - 3:00 | Cierre y Visión a Futuro
"En conclusión, no solo logramos correr Houston de forma segura, sino que lo hicimos escalable.

A largo plazo, esta arquitectura está lista para el 'Día 2'. Solucionamos el temido *Cold Start* bifurcando el estado: el historial pesado vive en base de datos externas, y solo los tokens ligeros se hidratan desde S3. Además, si el usuario está inactivo por 30 días, el estado se auto-elimina para ahorrar costos y minimizar riesgos de seguridad.

Esta es infraestructura empresarial para la era de los agentes. Muchas gracias."