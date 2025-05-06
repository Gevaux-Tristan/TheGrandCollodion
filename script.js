const upload = document.getElementById('upload');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const download = document.getElementById('download');

const overlayImg = new Image();
const textureSelect = document.getElementById('textureSelect');
const opacityRange = document.getElementById('opacityRange');
const intensityRange = document.getElementById('intensityRange');
const opacityValue = document.getElementById('opacityValue');
const intensityValue = document.getElementById('intensityValue');

let originalImage = null;

function updateTexture() {
    overlayImg.src = 'assets/' + textureSelect.value;
    if (originalImage) {
        overlayImg.onload = () => renderImage();
    }
}

textureSelect.addEventListener('change', updateTexture);

opacityRange.addEventListener('input', () => {
    opacityValue.textContent = opacityRange.value;
    if (originalImage) renderImage();
});

intensityRange.addEventListener('input', () => {
    intensityValue.textContent = intensityRange.value;
    if (originalImage) renderImage();
});

function renderImage() {
    const maxHeight = window.innerHeight * 0.9;
    const ratio = originalImage.width / originalImage.height;

    if (originalImage.height > maxHeight) {
        canvas.height = maxHeight;
        canvas.width = maxHeight * ratio;
    } else {
        canvas.width = originalImage.width;
        canvas.height = originalImage.height;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(originalImage, 0, 0, canvas.width, canvas.height);

    let imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let data = imageData.data;
    const contrastIntensity = parseFloat(intensityRange.value);
    for (let i = 0; i < data.length; i += 4) {
        let avg = 0.3 * data[i] + 0.59 * data[i+1] + 0.11 * data[i+2];
        avg = avg > 128 ? Math.min(255, avg * contrastIntensity) : avg * 0.6;
        data[i] = data[i+1] = data[i+2] = avg;
    }
    ctx.putImageData(imageData, 0, 0);

    const gradient = ctx.createRadialGradient(
        canvas.width/2, canvas.height/2, canvas.width/4,
        canvas.width/2, canvas.height/2, canvas.width/1.1
    );
    gradient.addColorStop(0, "rgba(0,0,0,0)");
    gradient.addColorStop(1, "rgba(0,0,0,0.4)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.globalAlpha = parseFloat(opacityRange.value);
    ctx.drawImage(overlayImg, 0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = 1.0;
}

upload.addEventListener('change', function(e) {
    const file = e.target.files[0];
    const reader = new FileReader();

    reader.onload = function(event) {
        originalImage = new Image();
        originalImage.onload = function() {
        canvas.classList.remove('placeholder');
            updateTexture(); // recharge texture et attend son onload
        };
        originalImage.src = event.target.result;
    };
    reader.readAsDataURL(file);
});

download.addEventListener('click', () => {
    if (!originalImage) return;
    renderImage();
    setTimeout(() => {
        const link = document.createElement('a');
        link.href = canvas.toDataURL('image/jpeg', 0.92);
        link.download = 'la_cabine_output.jpg';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }, 100);
});

// Initialisation
opacityValue.textContent = opacityRange.value;
intensityValue.textContent = intensityRange.value;
updateTexture();



function applyGrain(ctx, width, height, grainAmount) {
  if (!grainAmount || grainAmount <= 0) return;
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const noise = (Math.random() - 0.5) * (grainAmount / 2);
    data[i] += noise;
    data[i + 1] += noise;
    data[i + 2] += noise;
  }
  ctx.putImageData(imageData, 0, 0);
}


document.getElementById('grain').addEventListener('input', drawCanvas);