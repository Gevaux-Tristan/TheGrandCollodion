// Variables globales
let originalImage = null;   // working image: source with crop/straighten applied
let sourceImage = null;     // pristine upload, crop re-edits start from here
let appliedCrop = null;     // { angle, ratio, rect } or null for full image
// live crop-editing state; rect is normalized to the rotated bounding box
const cropEdit = { active: false, angle: 0, ratio: 'free', rect: { x: 0, y: 0, w: 1, h: 1 } };
let textureImage = new Image();
let textureScreen = 0.3;    // bright-defect pass of the selected plate
let isProcessing = false;
let needsUpdate = false;
let previewCanvas = document.createElement('canvas');
let previewCtx = previewCanvas.getContext('2d');
let cachedImageData = null;  // pristine RGB of the working image, not greyscale
let autoLevels = null;       // { lo, hi } histogram bounds, measured once per upload
let isSliding = false;
let lastRenderTime = 0;
const RENDER_INTERVAL = window.innerWidth <= 900 ? 1000 / 15 : 1000 / 30;
const MOBILE_SCALE = 0.25;
const DESKTOP_SCALE = 0.5;
const isMobile = window.innerWidth <= 900;

// Radial blur focus point, normalized to the image (0-1). Tapping or
// dragging on the loaded photo moves it.
const blurCenter = { x: 0.5, y: 0.5 };

// 4:5 frame: mode 'off' | 'white' | 'black'; x/y place the photo within
// the frame margins (0-1, 0.5 = centered). Scale lives in the #frameScale
// slider. The photo is drawn at native resolution when scale is 1.
const frame = { mode: 'off', x: 0.5, y: 0.5 };
let framePhotoCanvas = null;

function frameScaleValue() {
    const slider = document.getElementById('frameScale');
    return slider ? parseFloat(slider.value) : 1;
}

// Frame + photo geometry in canvas pixels for the current image and scale
function computeFrameLayout() {
    const photoW = originalImage.width;
    const photoH = originalImage.height;
    let frameW, frameH;
    if (photoW / photoH > 4 / 5) {
        frameW = photoW;
        frameH = Math.round(photoW * 5 / 4);
    } else {
        frameH = photoH;
        frameW = Math.round(photoH * 4 / 5);
    }
    const scale = frameScaleValue();
    const w = photoW * scale;
    const h = photoH * scale;
    return {
        frameW, frameH, w, h,
        dx: (frameW - w) * frame.x,
        dy: (frameH - h) * frame.y
    };
}

// Grain: one cached tile of monochrome noise, tiled over the image at
// render time. 256px is fine enough to avoid visible repetition.
let grainCanvas = null;
function getGrainCanvas() {
    if (grainCanvas) return grainCanvas;
    const size = 256;
    grainCanvas = document.createElement('canvas');
    grainCanvas.width = size;
    grainCanvas.height = size;
    const ctx = grainCanvas.getContext('2d');
    const noise = ctx.createImageData(size, size);
    const data = noise.data;
    for (let i = 0; i < data.length; i += 4) {
        const value = 128 + (Math.random() - 0.5) * 220;
        data[i] = data[i + 1] = data[i + 2] = value;
        data[i + 3] = 255;
    }
    ctx.putImageData(noise, 0, 0);
    return grainCanvas;
}

// Texture optimization
const textureCache = new Map();
const PREVIEW_TEXTURE_SIZE = 1024; // Maximum size for preview textures

// --- Texture matching ------------------------------------------------------
// The 42 plate scans were never shot under the same light: their mean level
// runs from 21 (Collodion-11) to 215 (Collodion-07) and their spread from 10
// (Collodion-23) to 74 (Collodion-32). Overlay is neutral at mid-grey, so at
// one global opacity a dark scan crushed the photo while a bright one washed
// it out, and the same 50% meant something different on every plate.
//
// Every texture is therefore matched to Collodion-01, the default and the
// reference: same mean, same spread, its own pattern untouched. gain and lift
// map it (v * gain + lift), capped so no more than the outer 1% of its tones
// can reach 0 or 255, and bounded to 2.2x so a flat scan is not amplified into
// JPEG mush. screen is how much of the second, bright-defect pass it gets,
// proportional to how much of its own mass sits above its noise floor: a plate
// with comets and bare spots earns the flare, a smooth one gets none.
const TEXTURE_REFERENCE = { mean: 79.2, std: 51.7, bright: 4.53 };
const TEXTURE_PROFILES = {
    'Collodion-01.jpg': { gain: 1.000, lift: 0.0, screen: 0.300 },
    'Collodion-02.jpg': { gain: 2.200, lift: 13.6, screen: 0.205 },
    'Collodion-03.jpg': { gain: 0.994, lift: 14.4, screen: 0.267 },
    'Collodion-04.jpg': { gain: 0.818, lift: -46.6, screen: 0.000 },
    'Collodion-05.jpg': { gain: 1.630, lift: -31.0, screen: 0.198 },
    'Collodion-06.jpg': { gain: 0.925, lift: -32.4, screen: 0.099 },
    'Collodion-07.jpg': { gain: 2.200, lift: -392.9, screen: 0.199 },
    'Collodion-08.jpg': { gain: 2.036, lift: -342.0, screen: 0.000 },
    'Collodion-9.jpg': { gain: 0.550, lift: -31.2, screen: 0.121 },
    'Collodion-10.jpg': { gain: 0.669, lift: -25.4, screen: 0.000 },
    'Collodion-11.jpg': { gain: 2.200, lift: 33.7, screen: 0.275 },
    'Collodion-12.jpg': { gain: 2.200, lift: -24.9, screen: 0.396 },
    'Collodion-13.jpg': { gain: 2.200, lift: -9.2, screen: 0.337 },
    'Collodion-14.jpg': { gain: 2.200, lift: 0.0, screen: 0.285 },
    'Collodion-15.jpg': { gain: 2.200, lift: -9.7, screen: 0.279 },
    'Collodion-16.jpg': { gain: 0.734, lift: -17.6, screen: 0.000 },
    'Collodion-17.jpg': { gain: 0.773, lift: -3.9, screen: 0.000 },
    'Collodion-18.jpg': { gain: 0.550, lift: -10.0, screen: 0.000 },
    'Collodion-19.jpg': { gain: 0.550, lift: -13.5, screen: 0.000 },
    'Collodion-20.jpg': { gain: 1.868, lift: -6.6, screen: 0.199 },
    'Collodion-21.jpg': { gain: 2.200, lift: -120.6, screen: 0.480 },
    'Collodion-22.jpg': { gain: 1.410, lift: -10.0, screen: 0.356 },
    'Collodion-23.jpg': { gain: 2.200, lift: 15.4, screen: 0.207 },
    'Collodion-24.jpg': { gain: 0.889, lift: -10.7, screen: 0.121 },
    'Collodion-25.jpg': { gain: 0.975, lift: -15.6, screen: 0.000 },
    'Collodion-26.jpg': { gain: 0.753, lift: 36.0, screen: 0.480 },
    'Collodion-27.jpg': { gain: 0.751, lift: -12.0, screen: 0.070 },
    'Collodion-28.jpg': { gain: 1.290, lift: -6.4, screen: 0.035 },
    'Collodion-29.jpg': { gain: 1.121, lift: 46.5, screen: 0.406 },
    'Collodion-30.jpg': { gain: 0.550, lift: -10.6, screen: 0.295 },
    'Collodion-31.jpg': { gain: 0.620, lift: -7.4, screen: 0.000 },
    'Collodion-32.jpg': { gain: 0.669, lift: 0.0, screen: 0.000 },
    'Collodion-33.jpg': { gain: 2.200, lift: 17.8, screen: 0.187 },
    'Collodion-34.jpg': { gain: 1.136, lift: -28.4, screen: 0.011 },
    'Collodion-35.jpg': { gain: 1.780, lift: -33.8, screen: 0.148 },
    'Collodion-36.jpg': { gain: 1.817, lift: -36.3, screen: 0.289 },
    'Collodion-37.jpg': { gain: 0.873, lift: -22.7, screen: 0.017 },
    'Collodion-38.jpg': { gain: 0.853, lift: -5.1, screen: 0.035 },
    'Collodion-39.jpg': { gain: 1.211, lift: -8.5, screen: 0.035 },
    'Collodion-40.jpg': { gain: 0.975, lift: -1.1, screen: 0.254 },
    'Collodion-41.jpg': { gain: 1.043, lift: -4.2, screen: 0.041 },
    'Collodion-42.jpg': { gain: 0.802, lift: -8.0, screen: 0.000 }
};

