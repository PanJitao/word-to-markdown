// 文件读写：用 Tauri 的对话框选文件，再调用 Rust 命令读写
import { invoke } from '@tauri-apps/api/core'
import { open, save } from '@tauri-apps/plugin-dialog'

export type FileFilter = { name: string; extensions: string[] }

/** 让用户选一个文件；可选拿到文本内容或二进制（用于 docx/xlsx） */
export async function pickOpenFile(filters: FileFilter[], mode: 'text' | 'bytes') {
  const path = await open({ filters, multiple: false, directory: false })
  if (!path) return null
  const filePath = typeof path === 'string' ? path : path[0]
  if (mode === 'text') {
    const text = await invoke<string>('read_text_file', { path: filePath })
    return { filePath, text }
  }
  const bytes = await invoke<number[]>('read_file_bytes', { path: filePath })
  const buffer = new Uint8Array(bytes).buffer
  return { filePath, buffer }
}

/** 让用户选一个保存位置，返回完整路径或 null */
export async function pickSavePath(defaultName: string, filters: FileFilter[]): Promise<string | null> {
  return await save({ defaultPath: defaultName, filters })
}

/** 把文本写入指定路径 */
export async function writeTextFile(path: string, content: string): Promise<void> {
  await invoke('write_text_file', { path, content })
}

/** 按路径读取文本（用于启动时打开传入的文件） */
export function readTextFile(path: string): Promise<string> {
  return invoke<string>('read_text_file', { path })
}

/** 把二进制写入指定路径（用于导出 docx） */
export async function writeBytesFile(path: string, bytes: Uint8Array): Promise<void> {
  await invoke('write_file_bytes', { path, bytes: Array.from(bytes) })
}

/** 取文件所在目录，用于 docx 图片资源等 */
export function parentDir(filePath: string): string {
  const slash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
  return slash >= 0 ? filePath.slice(0, slash) : filePath
}

/** 替换扩展名 */
export function swapExtension(filePath: string, ext: string): string {
  return filePath.replace(/\.[^./\\]+$/, '') + ext
}

// ---------- 系统集成：文件关联 / 启动参数 ----------

/** 启动时 Windows 传入的文件路径（双击 / 右键打开时） */
export function getLaunchFile(): Promise<string | null> {
  return invoke<string | null>('get_launch_file')
}

/** 注册到 .md 的「打开方式」列表（HKCU，无需管理员） */
export function registerMdHandler(): Promise<string> {
  return invoke<string>('register_md_handler')
}

/** 打开系统「默认应用」设置页 */
export function openDefaultAppsSettings(): Promise<void> {
  return invoke<void>('open_default_apps_settings')
}

/** 用系统默认浏览器打开外部链接（不在应用窗口内跳转） */
export function openUrl(url: string): Promise<void> {
  return invoke<void>('open_url', { url })
}
