import { ref } from 'vue'
import ReviewSession from '../components/ReviewSession.vue'
import { SourcePanel, MixedSession } from './view-components'

export function useStudyViews() {
  const mixedReader = ref<InstanceType<typeof SourcePanel>>()
  const activeSource = ref<InstanceType<typeof SourcePanel>>()
  const mixedController = ref<InstanceType<typeof MixedSession>>()
  const activeReview = ref<InstanceType<typeof ReviewSession>>()
  return { mixedReader, activeSource, mixedController, activeReview }
}