// Same derivation as the table above, for a texture added after it was written.
// Costs one pass over the already-downscaled scan, and only for that texture.
function measureTextureProfile(ctx, width, height) {
    const data = ctx.getImageData(0, 0, width, height).data;
    const hist = new Uint32Array(256);
    let total = 0;
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) {
        const v = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) | 0;
        hist[v < 0 ? 0 : (v > 255 ? 255 : v)]++;
        sum += v;
        total++;
    }
    if (!total) return { gain: 1, lift: 0, screen: 0.3 };

    const mean = sum / total;
    let sq = 0;
    for (let v = 0; v < 256; v++) sq += hist[v] * (v - mean) * (v - mean);
    const std = Math.sqrt(sq / total) || 1;
    const percentile = q => {
        let acc = 0;
        const target = total * q;
        for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= target) return v; }
        return 255;
    };
    const p01 = percentile(0.01);
    const p99 = percentile(0.99);

    const caps = [2.2, TEXTURE_REFERENCE.std / std];
    if (mean - p01 > 0) caps.push(TEXTURE_REFERENCE.mean / (mean - p01));
    if (p99 - mean > 0) caps.push((255 - TEXTURE_REFERENCE.mean) / (p99 - mean));
    const gain = Math.max(0.55, Math.min(...caps));

    const threshold = Math.min(250, mean + 2 * std);
    let bright = 0;
    for (let v = Math.ceil(threshold); v < 256; v++) bright += hist[v];

    return {
        gain,
        lift: TEXTURE_REFERENCE.mean - mean * gain,
        screen: Math.min(1.6, (bright / total * 100) / TEXTURE_REFERENCE.bright) * 0.3
    };
}

// Bake the match into the scan once, so the render loop stays a plain drawImage
function buildTexturePlate(sourceCanvas, profile) {
    const plate = document.createElement('canvas');
    plate.width = sourceCanvas.width;
    plate.height = sourceCanvas.height;
    const ctx = plate.getContext('2d');
    ctx.drawImage(sourceCanvas, 0, 0);

    if (profile.gain === 1 && profile.lift === 0) return plate;

    const lut = new Uint8ClampedArray(256);
    for (let v = 0; v < 256; v++) lut[v] = v * profile.gain + profile.lift;

    const imageData = ctx.getImageData(0, 0, plate.width, plate.height);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
        data[i] = lut[data[i]];
        data[i + 1] = lut[data[i + 1]];
        data[i + 2] = lut[data[i + 2]];
    }
    ctx.putImageData(imageData, 0, 0);
    return plate;
}

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

            const profile = TEXTURE_PROFILES[src] || measureTextureProfile(previewCtx, width, height);

            const result = {
                original: img,
                // Raw scan: the chips show the plate as it was scanned, since
                // matched plates all share one level and would be hard to tell apart
                preview: previewTexture,
                // Matched to the reference plate, this is what gets composited
                plate: buildTexturePlate(previewCanvas, profile),
                screen: profile.screen
            };
            
            textureCache.set(src, result);
            resolve(result);
        };
        img.src = src;
    });
}

// Offline: register the service worker (relative path for GitHub Pages subpath)
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch(error => {
            console.error('Service worker registration failed:', error);
        });
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
        grainSlider: document.getElementById('grain'),
        plaqueSlider: document.getElementById('plaque'),
        exposureSlider: document.getElementById('exposure'),
        radialBlurSlider: document.getElementById('radialBlur'),
        frameScaleSlider: document.getElementById('frameScale'),
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
    loadOptimizedTexture("Collodion-01.jpg").then(texture => {
        textureImage = texture.plate;
        textureScreen = texture.screen;
    });

    // Configurer les event listeners
    setupDragAndDrop(elements.previewContainer);
    setupFileUpload(elements.imageInput);
    setupFileUpload(elements.cameraInput);
    setupSliders(elements);
    setupDownloadButton(elements.downloadButton, elements.canvas);
    setupTextureSelect(elements.textureSelect);
    buildTextureChips(elements.textureSelect);
    setupSliderValues();
    setupFrameControls();
    setupMobilePanel();
    setupTapToUpload(elements.previewContainer, elements.imageInput);
    setupBlurFocus(elements.previewContainer, elements.canvas);
    setupCropTool(elements.previewContainer, elements.canvas);
    setupGallery();
}

// Tap or drag on the loaded photo. Default: place the radial blur focus
// point (amber reticle). When the 4:5 frame is on (and the blur editor is
// not open), dragging positions the photo inside the frame instead.
function setupBlurFocus(previewContainer, canvas) {
    const reticle = document.createElement('div');
    reticle.id = 'blur-focus-reticle';
    previewContainer.appendChild(reticle);
    let hideTimer = null;
    let dragging = false;
    let dragMode = 'blur';
    let start = null;

    function blurEditorOpen() {
        const panel = document.getElementById('mobile-panel');
        return !!(panel && panel.dataset.mode === 'editor' && document.querySelector('#m-editor-slot #radialBlur'));
    }

    function dragTarget() {
        if (blurEditorOpen()) return 'blur';
        if (frame.mode !== 'off') return 'frame';
        return 'blur';
    }

    function showReticle() {
        if (!originalImage) return;
        const rect = canvas.getBoundingClientRect();
        const parentRect = previewContainer.getBoundingClientRect();
        let left = blurCenter.x * rect.width;
        let top = blurCenter.y * rect.height;
        if (frame.mode !== 'off') {
            const layout = computeFrameLayout();
            left = (layout.dx + blurCenter.x * layout.w) / layout.frameW * rect.width;
            top = (layout.dy + blurCenter.y * layout.h) / layout.frameH * rect.height;
        }
        reticle.style.left = (rect.left - parentRect.left + left) + 'px';
        reticle.style.top = (rect.top - parentRect.top + top) + 'px';
        reticle.classList.add('visible');
        clearTimeout(hideTimer);
        hideTimer = setTimeout(() => reticle.classList.remove('visible'), 1200);
    }

    function setBlurFromEvent(e) {
        const rect = canvas.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        let nx = (e.clientX - rect.left) / rect.width;
        let ny = (e.clientY - rect.top) / rect.height;
        if (frame.mode !== 'off') {
            const layout = computeFrameLayout();
            nx = layout.w ? (nx * layout.frameW - layout.dx) / layout.w : 0.5;
            ny = layout.h ? (ny * layout.frameH - layout.dy) / layout.h : 0.5;
        }
        blurCenter.x = Math.min(1, Math.max(0, nx));
        blurCenter.y = Math.min(1, Math.max(0, ny));
        showReticle();
        applyPreviewEffects(false);
    }

    function moveFrameFromEvent(e) {
        const rect = canvas.getBoundingClientRect();
        if (!rect.width || !start) return;
        const layout = computeFrameLayout();
        const marginX = (layout.frameW - layout.w) / layout.frameW * rect.width;
        const marginY = (layout.frameH - layout.h) / layout.frameH * rect.height;
        frame.x = marginX > 0
            ? Math.min(1, Math.max(0, start.x + (e.clientX - start.clientX) / marginX))
            : 0.5;
        frame.y = marginY > 0
            ? Math.min(1, Math.max(0, start.y + (e.clientY - start.clientY) / marginY))
            : 0.5;
        applyPreviewEffects(false);
    }

    previewContainer.addEventListener('pointerdown', (e) => {
        if (!originalImage || cropEdit.active) return;
        dragging = true;
        isSliding = true;
        dragMode = dragTarget();
        start = { clientX: e.clientX, clientY: e.clientY, x: frame.x, y: frame.y };
        if (dragMode === 'blur') setBlurFromEvent(e);
    });

    previewContainer.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        if (dragMode === 'blur') setBlurFromEvent(e);
        else moveFrameFromEvent(e);
    });

    function endDrag() {
        if (!dragging) return;
        dragging = false;
        isSliding = false;
        applyPreviewEffects(true);
    }

    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);

    // Adjusting the blur slider also reveals where the focus point sits
    const blurSlider = document.getElementById('radialBlur');
    if (blurSlider) blurSlider.addEventListener('input', showReticle);
}

// ===== Crop & straighten =====
// The working image is re-derived from the pristine source each time the
// crop is applied, so re-opening the tool is non-destructive.

function cropRatioPx() {
    if (cropEdit.ratio === 'free') return null;
    const [a, b] = cropEdit.ratio.split(':').map(Number);
    return a / b;
}

function boundingBoxFor(angle) {
    const rad = angle * Math.PI / 180;
    const cos = Math.abs(Math.cos(rad));
    const sin = Math.abs(Math.sin(rad));
    return {
        w: sourceImage.width * cos + sourceImage.height * sin,
        h: sourceImage.width * sin + sourceImage.height * cos
    };
}

