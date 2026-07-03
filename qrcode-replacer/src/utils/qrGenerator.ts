import QRCode from 'qrcode'

export async function generateQRCode(data: string, size: number = 512): Promise<HTMLImageElement> {
  const canvas = document.createElement('canvas')
  
  await QRCode.toCanvas(canvas, data, {
    width: size,
    margin: 0,
    color: {
      dark: '#000000',
      light: '#ffffff'
    }
  })

  const image = new Image()
  image.src = canvas.toDataURL('image/png')
  
  return new Promise((resolve) => {
    image.onload = () => resolve(image)
    if (image.complete) resolve(image)
  })
}

export async function generateQRCodeDataUrl(data: string, size: number = 512): Promise<string> {
  return QRCode.toDataURL(data, {
    width: size,
    margin: 0,
    color: {
      dark: '#000000',
      light: '#ffffff'
    }
  })
}