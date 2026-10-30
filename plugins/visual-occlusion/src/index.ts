import { defineComponent, h, type PropType } from 'vue'
import {
  registerCommand,
  registerImporter,
  registerReader,
  type MaterialCommandContext,
  type QuestionPlugin,
} from '@repeaty/plugin-api'
import { inspectImage } from './image'
import ImageReader from './ImageReader.vue'
import FormulaReader from './FormulaReader.vue'
import VisualTool from './VisualTool.vue'
import Question from './Question.vue'
import Answer from './Answer.vue'
import NoteEditor from './NoteEditor.vue'
function tool(kind: 'image' | 'formula') {
  return defineComponent({
    props: {
      context: { type: Object as PropType<MaterialCommandContext>, required: true },
      onClose: { type: Function as PropType<() => void>, required: true },
    },
    setup: (props) => () => h(VisualTool, { ...props, kind }),
  })
}
export default function activate(): QuestionPlugin {
  registerImporter({
    id: 'image',
    title: '图片（PNG / JPEG / WebP / GIF）',
    extensions: ['.png', '.jpg', '.jpeg', '.webp', '.gif'],
    async parse(file, context) {
      await inspectImage(file, context.signal)
      await context.yield()
      return [
        {
          key: 'image',
          title: file.name,
          text: file.name,
          format: 'plain',
          documentFormat: 'image',
          readerId: 'image',
        },
      ]
    },
  })
  registerReader({ id: 'image', title: '图片阅读器', formats: ['image'], component: ImageReader })
  registerReader({
    id: 'formula',
    title: '公式定位',
    formats: ['formula'],
    component: FormulaReader,
  })
  registerCommand({
    id: 'image-occlusion',
    title: '制作图片遮挡题',
    formats: ['image'],
    component: tool('image'),
  })
  registerCommand({
    id: 'formula-occlusion',
    title: '制作公式遮挡题',
    formats: ['markdown'],
    component: tool('formula'),
  })
  return {
    id: 'visual-occlusion',
    kind: 'frontend',
    label: '图像与公式遮挡',
    version: 1,
    description: '图片阅读、区域批注与独立调度的图片/公式遮挡题。',
    showQuestion: Question,
    showAnswer: Answer,
    editor: NoteEditor,
  }
}