// Largest axis-aligned rectangle fully inside the rotated source
function largestInscribed(w, h, rad) {
    const sinA = Math.abs(Math.sin(rad));
    const cosA = Math.abs(Math.cos(rad));
    if (sinA < 1e-6) return { w, h };
    const widthIsLonger = w >= h;
    const longSide = widthIsLonger ? w : h;
    const shortSide = widthIsLonger ? h : w;
    if (shortSide <= 2 * sinA * cosA * longSide || Math.abs(sinA - cosA) < 1e-10) {
        const x = 0.5 * shortSide;
        return widthIsLonger ? { w: x / sinA, h: x / cosA } : { w: x / cosA, h: x / sinA };
    }
    const cos2A = cosA * cosA - sinA * sinA;
    return { w: (w * cosA - h * sinA) / cos2A, h: (h * cosA - w * sinA) / cos2A };
}

// Allowed crop bounds (normalized, centered) so the crop never contains
// empty corners introduced by the rotation
function cropBounds() {
    if (!cropEdit.angle) return { x: 0, y: 0, w: 1, h: 1 };
    const rad = cropEdit.angle * Math.PI / 180;
    const ins = largestInscribed(sourceImage.width, sourceImage.height, rad);
    const bb = boundingBoxFor(cropEdit.angle);
    return {
        x: (bb.w - ins.w) / 2 / bb.w,
        y: (bb.h - ins.h) / 2 / bb.h,
        w: ins.w / bb.w,
        h: ins.h / bb.h
    };
}

function clampNum(v, lo, hi) {
    return Math.min(hi, Math.max(lo, v));
}

// Recompute the crop rect after an angle or ratio change: keep the
// center, honor the locked ratio, stay inside the allowed bounds
function refitCropRect() {
    const bounds = cropBounds();
    const bb = boundingBoxFor(cropEdit.angle);
    const ratio = cropRatioPx();
    let { x, y, w, h } = cropEdit.rect;
    const cx = x + w / 2;
    const cy = y + h / 2;
    if (ratio) {
        let pw = Math.min(w * bb.w, bounds.w * bb.w);
        let ph = pw / ratio;
        if (ph > bounds.h * bb.h) {
            ph = bounds.h * bb.h;
            pw = ph * ratio;
        }
        w = pw / bb.w;
        h = ph / bb.h;
    } else {
        w = Math.min(w, bounds.w);
        h = Math.min(h, bounds.h);
    }
    x = clampNum(cx - w / 2, bounds.x, bounds.x + bounds.w - w);
    y = clampNum(cy - h / 2, bounds.y, bounds.y + bounds.h - h);
    cropEdit.rect = { x, y, w, h };
}

// Fill the ratio at maximum size when the user picks a chip
function fitCropToRatio() {
    const bounds = cropBounds();
    const bb = boundingBoxFor(cropEdit.angle);
    const ratio = cropRatioPx();
    if (!ratio) return;
    let pw = bounds.w * bb.w;
    let ph = pw / ratio;
    if (ph > bounds.h * bb.h) {
        ph = bounds.h * bb.h;
        pw = ph * ratio;
    }
    const prev = cropEdit.rect;
    const cx = prev.x + prev.w / 2;
    const cy = prev.y + prev.h / 2;
    const w = pw / bb.w;
    const h = ph / bb.h;
    cropEdit.rect = {
        x: clampNum(cx - w / 2, bounds.x, bounds.x + bounds.w - w),
        y: clampNum(cy - h / 2, bounds.y, bounds.y + bounds.h - h),
        w, h
    };
}

// Draw the rotated source on a canvas sized to its bounding box
function renderRotatedSource(target) {
    const bb = boundingBoxFor(cropEdit.angle);
    target.width = Math.max(1, Math.round(bb.w));
    target.height = Math.max(1, Math.round(bb.h));
    const tctx = target.getContext('2d');
    tctx.imageSmoothingEnabled = true;
    tctx.imageSmoothingQuality = 'high';
    tctx.translate(target.width / 2, target.height / 2);
    tctx.rotate(cropEdit.angle * Math.PI / 180);
    tctx.drawImage(sourceImage, -sourceImage.width / 2, -sourceImage.height / 2);
    tctx.setTransform(1, 0, 0, 1, 0, 0);
}

// Auto-straighten: histogram of edge orientations near horizontal or
// vertical; the dominant deviation is the correction to apply
function estimateAutoAngle() {
    const size = 240;
    const scale = Math.min(size / sourceImage.width, size / sourceImage.height, 1);
    const w = Math.max(3, Math.round(sourceImage.width * scale));
    const h = Math.max(3, Math.round(sourceImage.height * scale));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(sourceImage, 0, 0, w, h);
    const d = g.getImageData(0, 0, w, h).data;
    const lum = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) {
        lum[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
    }
    const bins = new Float32Array(241); // -12° .. +12° by 0.1°
    let total = 0;
    for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
            const i = y * w + x;
            const gx = lum[i + 1 - w] + 2 * lum[i + 1] + lum[i + 1 + w]
                     - lum[i - 1 - w] - 2 * lum[i - 1] - lum[i - 1 + w];
            const gy = lum[i + w - 1] + 2 * lum[i + w] + lum[i + w + 1]
                     - lum[i - w - 1] - 2 * lum[i - w] - lum[i - w + 1];
            const mag = Math.hypot(gx, gy);
            if (mag < 120) continue;
            const line = Math.atan2(gy, gx) * 180 / Math.PI + 90;
            let dev = ((line % 90) + 90) % 90;
            if (dev > 45) dev -= 90;
            if (Math.abs(dev) <= 12) {
                bins[Math.round((dev + 12) * 10)] += mag;
                total += mag;
            }
        }
    }
    if (!total) return 0;
    let best = 120;
    let bestV = 0;
    for (let k = 2; k <= 238; k++) {
        const v = bins[k - 2] + bins[k - 1] + bins[k] + bins[k + 1] + bins[k + 2];
        if (v > bestV) {
            bestV = v;
            best = k;
        }
    }
    if (bestV < total * 0.05) return 0;
    return clampNum(-(best / 10 - 12), -15, 15);
}

