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

// Texture optimization
const textureCache = new Map();
const PREVIEW_TEXTURE_SIZE = 1024; // Maximum size for preview textures

// Function to load and optimize texture
async function loadOptimizedTexture(src) {
    if (textureCache.has(src)) {
        return textureCache.get(src);
    }

    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            // Create a canvas for the preview texture
            const previewCanvas = document.createElement('canvas');
            const previewCtx = previewCanvas.getContext('2d');
            
            // Calculate dimensions while maintaining aspect ratio
            let width = img.width;
            let height = img.height;
            if (width > PREVIEW_TEXTURE_SIZE || height > PREVIEW_TEXTURE_SIZE) {
                if (width > height) {
                    width = PREVIEW_TEXTURE_SIZE;
                    height = (img.height * PREVIEW_TEXTURE_SIZE) / img.width;
                } else {
                    height = PREVIEW_TEXTURE_SIZE;
                    width = (img.width * PREVIEW_TEXTURE_SIZE) / img.height;
                }
            }
            
            previewCanvas.width = width;
            previewCanvas.height = height;
            previewCtx.drawImage(img, 0, 0, width, height);
            
            const previewTexture = new Image();
            previewTexture.src = previewCanvas.toDataURL('image/png', 0.8);
            
            const result = {
                original: img,
                preview: previewTexture
            };
            
            textureCache.set(src, result);
            resolve(result);
        };
        img.src = src;
    });
}

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

    // Initialize texture with optimization
    loadOptimizedTexture("Collodion-01.png").then(texture => {
        textureImage = texture.preview;
    });
    elements.opacitySlider.value = "0.75";

    // Configurer les event listeners
    setupDragAndDrop(elements.previewContainer);
    setupFileUpload(elements.imageInput);
    setupFileUpload(elements.cameraInput);
    setupSliders(elements);
    setupDownloadButton(elements.downloadButton, elements.canvas);
    setupTextureSelect(elements.textureSelect);
    buildTextureChips(elements.textureSelect);
    setupBottomSheet();
    setupTapToUpload(elements.previewContainer, elements.imageInput);
}

// Tap anywhere on the empty preview to open the file picker
function setupTapToUpload(previewContainer, imageInput) {
    previewContainer.addEventListener('click', () => {
        if (!originalImage) {
            imageInput.click();
        }
    });
}

// Mobile texture picker: horizontal swipeable thumbnails mirroring the select
function buildTextureChips(select) {
    const container = document.getElementById('texture-chips');
    if (!container) return;

    Array.from(select.options).forEach(opt => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'texture-chip';
        chip.dataset.value = opt.value;
        chip.setAttribute('aria-pressed', String(opt.value === select.value));
        chip.setAttribute('aria-label', opt.text);
        chip.style.backgroundImage = `url("${opt.value}")`;
        const num = document.createElement('span');
        num.textContent = opt.text.replace('Collodion-', '');
        chip.appendChild(num);
        chip.addEventListener('click', () => {
            select.value = opt.value;
            select.dispatchEvent(new Event('change'));
        });
        container.appendChild(chip);
    });

    select.addEventListener('change', () => {
        const selectedDiv = document.querySelector('.custom-select .selected');
        if (selectedDiv) selectedDiv.textContent = select.options[select.selectedIndex].text;
        const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        container.querySelectorAll('.texture-chip').forEach(chip => {
            const active = chip.dataset.value === select.value;
            chip.setAttribute('aria-pressed', String(active));
            if (active) {
                chip.scrollIntoView({ block: 'nearest', inline: 'center', behavior: reduceMotion ? 'auto' : 'smooth' });
            }
        });
    });
}

