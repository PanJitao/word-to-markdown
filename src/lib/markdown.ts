// Markdown 渲染：把 Markdown 源码转成可安全插入页面的 HTML
import DOMPurify from 'dompurify'
import MarkdownIt from 'markdown-it'

const renderer = new MarkdownIt({
  html: true,
  linkify: true,
  breaks: true,
})

/** 把 Markdown 渲染成预览用的 HTML（经过消毒，防 XSS） */
export function renderMarkdown(markdown: string): string {
  return DOMPurify.sanitize(renderer.render(markdown), {
    ADD_ATTR: ['style', 'target'],
  })
}

/** 把 Markdown 渲染成纯 HTML 片段（不消毒，仅用于导出受信任内容） */
export function markdownToHtml(markdown: string): string {
  return renderer.render(markdown)
}

/** 生成一份完整的、可直接打开的 HTML 文档 */
export function buildHtmlDocument(markdown: string, title: string): string {
  const body = markdownToHtml(markdown)
  const safeTitle = escapeHtml(title)
  return [
    '<!doctype html>',
    '<html lang="zh-CN">',
    '<head>',
    '  <meta charset="utf-8" />',
    '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
    `  <title>${safeTitle}</title>`,
    '  <style>',
    "    body { font-family: 'Segoe UI', 'Microsoft YaHei', sans-serif; margin: 40px auto; max-width: 920px; line-height: 1.7; color: #1c1917; padding: 0 24px; }",
    '    h1, h2, h3 { color: #1f1a12; }',
    '    table { border-collapse: collapse; width: 100%; margin: 24px 0; }',
    '    th, td { border: 1px solid #d6d3d1; padding: 10px 12px; text-align: left; }',
    '    th { background: #f5f2ee; }',
    '    pre { background: #111827; color: #f9fafb; padding: 16px; overflow: auto; border-radius: 8px; }',
    "    code { font-family: 'Cascadia Code', Consolas, monospace; }",
    '    blockquote { border-left: 4px solid #c96f2d; margin: 0; padding: 4px 16px; color: #6a5c49; background: #faf6ef; }',
    '    img { max-width: 100%; }',
    '  </style>',
    '</head>',
    '<body>',
    body,
    '</body>',
    '</html>',
    '',
  ].join('\n')
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
