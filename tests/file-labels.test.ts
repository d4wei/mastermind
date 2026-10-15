import { expect, it } from 'vitest'
import { fileLabels } from '../ui/desktop/file-labels'

it('uses filenames and only adds parents where they distinguish duplicate names', () => {
  expect(fileLabels(['/one/readme.md', '/two/readme.md', '/one/notes.md']))
    .toEqual(['one/readme.md', 'two/readme.md', 'notes.md'])
  expect(fileLabels(['/a/shared/文档.md', '/b/shared/文档.md']))
    .toEqual(['a/shared/文档.md', 'b/shared/文档.md'])
})

it('disambiguates Windows drive roots and mixed separators', () => {
  expect(fileLabels(['C:\\work\\plan.md', 'D:\\work\\plan.md', '/a/notes.md']))
    .toEqual(['C:/work/plan.md', 'D:/work/plan.md', 'notes.md'])
})
