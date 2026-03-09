# =============================================================================
# docker/flask/Dockerfile
# OSPF Country Topology — Optimized Patched Flask (Single-Stage with Cleanup)
# =============================================================================
#
# PURPOSE
# ───────
# Single-stage build with aggressive cleanup to reduce image size from 3.35 GB to <1.3 GB:
#   - Remove 3 unused virtual environments (~1.02 GB)
#   - Remove tests directory (~1.7 MB)
#   - Remove build tools after they're no longer needed
#   - All cleanup happens in the same layer to avoid layer bloat
#
# OPTIMIZATIONS APPLIED
# ─────────────────────
#   - Remove 3 unused virtual environments (~1.02 GB)
#   - Remove tests directory (~1.7 MB)
#   - Purge build tools (gcc, g++, make) after Cython compilation
#   - Clean apt caches and temporary files
#
# =============================================================================

FROM vadims06/topolograph:latest

LABEL maintainer="OSPF Country Topology — Optimized Flask"
LABEL description="Topolograph Flask <1.3GB (single-stage optimized)"

# Single RUN layer: cleanup + copy patches
# This ensures all cleanup happens in one layer, reducing final image size
RUN rm -rf /home/flask/flask/venv1 \
           /home/flask/flask/venv311 \
           /home/flask/flask/venv311_fab \
           /home/flask/flask/tests && \
    apt-get purge -y --auto-remove gcc g++ make build-essential && \
    rm -rf /var/lib/apt/lists/* /root/.cache/pip /tmp/* /var/tmp/*

# Copy patched files (Sprint 3 + layout-persistence + security)
COPY docker/flask/topolograph.js /home/flask/flask/static/js/topolograph.js
COPY docker/flask/layout-persistence.js /home/flask/flask/static/js/layout-persistence.js
COPY docker/flask/security_overlay.py /home/flask/flask/security_overlay.py
COPY 06-STEP-BY-STEP/docker-patches/base.html /home/flask/flask/templates/base.html
COPY docker/flask/host_to_dns_name_mapping.html /home/flask/flask/templates/host_to_dns_name_mapping.html
COPY docker/flask/security-token-create.html /home/flask/flask/templates/security-token-create.html
COPY docker/flask/security-token-list.html /home/flask/flask/templates/security-token-list.html

CMD ["gunicorn", "--worker-class", "eventlet", "-w", "1", "--bind", "0.0.0.0:5000", "--timeout", "90", "security_overlay:app"]
