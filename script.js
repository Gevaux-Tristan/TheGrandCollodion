const imageInput = document.getElementById("upload");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
let originalImage = null;
let textureImage = new Image();
let isProcessing = false;
let needsUpdate = false;
let previewCanvas = document.createElement('canvas');
let previewCtx = previewCanvas.getContext('2d');
let cachedImageData = null;

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

// Initialize texture and opacity
textureImage.src = "Collodion-01.png";
opacitySlider.value = "0.75"; // Increased default opacity

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

// Créer une fonction qui applique les effets de manière cohérente
function applyEffects(ctx, width, height, settings) {
  const {
    contrast,
    exposure,
    grain,
    radialBlur,
    opacity,
    texture,
    imageData
  } = settings;

  // S'assurer que le contexte est configuré correctement
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // Appliquer l'image de base
  ctx.putImageData(imageData, 0, 0);

  // Appliquer le contraste et l'exposition
  const processedData = ctx.getImageData(0, 0, width, height);
  const data = processedData.data;
  const contrastFactor = contrast;
  const exposureFactor = Math.pow(2, exposure);
  const lut = new Uint8ClampedArray(256);
  
  for (let i = 0; i < 256; i++) {
    lut[i] = Math.min(255, Math.max(0, ((i - 128) * contrastFactor + 128) * exposureFactor));
  }

  for (let i = 0; i < data.length; i += 4) {
    data[i] = lut[data[i]];
    data[i+1] = lut[data[i+1]];
    data[i+2] = lut[data[i+2]];
  }

  ctx.putImageData(processedData, 0, 0);

  // Appliquer le flou radial
  if (radialBlur > 0) {
    applyRadialBlur(ctx, width, height, radialBlur);
  }

  // Appliquer le grain
  if (grain > 0) {
    const grainData = ctx.getImageData(0, 0, width, height);
    const noise = new Uint8ClampedArray(grainData.data.length);
    
    for (let i = 0; i < noise.length; i += 4) {
      const n = (Math.random() - 0.5) * 255 * grain;
      noise[i] = noise[i + 1] = noise[i + 2] = n;
    }
    
    for (let i = 0; i < grainData.data.length; i += 4) {
      grainData.data[i] = Math.min(255, Math.max(0, grainData.data[i] + noise[i]));
      grainData.data[i + 1] = Math.min(255, Math.max(0, grainData.data[i + 1] + noise[i + 1]));
      grainData.data[i + 2] = Math.min(255, Math.max(0, grainData.data[i + 2] + noise[i + 2]));
    }
    ctx.putImageData(grainData, 0, 0);
  }

  // Appliquer la texture
  if (texture && texture.complete && opacity > 0) {
    ctx.globalAlpha = opacity;
    ctx.globalCompositeOperation = "overlay";
    // Utiliser drawImage avec les dimensions explicites
    ctx.drawImage(texture, 0, 0, width, height);
    ctx.globalAlpha = 1.0;
    ctx.globalCompositeOperation = "source-over";
  }
}

// Modifier la fonction applyPreviewEffects pour utiliser la nouvelle fonction
function applyPreviewEffects() {
  if (!originalImage || isProcessing) {
    needsUpdate = true;
    return;
  }

  isProcessing = true;
  requestAnimationFrame(() => {
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

    canvas.width = originalImage.width;
    canvas.height = originalImage.height;

    const settings = {
      contrast: parseFloat(contrastSlider.value),
      exposure: parseFloat(exposureSlider.value),
      grain: parseFloat(grainSlider.value),
      radialBlur: parseFloat(radialBlurSlider.value),
      opacity: parseFloat(opacitySlider.value),
      texture: textureImage,
      imageData: cachedImageData
    };

    applyEffects(ctx, canvas.width, canvas.height, settings);

    isProcessing = false;
    if (needsUpdate) {
      needsUpdate = false;
      applyPreviewEffects();
    }
  });
}

// Augmenter le délai de debounce sur mobile
const debounceDelay = window.innerWidth <= 900 ? 32 : 16;
const debouncedApplyEffects = debounce(applyPreviewEffects, debounceDelay, true);
const debouncedRadialBlur = debounce(applyPreviewEffects, debounceDelay * 2, true);

// Gestionnaires d'événements pour le drag & drop
const previewContainer = document.getElementById('preview-container');

function preventDefaults(e) {
  e.preventDefault();
  e.stopPropagation();
}

function highlight(e) {
  previewContainer.classList.add('drag-over');
}

function unhighlight(e) {
  previewContainer.classList.remove('drag-over');
}

// Ajouter les événements drag & drop
['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
  previewContainer.addEventListener(eventName, preventDefaults, false);
  document.body.addEventListener(eventName, preventDefaults, false);
});

['dragenter', 'dragover'].forEach(eventName => {
  previewContainer.addEventListener(eventName, highlight, false);
});

['dragleave', 'drop'].forEach(eventName => {
  previewContainer.addEventListener(eventName, unhighlight, false);
});

