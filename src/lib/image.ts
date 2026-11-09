// Read an image file and downscale it to a JPEG data URL. xAI vision accepts
// jpg/png up to ~10 MiB each; 1536px long side keeps requests small.
export async function fileToDataUrl(file: File, maxSide = 1536, quality = 0.9): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((ok, bad) => {
      const i = new Image()
      i.onload = () => ok(i)
      i.onerror = () => bad(new Error('无法读取图片：' + file.name))
      i.src = url
    })
    const k = Math.min(1, maxSide / Math.max(img.width, img.height))
    const c = document.createElement('canvas')
    c.width = Math.round(img.width * k)
    c.height = Math.round(img.height * k)
    const g = c.getContext('2d')!
    g.fillStyle = '#fff' // transparent PNGs → white, not black
    g.fillRect(0, 0, c.width, c.height)
    g.drawImage(img, 0, 0, c.width, c.height)
    return c.toDataURL('image/jpeg', quality)
  } finally {
    URL.revokeObjectURL(url)
  }
}