function setupCropTool(previewContainer, canvas) {
    const overlay = document.getElementById('crop-overlay');
    const box = document.getElementById('crop-box');
    const straighten = document.getElementById('straighten');
    const straightenOut = document.getElementById('straighten-value');
    if (!overlay || !box || !straighten) return;

    function updateStraightenOut() {
        const v = parseFloat(straighten.value);
        straightenOut.textContent = (v > 0 ? '+' : '') + v.toFixed(1) + '°';
    }

    function syncRatioChips() {
        document.querySelectorAll('#crop-ratios button').forEach(b =>
            b.setAttribute('aria-pressed', String(b.dataset.ratio === cropEdit.ratio)));
    }

    function renderCropPreview() {
        renderRotatedSource(canvas);
    }

    function updateOverlay() {
        const rect = canvas.getBoundingClientRect();
        const parent = previewContainer.getBoundingClientRect();
        overlay.style.left = (rect.left - parent.left) + 'px';
        overlay.style.top = (rect.top - parent.top) + 'px';
        overlay.style.width = rect.width + 'px';
        overlay.style.height = rect.height + 'px';
        const r = cropEdit.rect;
        box.style.left = (r.x * rect.width) + 'px';
        box.style.top = (r.y * rect.height) + 'px';
        box.style.width = (r.w * rect.width) + 'px';
        box.style.height = (r.h * rect.height) + 'px';
    }

    function refresh() {
        renderCropPreview();
        updateOverlay();
    }

    window.enterCropMode = function() {
        if (!sourceImage) return false;
        cropEdit.active = true;
        if (appliedCrop) {
            cropEdit.angle = appliedCrop.angle;
            cropEdit.ratio = appliedCrop.ratio;
            cropEdit.rect = Object.assign({}, appliedCrop.rect);
        } else {
            cropEdit.angle = 0;
            cropEdit.ratio = 'free';
            cropEdit.rect = { x: 0, y: 0, w: 1, h: 1 };
        }
        straighten.value = String(cropEdit.angle);
        updateStraightenOut();
        syncRatioChips();
        document.body.classList.add('cropping');
        refresh();
        return true;
    };

    window.exitCropMode = function(apply) {
        cropEdit.active = false;
        document.body.classList.remove('cropping');
        if (apply) {
            const full = cropEdit.angle === 0 && cropEdit.rect.w > 0.999 && cropEdit.rect.h > 0.999;
            if (full) {
                appliedCrop = null;
                setWorkingImage(sourceImage);
            } else {
                appliedCrop = {
                    angle: cropEdit.angle,
                    ratio: cropEdit.ratio,
                    rect: Object.assign({}, cropEdit.rect)
                };
                const temp = document.createElement('canvas');
                renderRotatedSource(temp);
                const r = cropEdit.rect;
                const out = document.createElement('canvas');
                out.width = Math.max(1, Math.round(r.w * temp.width));
                out.height = Math.max(1, Math.round(r.h * temp.height));
                out.getContext('2d').drawImage(
                    temp,
                    Math.round(r.x * temp.width), Math.round(r.y * temp.height),
                    out.width, out.height,
                    0, 0, out.width, out.height
                );
                const img = new Image();
                img.onload = () => setWorkingImage(img);
                img.src = out.toDataURL('image/jpeg', 0.95);
            }
        } else {
            applyPreviewEffects(true);
        }
    };

    document.querySelectorAll('#crop-ratios button').forEach(btn => {
        btn.addEventListener('click', () => {
            cropEdit.ratio = btn.dataset.ratio;
            syncRatioChips();
            if (cropEdit.ratio !== 'free') fitCropToRatio();
            updateOverlay();
        });
    });

    straighten.addEventListener('input', () => {
        cropEdit.angle = parseFloat(straighten.value);
        updateStraightenOut();
        refitCropRect();
        refresh();
    });

    const autoBtn = document.getElementById('straighten-auto');
    if (autoBtn) {
        autoBtn.addEventListener('click', () => {
            straighten.value = String(estimateAutoAngle());
            straighten.dispatchEvent(new Event('input'));
        });
    }

    // Dragging: corners resize, inside moves
    let drag = null;
    overlay.addEventListener('pointerdown', (e) => {
        const rect = canvas.getBoundingClientRect();
        if (!rect.width) return;
        const handle = e.target.closest('.crop-handle');
        const nx = (e.clientX - rect.left) / rect.width;
        const ny = (e.clientY - rect.top) / rect.height;
        const r = cropEdit.rect;
        if (handle) {
            drag = { mode: handle.dataset.corner, rect: Object.assign({}, r) };
        } else if (nx >= r.x && nx <= r.x + r.w && ny >= r.y && ny <= r.y + r.h) {
            drag = { mode: 'move', rect: Object.assign({}, r), startX: nx, startY: ny };
        } else {
            return;
        }
        overlay.setPointerCapture(e.pointerId);
        e.preventDefault();
    });

    overlay.addEventListener('pointermove', (e) => {
        if (!drag) return;
        const rect = canvas.getBoundingClientRect();
        const nx = (e.clientX - rect.left) / rect.width;
        const ny = (e.clientY - rect.top) / rect.height;
        const bounds = cropBounds();
        if (drag.mode === 'move') {
            const w = drag.rect.w;
            const h = drag.rect.h;
            cropEdit.rect = {
                x: clampNum(drag.rect.x + (nx - drag.startX), bounds.x, bounds.x + bounds.w - w),
                y: clampNum(drag.rect.y + (ny - drag.startY), bounds.y, bounds.y + bounds.h - h),
                w, h
            };
        } else {
            const bb = boundingBoxFor(cropEdit.angle);
            const minN = 0.08;
            const corner = drag.mode;
            const ax = corner.includes('w') ? drag.rect.x + drag.rect.w : drag.rect.x;
            const ay = corner.includes('n') ? drag.rect.y + drag.rect.h : drag.rect.y;
            const mx = clampNum(nx, bounds.x, bounds.x + bounds.w);
            const my = clampNum(ny, bounds.y, bounds.y + bounds.h);
            let w = Math.max(minN, Math.abs(mx - ax));
            let h = Math.max(minN, Math.abs(my - ay));
            const sx = mx >= ax ? 1 : -1;
            const sy = my >= ay ? 1 : -1;
            const ratio = cropRatioPx();
            if (ratio) {
                let pw = w * bb.w;
                let ph = h * bb.h;
                if (pw / ratio >= ph) ph = pw / ratio; else pw = ph * ratio;
                const maxW = (sx > 0 ? bounds.x + bounds.w - ax : ax - bounds.x) * bb.w;
                const maxH = (sy > 0 ? bounds.y + bounds.h - ay : ay - bounds.y) * bb.h;
                if (pw > maxW) { pw = maxW; ph = pw / ratio; }
                if (ph > maxH) { ph = maxH; pw = ph * ratio; }
                w = pw / bb.w;
                h = ph / bb.h;
            }
            cropEdit.rect = {
                x: sx > 0 ? ax : ax - w,
                y: sy > 0 ? ay : ay - h,
                w, h
            };
        }
        updateOverlay();
    });

    function endCropDrag() {
        drag = null;
    }
    overlay.addEventListener('pointerup', endCropDrag);
    overlay.addEventListener('pointercancel', endCropDrag);

    window.addEventListener('resize', debounce(() => {
        if (cropEdit.active) updateOverlay();
    }, 150));

    // Desktop entry points (the mobile panel drives its own)
    const enterBtn = document.getElementById('crop-enter');
    if (enterBtn) enterBtn.addEventListener('click', () => window.enterCropMode());
    const dCancel = document.getElementById('crop-cancel-desktop');
    const dApply = document.getElementById('crop-apply-desktop');
    if (dCancel) dCancel.addEventListener('click', () => window.exitCropMode(false));
    if (dApply) dApply.addEventListener('click', () => window.exitCropMode(true));
}

// Frame background chips (Aucun / Blanc / Noir), shared by both layouts
function setupFrameControls() {
    const bgButtons = document.querySelectorAll('#frame-bg-buttons button');
    bgButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            frame.mode = btn.dataset.bg;
            bgButtons.forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
            applyPreviewEffects(true);
        });
    });
}

// Live value readouts next to each slider label
const SLIDER_FORMATTERS = {
    contrast: v => v.toFixed(1),
    opacity: v => Math.round(v * 100) + '%',
    grain: v => Math.round(v * 100) + '%',
    plaque: v => Math.round(v * 100) + '%',
    exposure: v => (v > 0 ? '+' : '') + v.toFixed(1),
    radialBlur: v => v.toFixed(1),
    frameScale: v => Math.round(v * 100) + '%'
};

function setupSliderValues() {
    document.querySelectorAll('output[data-slider]').forEach(output => {
        const slider = document.getElementById(output.dataset.slider);
        if (!slider) return;
        const format = SLIDER_FORMATTERS[output.dataset.slider] || (v => String(v));
        const update = () => { output.textContent = format(parseFloat(slider.value)); };
        slider.addEventListener('input', update);
        update();
    });
}

// Mobile bottom bar: root (Texture / Adjust) -> settings icons -> one slider
// The active range input is MOVED into the editor slot so there is a single
// source of truth; cancel restores the value captured on entry.
const SLIDER_LABELS = {
    contrast: 'Contrast',
    opacity: 'Texture opacity',
    grain: 'Grain',
    plaque: 'Plaque',
    exposure: 'Exposure',
    radialBlur: 'Radial Blur'
};

