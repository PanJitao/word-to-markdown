// 主界面与交互：Markdown 源码编辑 + 实时预览 + 文件转换
import './style.css'
import { renderMarkdown, buildHtmlDocument } from './lib/markdown'
import { docxToMarkdown, xlsxToMarkdown, markdownToDocxBlob } from './lib/convert'
import {
  pickOpenFile,
  pickSavePath,
  writeTextFile,
  writeBytesFile,
  readTextFile,
  swapExtension,
  getLaunchFile,
  registerMdHandler,
  openDefaultAppsSettings,
  openUrl,
} from './lib/io'

const SAMPLE = `# 欢迎使用 ExchangeMD

一个轻量桌面小工具，可以完成 **Markdown、Word、Excel、HTML** 之间的互相转换。

## 它能做什么

- 左边直接写 Markdown，右边实时看到渲染效果
- 把 Word（.docx）文档转成 Markdown
- 把 Excel（.xlsx）表格转成 Markdown 表格
- 把 Markdown 导出成排版好的 HTML 或 Word

## 怎么用

1. 在左边编辑器里写内容，或点工具栏快速插入格式
2. 右边会立刻显示排版后的样子
3. 想转换文件时，点顶部按钮选择文件即可

> 提示：支持 **Ctrl+B** 加粗、**Ctrl+I** 斜体。
`

const editor = document.querySelector<HTMLTextAreaElement>('#editor')!
const preview = document.querySelector<HTMLElement>('#preview')!
const statusEl = document.querySelector<HTMLElement>('#status')!
const fileLabel = document.querySelector<HTMLElement>('#file-label')!
const wordCountEl = document.querySelector<HTMLElement>('#word-count')!
const toastEl = document.querySelector<HTMLElement>('#toast')!
let toastTimer: ReturnType<typeof setTimeout> | null = null

let markdown = SAMPLE
let currentFile: string | null = null
let busy = false

const STATE_KEY = 'exchangemd:lastState'
let persistTimer: ReturnType<typeof setTimeout> | null = null

/** 防抖保存当前编辑器内容 + 文件路径，下次打开可恢复 */
function schedulePersist() {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify({ markdown: editor.value, currentFile }))
    } catch {
      // 容量超限或隐私模式，忽略
    }
  }, 400)
}

/** 恢复上次会话；没有则用欢迎示例 */
function restoreSession() {
  try {
    const saved = JSON.parse(localStorage.getItem(STATE_KEY) || 'null')
    if (saved && typeof saved.markdown === 'string' && saved.markdown.trim()) {
      setMarkdown(saved.markdown)
      if (saved.currentFile) {
        currentFile = saved.currentFile
        fileLabel.textContent = currentFile
      }
      return true
    }
  } catch {
    // 损坏的状态，忽略
  }
  setMarkdown(SAMPLE)
  return false
}

function setBusy(value: boolean, msg?: string) {
  busy = value
  document.body.classList.toggle('is-busy', value)
  if (msg !== undefined) setStatus(msg)
  else if (value) setStatus('处理中…')
  // 关闭忙碌时不重置状态，避免覆盖刚设置的成功/失败信息
  ;[...document.querySelectorAll<HTMLButtonElement>('[data-convert]')].forEach((b) => (b.disabled = value))
}

function setStatus(msg: string) {
  statusEl.textContent = msg
}

/** 更新字数统计（汉字按字、英文按词综合估算） */
function updateCount() {
  const text = editor.value.trim()
  if (!text) { wordCountEl.textContent = '0 字'; return }
  // 中日韩字符逐个计数，其余按空白分词
  const cjk = (text.match(/[一-鿿぀-ヿ가-힯]/g) || []).length
  const words = (text.replace(/[一-鿿぀-ヿ가-힯]/g, ' ').match(/[A-Za-z0-9]+/g) || []).length
  wordCountEl.textContent = `${cjk + words} 字`
}

/** 短暂浮层提示 */
function showToast(message: string, type: 'success' | 'error' | 'info' = 'info') {
  toastEl.textContent = message
  toastEl.className = `toast show ${type}`
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    toastEl.className = 'toast'
  }, 3200)
}

function setMarkdown(value: string) {
  markdown = value
  editor.value = value
  preview.innerHTML = renderMarkdown(value)
  updateCount()
  schedulePersist()
}

function renderOnly() {
  preview.innerHTML = renderMarkdown(editor.value)
  markdown = editor.value
  updateCount()
  schedulePersist()
}

// ---------- 工具栏：对选区插入 Markdown 标记 ----------

function getSelection() {
  return {
    text: editor.value,
    start: editor.selectionStart ?? 0,
    end: editor.selectionEnd ?? 0,
  }
}

