import { MaterialKnowledgeIndex, type KnowledgeRequest } from './material-search'
const index = new MaterialKnowledgeIndex()
self.onmessage = ({ data }: MessageEvent<{ id: number; request: KnowledgeRequest }>) => {
  try {
    self.postMessage({ id: data.id, value: index.handle(data.request) })
  } catch (error) {
    self.postMessage({ id: data.id, error: error instanceof Error ? error.message : String(error) })
  }
}