function setupMobilePanel() {
    const panel = document.getElementById('mobile-panel');
    if (!panel) return;
    const editorSlot = document.getElementById('m-editor-slot');
    const editorLabel = document.getElementById('m-editor-label');
    const editorValue = document.getElementById('m-editor-value');
    const select = document.getElementById('texture');
    const mq = window.matchMedia('(max-width: 900px)');

    let activeSlider = null;
    let sliderHome = null;
    let prevValue = null;
    let prevTexture = null;
    let prevFrame = null;
    let frameHome = null;
    const frameControl = document.getElementById('frame-control');
    const frameSlot = document.getElementById('m-frame-slot');
    let cropHome = null;
    const cropTools = document.getElementById('crop-tools');
    const cropSlot = document.getElementById('m-crop-slot');

    function setMode(mode) {
        panel.dataset.mode = mode;
        requestAnimationFrame(() => {
            document.documentElement.style.setProperty('--m-panel-h', panel.offsetHeight + 'px');
        });
    }

    function updateEditorValue() {
        if (!activeSlider) return;
        const format = SLIDER_FORMATTERS[activeSlider.id] || (v => String(v));
        editorValue.textContent = format(parseFloat(activeSlider.value));
    }

    function openSlider(id) {
        const slider = document.getElementById(id);
        if (!slider) return;
        activeSlider = slider;
        prevValue = slider.value;
        sliderHome = { parent: slider.parentNode, next: slider.nextSibling };
        editorSlot.appendChild(slider);
        editorLabel.textContent = SLIDER_LABELS[id] || id;
        updateEditorValue();
        setMode('editor');
    }

    function closeEditor(apply) {
        if (!activeSlider) return;
        if (!apply && activeSlider.value !== prevValue) {
            activeSlider.value = prevValue;
            activeSlider.dispatchEvent(new Event('input'));
            activeSlider.dispatchEvent(new Event('change'));
        }
        sliderHome.parent.insertBefore(activeSlider, sliderHome.next);
        activeSlider = null;
        setMode('settings');
    }

    function openFrame() {
        prevFrame = {
            mode: frame.mode,
            x: frame.x,
            y: frame.y,
            scale: document.getElementById('frameScale').value
        };
        frameHome = { parent: frameControl.parentNode, next: frameControl.nextSibling };
        frameSlot.appendChild(frameControl);
        setMode('frame');
    }

    function closeFrame(apply) {
        if (!apply && prevFrame) {
            frame.mode = prevFrame.mode;
            frame.x = prevFrame.x;
            frame.y = prevFrame.y;
            document.getElementById('frameScale').value = prevFrame.scale;
            document.querySelectorAll('#frame-bg-buttons button').forEach(b =>
                b.setAttribute('aria-pressed', String(b.dataset.bg === frame.mode)));
            document.getElementById('frameScale').dispatchEvent(new Event('input'));
            applyPreviewEffects(true);
        }
        if (frameHome) frameHome.parent.insertBefore(frameControl, frameHome.next);
        setMode('root');
    }

    function openCrop() {
        if (!window.enterCropMode || !window.enterCropMode()) return;
        cropHome = { parent: cropTools.parentNode, next: cropTools.nextSibling };
        cropSlot.appendChild(cropTools);
        setMode('crop');
    }

    function closeCrop(apply) {
        if (window.exitCropMode) window.exitCropMode(apply);
        if (cropHome) cropHome.parent.insertBefore(cropTools, cropHome.next);
        setMode('root');
    }

    panel.querySelectorAll('.m-root [data-open]').forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.dataset.open === 'texture') {
                prevTexture = select.value;
                setMode('texture');
            } else if (btn.dataset.open === 'frame') {
                openFrame();
            } else if (btn.dataset.open === 'crop') {
                openCrop();
            } else {
                setMode('settings');
            }
        });
    });

    document.getElementById('m-frame-cancel').addEventListener('click', () => closeFrame(false));
    document.getElementById('m-frame-apply').addEventListener('click', () => closeFrame(true));
    document.getElementById('m-crop-cancel').addEventListener('click', () => closeCrop(false));
    document.getElementById('m-crop-apply').addEventListener('click', () => closeCrop(true));

    document.getElementById('m-set-cancel').addEventListener('click', () => setMode('root'));
    document.getElementById('m-set-apply').addEventListener('click', () => setMode('root'));

    panel.querySelectorAll('.m-settings [data-slider]').forEach(btn => {
        btn.addEventListener('click', () => openSlider(btn.dataset.slider));
    });

    editorSlot.addEventListener('input', updateEditorValue);
    document.getElementById('m-cancel').addEventListener('click', () => closeEditor(false));
    document.getElementById('m-apply').addEventListener('click', () => closeEditor(true));

    document.getElementById('m-tex-cancel').addEventListener('click', () => {
        if (prevTexture !== null && select.value !== prevTexture) {
            select.value = prevTexture;
            select.dispatchEvent(new Event('change'));
        }
        setMode('root');
    });
    document.getElementById('m-tex-apply').addEventListener('click', () => setMode('root'));

    // Top bar proxies to the (hidden) desktop controls
    const proxies = [['m-upload', 'upload'], ['m-camera', 'camera'], ['m-download', 'download']];
    proxies.forEach(([proxyId, targetId]) => {
        const proxy = document.getElementById(proxyId);
        const target = document.getElementById(targetId);
        if (proxy && target) proxy.addEventListener('click', () => target.click());
    });

    // Leaving mobile with the editor open would strand the slider in the
    // hidden panel: put everything back before the desktop layout shows.
    if (mq.addEventListener) {
        mq.addEventListener('change', () => {
            if (!mq.matches) {
                if (activeSlider) closeEditor(true);
                if (panel.dataset.mode === 'frame') closeFrame(true);
                if (panel.dataset.mode === 'crop') closeCrop(true);
                setMode('root');
            }
        });
    }

    window.addEventListener('resize', debounce(() => setMode(panel.dataset.mode), 150));
    window.addEventListener('orientationchange', () => setTimeout(() => setMode(panel.dataset.mode), 350));
    setMode('root');
}

// Tap anywhere on the empty preview to open the file picker
function setupTapToUpload(previewContainer, imageInput) {
    previewContainer.addEventListener('click', () => {
        if (!originalImage) {
            imageInput.click();
        }
    });
}

// Tiny square thumbnail for a chip: painting the full-size textures as
// chip backgrounds is what made the panel feel sluggish on mobile.
function setChipThumb(chip, src) {
    loadOptimizedTexture(src).then(texture => {
        const img = texture.preview;
        const paint = () => {
            const size = 120;
            const canvas = document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d');
            const crop = Math.min(img.width, img.height);
            ctx.drawImage(img, (img.width - crop) / 2, (img.height - crop) / 2, crop, crop, 0, 0, size, size);
            chip.style.backgroundImage = `url("${canvas.toDataURL('image/jpeg', 0.75)}")`;
        };
        if (img.complete && img.width) paint();
        else img.addEventListener('load', paint, { once: true });
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
        setChipThumb(chip, opt.value);
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
        elements.plaqueSlider,
        elements.contrastSlider,
        elements.opacitySlider,
        elements.grainSlider,
        elements.exposureSlider,
        elements.radialBlurSlider,
        elements.frameScaleSlider
    ];

    sliders.forEach(slider => {
        slider.addEventListener('input', createSliderHandler(slider));
        slider.addEventListener('change', () => {
            isSliding = false;
            applyPreviewEffects(true);
        });
    });
}

// The GrandCollodion-2026-08-05-14-30-07 — seconds keep names unique when
// several photos are exported within the same minute
function exportStamp(date) {
    const p = n => String(n).padStart(2, '0');
    return [
        date.getFullYear(), '-', p(date.getMonth() + 1), '-', p(date.getDate()),
        '-', p(date.getHours()), '-', p(date.getMinutes()), '-', p(date.getSeconds())
    ].join('');
}

function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => {
        canvas.toBlob(blob => {
            blob ? resolve(blob) : reject(new Error('canvas.toBlob returned null'));
        }, type, quality);
    });
}

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.download = filename;
    link.href = url;
    link.click();
    // Revoking synchronously can cancel the download in some browsers
    setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function setupDownloadButton(downloadButton, canvas) {
    downloadButton.addEventListener('click', async () => {
        if (cropEdit.active) return; // the canvas is showing the crop preview
        if (!originalImage) return;  // nothing loaded: would export a blank canvas
        const originalText = downloadButton.innerHTML;
        downloadButton.disabled = true;
        downloadButton.innerHTML = '<span class="material-icon">hourglass_empty</span>Processing...';
        downloadButton.style.opacity = '0.7';

        try {
            const blob = await canvasToBlob(canvas, 'image/jpeg', 1.0);
            const filename = `The GrandCollodion-${exportStamp(new Date())}.jpg`;
            downloadBlob(blob, filename);
            // Every download is archived so it can be re-exported in batch later
            await galleryArchive(canvas, blob, filename);
        } catch (error) {
            console.error('Export failed:', error);
        } finally {
            downloadButton.disabled = false;
            downloadButton.innerHTML = originalText;
            downloadButton.style.opacity = '1';
        }
    });
}

// ===== Gallery storage (IndexedDB) =====
// Downloads are archived as their final JPEG plus a small thumbnail, so the
// grid stays cheap to paint and a batch export is a straight file copy.

const GALLERY_DB = 'collodion-gallery';
const GALLERY_STORE = 'photos';
const GALLERY_MAX = 60;   // oldest entries are pruned past this
const THUMB_MAX = 320;    // longest edge of the stored thumbnail, in px

let galleryDbPromise = null;

function openGalleryDb() {
    if (!galleryDbPromise) {
        galleryDbPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(GALLERY_DB, 1);
            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains(GALLERY_STORE)) {
                    const store = db.createObjectStore(GALLERY_STORE, { keyPath: 'id' });
                    store.createIndex('createdAt', 'createdAt');
                }
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        }).catch(error => {
            galleryDbPromise = null; // let a later call retry
            throw error;
        });
    }
    return galleryDbPromise;
}

// Wraps one transaction: `run` receives the store and returns an IDBRequest
// (or nothing); the promise settles when the transaction itself completes.
async function galleryTx(mode, run) {
    const db = await openGalleryDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(GALLERY_STORE, mode);
        let request;
        try {
            request = run(tx.objectStore(GALLERY_STORE));
        } catch (error) {
            reject(error);
            return;
        }
        tx.oncomplete = () => resolve(request ? request.result : undefined);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
    });
}