function applyEdit(next: string, start: number, end: number) {
  editor.value = next
  markdown = next
  editor.focus()
  editor.setSelectionRange(start, end)
  renderOnly()
}

function wrapSelection(wrapper: string) {
  const { text, start, end } = getSelection()
  const selected = text.slice(start, end) || '文字'
  const next = text.slice(0, start) + wrapper + selected + wrapper + text.slice(end)
  applyEdit(next, start + wrapper.length, start + wrapper.length + selected.length)
}

function prefixLines(prefix: string) {
  const { text, start, end } = getSelection()
  const lineStart = text.lastIndexOf('\n', start - 1) + 1
  const nl = text.indexOf('\n', end)
  const lineEnd = nl === -1 ? text.length : nl
  const block = text.slice(lineStart, lineEnd)
  const prefixed = block.split('\n').map((l) => prefix + l).join('\n')
  const next = text.slice(0, lineStart) + prefixed + text.slice(lineEnd)
  applyEdit(next, lineStart, lineStart + prefixed.length)
}

function insertBlock(block: string) {
  const { text, start, end } = getSelection()
  const next = text.slice(0, start) + block + text.slice(end)
  applyEdit(next, start + block.length, start + block.length)
}

/** Tab：无选区插入两个空格；有选区则给选中的每一行加两格缩进 */
function indentOrInsert() {
  const { text, start, end } = getSelection()
  if (start === end) {
    insertBlock('  ')
    return
  }
  const lineStart = text.lastIndexOf('\n', start - 1) + 1
  const nl = text.indexOf('\n', end)
  // 选区末尾若停在换行符上，不把下一行算进来
  const lineEnd = nl === -1 ? text.length : (text[end - 1] === '\n' ? end : nl)
  const block = text.slice(lineStart, lineEnd)
  const indented = block.split('\n').map((l) => '  ' + l).join('\n')
  const next = text.slice(0, lineStart) + indented + text.slice(lineEnd)
  applyEdit(next, lineStart, lineStart + indented.length)
}

/** Shift+Tab：去掉选中每一行开头的最多两个空格 */
function outdentSelection() {
  const { text, start, end } = getSelection()
  const lineStart = text.lastIndexOf('\n', start - 1) + 1
  const nl = text.indexOf('\n', end)
  const lineEnd = nl === -1 ? text.length : (text[end - 1] === '\n' ? end : nl)
  const block = text.slice(lineStart, lineEnd)
  const outdented = block.split('\n').map((l) => l.replace(/^ {1,2}/, '')).join('\n')
  const next = text.slice(0, lineStart) + outdented + text.slice(lineEnd)
  applyEdit(next, lineStart, lineStart + outdented.length)
}


function handleToolbar(action: string) {
  switch (action) {
    case 'h1': return prefixLines('# ')
    case 'h2': return prefixLines('## ')
    case 'bold': return wrapSelection('**')
    case 'italic': return wrapSelection('*')
    case 'list': return prefixLines('- ')
    case 'quote': return prefixLines('> ')
    case 'code':
      return insertBlock('\n```text\n\n```\n')
    case 'table':
      return insertBlock('\n| 列名 | 数值 |\n| --- | --- |\n| 示例 | 内容 |\n')
    case 'link': {
      const url = prompt('请输入链接地址', 'https://')
      if (!url) return
      const { text, start, end } = getSelection()
      const label = text.slice(start, end) || '链接文字'
      insertBlock(`[${label}](${url})`)
      return
    }
  }
}

// ---------- 文件操作 ----------

async function openMarkdown() {
  const picked = await pickOpenFile([{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }], 'text')
  if (!picked) return
  currentFile = picked.filePath
  fileLabel.textContent = currentFile
  setMarkdown(picked.text)
  setStatus(`已打开 ${currentFile}`)
  showToast('已打开文件', 'success')
}

async function saveMarkdown() {
  const target = currentFile ?? await pickSavePath('文档.md', [{ name: 'Markdown', extensions: ['md'] }])
  if (!target) return
  try {
    await writeTextFile(target, markdown)
    currentFile = target
    fileLabel.textContent = currentFile
    setStatus(`已保存到 ${target}`)
    showToast('已保存', 'success')
  } catch (err) {
    setStatus(`保存失败：${errMsg(err)}`)
    showToast(`保存失败：${errMsg(err)}`, 'error')
  }
}

