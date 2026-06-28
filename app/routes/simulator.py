import os
import time
import math
import requests
import threading
import gc
from fastapi import APIRouter, HTTPException, Depends, Request
from sqlalchemy.orm import Session
from app.database import get_db
from app.routes.auth import verify_admin_role
from app.services.audit import log_audit

router = APIRouter(prefix="/api/simulator", tags=["simulator"])

# Shared Simulator State
stop_simulator = threading.Event()
simulator_threads = []
simulator_status = "normal"
sim_lock = threading.Lock()

# ----------------------------------------------------
# Simulator Worker Functions
# ----------------------------------------------------
def cpu_stress_worker():
    print("Simulator: Starting CPU & Process stressor...")
    while not stop_simulator.is_set():
        # Spin CPU
        for _ in range(50000):
            _ = math.factorial(150)
        time.sleep(0.01)
    print("Simulator: CPU stressor stopped.")

def memory_leak_worker():
    print("Simulator: Starting Memory leak stressor...")
    leaked_blocks = []
    try:
        while not stop_simulator.is_set():
            # Allocate 45 MB block
            block = bytearray(45 * 1024 * 1024)
            # Physical write commit
            for i in range(0, len(block), 4096):
                block[i] = 1
            leaked_blocks.append(block)
            
            # Cap leak to 600MB
            if len(leaked_blocks) > 14:
                leaked_blocks.pop(0)
                
            for _ in range(6):
                if stop_simulator.is_set():
                    break
                time.sleep(1)
    except MemoryError:
        print("Simulator: Out of Memory in simulation!")
    finally:
        leaked_blocks.clear()
        gc.collect()
        print("Simulator: Memory leak stressor stopped.")

def disk_io_worker():
    print("Simulator: Starting Disk I/O stressor...")
    temp_filename = "scratch_sim_disk_io.tmp"
    data = os.urandom(10 * 1024 * 1024)  # 10MB chunk
    try:
        while not stop_simulator.is_set():
            # Write chunk
            with open(temp_filename, "wb") as f:
                f.write(data)
                f.flush()
                os.fsync(f.fileno())
            # Read chunk
            with open(temp_filename, "rb") as f:
                _ = f.read()
            
            time.sleep(0.05)
    except Exception as e:
        print(f"Simulator: Disk I/O stressor error: {e}")
    finally:
        if os.path.exists(temp_filename):
            try:
                os.remove(temp_filename)
            except:
                pass
        print("Simulator: Disk I/O stressor stopped.")

def network_io_worker():
    print("Simulator: Starting Network I/O stressor...")
    while not stop_simulator.is_set():
        try:
            requests.get("https://httpbin.org/delay/0", timeout=1.5)
        except:
            pass
        time.sleep(0.1)
    print("Simulator: Network I/O stressor stopped.")

# ----------------------------------------------------
# API Endpoints
# ----------------------------------------------------
@router.get("/status")
def get_simulator_status_route():
    global simulator_status
    with sim_lock:
        return {"status": simulator_status}

@router.post("/cpu")
def trigger_cpu_simulation(request: Request, db: Session = Depends(get_db), current_user = Depends(verify_admin_role)):
    global simulator_status, simulator_threads
    with sim_lock:
        if simulator_status != "normal":
            raise HTTPException(status_code=400, detail="A simulation is already active. Stop it first.")
        stop_simulator.clear()
        simulator_threads = [
            threading.Thread(target=cpu_stress_worker, daemon=True)
        ]
        for t in simulator_threads:
            t.start()
        simulator_status = "cpu"
        
        ip = request.client.host if request.client else "unknown"
        user = current_user.get("username", "admin")
        log_audit(db, username=user, action="START_SIMULATION", target="CPU Stressor", details="CPU simulation worker started.", ip_address=ip)
        
        return {"message": "CPU & Process simulation successfully triggered."}

@router.post("/memory")
def trigger_memory_simulation(request: Request, db: Session = Depends(get_db), current_user = Depends(verify_admin_role)):
    global simulator_status, simulator_threads
    with sim_lock:
        if simulator_status != "normal":
            raise HTTPException(status_code=400, detail="A simulation is already active. Stop it first.")
        stop_simulator.clear()
        simulator_threads = [
            threading.Thread(target=memory_leak_worker, daemon=True)
        ]
        for t in simulator_threads:
            t.start()
        simulator_status = "memory"
        
        ip = request.client.host if request.client else "unknown"
        user = current_user.get("username", "admin")
        log_audit(db, username=user, action="START_SIMULATION", target="Memory Leak", details="Memory leak simulation worker started.", ip_address=ip)
        
        return {"message": "Memory Leak simulation successfully triggered."}

@router.post("/disk")
def trigger_disk_simulation(request: Request, db: Session = Depends(get_db), current_user = Depends(verify_admin_role)):
    global simulator_status, simulator_threads
    with sim_lock:
        if simulator_status != "normal":
            raise HTTPException(status_code=400, detail="A simulation is already active. Stop it first.")
        stop_simulator.clear()
        simulator_threads = [
            threading.Thread(target=disk_io_worker, daemon=True)
        ]
        for t in simulator_threads:
            t.start()
        simulator_status = "disk"
        
        ip = request.client.host if request.client else "unknown"
        user = current_user.get("username", "admin")
        log_audit(db, username=user, action="START_SIMULATION", target="Disk IO", details="Disk IO simulation worker started.", ip_address=ip)
        
        return {"message": "Disk I/O simulation successfully triggered."}

@router.post("/network")
def trigger_network_simulation(request: Request, db: Session = Depends(get_db), current_user = Depends(verify_admin_role)):
    global simulator_status, simulator_threads
    with sim_lock:
        if simulator_status != "normal":
            raise HTTPException(status_code=400, detail="A simulation is already active. Stop it first.")
        stop_simulator.clear()
        simulator_threads = [
            threading.Thread(target=network_io_worker, daemon=True)
        ]
        for t in simulator_threads:
            t.start()
        simulator_status = "network"
        
        ip = request.client.host if request.client else "unknown"
        user = current_user.get("username", "admin")
        log_audit(db, username=user, action="START_SIMULATION", target="Network IO", details="Network IO simulation worker started.", ip_address=ip)
        
        return {"message": "Network I/O simulation successfully triggered."}

@router.post("/stop")
def stop_simulation(request: Request, db: Session = Depends(get_db), current_user = Depends(verify_admin_role)):
    global simulator_status, simulator_threads
    with sim_lock:
        if simulator_status == "normal":
            return {"message": "No active simulations running."}
            
        old_status = simulator_status
        stop_simulator.set()
        for t in simulator_threads:
            t.join(timeout=1.0)
            
        simulator_threads = []
        simulator_status = "normal"
        gc.collect()
        
        ip = request.client.host if request.client else "unknown"
        user = current_user.get("username", "admin")
        log_audit(db, username=user, action="STOP_SIMULATION", target=old_status, details=f"Simulator stopped. Previous active simulation: {old_status}.", ip_address=ip)
        
        return {"message": "All simulation threads halted. State metrics reset."}