// Newest first, which is the order the grid shows
function galleryList() {
    return galleryTx('readonly', store => store.index('createdAt').getAll())
        .then(records => (records || []).reverse());
}

function galleryCount() {
    return galleryTx('readonly', store => store.count()).then(n => n || 0);
}

function galleryRemove(ids) {
    return galleryTx('readwrite', store => {
        ids.forEach(id => store.delete(id));
    });
}

// Keep the archive bounded: drop the oldest entries beyond GALLERY_MAX
async function galleryPrune() {
    const total = await galleryCount();
    if (total <= GALLERY_MAX) return;
    const stale = await galleryTx('readonly', store =>
        store.index('createdAt').getAllKeys(null, total - GALLERY_MAX));
    if (stale && stale.length) await galleryRemove(stale);
}

async function makeThumbnail(canvas) {
    const scale = Math.min(1, THUMB_MAX / Math.max(canvas.width, canvas.height));
    const thumb = document.createElement('canvas');
    thumb.width = Math.max(1, Math.round(canvas.width * scale));
    thumb.height = Math.max(1, Math.round(canvas.height * scale));
    const ctx = thumb.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(canvas, 0, 0, thumb.width, thumb.height);
    const blob = await canvasToBlob(thumb, 'image/jpeg', 0.82);
    thumb.remove();
    return blob;
}

async function galleryArchive(canvas, blob, filename) {
    try {
        const thumb = await makeThumbnail(canvas);
        await galleryTx('readwrite', store => store.put({
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            createdAt: Date.now(),
            name: filename,
            width: canvas.width,
            height: canvas.height,
            size: blob.size,
            blob,
            thumb
        }));
        await galleryPrune();
    } catch (error) {
        // A failed archive must never cost the user their download
        console.error('Gallery archive failed:', error);
    }
    refreshGalleryCount();
}

// ===== Minimal ZIP writer (store method, no compression) =====
// JPEGs are already compressed, so deflating them would only burn CPU for
// nothing. Storing them raw keeps this dependency-free and the PWA offline.

const CRC32_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let bit = 0; bit < 8; bit++) {
            c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        }
        table[i] = c >>> 0;
    }
    return table;
})();

function crc32(bytes) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) {
        crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

// MS-DOS packed date/time: 2-second resolution, epoch 1980
function dosDateTime(date) {
    return {
        time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
        date: ((Math.max(1980, date.getFullYear()) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
    };
}

function writeU16(bytes, offset, value) {
    bytes[offset] = value & 0xFF;
    bytes[offset + 1] = (value >>> 8) & 0xFF;
}

function writeU32(bytes, offset, value) {
    bytes[offset] = value & 0xFF;
    bytes[offset + 1] = (value >>> 8) & 0xFF;
    bytes[offset + 2] = (value >>> 16) & 0xFF;
    bytes[offset + 3] = (value >>> 24) & 0xFF;
}

class ZipWriter {
    constructor() {
        this.parts = [];    // Blob parts, assembled once at the end
        this.central = [];  // central directory records
        this.offset = 0;    // running byte offset of the local headers
    }

    async addBlob(name, blob, date) {
        const nameBytes = new TextEncoder().encode(name);
        // Read once for the CRC, then hand the Blob itself to the parts list
        // so only one file's bytes sit in memory at a time.
        const crc = crc32(new Uint8Array(await blob.arrayBuffer()));
        const size = blob.size;
        const stamp = dosDateTime(date);
        const localOffset = this.offset;

        const local = new Uint8Array(30 + nameBytes.length);
        writeU32(local, 0, 0x04034b50);
        writeU16(local, 4, 20);      // version needed to extract
        writeU16(local, 6, 0x0800);  // flags: filename is UTF-8
        writeU16(local, 8, 0);       // method: store
        writeU16(local, 10, stamp.time);
        writeU16(local, 12, stamp.date);
        writeU32(local, 14, crc);
        writeU32(local, 18, size);
        writeU32(local, 22, size);
        writeU16(local, 26, nameBytes.length);
        writeU16(local, 28, 0);      // extra field length
        local.set(nameBytes, 30);

        this.parts.push(local, blob);
        this.offset += local.length + size;

        const central = new Uint8Array(46 + nameBytes.length);
        writeU32(central, 0, 0x02014b50);
        writeU16(central, 4, 20);      // version made by
        writeU16(central, 6, 20);      // version needed
        writeU16(central, 8, 0x0800);
        writeU16(central, 10, 0);
        writeU16(central, 12, stamp.time);
        writeU16(central, 14, stamp.date);
        writeU32(central, 16, crc);
        writeU32(central, 20, size);
        writeU32(central, 24, size);
        writeU16(central, 28, nameBytes.length);
        writeU16(central, 30, 0);      // extra field length
        writeU16(central, 32, 0);      // comment length
        writeU16(central, 34, 0);      // disk number start
        writeU16(central, 36, 0);      // internal attributes
        writeU32(central, 38, 0);      // external attributes
        writeU32(central, 42, localOffset);
        central.set(nameBytes, 46);
        this.central.push(central);
    }

    finish() {
        const centralOffset = this.offset;
        let centralSize = 0;
        this.central.forEach(record => {
            this.parts.push(record);
            centralSize += record.length;
        });

        const end = new Uint8Array(22);
        writeU32(end, 0, 0x06054b50);
        writeU16(end, 4, 0);   // this disk number
        writeU16(end, 6, 0);   // disk with the central directory
        writeU16(end, 8, this.central.length);
        writeU16(end, 10, this.central.length);
        writeU32(end, 12, centralSize);
        writeU32(end, 16, centralOffset);
        writeU16(end, 20, 0);  // archive comment length
        this.parts.push(end);

        return new Blob(this.parts, { type: 'application/zip' });
    }
}

// ===== Gallery UI =====

const gallerySelection = new Set();
const galleryThumbUrls = new Map();
let galleryRecords = [];
let galleryBusy = false;

function refreshGalleryCount() {
    galleryCount().then(total => {
        document.querySelectorAll('.gallery-count').forEach(badge => {
            badge.textContent = String(total);
            badge.hidden = total === 0;
        });
    }).catch(() => {});
}

function formatBytes(bytes) {
    if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' Mo';
    return Math.max(1, Math.round(bytes / 1024)) + ' Ko';
}

function releaseThumbUrls() {
    galleryThumbUrls.forEach(url => URL.revokeObjectURL(url));
    galleryThumbUrls.clear();
}

function setGalleryStatus(message) {
    const status = document.getElementById('gallery-status');
    status.textContent = message || '';
    status.hidden = !message;
}

function setupGallery() {
    const overlay = document.getElementById('gallery');
    const grid = document.getElementById('gallery-grid');
    const empty = document.getElementById('gallery-empty');
    const subtitle = document.getElementById('gallery-sub');
    const selectAllBtn = document.getElementById('gallery-select-all');
    const deleteBtn = document.getElementById('gallery-delete');
    const exportBtn = document.getElementById('gallery-export');
    if (!overlay) return;

    function syncActions() {
        const picked = gallerySelection.size;
        const total = galleryRecords.length;
        subtitle.textContent = total
            ? `${total} photo${total > 1 ? 's' : ''}${picked ? ` · ${picked} sélectionnée${picked > 1 ? 's' : ''}` : ''}`
            : '';
        deleteBtn.disabled = exportBtn.disabled = picked === 0 || galleryBusy;
        selectAllBtn.disabled = total === 0 || galleryBusy;
        selectAllBtn.textContent = total && picked === total ? 'Tout désélectionner' : 'Tout sélectionner';
        deleteBtn.innerHTML = `<span class="material-icon">delete</span>Supprimer${picked ? ` (${picked})` : ''}`;
        exportBtn.innerHTML = `<span class="material-icon">archive</span>Exporter${picked ? ` (${picked})` : ''}`;
    }

    function toggle(id, tile) {
        if (gallerySelection.has(id)) gallerySelection.delete(id);
        else gallerySelection.add(id);
        tile.setAttribute('aria-pressed', String(gallerySelection.has(id)));
        syncActions();
    }

    function buildTile(record) {
        const tile = document.createElement('button');
        tile.type = 'button';
        tile.className = 'gallery-tile';
        tile.setAttribute('aria-pressed', String(gallerySelection.has(record.id)));

        const url = URL.createObjectURL(record.thumb);
        galleryThumbUrls.set(record.id, url);
        const img = document.createElement('img');
        img.src = url;
        img.alt = '';
        tile.appendChild(img);

        const check = document.createElement('span');
        check.className = 'tile-check';
        check.innerHTML = '<span class="material-icon">check</span>';
        tile.appendChild(check);

        const caption = document.createElement('figcaption');
        const when = new Date(record.createdAt);
        const time = String(when.getHours()).padStart(2, '0') + ':' + String(when.getMinutes()).padStart(2, '0');
        caption.textContent = `${time} · ${formatBytes(record.size)}`;
        tile.appendChild(caption);

        tile.setAttribute('aria-label',
            `${when.toLocaleDateString('fr-FR')} ${time}, ${record.width}×${record.height}, ${formatBytes(record.size)}`);
        tile.addEventListener('click', () => toggle(record.id, tile));
        return tile;
    }

    async function render() {
        releaseThumbUrls();
        grid.textContent = '';
        try {
            galleryRecords = await galleryList();
        } catch (error) {
            console.error('Gallery read failed:', error);
            galleryRecords = [];
            setGalleryStatus('Lecture de la galerie impossible.');
        }
        // Drop selections whose photo no longer exists
        const alive = new Set(galleryRecords.map(r => r.id));
        Array.from(gallerySelection).forEach(id => {
            if (!alive.has(id)) gallerySelection.delete(id);
        });
        galleryRecords.forEach(record => grid.appendChild(buildTile(record)));
        empty.hidden = galleryRecords.length > 0;
        syncActions();
    }

    function open() {
        overlay.hidden = false;
        document.body.classList.add('gallery-open');
        setGalleryStatus('');
        render().then(() => document.getElementById('gallery-close').focus());
    }

    // Always allowed, even mid-export: an in-flight export holds its own
    // reference to the records, so closing cannot strand it — and this stays
    // the user's escape hatch if anything ever stalls.
    function close() {
        overlay.hidden = true;
        document.body.classList.remove('gallery-open');
        releaseThumbUrls();
        grid.textContent = '';
        galleryRecords = [];
        gallerySelection.clear();
        setGalleryStatus('');
    }

    function selected() {
        return galleryRecords.filter(record => gallerySelection.has(record.id));
    }

    // Two photos exported in the same second would collide inside the zip
    function uniqueName(name, taken) {
        if (!taken.has(name)) {
            taken.add(name);
            return name;
        }
        const dot = name.lastIndexOf('.');
        const stem = dot > 0 ? name.slice(0, dot) : name;
        const ext = dot > 0 ? name.slice(dot) : '';
        let n = 2;
        let candidate;
        do {
            candidate = `${stem} (${n++})${ext}`;
        } while (taken.has(candidate));
        taken.add(candidate);
        return candidate;
    }

    async function exportSelected() {
        const records = selected();
        if (!records.length) return;
        galleryBusy = true;
        syncActions();
        try {
            if (records.length === 1) {
                downloadBlob(records[0].blob, records[0].name);
            } else {
                const zip = new ZipWriter();
                const taken = new Set();
                for (let i = 0; i < records.length; i++) {
                    setGalleryStatus(`Préparation de l'archive… ${i + 1}/${records.length}`);
                    // Yield so the status text repaints between files. setTimeout
                    // rather than requestAnimationFrame: rAF never fires in a
                    // backgrounded tab, which would hang the export for good.
                    await new Promise(resolve => setTimeout(resolve, 0));
                    await zip.addBlob(uniqueName(records[i].name, taken), records[i].blob, new Date(records[i].createdAt));
                }
                downloadBlob(zip.finish(), `The GrandCollodion-${exportStamp(new Date())}.zip`);
            }
            setGalleryStatus(`${records.length} photo${records.length > 1 ? 's' : ''} exportée${records.length > 1 ? 's' : ''}.`);
        } catch (error) {
            console.error('Batch export failed:', error);
            setGalleryStatus('Export impossible. Réessayez avec moins de photos.');
        } finally {
            galleryBusy = false;
            syncActions();
        }
    }

    async function deleteSelected() {
        const records = selected();
        if (!records.length) return;
        const label = records.length > 1
            ? `Supprimer définitivement ces ${records.length} photos ?`
            : 'Supprimer définitivement cette photo ?';
        if (!window.confirm(label)) return;
        galleryBusy = true;
        syncActions();
        try {
            await galleryRemove(records.map(record => record.id));
            gallerySelection.clear();
            setGalleryStatus(`${records.length} photo${records.length > 1 ? 's' : ''} supprimée${records.length > 1 ? 's' : ''}.`);
        } catch (error) {
            console.error('Gallery delete failed:', error);
            setGalleryStatus('Suppression impossible.');
        } finally {
            galleryBusy = false;
            await render();
            refreshGalleryCount();
        }
    }

    selectAllBtn.addEventListener('click', () => {
        if (gallerySelection.size === galleryRecords.length) gallerySelection.clear();
        else galleryRecords.forEach(record => gallerySelection.add(record.id));
        grid.querySelectorAll('.gallery-tile').forEach((tile, i) => {
            tile.setAttribute('aria-pressed', String(gallerySelection.has(galleryRecords[i].id)));
        });
        syncActions();
    });

    exportBtn.addEventListener('click', exportSelected);
    deleteBtn.addEventListener('click', deleteSelected);
    document.getElementById('gallery-close').addEventListener('click', close);
    document.getElementById('gallery-open').addEventListener('click', open);
    document.getElementById('m-gallery').addEventListener('click', open);

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !overlay.hidden) close();
    });

    refreshGalleryCount();
}