async function convertOfficeToMarkdown(kind: 'docx' | 'xlsx') {
  const label = kind === 'docx' ? 'Word' : 'Excel'
  const picked = await pickOpenFile(
    [{ name: label, extensions: [kind] }],
    'bytes',
  )
  if (!picked) return

  setBusy(true, `正在转换 ${label}…`)
  try {
    const md = kind === 'docx'
      ? await docxToMarkdown(picked.buffer)
      : xlsxToMarkdown(picked.buffer)

    const target = await pickSavePath(swapExtension(picked.filePath, '.md'), [{ name: 'Markdown', extensions: ['md'] }])
    if (!target) return
    await writeTextFile(target, md)
    currentFile = target
    fileLabel.textContent = target
    setMarkdown(md)
    setStatus(`已把 ${label} 文件转换成 Markdown`)
    showToast(`已把 ${label} 转成 Markdown`, 'success')
  } catch (err) {
    setStatus(`转换失败：${errMsg(err)}`)
    showToast(`转换失败：${errMsg(err)}`, 'error')
  } finally {
    setBusy(false)
  }
}

async function exportHtml() {
  // 先选要导出的 .md 文件，再选输出位置
  const picked = await pickOpenFile(
    [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }],
    'text',
  )
  if (!picked) return
  const target = await pickSavePath(swapExtension(picked.filePath, '.html'), [
    { name: 'HTML', extensions: ['html'] },
  ])
  if (!target) return
  setBusy(true, '正在导出 HTML…')
  try {
    const html = buildHtmlDocument(picked.text, 'ExchangeMD 导出文档')
    await writeTextFile(target, html)
    setMarkdown(picked.text)
    currentFile = picked.filePath
    fileLabel.textContent = picked.filePath
    setStatus(`已导出 HTML 到 ${target}`)
    showToast('已导出 HTML', 'success')
  } catch (err) {
    setStatus(`导出失败：${errMsg(err)}`)
    showToast(`导出失败：${errMsg(err)}`, 'error')
  } finally {
    setBusy(false)
  }
}

async function exportDocx() {
  // 先选要导出的 .md 文件，再选输出位置
  const picked = await pickOpenFile(
    [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }],
    'text',
  )
  if (!picked) return
  const target = await pickSavePath(swapExtension(picked.filePath, '.docx'), [
    { name: 'Word', extensions: ['docx'] },
  ])
  if (!target) return
  setBusy(true, '正在导出 Word…')
  try {
    const blob = await markdownToDocxBlob(picked.text)
    const bytes = new Uint8Array(await blob.arrayBuffer())
    await writeBytesFile(target, bytes)
    setMarkdown(picked.text)
    currentFile = picked.filePath
    fileLabel.textContent = picked.filePath
    setStatus(`已导出 Word 到 ${target}`)
    showToast('已导出 Word', 'success')
  } catch (err) {
    setStatus(`导出失败：${errMsg(err)}`)
    showToast(`导出失败：${errMsg(err)}`, 'error')
  } finally {
    setBusy(false)
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

// ---------- 绑定事件 ----------

document.querySelectorAll<HTMLButtonElement>('[data-action]').forEach((btn) => {
  btn.addEventListener('click', () => handleToolbar(btn.dataset.action!))
})

document.querySelectorAll<HTMLButtonElement>('[data-file]').forEach((btn) => {
  const type = btn.dataset.file!
  btn.addEventListener('click', () => {
    if (type === 'open-md') return openMarkdown()
    if (type === 'save-md') return saveMarkdown()
    if (type === 'docx-to-md') return convertOfficeToMarkdown('docx')
    if (type === 'xlsx-to-md') return convertOfficeToMarkdown('xlsx')
    if (type === 'md-to-docx') return exportDocx()
    if (type === 'export-html') return exportHtml()
  })
})

editor.addEventListener('input', renderOnly)

// ---------- 外部链接：拦截点击，用系统浏览器打开，绝不接管当前窗口 ----------

const EXTERNAL_HREF = /^(https?:|mailto:|tel:|ftp:|file:)/i

function handleExternalLink(e: Event, anchor: HTMLAnchorElement) {
  const href = anchor.getAttribute('href') || ''
  if (!EXTERNAL_HREF.test(href)) return false
  e.preventDefault()
  e.stopPropagation()
  openUrl(href)
    .then(() => showToast('已在浏览器打开链接', 'info'))
    .catch((err) => showToast(`无法打开链接：${errMsg(err)}`, 'error'))
  return true
}

// 捕获阶段：左键点击
document.addEventListener('click', (e) => {
  const anchor = (e.target as HTMLElement | null)?.closest?.('a')
  if (anchor) handleExternalLink(e, anchor)
}, true)
// 中键点击（新标签意图）
document.addEventListener('auxclick', (e) => {
  if ((e as MouseEvent).button !== 1) return
  const anchor = (e.target as HTMLElement | null)?.closest?.('a')
  if (anchor) handleExternalLink(e, anchor)
}, true)

editor.addEventListener('keydown', (e) => {
  // Tab 不带 Ctrl/Meta，必须单独、优先处理，否则会被默认行为（跳走焦点）吃掉
  if (e.key === 'Tab') {
    e.preventDefault()
    if (e.shiftKey) outdentSelection()
    else indentOrInsert()
    return
  }
  if (!(e.ctrlKey || e.metaKey)) return
  const key = e.key.toLowerCase()
  if (key === 'b') { e.preventDefault(); wrapSelection('**') }
  else if (key === 'i') { e.preventDefault(); wrapSelection('*') }
})

// ---------- 设置菜单：文件关联 / 设为默认 ----------

const settingsBtn = document.querySelector<HTMLElement>('#settings-btn')!
const settingsMenu = document.querySelector<HTMLElement>('#settings-menu')!

function isMenuOpen() {
  return settingsMenu.classList.contains('open')
}
function toggleSettingsMenu(open: boolean) {
  settingsMenu.classList.toggle('open', open)
  settingsBtn.setAttribute('aria-expanded', String(open))
}

settingsBtn.addEventListener('click', (e) => {
  e.stopPropagation()
  toggleSettingsMenu(!isMenuOpen())
})
// 点击菜单外部收起
document.addEventListener('click', () => toggleSettingsMenu(false))
// ESC 收起
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && isMenuOpen()) {
    toggleSettingsMenu(false)
    settingsBtn.focus()
  }
})

