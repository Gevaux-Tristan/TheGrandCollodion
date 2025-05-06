
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
let image = null;
let texture = new Image();
texture.src = document.getElementById("textureSelect").value;

document.getElementById("textureSelect").addEventListener("change", () => {
  texture.src = document.getElementById("textureSelect").value;
  texture.onload = render;
});

document.getElementById("imageUpload").addEventListener("change", (e) => {
  const reader = new FileReader();
  reader.onload = function (event) {
    image = new Image();
    image.onload = render;
    image.src = event.target.result;
  };
  reader.readAsDataURL(e.target.files[0]);
});

["contrastSlider", "opacitySlider", "grainSlider"].forEach(id => {
  document.getElementById(id).addEventListener("input", render);
});

document.getElementById("downloadBtn").addEventListener("click", () => {
  const link = document.createElement("a");
  link.download = "collodion_output.jpg";
  link.href = canvas.toDataURL("image/jpeg");
  link.click();
});

function applyGrain(imageData, intensity) {
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const grain = (Math.random() - 0.5) * 255 * intensity;
    data[i] += grain;
    data[i+1] += grain;
    data[i+2] += grain;
  }
  return imageData;
}

function render() {
  if (!image) return;

  const contrast = parseFloat(document.getElementById("contrastSlider").value);
  const opacity = parseFloat(document.getElementById("opacitySlider").value);
  const grain = parseFloat(document.getElementById("grainSlider").value);

  canvas.width = image.width;
  canvas.height = image.height;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.filter = `grayscale(1) contrast(${contrast})`;
  ctx.drawImage(image, 0, 0);

  ctx.filter = "none";
  ctx.globalAlpha = opacity;
  ctx.globalCompositeOperation = "overlay";
  ctx.drawImage(texture, 0, 0, canvas.width, canvas.height);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";

  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  ctx.putImageData(applyGrain(imgData, grain), 0, 0);
}
