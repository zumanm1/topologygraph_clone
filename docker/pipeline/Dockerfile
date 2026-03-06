# =============================================================================
# docker/pipeline/Dockerfile
# OSPF Country Topology — Pipeline container
# =============================================================================
#
# PURPOSE
# ───────
# Runs the full bash+Python pipeline inside a container:
#   workflow.sh all        → upload OSPF → fetch graph → enrich → collapse → push
#   topology-country-tool.sh
#   push-to-ui.py
#   generate-collapse-config.py
#   fetch-from-api.sh
#
# The project root is mounted at /app inside the container so all output
# files (IN-OUT-FOLDER/, OUTPUT/) land on the host via bind-mount.
#
# TOOLS INSTALLED
# ───────────────
#   bash 5.x     — all shell scripts
#   python3      — push-to-ui.py, generate-collapse-config.py
#   requests     — Python HTTP library for API calls
#   pyyaml       — YAML output in generate-collapse-config.py
#   curl         — API calls in shell scripts
#   jq           — JSON parsing in fetch-from-api.sh
#   gawk (awk)   — OSPF file parsing in topology-country-tool.sh
#   git           — version info in workflow.sh (optional)
# =============================================================================

FROM python:3.11-slim

LABEL maintainer="OSPF Country Topology Pipeline"
LABEL description="Pipeline container: bash + Python + curl + jq + gawk"

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
        bash \
        curl \
        jq \
        gawk \
        git \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
RUN pip install --no-cache-dir requests pyyaml

# Working directory — project root will be mounted here
WORKDIR /app

# Default: keep container alive for `docker exec` triggers
# Override with: docker exec pipeline bash terminal-script/workflow.sh all
CMD ["sleep", "infinity"]
