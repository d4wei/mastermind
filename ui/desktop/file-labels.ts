/** Distinguish equal basenames without exposing every directory in the tab row. */
export function fileLabels(paths: string[]): string[] {
  const parts = paths.map((path) => path.split(/[\\/]/))
  return parts.map((segments, index) => {
    for (let length = 1; length <= segments.length; length++) {
      const label = segments.slice(-length).join('/')
      if (!parts.some((other, otherIndex) => otherIndex !== index && other.slice(-length).join('/') === label)) {
        return label
      }
    }
    return paths[index]!
  })
}
