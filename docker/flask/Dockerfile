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
#   topolograph-docker/init/topolograph.js
#   06-STEP-BY-STEP/docker-patches/base.html
#
# =============================================================================

FROM vadims06/topolograph:latest

LABEL maintainer="OSPF Country Topology — Patched Flask"
LABEL description="Topolograph Flask with Sprint 3 JS + Analysis navbar"

# Copy the patched Sprint 3 JavaScript (Cost Matrix, What-If, Collapsing,
# UNK filter, _refreshCostMatrix fix)
COPY topolograph-docker/init/topolograph.js \
     /home/flask/flask/static/js/topolograph.js

# Copy the patched navbar template (Analysis dropdown)
COPY 06-STEP-BY-STEP/docker-patches/base.html \
     /home/flask/flask/templates/base.html

# No CMD override — use the upstream entrypoint (Gunicorn)
