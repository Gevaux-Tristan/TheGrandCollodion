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

function applyPreviewEffects() {
  if (!originalImage || isProcessing) {
    needsUpdate = true;
    return;
  }

  isProcessing = true;
  requestAnimationFrame(() => {
    // Use cached image data if available
    if (!cachedImageData) {
      previewCanvas.width = originalImage.width;
      previewCanvas.height = originalImage.height;
      previewCtx.drawImage(originalImage, 0, 0);
      cachedImageData = previewCtx.getImageData(0, 0, previewCanvas.width, previewCanvas.height);
      
      // Convert to black and white
      const data = cachedImageData.data;
      for (let i = 0; i < data.length; i += 4) {
        const avg = (data[i] + data[i+1] + data[i+2]) / 3;
        data[i] = data[i+1] = data[i+2] = avg;
      }
      previewCtx.putImageData(cachedImageData, 0, 0);
      cachedImageData = previewCtx.getImageData(0, 0, previewCanvas.width, previewCanvas.height);
    }

    canvas.width = originalImage.width;
    canvas.height = originalImage.height;
    ctx.putImageData(cachedImageData, 0, 0);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    const contrast = parseFloat(contrastSlider.value);
    const exposure = parseFloat(exposureSlider.value);

    // Fast contrast and exposure calculation
    const contrastFactor = contrast;
    const exposureFactor = Math.pow(2, exposure);
    const lut = new Uint8ClampedArray(256);
    
    // Pre-calculate lookup table for contrast and exposure
    for (let i = 0; i < 256; i++) {
      lut[i] = Math.min(255, Math.max(0, ((i - 128) * contrastFactor + 128) * exposureFactor));
    }

    // Apply lookup table
    for (let i = 0; i < data.length; i += 4) {
      data[i] = lut[data[i]];
      data[i+1] = lut[data[i+1]];
      data[i+2] = lut[data[i+2]];
    }

    ctx.putImageData(imageData, 0, 0);

    const radialBlur = parseFloat(radialBlurSlider.value);
    if (radialBlur > 0) {
      applyRadialBlur(ctx, previewCanvas, radialBlur);
    }

    const grainAmount = parseFloat(grainSlider.value);
    if (grainAmount > 0) {
      const grainData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const noise = new Uint8ClampedArray(grainData.data.length);
      
      // Optimiser le grain sur mobile
      const isMobile = window.innerWidth <= 900;
      const grainStep = isMobile ? 8 : 4; // Traiter moins de pixels sur mobile
      
      for (let i = 0; i < noise.length; i += grainStep) {
        const n = (Math.random() - 0.5) * 255 * grainAmount;
        for (let j = 0; j < grainStep && i + j < noise.length; j += 4) {
          noise[i + j] = noise[i + j + 1] = noise[i + j + 2] = n;
        }
      }
      
      for (let i = 0; i < grainData.data.length; i += grainStep) {
        for (let j = 0; j < grainStep && i + j < grainData.data.length; j += 4) {
          grainData.data[i + j] = Math.min(255, Math.max(0, grainData.data[i + j] + noise[i + j]));
          grainData.data[i + j + 1] = Math.min(255, Math.max(0, grainData.data[i + j + 1] + noise[i + j + 1]));
          grainData.data[i + j + 2] = Math.min(255, Math.max(0, grainData.data[i + j + 2] + noise[i + j + 2]));
        }
      }
      ctx.putImageData(grainData, 0, 0);
    }

    const opacity = parseFloat(opacitySlider.value);
    if (textureImage.src && textureImage.complete && opacity > 0) {
      ctx.globalAlpha = opacity;
      ctx.globalCompositeOperation = "overlay";
      ctx.drawImage(textureImage, 0, 0, canvas.width, canvas.height);
      ctx.globalAlpha = 1.0;
      ctx.globalCompositeOperation = "source-over";
    }

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

function loadImage(file) {
  const reader = new FileReader();
  reader.onload = function (e) {
    const img = new Image();
    img.onload = function () {
      // Create a temporary canvas for compression
      const tempCanvas = document.createElement('canvas');
      const tempCtx = tempCanvas.getContext('2d');
      
      // Calculate new dimensions while maintaining aspect ratio
      let newWidth = img.width;
      let newHeight = img.height;
      
      // Réduire la taille maximale sur mobile
      const MAX_DIMENSION = window.innerWidth <= 900 ? 800 : 1500;
      
      if (img.width > MAX_DIMENSION || img.height > MAX_DIMENSION) {
        if (img.width > img.height) {
          newWidth = MAX_DIMENSION;
          newHeight = (img.height * MAX_DIMENSION) / img.width;
        } else {
          newHeight = MAX_DIMENSION;
          newWidth = (img.width * MAX_DIMENSION) / img.height;
        }
      }
      
      // Set canvas size to new dimensions
      tempCanvas.width = newWidth;
      tempCanvas.height = newHeight;
      
      // Draw and compress image
      tempCtx.drawImage(img, 0, 0, newWidth, newHeight);
      
      // Create compressed image with lower quality on mobile
      const compressedImg = new Image();
      compressedImg.onload = function() {
        originalImage = compressedImg;
        document.getElementById('preview-container').classList.add('has-image');
        // Reset the cached image data to force a new processing with current settings
        cachedImageData = null;
        // Apply effects with current settings
        applyPreviewEffects();
      };
      // Réduire la qualité sur mobile
      const quality = window.innerWidth <= 900 ? 0.5 : 0.7;
      compressedImg.src = tempCanvas.toDataURL('image/jpeg', quality);
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

imageInput.addEventListener("change", () => {
  if (imageInput.files.length > 0) {
    loadImage(imageInput.files[0]);
  }
});

document.body.addEventListener("dragover", (e) => {
  e.preventDefault();
});

document.body.addEventListener("drop", (e) => {
  e.preventDefault();
  if (e.dataTransfer.files.length > 0) {
    loadImage(e.dataTransfer.files[0]);
  }
});

// Update event listeners
[contrastSlider, opacitySlider, grainSlider, exposureSlider].forEach(slider => {
  slider.addEventListener("input", debouncedApplyEffects);
});

// Separate event listener for radial blur with different debounce
radialBlurSlider.addEventListener("input", debouncedRadialBlur);

textureSelect.addEventListener("change", () => {
  textureImage.src = textureSelect.value;
  textureImage.onload = () => applyPreviewEffects();
});

document.getElementById("download").addEventListener("click", () => {
  // Create a high-resolution canvas for export
  const finalCanvas = document.createElement('canvas');
  const scale = 2; // Facteur d'échelle pour la haute résolution
  finalCanvas.width = canvas.width * scale;
  finalCanvas.height = canvas.height * scale;
  const finalCtx = finalCanvas.getContext('2d');
  
  // Enable high-quality image scaling
  finalCtx.imageSmoothingEnabled = true;
  finalCtx.imageSmoothingQuality = 'high';
  
  // Draw the current canvas at high resolution
  finalCtx.drawImage(canvas, 0, 0, finalCanvas.width, finalCanvas.height);
  
  // Apply all effects at full quality on the high-res canvas
  const imageData = finalCtx.getImageData(0, 0, finalCanvas.width, finalCanvas.height);
  const data = imageData.data;
  const contrast = parseFloat(contrastSlider.value);
  const exposure = parseFloat(exposureSlider.value);
  const radialBlur = parseFloat(radialBlurSlider.value);
  const grainAmount = parseFloat(grainSlider.value);
  const opacity = parseFloat(opacitySlider.value);

  // Apply contrast and exposure at full quality
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
  
  finalCtx.putImageData(imageData, 0, 0);

  // Apply radial blur at full quality
  if (radialBlur > 0) {
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = finalCanvas.width;
    tempCanvas.height = finalCanvas.height;
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.drawImage(finalCanvas, 0, 0);
    
    finalCtx.clearRect(0, 0, finalCanvas.width, finalCanvas.height);
    finalCtx.drawImage(tempCanvas, 0, 0);
    
    const steps = Math.min(8, Math.ceil(radialBlur));
    const baseDistance = radialBlur * 0.4;
    
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < steps; i++) {
        const angle = (i / steps) * Math.PI * 2;
        const progress = i / steps;
        const smoothProgress = 0.5 - Math.cos(progress * Math.PI) * 0.5;
        const distance = baseDistance * smoothProgress;
        
        const offsetX = Math.cos(angle) * distance;
        const offsetY = Math.sin(angle) * distance;
        
        const alpha = (1 - Math.pow(progress, 3)) / (steps * 2);
        finalCtx.globalAlpha = alpha * 1.2;
        
        finalCtx.drawImage(tempCanvas, offsetX, offsetY);
      }
    }
    
    if (radialBlur > 2) {
      finalCtx.globalAlpha = 0.12;
      finalCtx.drawImage(tempCanvas, 0, 0);
    }
  }

  // Apply grain at full quality
  if (grainAmount > 0) {
    const grainData = finalCtx.getImageData(0, 0, finalCanvas.width, finalCanvas.height);
    const noise = new Uint8ClampedArray(grainData.data.length);
    
    for (let i = 0; i < noise.length; i += 4) {
      const n = (Math.random() - 0.5) * 255 * grainAmount;
      noise[i] = noise[i+1] = noise[i+2] = n;
    }
    
    for (let i = 0; i < grainData.data.length; i += 4) {
      grainData.data[i] = Math.min(255, Math.max(0, grainData.data[i] + noise[i]));
      grainData.data[i+1] = Math.min(255, Math.max(0, grainData.data[i+1] + noise[i+1]));
      grainData.data[i+2] = Math.min(255, Math.max(0, grainData.data[i+2] + noise[i+2]));
    }
    finalCtx.putImageData(grainData, 0, 0);
  }

  // Apply texture at full quality
  if (textureImage.src && textureImage.complete && opacity > 0) {
    finalCtx.globalAlpha = opacity;
    finalCtx.globalCompositeOperation = "overlay";
    finalCtx.drawImage(textureImage, 0, 0, finalCanvas.width, finalCanvas.height);
    finalCtx.globalAlpha = 1.0;
    finalCtx.globalCompositeOperation = "source-over";
  }

  // Get the next sequential number from localStorage
  let imageNumber = parseInt(localStorage.getItem('lastImageNumber') || '0') + 1;
  localStorage.setItem('lastImageNumber', imageNumber.toString());
  
  // Create filename with sequential number
  const filename = `TheGrandCollodion${imageNumber}.png`;
  
  // Export as PNG with maximum quality
  const link = document.createElement("a");
  link.download = filename;
  link.href = finalCanvas.toDataURL("image/png", 1.0);
  link.click();
});

// Drag and drop handlers
const previewContainer = document.getElementById('preview-container');

['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
  previewContainer.addEventListener(eventName, preventDefaults, false);
});

function preventDefaults(e) {
  e.preventDefault();
  e.stopPropagation();
}

['dragenter', 'dragover'].forEach(eventName => {
  previewContainer.addEventListener(eventName, highlight, false);
});

['dragleave', 'drop'].forEach(eventName => {
  previewContainer.addEventListener(eventName, unhighlight, false);
});

function highlight(e) {
  previewContainer.classList.add('drag-over');
}

function unhighlight(e) {
  previewContainer.classList.remove('drag-over');
}

previewContainer.addEventListener('drop', handleDrop, false);

function handleDrop(e) {
  const dt = e.dataTransfer;
  const files = dt.files;
  if (files.length > 0) {
    loadImage(files[0]);
  }
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

// Optimisation du flou radial pour mobile
function applyRadialBlur(ctx, previewCanvas, radialBlur) {
  if (radialBlur <= 0) return;
  
  // Réduire le nombre d'étapes sur mobile
  const isMobile = window.innerWidth <= 900;
  const steps = isMobile ? Math.min(4, Math.ceil(radialBlur)) : Math.min(8, Math.ceil(radialBlur));
  const baseDistance = radialBlur * (isMobile ? 0.3 : 0.4);
  
  // Create a temporary canvas for the blur
  previewCtx.drawImage(canvas, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  // Draw original image first
  ctx.globalAlpha = 1;
  ctx.drawImage(previewCanvas, 0, 0);
  
  // Apply blur in one pass on mobile, two passes on desktop
  const passes = isMobile ? 1 : 2;
  
  for (let pass = 0; pass < passes; pass++) {
    for (let i = 0; i < steps; i++) {
      const angle = (i / steps) * Math.PI * 2;
      const progress = i / steps;
      const smoothProgress = 0.5 - Math.cos(progress * Math.PI) * 0.5;
      const distance = baseDistance * smoothProgress;
      
      const offsetX = Math.cos(angle) * distance;
      const offsetY = Math.sin(angle) * distance;
      
      const alpha = (1 - Math.pow(progress, 3)) / (steps * passes);
      ctx.globalAlpha = alpha * 1.2;
      
      ctx.drawImage(previewCanvas, offsetX, offsetY);
    }
  }
  
  // Very subtle center reinforcement
  if (radialBlur > 2) {
    ctx.globalAlpha = isMobile ? 0.08 : 0.12;
    ctx.drawImage(previewCanvas, 0, 0);
  }
  
  // Minimal brightness compensation
  const finalImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = finalImageData.data;
  const brightnessFactor = 1 + (radialBlur * 0.003);
  
  for (let i = 0; i < data.length; i += 4) {
    data[i] = Math.min(255, data[i] * brightnessFactor);
    data[i+1] = Math.min(255, data[i+1] * brightnessFactor);
    data[i+2] = Math.min(255, data[i+2] * brightnessFactor);
  }
  
  ctx.putImageData(finalImageData, 0, 0);
  ctx.globalAlpha = 1.0;
}
