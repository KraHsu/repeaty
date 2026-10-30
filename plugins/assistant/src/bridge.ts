import { nativePlugin } from '@repeaty/plugin-api'
import { createNativeProvider, createProfiles } from './adapter'
export const profiles = createProfiles(nativePlugin)
export const provider = createNativeProvider(nativePlugin)
