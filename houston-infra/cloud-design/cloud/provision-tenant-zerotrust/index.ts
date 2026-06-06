import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// K8s environment configuration (mounted inside the cluster or via KUBECONFIG)
const K8S_API_URL =
  Deno.env.get("K8S_API_URL") || "https://kubernetes.default.svc";
const K8S_TOKEN = Deno.env.get("K8S_SERVICE_ACCOUNT_TOKEN") || "";

serve(async (req) => {
  // 1. CORS Preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders() });
  }

  try {
    // 2. Authentication (Supabase JWT)
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing Authorization header");

    // Simulation: Decode the JWT to get the user ID
    const userId = "tenant-a-123"; // In production: parseJwt(authHeader).sub
    const namespace = `tenant-${userId}`;
    const engineToken = crypto.randomUUID(); // Unique token for this engine instance

    // 3. K8s Orchestration: Zero-Trust Provisioning
    console.log(
      `[Provisioner] Creating Zero-Trust environment for ${userId}...`,
    );

    await createNamespace(namespace);
    await createZeroTrustNetworkPolicy(namespace);
    await createEngineSecret(namespace, engineToken);
    await createEngineDeployment(namespace, userId, engineToken);
    await createEngineService(namespace);

    // 4. Return credentials to the Client (Web App in Cloud mode)
    // The client will use this to configure the EngineWebSocket
    return new Response(
      JSON.stringify({
        status: "provisioned",
        baseUrl: `http://engine-${namespace}.houston-cloud.svc.cluster.local:7777`,
        token: engineToken,
      }),
      { headers: { "Content-Type": "application/json", ...corsHeaders() } },
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: corsHeaders(),
    });
  }
});

// --- K8S REST HELPER FUNCTIONS (Zero-Trust Implementation) ---

async function createEngineDeployment(
  ns: string,
  userId: string,
  token: string,
) {
  const deployment = {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: { name: "houston-engine", namespace: ns },
    spec: {
      replicas: 1, // KEDA will scale this to 0 if there's no traffic
      selector: { matchLabels: { app: "houston-engine" } },
      template: {
        metadata: { labels: { app: "houston-engine", tenant: userId } },
        spec: {
          automountServiceAccountToken: false, // NO K8s API permissions
          securityContext: { runAsNonRoot: true, runAsUser: 1000 },

          // INIT CONTAINER: S3 State Hydration (Segment 2)
          initContainers: [
            {
              name: "state-hydrator",
              image: "amazon/aws-cli",
              command: [
                "sh",
                "-c",
                `aws s3 cp s3://houston-states/${userId}/state.tar.gz /data/ || true && tar -xzf /data/state.tar.gz -C /data/ || true`,
              ],
              volumeMounts: [{ name: "agent-data", mountPath: "/data" }],
            },
          ],

          containers: [
            {
              name: "engine",
              image: "houston/engine:local",
              env: [
                { name: "HOUSTON_BIND", value: "0.0.0.0:7777" },
                { name: "HOUSTON_BIND_ALL", value: "1" },
                { name: "HOUSTON_HOME", value: "/data/.houston" },
                {
                  name: "HOUSTON_ENGINE_TOKEN",
                  valueFrom: {
                    secretKeyRef: { name: "engine-secret", key: "token" },
                  },
                },
              ],
              // INFRASTRUCTURE ISOLATION (Segment 1)
              securityContext: {
                readOnlyRootFilesystem: true,
                allowPrivilegeEscalation: false,
                capabilities: { drop: ["ALL"] },
              },
              volumeMounts: [{ name: "agent-data", mountPath: "/data" }],
            },
          ],
          volumes: [{ name: "agent-data", emptyDir: { sizeLimit: "100Mi" } }],
        },
      },
    },
  };
  await k8sPost(`/apis/apps/v1/namespaces/${ns}/deployments`, deployment);
}

async function createZeroTrustNetworkPolicy(ns: string) {
  const netpol = {
    apiVersion: "networking.k8s.io/v1",
    kind: "NetworkPolicy",
    metadata: { name: "zero-trust-deny", namespace: ns },
    spec: {
      podSelector: { matchLabels: { app: "houston-engine" } },
      policyTypes: ["Ingress", "Egress"],
      ingress: [
        {
          from: [
            {
              namespaceSelector: {
                matchLabels: { name: "houston-control-plane" },
              },
            },
          ],
        },
      ],
      egress: [
        {
          ports: [
            { protocol: "TCP", port: 443 },
            { protocol: "UDP", port: 53 },
          ],
        }, // External APIs
        { to: [{ ipBlock: { cidr: "10.0.0.0/8" } }], ports: [{ port: 8080 }] }, // Only to the MCP proxy (Composio)
      ],
    },
  };
  await k8sPost(
    `/apis/networking.k8s.io/v1/namespaces/${ns}/networkpolicies`,
    netpol,
  );
}

// Stubs for brevity...
async function createNamespace(ns: string) {
  /* ... */
}
async function createEngineSecret(ns: string, token: string) {
  /* ... */
}
async function createEngineService(ns: string) {
  /* ... */
}
async function k8sPost(path: string, body: any) {
  /* Calls fetch() against K8S_API_URL */
}
function corsHeaders() {
  return { "Access-Control-Allow-Origin": "*" };
}
