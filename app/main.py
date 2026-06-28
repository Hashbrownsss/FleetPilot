import os
import threading
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

# Database and seeding
from app.services.seeder import seed_database

# ML and alert consumers
from app.ml.detector import DiurnalAnomalyDetector
from app.ml.consumer import run_ml_consumer_loop
from app.services.alerts_consumer import run_alerts_consumer_loop
from app.services.incident import run_servicenow_sync_loop
import app.ml as ml_module

# Routers
from app.routes.auth import router as auth_router
from app.routes.configurations import router as config_router
from app.routes.fleets import router as fleets_router
from app.routes.simulator import router as simulator_router
from app.routes.agents import router as agents_router
from app.routes.metrics import router as metrics_router
from app.routes.audit import router as audit_router

@asynccontextmanager
async def lifespan(app: FastAPI):
    print("FastAPI Lifespan: Initializing database seeder and migrations...")
    try:
        seed_database()
        print("FastAPI Lifespan: Database self-seeding completed.")
    except Exception as e:
        print(f"FastAPI Lifespan: Database seeder failed: {e}")
        
    print("FastAPI Lifespan: Initializing DiurnalAnomalyDetector...")
    try:
        ml_module.detector = DiurnalAnomalyDetector()
        print("FastAPI Lifespan: Detector instantiated.")
    except Exception as e:
        print(f"FastAPI Lifespan: Detector instantiation failed: {e}")
        
    print("FastAPI Lifespan: Spawning background worker threads...")
    
    # 1. Start ML Engine consumer loop
    ml_thread = threading.Thread(target=run_ml_consumer_loop, daemon=True)
    ml_thread.start()
    
    # 2. Start Backend alerts aggregation loop
    alerts_thread = threading.Thread(target=run_alerts_consumer_loop, daemon=True)
    alerts_thread.start()
    
    # 3. Start ServiceNow sync loop
    servicenow_thread = threading.Thread(target=run_servicenow_sync_loop, daemon=True)
    servicenow_thread.start()
    
    print("FastAPI Lifespan: Background threads successfully spawned.")
    yield
    print("FastAPI Lifespan: Shutting down FastAPI backend.")

app = FastAPI(title="AIOps Dynamic Alerting & RCA Engine (Modular V3)", lifespan=lifespan)

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register endpoint routes
app.include_router(auth_router)
app.include_router(config_router)
app.include_router(fleets_router)
app.include_router(simulator_router)
app.include_router(agents_router)
app.include_router(metrics_router)
app.include_router(audit_router)

# Serve React static bundle
frontend_dist = os.path.join(os.path.dirname(os.path.dirname(__file__)), "frontend", "dist")
if os.path.exists(frontend_dist):
    app.mount("/", StaticFiles(directory=frontend_dist, html=True), name="static")
    print(f"FastAPI: Mounted static React frontend from {frontend_dist}")
else:
    print(f"FastAPI WARNING: frontend/dist not found at {frontend_dist}. UI will not be served.")