// Fonction de chargement d'image
function loadImage(file) {
  const reader = new FileReader();
  reader.onload = function(e) {
    const img = new Image();
    img.onload = function() {
      // Create a temporary canvas for compression
      const tempCanvas = document.createElement('canvas');
      const tempCtx = tempCanvas.getContext('2d', { alpha: false });
      
      // Calculer les dimensions en tenant compte de la résolution de l'écran
      let newWidth = img.width;
      let newHeight = img.height;
      
      // Ajuster la taille maximale en fonction de la résolution de l'écran
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
      
      // Améliorer la qualité du redimensionnement
      tempCtx.imageSmoothingEnabled = true;
      tempCtx.imageSmoothingQuality = 'high';
      tempCtx.drawImage(img, 0, 0, newWidth, newHeight);
      
      const compressedImg = new Image();
      compressedImg.onload = function() {
        originalImage = compressedImg;
        previewContainer.classList.add('has-image');
        cachedImageData = null;
        applyPreviewEffects();
      };
      
      // Utiliser une qualité maximale pour l'image source
      compressedImg.src = tempCanvas.toDataURL('image/jpeg', 1.0);
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

// Gestionnaire d'événement pour l'upload via le bouton
imageInput.addEventListener('change', (e) => {
  if (e.target.files && e.target.files.length > 0) {
    loadImage(e.target.files[0]);
  }
});

// Gestionnaire d'événement pour le drop
previewContainer.addEventListener('drop', (e) => {
  const dt = e.dataTransfer;
  const files = dt.files;

  if (files.length > 0) {
    loadImage(files[0]);
  }
});

// Update event listeners
[contrastSlider, opacitySlider, grainSlider, exposureSlider, radialBlurSlider].forEach(slider => {
  slider.addEventListener("input", debouncedApplyEffects);
});

textureSelect.addEventListener("change", () => {
  textureImage.src = textureSelect.value;
  textureImage.onload = () => applyPreviewEffects();
});

// Modifier la fonction de téléchargement
document.getElementById("download").addEventListener("click", async () => {
  const downloadButton = document.getElementById("download");
  const originalText = downloadButton.innerHTML;
  
  downloadButton.disabled = true;
  downloadButton.innerHTML = '<span class="material-icon">hourglass_empty</span>Processing...';
  downloadButton.style.opacity = '0.7';

  try {
    // Créer un nouveau canvas pour l'export
    const exportCanvas = document.createElement('canvas');
    const exportCtx = exportCanvas.getContext('2d', { alpha: false });
    
    // Utiliser les dimensions originales de l'image
    exportCanvas.width = originalImage.width;
    exportCanvas.height = originalImage.height;

    // Recréer l'image exactement comme dans la prévisualisation
    if (cachedImageData) {
      // Appliquer les mêmes effets avec les paramètres actuels
      const settings = {
        contrast: parseFloat(contrastSlider.value),
        exposure: parseFloat(exposureSlider.value),
        grain: parseFloat(grainSlider.value),
        radialBlur: parseFloat(radialBlurSlider.value),
        opacity: parseFloat(opacitySlider.value),
        texture: textureImage,
        imageData: cachedImageData
      };

      // Utiliser la même fonction applyEffects que pour la prévisualisation
      applyEffects(exportCtx, exportCanvas.width, exportCanvas.height, settings);
    } else {
      // Si pas de cachedImageData, copier directement le canvas actuel
      exportCtx.drawImage(canvas, 0, 0, exportCanvas.width, exportCanvas.height);
    }

    // Export en haute qualité
    const dataUrl = exportCanvas.toDataURL('image/jpeg', 1.0);
    const link = document.createElement('a');
    link.download = 'collodion-export.jpg';
    link.href = dataUrl;
    link.click();

    // Nettoyer
    exportCanvas.remove();
  } catch (error) {
    console.error('Export failed:', error);
  } finally {
    downloadButton.disabled = false;
    downloadButton.innerHTML = originalText;
    downloadButton.style.opacity = '1';
  }
});

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

// Remplacer la fonction applyRadialBlur par cette version améliorée
function applyRadialBlur(ctx, width, height, intensity) {
  const tempCanvas = document.createElement('canvas');
  const tempCtx = tempCanvas.getContext('2d');
  tempCanvas.width = width;
  tempCanvas.height = height;
  
  // Copier l'image originale
  tempCtx.drawImage(ctx.canvas, 0, 0);
  
  // Sauvegarder l'état du contexte
  ctx.save();
  
  // Calculer le centre
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.max(width, height) / 2;
  
  // Créer un dégradé radial pour le masque de flou
  const gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius);
  gradient.addColorStop(0, `rgba(0, 0, 0, ${intensity / 10})`);
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
  
  // Appliquer le flou
  ctx.filter = `blur(${intensity * 2}px)`;
  ctx.drawImage(tempCanvas, 0, 0);
  ctx.filter = 'none';
  
  // Restaurer l'image originale au centre
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  
  // Restaurer l'état du contexte
  ctx.restore();
  
  // Nettoyer
  tempCanvas.remove();
}

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
