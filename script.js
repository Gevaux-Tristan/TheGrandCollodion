// Variables globales
let originalImage = null;
let textureImage = new Image();
let isProcessing = false;
let needsUpdate = false;
let previewCanvas = document.createElement('canvas');
let previewCtx = previewCanvas.getContext('2d');
let cachedImageData = null;
let isSliding = false;
let lastRenderTime = 0;
const RENDER_INTERVAL = isMobile ? 1000 / 30 : 1000 / 60;
const MOBILE_SCALE = 0.15;
const DESKTOP_SCALE = 0.3;
const isMobile = window.innerWidth <= 900;
const DEBOUNCE_DELAY = isMobile ? 16 : 8;

const contrastSlider = document.getElementById("contrast");
const opacitySlider = document.getElementById("opacity");
const grainSlider = document.getElementById("grain");
const exposureSlider = document.getElementById("exposure");
const radialBlurSlider = document.getElementById("radialBlur");
const textureSelect = document.getElementById("texture");
const customSelect = document.querySelector('.custom-select');
const selectOptions = document.querySelector('.select-options');
const settingsToggle = document.querySelector('.settings-toggle');
const settingsContent = document.querySelector('.settings-content');

// Attendre que le DOM soit complètement chargé
document.addEventListener('DOMContentLoaded', initializeApp);

function initializeApp() {
    // Initialisation des éléments DOM
    const elements = {
        canvas: document.getElementById('canvas'),
        imageInput: document.getElementById('upload'),
        previewContainer: document.getElementById('preview-container'),
        contrastSlider: document.getElementById('contrast'),
        opacitySlider: document.getElementById('opacity'),
        grainSlider: document.getElementById('grain'),
        exposureSlider: document.getElementById('exposure'),
        radialBlurSlider: document.getElementById('radialBlur'),
        downloadButton: document.getElementById('download'),
        textureSelect: document.getElementById('texture')
    };

    // Vérifier que tous les éléments sont présents
    for (const [key, element] of Object.entries(elements)) {
        if (!element) {
            console.error(`Element not found: ${key}`);
            return;
        }
    }

    // Initialiser le contexte du canvas
    const ctx = elements.canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // Initialiser la texture
    textureImage.src = "Collodion-01.png";
    elements.opacitySlider.value = "0.75";

    // Configurer les event listeners
    setupDragAndDrop(elements.previewContainer);
    setupFileUpload(elements.imageInput);
    setupSliders(elements);
    setupDownloadButton(elements.downloadButton, elements.canvas);
    setupTextureSelect(elements.textureSelect);
}

function setupDragAndDrop(previewContainer) {
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        previewContainer.addEventListener(eventName, preventDefaults);
        document.body.addEventListener(eventName, preventDefaults);
    });

    ['dragenter', 'dragover'].forEach(eventName => {
        previewContainer.addEventListener(eventName, () => highlight(previewContainer));
    });

    ['dragleave', 'drop'].forEach(eventName => {
        previewContainer.addEventListener(eventName, () => unhighlight(previewContainer));
    });

    previewContainer.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        const files = dt.files;
        if (files.length > 0) {
            loadImage(files[0]);
        }
    });
}

function setupFileUpload(imageInput) {
    imageInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files.length > 0) {
            loadImage(e.target.files[0]);
        }
    });
}

function setupSliders(elements) {
    const sliders = [
        elements.contrastSlider,
        elements.opacitySlider,
        elements.grainSlider,
        elements.exposureSlider,
        elements.radialBlurSlider
    ];

    sliders.forEach(slider => {
        slider.addEventListener('input', createSliderHandler(slider));
        slider.addEventListener('change', () => {
            isSliding = false;
            applyPreviewEffects(true);
        });
    });
}

function setupDownloadButton(downloadButton, canvas) {
    downloadButton.addEventListener('click', async () => {
        const originalText = downloadButton.innerHTML;
        downloadButton.disabled = true;
        downloadButton.innerHTML = '<span class="material-icon">hourglass_empty</span>Processing...';
        downloadButton.style.opacity = '0.7';

        try {
            const dataUrl = canvas.toDataURL('image/jpeg', 1.0);
            const link = document.createElement('a');
            link.download = 'collodion-export.jpg';
            link.href = dataUrl;
            link.click();
        } catch (error) {
            console.error('Export failed:', error);
        } finally {
            downloadButton.disabled = false;
            downloadButton.innerHTML = originalText;
            downloadButton.style.opacity = '1';
        }
    });
}

function setupTextureSelect(textureSelect) {
    textureSelect.addEventListener('change', () => {
        textureImage.src = textureSelect.value;
        textureImage.onload = () => applyPreviewEffects(true);
    });
}

function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
}

function highlight(element) {
    element.classList.add('drag-over');
}

function unhighlight(element) {
    element.classList.remove('drag-over');
}