function setupTextureSelect(textureSelect) {
    // Preload all textures
    const textureOptions = Array.from(textureSelect.options);
    textureOptions.forEach(option => {
        loadOptimizedTexture(option.value);
    });

    textureSelect.addEventListener('change', async () => {
        const texture = await loadOptimizedTexture(textureSelect.value);
        textureImage = texture.plate;
        textureScreen = texture.screen;
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
            
            // Keep the pristine source; crop/straighten derive the working image
            sourceImage = new Image();
            sourceImage.onload = function() {
                appliedCrop = null;
                setWorkingImage(sourceImage);
            };
            sourceImage.src = tempCanvas.toDataURL('image/jpeg', 0.92);
            
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

// --- Plate pass -------------------------------------------------------------
// Collodion is sensitive to UV and blue and blind to red: skies burn out white,
// red lips and ruddy skin go dark, freckles turn black, blue eyes go pale.
// These are the weights at full strength; the Plaque slider mixes between
// neutral luma and them.
const ORTHO = { r: 0.05, g: 0.20, b: 0.75 };
const LUMA = { r: 0.299, g: 0.587, b: 0.114 };

// Shadows warm-brown, highlights cream. A plate is never neutral grey.
const TINT_SHADOW = [6, 2, -4];
const TINT_HIGH = [10, 4, -14];

function orthoWeights(plaque) {
    return {
        r: LUMA.r + plaque * (ORTHO.r - LUMA.r),
        g: LUMA.g + plaque * (ORTHO.g - LUMA.g),
        b: LUMA.b + plaque * (ORTHO.b - LUMA.b)
    };
}

// One histogram per upload, measured on the same orthochromatic mix the render
// uses, so an underexposed or flat phone photo still lands on the plate's range.
function computeAutoLevels(imageData, plaque) {
    const data = imageData.data;
    const w = orthoWeights(plaque);
    const hist = new Uint32Array(256);
    // Sample ~200k pixels: the bounds do not get better past that, and a 48 MP
    // phone photo would otherwise stall the first render.
    const step = 4 * Math.max(1, Math.floor(data.length / 4 / 200000));
    let count = 0;
    for (let i = 0; i < data.length; i += step) {
        let v = data[i] * w.r + data[i + 1] * w.g + data[i + 2] * w.b;
        v = v < 0 ? 0 : (v > 255 ? 255 : v | 0);
        hist[v]++;
        count++;
    }
    const cutLo = count * 0.005;
    const cutHi = count * 0.995;
    let acc = 0;
    let lo = 0;
    let hi = 255;
    for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= cutLo) { lo = i; break; } }
    acc = 0;
    for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= cutHi) { hi = i; break; } }
    // Cap the stretch: a genuinely foggy or high-key frame should stay that way
    // instead of being forced into full range.
    lo = Math.min(lo, 60);
    hi = Math.max(hi, 195);
    if (hi - lo < 32) { lo = 0; hi = 255; }
    return { lo, hi };
}

