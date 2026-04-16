{{/*
Expand the name of the chart.
*/}}
{{- define "model-prism.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this
(by the DNS naming spec). If release name contains chart name it will be used as
a full name.
*/}}
{{- define "model-prism.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "model-prism.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels.
*/}}
{{- define "model-prism.labels" -}}
helm.sh/chart: {{ include "model-prism.chart" . }}
{{ include "model-prism.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels.
*/}}
{{- define "model-prism.selectorLabels" -}}
app.kubernetes.io/name: {{ include "model-prism.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Control plane labels (scaled mode).
*/}}
{{- define "model-prism.controlLabels" -}}
{{ include "model-prism.labels" . }}
app.kubernetes.io/component: control
{{- end }}

{{- define "model-prism.controlSelectorLabels" -}}
{{ include "model-prism.selectorLabels" . }}
app.kubernetes.io/component: control
{{- end }}

{{/*
Worker labels (scaled mode).
*/}}
{{- define "model-prism.workerLabels" -}}
{{ include "model-prism.labels" . }}
app.kubernetes.io/component: worker
{{- end }}

{{- define "model-prism.workerSelectorLabels" -}}
{{ include "model-prism.selectorLabels" . }}
app.kubernetes.io/component: worker
{{- end }}

{{/*
Create the name of the service account to use.
*/}}
{{- define "model-prism.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "model-prism.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Return the name of the Secret to use.
*/}}
{{- define "model-prism.secretName" -}}
{{- if .Values.secrets.existingSecret }}
{{- .Values.secrets.existingSecret }}
{{- else }}
{{- include "model-prism.fullname" . }}
{{- end }}
{{- end }}

{{/*
Return the MongoDB URI.
When the bundled subchart is enabled, construct the URI from the subchart service name.
Otherwise use the externalMongodb.uri value.
*/}}
{{- define "model-prism.mongoUri" -}}
{{- if .Values.mongodb.enabled }}
{{- printf "mongodb://%s-mongodb:27017/openmodelprism" (include "model-prism.fullname" .) }}
{{- else }}
{{- .Values.externalMongodb.uri }}
{{- end }}
{{- end }}

{{/*
Return the container image reference.
*/}}
{{- define "model-prism.image" -}}
{{- $tag := default .Chart.AppVersion .Values.image.tag }}
{{- printf "%s:%s" .Values.image.repository $tag }}
{{- end }}

{{/*
Effective resources for a given component.
Falls back to top-level .Values.resources when component-level resources are empty.
Usage: {{ include "model-prism.effectiveResources" (dict "component" .Values.standalone.resources "default" .Values.resources) }}
*/}}
{{- define "model-prism.effectiveResources" -}}
{{- if .component }}
{{- toYaml .component }}
{{- else }}
{{- toYaml .default }}
{{- end }}
{{- end }}
