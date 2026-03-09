FROM python:3.11-slim
WORKDIR /app
COPY docker/layout-service/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt
COPY docker/layout-service/app.py /app/app.py
COPY docker/layout-service/spf_calculator.py /app/spf_calculator.py
COPY docker/layout-service/migrations /app/migrations
EXPOSE 8090
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8090"]
