// 文档格式互转：全部在浏览器里完成，不依赖任何后端
import TurndownService from 'turndown'
import * as turndownPluginGfm from 'turndown-plugin-gfm'
import mammoth from 'mammoth/mammoth.browser.js'
import * as XLSX from 'xlsx'
import MarkdownIt from 'markdown-it'
import {
  Document,
  Packer,
  Paragraph,
  HeadingLevel,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  ExternalHyperlink,
  BorderStyle,
  AlignmentType,
} from 'docx'

// 行内格式解析器（用于 md→docx，正确处理链接 / 嵌套加粗斜体 / 代码）
const inlineMd = new MarkdownIt()

const turndown = new TurndownService({
  headingStyle: 'atx',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
})
// 启用 GFM 的删除线、任务列表等规则（表格规则下面会被自定义的更强版本覆盖）
turndown.use(turndownPluginGfm.gfm)
// 自定义表格规则：处理合并单元格 + 多段单元格，转成规整的 GFM 表格
turndown.addRule('table', {
  filter: 'table',
  replacement: (_content, node) => {
    const el = node as HTMLElement
    if (typeof (el as any).querySelectorAll !== 'function') return ''
    const md = tableNodeToMarkdown(el)
    return md ? `\n\n${md}\n\n` : ''
  },
})

/** Word(.docx) → Markdown：先把 docx 转成 HTML，再转成 Markdown */
export async function docxToMarkdown(arrayBuffer: ArrayBuffer): Promise<string> {
  const result = await mammoth.convertToHtml({ arrayBuffer })
  return turndown.turndown(result.value).trim()
}

// ---------- 表格解析（处理合并单元格 / 多段单元格）----------

/** 把一个 <table> 节点转成 GFM Markdown 表格 */
function tableNodeToMarkdown(table: HTMLElement): string {
  const rows = Array.from(table.querySelectorAll('tr'))
  if (!rows.length) return ''

  // 展开成二维网格：处理 colspan / rowspan
  const grid: (string | null)[][] = []
  rows.forEach((tr, r) => {
    if (!grid[r]) grid[r] = []
    const cells = Array.from(tr.querySelectorAll('td, th'))
    let c = 0
    for (const cell of cells) {
      while (grid[r][c] !== undefined && grid[r][c] !== null) c++ // 跳过被 rowspan 占用的列
      const text = cellToText(cell)
      const colspan = Math.max(1, parseInt(cell.getAttribute('colspan') || '1', 10))
      const rowspan = Math.max(1, parseInt(cell.getAttribute('rowspan') || '1', 10))
      // 合并的单元格：文本放首个位置，其余位置留 null（渲染成空），不丢列
      grid[r][c] = text
      for (let i = 1; i < colspan; i++) grid[r][c + i] = null
      for (let j = 1; j < rowspan; j++) {
        if (!grid[r + j]) grid[r + j] = []
        for (let i = 0; i < colspan; i++) grid[r + j][c + i] = null
      }
      c += colspan
    }
  })

  const columnCount = grid.reduce((m, row) => Math.max(m, row.length), 0)
  if (!columnCount) return ''

  // 补齐每行列数，null -> 空字符串
  const filled = grid.map((row) => {
    const out: string[] = []
    for (let i = 0; i < columnCount; i++) out.push(row[i] ?? '')
    return out
  })

  const header = filled[0]
  const body = filled.slice(1)
  const separator = Array(columnCount).fill('---')
  const fmt = (cells: string[]) => `| ${cells.map(escapeCell).join(' | ')} |`

  const lines = [fmt(header), fmt(separator)]
  // 至少保证有表体；只有一行表头时也补一行空表体，避免部分渲染器不显示
  if (body.length) lines.push(...body.map(fmt))
  else lines.push(fmt(Array(columnCount).fill('')))
  return lines.join('\n')
}

/** 把单元格里的多段/换行压成单行文本（用 innerHTML + 正则，避免依赖 NodeList.forEach） */
function cellToText(cell: Element): string {
  const html: string = (cell as HTMLElement).innerHTML || (cell.textContent || '')
  return htmlCellToText(html)
}

function htmlCellToText(html: string): string {
  // 块级结束标签 / 换行标签先换成空格，避免相邻段落粘连
  const spaced = html.replace(/<(?:br\s*\/?|\/p|\/div|\/li|\/h[1-6])>/gi, ' ')
  const stripped = spaced.replace(/<[^>]+>/g, '')
  const unescaped = stripped
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
  return unescaped.replace(/\s+/g, ' ').trim()
}

function escapeCell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n/g, ' ').trim()
}


/** Excel(.xlsx) → Markdown：每个工作表转成一个 Markdown 表格 */
export function xlsxToMarkdown(arrayBuffer: ArrayBuffer): string {
  const workbook = XLSX.read(arrayBuffer, { type: 'array' })
  const lines: string[] = ['# Excel 表格', '']

  workbook.SheetNames.forEach((name: string) => {
    lines.push(`## ${name}`)
    const sheet = workbook.Sheets[name]
    const rows = XLSX.utils.sheet_to_json<any[]>(sheet, {
      header: 1,
      raw: false,
      defval: '',
    })

    if (!rows.length) {
      lines.push('', '_空工作表_', '')
      return
    }

    const normalized = rows.filter((row) => Array.isArray(row) && row.some((c) => String(c).trim() !== ''))
    if (!normalized.length) {
      lines.push('', '_空工作表_', '')
      return
    }

    lines.push(...rowsToMarkdownTable(normalized), '')
  })

  return lines.join('\n').trim()
}