// Mobile bottom sheet: sliders always visible, drag up to reveal the rest
function setupBottomSheet() {
    const sheet = document.getElementById('controls-panel');
    const handle = document.getElementById('sheet-handle');
    const scrim = document.getElementById('sheet-scrim');
    const slidersSection = document.getElementById('sheet-sliders');
    const moreSection = document.getElementById('sheet-more');
    if (!sheet || !handle || !scrim || !slidersSection || !moreSection) return;

    const mq = window.matchMedia('(max-width: 900px)');
    let expanded = false;

    function peekHeight() {
        return handle.offsetHeight + slidersSection.offsetHeight;
    }

    function measure() {
        if (!mq.matches) {
            document.documentElement.style.removeProperty('--sheet-peek');
            moreSection.inert = false;
            return;
        }
        document.documentElement.style.setProperty('--sheet-peek', peekHeight() + 'px');
        moreSection.inert = !expanded;
    }

    function setExpanded(value) {
        expanded = value;
        sheet.classList.toggle('expanded', expanded);
        scrim.classList.toggle('visible', expanded);
        handle.setAttribute('aria-expanded', String(expanded));
        moreSection.inert = mq.matches && !expanded;
        if (!expanded) sheet.scrollTop = 0;
    }

    let dragging = false;
    let startY = 0;
    let startOffset = 0;
    let currentOffset = 0;
    let maxOffset = 0;

    handle.addEventListener('pointerdown', (e) => {
        if (!mq.matches) return;
        dragging = true;
        startY = e.clientY;
        maxOffset = Math.max(0, sheet.offsetHeight - peekHeight());
        startOffset = expanded ? 0 : maxOffset;
        currentOffset = startOffset;
        sheet.classList.add('dragging');
        handle.setPointerCapture(e.pointerId);
    });

    handle.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        currentOffset = Math.min(maxOffset, Math.max(0, startOffset + (e.clientY - startY)));
        sheet.style.transform = `translateY(${currentOffset}px)`;
    });

    function endDrag(e, cancelled) {
        if (!dragging) return;
        dragging = false;
        sheet.classList.remove('dragging');
        sheet.style.transform = '';
        if (cancelled) {
            setExpanded(expanded);
        } else if (Math.abs(e.clientY - startY) < 6) {
            setExpanded(!expanded); // treated as a tap
        } else {
            setExpanded(currentOffset < maxOffset / 2); // snap to nearest state
        }
    }

    handle.addEventListener('pointerup', (e) => endDrag(e, false));
    handle.addEventListener('pointercancel', (e) => endDrag(e, true));

    scrim.addEventListener('click', () => setExpanded(false));

    window.addEventListener('resize', debounce(measure, 150));
    window.addEventListener('orientationchange', () => setTimeout(measure, 350));
    if (mq.addEventListener) mq.addEventListener('change', measure);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure);
    measure();
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
    // Preload all textures
    const textureOptions = Array.from(textureSelect.options);
    textureOptions.forEach(option => {
        loadOptimizedTexture(option.value);
    });

    textureSelect.addEventListener('change', async () => {
        const texture = await loadOptimizedTexture(textureSelect.value);
        textureImage = texture.preview;
        applyPreviewEffects(true);
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
            // Create a temporary canvas for initial processing
            const tempCanvas = document.createElement('canvas');
            const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
            
            // Calculate dimensions with a more efficient approach
            const DOWNSAMPLE_PIXEL_RATIO_CAP = 1.5;
            const effectivePixelRatio = Math.min(window.devicePixelRatio || 1, DOWNSAMPLE_PIXEL_RATIO_CAP);
            const MAX_DIMENSION = (window.innerWidth <= 900 ? 2048 : 3072) * effectivePixelRatio;
            
            let newWidth = img.width;
            let newHeight = img.height;
            
            if (img.width > MAX_DIMENSION || img.height > MAX_DIMENSION) {
                const scale = MAX_DIMENSION / Math.max(img.width, img.height);
                newWidth = Math.floor(img.width * scale);
                newHeight = Math.floor(img.height * scale);
            }
            
            // Set canvas dimensions
            tempCanvas.width = newWidth;
            tempCanvas.height = newHeight;
            
            // Optimize drawing settings
            tempCtx.imageSmoothingEnabled = true;
            tempCtx.imageSmoothingQuality = 'high';
            
            // Draw image with optimized settings
            tempCtx.drawImage(img, 0, 0, newWidth, newHeight);
            
            // Create the final image with optimized settings
            originalImage = new Image();
            originalImage.onload = function() {
                document.getElementById('preview-container').classList.add('has-image');
                cachedImageData = null;
                applyPreviewEffects(true);
            };
            
            // Use a more efficient quality setting for JPEG
            originalImage.src = tempCanvas.toDataURL('image/jpeg', 0.92);
            
            // Clean up
            tempCanvas.remove();
        };
        
        // Optimize image loading
        img.crossOrigin = 'anonymous';
        img.src = e.target.result;
    };
    
    // Optimize file reading
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
        workingCtxForEffects.imageSmoothingQuality = 'medium';
        workingCtxForEffects.drawImage(tempFullResCanvas, 0, 0, sourceWidth, sourceHeight);
        tempFullResCanvas.remove();
    } else {
        workingCanvasForEffects.width = sourceWidth;
        workingCanvasForEffects.height = sourceHeight;
        workingCtxForEffects.putImageData(baseGrayscaleImageData, 0, 0);
    }

    // Apply Contrast and Exposure
    const imageDataForProcessing = workingCtxForEffects.getImageData(0, 0, sourceWidth, sourceHeight);
    const pixelData = imageDataForProcessing.data;
    const contrastFactor = contrast;
    const exposureFactor = Math.pow(2, exposure);

    for (let i = 0; i < pixelData.length; i += 4) {
        // Apply contrast and exposure
        for (let j = 0; j < 3; j++) {
            let value = pixelData[i + j];
            value = ((value / 255 - 0.5) * contrastFactor + 0.5) * 255;
            value = value * exposureFactor;
            pixelData[i + j] = Math.max(0, Math.min(255, value));
        }
    }

    workingCtxForEffects.putImageData(imageDataForProcessing, 0, 0);

    // Apply Radial Blur if needed (exposure-neutral)
    if (radialBlur > 0) {
        const blurCanvas = document.createElement('canvas');
        blurCanvas.width = sourceWidth;
        blurCanvas.height = sourceHeight;
        const blurCtx = blurCanvas.getContext('2d');

        // 1) Create blurred version of the current image
        blurCtx.drawImage(workingCanvasForEffects, 0, 0);
        const blurAmount = radialBlur * (isLowRes ? 1.5 : 3);
        blurCtx.filter = `blur(${blurAmount}px)`;
        blurCtx.drawImage(blurCanvas, 0, 0);
        blurCtx.filter = 'none';

        // 2) Build an alpha mask that is 0 at center and 1 at edges
        const maskCanvas = document.createElement('canvas');
        maskCanvas.width = sourceWidth;
        maskCanvas.height = sourceHeight;
        const maskCtx = maskCanvas.getContext('2d');
        const centerX = sourceWidth / 2;
        const centerY = sourceHeight / 2;
        const maxRadius = Math.sqrt(centerX * centerX + centerY * centerY);
        const maskGradient = maskCtx.createRadialGradient(centerX, centerY, 0, centerX, centerY, maxRadius);
        // Smooth transition: no blur at center, increasing to full blur at edges
        maskGradient.addColorStop(0.0, 'rgba(0,0,0,0)');
        maskGradient.addColorStop(0.35, 'rgba(0,0,0,0.6)');
        maskGradient.addColorStop(0.7, 'rgba(0,0,0,0.85)');
        maskGradient.addColorStop(1.0, 'rgba(0,0,0,1)');
        maskCtx.fillStyle = maskGradient;
        maskCtx.fillRect(0, 0, sourceWidth, sourceHeight);

        // 3) Apply mask to blurred image (destination-in keeps only masked parts)
        blurCtx.globalCompositeOperation = 'destination-in';
        blurCtx.drawImage(maskCanvas, 0, 0);
        blurCtx.globalCompositeOperation = 'source-over';

        // 4) Composite masked blur over original image to replace pixels (no brightening)
        workingCtxForEffects.drawImage(blurCanvas, 0, 0);

        maskCanvas.remove();
        blurCanvas.remove();
    }

    // Draw the processed image to the main canvas
    if (isLowRes) {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'low';
        ctx.drawImage(workingCanvasForEffects, 0, 0, canvasWidth, canvasHeight);
    } else {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(workingCanvasForEffects, 0, 0, canvasWidth, canvasHeight);
    }
    
    workingCanvasForEffects.remove();

    // Apply Texture Overlay
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

    // Optimize canvas creation and context settings
    if (!cachedImageData) {
        previewCanvas.width = originalImage.width;
        previewCanvas.height = originalImage.height;
        
        // Optimize drawing settings
        previewCtx.imageSmoothingEnabled = true;
        previewCtx.imageSmoothingQuality = 'high';
        
        // Draw image with optimized settings
        previewCtx.drawImage(originalImage, 0, 0);
        
        // Get image data once and cache it
        cachedImageData = previewCtx.getImageData(0, 0, previewCanvas.width, previewCanvas.height);
        
        // Optimize grayscale conversion
        const data = cachedImageData.data;
        const len = data.length;
        for (let i = 0; i < len; i += 4) {
            const avg = (data[i] + data[i+1] + data[i+2]) / 3;
            data[i] = data[i+1] = data[i+2] = avg;
        }
    }

    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    
    // Set canvas dimensions
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

  if (customSelect && select) {
    const selected = document.createElement('div');
    selected.className = 'selected';
    selected.textContent = select.options[select.selectedIndex].text;
    selected.tabIndex = 0;
    selected.setAttribute('role', 'button');
    selected.setAttribute('aria-haspopup', 'listbox');
    selected.setAttribute('aria-expanded', 'false');
    customSelect.insertBefore(selected, customSelect.firstChild);

    function setOpen(open) {
      customSelect.classList.toggle('active', open);
      selected.setAttribute('aria-expanded', String(open));
    }

    // Ouvre/ferme le menu uniquement si on clique sur .selected
    selected.addEventListener('click', function(e) {
      e.stopPropagation();
      setOpen(!customSelect.classList.contains('active'));

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

    selected.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        selected.click();
      }
    });

    customSelect.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        setOpen(false);
        selected.focus();
      }
    });

    options.forEach(option => {
      option.tabIndex = 0;
      option.addEventListener('click', function(e) {
        e.stopPropagation();
        const value = this.getAttribute('data-value');
        select.value = value;
        selected.textContent = this.textContent;
        setOpen(false);
        // Déclencher l'événement change sur le select original
        const event = new Event('change');
        select.dispatchEvent(event);
      });
      option.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.click();
          selected.focus();
        }
      });
    });

    // Fermer le menu si on clique en dehors
    document.addEventListener('click', function(e) {
      if (!customSelect.contains(e.target)) {
        setOpen(false);
      }
    });
  }

  // Ajouter un gestionnaire pour le changement d'orientation
  window.addEventListener('orientationchange', () => {
    setTimeout(() => {
      // Forcer un rendu complet après le changement d'orientation
      applyPreviewEffects(true);
    }, 300);
  });
});
