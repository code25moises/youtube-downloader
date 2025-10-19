# backend/main.py

import os
import subprocess
import time
import uuid
import json
import re
from fastapi import FastAPI, BackgroundTasks, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import Optional, List

app = FastAPI()

# --- Configuración de CORS ---
origins = ["*"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Ruta de descargas ---
DOWNLOADS_DIR = "downloads"
os.makedirs(DOWNLOADS_DIR, exist_ok=True)

# --- Base de datos en memoria ---
jobs = {}

# --- Modelos de Datos ---
class JobRequest(BaseModel):
    url: str
    format_type: str
    quality: Optional[str] = None
    title: str
    artist: str

class InfoRequest(BaseModel):
    url: str

class JobStatus(BaseModel):
    status: str
    progress: int
    download_url: Optional[str] = None
    error_message: Optional[str] = None

class VideoDetails(BaseModel):
    title: str
    thumbnail: str
    uploader: str
    formats: List[str]

def sanitize_filename(name: str) -> str:
    cleaned_name = re.sub(r'[\(\[].*?[\)\]]', '', name)
    cleaned_name = re.sub(r'[\\/*?:"<>|]', '', cleaned_name)
    return cleaned_name.strip()

# --- Función de Tarea Real ---
def process_video_task(job_id: str, youtube_url: str, format_type: str, quality: Optional[str], title: str, artist: str):
    print(f"Iniciando trabajo '{format_type}' @ '{quality}': {job_id}")
    jobs[job_id]['status'] = 'processing'
    jobs[job_id]['progress'] = 10

    try:
        clean_title = sanitize_filename(title)
        clean_artist = sanitize_filename(artist)

        # --- CAMBIO CLAVE: AÑADIMOS USER-AGENT ---
        base_command = [
            "yt-dlp", "--no-playlist", "--add-metadata", "--embed-thumbnail",
            "--parse-metadata", f"{clean_artist}:%(artist)s",
            "--parse-metadata", f"{clean_artist}:%(album)s",
            "--user-agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.36"
        ]
        
        if clean_title.lower().startswith(clean_artist.lower()):
            base_filename = clean_title
        else:
            base_filename = f"{clean_artist} - {clean_title}"

        if format_type == 'video':
            server_filename, user_filename = f"{job_id}.mp4", f"{base_filename}.mp4"
        elif format_type == 'audio':
            server_filename, user_filename = f"{job_id}.mp3", f"{base_filename}.mp3"
        else: raise ValueError("Invalid format type")
        
        output_path = os.path.join(DOWNLOADS_DIR, server_filename)
        
        if format_type == 'video':
            format_selector = "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best"
            if quality and quality != 'best':
                quality_val = quality.replace('p', '')
                format_selector = f"bestvideo[height<=?{quality_val}][ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4][height<=?{quality_val}]"
            command = base_command + ["-f", format_selector, "--merge-output-format", "mp4", "-o", output_path, youtube_url]
        else:
            command = base_command + ["-f", "bestaudio", "--extract-audio", "--audio-format", "mp3", "--audio-quality", "0", "-o", output_path, youtube_url]

        subprocess.run(command, check=True, capture_output=True, text=True, timeout=300)
        jobs[job_id]['progress'] = 100; jobs[job_id]['status'] = 'completed'; jobs[job_id]['download_url'] = job_id; jobs[job_id]['filename'] = user_filename; jobs[job_id]['filepath'] = output_path
    except Exception as e:
        error_message = "Ocurrió un error inesperado."
        if isinstance(e, subprocess.TimeoutExpired): error_message = "El proceso tardó demasiado."
        elif isinstance(e, subprocess.CalledProcessError): error_message = e.stderr.strip().split('\n')[-1]
        jobs[job_id]['status'] = 'failed'; jobs[job_id]['error_message'] = error_message

# --- Endpoints de la API ---
@app.post("/video-details", response_model=VideoDetails)
def get_video_details(request: InfoRequest):
    try:
        # --- CAMBIO CLAVE: AÑADIMOS USER-AGENT ---
        command = [
            "yt-dlp", "--no-playlist", "--print-json", "--skip-download", request.url,
            "--user-agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.36"
        ]
        result = subprocess.run(command, check=True, capture_output=True, text=True, timeout=30)
        video_data = json.loads(result.stdout)
        
        parsed_artist = video_data.get("artist") or video_data.get("uploader", "Artista Desconocido")
        parsed_title = video_data.get("track") or video_data.get("title", "Título no disponible")
        
        available_heights = set()
        for f in video_data.get("formats", []):
            if f.get("vcodec") != "none" and f.get("height"):
                available_heights.add(f['height'])
        
        desired_qualities_map = { '1440p': 1440, '1080p': 1080, '720p': 720, '480p': 480, '360p': 360, '240p': 240 }
        final_formats = ['best']
        for label, height_val in desired_qualities_map.items():
            if any(h >= height_val for h in available_heights):
                if label not in final_formats:
                    final_formats.append(label)

        return VideoDetails(title=parsed_title, thumbnail=video_data.get("thumbnail", ""), uploader=parsed_artist, formats=final_formats)
    
    except subprocess.CalledProcessError as e:
        print(f"ERROR DETALLADO de yt-dlp: {e.stderr}")
        raise HTTPException(status_code=400, detail=f"yt-dlp falló: {e.stderr.strip().splitlines()[-1]}")
    except Exception as e:
        print(f"ERROR INESPERADO al obtener detalles: {e}")
        raise HTTPException(status_code=500, detail="Error interno del servidor al procesar la URL.")

@app.post("/start-processing", status_code=202)
def start_processing_endpoint(request: JobRequest, background_tasks: BackgroundTasks):
    job_id = str(uuid.uuid4())
    jobs[job_id] = { 'status': 'starting', 'progress': 0 }
    background_tasks.add_task(process_video_task, job_id, request.url, request.format_type, request.quality, request.title, request.artist)
    return {"job_id": job_id}

@app.get("/status/{job_id}", response_model=JobStatus)
def get_status_endpoint(job_id: str):
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job ID no encontrado.")
    return job

@app.get("/download/{job_id}")
def download_file(job_id: str):
    job = jobs.get(job_id)
    if not job or job['status'] != 'completed':
        raise HTTPException(status_code=404, detail="Archivo no encontrado o no está listo.")
    filepath = job.get('filepath')
    filename = job.get('filename', 'download')
    return FileResponse(path=filepath, filename=filename, media_type='application/octet-stream')