/** Markdown → Word(.docx)：逐行解析，用 docx 库构建真实 .docx */
export async function markdownToDocxBlob(markdown: string): Promise<Blob> {
  const children: any[] = []
  const lines = markdown.split(/\r?\n/)
  let i = 0

  while (i < lines.length) {
    const line = lines[i].replace(/\s+$/g, '')
    const stripped = line.trim()

    if (!stripped) {
      i += 1
      continue
    }

    // 标题：# / ## / ###
    const headingMatch = stripped.match(/^(#{1,6})\s+(.*)$/)
    if (headingMatch) {
      const level = Math.min(headingMatch[1].length, 6)
      children.push(
        new Paragraph({
          children: parseInlineRuns(headingMatch[2]),
          heading: headingLevel(level),
        }),
      )
      i += 1
      continue
    }

    // 代码块：``` 开始
    const fenceMatch = stripped.match(/^```(.*)$/)
    if (fenceMatch) {
      const codeLines: string[] = []
      i += 1
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i])
        i += 1
      }
      if (i < lines.length) i += 1 // 跳过结束的 ```
      children.push(buildCodeBlock(codeLines))
      continue
    }

    // 水平分隔线：--- / *** / ___
    if (/^(?:-|\*|_){3,}$/.test(stripped)) {
      children.push(new Paragraph({
        border: { bottom: { color: '999999', space: 1, style: BorderStyle.SINGLE, size: 6 } },
        spacing: { before: 80, after: 80 },
      }))
      i += 1
      continue
    }

    // 引用：>
    if (stripped.startsWith('> ')) {
      children.push(
        new Paragraph({
          children: parseInlineRuns(stripped.slice(2)),
          indent: { left: 360 },
        }),
      )
      i += 1
      continue
    }

    // 无序列表：- / *
    if (/^[-*]\s+/.test(stripped)) {
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        const text = lines[i].replace(/^\s*[-*]\s+/, '')
        children.push(
          new Paragraph({
            children: parseInlineRuns(text),
            bullet: { level: 0 },
          }),
        )
        i += 1
      }
      continue
    }

    // 有序列表：1. / 2.
    if (/^\d+[.)]\s+/.test(stripped)) {
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        const text = lines[i].replace(/^\s*\d+[.)]\s+/, '')
        children.push(
          new Paragraph({
            children: parseInlineRuns(text),
            numbering: { reference: 'ordered-list', level: 0 },
          }),
        )
        i += 1
      }
      continue
    }

    // 表格：| ... |
    if (isMarkdownTableHeader(lines, i)) {
      const tableLines: string[] = []
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        tableLines.push(lines[i].trim())
        i += 1
      }
      children.push(buildDocxTable(tableLines))
      continue
    }

    // 普通段落
    children.push(new Paragraph({ children: parseInlineRuns(stripped) }))
    i += 1
  }

  const doc = new Document({
    numbering: {
      config: [
        {
          reference: 'ordered-list',
          levels: [
            { level: 0, format: 'decimal', text: '%1.', alignment: AlignmentType.START },
          ],
        },
      ],
    },
    sections: [{ children }],
  })

  return Packer.toBlob(doc)
}

/** 构建等宽字体 + 灰底的代码块段落 */
function buildCodeBlock(codeLines: string[]): Paragraph {
  const runs: TextRun[] = []
  codeLines.forEach((cl, idx) => {
    if (idx > 0) runs.push(new TextRun({ text: cl, font: 'Consolas', break: 1 }))
    else runs.push(new TextRun({ text: cl, font: 'Consolas' }))
  })
  return new Paragraph({
    children: runs.length ? runs : [new TextRun({ text: '', font: 'Consolas' })],
    shading: { fill: 'F4F4F4' },
    spacing: { before: 80, after: 80 },
  })
}

// ---------- 内部辅助函数 ----------

function rowsToMarkdownTable(rows: any[][]): string[] {
  const columnCount = Math.max(...rows.map((r) => r.length))
  const padded = rows.map((r) => {
    const copy = r.slice(0, columnCount)
    while (copy.length < columnCount) copy.push('')
    return copy.map((c) => String(c ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ').trim())
  })

  const header = padded[0]
  const body = padded.slice(1)
  const separator = Array(columnCount).fill('---')

  const formatRow = (cells: string[]) => `| ${cells.join(' | ')} |`
  return [formatRow(header), formatRow(separator), ...body.map(formatRow)]
}

function isMarkdownTableHeader(lines: string[], index: number): boolean {
  if (index + 1 >= lines.length) return false
  const current = lines[index].trim()
  const separator = lines[index + 1].trim()
  return current.startsWith('|') && separator.startsWith('|') && separator.includes('---')
}

function parseMarkdownRow(line: string): string[] {
  // 去掉首尾可选的 |
  const s = line.trim().replace(/^\s*\|/, '').replace(/\|\s*$/, '')
  // 按未转义的 | 切分；同时把 \| 反转义回 |（与 Word/Excel→MD 的转义对应）
  const cells: string[] = []
  let cur = ''
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === '\\' && s[i + 1] === '|') {
      cur += '|'
      i += 1
    } else if (ch === '|') {
      cells.push(cur.trim())
      cur = ''
    } else {
      cur += ch
    }
  }
  cells.push(cur.trim())
  return cells
}

