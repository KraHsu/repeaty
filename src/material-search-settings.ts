import { readSetting, persistSetting } from './settings-store'
import { parseSynonymGroups } from './core/material-search'
export const MATERIAL_SYNONYMS_KEY = 'repeaty.material-synonyms.v1'
export function readSynonyms() {
  const text = readSetting(MATERIAL_SYNONYMS_KEY) ?? ''
  return { text, groups: parseSynonymGroups(text) }
}
export async function saveSynonyms(text: string) {
  parseSynonymGroups(text)
  await persistSetting(MATERIAL_SYNONYMS_KEY, text.trim())
}
