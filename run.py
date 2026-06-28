import os
import uvicorn

if __name__ == "__main__":
    host = os.getenv("HOST", "127.0.0.1")
    port = int(os.getenv("PORT", "8000"))
    # Disable reload in production/docker environments by default
    reload_val = os.getenv("RELOAD", "true").lower() == "true"
    
    print(f"Starting AIOps Dynamic Alerting & RCA Engine (V3 Modular) on {host}:{port}...")
    uvicorn.run("app.main:app", host=host, port=port, reload=reload_val)