function createSliderHandler(slider) {
    let rafId = null;
    
    return function() {
        isSliding = true;
        
        if (rafId) {
            cancelAnimationFrame(rafId);
        }
        
        rafId = requestAnimationFrame(() => {
            const now = performance.now();
            if (now - lastRenderTime >= RENDER_INTERVAL) {
                lastRenderTime = now;
                applyPreviewEffects(false);
            }
        });
    };
}

function loadImage(file) {
    const reader = new FileReader();
    reader.onload = function(e) {
        const img = new Image();
        img.onload = function() {
            const tempCanvas = document.createElement('canvas');
            const tempCtx = tempCanvas.getContext('2d');
            
            let newWidth = img.width;
            let newHeight = img.height;
            
            const pixelRatio = window.devicePixelRatio || 1;
            const MAX_DIMENSION = (window.innerWidth <= 900 ? 2048 : 3072) * pixelRatio;
            
            if (img.width > MAX_DIMENSION || img.height > MAX_DIMENSION) {
                if (img.width > img.height) {
                    newWidth = MAX_DIMENSION;
                    newHeight = (img.height * MAX_DIMENSION) / img.width;
                } else {
                    newHeight = MAX_DIMENSION;
                    newWidth = (img.width * MAX_DIMENSION) / img.height;
                }
            }
            
            tempCanvas.width = newWidth;
            tempCanvas.height = newHeight;
            tempCtx.drawImage(img, 0, 0, newWidth, newHeight);
            
            originalImage = new Image();
            originalImage.onload = function() {
                document.getElementById('preview-container').classList.add('has-image');
                cachedImageData = null;
                applyPreviewEffects(true);
            };
            originalImage.src = tempCanvas.toDataURL('image/jpeg', 1.0);
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

function applyRadialBlur(ctx, width, height, intensity) {
    const tempCanvas = document.createElement('canvas');
    const tempCtx = tempCanvas.getContext('2d');
    tempCanvas.width = width;
    tempCanvas.height = height;
    
    tempCtx.drawImage(ctx.canvas, 0, 0);
    ctx.save();
    
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.max(width, height) / 2;
    
    const gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius);
    gradient.addColorStop(0, `rgba(0, 0, 0, ${intensity / 10})`);
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    
    ctx.filter = `blur(${intensity * 2}px)`;
    ctx.drawImage(tempCanvas, 0, 0);
    ctx.filter = 'none';
    
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    
    ctx.restore();
    tempCanvas.remove();
}

function applyEffects(ctx, width, height, settings, isLowRes = false) {
    const {
        contrast,
        exposure,
        grain,
        radialBlur,
        opacity,
        texture,
        imageData
    } = settings;

    const scale = isLowRes ? (isMobile ? MOBILE_SCALE : DESKTOP_SCALE) : 1;
    const targetWidth = Math.floor(width * scale);
    const targetHeight = Math.floor(height * scale);

    const tempCanvas = document.createElement('canvas');
    const tempCtx = tempCanvas.getContext('2d', { alpha: false });
    tempCanvas.width = targetWidth;
    tempCanvas.height = targetHeight;

    if (isLowRes) {
        tempCtx.drawImage(originalImage, 0, 0, targetWidth, targetHeight);
        
        const imageData = tempCtx.getImageData(0, 0, targetWidth, targetHeight);
        const data = imageData.data;
        
        const contrastFactor = contrast;
        const exposureFactor = Math.pow(2, exposure);
        
        const lut = new Uint8ClampedArray(256);
        for (let i = 0; i < 256; i++) {
            lut[i] = Math.min(255, Math.max(0, ((i - 128) * contrastFactor + 128) * exposureFactor));
        }
        
        for (let i = 0; i < data.length; i += 16) {
            const val = lut[data[i]];
            for (let j = 0; j < 16 && (i + j) < data.length; j += 4) {
                data[i + j] = data[i + j + 1] = data[i + j + 2] = val;
            }
        }
        
        tempCtx.putImageData(imageData, 0, 0);
    } else {
        tempCtx.putImageData(imageData, 0, 0);
        
        const processedData = tempCtx.getImageData(0, 0, targetWidth, targetHeight);
        const data = processedData.data;
        
        if (window.Worker && !isLowRes) {
            // ... traitement dans un Web Worker ...
        } else {
            const lut = new Uint8ClampedArray(256);
            for (let i = 0; i < 256; i++) {
                lut[i] = Math.min(255, Math.max(0, ((i - 128) * contrast + 128) * Math.pow(2, exposure)));
            }
            
            for (let i = 0; i < data.length; i += 4) {
                const val = lut[data[i]];
                data[i] = data[i + 1] = data[i + 2] = val;
            }
        }
        
        tempCtx.putImageData(processedData, 0, 0);
        
        if (!isLowRes) {
            if (radialBlur > 0) applyRadialBlur(tempCtx, targetWidth, targetHeight, radialBlur);
            if (grain > 0) applyGrain(tempCtx, targetWidth, targetHeight, grain);
        }
    }

    ctx.canvas.width = width;
    ctx.canvas.height = height;
    ctx.drawImage(tempCanvas, 0, 0, width, height);

    if (texture && texture.complete && opacity > 0) {
        ctx.globalAlpha = opacity;
        ctx.globalCompositeOperation = "overlay";
        ctx.drawImage(texture, 0, 0, width, height);
        ctx.globalAlpha = 1.0;
        ctx.globalCompositeOperation = "source-over";
    }

    tempCanvas.remove();
}

function applyPreviewEffects(forceFullQuality = false) {
    if (!originalImage) return;
    
    if (isProcessing && !forceFullQuality) {
        needsUpdate = true;
        return;
    }

    const now = performance.now();
    if (!forceFullQuality && isSliding && now - lastRenderTime < RENDER_INTERVAL) {
        return;
    }

    isProcessing = true;

    requestAnimationFrame(() => {
        try {
            if (!cachedImageData) {
                initializeCachedImageData();
            }

            const canvas = document.getElementById('canvas');
            const ctx = canvas.getContext('2d', { alpha: false });
            
            const settings = {
                contrast: parseFloat(document.getElementById('contrast').value),
                exposure: parseFloat(document.getElementById('exposure').value),
                grain: parseFloat(document.getElementById('grain').value),
                radialBlur: parseFloat(document.getElementById('radialBlur').value),
                opacity: parseFloat(document.getElementById('opacity').value),
                texture: textureImage,
                imageData: cachedImageData
            };

            applyEffects(ctx, canvas.width, canvas.height, settings, isSliding && !forceFullQuality);
        } finally {
            isProcessing = false;
            if (needsUpdate) {
                needsUpdate = false;
                applyPreviewEffects(forceFullQuality);
            }
        }
    });
}

function initializeCachedImageData() {
    previewCanvas.width = originalImage.width;
    previewCanvas.height = originalImage.height;
    previewCtx.drawImage(originalImage, 0, 0);
    cachedImageData = previewCtx.getImageData(0, 0, previewCanvas.width, previewCanvas.height);
    
    const data = cachedImageData.data;
    for (let i = 0; i < data.length; i += 4) {
        const avg = (data[i] + data[i+1] + data[i+2]) / 3;
        data[i] = data[i+1] = data[i+2] = avg;
    }
}

// Update select options visibility when opening the dropdown
customSelect.addEventListener('click', function() {
  const selectedValue = textureSelect.value;
  const options = selectOptions.querySelectorAll('.option');
  options.forEach(option => {
    if (option.dataset.value === selectedValue) {
      option.style.display = 'none';
    } else {
      option.style.display = 'block';
    }
  });
});

// Debounce function with immediate option
function debounce(func, wait, immediate = false) {
  let timeout;
  return function executedFunction(...args) {
    const callNow = immediate && !timeout;
    const later = () => {
      timeout = null;
      if (!immediate) func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
    if (callNow) func(...args);
  };
}

// Gestion du menu déroulant personnalisé
// Version robuste : ouverture/fermeture uniquement sur .selected, fermeture garantie à la sélection

document.addEventListener('DOMContentLoaded', function() {
  const customSelect = document.querySelector('.custom-select');
  const select = document.querySelector('#texture');
  const options = document.querySelectorAll('.option');
  const selected = document.createElement('div');
  selected.className = 'selected';
  selected.textContent = select.options[select.selectedIndex].text;
  customSelect.insertBefore(selected, customSelect.firstChild);

  // Ouvre/ferme le menu uniquement si on clique sur .selected
  selected.addEventListener('click', function(e) {
    e.stopPropagation();
    customSelect.classList.toggle('active');
    
    // Mettre à jour la visibilité des options
    const currentValue = select.value;
    options.forEach(option => {
      if (option.getAttribute('data-value') === currentValue) {
        option.style.display = 'none';
      } else {
        option.style.display = 'block';
      }
    });
  });

  options.forEach(option => {
    option.addEventListener('click', function(e) {
      e.stopPropagation();
      const value = this.getAttribute('data-value');
      select.value = value;
      selected.textContent = this.textContent;
      customSelect.classList.remove('active');
      // Déclencher l'événement change sur le select original
      const event = new Event('change');
      select.dispatchEvent(event);
    });
  });

  // Fermer le menu si on clique en dehors
  document.addEventListener('click', function(e) {
    if (!customSelect.contains(e.target)) {
      customSelect.classList.remove('active');
    }
  });
});

// Gestion du panneau de réglages
settingsToggle.addEventListener('click', () => {
  settingsToggle.classList.toggle('active');
  settingsContent.classList.toggle('active');
});

// Mettre à jour les valeurs du slider de flou radial
radialBlurSlider.min = "0";
radialBlurSlider.max = "5";
radialBlurSlider.step = "0.1";
radialBlurSlider.value = "0";

// Ajouter un gestionnaire pour le changement d'orientation
window.addEventListener('orientationchange', () => {
  setTimeout(() => {
    // Forcer un rendu complet après le changement d'orientation
    applyPreviewEffects(true);
  }, 300);
});
