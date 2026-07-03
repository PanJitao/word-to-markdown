declare module 'markdown-it' {
  const MarkdownIt: any
  export default MarkdownIt
}

declare module 'mammoth/mammoth.browser.js' {
  const mammoth: {
    convertToHtml(input: { arrayBuffer: ArrayBuffer }): Promise<{ value: string; messages: any[] }>
  }
  export default mammoth
}

declare module 'xlsx' {
  export const utils: {
    sheet_to_json(sheet: any, opts?: any): any[][]
    book_new(): any
    aoa_to_sheet(aoa: any[][]): any
    book_append_sheet(wb: any, ws: any, name: string): void
  }
  export function read(data: ArrayBuffer, opts?: any): any
  export function write(wb: any, opts: any): any
}
