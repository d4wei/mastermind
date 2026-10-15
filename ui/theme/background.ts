import { reviewerHost } from '../app/host'

export function syncHostBackground(): void {
  const host = reviewerHost()
  if (!host?.setBackgroundColor) return
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 1
  const context = canvas.getContext('2d', { colorSpace: 'srgb' })
  if (!context) return
  // Let the browser convert theme colors (including OKLCH) into the native sRGB channels.
  context.fillStyle = getComputedStyle(document.documentElement).backgroundColor
  context.fillRect(0, 0, 1, 1)
  const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data
  void host.setBackgroundColor([red!, green!, blue!, alpha!])
    .catch((error) => console.error('Could not update the native background', error))
}
