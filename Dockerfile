# --- Stage 1: Build the React frontend ---
FROM node:20-alpine AS frontend-builder
WORKDIR /frontend

# Copy package descriptors and lock file
COPY frontend/package*.json ./
RUN npm ci

# Copy frontend source code and build dist
COPY frontend/ ./
RUN npm run build

# --- Stage 2: Build the FastAPI backend ---
FROM python:3.11-slim
WORKDIR /app

# Install system dependencies if needed (e.g. for building C-libraries, although slim usually is fine)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install python dependencies
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend source code
COPY app/ ./app
COPY run.py ./

# Copy built React files from Stage 1 into the location expected by main.py
COPY --from=frontend-builder /frontend/dist ./frontend/dist

# Expose backend port
EXPOSE 8000

# Set environment variables
ENV PORT=8000
ENV HOST=0.0.0.0

# Start the uvicorn application
CMD ["python", "run.py"]
