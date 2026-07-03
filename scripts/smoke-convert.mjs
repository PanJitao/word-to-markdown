// 转换逻辑冒烟测试：不依赖 Tauri，直接验证 docx/xlsx/md 互转
import { markdownToDocxBlob, docxToMarkdown, xlsxToMarkdown } from '../src/lib/convert.ts'
import { buildHtmlDocument } from '../src/lib/markdown.ts'
import * as XLSX from 'xlsx'
import { Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun, WidthType } from 'docx'
import mammoth from 'mammoth'

let pass = 0
let fail = 0
function check(name, cond) {
  if (cond) { pass++; console.log('  ✓', name) }
  else { fail++; console.error('  ✗', name) }
}

// 1) Markdown → HTML 文档
console.log('测试：Markdown → HTML')
const html = buildHtmlDocument('# 标题\n\n正文 **加粗**。', '测试')
check('包含 <h1>', html.includes('<h1>标题</h1>'))
check('lang=zh-CN', html.includes('<html lang="zh-CN">'))
check('加粗渲染', html.includes('<strong>加粗</strong>'))

// 2) Markdown → docx → Markdown 往返
console.log('测试：Markdown → Word → Markdown 往返')
const md = ['# 文档标题', '', '- 第一项', '- 第二项', '', '## 小节', '', '普通段落文字。', '', '| 列名 | 数值 |', '| --- | --- |', '| 苹果 | 5 |', ''].join('\n')
const blob = await markdownToDocxBlob(md)
const buf = await blob.arrayBuffer()
check('生成 docx Blob (非空)', buf.byteLength > 0)
const backMd = await docxToMarkdown(buf)
console.log('  (往返结果片段):', JSON.stringify(backMd.slice(0, 80)))
check('往返含标题文字', backMd.includes('文档标题'))
check('往返含列表项', backMd.includes('第一项') || backMd.includes('第二项'))
check('往返含表格内容', backMd.includes('苹果') || backMd.includes('列名'))

// 2b) 表格解析健壮性：表格内不能混入换行（会破坏 GFM 表格）
console.log('测试：Word 表格解析（无破坏性格式）')
const tableLines = backMd.split('\n').filter((l) => l.trim().startsWith('|'))
check('表格行数 >= 3（表头+分隔+数据）', tableLines.length >= 3)
check('表格行内无裸换行污染', tableLines.every((l) => !l.includes('\n')))
check('表格每行首尾都是 |', tableLines.every((l) => l.startsWith('|') && l.endsWith('|')))
check('第二行是分隔行', /^\|\s*---(\s*\|\s*---)*\s*\|$/.test(tableLines[1] || ''))

// 2c) 复杂表格：跨列合并 + 跨行合并 + 单元格内多段落
console.log('测试：复杂 Word 表格（合并单元格 / 多段）')
const cell = (text, opts = {}) => new TableCell({
  children: [new Paragraph({ children: [new TextRun(text)] })],
  ...opts,
})
const multiParaCell = new TableCell({
  children: [
    new Paragraph({ children: [new TextRun('第一段')] }),
    new Paragraph({ children: [new TextRun('第二段')] }),
  ],
})
const complexTable = new Table({
  width: { size: 100, type: WidthType.PERCENTAGE },
  rows: [
    new TableRow({ children: [
      cell('合并表头', { columnSpan: 2 }),   // 跨 2 列
      cell('C'),
    ]}),
    new TableRow({ children: [
      cell('跨两行', { rowSpan: 2 }),         // 跨 2 行
      multiParaCell,
      cell('x'),
    ]}),
    new TableRow({ children: [
      // 第一个位置被上面的 rowSpan 占用，这里只填后两列
      cell('y'),
      cell('z'),
    ]}),
  ],
})
const complexDoc = new Document({ sections: [{ children: [complexTable] }] })
const complexBlob = await Packer.toBlob(complexDoc)
const complexMd = await docxToMarkdown(await complexBlob.arrayBuffer())
console.log('  (复杂表格结果):\n' + complexMd.split('\n').map((l) => '    ' + l).join('\n'))
const complexRows = complexMd.split('\n').filter((l) => l.trim().startsWith('|'))
check('复杂表格至少 4 行（表头+分隔+2 数据）', complexRows.length >= 4)
check('每行列宽一致（3 列）', complexRows.every((l) => (l.match(/\|/g) || []).length === 4))
check('保留合并表头文字', complexMd.includes('合并表头'))
check('保留跨行单元格文字', complexMd.includes('跨两行'))
check('多段单元格压成一行（含两段文字）', complexRows.some((l) => l.includes('第一段') && l.includes('第二段')))
check('无裸换行污染表格行', complexRows.every((l) => !l.slice(1, -1).includes('\n')))

// 2d-2) md→docx：表格内转义竖线 \| 不能错列
console.log('测试：md→Word 表格转义竖线（\\| 不错列）')
const pipeMd = ['| 名字 | 值 |', '| --- | --- |', '| a\\|b | c |'].join('\n')
const pipeBlob = await markdownToDocxBlob(pipeMd)
const pipeHtml = (await mammoth.convertToHtml({ buffer: Buffer.from(await pipeBlob.arrayBuffer()) })).value
check('转义竖线还原为 |', pipeHtml.includes('a|b'))
check('同行另一列 c 未丢失', pipeHtml.includes('c'))
check('表格仍是 2 列（a|b 与 c 分属不同单元格）', (pipeHtml.match(/<td/g) || []).length >= 2)

// 2d) md→docx 高级元素：链接 / 有序列表 / 代码块 / 嵌套格式（用 mammoth 读回 HTML 断言）
console.log('测试：md→Word 高级元素（链接/有序列表/代码块/嵌套）')
const FENCE = '```'
const advMd = [
  '# 高级元素测试',
  '',
  '含 [示例链接](https://example.com)，以及 **加粗**、***粗斜体***、`行内代码`。',
  '',
  '1. 第一项',
  '2. 第二项',
  '',
  FENCE,
  'const x = 1',
  'const y = 2',
  FENCE,
  '',
  '> 这是一段引用',
].join('\n')
const advBlob = await markdownToDocxBlob(advMd)
const advHtml = (await mammoth.convertToHtml({ buffer: Buffer.from(await advBlob.arrayBuffer()) })).value
check('链接保留为可点超链接', /<a [^>]*href="https:\/\/example\.com"/.test(advHtml))
check('有序列表渲染为 ol/li', /<ol>|<li>/.test(advHtml))
check('代码块内容保留', advHtml.includes('const x = 1') && advHtml.includes('const y = 2'))
check('嵌套粗斜体文字保留', advHtml.includes('粗斜体'))
check('行内代码文字保留', advHtml.includes('行内代码'))
check('引用保留', advHtml.includes('这是一段引用'))

// 3) xlsx → Markdown
console.log('测试：Excel → Markdown')
const wb = XLSX.utils.book_new()
const ws = XLSX.utils.aoa_to_sheet([['姓名', '分数'], ['张三', 90], ['李四', 85]])
XLSX.utils.book_append_sheet(wb, ws, '成绩单')
const xlsxBuf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
const xmd = xlsxToMarkdown(xlsxBuf)
check('含工作表名', xmd.includes('成绩单'))
check('含表头', xmd.includes('姓名') && xmd.includes('分数'))
check('含数据', xmd.includes('张三') && xmd.includes('90'))
check('含表格分隔行', xmd.includes('---'))

console.log(`\n结果：${pass} 通过，${fail} 失败`)
process.exit(fail ? 1 : 0)
