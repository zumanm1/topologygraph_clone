# =============================================================================
# docker/flask/Dockerfile
# OSPF Country Topology — Patched Flask (Topolograph) container
# =============================================================================
#
# PURPOSE
# ───────
# Extends the upstream Topolograph Flask image with our customisations
# baked in at build time — no bind-mount or `docker cp` needed:
#
#   1. topolograph.js   — Sprint 3 features (Cost Matrix, What-If, Collapsing,
#                          UNK filter, _refreshCostMatrix bug fix)
#   2. base.html        — Analysis navbar dropdown (Cost Matrix + What-If)
#
# PATCHED FILES (INSIDE CONTAINER)
# ─────────────────────────────────
#   /home/flask/flask/static/js/topolograph.js
#   /home/flask/flask/templates/base.html
#
# SOURCE FILES (BUILD CONTEXT = project root)
# ────────────────────────────────────────────
#   docker/flask/topolograph.js
#   06-STEP-BY-STEP/docker-patches/base.html
#
# =============================================================================

FROM vadims06/topolograph:latest

LABEL maintainer="OSPF Country Topology — Patched Flask"
LABEL description="Topolograph Flask with Sprint 3 JS + Analysis navbar"

# Copy the patched Sprint 3 JavaScript (Cost Matrix, What-If, Collapsing,
# UNK filter, _refreshCostMatrix fix)
COPY docker/flask/topolograph.js \
     /home/flask/flask/static/js/topolograph.js

COPY docker/flask/layout-persistence.js \
     /home/flask/flask/static/js/layout-persistence.js

COPY docker/flask/security_overlay.py \
     /home/flask/flask/security_overlay.py

# Copy the patched navbar template (Analysis dropdown)
COPY 06-STEP-BY-STEP/docker-patches/base.html \
     /home/flask/flask/templates/base.html

COPY docker/flask/host_to_dns_name_mapping.html \
     /home/flask/flask/templates/host_to_dns_name_mapping.html

COPY docker/flask/security-token-create.html \
     /home/flask/flask/templates/security-token-create.html

COPY docker/flask/security-token-list.html \
     /home/flask/flask/templates/security-token-list.html

CMD ["gunicorn", "--worker-class", "eventlet", "-w", "1", "--bind", "0.0.0.0:5000", "--timeout", "90", "security_overlay:app"]
