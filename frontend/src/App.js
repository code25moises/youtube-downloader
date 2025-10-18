// frontend/src/App.js

import React, { useState, useEffect, useRef } from 'react';
import './App.css';

function App() {
  const [url, setUrl] = useState('');
  const [jobId, setJobId] = useState(null);
  const [status, setStatus] = useState('');
  const [progress, setProgress] = useState(0);
  const [downloadJobId, setDownloadJobId] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [previewInfo, setPreviewInfo] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isUrlValid, setIsUrlValid] = useState(false);
  const [availableFormats, setAvailableFormats] = useState([]);
  const [selectedQuality, setSelectedQuality] = useState('best');
  const [isQualityMenuOpen, setIsQualityMenuOpen] = useState(false);

  const qualityMenuRef = useRef(null);
  const intervalRef = useRef(null);

  const fetchDetails = (pastedUrl) => {
    const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.?be)\/.+/;
    if (!youtubeRegex.test(pastedUrl)) {
      setPreviewInfo(null); setIsLoading(false); setIsUrlValid(false);
      return;
    }
    setIsUrlValid(true); setIsLoading(true); setPreviewInfo(null); setAvailableFormats([]);

    fetch('http://localhost:8000/video-details', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: pastedUrl }),
    })
      .then(response => response.ok ? response.json() : Promise.reject('Error de red'))
      .then(data => {
        setPreviewInfo({ title: data.title, thumbnail: data.thumbnail, artist: data.uploader });
        setAvailableFormats(data.formats);
        if (data.formats.length > 0) setSelectedQuality(data.formats[0]);
      })
      .catch(error => console.warn('La previsualización falló.', error))
      .finally(() => setIsLoading(false));
  };

  const handleUrlChange = (e) => {
    const newUrl = e.target.value;
    setUrl(newUrl);
    if (newUrl === '') {
      setPreviewInfo(null); setIsLoading(false); setIsUrlValid(false); setAvailableFormats([]);
    }
  };

  const handlePaste = (e) => {
    const pastedText = e.clipboardData.getData('text');
    setUrl(pastedText);
    fetchDetails(pastedText);
  };

  // --- NUEVA FUNCIÓN PARA 'Enter' ---
  const handleKeyPress = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault(); // Evita que el formulario se envíe
      fetchDetails(url);
    }
  };

  const startDownload = (formatType, quality = null) => {
    if (!previewInfo) return;
    setIsQualityMenuOpen(false);
    setJobId(null); setStatus(`Iniciando descarga...`); setProgress(0);
    setDownloadJobId(null); setErrorMessage(''); clearInterval(intervalRef.current);

    fetch('http://localhost:8000/start-processing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: url, format_type: formatType, quality: quality, title: previewInfo.title, artist: previewInfo.artist }),
    })
      .then(response => response.json())
      .then(data => {
        if (data.job_id) {
          setJobId(data.job_id); setStatus('Procesando...');
          intervalRef.current = setInterval(() => checkStatus(data.job_id), 1000);
        }
      })
      .catch(error => { console.error('Error al iniciar el proceso:', error); setStatus('Error al iniciar'); });
  };

  const handleQualitySelect = (format) => {
    setSelectedQuality(format);
    setIsQualityMenuOpen(false);
  };

  useEffect(() => {
    function handleClickOutside(event) {
      if (qualityMenuRef.current && !qualityMenuRef.current.contains(event.target)) {
        setIsQualityMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [qualityMenuRef]);

  const checkStatus = (id) => {
    fetch(`http://localhost:8000/status/${id}`)
      .then(response => response.json())
      .then(data => {
        setStatus(data.status); setProgress(data.progress); setErrorMessage(data.error_message);
        if (data.status === 'completed' || data.status === 'failed') {
          if (data.status === 'completed') setDownloadJobId(data.download_url);
          clearInterval(intervalRef.current); setJobId(null);
        }
      }).catch(error => {
        console.error('Error al verificar estado:', error);
        setStatus('failed'); clearInterval(intervalRef.current); setJobId(null);
      });
  };

  useEffect(() => { return () => clearInterval(intervalRef.current); }, []);

  const isDisabled = isLoading || !isUrlValid;

  return (
    <div className="App">
      <div className="downloader-card">
        <h1>DESCARGA TU VIDEO</h1>
        <p>Pega el enlace de YouTube para comenzar.</p>

        <form className="url-form">
          <input
            type="text"
            className="url-input"
            value={url}
            onChange={handleUrlChange}
            onPaste={handlePaste}
            onKeyPress={handleKeyPress} // --- CAMBIO: Usamos onKeyPress en lugar de onBlur
            placeholder="https://www.youtube.com/watch?v=..."
          />
        </form>

        {isLoading && <p className="status-text">Cargando detalles del video...</p>}
        {previewInfo && !jobId && (<div className="video-preview"> <img src={previewInfo.thumbnail} alt="Miniatura" className="preview-thumbnail" /> <p className="preview-title">{previewInfo.title}</p> </div>)}
        {isUrlValid && !jobId && (
          <div className="button-group">
            <div className="split-button-container" ref={qualityMenuRef} data-disabled={isDisabled}>
              <button onClick={() => startDownload('video', selectedQuality)} className="split-button-main" disabled={isDisabled}> {selectedQuality === 'best' ? 'Máxima Calidad' : selectedQuality} </button>
              <button className="split-button-trigger" onClick={() => !isDisabled && setIsQualityMenuOpen(!isQualityMenuOpen)} disabled={isDisabled}> ▼ </button>
              {isQualityMenuOpen && (
                <div className="quality-menu">
                  {availableFormats.length > 0 ? (
                    availableFormats.map(format => (<button key={format} className="quality-menu-item" onClick={() => handleQualitySelect(format)}> {format === 'best' ? 'Máxima Calidad' : format} </button>))
                  ) : (<div className="quality-menu-item">Cargando...</div>)}
                </div>
              )}
            </div>
            <button onClick={() => startDownload('audio')} className="download-button audio-button" disabled={isDisabled}> Descargar Audio (MP3) </button>
          </div>
        )}

        {jobId && (<div className="status-section"> <p className="status-text">Estado: <strong>{status}</strong></p> <div className="progress-bar-container"><div className="progress-bar-fill" style={{ width: `${progress}%` }}></div></div> </div>)}
        {status === 'failed' && (<div className="download-section" style={{ backgroundColor: '#ffebe9', marginTop: '20px' }}> <p className="download-ready-text" style={{ color: '#d93025' }}>Error</p> <p style={{ color: '#d93025' }}>{errorMessage || 'Ocurrió un error desconocido.'}</p> </div>)}
        {downloadJobId && status === 'completed' && (
          <div className="download-section">
            <p className="download-ready-text">¡Tu video está listo!</p>
            <a href={`http://localhost:8000/download/${downloadJobId}`} className="final-download-link">
              Descargar Archivo
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;