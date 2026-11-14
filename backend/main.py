
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(
    title="LUNAR SIGHT API",
    description="Independent Lunar Mission Planning Platform",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def home():
    return {
        "project": "LUNAR SIGHT",
        "status": "online",
        "message": "Lunar mission platform running"
    }

@app.get("/api/health")
def health():
    return {
        "status": "healthy",
        "backend": "operational"
    }
