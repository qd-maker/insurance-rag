// Type declarations for optional dependencies
// These modules use dynamic import with try/catch fallback

declare module 'langfuse' {
  export class Langfuse {
    constructor(config: { publicKey: string; secretKey: string; baseUrl?: string });
    trace(opts: any): any;
    flush(): Promise<void>;
  }
}

declare module 'pdf-parse' {
  interface PDFData {
    numpages: number;
    text: string;
    info: any;
  }
  function pdfParse(buffer: Buffer): Promise<PDFData>;
  export default pdfParse;
}