document.querySelectorAll<HTMLButtonElement>('[data-setting]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    toggleSettingsMenu(false)
    const action = btn.dataset.setting
    setBusy(true)
    try {
      if (action === 'open-with') {
        await registerMdHandler()
        showToast('已加入右键「打开方式」', 'success')
        setStatus('已注册到 .md 打开方式列表')
      } else if (action === 'default-app') {
        await registerMdHandler()
        await openDefaultAppsSettings()
        showToast('已打开系统设置，请在 .md 中选择 ExchangeMD', 'info')
        setStatus('请在系统「默认应用」里把 .md 设为 ExchangeMD')
      }
    } catch (err) {
      showToast(`操作失败：${errMsg(err)}`, 'error')
      setStatus(`操作失败：${errMsg(err)}`)
    } finally {
      setBusy(false)
    }
  })
})

// ---------- 复制按钮 ----------

document.querySelector<HTMLElement>('#copy-btn')!.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(editor.value)
    showToast('已复制 Markdown 源码', 'success')
  } catch (err) {
    showToast(`复制失败：${errMsg(err)}`, 'error')
  }
})

// ---------- 可拖拽分栏（编辑器 / 预览宽度） ----------

const splitter = document.querySelector<HTMLElement>('#splitter')!
const workspace = document.querySelector<HTMLElement>('#workspace')!
const SPLIT_KEY = 'exchangemd:split'

function applySplit(pct: number): number {
  const clamped = Math.min(80, Math.max(20, pct))
  workspace.style.setProperty('--split', `${clamped}%`)
  return clamped
}

const savedSplit = parseFloat(localStorage.getItem(SPLIT_KEY) || '')
if (!isNaN(savedSplit)) applySplit(savedSplit)

function startDrag(clientX: number) {
  splitter.classList.add('dragging')
  document.body.style.cursor = 'col-resize'
  const rect = workspace.getBoundingClientRect()
  const onMove = (ev: MouseEvent) => applySplit(((ev.clientX - rect.left) / rect.width) * 100)
  const onUp = () => {
    splitter.classList.remove('dragging')
    document.body.style.cursor = ''
    localStorage.setItem(SPLIT_KEY, workspace.style.getPropertyValue('--split') || '54%')
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
  }
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}

splitter.addEventListener('mousedown', (e) => {
  e.preventDefault()
  startDrag(e.clientX)
})
// 键盘可达：左右方向键微调（可访问性）
splitter.addEventListener('keydown', (e) => {
  const cur = parseFloat(workspace.style.getPropertyValue('--split')) || 54
  if (e.key === 'ArrowLeft') { e.preventDefault(); localStorage.setItem(SPLIT_KEY, applySplit(cur - 2) + '%') }
  else if (e.key === 'ArrowRight') { e.preventDefault(); localStorage.setItem(SPLIT_KEY, applySplit(cur + 2) + '%') }
})

// ---------- 启动初始化 ----------

async function init() {
  try {
    const launchFile = await getLaunchFile()
    if (launchFile) {
      const text = await readTextFile(launchFile)
      currentFile = launchFile
      fileLabel.textContent = currentFile
      setMarkdown(text)
      setStatus(`已打开 ${currentFile}`)
      return
    }
  } catch (err) {
    setStatus(`打开传入文件失败：${errMsg(err)}`)
  }
  restoreSession()
  setStatus('就绪')
}

init()
