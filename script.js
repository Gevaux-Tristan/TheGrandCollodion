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
const RENDER_INTERVAL = window.innerWidth <= 900 ? 1000 / 15 : 1000 / 30;
const MOBILE_SCALE = 0.25;
const DESKTOP_SCALE = 0.5;
const isMobile = window.innerWidth <= 900;

const contrastSlider = document.getElementById("contrast");
const opacitySlider = document.getElementById("opacity");
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
        cameraInput: document.getElementById('camera'),
        previewContainer: document.getElementById('preview-container'),
        contrastSlider: document.getElementById('contrast'),
        opacitySlider: document.getElementById('opacity'),
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
    setupFileUpload(elements.cameraInput);
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
            // Generate filename in the format: The GrandCollodion-[date here]-[Hour here].jpg
            const now = new Date();
            const dateStr = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
            const hourStr = String(now.getHours()).padStart(2, '0') + '-' + String(now.getMinutes()).padStart(2, '0');
            link.download = `The GrandCollodion-${dateStr}-${hourStr}.jpg`;
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
    return function() {
        isSliding = true;
        if (performance.now() - lastRenderTime >= RENDER_INTERVAL) {
            applyPreviewEffects(false);
        }
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
            
            const DOWNSAMPLE_PIXEL_RATIO_CAP = 1.5; // Cap pixel ratio to manage canvas size
            const effectivePixelRatio = Math.min(window.devicePixelRatio || 1, DOWNSAMPLE_PIXEL_RATIO_CAP);
            const MAX_DIMENSION = (window.innerWidth <= 900 ? 2048 : 3072) * effectivePixelRatio;
            
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

function applyRadialBlur(targetCtx, width, height, intensity, isPreviewBlur = false) {
    const tempCopyCanvas = document.createElement('canvas');
    const tempCopyCtx = tempCopyCanvas.getContext('2d');
    tempCopyCanvas.width = width;
    tempCopyCanvas.height = height;
    
    // Copy current content of targetCtx (which should have contrast/exposure applied)
    tempCopyCtx.drawImage(targetCtx.canvas, 0, 0);

    targetCtx.save(); // Save state of targetCtx
    
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.max(width, height) / 2;
    
    const gradient = targetCtx.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius);
    
    // Adjust intensity for gradient and blur radius for preview
    const gradientEffectIntensity = isPreviewBlur ? intensity / 15 : intensity / 10;
    let blurPx = intensity * 2;
    if (isPreviewBlur) {
        blurPx = Math.max(1, intensity * 1); // Less blur for preview, e.g., max 5px if intensity max is 5
    }

    gradient.addColorStop(0, `rgba(0, 0, 0, ${gradientEffectIntensity})`);
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    
    targetCtx.filter = `blur(${blurPx}px)`;
    targetCtx.drawImage(tempCopyCanvas, 0, 0); // Draw the copied content, now blurred, back onto targetCtx
    targetCtx.filter = 'none';
    
    targetCtx.globalCompositeOperation = 'destination-out';
    targetCtx.fillStyle = gradient;
    targetCtx.fillRect(0, 0, width, height); // Apply radial mask
    
    targetCtx.restore(); // Restore state of targetCtx
    tempCopyCanvas.remove();
}

const DEFAULT_GRAIN_AMOUNT = 0.05; // Light, fixed grain amount