function buildDocxTable(tableLines: string[]): Table {
  const rows = tableLines.map(parseMarkdownRow).filter((_, idx) => idx !== 1) // 丢掉分隔行
  const header = rows[0] ?? []
  const bodyRows = rows.slice(1)

  const tableRows: TableRow[] = []
  if (header.length) {
    tableRows.push(
      new TableRow({
        tableHeader: true,
        children: header.map(
          (cell) =>
            new TableCell({
              children: [new Paragraph({ children: parseInlineRuns(cell) })],
              shading: { fill: 'F5F2EE' },
            }),
        ),
      }),
    )
  }

  bodyRows.forEach((row) => {
    const cells = header.length
      ? Array.from({ length: header.length }, (_, idx) => row[idx] ?? '')
      : row
    tableRows.push(
      new TableRow({
        children: cells.map(
          (cell) => new TableCell({ children: [new Paragraph({ children: parseInlineRuns(cell) })] }),
        ),
      }),
    )
  })

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: tableRows,
  })
}

// 行内解析：用 markdown-it 的 token 流，正确处理链接 / 嵌套加粗斜体 / 代码 / 删除线
function parseInlineRuns(text: string): (TextRun | ExternalHyperlink)[] {
  const tokens = inlineMd.parseInline(text, {})
  const children = tokens[0]?.children
  if (!children || !children.length) return [new TextRun(text)]
  const runs: (TextRun | ExternalHyperlink)[] = []
  inlineTokensToRuns(children, {}, runs)
  return runs.length ? runs : [new TextRun(text)]
}

/** 递归把 markdown-it 行内 token 转成 docx TextRun / 超链接 */
function inlineTokensToRuns(tokens: any[], style: Record<string, any>, runs: (TextRun | ExternalHyperlink)[]): void {
  let i = 0
  while (i < tokens.length) {
    const t = tokens[i]
    switch (t.type) {
      case 'text':
      case 'text_special':
        runs.push(new TextRun({ text: t.content, ...style }))
        break
      case 'code_inline':
        runs.push(new TextRun({ text: t.content, font: 'Consolas', ...style }))
        break
      case 'softbreak':
      case 'hardbreak':
        runs.push(new TextRun({ text: '', break: 1, ...style }))
        break
      case 'image': {
        const alt = t.content || ''
        runs.push(new TextRun({ text: alt ? `[图片：${alt}]` : '[图片]', italics: true, color: '888888', ...style }))
        break
      }
      case 'strong_open':
      case 'em_open':
      case 's_open': {
        const next = { ...style }
        if (t.type === 'strong_open') next.bold = true
        else if (t.type === 'em_open') next.italics = true
        else next.strike = true
        const closeType = t.type.replace('_open', '_close')
        const inner = sliceUntilClose(tokens, i, t.type, closeType)
        inlineTokensToRuns(inner, next, runs)
        i += inner.length + 2 // 跳过内部 token + open/close
        continue
      }
      case 'link_open': {
        const href = (t.attrGet && t.attrGet('href')) || ''
        const inner = sliceUntilClose(tokens, i, 'link_open', 'link_close')
        const subRuns: (TextRun | ExternalHyperlink)[] = []
        inlineTokensToRuns(inner, { ...style, color: '1155CC' }, subRuns)
        runs.push(new ExternalHyperlink({ link: href, children: subRuns }))
        i += inner.length + 2
        continue
      }
      default:
        if (t.content) runs.push(new TextRun({ text: t.content, ...style }))
    }
    i += 1
  }
}

/** 取出 open/close 之间的 token（含嵌套），返回内部 token 数组 */
function sliceUntilClose(tokens: any[], openIdx: number, openType: string, closeType: string): any[] {
  const inner: any[] = []
  let depth = 1
  let j = openIdx + 1
  while (j < tokens.length && depth > 0) {
    const tj = tokens[j]
    if (tj.type === openType) depth++
    else if (tj.type === closeType) {
      depth--
      if (depth === 0) break
    }
    inner.push(tj)
    j++
  }
  return inner
}

function headingLevel(level: number): (typeof HeadingLevel)[keyof typeof HeadingLevel] {
  const map = [
    HeadingLevel.HEADING_1,
    HeadingLevel.HEADING_2,
    HeadingLevel.HEADING_3,
    HeadingLevel.HEADING_4,
    HeadingLevel.HEADING_5,
    HeadingLevel.HEADING_6,
  ]
  return map[level - 1] ?? HeadingLevel.HEADING_6
}
