# Usar una imagen base oficial de Python
FROM python:3.9-slim

# Instalar ffmpeg y otras utilidades
RUN apt-get update && apt-get install -y ffmpeg build-essential

# Establecer el directorio de trabajo dentro del contenedor
WORKDIR /app

# Copiar el archivo de requerimientos e instalar las dependencias de Python
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade -r requirements.txt

# Copiar el resto del código del backend
COPY . .

# Comando para ejecutar la aplicación
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]