# Open Model Prism — Helm Chart

Kubernetes deployment chart for [Open Model Prism](https://github.com/weisser-dev/open-model-prism).

## Install

```bash
helm install model-prism ./helm \
  --namespace model-prism \
  --create-namespace
```

Port-forward to access the setup wizard:

```bash
kubectl port-forward svc/model-prism 3000:80 -n model-prism
# → http://localhost:3000
```

## Scaled deployment (control plane + workers)

```bash
helm install model-prism ./helm \
  --namespace model-prism \
  --create-namespace \
  --set mode=scaled \
  --set externalMongodb.uri="mongodb+srv://..." \
  --set mongodb.enabled=false
```

## Configuration

| Parameter | Default | Description |
|-----------|---------|-------------|
| `mode` | `standalone` | `standalone` or `scaled` |
| `image.repository` | `ghcr.io/weisser-dev/open-model-prism` | Image repository |
| `image.tag` | `""` (appVersion) | Image tag |
| `config.nodeEnv` | `production` | Node environment |
| `config.logLevel` | `info` | Log level |
| `config.offline` | `false` | Air-gapped mode |
| `secrets.jwtSecret` | `""` (auto-generated) | JWT signing secret |
| `secrets.encryptionKey` | `""` (auto-generated) | AES-256-GCM key (32 chars) |
| `mongodb.enabled` | `true` | Deploy bundled MongoDB |
| `externalMongodb.uri` | `""` | External MongoDB URI |
| `ingress.enabled` | `false` | Enable ingress |
| `scaled.worker.autoscaling.enabled` | `true` | Enable HPA for workers |

See [values.yaml](values.yaml) for the full reference.