// Auto-levels, contrast, exposure, S-curve, lifted toe, blown highlights and
// split-tone are all per-scalar, so a single 256-entry RGB table replaces the
// per-pixel float chain that used to run for contrast and exposure alone.
function buildToneLUT(contrast, exposure, plaque, levels) {
    const lut = new Uint8ClampedArray(768);
    const exposureFactor = Math.pow(2, exposure);
    const lo = levels ? levels.lo : 0;
    const hi = levels ? levels.hi : 255;
    const span = Math.max(1, hi - lo);
    const sCurve = 0.55 * plaque;
    const toe = 12 * plaque;   // blacks never reach 0: the glass itself carries density
    const tint = 0.55 * plaque;

    for (let i = 0; i < 256; i++) {
        let v = (i - lo) / span;
        v = v < 0 ? 0 : (v > 1 ? 1 : v);
        v = (v - 0.5) * contrast + 0.5;
        v *= exposureFactor;
        v = v < 0 ? 0 : (v > 1 ? 1 : v);
        v = v + sCurve * ((3 * v * v - 2 * v * v * v) - v);
        // Collodion blows its highlights rather than rolling off into them
        if (v > 0.82) v = 0.82 + (v - 0.82) * 1.6;
        v = v < 0 ? 0 : (v > 1 ? 1 : v);
        const base = toe + v * (255 - toe);
        const k = i * 3;
        lut[k] = base + tint * (TINT_SHADOW[0] + v * (TINT_HIGH[0] - TINT_SHADOW[0]));
        lut[k + 1] = base + tint * (TINT_SHADOW[1] + v * (TINT_HIGH[1] - TINT_SHADOW[1]));
        lut[k + 2] = base + tint * (TINT_SHADOW[2] + v * (TINT_HIGH[2] - TINT_SHADOW[2]));
    }
    return lut;
}

// Highlights on a wet plate bleed into their surroundings. Cubing a blurred
// copy (two multiply passes over itself) leaves only the brightest areas, which
// are then screened back over the image.
function applyHalation(ctx, width, height, amount) {
    const temp = document.createElement('canvas');
    temp.width = width;
    temp.height = height;
    const tctx = temp.getContext('2d');
    tctx.filter = `blur(${Math.max(2, Math.round(Math.min(width, height) * 0.012))}px)`;
    tctx.drawImage(ctx.canvas, 0, 0, width, height);
    tctx.filter = 'none';
    tctx.globalCompositeOperation = 'multiply';
    tctx.drawImage(temp, 0, 0);
    tctx.drawImage(temp, 0, 0);
    tctx.globalCompositeOperation = 'source-over';

    ctx.globalAlpha = amount;
    ctx.globalCompositeOperation = 'screen';
    ctx.drawImage(temp, 0, 0, width, height);
    ctx.globalAlpha = 1.0;
    ctx.globalCompositeOperation = 'source-over';
    temp.remove();
}

// Density falls off towards the edges of every plate. Centred on the same focus
// point as the radial blur so both read as one lens.
function applyVignette(ctx, width, height, amount, focus) {
    const cx = (focus ? focus.x : 0.5) * width;
    const cy = (focus ? focus.y : 0.5) * height;
    const radius = Math.sqrt(
        Math.pow(Math.max(cx, width - cx), 2) +
        Math.pow(Math.max(cy, height - cy), 2)
    );
    const gradient = ctx.createRadialGradient(cx, cy, radius * 0.35, cx, cy, radius);
    gradient.addColorStop(0, 'rgba(0,0,0,0)');
    gradient.addColorStop(1, `rgba(0,0,0,${amount})`);
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    ctx.globalCompositeOperation = 'source-over';
}

// Cover-fit, never stretch: a plate scan squeezed onto a portrait crop reads as
// a distorted overlay instead of glass.
function drawTextureCover(ctx, texture, width, height) {
    const scale = Math.max(width / texture.width, height / texture.height);
    const tw = texture.width * scale;
    const th = texture.height * scale;
    ctx.drawImage(texture, (width - tw) / 2, (height - th) / 2, tw, th);
}

function applyEffects(ctx, canvasWidth, canvasHeight, settings, isLowRes = false) {
    const { contrast, exposure, radialBlur, opacity, grain, plaque, texture, textureScreen: flareAmount, blurCenter: focus, imageData: baseGrayscaleImageData } = settings;

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

    // Orthochromatic mix, then one lookup per pixel for everything tonal
    const imageDataForProcessing = workingCtxForEffects.getImageData(0, 0, sourceWidth, sourceHeight);
    const pixelData = imageDataForProcessing.data;
    const weights = orthoWeights(plaque);
    const lut = buildToneLUT(contrast, exposure, plaque, autoLevels);

    for (let i = 0; i < pixelData.length; i += 4) {
        let v = pixelData[i] * weights.r + pixelData[i + 1] * weights.g + pixelData[i + 2] * weights.b;
        v = v < 0 ? 0 : (v > 255 ? 255 : v);
        const k = (v | 0) * 3;
        pixelData[i] = lut[k];
        pixelData[i + 1] = lut[k + 1];
        pixelData[i + 2] = lut[k + 2];
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
        // Focus point in normalized coords; the radius reaches the farthest
        // corner so edges blur fully wherever the focus sits
        const centerX = (focus ? focus.x : 0.5) * sourceWidth;
        const centerY = (focus ? focus.y : 0.5) * sourceHeight;
        const maxRadius = Math.sqrt(
            Math.pow(Math.max(centerX, sourceWidth - centerX), 2) +
            Math.pow(Math.max(centerY, sourceHeight - centerY), 2)
        );
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

    // Lens and plate character, before the grain and the glass sit on top.
    // Halation costs three full-resolution canvas passes, so it is skipped while
    // a slider is being dragged and comes back on the full-quality render.
    if (plaque > 0) {
        if (!isLowRes) applyHalation(ctx, canvasWidth, canvasHeight, plaque * 0.15);
        applyVignette(ctx, canvasWidth, canvasHeight, plaque * 0.30, focus);
    }

    // Apply Grain (tiled monochrome noise, contrast-neutral around mid-gray)
    if (grain > 0) {
        ctx.globalAlpha = grain * 0.45;
        ctx.globalCompositeOperation = 'overlay';
        ctx.fillStyle = ctx.createPattern(getGrainCanvas(), 'repeat');
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);
        ctx.globalAlpha = 1.0;
        ctx.globalCompositeOperation = 'source-over';
    }

    // Apply Texture Overlay
    if (texture && texture.width > 0 && opacity > 0) {
        ctx.globalAlpha = opacity;
        ctx.globalCompositeOperation = "overlay";
        drawTextureCover(ctx, texture, canvasWidth, canvasHeight);
        // Overlay buries the bright defects of a real plate (comets, bare spots,
        // pour marks); a screen pass puts them back above the image, as much as
        // this particular plate actually carries.
        if (flareAmount > 0) {
            ctx.globalAlpha = opacity * flareAmount;
            ctx.globalCompositeOperation = "screen";
            drawTextureCover(ctx, texture, canvasWidth, canvasHeight);
        }
        ctx.globalAlpha = 1.0;
        ctx.globalCompositeOperation = "source-over";
    }
}

function setWorkingImage(img) {
    originalImage = img;
    document.getElementById('preview-container').classList.add('has-image');
    cachedImageData = null;
    applyPreviewEffects(true);
}

function applyPreviewEffects(forceFullQuality = false) {
    if (!originalImage) {
        return;
    }
    if (cropEdit.active) {
        return; // the canvas is showing the crop preview
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

        // The colour channels are kept on purpose: the plate pass needs them to
        // emulate orthochromatic sensitivity. Averaging to grey here would throw
        // away the one thing that makes a collodion read as a collodion.
        autoLevels = computeAutoLevels(cachedImageData, parseFloat(document.getElementById('plaque').value));
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
        grain: parseFloat(document.getElementById('grain').value),
        plaque: parseFloat(document.getElementById('plaque').value),
        texture: textureImage,
        textureScreen: textureScreen,
        blurCenter: blurCenter,
        imageData: cachedImageData
    };

    const lowRes = isSliding && !forceFullQuality;

    if (frame.mode === 'off') {
        applyEffects(ctx, canvas.width, canvas.height, settings, lowRes);
    } else {
        // Render the processed photo offscreen, then compose it on the 4:5
        // background at the user's scale and position
        if (!framePhotoCanvas) framePhotoCanvas = document.createElement('canvas');
        framePhotoCanvas.width = originalImage.width;
        framePhotoCanvas.height = originalImage.height;
        applyEffects(framePhotoCanvas.getContext('2d'), framePhotoCanvas.width, framePhotoCanvas.height, settings, lowRes);

        const layout = computeFrameLayout();
        canvas.width = layout.frameW;
        canvas.height = layout.frameH;
        ctx.fillStyle = frame.mode === 'white' ? '#FFFFFF' : '#000000';
        ctx.fillRect(0, 0, layout.frameW, layout.frameH);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(framePhotoCanvas, layout.dx, layout.dy, layout.w, layout.h);
    }

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
