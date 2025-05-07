
const imageInput = document.getElementById("upload");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
let originalImage = null;
let textureImage = new Image();

const contrastSlider = document.getElementById("contrast");
const opacitySlider = document.getElementById("opacity");
const grainSlider = document.getElementById("grain");
const textureSelect = document.getElementById("texture");

function applyEffects() {
  if (!originalImage) return;

  canvas.width = originalImage.width;
  canvas.height = originalImage.height;

  ctx.drawImage(originalImage, 0, 0);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  const contrast = parseFloat(contrastSlider.value);

  for (let i = 0; i < data.length; i += 4) {
    let avg = (data[i] + data[i+1] + data[i+2]) / 3;
    avg = ((avg - 128) * contrast + 128);
    avg = Math.min(255, Math.max(0, avg));
    data[i] = data[i+1] = data[i+2] = avg;
  }

  ctx.putImageData(imageData, 0, 0);

  const grainAmount = parseFloat(grainSlider.value);
  const grainData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < grainData.data.length; i += 4) {
    const noise = (Math.random() - 0.5) * 255 * grainAmount;
    grainData.data[i] += noise;
    grainData.data[i+1] += noise;
    grainData.data[i+2] += noise;
  }
  ctx.putImageData(grainData, 0, 0);

  const opacity = parseFloat(opacitySlider.value);
  if (textureImage.src && textureImage.complete) {
    ctx.globalAlpha = opacity;
    ctx.globalCompositeOperation = "overlay";
    ctx.drawImage(textureImage, 0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = 1.0;
    ctx.globalCompositeOperation = "source-over";
  }
}

function loadImage(file) {
  const reader = new FileReader();
  reader.onload = function (e) {
    const img = new Image();
    img.onload = function () {
      originalImage = img;
      applyEffects();
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

[contrastSlider, opacitySlider, grainSlider].forEach(slider => {
  slider.addEventListener("input", () => applyEffects());
});

textureSelect.addEventListener("change", () => {
  textureImage.src = textureSelect.value;
  textureImage.onload = () => applyEffects();
});

document.getElementById("download").addEventListener("click", () => {
  const link = document.createElement("a");
  link.download = "collodion-image.jpg";
  link.href = canvas.toDataURL("image/jpeg");
  link.click();
});
