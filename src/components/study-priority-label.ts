import type { Library } from '../core/model'
import { t } from '../i18n'

export function studyPriorityOrigin(
  library: Library,
  source: { kind: 'source' | 'folder' | 'deck' | 'note' | 'default'; from: string },
) {
  if (source.kind === 'source')
    return library.sources.find((entry) => entry.id === source.from)?.title ?? t('上级材料')
  if (source.kind === 'folder')
    return library.materialFolders.find((entry) => entry.id === source.from)?.name ?? t('文件夹')
  if (source.kind === 'deck')
    return library.decks.find((entry) => entry.id === source.from)?.name ?? t('卡组')
  return t('默认学习优先级')
}
