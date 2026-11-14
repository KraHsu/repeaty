export const desktopExperienceMessages = {
  桌面: 'Desktop',
  启动与后台: 'Startup and background',
  '这些设置仅保存在当前设备。': 'These settings stay on this device.',
  '桌面设置读取失败，已使用安全默认值；保存新设置前不会覆盖原文件。':
    'Desktop settings could not be read. Safe defaults are in use; the original file will remain until you save new settings.',
  '登录系统时启动 Repeaty': 'Start Repeaty at login',
  '系统仍可能禁用登录项，请在系统启动设置中核对。':
    'The system may still disable this login item. Check your system startup settings.',
  '请在安装后的桌面版中设置登录启动。': 'Configure startup in an installed desktop build.',
  '无法读取登录启动状态，请检查系统权限。':
    'Could not read startup registration. Check system permissions.',
  登录启动时隐藏窗口: 'Hide the window when started at login',
  '仅系统登录启动时隐藏到托盘；手动打开仍显示窗口。':
    'Only login startup hides to the tray. Opening the app manually still shows its window.',
  关闭窗口后留在后台: 'Keep running after closing the window',
  '保存完成后隐藏到托盘。使用托盘菜单退出 Repeaty。':
    'Hide to the tray after saving. Use the tray menu to quit Repeaty.',
  '系统托盘不可用，窗口将继续正常显示和关闭。':
    'The system tray is unavailable. The window will continue to open and close normally.',
  应用更新: 'Application updates',
  '更新包通过签名与版本校验后，才可以保存并安装。':
    'Updates must pass signature and version checks before saving and installing.',
  '当前构建未配置签名更新渠道。可以检查稳定版本，并从官方发布页下载安装。':
    'This build has no signed update channel. Check stable releases and download installers from the official release page.',
  '正在检查…': 'Checking…',
  检查更新: 'Check for updates',
  官方发布页: 'Official releases',
  '当前渠道没有可用更新。': 'No update is available from this channel.',
  发现新版本: 'New version available',
  当前版本已是最新或更新: 'This version is up to date or newer',
  版本说明: 'Release notes',
  下载并验证更新: 'Download and verify update',
  保存并安装更新: 'Save and install update',
  取消下载: 'Cancel download',
  查看并下载此版本: 'View and download this version',
  诊断与反馈: 'Diagnostics and feedback',
  '报告仅包含版本、平台和运行能力，不包含学习正文、目录路径、凭据或个人标识。先预览，再决定是否分享。':
    'Reports include only the version, platform and runtime capabilities, with no study content, directory paths, credentials or personal identifiers. Preview before sharing.',
  预览诊断信息: 'Preview diagnostics',
  反馈问题: 'Report a problem',
  诊断信息: 'Diagnostics',
  导出诊断信息: 'Export diagnostics',
  '诊断信息已复制。': 'Diagnostics copied.',
  '诊断信息已导出。': 'Diagnostics exported.',
  '桌面设置未能保存，请重试。': 'Could not save desktop settings. Try again.',
  '登录启动设置失败，请检查系统权限后重试。':
    'Could not configure startup. Check system permissions and try again.',
  '无法检查更新，请检查网络后重试。':
    'Could not check for updates. Check your connection and try again.',
  '更新信息无效，当前版本保持不变。':
    'Update information is invalid. The current version is unchanged.',
  '签名更新渠道尚未发布，请从官方发布页下载。':
    'The signed update channel is not published yet. Download from the official release page.',
  '当前构建无法使用签名更新，请从官方发布页下载。':
    'Signed updates are unavailable in this build. Download from the official release page.',
  '更新任务正在进行，请稍后重试。': 'An update task is running. Try again shortly.',
  '请先检查更新。': 'Check for updates first.',
  '请先下载并验证更新。': 'Download and verify the update first.',
  '更新下载或签名校验失败，当前版本保持不变。':
    'Download or signature verification failed. The current version is unchanged.',
  '更新包超过大小上限，已停止下载。': 'The update exceeds the size limit. Download stopped.',
  '更新下载已取消，当前版本保持不变。': 'Download canceled. The current version is unchanged.',
  '未完成保存，已取消安装更新。': 'Saving was not completed. Update installation canceled.',
  '更新未能安装，当前窗口与学习库保持打开。':
    'The update could not be installed. This window and library remain open.',
  '无法复制诊断信息，可以改为导出文件。':
    'Could not copy diagnostics. You can export a file instead.',
  '桌面操作未完成，请重试。': 'The desktop operation could not be completed. Try again.',
} as const
