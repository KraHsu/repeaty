export const captureMessages = {
  '在其他应用中收集文字、图片或文件，保存到当前学习库的收件箱。':
    'Collect text, images, or files from other apps into the current library’s inbox.',
  全局快捷键: 'Global shortcut',
  快捷键组合: 'Shortcut combination',
  '例如 CommandOrControl+Shift+Space。占用冲突时会显示错误。':
    'For example, CommandOrControl+Shift+Space. Conflicting shortcuts will show an error.',
  收集内容: 'Capture content',
  当前应用选中的文字: 'Selected text in the current app',
  '剪贴板文字、图片或文件': 'Clipboard text, images, or files',
  '请在系统设置的辅助功能中允许 Repeaty 读取选区；也可以使用剪贴板模式。':
    'Allow Repeaty to read selected text in your system’s Accessibility settings, or use clipboard mode.',
  '当前平台使用剪贴板模式。先复制，再按快捷键；原剪贴板内容保持不变。':
    'This platform uses clipboard mode. Copy first, then press the shortcut; the clipboard stays unchanged.',
  '当前平台不支持全局快捷键。请在学习材料中使用“收集材料”。':
    'Global shortcuts are unavailable on this platform. Use Collect material in Study materials.',
  '请先打开学习库，收集的内容才会保存到该库的收件箱。':
    'Open a library first to save captures to its inbox.',
  保存快捷键: 'Save shortcut',
  快捷键已启用: 'Shortcut enabled',
  快捷键未启用: 'Shortcut disabled',
  上次收集: 'Last capture',
  '内容尚未保存，仍保留在当前窗口中。关闭窗口前请重试或放弃。':
    'This capture is still unsaved in the current window. Retry or discard it before closing.',
  重试保存: 'Retry saving',
  放弃本次收集: 'Discard capture',
  '无法收集：{error}': 'Could not capture: {error}',
  '收集未保存：{error} 可在设置中重试。':
    'Capture was not saved: {error} You can retry in Settings.',
  '无法启用收集监听，请重新打开 Repeaty。': 'Could not start the capture listener. Reopen Repeaty.',
  '快捷收集暂时不可用，请重试。': 'Quick capture is temporarily unavailable. Please try again.',
  '快捷键格式无效，请使用包含修饰键的组合。':
    'Invalid shortcut. Use a combination that includes a modifier key.',
  '此快捷键无法注册，可能已被其他应用占用。请换一个组合。':
    'This shortcut could not be registered. Another app may be using it; choose a different combination.',
  '无法读写快捷收集设置，请检查设备存储权限后重试。':
    'Could not read or save quick capture settings. Check device storage permissions and retry.',
  '快捷收集设置无效，请重新设置并保存。':
    'Quick capture settings are invalid. Configure and save them again.',
  '收集的文件过多，请分批收集。': 'Too many files to capture. Collect them in smaller batches.',
  '收集内容超过大小限制，请减少内容后重试。':
    'The capture exceeds the size limit. Reduce its size and retry.',
  '剪贴板图片过大，请缩小图片后重试。': 'The clipboard image is too large. Resize it and retry.',
  '上一次快捷收集仍在等待保存，请先处理后再收集。':
    'The previous quick capture is still waiting to be saved. Resolve it before capturing again.',
  '这次收集已过期，请重新选取或复制内容后再收集。':
    'This capture has expired. Select or copy the content and capture it again.',
  '无法访问系统剪贴板，请稍后重试或直接粘贴文字。':
    'Cannot access the system clipboard. Retry later or paste text directly.',
  '无法读取剪贴板内容，请重新复制后再试。':
    'Could not read the clipboard. Copy the content again and retry.',
  '剪贴板中没有可收集的内容，请先复制文字、图片或文件。':
    'The clipboard has no content to capture. Copy text, an image, or files first.',
  '无法读取这张剪贴板图片，请重新复制或选择图片文件。':
    'Could not read this clipboard image. Copy it again or choose the image file.',
  '当前平台不支持读取选区，请使用剪贴板模式。':
    'Reading selected text is unavailable on this platform. Use clipboard mode.',
  '无法读取当前应用的选区，请复制文字后使用剪贴板模式。':
    'Could not read the current app’s selection. Copy the text and use clipboard mode.',
  '当前应用没有选中文字，请先选择文字或使用剪贴板模式。':
    'No text is selected in the current app. Select text first or use clipboard mode.',
  '受保护的内容不能读取，请选择其他内容。':
    'Protected content cannot be read. Select other content.',
  '剪贴板中的文件路径不受支持。': 'A clipboard file path is not supported.',
} as const

export const captureErrorKeys: Record<string, keyof typeof captureMessages> = {
  'capture-shortcut-invalid': '快捷键格式无效，请使用包含修饰键的组合。',
  'capture-shortcut-unavailable': '此快捷键无法注册，可能已被其他应用占用。请换一个组合。',
  'capture-shortcut-unsupported': '当前平台不支持全局快捷键。请在学习材料中使用“收集材料”。',
  'capture-config-unavailable': '无法读写快捷收集设置，请检查设备存储权限后重试。',
  'capture-config-invalid': '快捷收集设置无效，请重新设置并保存。',
  'capture-unavailable': '快捷收集暂时不可用，请重试。',
  'capture-file-limit': '收集的文件过多，请分批收集。',
  'capture-size-limit': '收集内容超过大小限制，请减少内容后重试。',
  'capture-image-limit': '剪贴板图片过大，请缩小图片后重试。',
  'capture-awaiting-save': '上一次快捷收集仍在等待保存，请先处理后再收集。',
  'capture-expired': '这次收集已过期，请重新选取或复制内容后再收集。',
  'clipboard-unavailable': '无法访问系统剪贴板，请稍后重试或直接粘贴文字。',
  'clipboard-read-failed': '无法读取剪贴板内容，请重新复制后再试。',
  'clipboard-empty': '剪贴板中没有可收集的内容，请先复制文字、图片或文件。',
  'clipboard-image-invalid': '无法读取这张剪贴板图片，请重新复制或选择图片文件。',
  'selection-unsupported': '当前平台不支持读取选区，请使用剪贴板模式。',
  'selection-unavailable': '无法读取当前应用的选区，请复制文字后使用剪贴板模式。',
  'selection-empty': '当前应用没有选中文字，请先选择文字或使用剪贴板模式。',
  'selection-protected': '受保护的内容不能读取，请选择其他内容。',
  'accessibility-required': '请在系统设置的辅助功能中允许 Repeaty 读取选区；也可以使用剪贴板模式。',
}
