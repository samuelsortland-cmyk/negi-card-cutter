// Turns uploaded files into plain text, entirely in the browser: Word (.docx), PDF and text files.
(function () {
  const MAX_CHARS = 40000; // per file, so a huge doc doesn't burn credits

  // .docx is a zip; the text lives in word/document.xml.
  async function docxText(buf) {
    const v = new DataView(buf), u8 = new Uint8Array(buf);
    let eocd = -1;
    for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error("This doesn't look like a Word file. Try saving it again as .docx.");
    let p = v.getUint32(eocd + 16, true);
    const count = v.getUint16(eocd + 10, true);
    for (let n = 0; n < count; n++) {
      if (v.getUint32(p, true) !== 0x02014b50) break;
      const method = v.getUint16(p + 10, true), size = v.getUint32(p + 20, true);
      const nameLen = v.getUint16(p + 28, true), extra = v.getUint16(p + 30, true), comment = v.getUint16(p + 32, true);
      const local = v.getUint32(p + 42, true);
      const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nameLen));
      if (name === 'word/document.xml') {
        const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
        const raw = u8.subarray(start, start + size);
        const xml = method === 0 ? new TextDecoder().decode(raw)
          : await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
        return xmlToText(xml);
      }
      p += 46 + nameLen + extra + comment;
    }
    throw new Error('No document text found in this Word file.');
  }

  function xmlToText(xml) {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const out = [];
    for (const para of doc.getElementsByTagName('w:p')) {
      let line = '';
      for (const el of para.getElementsByTagName('*')) {
        if (el.tagName === 'w:t') line += el.textContent;
        else if (el.tagName === 'w:tab') line += '\t';
        else if (el.tagName === 'w:br') line += '\n';
      }
      out.push(line);
    }
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  let pdfLib = null;
  function loadPdfJs() {
    if (pdfLib) return pdfLib;
    pdfLib = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'vendor/pdfjs/pdf.min.js';
      s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdfjs/pdf.worker.min.js'; resolve(window.pdfjsLib); };
      s.onerror = () => reject(new Error("Couldn't load the PDF reader."));
      document.head.appendChild(s);
    });
    return pdfLib;
  }
  async function pdfText(buf) {
    const lib = await loadPdfJs();
    const pdf = await lib.getDocument({ data: new Uint8Array(buf) }).promise;
    const pages = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const tc = await (await pdf.getPage(i)).getTextContent();
      pages.push(tc.items.map((it) => it.str + (it.hasEOL ? '\n' : '')).join(''));
    }
    const text = pages.join('\n\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    if (text.length < 40) throw new Error('This PDF looks like scanned images, so there is no text to read.');
    return text;
  }

  async function fileToText(file) {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    let text;
    if (ext === 'docx') text = await docxText(await file.arrayBuffer());
    else if (ext === 'pdf') text = await pdfText(await file.arrayBuffer());
    else if (['txt', 'md', 'rtf', 'csv'].includes(ext) || file.type.startsWith('text/')) text = await file.text();
    else if (ext === 'doc') throw new Error('Old .doc files can\'t be read. In Word, use File → Save As → .docx, then upload that.');
    else throw new Error('Upload a Word (.docx), PDF or text file. For a Google Doc, use File → Download → .docx.');
    const cut = text.length > MAX_CHARS;
    return { text: cut ? text.slice(0, MAX_CHARS) : text, chars: text.length, cut };
  }

  window.NegiUploads = { fileToText, xmlToText, MAX_CHARS };
})();