function applyEffects(ctx, canvasWidth, canvasHeight, settings, isLowRes = false) {
    const { contrast, exposure, radialBlur, opacity, texture, imageData: baseGrayscaleImageData } = settings;

    let sourceWidth = baseGrayscaleImageData.width;
    let sourceHeight = baseGrayscaleImageData.height;
    
    let workingCanvasForEffects = document.createElement('canvas');
    let workingCtxForEffects = workingCanvasForEffects.getContext('2d');

    if (isLowRes) {
        const scale = isMobile ? MOBILE_SCALE : DESKTOP_SCALE;
        sourceWidth = Math.max(1, Math.floor(baseGrayscaleImageData.width * scale));
        sourceHeight = Math.max(1, Math.floor(baseGrayscaleImageData.height * scale));

        workingCanvasForEffects.width = sourceWidth;
        workingCanvasForEffects.height = sourceHeight;
        
        const tempFullResCanvas = document.createElement('canvas');
        tempFullResCanvas.width = baseGrayscaleImageData.width;
        tempFullResCanvas.height = baseGrayscaleImageData.height;
        tempFullResCanvas.getContext('2d').putImageData(baseGrayscaleImageData, 0, 0);
        
        workingCtxForEffects.imageSmoothingEnabled = true;
        workingCtxForEffects.imageSmoothingQuality = 'medium'; // Quality for downscaling
        workingCtxForEffects.drawImage(tempFullResCanvas, 0, 0, sourceWidth, sourceHeight);
        tempFullResCanvas.remove();
    } else {
        workingCanvasForEffects.width = sourceWidth; // Full resolution
        workingCanvasForEffects.height = sourceHeight;
        workingCtxForEffects.putImageData(baseGrayscaleImageData, 0, 0);
    }

    // Apply Contrast and Exposure to workingCtxForEffects
    const imageDataForProcessing = workingCtxForEffects.getImageData(0, 0, sourceWidth, sourceHeight);
    const pixelData = imageDataForProcessing.data;
    const contrastFactor = contrast;
    const exposureFactor = Math.pow(2, exposure);

    for (let i = 0; i < pixelData.length; i += 4) {
        const originalVal = pixelData[i]; // Assumes grayscaled source data (R=G=B)
        const val = Math.min(255, Math.max(0, ((originalVal - 128) * contrastFactor + 128) * exposureFactor));
        pixelData[i] = val;
        pixelData[i + 1] = val;
        pixelData[i + 2] = val;
        // Alpha (pixelData[i+3]) remains unchanged
    }
    workingCtxForEffects.putImageData(imageDataForProcessing, 0, 0);

    // Apply Radial Blur to workingCtxForEffects
    if (radialBlur > 0) {
        applyRadialBlur(workingCtxForEffects, sourceWidth, sourceHeight, radialBlur, isLowRes /* pass isLowRes as isPreviewBlur */);
    }

    // Apply fixed light grain to workingCtxForEffects
    if (DEFAULT_GRAIN_AMOUNT > 0) {
        const grainImageData = workingCtxForEffects.getImageData(0, 0, sourceWidth, sourceHeight);
        const grainPixelData = grainImageData.data;
        for (let i = 0; i < grainPixelData.length; i += 4) {
            // Generate noise between -0.5 and 0.5, scale by amount and 255
            const noise = (Math.random() - 0.5) * DEFAULT_GRAIN_AMOUNT * 255;
            grainPixelData[i] = Math.min(255, Math.max(0, grainPixelData[i] + noise));
            grainPixelData[i + 1] = Math.min(255, Math.max(0, grainPixelData[i + 1] + noise));
            grainPixelData[i + 2] = Math.min(255, Math.max(0, grainPixelData[i + 2] + noise));
            // Alpha (grainPixelData[i+3]) remains unchanged
        }
        workingCtxForEffects.putImageData(grainImageData, 0, 0);
    }

    // Prepare main display canvas (ctx) and draw the content of workingCanvasForEffects to it
    ctx.canvas.width = canvasWidth; 
    ctx.canvas.height = canvasHeight;
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    if (isLowRes) {
        ctx.imageSmoothingEnabled = true; 
        ctx.imageSmoothingQuality = 'low'; // Faster for preview upscaling
        ctx.drawImage(workingCanvasForEffects, 0, 0, canvasWidth, canvasHeight);
    } else {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high'; // High quality for final render
        ctx.drawImage(workingCanvasForEffects, 0, 0, canvasWidth, canvasHeight);
    }
    
    workingCanvasForEffects.remove(); // Clean up the temporary working canvas

    // Apply Texture Overlay to the main display canvas (ctx)
    if (texture && texture.complete && opacity > 0) {
        ctx.globalAlpha = opacity;
        ctx.globalCompositeOperation = "overlay";
        ctx.drawImage(texture, 0, 0, canvasWidth, canvasHeight);
        ctx.globalAlpha = 1.0;
        ctx.globalCompositeOperation = "source-over";
    }
}

function applyPreviewEffects(forceFullQuality = false) {
    if (!originalImage) {
        return;
    }

    if (isProcessing && !forceFullQuality) {
        needsUpdate = true;
        return;
    }

    const now = performance.now();
    if (!forceFullQuality && isSliding && now - lastRenderTime < RENDER_INTERVAL) {
        return;
    }
    lastRenderTime = now;

    isProcessing = true;

    if (!cachedImageData) {
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

    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');
    
    canvas.width = originalImage.width;
    canvas.height = originalImage.height;

    const settings = {
        contrast: parseFloat(document.getElementById('contrast').value),
        exposure: parseFloat(document.getElementById('exposure').value),
        radialBlur: parseFloat(document.getElementById('radialBlur').value),
        opacity: parseFloat(document.getElementById('opacity').value),
        texture: textureImage,
        imageData: cachedImageData
    };

    applyEffects(ctx, canvas.width, canvas.height, settings, isSliding && !forceFullQuality);

    isProcessing = false;
    if (needsUpdate) {
        needsUpdate = false;
        requestAnimationFrame(() => applyPreviewEffects(forceFullQuality));
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
